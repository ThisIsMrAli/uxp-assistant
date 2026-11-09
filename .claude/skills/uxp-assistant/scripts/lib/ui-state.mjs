import { componentModule } from "./sfc.mjs";
import { childNodes, parseExpressionText, parseSource, setParents, unwrapExpression as unwrap } from "./parse.mjs";
import { staticTruth, staticValue } from "./test-strength.mjs";

/**
 * An honest panel state is one of these, in React, Vue, Svelte, or plain DOM code:
 *  - an error state: a state the view renders live is written on an error path
 *    (a catch block, a .catch() handler, a then() rejection handler, or onerror);
 *  - a busy or loading state: a state written by two or more handler calls with different values,
 *    and used live in a disabled binding or as the condition of what the view renders.
 * Static text, keywords in markup, a state that is never set on an error or busy path,
 * and a status line under a dead branch (false && …, v-if="false", {#if false}) are not that state.
 * Nor are: a guard on a constant (const SHOW = false, v-if="show" with const show = false, {#if 0 > 1}),
 * an element with hidden, display:none or visibility:hidden, a value used only as key or ref, a component
 * function nothing mounts, a write cleared again in the same catch, a catch around builtins only
 * (JSON.parse), a binding whose value is constant (busy && false), and a ternary with identical branches.
 */

/** The constants of a module: const NAME = literal, at any depth. Read through for static conditions. */
let CONSTS = new Map();
let SOURCE = "";
let REACHABLE = null;

function collectConsts(ast) {
  const consts = new Map();
  walk(ast, (node) => {
    if (node.type === "VariableDeclarator" && node.id.type === "Identifier" && node.init && node.parent?.kind === "const") {
      const init = unwrap(node.init);
      if (["BooleanLiteral", "NumericLiteral", "StringLiteral", "NullLiteral", "UnaryExpression", "BinaryExpression", "LogicalExpression", "TemplateLiteral"].includes(init.type) || (init.type === "Identifier" && init.name === "undefined")) consts.set(node.id.name, init);
    }
  });
  return consts;
}

const FN_TYPES = new Set(["FunctionDeclaration", "ArrowFunctionExpression", "FunctionExpression"]);

/**
 * Functions that can run: exported ones, ones referenced from code that can run (a JSX tag, a call,
 * a handler prop), and inline callbacks inside those. A component function nothing mounts is not reachable.
 * extraRoots names functions a template uses. Returns null when nothing in the file is exported or used.
 */
function reachableFunctions(ast, extraRoots = []) {
  const named = new Map();
  const nameOf = new Map();
  walk(ast, (node) => {
    if (node.type === "FunctionDeclaration" && node.id) {
      named.set(node.id.name, node);
      nameOf.set(node, node.id.name);
    }
    if (node.type === "VariableDeclarator" && node.id.type === "Identifier" && node.init && FN_TYPES.has(unwrap(node.init).type)) {
      named.set(node.id.name, unwrap(node.init));
      nameOf.set(unwrap(node.init), node.id.name);
    }
  });
  const reach = new Set();
  walk(ast, (node) => {
    if (FN_TYPES.has(node.type) && !nameOf.has(node)) reach.add(node);
  });
  const isExport = (node) => node && (node.type === "ExportNamedDeclaration" || node.type === "ExportDefaultDeclaration");
  const exported = (fn) => {
    if (isExport(fn.parent)) return true;
    const declarator = fn.parent?.type === "VariableDeclarator" ? fn.parent : null;
    return Boolean(declarator && isExport(declarator.parent?.parent));
  };
  let any = false;
  for (const fn of named.values()) {
    if (exported(fn)) {
      reach.add(fn);
      any = true;
    }
  }
  for (const name of extraRoots) {
    if (named.has(name)) {
      reach.add(named.get(name));
      any = true;
    }
  }
  const runs = (node) => {
    let current = node.parent;
    while (current) {
      if (FN_TYPES.has(current.type) && nameOf.has(current)) return reach.has(current);
      current = current.parent;
    }
    return true;
  };
  let changed = true;
  while (changed) {
    changed = false;
    walk(ast, (node) => {
      if ((node.type !== "Identifier" && node.type !== "JSXIdentifier") || !named.has(node.name)) return;
      const fn = named.get(node.name);
      if (reach.has(fn)) return;
      const parent = node.parent;
      if (parent && (parent.type === "FunctionDeclaration" && parent.id === node)) return;
      if (parent && parent.type === "VariableDeclarator" && parent.id === node) return;
      if (parent && (parent.type === "MemberExpression" || parent.type === "OptionalMemberExpression") && parent.property === node && !parent.computed) return;
      if (parent && parent.type === "JSXClosingElement") return;
      if (runs(node)) {
        reach.add(fn);
        any = true;
        changed = true;
      }
    });
  }
  return any ? reach : null;
}

