import path from "node:path";
import { childNodes, parseSource, setParents, unwrapExpression as unwrap } from "./parse.mjs";

/**
 * A test covers the feature only when some assertion compares a value the feature produced from a
 * non-empty fixture with an independent, non-trivial expected value:
 *  - the assertion is equal, strictEqual, deepEqual, deepStrictEqual, partialDeepStrictEqual, or match
 *    (or expect(...).toBe, toEqual, toStrictEqual, toMatch, toContain, toMatchObject);
 *  - the actual value comes from a call to a binding imported from the changed module, and is not
 *    reduced to its shape (typeof, instanceof, Array.isArray, Object.keys/values/entries, .length);
 *  - at least one such call is given a fixture that is not null, undefined, or empty;
 *  - the expected value is a literal (or a local constant holding one) with a value other than
 *    null, undefined, true, false, 0, "", [], or {}, and is not itself computed by the feature.
 * ok, notEqual, throws, rejects, and snapshots of the feature's own output do not count.
 *
 * The assertion must also run:
 *  - it is in a test that is not test.skip, test.todo, describe.skip, it.skip, { skip } or { todo }, and does not call t.skip();
 *  - it is not under a constant-false branch, after a return or throw, or in a try whose catch swallows the failure;
 *  - a helper that holds it is called from a running test.
 * The actual value may not hide behind a ?? or || fallback, a ternary branch that is not the feature's value,
 * or String() of the feature's object. A table row or a helper argument counts as the expected value when every
 * row or call gives a non-trivial literal.
 */

const EQUAL = new Set(["equal", "strictEqual", "deepEqual", "deepStrictEqual", "partialDeepStrictEqual", "match"]);
const EXPECT = new Set(["toBe", "toEqual", "toStrictEqual", "toMatch", "toContain", "toMatchObject", "toContainEqual"]);
const SHAPE = new Set(["keys", "values", "entries", "getOwnPropertyNames", "isArray"]);

function walk(node, visit) {
  if (!node || typeof node !== "object" || !node.type) return;
  visit(node);
  for (const child of childNodes(node)) walk(child, visit);
}

function resolves(spec, testRel, featureRel) {
  if (!String(spec).startsWith(".")) return false;
  const from = path.posix.dirname(String(testRel).split(path.sep).join("/"));
  const resolved = path.posix.normalize(path.posix.join(from, spec));
  const target = String(featureRel).split(path.sep).join("/");
  const bare = target.replace(/\.(?:[cm]?[jt]sx?|vue|svelte)$/, "");
  return resolved === target || resolved === bare || resolved.replace(/\.(?:[cm]?js)$/, "") === bare;
}

function patternNames(pattern, out = []) {
  if (!pattern) return out;
  if (pattern.type === "Identifier") out.push(pattern.name);
  else if (pattern.type === "ObjectPattern") for (const prop of pattern.properties) patternNames(prop.type === "RestElement" ? prop.argument : prop.value, out);
  else if (pattern.type === "ArrayPattern") for (const item of pattern.elements) patternNames(item?.type === "RestElement" ? item.argument : item, out);
  else if (pattern.type === "AssignmentPattern") patternNames(pattern.left, out);
  return out;
}

