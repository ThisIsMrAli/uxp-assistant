import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { skillRoot } from "./paths.mjs";

/**
 * Host calls and modal writes are resolved from a parse, not from a syntax blocklist.
 * A host-rooted access that does not resolve to a documented member is a miss or a review.
 * It is never a silent pass. The parser is the one create-bolt-uxp already installs
 * (@babel/parser, via bolt-uxp). This file does not vendor it.
 */

const HOST_MODULES = new Set(["photoshop", "premierepro", "uxp"]);
const LANGUAGE = new Set(["console", "JSON", "Math", "Object", "Promise", "Array", "Date", "Number", "String", "Boolean", "document", "window", "globalThis", "process", "Buffer", "fs", "path", "crypto", "assert", "React", "Reflect", "undefined", "NaN", "Infinity", "Symbol", "Error", "TypeError", "Map", "Set", "WeakMap", "WeakSet", "parseInt", "parseFloat", "isNaN", "isFinite", "queueMicrotask", "setTimeout", "setInterval", "clearTimeout", "clearInterval", "requestAnimationFrame"]);
const CALL_SKIP = new Set(["map", "filter", "forEach", "reduce", "find", "findIndex", "some", "every", "flat", "flatMap", "push", "pop", "shift", "unshift", "slice", "splice", "join", "split", "trim", "replace", "replaceAll", "match", "matchAll", "test", "exec", "then", "catch", "finally", "resolve", "reject", "all", "race", "any", "allSettled", "keys", "values", "entries", "assign", "create", "freeze", "log", "warn", "error", "info", "debug", "stringify", "parse", "now", "toString", "valueOf", "includes", "indexOf", "startsWith", "endsWith", "padStart", "padEnd", "toLowerCase", "toUpperCase", "toFixed", "substring", "charAt", "repeat", "at", "sort", "reverse", "concat", "from", "of", "get", "set", "has", "add", "delete", "clear", "querySelector", "querySelectorAll", "addEventListener", "removeEventListener", "preventDefault", "stopPropagation", "focus", "blur", "click", "setAttribute", "getAttribute", "appendChild", "removeChild", "closest", "contains"]);
const RENAME_OUTSIDE = "A layer rename writes .name, ['name'], Reflect.set, Object.defineProperty, or Object.assign of name, outside executeAsModal. An alias, an index, or a local function named executeAsModal does not count. A helper is accepted only when every call is inside the host modal. The fetched modal page requires the host wrapper.";
const RENAME_DYNAMIC = "A non-literal write on a host value needs review and is not an executeAsModal rename. The property is not a resolved name.";

let parserModule;

function loadParser() {
  if (parserModule) return parserModule;
  const require = createRequire(import.meta.url);
  const candidates = [];
  const beside = path.join(path.resolve(skillRoot), "..", ".uxp-tooling", "node_modules", "@babel", "parser");
  candidates.push(beside);
  let dir = path.resolve(skillRoot);
  for (let i = 0; i < 8; i += 1) {
    candidates.push(path.join(dir, "node_modules", "@babel", "parser"));
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  try {
    parserModule = require("@babel/parser");
    return parserModule;
  } catch {
    // The copied skill resolves it from the tooling prefix or a parent install.
  }
  for (const candidate of candidates) {
    try {
      parserModule = require(candidate);
      return parserModule;
    } catch {
      // try the next place the installer or the repo puts it
    }
  }
  throw new Error("The host checker needs @babel/parser, which create-bolt-uxp installs with bolt-uxp. It was not found beside the skill or in a parent node_modules.");
}

function parseSource(text, filename) {
  const parser = loadParser();
  const lower = String(filename || "").toLowerCase();
  const jsx = lower.endsWith(".tsx") || lower.endsWith(".jsx") || !lower || !/\.(?:ts|mts|cts|js|mjs|cjs)$/.test(lower);
  const options = {
    sourceType: "module",
    plugins: ["typescript", ...(jsx ? ["jsx"] : [])],
    errorRecovery: true
  };
  try {
    return parser.parse(String(text || ""), options);
  } catch (error) {
    if (!/Adjacent JSX/.test(error instanceof Error ? error.message : "")) throw error;
    const wrapped = String(text || "").replace(/return\s+(<[\s\S]*?);/g, (full, jsxText) => {
      const opens = jsxText.match(/<(?!\/)[A-Za-z]/g) || [];
      if (opens.length < 2) return full;
      return `return (<>${jsxText}</>);`;
    });
    if (wrapped === text) throw error;
    return parser.parse(wrapped, options);
  }
}

function setParents(node, parent = null) {
  if (!node || typeof node !== "object" || !node.type) return;
  node.parent = parent;
  for (const key of Object.keys(node)) {
    if (key === "parent" || key === "loc" || key === "range" || key === "leadingComments" || key === "trailingComments" || key === "innerComments") continue;
    const value = node[key];
    if (Array.isArray(value)) {
      for (const child of value) if (child && child.type) setParents(child, node);
    } else if (value && value.type) setParents(value, node);
  }
}

function decodeDoc(text) {
  return String(text || "")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, num) => String.fromCodePoint(Number(num)))
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&");
}