function sameSource(a, b) {
  if (!a || !b || !SOURCE) return false;
  return SOURCE.slice(a.start, a.end).replace(/\s+/g, "") === SOURCE.slice(b.start, b.end).replace(/\s+/g, "");
}

const BUILTIN_ROOTS = new Set(["JSON", "Math", "Number", "String", "Boolean", "Object", "Array", "console", "Date", "parseInt", "parseFloat", "isNaN", "encodeURIComponent", "decodeURIComponent", "structuredClone"]);

/** A try block whose only calls are builtins (JSON.parse, Math.*) does not guard the feature's work. */
function tryDoesWork(block) {
  let work = false;
  walk(block, (node) => {
    if (work) return;
    if (node.type === "AwaitExpression") work = true;
    if (node.type === "CallExpression" || node.type === "NewExpression" || node.type === "OptionalCallExpression") {
      let root = unwrap(node.callee);
      while (root && (root.type === "MemberExpression" || root.type === "OptionalMemberExpression")) root = unwrap(root.object);
      if (!(root?.type === "Identifier" && BUILTIN_ROOTS.has(root.name))) work = true;
    }
  });
  return work;
}

function hiddenElement(opening) {
  for (const attr of opening?.attributes || []) {
    if (attr.type !== "JSXAttribute") continue;
    const name = attr.name?.name || "";
    const value = attr.value;
    if (name === "hidden") {
      if (!value) return true;
      if (value.type === "StringLiteral") return true;
      if (value.type === "JSXExpressionContainer" && staticTruth(value.expression, CONSTS) === true) return true;
    }
    if (name === "style" && value) {
      if (value.type === "StringLiteral" && /(?:display\s*:\s*none|visibility\s*:\s*hidden)/i.test(value.value)) return true;
      const expr = value.type === "JSXExpressionContainer" ? unwrap(value.expression) : null;
      if (expr?.type === "ObjectExpression") {
        for (const prop of expr.properties) {
          const key = prop.type === "ObjectProperty" && !prop.computed ? (prop.key.name || prop.key.value) : "";
          const v = prop.type === "ObjectProperty" ? unwrap(prop.value) : null;
          if (key === "display" && v?.type === "StringLiteral" && v.value === "none") return true;
          if (key === "visibility" && v?.type === "StringLiteral" && v.value === "hidden") return true;
        }
      }
    }
  }
  return false;
}

function isFalse(node) {
  return staticTruth(node, CONSTS) === false;
}

function isTrue(node) {
  return staticTruth(node, CONSTS) === true;
}

function dead(node) {
  let parent = node?.parent;
  let current = node;
  while (parent) {
    if (parent.type === "ConditionalExpression") {
      if (parent.consequent === current && isFalse(parent.test)) return true;
      if (parent.alternate === current && isTrue(parent.test)) return true;
    }
    if (parent.type === "LogicalExpression" && parent.operator === "&&" && parent.right === current && isFalse(parent.left)) return true;
    if (parent.type === "LogicalExpression" && parent.operator === "||" && parent.right === current && isTrue(parent.left)) return true;
    if (parent.type === "IfStatement" && parent.consequent === current && isFalse(parent.test)) return true;
    if (parent.type === "IfStatement" && parent.alternate === current && isTrue(parent.test)) return true;
    if (parent.type === "JSXElement" && current !== parent.openingElement && hiddenElement(parent.openingElement)) return true;
    if (parent.type === "JSXAttribute" && /^(?:key|ref)$/.test(parent.name?.name || "")) return true;
    if (REACHABLE && (current.type === "FunctionDeclaration" || current.type === "ArrowFunctionExpression" || current.type === "FunctionExpression") && !REACHABLE.has(current)) return true;
    current = parent;
    parent = parent.parent;
  }
  return false;
}