function literalValue(node, consts, depth = 0) {
  const value = unwrap(node);
  if (!value || depth > 6) return { literal: false };
  switch (value.type) {
    case "StringLiteral":
      return { literal: true, trivial: value.value === "" };
    case "NumericLiteral":
      return { literal: true, trivial: value.value === 0 };
    case "BooleanLiteral":
    case "NullLiteral":
      return { literal: true, trivial: true };
    case "RegExpLiteral":
      return { literal: true, trivial: value.pattern.replace(/\\.|[.*+?^$()[\]{}|]/g, "").length < 3 };
    case "TemplateLiteral":
      if (value.expressions.length) return { literal: false };
      return { literal: true, trivial: value.quasis.map((q) => q.value.cooked).join("") === "" };
    case "UnaryExpression":
      if (value.operator === "-" && value.argument.type === "NumericLiteral") return { literal: true, trivial: value.argument.value === 0 };
      return { literal: false };
    case "Identifier": {
      if (value.name === "undefined") return { literal: true, trivial: true };
      if (consts.has(value.name)) return literalValue(consts.get(value.name), consts, depth + 1);
      const alternatives = consts.alternatives ? consts.alternatives(value) : null;
      if (alternatives && alternatives.length) {
        const items = alternatives.map((item) => (item ? literalValue(item, consts, depth + 1) : { literal: false }));
        if (items.some((item) => !item.literal)) return { literal: false };
        return { literal: true, trivial: items.some((item) => item.trivial) };
      }
      return { literal: false };
    }
    case "ArrayExpression": {
      if (!value.elements.length) return { literal: true, trivial: true };
      const items = value.elements.map((item) => literalValue(item, consts, depth + 1));
      if (items.some((item) => !item.literal)) return { literal: false };
      return { literal: true, trivial: items.every((item) => item.trivial) };
    }
    case "ObjectExpression": {
      if (!value.properties.length) return { literal: true, trivial: true };
      const items = value.properties.map((prop) => (prop.type === "ObjectProperty" && !prop.computed ? literalValue(prop.value, consts, depth + 1) : { literal: false }));
      if (items.some((item) => !item.literal)) return { literal: false };
      return { literal: true, trivial: items.every((item) => item.trivial) };
    }
    default:
      return { literal: false };
  }
}

/** A fixture is empty when it is null, undefined, or only holds such values, [] and {}. */
function emptyFixture(node, consts, depth = 0) {
  const value = unwrap(node);
  if (!value || depth > 6) return false;
  if (value.type === "NullLiteral") return true;
  if (value.type === "Identifier") {
    if (value.name === "undefined") return true;
    if (consts.has(value.name)) return emptyFixture(consts.get(value.name), consts, depth + 1);
    const alternatives = consts.alternatives ? consts.alternatives(value) : null;
    if (alternatives && alternatives.length) return alternatives.every((item) => !item || emptyFixture(item, consts, depth + 1));
    return false;
  }
  if (value.type === "ArrayExpression") return value.elements.every((item) => !item || emptyFixture(item, consts, depth + 1));
  if (value.type === "ObjectExpression") {
    return value.properties.every((prop) => prop.type === "ObjectProperty" && (emptyFixture(prop.value, consts, depth + 1) || (prop.value.type === "StringLiteral" && prop.value.value === "") || prop.value.type === "BooleanLiteral" || (prop.value.type === "NumericLiteral" && prop.value.value === 0)));
  }
  return false;
}

const TEST_FNS = new Set(["test", "it", "describe", "suite", "specify", "context"]);
const SKIP_KEYS = new Set(["skip", "todo"]);

function isFunction(node) {
  return Boolean(node && (node.type === "ArrowFunctionExpression" || node.type === "FunctionExpression" || node.type === "FunctionDeclaration" || node.type === "ObjectMethod" || node.type === "ClassMethod"));
}

/** true, false, or undefined when the value is not a constant. */
/** true, false, or undefined when the truthiness is not constant. `busy && false` is false; `msg || "x"` is true. */
export function staticTruth(node, consts, depth = 0) {
  const value = unwrap(node);
  if (!value || depth > 8) return undefined;
  if (value.type === "Identifier" && consts.has(value.name)) return staticTruth(consts.get(value.name), consts, depth + 1);
  if (value.type === "LogicalExpression" && (value.operator === "&&" || value.operator === "||")) {
    const left = staticTruth(value.left, consts, depth + 1);
    const right = staticTruth(value.right, consts, depth + 1);
    if (value.operator === "&&") {
      if (left === false || right === false) return false;
      if (left === true && right === true) return true;
      return undefined;
    }
    if (left === true || right === true) return true;
    if (left === false && right === false) return false;
    return undefined;
  }
  if (value.type === "ConditionalExpression") {
    const test = staticTruth(value.test, consts, depth + 1);
    if (test !== undefined) return staticTruth(test ? value.consequent : value.alternate, consts, depth + 1);
    const a = staticTruth(value.consequent, consts, depth + 1);
    const b = staticTruth(value.alternate, consts, depth + 1);
    return a !== undefined && a === b ? a : undefined;
  }
  if (value.type === "UnaryExpression" && value.operator === "!") {
    const inner = staticTruth(value.argument, consts, depth + 1);
    return inner === undefined ? undefined : !inner;
  }
  if (value.type === "ObjectExpression" || value.type === "ArrayExpression" || value.type === "ArrowFunctionExpression" || value.type === "FunctionExpression") return true;
  const known = staticValue(value, consts, depth);
  return known.known ? Boolean(known.value) : undefined;
}