function methodReturns(docs) {
  const map = new Map();
  for (const match of docs.matchAll(/Returns:\s*(?:Promise\s*<\s*([A-Za-z_][\w]*)|([A-Za-z_][\w]*))/g)) {
    const type = match[1] || match[2];
    const before = docs.slice(Math.max(0, match.index - 240), match.index);
    const names = [...before.matchAll(/\b([a-z][A-Za-z0-9]*)\b/g)];
    const method = names.at(-1)?.[1];
    if (method && type && type !== "Promise") map.set(method, type);
  }
  return map;
}

function methodNearType(docs, method, type) {
  const lower = docs.toLowerCase();
  const name = method.toLowerCase();
  let from = 0;
  while (from < lower.length) {
    const at = lower.indexOf(name, from);
    if (at < 0) return false;
    const window = docs.slice(Math.max(0, at - 1200), at);
    if (window.includes(type)) return true;
    from = at + name.length;
  }
  return false;
}

function documented(docs, method) {
  return new RegExp(`\\b${method.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(docs);
}

const PLAIN = { kind: "plain", label: "", method: "" };
const UNKNOWN = { kind: "unknown", label: "", method: "" };

function isFunctionNode(node) {
  return node && (node.type === "FunctionDeclaration" || node.type === "FunctionExpression" || node.type === "ArrowFunctionExpression" || node.type === "ObjectMethod" || node.type === "ClassMethod");
}

function isTypeOnly(node) {
  return Boolean(node && (node.importKind === "type" || node.exportKind === "type" || node.isTypeOnly));
}

function literalString(node) {
  if (!node) return null;
  if (node.type === "StringLiteral") return node.value;
  if (node.type === "NumericLiteral") return null;
  if (node.type === "TemplateLiteral" && node.expressions.length === 0) return node.quasis.map((item) => item.value.cooked ?? item.value.raw).join("");
  if (node.type === "BinaryExpression" && node.operator === "+") {
    const left = literalString(node.left);
    const right = literalString(node.right);
    if (typeof left === "string" && typeof right === "string") return left + right;
  }
  if (node.type === "ParenthesizedExpression" || node.type === "TSAsExpression" || node.type === "TSTypeAssertion" || node.type === "TSSatisfiesExpression" || node.type === "TSNonNullExpression") return literalString(node.expression);
  return null;
}

function keyOf(node) {
  if (!node) return { literal: false };
  if (!node.computed && node.property && node.property.type === "Identifier") return { literal: true, name: node.property.name };
  const value = literalString(node.property || node);
  if (typeof value === "string") return { literal: true, name: value };
  if (node.computed && node.property && node.property.type === "NumericLiteral") return { literal: true, index: true, name: String(node.property.value) };
  return { literal: false };
}

function unwrap(node) {
  let current = node;
  while (current && (current.type === "ParenthesizedExpression" || current.type === "TSAsExpression" || current.type === "TSTypeAssertion" || current.type === "TSSatisfiesExpression" || current.type === "TSNonNullExpression")) {
    current = current.expression;
  }
  return current;
}

function isAnyType(annotation) {
  if (!annotation) return false;
  const type = annotation.typeAnnotation || annotation;
  return type.type === "TSAnyKeyword";
}

function awaited(node) {
  let parent = node?.parent;
  while (parent && (parent.type === "ParenthesizedExpression" || parent.type === "TSAsExpression" || parent.type === "TSTypeAssertion" || parent.type === "TSSatisfiesExpression" || parent.type === "TSNonNullExpression" || parent.type === "ChainExpression")) {
    parent = parent.parent;
  }
  if (!parent) return false;
  if (parent.type === "AwaitExpression") return true;
  if (parent.type === "ReturnStatement") return true;
  if (parent.type === "ArrowFunctionExpression" && parent.body === node) return true;
  return false;
}

function childNodes(node) {
  const out = [];
  for (const key of Object.keys(node)) {
    if (key === "parent" || key === "loc" || key === "range" || key === "leadingComments" || key === "trailingComments" || key === "innerComments") continue;
    const value = node[key];
    if (Array.isArray(value)) {
      for (const child of value) if (child && child.type) out.push(child);
    } else if (value && value.type) out.push(value);
  }
  return out;
}

function hostRoot(name) {
  return { kind: "host", label: name, method: "", fromMethod: "" };
}

function copyValue(value) {
  return value ? { ...value } : UNKNOWN;
}

/**
 * Parse one file and the modules it can resolve.
 * `record` collects call and write findings. A dependency load only returns exports.
 */
export function analyzeSource(text, filename, options = {}) {
  const docs = decodeDoc(options.docs || "");
  const returns = methodReturns(docs);
  const project = options.project || "";
  const memory = options.memory || new Map();
  const cache = options.cache || new Map();
  const loading = options.loading || new Set();
  const rel = String(filename || "src/file.ts").split(path.sep).join("/");
  const ast = parseSource(text, rel);
  setParents(ast);
  const findings = [];
  const writes = [];
  const functions = new Map();
  const fnIds = new WeakMap();
  const seeds = new Set();
  const callSites = [];
  const scopes = [new Map()];
  const fnStack = [];
  const exports = new Map();
  let seq = 0;

  const look = (name) => {
    for (let i = scopes.length - 1; i >= 0; i -= 1) {
      if (scopes[i].has(name)) return scopes[i].get(name);
    }
    return null;
  };
  const bind = (name, value) => {
    if (!name) return;
    scopes[scopes.length - 1].set(name, copyValue(value));
  };

  const readFile = (spec, fromRel) => {
    const from = path.posix.dirname(fromRel || "src/file.ts");
    const base = path.posix.normalize(path.posix.join(from, spec));
    const suffixes = ["", ".ts", ".tsx", ".mts", ".mjs", ".js", ".jsx", ".cjs", "/index.ts", "/index.tsx", "/index.js"];
    for (const suffix of suffixes) {
      const next = `${base}${suffix}`;
      if (memory.has(next)) return { rel: next, text: memory.get(next) };
      if (!project) continue;
      const full = path.resolve(project, next);
      const root = path.resolve(project);
      if (full !== root && !full.startsWith(`${root}${path.sep}`)) continue;
      try {
        return { rel: next, text: fs.readFileSync(full, "utf8") };
      } catch {
        // try the next suffix
      }
    }
    return null;
  };

  const moduleExports = (spec, fromRel) => {
    const rootName = String(spec || "").split("/")[0];
    if (HOST_MODULES.has(rootName)) return { host: rootName };
    if (!spec.startsWith(".")) return { external: true };
    const found = readFile(spec, fromRel);
    if (!found) return { missing: true };
    if (/\.(?:css|scss|sass|less|json|svg|png|gif|webp|md)$/i.test(found.rel)) return { external: true };
    if (cache.has(found.rel)) return { exports: cache.get(found.rel) };
    if (loading.has(found.rel)) return { exports: new Map() };
    loading.add(found.rel);
    let nested;
    try {
      nested = analyzeSource(found.text, found.rel, { docs, project, memory, cache, loading, record: false });
    } catch {
      loading.delete(found.rel);
      return { missing: true };
    }
    cache.set(found.rel, nested.exports);
    loading.delete(found.rel);
    return { exports: nested.exports };
  };

  const access = (object, name) => {
    if (!object || object.kind === "skip" || object.kind === "plain" || object.kind === "unknown" || object.kind === "fn") return object?.kind === "skip" ? object : UNKNOWN;
    if (object.kind === "dynamic") return { kind: "dynamic", label: `${object.label}.${name}`, method: "" };
    return { kind: object.kind, label: object.label ? `${object.label}.${name}` : name, method: name, fromMethod: object.fromMethod || "" };
  };

  const noteCall = (value) => {
    const returned = value?.kind === "host" || value?.kind === "maybe"
      ? { kind: "maybe", label: value.label, method: "", fromMethod: value.method || "" }
      : UNKNOWN;
    if (!options.record) return returned;
    if (!value || value.kind === "skip" || value.kind === "plain" || value.kind === "unknown" || value.kind === "fn") return UNKNOWN;
    if (value.kind === "dynamic") {
      findings.push({ kind: "call", text: `${value.label || "host value"} needs review` });
      return { kind: "dynamic", label: value.label, method: "" };
    }
    const method = value.method || "";
    if (!method) {
      if (value.kind === "host") findings.push({ kind: "call", text: `${value.label || "host value"}() needs review` });
      return returned;
    }
    if (CALL_SKIP.has(method)) return { kind: "maybe", label: value.label, method: "", fromMethod: value.fromMethod || "" };
    const label = `${value.label}()`;
    if (!documented(docs, method)) findings.push({ kind: "call", text: label });
    else if (value.fromMethod) {
      const type = returns.get(value.fromMethod);
      if (type && !methodNearType(docs, method, type)) findings.push({ kind: "call", text: `${label} is not a ${type} method in the fetched docs` });
    }
    return { kind: "maybe", label: value.label, method: "", fromMethod: method };
  };

  const enterFunction = (node) => {
    if (node._walked) return fnIds.get(node);
    let id = fnIds.get(node);
    if (!id) {
      id = ++seq;
      fnIds.set(node, id);
      functions.set(id, { async: Boolean(node.async) });
    }
    node._walked = true;
    node._done = true;
    scopes.push(new Map());
    for (const param of node.params || []) bindPattern(param, (name) => ({ kind: "maybe", label: name, method: "" }));
    if (node.body?.type === "BlockStatement") hoist(node.body.body);
    fnStack.push(id);
    if (node.body) walkNode(node.body);
    fnStack.pop();
    scopes.pop();
    return id;
  };

  const bindPattern = (pattern, valueFor) => {
    if (!pattern) return;
    if (pattern.type === "Identifier") {
      bind(pattern.name, typeof valueFor === "function" ? valueFor(pattern.name) : valueFor);
      return;
    }
    if (pattern.type === "AssignmentPattern") {
      bindPattern(pattern.left, valueFor);
      return;
    }
    if (pattern.type === "RestElement") {
      bindPattern(pattern.argument, { kind: "dynamic", label: "rest", method: "" });
      return;
    }
    if (pattern.type === "ArrayPattern") {
      for (const element of pattern.elements) if (element) bindPattern(element, valueFor);
      return;
    }
    if (pattern.type === "ObjectPattern") {
      for (const prop of pattern.properties) {
        if (prop.type === "RestElement") {
          const source = typeof valueFor === "function" ? null : valueFor;
          const dynamic = source && (source.kind === "host" || source.kind === "maybe" || source.kind === "dynamic");
          bindPattern(prop.argument, dynamic ? { kind: "dynamic", label: `${source.label} rest`, method: "" } : UNKNOWN);
          continue;
        }
        const key = prop.computed ? literalString(prop.key) : (prop.key?.name || literalString(prop.key));
        const source = typeof valueFor === "function" ? null : valueFor;
        const next = key && source ? access(source, key) : (typeof valueFor === "function" ? valueFor(prop.value?.name || key || "") : UNKNOWN);
        if (prop.value && prop.value.type !== "Identifier") bindPattern(prop.value, next);
        else if (prop.value?.type === "Identifier") bind(prop.value.name, next);
      }
    }
  };

  const rememberWrite = (target, key) => {
    if (!options.record || !target) return;
    if (target.kind !== "host" && target.kind !== "maybe" && target.kind !== "dynamic") return;
    writes.push({
      target,
      key,
      fn: fnStack.at(-1) || null
    });
  };

  const memberWrite = (member) => {
    const object = evalExpr(member.object);
    const key = keyOf(member);
    rememberWrite(object, key);
  };

  const patternWrite = (pattern) => {
    if (!pattern) return;
    if (pattern.type === "MemberExpression" || pattern.type === "OptionalMemberExpression") {
      memberWrite(pattern);
      return;
    }
    if (pattern.type === "ArrayPattern") {
      for (const element of pattern.elements) if (element) patternWrite(element.type === "AssignmentPattern" ? element.left : element);
      return;
    }
    if (pattern.type === "ObjectPattern") {
      for (const prop of pattern.properties) {
        if (!prop) continue;
        if (prop.type === "RestElement") patternWrite(prop.argument);
        else patternWrite(prop.value);
      }
    }
  };

  const assignName = (source) => {
    if (!source || source.type !== "ObjectExpression") return false;
    return source.properties.some((prop) => {
      if (!prop || prop.type !== "ObjectProperty") return false;
      const name = prop.computed ? literalString(prop.key) : (prop.key?.name || literalString(prop.key));
      return name === "name";
    });
  };

  const evalCall = (node) => {
    const args = node.arguments || [];
    const callee = unwrap(node.callee);
    if (callee?.type === "Identifier" && callee.name === "require") {
      const spec = literalString(args[0]);
      const rootName = String(spec || "").split("/")[0];
      if (HOST_MODULES.has(rootName)) return hostRoot(rootName);
      return UNKNOWN;
    }
    if (callee?.type === "Import") {
      const spec = literalString(args[0]);
      const rootName = String(spec || "").split("/")[0];
      if (HOST_MODULES.has(rootName)) return hostRoot(rootName);
      return UNKNOWN;
    }
    if ((callee?.type === "MemberExpression" || callee?.type === "OptionalMemberExpression") && !callee.computed && callee.property?.type === "Identifier") {
      const name = callee.property.name;
      if (name === "bind" || name === "call" || name === "apply") {
        const fn = evalExpr(callee.object);
        for (const arg of args) evalExpr(arg);
        if (fn && (fn.kind === "host" || fn.kind === "maybe" || fn.kind === "dynamic")) {
          if (name === "bind") {
            noteCall(fn);
            return fn;
          }
          return noteCall(fn);
        }
      }
      if ((callee.object.type === "Identifier" && callee.object.name === "Reflect") || (look("Reflect")?.kind === "skip" && false)) {
        if (name === "apply") {
          const fn = evalExpr(args[0]);
          for (const arg of args.slice(1)) evalExpr(arg);
          return noteCall(fn);
        }
        if (name === "get") {
          const object = evalExpr(args[0]);
          const key = literalString(args[1]);
          for (const arg of args.slice(2)) evalExpr(arg);
          if (typeof key === "string") return access(object, key);
          if (object && (object.kind === "host" || object.kind === "maybe" || object.kind === "dynamic")) return { kind: "dynamic", label: `${object.label}[dynamic]`, method: "" };
          return UNKNOWN;
        }
        if (name === "set") {
          const object = evalExpr(args[0]);
          const key = literalString(args[1]);
          for (const arg of args.slice(2)) evalExpr(arg);
          rememberWrite(object, typeof key === "string" ? { literal: true, name: key } : { literal: false });
          return UNKNOWN;
        }
      }
      if (callee.object.type === "Identifier" && callee.object.name === "Object" && (name === "assign" || name === "defineProperty")) {
        const object = evalExpr(args[0]);
        if (name === "defineProperty") {
          const key = literalString(args[1]);
          for (const arg of args.slice(2)) evalExpr(arg);
          rememberWrite(object, typeof key === "string" ? { literal: true, name: key } : { literal: false });
        } else {
          for (const arg of args.slice(1)) {
            evalExpr(arg);
            if (assignName(unwrap(arg))) rememberWrite(object, { literal: true, name: "name" });
          }
        }
        return UNKNOWN;
      }
    }
    const fn = evalExpr(node.callee);
    const evaluated = [];
    for (const arg of args) evaluated.push(evalExpr(arg));
    if (fn?.kind === "fn") {
      const info = functions.get(fn.id);
      callSites.push({
        calleeId: fn.id,
        inside: fnStack.at(-1) || null,
        confers: !info?.async || awaited(node)
      });
    }
    if (fn && (fn.kind === "host" || fn.kind === "maybe" || fn.kind === "dynamic") && fn.method === "executeAsModal") {
      const callback = unwrap(args[0]);
      const callbackId = callback && fnIds.get(callback);
      if (callbackId) seeds.add(callbackId);
      else if (evaluated[0]?.kind === "fn") seeds.add(evaluated[0].id);
    }
    if (fn?.kind === "fn") return UNKNOWN;
    return noteCall(fn);
  };

  const evalExpr = (node) => {
    if (!node) return UNKNOWN;
    if (node._value) return node._value;
    node._done = true;
    const value = evalRaw(node);
    node._value = value || UNKNOWN;
    return node._value;
  };

  const evalRaw = (node) => {
    const current = unwrap(node);
    if (!current) return UNKNOWN;
    if (current !== node && current._value) return current._value;
    switch (current.type) {
      case "Identifier": {
        const found = look(current.name);
        if (found) return copyValue(found);
        if (LANGUAGE.has(current.name)) return { kind: "skip", label: current.name, method: "" };
        return UNKNOWN;
      }
      case "ThisExpression":
      case "Super":
        return UNKNOWN;
      case "StringLiteral":
      case "NumericLiteral":
      case "BooleanLiteral":
      case "NullLiteral":
      case "BigIntLiteral":
      case "TemplateLiteral":
      case "RegExpLiteral":
        return PLAIN;
      case "ObjectExpression":
      case "ArrayExpression":
        for (const child of childNodes(current)) evalExpr(child);
        return PLAIN;
      case "FunctionExpression":
      case "ArrowFunctionExpression":
      case "FunctionDeclaration":
      case "ObjectMethod":
      case "ClassMethod": {
        const id = enterFunction(current);
        return { kind: "fn", id, label: current.id?.name || "" };
      }
      case "MemberExpression":
      case "OptionalMemberExpression": {
        const object = evalExpr(current.object);
        const key = keyOf(current);
        if (key.index) return object && (object.kind === "host" || object.kind === "maybe") ? { ...object, method: "" } : object || UNKNOWN;
        if (key.literal && key.name) return access(object, key.name);
        if (object && (object.kind === "host" || object.kind === "maybe" || object.kind === "dynamic")) return { kind: "dynamic", label: `${object.label}[dynamic]`, method: "" };
        return UNKNOWN;
      }
      case "CallExpression":
      case "OptionalCallExpression":
      case "NewExpression":
        return evalCall(current);
      case "AwaitExpression":
      case "YieldExpression":
      case "UnaryExpression":
        return evalExpr(current.argument);
      case "UpdateExpression":
        return evalExpr(current.argument);
      case "ConditionalExpression":
        evalExpr(current.test);
        return mergeValues(evalExpr(current.consequent), evalExpr(current.alternate));
      case "LogicalExpression":
        return mergeValues(evalExpr(current.left), evalExpr(current.right));
      case "SequenceExpression": {
        let last = UNKNOWN;
        for (const item of current.expressions) last = evalExpr(item);
        return last;
      }
      case "AssignmentExpression": {
        if (current.operator === "=" && (current.left.type === "ArrayPattern" || current.left.type === "ObjectPattern")) {
          patternWrite(current.left);
          return evalExpr(current.right);
        }
        if (current.operator === "=" && current.left.type === "Identifier") {
          const value = evalExpr(current.right);
          const found = look(current.left.name);
          if (found && scopes.some((scope) => scope.has(current.left.name))) {
            for (let i = scopes.length - 1; i >= 0; i -= 1) {
              if (scopes[i].has(current.left.name)) {
                scopes[i].set(current.left.name, copyValue(value));
                break;
              }
            }
          }
          return value;
        }
        if (current.left.type === "MemberExpression" || current.left.type === "OptionalMemberExpression") {
          memberWrite(current.left);
          evalExpr(current.right);
          return UNKNOWN;
        }
        evalExpr(current.left);
        evalExpr(current.right);
        return UNKNOWN;
      }
      case "BinaryExpression":
        evalExpr(current.left);
        evalExpr(current.right);
        return UNKNOWN;
      case "TSAsExpression":
      case "TSTypeAssertion":
      case "TSSatisfiesExpression":
      case "TSNonNullExpression":
      case "ParenthesizedExpression":
        return evalExpr(current.expression);
      default:
        for (const child of childNodes(current)) {
          if (isFunctionNode(child) || child.type === "CallExpression" || child.type === "OptionalCallExpression" || child.type === "AssignmentExpression") evalExpr(child);
          else walkNode(child);
        }
        return UNKNOWN;
    }
  };

  const walkNode = (node) => {
    if (!node || node._done) return;
    if (node.type === "VariableDeclaration") {
      node._done = true;
      for (const declarator of node.declarations) {
        const init = declarator.init ? evalExpr(declarator.init) : (isAnyType(declarator.id.typeAnnotation) ? PLAIN : UNKNOWN);
        bindPattern(declarator.id, declarator.init ? init : (isAnyType(declarator.id.typeAnnotation) ? PLAIN : (name) => ({ kind: "unknown", label: name, method: "" })));
      }
      return;
    }
    if (node.type === "ExpressionStatement") {
      node._done = true;
      evalExpr(node.expression);
      return;
    }
    if (node.type === "ReturnStatement" || node.type === "ThrowStatement") {
      node._done = true;
      if (node.argument) evalExpr(node.argument);
      return;
    }
    if (isFunctionNode(node)) {
      evalExpr(node);
      return;
    }
    if (node.type !== "Program" && node.type !== "BlockStatement" && node.type !== "ClassBody" && !node.type.endsWith("Statement") && !node.type.endsWith("Declaration") && node.type !== "SwitchCase" && node.type !== "CatchClause") {
      evalExpr(node);
      return;
    }
    node._done = true;
    for (const child of childNodes(node)) walkNode(child);
  };

  const bindImport = (stmt) => {
    if (isTypeOnly(stmt) || stmt.importKind === "type") return;
    const spec = stmt.source?.value || "";
    const resolved = moduleExports(spec, rel);
    const clause = stmt.specifiers || [];
    for (const item of clause) {
      if (isTypeOnly(item)) continue;
      if (item.type === "ImportNamespaceSpecifier") {
        if (resolved.host) bind(item.local.name, hostRoot(item.local.name));
        else if (resolved.missing) bind(item.local.name, { kind: "dynamic", label: item.local.name, method: "" });
        else bind(item.local.name, PLAIN);
      } else if (item.type === "ImportDefaultSpecifier") {
        if (resolved.host) bind(item.local.name, hostRoot(item.local.name));
        else if (resolved.exports) bind(item.local.name, resolved.exports.get("default") || UNKNOWN);
        else if (resolved.missing) bind(item.local.name, { kind: "dynamic", label: item.local.name, method: "" });
        else bind(item.local.name, PLAIN);
      } else if (item.type === "ImportSpecifier") {
        const imported = item.imported.type === "Identifier" ? item.imported.name : item.imported.value;
        if (resolved.host) bind(item.local.name, { kind: "host", label: item.local.name, method: imported, fromMethod: "" });
        else if (resolved.exports) bind(item.local.name, resolved.exports.get(imported) || UNKNOWN);
        else if (resolved.missing) bind(item.local.name, { kind: "dynamic", label: item.local.name, method: "" });
        else bind(item.local.name, PLAIN);
      }
    }
  };

  const hoist = (body) => {
    for (const stmt of body) {
      const decl = stmt.type === "ExportNamedDeclaration" ? stmt.declaration : stmt;
      if (decl?.type === "FunctionDeclaration" && decl.id && !isTypeOnly(stmt)) {
        const id = ++seq;
        fnIds.set(decl, id);
        functions.set(id, { async: Boolean(decl.async) });
        bind(decl.id.name, { kind: "fn", id, label: decl.id.name });
      }
    }
  };

  const exportDeclaration = (stmt) => {
    if (stmt.source) {
      const resolved = moduleExports(stmt.source.value, rel);
      for (const spec of stmt.specifiers || []) {
        if (isTypeOnly(spec)) continue;
        const imported = spec.local.name;
        const exported = spec.exported.name || spec.exported.value;
        if (resolved.host) exports.set(exported, imported === "default" ? hostRoot(resolved.host) : { kind: "host", label: exported, method: imported, fromMethod: "" });
        else if (resolved.exports) exports.set(exported, copyValue(resolved.exports.get(imported) || UNKNOWN));
        else exports.set(exported, { kind: "dynamic", label: exported, method: "" });
      }
      return;
    }
    for (const spec of stmt.specifiers || []) {
      if (isTypeOnly(spec)) continue;
      const exported = spec.exported.name || spec.exported.value;
      exports.set(exported, copyValue(look(spec.local.name) || UNKNOWN));
    }
    const decl = stmt.declaration;
    if (decl?.type === "FunctionDeclaration" && decl.id) exports.set(decl.id.name, look(decl.id.name) || UNKNOWN);
    if (decl?.type === "VariableDeclaration") {
      for (const declarator of decl.declarations) {
        if (declarator.id.type === "Identifier") exports.set(declarator.id.name, copyValue(look(declarator.id.name) || UNKNOWN));
      }
    }
  };

  for (const stmt of ast.program.body) {
    if (stmt.type === "ImportDeclaration") bindImport(stmt);
  }
  hoist(ast.program.body);
  for (const stmt of ast.program.body) {
    walkNode(stmt);
    if (stmt.type === "ExportNamedDeclaration" || stmt.type === "ExportDefaultDeclaration") exportDeclaration(stmt);
  }

  const safe = new Set();
  if (options.record) {
    let changed = true;
    while (changed) {
      changed = false;
      for (const id of functions.keys()) {
        if (safe.has(id)) continue;
        const sites = callSites.filter((site) => site.calleeId === id);
        const callsOk = sites.every((site) => site.confers && site.inside && safe.has(site.inside));
        if (seeds.has(id) && callsOk) {
          safe.add(id);
          changed = true;
        } else if (!seeds.has(id) && sites.length && callsOk) {
          safe.add(id);
          changed = true;
        }
      }
    }
    for (const write of writes) {
      const dynamic = write.target.kind === "dynamic" || !write.key.literal;
      if (dynamic) {
        findings.push({ kind: "write", text: `${write.target.label || "host value"}[dynamic] needs review. ${RENAME_DYNAMIC}` });
        continue;
      }
      if (write.key.name !== "name") continue;
      if (write.fn && safe.has(write.fn)) continue;
      findings.push({ kind: "write", text: RENAME_OUTSIDE });
    }
  }

  const texts = [...new Set(findings.map((item) => item.text))];
  return {
    exports,
    findings: texts,
    calls: [...new Set(findings.filter((item) => item.kind === "call").map((item) => item.text))],
    writes: [...new Set(findings.filter((item) => item.kind === "write").map((item) => item.text))],
    safe: [...safe]
  };
}

function mergeValues(left, right) {
  if (left?.kind === "host") return left;
  if (right?.kind === "host") return right;
  if (left?.kind === "maybe") return left;
  if (right?.kind === "maybe") return right;
  if (left?.kind === "dynamic") return left;
  if (right?.kind === "dynamic") return right;
  if (left?.kind === "plain" && right?.kind === "plain") return PLAIN;
  return left?.kind === "unknown" ? right || UNKNOWN : left || UNKNOWN;
}

function isTestPath(rel) {
  const name = String(rel || "").split(path.sep).join("/");
  return name.startsWith("test/") || name.includes(".test.") || name.includes(".spec.");
}

function isScript(rel) {
  return /\.(?:[cm]?[jt]sx?|mjs|cjs)$/i.test(String(rel || ""));
}

export function hostFindings(feature, docText, project = "") {
  const memory = new Map();
  for (const item of feature || []) memory.set(String(item.rel || "").split(path.sep).join("/"), item.body);
  const cache = new Map();
  const loading = new Set();
  const found = [];
  for (const item of feature || []) {
    const rel = String(item.rel || "").split(path.sep).join("/");
    if (isTestPath(rel) || !isScript(rel)) continue;
    try {
      const result = analyzeSource(item.body, rel, { docs: docText, project, memory, cache, loading, record: true });
      found.push(...result.findings);
    } catch (error) {
      found.push(`host parse needs review: ${error instanceof Error ? error.message : "the file did not parse"}`);
    }
  }
  return [...new Set(found)];
}

function collect(feature, docText, project, field) {
  const memory = new Map();
  for (const item of feature || []) memory.set(String(item.rel || "").split(path.sep).join("/"), item.body);
  const cache = new Map();
  const loading = new Set();
  const found = [];
  for (const item of feature || []) {
    const rel = String(item.rel || "").split(path.sep).join("/");
    if (isTestPath(rel) || !isScript(rel)) continue;
    try {
      const result = analyzeSource(item.body, rel, { docs: docText, project, memory, cache, loading, record: true });
      found.push(...(field ? result[field] : result.findings));
    } catch (error) {
      if (!field || field === "calls") found.push(`host parse needs review: ${error instanceof Error ? error.message : "the file did not parse"}`);
    }
  }
  return [...new Set(found)];
}

export function hostCallFindings(feature, docText, project = "") {
  return collect(feature, docText, project, "calls");
}

export function renameFindings(feature, docText, project = "") {
  return collect(feature, docText, project, "writes");
}

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
  if (value.type === "NumericLiteral") return value.value === 1;
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
    current = parent;
    parent = parent.parent;
  }
  return false;
}

function identifierLive(name, node) {
  if (!node || typeof node !== "object" || !node.type) return false;
  if (dead(node)) return false;
  if (node.type === "JSXExpressionContainer" || node.type === "JSXSpreadAttribute" || (node.type === "JSXAttribute" && node.value && node.value.type !== "StringLiteral")) {
    return usesIdentifier(name, node);
  }
  for (const child of childNodes(node)) if (identifierLive(name, child)) return true;
  return false;
}

function usesIdentifier(name, node) {
  if (!node || typeof node !== "object" || !node.type) return false;
  if (dead(node)) return false;
  if (node.type === "Identifier" && node.name === name) return true;
  if (node.type === "JSXIdentifier" && node.name === name) return true;
  for (const child of childNodes(node)) if (usesIdentifier(name, child)) return true;
  return false;
}

function setterCalled(name, node) {
  if (!node || typeof node !== "object" || !node.type) return false;
  if ((node.type === "CallExpression" || node.type === "OptionalCallExpression") && unwrap(node.callee)?.type === "Identifier" && unwrap(node.callee).name === name) return true;
  for (const child of childNodes(node)) if (setterCalled(name, child)) return true;
  return false;
}

/** A panel state is a useState or useReducer value that the code sets and renders. Static text is not state. */
export function panelRendersState(source) {
  let ast;
  try {
    ast = parseSource(String(source || ""), "panel.tsx");
  } catch {
    return false;
  }
  setParents(ast);
  const states = [];
  const visit = (node) => {
    if (!node || typeof node !== "object" || !node.type) return;
    if (node.type === "VariableDeclarator" && node.id.type === "ArrayPattern" && node.init) {
      const callee = unwrap(node.init.type === "CallExpression" ? node.init.callee : null);
      const hook = callee?.type === "Identifier" ? callee.name : (callee?.type === "MemberExpression" && !callee.computed ? callee.property?.name : "");
      if (hook === "useState" || hook === "useReducer") {
        const name = node.id.elements[0]?.type === "Identifier" ? node.id.elements[0].name : "";
        const setter = node.id.elements[1]?.type === "Identifier" ? node.id.elements[1].name : "";
        if (name && setter) states.push({ name, setter });
      }
    }
    for (const child of childNodes(node)) visit(child);
  };
  visit(ast);
  return states.some((item) => setterCalled(item.setter, ast) && identifierLive(item.name, ast));
}