function walk(node, visit) {
  if (!node || typeof node !== "object" || !node.type) return;
  visit(node);
  for (const child of childNodes(node)) walk(child, visit);
}

function references(name, node) {
  let found = false;
  walk(node, (item) => {
    if (found) return;
    if ((item.type === "Identifier" || item.type === "JSXIdentifier") && item.name === name && !dead(item)) {
      const parent = item.parent;
      if (parent && (parent.type === "MemberExpression" || parent.type === "OptionalMemberExpression") && parent.property === item && !parent.computed) return;
      if (parent && parent.type === "ObjectProperty" && parent.key === item && !parent.computed && !parent.shorthand) return;
      found = true;
    }
  });
  return found;
}

function inConditionTest(node) {
  let current = node;
  let parent = node.parent;
  while (parent) {
    if (parent.type === "ConditionalExpression" && parent.test === current) return !sameSource(parent.consequent, parent.alternate);
    if (parent.type === "IfStatement" && parent.test === current) return true;
    if (parent.type === "LogicalExpression" && parent.left === current) return staticTruth(parent, CONSTS) === undefined;
    if (parent.type === "JSXExpressionContainer" || parent.type === "JSXAttribute" || parent.type === "Program") return false;
    current = parent;
    parent = parent.parent;
  }
  return false;
}

function isLiteralValue(node) {
  const value = unwrap(node);
  if (!value) return true;
  if (["StringLiteral", "NumericLiteral", "BooleanLiteral", "NullLiteral"].includes(value.type)) return true;
  if (value.type === "Identifier" && value.name === "undefined") return true;
  if (value.type === "TemplateLiteral" && value.expressions.length === 0) return true;
  if (value.type === "UnaryExpression" && isLiteralValue(value.argument)) return true;
  return false;
}

function valueKey(node) {
  const value = unwrap(node);
  if (!value) return "undefined";
  if (isLiteralValue(value)) {
    if (value.type === "TemplateLiteral") return JSON.stringify(value.quasis.map((q) => q.value.cooked).join(""));
    if (value.type === "UnaryExpression") return `${value.operator}${valueKey(value.argument)}`;
    if (value.type === "Identifier") return "undefined";
    return JSON.stringify(value.value ?? null);
  }
  return `expr:${value.start}`;
}

/** A write is on an error path when it runs in a catch block, a .catch() or then() rejection handler, or an onerror handler. */
function onErrorPath(node) {
  let current = node;
  let parent = node.parent;
  while (parent) {
    if (parent.type === "CatchClause" && parent.body === current) return tryDoesWork(parent.parent?.block);
    if ((current.type === "ArrowFunctionExpression" || current.type === "FunctionExpression") && (parent.type === "CallExpression" || parent.type === "OptionalCallExpression")) {
      const callee = unwrap(parent.callee);
      const method = callee && (callee.type === "MemberExpression" || callee.type === "OptionalMemberExpression") && !callee.computed ? callee.property?.name : "";
      const position = parent.arguments.indexOf(current);
      if (method === "catch" && position === 0) return true;
      if (method === "then" && position === 1) return true;
    }
    if ((current.type === "ArrowFunctionExpression" || current.type === "FunctionExpression") && parent.type === "AssignmentExpression" && parent.right === current) {
      const left = unwrap(parent.left);
      const key = left && (left.type === "MemberExpression" || left.type === "OptionalMemberExpression") && !left.computed ? left.property?.name : "";
      if (key === "onerror") return true;
    }
    if (parent.type === "JSXAttribute" && /^onError$/i.test(parent.name?.name || "")) return true;
    current = parent;
    parent = parent.parent;
  }
  return false;
}