/** The exact constant value, or { known: false }. */
export function staticValue(node, consts, depth = 0) {
  const value = unwrap(node);
  if (!value || depth > 8) return { known: false };
  switch (value.type) {
    case "BooleanLiteral":
    case "NumericLiteral":
    case "StringLiteral":
      return { known: true, value: value.value };
    case "NullLiteral":
      return { known: true, value: null };
    case "TemplateLiteral":
      return value.expressions.length ? { known: false } : { known: true, value: value.quasis.map((q) => q.value.cooked).join("") };
    case "Identifier":
      if (value.name === "undefined") return { known: true, value: undefined };
      if (consts.has(value.name)) return staticValue(consts.get(value.name), consts, depth + 1);
      return { known: false };
    case "UnaryExpression": {
      if (value.operator === "void") return { known: true, value: undefined };
      const inner = staticValue(value.argument, consts, depth + 1);
      if (!inner.known) return { known: false };
      if (value.operator === "!") return { known: true, value: !inner.value };
      if (value.operator === "-") return { known: true, value: -inner.value };
      if (value.operator === "+") return { known: true, value: +inner.value };
      return { known: false };
    }
    case "BinaryExpression": {
      const left = staticValue(value.left, consts, depth + 1);
      const right = staticValue(value.right, consts, depth + 1);
      if (!left.known || !right.known) return { known: false };
      const ops = { ">": (a, b) => a > b, "<": (a, b) => a < b, ">=": (a, b) => a >= b, "<=": (a, b) => a <= b, "===": (a, b) => a === b, "!==": (a, b) => a !== b, "==": (a, b) => a == b, "!=": (a, b) => a != b };
      return ops[value.operator] ? { known: true, value: ops[value.operator](left.value, right.value) } : { known: false };
    }
    case "LogicalExpression": {
      const left = staticValue(value.left, consts, depth + 1);
      const right = staticValue(value.right, consts, depth + 1);
      if (value.operator === "&&" && left.known) return left.value ? right : left;
      if (value.operator === "||" && left.known) return left.value ? left : right;
      if (value.operator === "??" && left.known) return left.value ?? right;
      return { known: false };
    }
    case "ConditionalExpression": {
      const test = staticValue(value.test, consts, depth + 1);
      if (!test.known) return { known: false };
      return staticValue(test.value ? value.consequent : value.alternate, consts, depth + 1);
    }
    default:
      return { known: false };
  }
}

function enclosingFunction(node) {
  let current = node.parent;
  while (current && !isFunction(current)) current = current.parent;
  return current || null;
}

function catchRethrows(handler) {
  let rethrows = false;
  walk(handler.body, (item) => {
    if (item.type === "ThrowStatement") rethrows = true;
    if (item.type === "CallExpression") {
      const callee = unwrap(item.callee);
      if (callee?.type === "MemberExpression" && !callee.computed && /^(?:fail|ifError)$/.test(callee.property?.name || "")) rethrows = true;
    }
  });
  return rethrows;
}

/**
 * Why this node never runs or never fails the test, up to its enclosing function, or "" when it can.
 */
