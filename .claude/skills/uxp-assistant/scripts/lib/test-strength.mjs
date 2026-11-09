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
    case "Identifier":
      if (value.name === "undefined") return { literal: true, trivial: true };
      if (consts.has(value.name)) return literalValue(consts.get(value.name), consts, depth + 1);
      return { literal: false };
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
    return false;
  }
  if (value.type === "ArrayExpression") return value.elements.every((item) => !item || emptyFixture(item, consts, depth + 1));
  if (value.type === "ObjectExpression") {
    return value.properties.every((prop) => prop.type === "ObjectProperty" && (emptyFixture(prop.value, consts, depth + 1) || (prop.value.type === "StringLiteral" && prop.value.value === "") || prop.value.type === "BooleanLiteral" || (prop.value.type === "NumericLiteral" && prop.value.value === 0)));
  }
  return false;
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
  const reasons = new Set();
  let strong = 0;
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