const CLEARED = new Set(["\"\"", "null", "false", "undefined", "0"]);

/** An error write that a later statement in the same block sets back to empty, so the error never shows. */
function clearedAfter(write, state) {
  let stmt = write.node;
  while (stmt && stmt.parent && stmt.parent.type !== "BlockStatement") stmt = stmt.parent;
  const block = stmt?.parent;
  if (!block || block.type !== "BlockStatement") return false;
  const at = block.body.indexOf(stmt);
  return block.body.slice(at + 1).some((later) => state.writes.some((other) => other !== write && CLEARED.has(other.value) && (other.node === later || (later.type === "ExpressionStatement" && unwrap(later.expression) === other.node))));
}

function stateVerdict(states, liveUse) {
  for (const state of states) {
    const writes = state.writes.filter((item) => !dead(item.node));
    const live = liveUse(state.name);
    if (!live.rendered && !live.disabled && !live.condition) continue;
    if (writes.some((item) => onErrorPath(item.node) && !CLEARED.has(item.value) && !clearedAfter(item, state)) && (live.rendered || live.disabled)) return { ok: true, state: state.name, why: "error" };
    const values = new Set(writes.map((item) => item.value));
    if (values.size >= 2 && (live.disabled || live.condition)) return { ok: true, state: state.name, why: "busy" };
  }
  return { ok: false };
}

function reactStates(ast) {
  const states = [];
  walk(ast, (node) => {
    if (node.type !== "VariableDeclarator" || node.id.type !== "ArrayPattern" || !node.init) return;
    const init = unwrap(node.init);
    if (init.type !== "CallExpression") return;
    const callee = unwrap(init.callee);
    const hook = callee?.type === "Identifier" ? callee.name : (callee?.type === "MemberExpression" && !callee.computed ? callee.property?.name : "");
    if (hook !== "useState" && hook !== "useReducer") return;
    const name = node.id.elements[0]?.type === "Identifier" ? node.id.elements[0].name : "";
    const setter = node.id.elements[1]?.type === "Identifier" ? node.id.elements[1].name : "";
    if (name && setter) states.push({ name, setter, writes: [] });
  });
  walk(ast, (node) => {
    if (node.type !== "CallExpression" && node.type !== "OptionalCallExpression") return;
    const callee = unwrap(node.callee);
    if (callee?.type !== "Identifier") return;
    for (const state of states) {
      if (state.setter === callee.name) state.writes.push({ node, value: valueKey(node.arguments[0]) });
    }
  });
  return states;
}

function jsxUse(ast) {
  return (name) => {
    const use = { rendered: false, disabled: false, condition: false };
    walk(ast, (node) => {
      if (dead(node)) return;
      if (node.type === "JSXExpressionContainer" && node.parent?.type !== "JSXAttribute" && references(name, node) && !staticValue(node.expression, CONSTS).known) use.rendered = true;
      if (node.type === "JSXAttribute" && node.value && node.value.type === "JSXExpressionContainer" && references(name, node.value) && staticTruth(node.value.expression, CONSTS) === undefined) {
        const attr = node.name?.name || "";
        if (/^(?:key|ref)$/.test(attr)) return;
        if (/^disabled$/i.test(attr) || /^aria-busy$/i.test(attr)) use.disabled = true;
        else if (!/^on[A-Z]/.test(attr)) use.rendered = true;
      }
      if ((node.type === "Identifier" || node.type === "JSXIdentifier") && node.name === name && inConditionTest(node)) {
        let parent = node.parent;
        while (parent && parent.type !== "JSXExpressionContainer" && parent.type !== "ReturnStatement" && parent.type !== "Program") parent = parent.parent;
        if (parent && (parent.type === "JSXExpressionContainer" || (parent.type === "ReturnStatement" && parent.argument && containsJsx(parent.argument)))) use.condition = true;
      }
    });
    return use;
  };
}

function containsJsx(node) {
  let found = false;
  walk(node, (item) => {
    if (item.type === "JSXElement" || item.type === "JSXFragment") found = true;
  });
  return found;
}