function deadReason(node, consts) {
  let current = node;
  let parent = node.parent;
  while (parent && !isFunction(current)) {
    if (parent.type === "IfStatement") {
      const truth = staticTruth(parent.test, consts);
      if (parent.consequent === current && truth === false) return "it is under a constant-false if";
      if (parent.alternate === current && truth === true) return "it is in the else of a constant-true if";
    }
    if (parent.type === "ConditionalExpression") {
      const truth = staticTruth(parent.test, consts);
      if (parent.consequent === current && truth === false) return "it is in a constant-false branch";
      if (parent.alternate === current && truth === true) return "it is in a constant-false branch";
    }
    if (parent.type === "LogicalExpression" && parent.right === current) {
      const truth = staticTruth(parent.left, consts);
      if (parent.operator === "&&" && truth === false) return "it is after a constant-false &&";
      if (parent.operator === "||" && truth === true) return "it is after a constant-true ||";
    }
    if ((parent.type === "BlockStatement" || parent.type === "Program" || parent.type === "SwitchCase") && Array.isArray(parent.body || parent.consequent)) {
      const list = parent.body || parent.consequent;
      const at = list.indexOf(current);
      if (at > 0 && list.slice(0, at).some((stmt) => stmt.type === "ReturnStatement" || stmt.type === "ThrowStatement")) return "it is after a return or throw, so it never runs";
    }
    if (parent.type === "TryStatement" && parent.block === current && parent.handler && !catchRethrows(parent.handler)) return "it is in a try whose catch swallows the assertion failure";
    if (parent.type === "WhileStatement" && parent.body === current && staticTruth(parent.test, consts) === false) return "it is in a loop that never runs";
    current = parent;
    parent = parent.parent;
  }
  return "";
}

/** A then() callback whose failure a later .catch(() => {}) in the same chain swallows. */
function promiseSwallowed(fn) {
  let call = fn?.parent;
  if (call?.type !== "CallExpression") return false;
  for (let guard = 0; guard < 30 && call; guard += 1) {
    const member = call.parent;
    const next = member?.parent;
    if (!(member && (member.type === "MemberExpression" || member.type === "OptionalMemberExpression") && member.object === call && next?.type === "CallExpression" && next.callee === member)) return false;
    const name = member.property?.name;
    const handler = name === "catch" ? unwrap(next.arguments[0]) : name === "then" ? unwrap(next.arguments[1]) : null;
    if (handler && isFunction(handler) && !catchRethrows({ body: handler.body })) return true;
    call = next;
  }
  return false;
}

function testCall(node) {
  if (node.type !== "CallExpression") return null;
  const callee = unwrap(node.callee);
  let base = callee;
  let modifier = "";
  if (callee?.type === "MemberExpression" && !callee.computed) {
    modifier = callee.property?.name || "";
    base = unwrap(callee.object);
    if (modifier === "test" && base) return { modifier: "", node };
    if (!["skip", "todo", "only", "concurrent"].includes(modifier)) return null;
  }
  if (base?.type !== "Identifier" || !TEST_FNS.has(base.name) && !/^x(?:it|describe|test)$/.test(base.name)) return null;
  if (/^x/.test(base.name)) modifier = "skip";
  return { modifier, node };
}

function testSkipped(info, consts) {
  if (SKIP_KEYS.has(info.modifier)) return true;
  for (const arg of info.node.arguments) {
    const value = unwrap(arg);
    if (value?.type !== "ObjectExpression") continue;
    for (const prop of value.properties) {
      const key = prop.type === "ObjectProperty" && !prop.computed ? (prop.key.name || prop.key.value) : "";
      if (!SKIP_KEYS.has(key)) continue;
      if (staticTruth(prop.value, consts) !== false) return true;
    }
  }
  const callback = [...info.node.arguments].reverse().map(unwrap).find(isFunction);
  if (callback?.body?.type === "BlockStatement") {
    const first = callback.params[0]?.type === "Identifier" ? callback.params[0].name : "";
    for (const stmt of callback.body.body) {
      if (stmt.type !== "ExpressionStatement") continue;
      const call = unwrap(stmt.expression);
      const callee = call?.type === "CallExpression" ? unwrap(call.callee) : null;
      if (first && callee?.type === "MemberExpression" && !callee.computed && unwrap(callee.object)?.type === "Identifier" && unwrap(callee.object).name === first && SKIP_KEYS.has(callee.property?.name)) return true;
    }
  }
  return false;
}

