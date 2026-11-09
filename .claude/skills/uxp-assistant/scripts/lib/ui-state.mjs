import { componentModule } from "./sfc.mjs";
import { childNodes, parseExpressionText, parseSource, setParents, unwrapExpression as unwrap } from "./parse.mjs";

/**
 * An honest panel state is one of these, in React, Vue, Svelte, or plain DOM code:
 *  - an error state: a state the view renders live is written on an error path
 *    (a catch block, a .catch() handler, a then() rejection handler, or onerror);
 *  - a busy or loading state: a state written by two or more handler calls with different values,
 *    and used live in a disabled binding or as the condition of what the view renders.
 * Static text, keywords in markup, a state that is never set on an error or busy path,
 * and a status line under a dead branch (false && …, v-if="false", {#if false}) are not that state.
 */

function isFalse(node) {
  const value = unwrap(node);
  if (!value) return false;
  if (value.type === "BooleanLiteral") return value.value === false;
  if (value.type === "NumericLiteral") return value.value === 0;
  if (value.type === "NullLiteral") return true;
  if (value.type === "Identifier" && value.name === "undefined") return true;
  return false;
}

function isTrue(node) {
  const value = unwrap(node);
  if (!value) return false;
  if (value.type === "BooleanLiteral") return value.value === true;
  if (value.type === "NumericLiteral") return value.value !== 0;
  return false;
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
    if ((parent.type === "ConditionalExpression" || parent.type === "IfStatement") && parent.test === current) return true;
    if (parent.type === "LogicalExpression" && parent.left === current) return true;
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
    if (parent.type === "CatchClause" && parent.body === current) return true;
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

function stateVerdict(states, liveUse) {
  for (const state of states) {
    const writes = state.writes.filter((item) => !dead(item.node));
    const live = liveUse(state.name);
    if (!live.rendered && !live.disabled && !live.condition) continue;
    if (writes.some((item) => onErrorPath(item.node)) && (live.rendered || live.disabled)) return { ok: true, state: state.name, why: "error" };
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
      if (node.type === "JSXExpressionContainer" && node.parent?.type !== "JSXAttribute" && references(name, node)) use.rendered = true;
      if (node.type === "JSXAttribute" && node.value && node.value.type === "JSXExpressionContainer" && references(name, node.value)) {
        const attr = node.name?.name || "";
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
  const component = componentModule(rel, body);
  const svelte = /\.svelte$/i.test(rel);
  let ast;
  try {
    ast = parseSource(component.script, `${rel}.${component.ts ? "ts" : "js"}`);
  } catch {
    return { ok: false };
  }
  setParents(ast);
  const states = [];
  const byName = new Map();
  if (svelte) {
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
    walk(item.expr, (node) => {
      if (node.type !== "AssignmentExpression") return;
      let root = unwrap(node.left);
      while (root && (root.type === "MemberExpression" || root.type === "OptionalMemberExpression")) root = unwrap(root.object);
      if (root?.type === "Identifier" && byName.has(root.name)) byName.get(root.name).writes.push({ node, value: valueKey(node.right) });
    });
  }
  const use = (name) => {
    const out = { rendered: false, disabled: false, condition: false };
    for (const item of parsed) {
      if (item.kind === "handler" || !references(name, item.expr)) continue;
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
  const verdict = stateVerdict(reactStates(ast), jsxUse(ast));
  if (verdict.ok) return true;
  return domVerdict(ast).ok;
}