function domVerdict(ast) {
  let ok = false;
  walk(ast, (node) => {
    if (ok) return;
    if (node.type === "AssignmentExpression") {
      const left = unwrap(node.left);
      const key = left && (left.type === "MemberExpression" || left.type === "OptionalMemberExpression") && !left.computed ? left.property?.name : "";
      if (["textContent", "innerText", "innerHTML"].includes(key) && onErrorPath(node)) ok = true;
    }
    if (node.type === "CallExpression") {
      const callee = unwrap(node.callee);
      const method = callee && callee.type === "MemberExpression" && !callee.computed ? callee.property?.name : "";
      if ((method === "setAttribute" || method === "append" || method === "replaceChildren") && onErrorPath(node)) ok = true;
    }
  });
  if (ok) return { ok: true, why: "dom-error" };
  const disabled = [];
  walk(ast, (node) => {
    if (node.type !== "AssignmentExpression") return;
    const left = unwrap(node.left);
    if (left && left.type === "MemberExpression" && !left.computed && left.property?.name === "disabled") disabled.push(valueKey(node.right));
  });
  if (new Set(disabled).size >= 2) return { ok: true, why: "dom-busy" };
  return { ok: false };
}

function componentState(rel, body) {
  const svelte = /\.svelte$/i.test(rel);
  const scriptOnly = componentModule(rel, body);
  let ast;
  try {
    ast = parseSource(scriptOnly.script, `${rel}.${scriptOnly.ts ? "ts" : "js"}`);
  } catch {
    return { ok: false };
  }
  setParents(ast);
  const consts = collectConsts(ast);
  const deadCondition = (code) => {
    try {
      return staticTruth(parseExpressionText(code, true), consts) === false;
    } catch {
      return false;
    }
  };
  const component = componentModule(rel, body, { deadCondition, hidden: true });
  CONSTS = consts;
  SOURCE = component.script;
  try {
    return componentVerdict(rel, svelte, ast, component);
  } finally {
    CONSTS = new Map();
    SOURCE = "";
    REACHABLE = null;
  }
}