/** The functions that run when the test file runs: unskipped test callbacks, inline callbacks they pass, and helpers they call. */
function liveFunctions(ast, consts) {
  const declared = new Map();
  walk(ast, (node) => {
    if (node.type === "FunctionDeclaration" && node.id) declared.set(node.id.name, node);
    if (node.type === "VariableDeclarator" && node.id.type === "Identifier" && isFunction(unwrap(node.init))) declared.set(node.id.name, unwrap(node.init));
  });
  const live = new Set();
  const calls = [];
  walk(ast, (node) => {
    if (node.type === "CallExpression" || node.type === "NewExpression" || node.type === "OptionalCallExpression") calls.push(node);
  });
  const livePosition = (node) => {
    const fn = enclosingFunction(node);
    return (!fn || live.has(fn)) && !deadReason(node, consts);
  };
  let changed = true;
  while (changed) {
    changed = false;
    const add = (fn) => {
      if (fn && !live.has(fn)) {
        live.add(fn);
        changed = true;
      }
    };
    for (const call of calls) {
      if (!livePosition(call)) continue;
      const info = testCall(call);
      if (info) {
        if (!testSkipped(info, consts)) for (const arg of call.arguments) if (isFunction(unwrap(arg))) add(unwrap(arg));
        continue;
      }
      for (const arg of call.arguments || []) {
        const value = unwrap(arg);
        if (isFunction(value)) add(value);
        else if (value?.type === "Identifier" && declared.has(value.name)) add(declared.get(value.name));
      }
      const callee = unwrap(call.callee);
      if (callee?.type === "Identifier" && declared.has(callee.name)) add(declared.get(callee.name));
      if (isFunction(callee)) add(callee);
    }
  }
  return { live, declared };
}

/** The pattern steps from a binding pattern down to `name`, or null. */
function patternPath(pattern, name, steps = []) {
  if (!pattern) return null;
  if (pattern.type === "Identifier") return pattern.name === name ? steps : null;
  if (pattern.type === "AssignmentPattern") return patternPath(pattern.left, name, steps);
  if (pattern.type === "ArrayPattern") {
    for (let i = 0; i < pattern.elements.length; i += 1) {
      const found = patternPath(pattern.elements[i], name, [...steps, { index: i }]);
      if (found) return found;
    }
    return null;
  }
  if (pattern.type === "ObjectPattern") {
    for (const prop of pattern.properties) {
      if (prop.type !== "ObjectProperty" || prop.computed) continue;
      const found = patternPath(prop.value, name, [...steps, { key: prop.key.name || prop.key.value }]);
      if (found) return found;
    }
  }
  return null;
}

function follow(node, steps, consts) {
  let current = unwrap(node);
  for (const step of steps) {
    if (current?.type === "Identifier" && consts.has(current.name)) current = unwrap(consts.get(current.name));
    if (step.index !== undefined) {
      if (current?.type !== "ArrayExpression") return null;
      current = unwrap(current.elements[step.index]);
    } else {
      if (current?.type !== "ObjectExpression") return null;
      const prop = current.properties.find((item) => item.type === "ObjectProperty" && !item.computed && (item.key.name || item.key.value) === step.key);
      current = prop ? unwrap(prop.value) : null;
    }
    if (!current) return null;
  }
  return current;
}

function rowsOf(node, consts) {
  let value = unwrap(node);
  if (value?.type === "Identifier" && consts.has(value.name)) value = unwrap(consts.get(value.name));
  return value?.type === "ArrayExpression" && value.elements.length && value.elements.every((item) => item && item.type !== "SpreadElement") ? value.elements : null;
}

export function strongAssertions(source, testRel, featureRels) {
  let ast;
  try {
    ast = parseSource(source, /\.(?:tsx|jsx)$/.test(testRel) ? testRel : `${testRel}.tsx`.replace(/\.(?:[cm]?[jt]s)\.tsx$/, ".tsx"));
  } catch {
    try {
      ast = parseSource(source, "test.ts");
    } catch (error) {
      return { ok: false, imported: false, reason: `the test did not parse (${error instanceof Error ? error.message : String(error)})` };
    }
  }
  setParents(ast);
  const bindings = new Set();
  const namespaces = new Set();
  const consts = new Map();
  walk(ast, (node) => {
    if (node.type === "ImportDeclaration" && featureRels.some((rel) => resolves(node.source.value, testRel, rel))) {
      for (const spec of node.specifiers) {
        if (spec.type === "ImportNamespaceSpecifier") namespaces.add(spec.local.name);
        else bindings.add(spec.local.name);
      }
    }
    if (node.type === "VariableDeclarator" && node.init) {
      let init = unwrap(node.init);
      if (init.type === "AwaitExpression") init = unwrap(init.argument);
      const spec = (init.type === "CallExpression" && init.callee.type === "Identifier" && init.callee.name === "require" && init.arguments[0]?.type === "StringLiteral") ? init.arguments[0].value
        : (init.type === "ImportExpression" && init.source?.type === "StringLiteral") ? init.source.value
          : (init.type === "CallExpression" && init.callee.type === "Import" && init.arguments[0]?.type === "StringLiteral") ? init.arguments[0].value : "";
      if (spec && featureRels.some((rel) => resolves(spec, testRel, rel))) {
        if (node.id.type === "Identifier") namespaces.add(node.id.name);
        else for (const name of patternNames(node.id)) bindings.add(name);
      }
      if (node.id.type === "Identifier" && node.parent?.kind === "const") consts.set(node.id.name, node.init);
    }
  });
  if (!bindings.size && !namespaces.size) return { ok: false, imported: false, reason: "no test imports the changed module" };
  const { live, declared: declaredFns } = liveFunctions(ast, consts);
  const callersOf = new Map();
  walk(ast, (node) => {
    if (node.type !== "CallExpression") return;
    const callee = unwrap(node.callee);
    if (callee?.type === "Identifier" && declaredFns.has(callee.name)) {
      const fn = declaredFns.get(callee.name);
      if (!callersOf.has(fn)) callersOf.set(fn, []);
      callersOf.get(fn).push(node);
    }
  });
  /**
   * The values a loop variable or a helper parameter takes: each row of a constant table it iterates,
   * or the argument at that position in every call of the helper. null when that is not known.
   */
  const alternativesOf = (identifier) => {
    const name = identifier.name;
    let scope = identifier.parent;
    while (scope) {
      if ((scope.type === "ForOfStatement") && scope.left.type === "VariableDeclaration") {
        const steps = patternPath(scope.left.declarations[0]?.id, name);
        if (steps) {
          const rows = rowsOf(scope.right, consts);
          if (!rows) return [];
          return rows.map((row) => follow(row, steps, consts));
        }
      }
      if (isFunction(scope)) {
        for (let position = 0; position < scope.params.length; position += 1) {
          const steps = patternPath(scope.params[position], name);
          if (!steps) continue;
          const parent = scope.parent;
          const callee = parent && parent.type === "CallExpression" ? unwrap(parent.callee) : null;
          if (callee?.type === "MemberExpression" && !callee.computed && ["forEach", "map", "every", "some"].includes(callee.property?.name) && parent.arguments[0] === scope && position === 0) {
            const rows = rowsOf(callee.object, consts);
            return rows ? rows.map((row) => follow(row, steps, consts)) : [];
          }
          const callers = (callersOf.get(scope) || []).filter((call) => live.has(enclosingFunction(call)) || !enclosingFunction(call));
          if (!callers.length) return [];
          return callers.map((call) => (call.arguments[position] ? follow(call.arguments[position], steps, consts) : null));
        }
      }
      scope = scope.parent;
    }
    return null;
  };
  const featureCall = (node) => {
    if (node.type !== "CallExpression" && node.type !== "NewExpression" && node.type !== "OptionalCallExpression") return false;
    const callee = unwrap(node.callee);
    if (callee.type === "Identifier") return bindings.has(callee.name);
    if ((callee.type === "MemberExpression" || callee.type === "OptionalMemberExpression") && unwrap(callee.object).type === "Identifier") return namespaces.has(unwrap(callee.object).name);
    return false;
  };
  const derived = new Map();
  const callsIn = (node) => {
    const calls = [];
    let used = false;
    walk(node, (item) => {
      if (featureCall(item)) calls.push(item);
      if (item.type === "Identifier" && derived.has(item.name)) {
        const parent = item.parent;
        if (parent && (parent.type === "MemberExpression" || parent.type === "OptionalMemberExpression") && parent.property === item && !parent.computed) return;
        used = true;
        calls.push(...derived.get(item.name));
      }
    });
    return { calls, derived: calls.length > 0 || used };
  };
  const declared = new Map();
  walk(ast, (node) => {
    if (node.type === "VariableDeclarator") for (const name of patternNames(node.id)) declared.set(name, node.init || null);
  });
  /** A local mock passed to the feature (not a plain literal object) holds what the feature did to it. */
  const mockArgument = (arg) => {
    const value = unwrap(arg);
    if (value?.type !== "Identifier" || !declared.has(value.name)) return false;
    const init = declared.get(value.name);
    return !init || !literalValue(init, consts).literal;
  };
  walk(ast, (node) => {
    if (!featureCall(node)) return;
    for (const arg of node.arguments) {
      if (mockArgument(arg)) derived.set(unwrap(arg).name, [...(derived.get(unwrap(arg).name) || []), node]);
      const fn = unwrap(arg);
      if (fn && (fn.type === "ArrowFunctionExpression" || fn.type === "FunctionExpression")) {
        walk(fn.body, (item) => {
          if (item.type === "AssignmentExpression" && item.left.type === "Identifier") derived.set(item.left.name, [...(derived.get(item.left.name) || []), node]);
        });
      }
    }
  });
  for (let pass = 0; pass < 3; pass += 1) {
    walk(ast, (node) => {
      if (node.type === "VariableDeclarator" && node.init) {
        const info = callsIn(node.init);
        if (info.derived) for (const name of patternNames(node.id)) derived.set(name, info.calls);
      }
      if (node.type === "AssignmentExpression" && node.left.type === "Identifier") {
        const info = callsIn(node.right);
        if (info.derived) derived.set(node.left.name, info.calls);
      }
    });
  }
  consts.alternatives = alternativesOf;
  const reasons = new Set();
  let strong = 0;
  const notDerived = (node) => !callsIn(node).derived;
  walk(ast, (node) => {
    if (node.type !== "CallExpression") return;
    const callee = unwrap(node.callee);
    let actual;
    let expected;
    let method = "";
    if (callee.type === "MemberExpression" && !callee.computed) {
      method = callee.property.name;
      const object = unwrap(callee.object);
      const isAssert = (object.type === "Identifier" && /^assert$/i.test(object.name)) || (object.type === "MemberExpression" && !object.computed && object.property.name === "assert") || (object.type === "MemberExpression" && !object.computed && object.property.name === "strict");
      if (isAssert && EQUAL.has(method)) {
        actual = node.arguments[0];
        expected = node.arguments[1];
      } else if (EXPECT.has(method)) {
        let base = object;
        if (base.type === "MemberExpression" && !base.computed && base.property.name === "not") return;
        if (base.type === "CallExpression" && unwrap(base.callee).type === "Identifier" && unwrap(base.callee).name === "expect") {
          actual = base.arguments[0];
          expected = node.arguments[0];
        }
      }
    }
    if (!actual || !expected) return;
    const holder = enclosingFunction(node);
    if (holder && !live.has(holder)) {
      reasons.add("the assertion is in a skipped or todo test, or in a helper no running test calls");
      return;
    }
    let swallowedBy = holder;
    while (swallowedBy && !promiseSwallowed(swallowedBy)) {
      const outer = enclosingFunction(swallowedBy);
      if (!outer || testCall(swallowedBy.parent || {}) ) break;
      swallowedBy = outer;
    }
    if (swallowedBy && promiseSwallowed(swallowedBy)) {
      reasons.add("the assertion does not run or cannot fail: a later .catch() in its promise chain swallows the failure");
      return;
    }
    const dead = deadReason(node, consts);
    if (dead) {
      reasons.add(`the assertion does not run or cannot fail: ${dead}`);
      return;
    }
    let fallback = "";
    let stringified = false;
    walk(actual, (item) => {
      if (isFunction(item)) return;
      if (item.type === "LogicalExpression" && (item.operator === "??" || item.operator === "||") && notDerived(item.right)) fallback = `a ${item.operator} fallback`;
      if (item.type === "ConditionalExpression" && (notDerived(item.consequent) || notDerived(item.alternate))) fallback = "a ternary branch that is not the feature's value";
      if (item.type === "CallExpression") {
        const target = unwrap(item.callee);
        const whole = unwrap(item.arguments[0]);
        if (target?.type === "Identifier" && target.name === "String" && whole && (featureCall(whole) || (whole.type === "Identifier" && derived.has(whole.name)))) stringified = true;
        if (target?.type === "MemberExpression" && !target.computed && target.property?.name === "toString" && (featureCall(unwrap(target.object)) || (unwrap(target.object)?.type === "Identifier" && derived.has(unwrap(target.object).name)))) stringified = true;
      }
      if (item.type === "TemplateLiteral" && item.expressions.some((expr) => featureCall(unwrap(expr)) || (unwrap(expr)?.type === "Identifier" && derived.has(unwrap(expr).name)))) stringified = true;
    });
    if (fallback) {
      reasons.add(`the asserted value goes through ${fallback}, which can supply the expected value without the feature`);
      return;
    }
    if (stringified) {
      reasons.add("String() of the feature's whole result is \"[object Object]\" for any object, so it does not check the value");
      return;
    }
    const actualInfo = callsIn(actual);
    if (!actualInfo.derived) {
      reasons.add("the asserted value is not produced by the changed module");
      return;
    }
    let shape = false;
    walk(actual, (item) => {
      if (item.type === "UnaryExpression" && item.operator === "typeof") shape = true;
      if (item.type === "BinaryExpression" && item.operator === "instanceof") shape = true;
      if (item.type === "MemberExpression" && !item.computed && item.property.name === "length" && item === unwrap(actual)) shape = true;
      if (item.type === "CallExpression") {
        const target = unwrap(item.callee);
        if (target.type === "MemberExpression" && !target.computed && SHAPE.has(target.property.name) && unwrap(target.object).type === "Identifier" && ["Object", "Array", "Reflect"].includes(unwrap(target.object).name)) shape = true;
      }
    });
    if (shape) {
      reasons.add("typeof, instanceof, Array.isArray, Object.keys, and .length only check the shape");
      return;
    }
    if (callsIn(expected).derived) {
      reasons.add("the expected value is computed by the feature itself");
      return;
    }
    const value = literalValue(expected, consts);
    if (!value.literal) {
      reasons.add("the expected value is not a literal the test states");
      return;
    }
    if (value.trivial) {
      reasons.add("null, undefined, true, false, 0, empty strings, [] and {} are not a feature value");
      return;
    }
    const calls = actualInfo.calls;
    if (calls.length && calls.every((call) => call.arguments.length > 0 && call.arguments.every((arg) => emptyFixture(arg, consts)))) {
      reasons.add("every feature call gets a null or empty fixture, so only the missing-host path runs");
      return;
    }
    strong += 1;
  });
  if (strong) return { ok: true, imported: true, strong };
  return { ok: false, imported: true, reason: reasons.size ? [...reasons].join("; ") : "no equal, deepEqual, match, or expect(...).toBe/toEqual assertion" };
}