function componentVerdict(rel, svelte, ast, component) {
  const states = [];
  const byName = new Map();
  if (svelte) {
    // Svelte stores: const error = writable(""); error.set(...) on the error path; {$error} in markup.
    walk(ast, (node) => {
      if (node.type !== "VariableDeclarator" || node.id.type !== "Identifier" || !node.init) return;
      const init = unwrap(node.init);
      const callee = init.type === "CallExpression" ? unwrap(init.callee) : null;
      if (callee?.type === "Identifier" && (callee.name === "writable" || callee.name === "readable")) {
        const state = { name: node.id.name, writes: [], store: true };
        states.push(state);
        byName.set(state.name, state);
      }
    });
    for (const stmt of ast.program.body) {
      const decl = stmt.type === "ExportNamedDeclaration" ? stmt.declaration : stmt;
      if (decl?.type !== "VariableDeclaration" || decl.kind !== "let") continue;
      for (const item of decl.declarations) {
        if (item.id.type === "Identifier") {
          const state = { name: item.id.name, writes: [] };
          states.push(state);
          byName.set(state.name, state);
        }
      }
    }
  } else {
    walk(ast, (node) => {
      if (node.type !== "VariableDeclarator" || node.id.type !== "Identifier" || !node.init) return;
      const init = unwrap(node.init);
      const callee = init.type === "CallExpression" ? unwrap(init.callee) : null;
      const name = callee?.type === "Identifier" ? callee.name : "";
      if (["ref", "shallowRef", "reactive", "shallowReactive", "computed"].includes(name)) {
        const state = { name: node.id.name, writes: [], reactive: name.includes("eactive") };
        states.push(state);
        byName.set(state.name, state);
      }
    });
  }
  const storeWrites = (tree) => walk(tree, (node) => {
    if (node.type !== "CallExpression") return;
    const callee = unwrap(node.callee);
    if (callee?.type !== "MemberExpression" || callee.computed || !["set", "update"].includes(callee.property?.name)) return;
    const root = unwrap(callee.object);
    const state = root?.type === "Identifier" ? byName.get(root.name) : null;
    if (!state?.store) return;
    state.writes.push({ node, value: callee.property.name === "set" ? valueKey(node.arguments[0]) : `update:${node.start}` });
  });
  storeWrites(ast);
  walk(ast, (node) => {
    if (node.type !== "AssignmentExpression" && node.type !== "UpdateExpression") return;
    const target = unwrap(node.type === "AssignmentExpression" ? node.left : node.argument);
    let root = target;
    while (root && (root.type === "MemberExpression" || root.type === "OptionalMemberExpression")) root = unwrap(root.object);
    if (root?.type !== "Identifier" || !byName.has(root.name)) return;
    byName.get(root.name).writes.push({ node, value: node.type === "AssignmentExpression" ? valueKey(node.right) : `update:${node.start}` });
  });
  const parsed = [];
  for (const item of component.expressions) {
    let expr;
    try {
      expr = item.kind === "handler" ? parseSource(`(() => { ${item.code}\n});`, "t.ts").program.body[0] : parseExpressionText(item.code, true);
    } catch {
      continue;
    }
    setParents(expr);
    parsed.push({ ...item, expr });
  }
  for (const item of parsed.filter((entry) => entry.kind === "handler")) {
    storeWrites(item.expr);
    walk(item.expr, (node) => {
      if (node.type !== "AssignmentExpression") return;
      let root = unwrap(node.left);
      while (root && (root.type === "MemberExpression" || root.type === "OptionalMemberExpression")) root = unwrap(root.object);
      if (root?.type === "Identifier" && byName.has(root.name)) byName.get(root.name).writes.push({ node, value: valueKey(node.right) });
    });
  }
  const use = (stateName) => {
    const out = { rendered: false, disabled: false, condition: false };
    const name = byName.get(stateName)?.store ? `$${stateName}` : stateName;
    for (const item of parsed) {
      if (item.kind === "handler" || !references(name, item.expr)) continue;
      const whole = item.expr.type === "ExpressionStatement" ? item.expr.expression : item.expr;
      if (/^(?:disabled|aria-busy|if|else-if|show)$/i.test(item.attr) ? staticTruth(whole, CONSTS) !== undefined : staticValue(whole, CONSTS).known) continue;
      if (/^(?:disabled|aria-busy)$/i.test(item.attr)) out.disabled = true;
      else if (item.attr === "if" || item.attr === "else-if" || item.attr === "show") {
        out.condition = true;
        out.rendered = true;
      } else out.rendered = true;
      walk(item.expr, (node) => {
        if (node.type === "Identifier" && node.name === name && inConditionTest(node)) out.condition = true;
      });
    }
    return out;
  };
  const verdict = stateVerdict(states, use);
  if (verdict.ok) return verdict;
  return domVerdict(ast);
}

/** Whether this changed UI file shows an honest error, disabled, or loading state. */
export function panelRendersState(source, rel = "panel.tsx") {
  const name = String(rel || "panel.tsx");
  if (/\.(?:vue|svelte)$/i.test(name)) return componentState(name, source).ok;
  let text = String(source || "");
  let parseName = name;
  if (/\.html?$/i.test(name)) {
    text = [...text.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi)].map((match) => match[1]).join("\n;\n");
    parseName = `${name}.js`;
  }
  let ast;
  try {
    ast = parseSource(text, /\.(?:[cm]?[jt]s)$/i.test(parseName) && !/\.(?:tsx|jsx)$/i.test(parseName) ? parseName : (parseName.endsWith("x") ? parseName : "panel.tsx"));
  } catch {
    try {
      ast = parseSource(text, `${parseName}.jsx`);
    } catch {
      return false;
    }
  }
  setParents(ast);
  CONSTS = collectConsts(ast);
  SOURCE = text;
  REACHABLE = /\.html?$/i.test(name) ? null : reachableFunctions(ast);
  try {
    const verdict = stateVerdict(reactStates(ast), jsxUse(ast));
    if (verdict.ok) return true;
    return domVerdict(ast).ok;
  } finally {
    CONSTS = new Map();
    SOURCE = "";
    REACHABLE = null;
  }
}
