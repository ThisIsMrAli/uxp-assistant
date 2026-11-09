import fs from "node:fs";
import path from "node:path";
import { childNodes, parseSource, parserCandidates, setParents } from "./parse.mjs";
import { componentModule, isComponent } from "./sfc.mjs";
import { calledOn, docIndex, documentedMember, elementType, hostModuleType, isCollectionType, propertyType, returnType, returnsPromise } from "./docs-index.mjs";
import { panelRendersState } from "./ui-state.mjs";

export { panelRendersState, parseSource, parserCandidates };

/**
 * Host calls and modal writes, checked as a strict subset.
 *
 * Accepted: direct static member calls and reads on an imported photoshop, premierepro, or uxp
 * binding (or a value read from one by literal member access, index, for-of, or destructuring),
 * and calls on values those calls return. Each called member must be documented for its owner class
 * in the fetched pages.
 *
 * Needs review, never a silent pass: a call or a write through a host value that was stored or
 * passed through an object, array, Map, Set, class field, spread, getter, closure return, generator,
 * Proxy, WeakRef, Object.values/entries, destructuring of such a container, or for-of over one;
 * Reflect.*, bind/call/apply on a host method, eval, new Function, globalThis/window.require,
 * a computed member name on a host value, and any file that does not parse.
 * Non-static module loads (import.meta.glob, module.require, createRequire, a require method)
 * are needs review. A host value in an array-destructuring default, an exported let assigned
 * inside a function, a getter, or a function or host value returned from executeAsModal is
 * needs review. On a typed chain only that class's own members are accepted.
 * A false reject carries that reason. It is not a proof of correctness.
 */

const HOST_MODULES = new Set(["photoshop", "premierepro", "uxp"]);
const GLOBAL_OBJECTS = new Set(["globalThis", "window", "self", "global", "top", "parent", "frames"]);
const LANGUAGE = new Set(["console", "JSON", "Math", "Object", "Promise", "Array", "Date", "Number", "String", "Boolean", "document", "window", "globalThis", "self", "global", "process", "Buffer", "fs", "path", "crypto", "assert", "React", "Reflect", "undefined", "NaN", "Infinity", "Symbol", "Error", "TypeError", "RangeError", "Map", "Set", "WeakMap", "WeakSet", "WeakRef", "Proxy", "parseInt", "parseFloat", "isNaN", "isFinite", "queueMicrotask", "setTimeout", "setInterval", "clearTimeout", "clearInterval", "requestAnimationFrame", "structuredClone", "Intl", "RegExp", "BigInt", "encodeURIComponent", "decodeURIComponent", "fetch", "localStorage", "sessionStorage", "navigator", "location", "alert", "confirm", "performance", "AbortController", "URL", "URLSearchParams", "TextEncoder", "TextDecoder", "Blob", "FileReader", "Event", "CustomEvent", "HTMLElement", "Element", "Node", "EventTarget", "Uint8Array", "ArrayBuffer", "DataView"]);
const CALL_SKIP = new Set(["map", "filter", "forEach", "reduce", "reduceRight", "find", "findIndex", "findLast", "findLastIndex", "some", "every", "flat", "flatMap", "push", "pop", "shift", "unshift", "slice", "splice", "join", "split", "trim", "trimStart", "trimEnd", "replace", "replaceAll", "match", "matchAll", "test", "exec", "then", "catch", "finally", "resolve", "reject", "all", "race", "any", "allSettled", "keys", "values", "entries", "assign", "create", "freeze", "log", "warn", "error", "info", "debug", "stringify", "parse", "now", "toString", "toLocaleString", "valueOf", "includes", "indexOf", "lastIndexOf", "startsWith", "endsWith", "padStart", "padEnd", "toLowerCase", "toUpperCase", "toFixed", "substring", "substr", "charAt", "charCodeAt", "repeat", "at", "sort", "reverse", "concat", "from", "of", "get", "set", "has", "add", "delete", "clear", "querySelector", "querySelectorAll", "getElementById", "addEventListener", "removeEventListener", "preventDefault", "stopPropagation", "focus", "blur", "click", "setAttribute", "getAttribute", "removeAttribute", "toggleAttribute", "appendChild", "removeChild", "closest", "contains", "next", "localeCompare", "normalize", "fill", "isArray", "max", "min", "round", "floor", "ceil", "abs"]);
const SYNC_ITER = new Set(["map", "filter", "forEach", "reduce", "reduceRight", "find", "findIndex", "findLast", "findLastIndex", "some", "every", "flatMap", "sort"]);
const CONTAINER_BUILDERS = new Set(["Object.values", "Object.entries", "Object.fromEntries", "Object.assign", "Object.create", "Object.getOwnPropertyDescriptor", "Object.getOwnPropertyDescriptors", "Object.getPrototypeOf", "Array.from", "Array.of", "Promise.resolve", "Promise.all", "Promise.allSettled", "Promise.race", "Promise.any", "structuredClone"]);
const PLAIN_RESULT = new Set(["String", "Number", "Boolean", "parseInt", "parseFloat", "isNaN", "isFinite", "Object.keys", "JSON.stringify", "Array.isArray", "encodeURIComponent", "decodeURIComponent"]);

const RENAME_OUTSIDE = "A layer rename writes .name, ['name'], Reflect.set, Object.defineProperty, or Object.assign of name, outside executeAsModal. An alias, an index, or a local function named executeAsModal does not count. A helper is accepted only when every call is inside the host modal. The fetched modal page requires the host wrapper.";
const RENAME_DYNAMIC = "A non-literal write on a host value needs review and is not an executeAsModal rename. The property is not a resolved name.";
const RENAME_STORED = "A write through a host value that was stored in an object, array, Map, class field, Proxy, or container needs review. Writes must target a host value read directly from the imported binding.";
const STORED_CALL = "calls through a host value stored in an object, array, Map, Set, class field, spread, getter, closure return, generator, Proxy, WeakRef, Object.values, destructuring, or for-of. Host calls must be direct member calls on an imported photoshop, premierepro, or uxp binding";

const PLAIN = Object.freeze({ kind: "plain", label: "", method: "" });
const NUMERIC = Object.freeze({ kind: "plain", label: "", method: "", numeric: true });
const UNKNOWN = Object.freeze({ kind: "unknown", label: "", method: "" });

const HOSTY = new Set(["host", "maybe", "dynamic", "container", "laundered"]);
function hosty(value) {
  return Boolean(value && HOSTY.has(value.kind));
}

function isFunctionNode(node) {
  return Boolean(node && (node.type === "FunctionDeclaration" || node.type === "FunctionExpression" || node.type === "ArrowFunctionExpression" || node.type === "ObjectMethod" || node.type === "ClassMethod" || node.type === "ClassPrivateMethod"));
}

function isTypeOnly(node) {
  return Boolean(node && (node.importKind === "type" || node.exportKind === "type" || node.isTypeOnly));
}

function literalString(node) {
  if (!node) return null;
  if (node.type === "StringLiteral") return node.value;
  if (node.type === "TemplateLiteral" && node.expressions.length === 0) return node.quasis.map((item) => item.value.cooked ?? item.value.raw).join("");
  if (node.type === "BinaryExpression" && node.operator === "+") {
    const left = literalString(node.left);
    const right = literalString(node.right);
    if (typeof left === "string" && typeof right === "string") return left + right;
  }
  if (node.type === "ParenthesizedExpression" || node.type === "TSAsExpression" || node.type === "TSTypeAssertion" || node.type === "TSSatisfiesExpression" || node.type === "TSNonNullExpression") return literalString(node.expression);
  return null;
}

function unwrap(node) {
  let current = node;
  while (current && (current.type === "ParenthesizedExpression" || current.type === "TSAsExpression" || current.type === "TSTypeAssertion" || current.type === "TSSatisfiesExpression" || current.type === "TSNonNullExpression" || current.type === "TSInstantiationExpression")) {
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
  let current = node;
  while (parent && (parent.type === "ParenthesizedExpression" || parent.type === "TSAsExpression" || parent.type === "TSTypeAssertion" || parent.type === "TSSatisfiesExpression" || parent.type === "TSNonNullExpression" || parent.type === "ChainExpression")) {
    current = parent;
    parent = parent.parent;
  }
  if (!parent) return false;
  if (parent.type === "AwaitExpression") return true;
  if (parent.type === "ReturnStatement") return true;
  if (parent.type === "ArrowFunctionExpression" && parent.body === current) return true;
  return false;
}

/** A then/catch/finally call whose chain is awaited or returned by the enclosing function. */
function chainAwaited(node) {
  let current = node;
  for (let guard = 0; guard < 50; guard += 1) {
    let parent = current.parent;
    while (parent && (parent.type === "ParenthesizedExpression" || parent.type === "TSAsExpression" || parent.type === "TSNonNullExpression" || parent.type === "ChainExpression")) parent = parent.parent;
    const grand = parent?.parent;
    if (parent && (parent.type === "MemberExpression" || parent.type === "OptionalMemberExpression") && !parent.computed && ["then", "catch", "finally"].includes(parent.property?.name) && grand && (grand.type === "CallExpression" || grand.type === "OptionalCallExpression") && grand.callee === parent) {
      current = grand;
      continue;
    }
    break;
  }
  return awaited(current);
}

function hostRoot(name) {
  return { kind: "host", label: name, method: "", fromMethod: "", root: name, type: "", lineage: true, seg: name };
}

function copyValue(value) {
  return value ? { ...value } : UNKNOWN;
}

function mergeValues(left, right) {
  const order = ["evil", "dynamic", "laundered", "container", "host", "maybe"];
  for (const kind of order) {
    if (left?.kind === kind) return left;
    if (right?.kind === kind) return right;
  }
  if (left?.kind === "plain" && right?.kind === "plain") return left.numeric && right.numeric ? NUMERIC : PLAIN;
  if (left?.kind === "unknown" || !left) return right || UNKNOWN;
  return left;
}

function elementOf(value, label = "") {
  if (!value) return UNKNOWN;
  if (value.kind === "host" || value.kind === "maybe") return { kind: "maybe", label: label || value.label, method: "", fromMethod: "", type: value.elementType || "", lineage: Boolean(value.lineage), seg: "" };
  if (value.kind === "container" || value.kind === "laundered") return { kind: "laundered", label: label || `${value.label} item`, method: "", ...(value.opaque ? { opaque: true } : {}) };
  if (value.kind === "dynamic") return { kind: "dynamic", label: label || value.label, method: "", why: value.why };
  return UNKNOWN;
}

function fnId(rel, node) {
  return `${rel}:${node.start}:${node.end}`;
}

/**
 * Parse one module and the local modules it imports.
 * With `record`, the result carries the raw call findings, writes, modal seeds, and call sites,
 * so the caller can decide modal safety across files.
 */
export function analyzeSource(text, filename, options = {}) {
  const rel = String(filename || "src/file.ts").split(path.sep).join("/");
  if (options.record && !options.summaries) {
    const first = runAnalysis(text, rel, { ...options, record: false, collect: true, summaries: new Map() });
    return runAnalysis(text, rel, { ...options, summaries: first.summaries });
  }
  return runAnalysis(text, rel, options);
}

function runAnalysis(text, rel, options) {
  const docs = String(options.docs || "");
  const index = docIndex(docs);
  const project = options.project || "";
  const memory = options.memory || new Map();
  const cache = options.cache || new Map();
  const loading = options.loading || new Set();
  const summaries = options.summaries || new Map();
  if (!summaries.flows) summaries.flows = new Map();
  const flows = summaries.flows;
  let source = text;
  let parseName = rel;
  if (isComponent(rel)) {
    const component = componentModule(rel, text);
    source = component.code;
    parseName = component.filename;
  }
  const ast = parseSource(source, parseName);
  setParents(ast);
  const findings = [];
  const writes = [];
  const functions = new Map();
  const seeds = new Set();
  const callSites = [];
  const scopes = [new Map()];
  const fnStack = [];
  const thisStack = [UNKNOWN];
  const exports = new Map();
  const mutableExports = new Set();
  const rechecked = options.rechecked || new Set();

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
  const rebind = (name, value) => {
    for (let i = scopes.length - 1; i >= 0; i -= 1) {
      if (scopes[i].has(name)) {
        scopes[i].set(name, copyValue(value));
        return;
      }
    }
  };
  const infoFor = (node) => {
    const id = fnId(rel, node);
    if (!functions.has(id)) functions.set(id, { id, rel, async: Boolean(node.async), generator: Boolean(node.generator), walked: false, ret: null, yields: null, label: node.id?.name || node.key?.name || "" });
    return functions.get(id);
  };
  const call = (kind, text) => {
    if (options.record) findings.push({ kind, text });
  };

  const readFile = (spec, fromRel) => {
    const from = path.posix.dirname(fromRel || "src/file.ts");
    const base = path.posix.normalize(path.posix.join(from, spec));
    const suffixes = ["", ".ts", ".tsx", ".mts", ".mjs", ".js", ".jsx", ".cjs", ".vue", ".svelte", "/index.ts", "/index.tsx", "/index.js"];
    for (const suffix of suffixes) {
      const next = `${base}${suffix}`;
      if (memory.has(next)) return { rel: next, text: memory.get(next) };
      if (!project) continue;
      const full = path.resolve(project, next);
      const root = path.resolve(project);
      if (full !== root && !full.startsWith(`${root}${path.sep}`)) continue;
      try {
        if (fs.statSync(full).isFile()) return { rel: next, text: fs.readFileSync(full, "utf8") };
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
      nested = runAnalysis(found.text, found.rel, { docs, project, memory, cache, loading, record: false, summaries: new Map() });
    } catch {
      loading.delete(found.rel);
      return { missing: true };
    }
    cache.set(found.rel, nested.exports);
    loading.delete(found.rel);
    return { exports: nested.exports };
  };

  const access = (object, name) => {
    if (!object) return UNKNOWN;
    switch (object.kind) {
      case "skip":
        if (GLOBAL_OBJECTS.has(object.label) && (name === "require" || name === "eval" || name === "Function")) return { kind: "evil", label: `${object.label}.${name}` };
        return { kind: "skip", label: `${object.label}.${name}`, method: name };
      case "host":
      case "maybe": {
        let type = "";
        if (object.root && !object.label.includes(".")) type = hostModuleType(index, object.root, name);
        // A typed chain accepts only that class's own members. A missing member does not
        // fall through to "documented on some other page" or to a later calledOn match.
        const page = object.lineage && object.type && index.pages.has(object.type) ? index.pages.get(object.type) : null;
        const promiseMethod = (name === "then" || name === "catch" || name === "finally") && (object.promise || object.ownerPromise);
        if (!type && page && !page.has(name) && !promiseMethod && !(CALL_SKIP.has(name) && isCollectionType(object.type))) {
          return { kind: "dynamic", label: object.label ? `${object.label}.${name}` : name, method: name, why: `${name} is not a ${object.type} member in the fetched docs. On a typed chain only that class's members count` };
        }
        if (!type) type = propertyType(index, object.type, name);
        return { kind: object.kind, label: object.label ? `${object.label}.${name}` : name, method: name, fromMethod: object.fromMethod || "", type: "", ownerType: object.type || "", ownerPromise: Boolean(object.promise), ownerSeg: object.seg || "", propType: type, elementType: elementType(index, type), lineage: Boolean(object.lineage), seg: name };
      }
      case "dynamic":
        return { kind: "dynamic", label: `${object.label}.${name}`, method: "", why: object.why };
      case "evil":
        return object;
      case "container":
      case "laundered":
        return { kind: "laundered", label: `${object.label}.${name}`, method: name, ...(object.opaque ? { opaque: true } : {}) };
      case "self":
      case "instance": {
        const member = object.cls.members.get(name);
        if (member && member.kind === "get") return returnValue(member.info, `${name}`);
        if (member) return { kind: "fn", id: member.info.id, info: member.info, label: name, method: true };
        if (object.cls.hosty) return { kind: "laundered", label: `this.${name}`, method: "", direct: true };
        return UNKNOWN;
      }
      default:
        return UNKNOWN;
    }
  };

  const withType = (value) => {
    if (!value || (value.kind !== "host" && value.kind !== "maybe")) return value;
    if (value.propType !== undefined) {
      const next = { ...value, type: value.propType };
      delete next.propType;
      return next;
    }
    return value;
  };

  const returnValue = (info, label) => {
    const summary = info && info.walked ? info : summaries.get(info?.id);
    if (!summary) return { kind: "laundered", label: `${label}()`, method: "", opaque: true };
    if (summary.generator) {
      return hosty(summary.yields) || hosty(summary.ret) ? { kind: "container", label: `${label}() generator` } : UNKNOWN;
    }
    const value = summary.ret;
    if (!value) return UNKNOWN;
    if (value.kind === "host") return { kind: "laundered", label: `${label}()`, method: "" };
    if (value.kind === "maybe") return { ...value };
    if (value.kind === "container" || value.kind === "laundered") return { kind: "laundered", label: `${label}()`, method: "" };
    if (value.kind === "dynamic" || value.kind === "evil") return { kind: "dynamic", label: `${label}()`, method: "" };
    return UNKNOWN;
  };

  const documentedCall = (value) => {
    const method = value.method || "";
    const owner = value.ownerType || "";
    const type = owner || (value.fromMethod && !value.lineage ? returnType(index, value.fromMethod) : "");
    if (value.ownerPromise && (method === "then" || method === "catch" || method === "finally")) return { ok: true, skip: true };
    if (CALL_SKIP.has(method) && (!type || !index.pages.has(type) || isCollectionType(type))) return { ok: true, skip: true };
    if (value.lineage) {
      // A value read from the imported host binding is matched against its owner class only.
      // A known class with a fetched page never falls back to "documented on any page".
      // calledOn is only for a receiver segment whose class page was not resolved (core.executeAsModal).
      if (type && index.pages.has(type)) return { ...documentedMember(index, type, method), type };
      if (!type && calledOn(index, value.ownerSeg, method)) return { ok: true, type, sample: `${value.ownerSeg}.${method}(` };
      return { ok: false, unresolved: true, type };
    }
    const found = documentedMember(index, type, method);
    return { ...found, type };
  };

  const noteCall = (value) => {
    if (!value) return UNKNOWN;
    switch (value.kind) {
      case "evil":
        call("call", `${value.label}() needs review. eval, new Function, a computed require, and globalThis or window.require are outside the accepted subset`);
        return { kind: "dynamic", label: `${value.label}()`, method: "" };
      case "dynamic":
        // NQ15: always say why.
        call("call", `${value.label || "host value"} needs review: ${value.why || "the host value reaches this call through a path the checker does not follow (a dynamic import or require, a computed key, or an unresolved value), so the called member is not a resolved, documented name"}`);
        return { kind: "dynamic", label: value.label, method: "" };
      case "laundered": {
        if (value.method && CALL_SKIP.has(value.method)) return { kind: "laundered", label: value.label, method: "" };
        if (value.direct || value.opaque) {
          if (!value.method) return { kind: "laundered", label: `${value.label}()`, method: "", opaque: true };
        }
        call("call", `${value.label}() needs review: it ${STORED_CALL}`);
        return { kind: "laundered", label: `${value.label}()`, method: "" };
      }
      case "host":
      case "maybe": {
        const method = value.method || "";
        if (!method) {
          if (value.kind === "host") call("call", `${value.label || "host value"}() needs review: a host module or object is called directly, not one of its documented methods`);
          return { kind: "maybe", label: value.label, method: "", fromMethod: "", lineage: Boolean(value.lineage), seg: "" };
        }
        const verdict = documentedCall(value);
        const label = `${value.label}()`;
        if (!verdict.ok) {
          if (verdict.unresolved) {
            call("call", `${label} needs review: the receiver ${value.ownerSeg ? `${value.label.slice(0, -(method.length + 1))} ` : ""}has ${verdict.type ? `type ${verdict.type}, and no ${verdict.type} page was fetched` : "no resolved host type in the fetched docs"}, so ${method} cannot be matched to its owner class. A method documented for another class does not count`);
          } else {
            call("call", verdict.owner ? `${label} is not a ${verdict.owner} member in the fetched docs` : `${label} needs review: ${method} is not a documented member in the fetched docs`);
          }
        }
        if (verdict.skip) {
          if (value.ownerPromise) return { kind: "maybe", label: value.label, method: "", fromMethod: "", type: "", promise: true, lineage: Boolean(value.lineage), seg: "" };
          return { kind: "maybe", label: value.label, method: "", fromMethod: value.fromMethod || "", type: "", lineage: Boolean(value.lineage), seg: "" };
        }
        const owner = verdict.type || "";
        const type = value.lineage ? returnType(index, method, owner) : returnType(index, method);
        return { kind: "maybe", label: value.label, method: "", fromMethod: method, type, elementType: elementType(index, type), promise: returnsPromise(index, method), lineage: Boolean(value.lineage), seg: "" };
      }
      default:
        return UNKNOWN;
    }
  };

  const bindPattern = (pattern, valueFor) => {
    if (!pattern) return;
    const valueOf = (name) => (typeof valueFor === "function" ? valueFor(name) : valueFor);
    if (pattern.type === "Identifier") {
      bind(pattern.name, valueOf(pattern.name));
      return;
    }
    if (pattern.type === "TSParameterProperty") {
      bindPattern(pattern.parameter, valueFor);
      return;
    }
    if (pattern.type === "AssignmentPattern") {
      const fallback = pattern.right ? evalExpr(pattern.right) : UNKNOWN;
      // Default parameters stay caller-supplied (valueFor is a function). An array or object
      // destructuring default that holds a host value is the binding when the element is missing.
      if (typeof valueFor !== "function" && hosty(fallback)) {
        const incoming = valueFor;
        if (hosty(incoming) && (incoming.kind !== fallback.kind || incoming.type !== fallback.type || incoming.ownerType !== fallback.ownerType)) {
          bindPattern(pattern.left, { kind: "dynamic", label: "destructuring default", method: "", why: "a host value is a destructuring default and the element may also be present, so the binding is not one owner class" });
          return;
        }
        if (!incoming || incoming.kind === "unknown" || incoming.kind === "plain") {
          bindPattern(pattern.left, fallback);
          return;
        }
      }
      bindPattern(pattern.left, valueFor);
      return;
    }
    if (pattern.type === "RestElement") {
      const source = valueOf("rest");
      bindPattern(pattern.argument, hosty(source) ? { kind: "dynamic", label: "rest", method: "" } : (source?.kind === "unknown" && typeof valueFor === "function" ? { kind: "dynamic", label: "rest", method: "" } : UNKNOWN));
      return;
    }
    if (pattern.type === "ArrayPattern") {
      for (const element of pattern.elements) {
        if (!element) continue;
        if (typeof valueFor === "function") bindPattern(element, valueFor);
        else bindPattern(element, element.type === "RestElement" ? valueFor : elementOf(valueFor));
      }
      return;
    }
    if (pattern.type === "ObjectPattern") {
      for (const prop of pattern.properties) {
        if (prop.type === "RestElement") {
          const source = typeof valueFor === "function" ? null : valueFor;
          bindPattern(prop.argument, hosty(source) ? { kind: "dynamic", label: `${source.label} rest`, method: "" } : UNKNOWN);
          continue;
        }
        const key = prop.computed ? literalString(prop.key) : (prop.key?.name || literalString(prop.key));
        const source = typeof valueFor === "function" ? null : valueFor;
        let next;
        if (source) {
          if (key) next = withType(access(source, key));
          else next = hosty(source) ? { kind: "dynamic", label: `${source.label}[dynamic]`, method: "" } : UNKNOWN;
        } else next = valueFor(prop.value?.name || key || "");
        if (prop.value && prop.value.type !== "Identifier") bindPattern(prop.value, next);
        else if (prop.value?.type === "Identifier") bind(prop.value.name, next);
      }
    }
  };

  const enterFunction = (node) => {
    const info = infoFor(node);
    if (node._walked) return info;
    node._walked = true;
    node._done = true;
    scopes.push(new Map());
    if (node.type !== "ArrowFunctionExpression") thisStack.push(node._self || UNKNOWN);
    const hint = node._hint;
    const flowed = flows.get(info.id);
    (node.params || []).forEach((param, position) => {
      if (hint && position === 1 && node._indexHint) bindPattern(param, NUMERIC);
      else if (hint) bindPattern(param, hint);
      else if (flowed && flowed[position] && !options.collect) {
        // A local function called with a host value is checked as that host value, with its owner type.
        const value = flowed[position];
        bindPattern(param, param.type === "Identifier" ? { ...value, label: param.name } : value);
      } else bindPattern(param, (name) => ({ kind: "maybe", label: name, method: "", fromMethod: "" }));
    });
    if (node.body?.type === "BlockStatement") hoist(node.body.body);
    fnStack.push(info);
    if (node.body) {
      if (node.body.type === "BlockStatement") walkNode(node.body);
      else info.ret = mergeValues(info.ret, evalExpr(node.body));
    }
    fnStack.pop();
    if (node.type !== "ArrowFunctionExpression") thisStack.pop();
    scopes.pop();
    info.walked = true;
    if (options.collect) summaries.set(info.id, { id: info.id, generator: info.generator, walked: true, ret: info.ret ? copyValue(info.ret) : null, yields: info.yields ? copyValue(info.yields) : null });
    return info;
  };

  const rememberWrite = (target, key, value) => {
    if (!target) return;
    if (target.kind === "self") {
      if (hosty(value)) target.cls.hosty = true;
      return;
    }
    if (!options.record) return;
    const fn = fnStack.at(-1)?.id || null;
    if (target.kind === "host" || target.kind === "maybe" || target.kind === "dynamic") {
      writes.push({ target, key, fn });
      return;
    }
    if (target.kind === "laundered" && (!key.literal || key.name === "name")) {
      writes.push({ target, key, fn, stored: true });
    }
  };

  const keyOf = (member) => {
    if (!member.computed && member.property && (member.property.type === "Identifier" || member.property.type === "PrivateName")) return { literal: true, name: member.property.name || member.property.id?.name };
    const value = literalString(member.property);
    if (typeof value === "string") return { literal: true, name: value };
    if (member.property?.type === "NumericLiteral") return { literal: true, index: true, name: String(member.property.value) };
    const evaluated = evalExpr(member.property);
    if (evaluated?.numeric) return { literal: true, index: true, name: "#" };
    return { literal: false };
  };

  const memberWrite = (member, value) => {
    const object = evalExpr(member.object);
    rememberWrite(object, keyOf(member), value);
  };

  const patternWrite = (pattern) => {
    if (!pattern) return;
    if (pattern.type === "MemberExpression" || pattern.type === "OptionalMemberExpression") {
      memberWrite(pattern, UNKNOWN);
      return;
    }
    if (pattern.type === "AssignmentPattern") {
      patternWrite(pattern.left);
      return;
    }
    if (pattern.type === "ArrayPattern") {
      for (const element of pattern.elements) if (element) patternWrite(element.type === "RestElement" ? element.argument : element);
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

  const objectHasName = (node) => {
    if (!node || node.type !== "ObjectExpression") return { name: false, unknown: true };
    let name = false;
    let unknown = false;
    for (const prop of node.properties) {
      if (prop.type === "SpreadElement") {
        unknown = true;
        continue;
      }
      const key = prop.computed ? literalString(prop.key) : (prop.key?.name || literalString(prop.key));
      if (key === null || key === undefined) unknown = true;
      else if (key === "name") name = true;
    }
    return { name, unknown };
  };

  const calleeName = (callee) => {
    const node = unwrap(callee);
    if (node?.type === "Identifier") return node.name;
    if ((node?.type === "MemberExpression" || node?.type === "OptionalMemberExpression") && !node.computed && unwrap(node.object)?.type === "Identifier" && node.property?.type === "Identifier") {
      return `${unwrap(node.object).name}.${node.property.name}`;
    }
    return "";
  };

  const evalArgs = (args, hint, sync) => {
    const values = [];
    for (const arg of args) {
      const node = unwrap(arg);
      if (hint && isFunctionNode(node) && !node._walked) {
        node._hint = hint;
        node._indexHint = Boolean(sync);
      }
      values.push(evalExpr(arg.type === "SpreadElement" ? arg.argument : arg));
      if (sync && isFunctionNode(node)) {
        const info = infoFor(node);
        callSites.push({ calleeId: info.id, inside: fnStack.at(-1)?.id || null, confers: !info.async });
      } else if (sync && values.at(-1)?.kind === "fn") {
        const info = values.at(-1).info;
        if (info) callSites.push({ calleeId: info.id, inside: fnStack.at(-1)?.id || null, confers: !info.async });
      }
    }
    return values;
  };

  /**
   * A dynamic import() or require() of a local module that exports a host value is outside the accepted subset.
   * Only a static `import { photoshop } from "./globals"` binding is tracked as the host.
   */
  const localModuleCall = (how, spec) => {
    if (!String(spec).startsWith(".")) return UNKNOWN;
    const resolved = moduleExports(spec, rel);
    if (resolved.external) return UNKNOWN;
    if (resolved.missing) {
      call("call", `${how}("${spec}") needs review: the module did not resolve inside the project, so what it exports is unknown. Use a static import`);
      return { kind: "dynamic", label: `${how}("${spec}")`, method: "", why: `it comes from a dynamic ${how}("${spec}") that did not resolve` };
    }
    if (resolved.exports && [...resolved.exports.values()].some(hosty)) {
      call("call", `${how}("${spec}") needs review: the module exports a host value, and a dynamic ${how}() of it is not tracked. Use a static import { photoshop } from "${spec}" so each host call is checked`);
      return { kind: "dynamic", label: `${how}("${spec}")`, method: "", why: `it comes from a dynamic ${how}("${spec}") of a module that exports a host value, which is not tracked. Use a static import` };
    }
    return UNKNOWN;
  };

  const getterReturnsHost = (node) => {
    const current = unwrap(node);
    if (!current || current.type !== "ObjectExpression") return false;
    for (const prop of current.properties || []) {
      if (prop.type === "ObjectProperty" && prop.value?.type === "ObjectExpression" && getterReturnsHost(prop.value)) return true;
      const key = !prop.computed ? (prop.key?.name || prop.key?.value) : "";
      const fn = prop.type === "ObjectMethod" ? prop : (key === "get" ? unwrap(prop.value) : null);
      if (!fn || !isFunctionNode(fn)) continue;
      if (prop.type === "ObjectMethod" && prop.kind !== "get" && key !== "get") continue;
      const info = infoFor(fn);
      if (hosty(info.ret) || hosty(info.yields)) return true;
    }
    return false;
  };

  const evalCall = (node) => {
    const args = node.arguments || [];
    const callee = unwrap(node.callee);
    const isNew = node.type === "NewExpression";
    if (callee?.type === "Identifier" && !look(callee.name)) {
      if (callee.name === "require") {
        const spec = literalString(args[0]);
        if (spec === null) {
          evalArgs(args);
          call("call", "require() with a computed name needs review. Only a literal require or import of photoshop, premierepro, or uxp is accepted");
          return { kind: "dynamic", label: "require()", method: "" };
        }
        const rootName = String(spec).split("/")[0];
        if (HOST_MODULES.has(rootName)) return hostRoot(rootName);
        return localModuleCall("require", spec);
      }
      if (callee.name === "eval" || callee.name === "Function") {
        evalArgs(args);
        call("call", `${isNew ? "new " : ""}${callee.name}() needs review. eval and new Function are outside the accepted subset`);
        return { kind: "dynamic", label: `${callee.name}()`, method: "" };
      }
      if ((callee.name === "setTimeout" || callee.name === "setInterval") && args[0] && (literalString(args[0]) !== null || args[0].type === "TemplateLiteral")) {
        evalArgs(args);
        call("call", `${callee.name}() with a string body needs review. It is eval`);
        return UNKNOWN;
      }
    }
    if (callee?.type === "Identifier" && (callee.name === "createRequire" || look(callee.name)?.label === "createRequire")) {
      evalArgs(args);
      call("call", "createRequire() needs review: createRequire is a non-static module load and is not tracked. Use a static import");
      return { kind: "evil", label: "createRequire()" };
    }
    if ((callee?.type === "MemberExpression" || callee?.type === "OptionalMemberExpression") && !callee.computed && callee.property?.type === "Identifier") {
      const member = callee.property.name;
      const meta = unwrap(callee.object);
      const importMeta = meta?.type === "MetaProperty" && meta.meta?.name === "import";
      if (importMeta && (member === "glob" || member === "globEager")) {
        evalArgs(args);
        call("call", `import.meta.${member}() needs review: it loads modules without a static import, so a host export in those modules is not checked. Use a static import`);
        return { kind: "dynamic", label: `import.meta.${member}()`, method: "", why: `import.meta.${member} is a non-static module load` };
      }
      if (member === "require") {
        const root = unwrap(callee.object);
        const globalRequire = root?.type === "Identifier" && (root.name === "globalThis" || root.name === "window" || root.name === "global");
        if (!globalRequire) {
          evalArgs(args);
          call("call", `${calleeName(callee) || "module.require"}() needs review: module.require and any require method are non-static module loads and are not tracked. Use a static import`);
          return { kind: "dynamic", label: "module.require()", method: "", why: "a require method is a non-static module load" };
        }
      }
    }
    if (callee?.type === "Import") {
      const spec = literalString(args[0]);
      if (spec === null) {
        evalArgs(args);
        call("call", "import() with a computed name needs review: the module is not a literal, so what it loads is unknown. Only a literal import of photoshop, premierepro, uxp, or a project file is accepted");
        return { kind: "dynamic", label: "import()", method: "" };
      }
      const rootName = String(spec).split("/")[0];
      if (HOST_MODULES.has(rootName)) return hostRoot(rootName);
      return localModuleCall("import", spec);
    }
    const named = calleeName(callee);
    if ((callee?.type === "MemberExpression" || callee?.type === "OptionalMemberExpression") && !callee.computed && callee.property?.type === "Identifier") {
      const name = callee.property.name;
      const objectNode = unwrap(callee.object);
      if (objectNode?.type === "Identifier" && objectNode.name === "Reflect" && !look("Reflect")) {
        const values = evalArgs(args);
        if (values.some(hosty)) {
          call("call", `Reflect.${name}() on a host value needs review. Reflect is outside the accepted subset`);
          if (name === "set" || name === "defineProperty" || name === "deleteProperty" || name === "setPrototypeOf") {
            const key = literalString(args[1]);
            rememberWrite(values[0], typeof key === "string" ? { literal: true, name: key } : { literal: false }, values[2]);
            if (options.record && values[0]?.kind !== "self") writes.push({ target: { kind: "dynamic", label: `Reflect.${name}` }, key: { literal: false }, fn: fnStack.at(-1)?.id || null, reflect: true });
          }
          return { kind: "dynamic", label: `Reflect.${name}()`, method: "" };
        }
        return UNKNOWN;
      }
      if (objectNode?.type === "Identifier" && objectNode.name === "Object" && !look("Object") && (name === "assign" || name === "defineProperty" || name === "defineProperties" || name === "setPrototypeOf")) {
        const values = evalArgs(args);
        const target = values[0];
        if ((name === "defineProperty" || name === "defineProperties") && getterReturnsHost(name === "defineProperty" ? args[2] : args[1])) {
          call("call", "Object.defineProperty() needs review: a getter returns a host value, and a getter is not a tracked binding. Use a static import");
        }
        if (target && (target.kind === "host" || target.kind === "maybe" || target.kind === "dynamic" || target.kind === "laundered")) {
          if (name === "defineProperty") {
            const key = literalString(args[1]);
            rememberWrite(target, typeof key === "string" ? { literal: true, name: key } : { literal: false }, values[2]);
          } else if (name === "assign") {
            for (const arg of args.slice(1)) {
              const shape = objectHasName(unwrap(arg));
              if (shape.unknown) rememberWrite(target, { literal: false }, UNKNOWN);
              else if (shape.name) rememberWrite(target, { literal: true, name: "name" }, UNKNOWN);
            }
          } else rememberWrite(target, { literal: false }, UNKNOWN);
          return target;
        }
        if (name === "assign" && values.slice(1).some(hosty)) return { kind: "container", label: "Object.assign()" };
        return target || UNKNOWN;
      }
      if (name === "bind" || name === "call" || name === "apply") {
        const fn = evalExpr(callee.object);
        evalArgs(args);
        if (fn && (fn.kind === "host" || fn.kind === "maybe") && fn.method) {
          const before = findings.length;
          const result = noteCall(fn);
          if (findings.length === before && !CALL_SKIP.has(fn.method)) call("call", `${fn.label}.${name}() needs review. bind, call, and apply on a host method are outside the accepted subset`);
          return name === "bind" ? { kind: "laundered", label: `${fn.label}.bind()`, method: "" } : result;
        }
        if (fn && (fn.kind === "dynamic" || fn.kind === "laundered" || fn.kind === "evil")) {
          call("call", `${fn.label}.${name}() needs review: it ${STORED_CALL}`);
          return { kind: "dynamic", label: `${fn.label}.${name}()`, method: "" };
        }
        if (fn && fn.kind === "fn" && fn.info && name !== "bind") {
          callSites.push({ calleeId: fn.info.id, inside: fnStack.at(-1)?.id || null, confers: !fn.info.async || awaited(node) });
          return returnValue(fn.info, fn.label || "function");
        }
        return UNKNOWN;
      }
    }
    const fn = evalExpr(node.callee);
    let hint = null;
    let sync = false;
    if ((callee?.type === "MemberExpression" || callee?.type === "OptionalMemberExpression") && fn && (fn.kind === "host" || fn.kind === "maybe" || fn.kind === "laundered" || fn.kind === "container" || fn.kind === "skip" || fn.kind === "unknown" || fn.kind === "plain" || fn.kind === "dynamic")) {
      const method = fn.method || (callee.property?.type === "Identifier" ? callee.property.name : "");
      if (CALL_SKIP.has(method)) {
        const receiver = evalExpr(callee.object);
        hint = elementOf(receiver);
        if (method === "then" || method === "catch" || method === "finally") {
          if (receiver && receiver.promise && receiver.kind === "maybe") hint = method === "then" ? { kind: "maybe", label: receiver.label, method: "", fromMethod: receiver.fromMethod || "", type: receiver.type || "", elementType: receiver.elementType || "", lineage: Boolean(receiver.lineage), seg: "" } : UNKNOWN;
          else hint = hosty(receiver) ? elementOf(receiver) : UNKNOWN;
        }
        sync = SYNC_ITER.has(method);
      }
    }
    const evaluated = evalArgs(args, hint, sync);
    if (!sync && (callee?.type === "MemberExpression" || callee?.type === "OptionalMemberExpression") && !callee.computed && ["then", "catch", "finally"].includes(callee.property?.name) && chainAwaited(node)) {
      // A then/catch/finally callback on a chain the enclosing function returns or awaits runs before that function finishes.
      args.forEach((arg, position) => {
        const target = unwrap(arg);
        const value = evaluated[position];
        const info = target && isFunctionNode(target) ? infoFor(target) : (value?.kind === "fn" ? value.info : null);
        if (info) callSites.push({ calleeId: info.id, inside: fnStack.at(-1)?.id || null, confers: true });
      });
    }
    if (fn?.kind === "fn") {
      const info = fn.info || functions.get(fn.id);
      if (info) callSites.push({ calleeId: info.id, inside: fnStack.at(-1)?.id || null, confers: !info.async || awaited(node) });
      if (info && options.record && !options.collect && info.rel && info.rel !== rel && memory.has(info.rel) && (options.depth || 0) < 6) {
        const hostArgs = evaluated.some((value) => value && value.lineage && (value.kind === "host" || value.kind === "maybe"));
        const key = `${info.id}|${evaluated.map((value) => `${value?.kind || ""}:${value?.type || ""}:${value?.ownerType || ""}:${value?.lineage ? 1 : 0}`).join("|")}`;
        if (hostArgs && !rechecked.has(key)) {
          rechecked.add(key);
          const summaries = new Map();
          summaries.flows = new Map([[info.id, evaluated.map((value) => (value && value.lineage && (value.kind === "host" || value.kind === "maybe") ? copyValue(value) : null))]]);
          try {
            const nested = runAnalysis(memory.get(info.rel), info.rel, { docs, project, memory, cache: new Map(), loading: new Set(), record: true, summaries, rechecked, depth: (options.depth || 0) + 1 });
            findings.push(...nested.raw.findings);
          } catch {
            call("call", `${info.rel} needs review: the helper was called with a host value and could not be checked again`);
          }
        }
      }
      if (info && options.collect) {
        evaluated.forEach((value, position) => {
          if (!value || !value.lineage || (value.kind !== "host" && value.kind !== "maybe")) return;
          const list = flows.get(info.id) || [];
          const before = list[position];
          list[position] = before && (before.type !== value.type || before.ownerType !== value.ownerType) ? { ...value, type: "", ownerType: "", elementType: "", seg: "" } : copyValue(value);
          flows.set(info.id, list);
        });
      }
      if (fn.cls && isNew) return { kind: "instance", cls: fn.cls, label: fn.label };
      return info ? returnValue(info, fn.label || "function") : UNKNOWN;
    }
    if (fn?.kind === "cls") {
      if (evaluated.some(hosty)) fn.cls.hosty = true;
      return { kind: "instance", cls: fn.cls, label: fn.label };
    }
    if (fn && (fn.kind === "host" || fn.kind === "maybe") && fn.method === "executeAsModal") {
      const callback = unwrap(args[0]);
      const callbackInfo = callback && isFunctionNode(callback) ? infoFor(callback) : (evaluated[0]?.kind === "fn" ? evaluated[0].info : null);
      if (callbackInfo) seeds.add(callbackInfo.id);
      const returned = callbackInfo?.ret;
      if (returned && (returned.kind === "fn" || ((returned.kind === "host" || returned.kind === "maybe") && returned.lineage && !returned.promise))) {
        call("call", "executeAsModal() needs review: the callback returns a function or a host value, which is used after the modal ends and is not a tracked binding");
        return { kind: "dynamic", label: "executeAsModal()", method: "", why: "the modal callback returned a function or a host value" };
      }
    }
    if (fn?.kind === "skip") {
      const label = fn.label;
      if (PLAIN_RESULT.has(label)) return PLAIN;
      if (label === "Proxy" || label === "Proxy.revocable") return evaluated.some(hosty) ? { kind: "laundered", label: "Proxy", method: "" } : UNKNOWN;
      // Array.from(hostList) and Array.from(hostList) with a plain mapper copy the list. The elements stay that host type.
      if (label === "Array.from" && evaluated[0] && (evaluated[0].kind === "host" || evaluated[0].kind === "maybe") && evaluated[0].lineage) {
        if (!args[1] || !hosty(evaluated[1])) return copyValue(evaluated[0]);
        return copyValue(evaluated[1]);
      }
      if (CONTAINER_BUILDERS.has(label) || isNew) return evaluated.some(hosty) ? { kind: "container", label: `${label}()` } : UNKNOWN;
      if (fn.method && CALL_SKIP.has(fn.method)) return UNKNOWN;
      return UNKNOWN;
    }
    if (fn?.kind === "container") return UNKNOWN;
    if (fn && (fn.kind === "unknown" || fn.kind === "plain")) {
      if (evaluated.some((value) => value && (value.kind === "host" || value.kind === "container" || value.kind === "laundered" || value.kind === "maybe"))) {
        if (fn.method && CALL_SKIP.has(fn.method)) return UNKNOWN;
        return { kind: "laundered", label: `${named || "call"}()`, method: "", opaque: true };
      }
      return UNKNOWN;
    }
    return withType(noteCall(fn));
  };

  const evalExpr = (node) => {
    if (!node) return UNKNOWN;
    if (node._value) return node._value;
    node._done = true;
    const value = evalRaw(node);
    node._value = value || UNKNOWN;
    return node._value;
  };

  const objectValue = (node) => {
    let carries = false;
    for (const prop of node.properties) {
      if (prop.type === "SpreadElement") {
        if (hosty(evalExpr(prop.argument))) carries = true;
      } else if (prop.type === "ObjectMethod") {
        const info = enterFunction(prop);
        const ret = info.generator ? info.yields : info.ret;
        if (ret && (ret.kind === "host" || ret.kind === "container" || ret.kind === "laundered" || ret.kind === "dynamic")) carries = true;
      } else {
        if (prop.computed) evalExpr(prop.key);
        if (hosty(evalExpr(prop.value))) carries = true;
      }
    }
    return carries ? { kind: "container", label: "object" } : PLAIN;
  };

  const classValue = (node) => {
    const cls = { hosty: false, members: new Map() };
    const self = { kind: "self", cls };
    const label = node.id?.name || "class";
    const value = { kind: "cls", cls, label };
    if (node.id && node.type === "ClassDeclaration") bind(node.id.name, value);
    if (node.superClass) evalExpr(node.superClass);
    const body = node.body?.body || [];
    const decorate = (list) => {
      for (const decorator of list || []) {
        const applied = evalExpr(decorator.expression);
        if (applied && (applied.kind === "host" || applied.kind === "maybe") && applied.method) noteCall(applied);
        else if (applied && (applied.kind === "laundered" || applied.kind === "dynamic" || applied.kind === "evil")) noteCall(applied);
      }
    };
    decorate(node.decorators);
    for (const member of body) {
      if ((member.type === "ClassMethod" || member.type === "ClassPrivateMethod") && member.kind !== "constructor") {
        const name = member.key?.name || member.key?.id?.name || literalString(member.key) || "";
        member._self = self;
        cls.members.set(name, { kind: member.kind, info: infoFor(member) });
      }
      if (member.type === "ClassMethod" && member.kind === "constructor") {
        if ((member.params || []).some((param) => param.type === "TSParameterProperty")) cls.hosty = true;
        member._self = self;
      }
    }
    thisStack.push(self);
    for (const member of body) {
      if ((member.type === "ClassProperty" || member.type === "ClassPrivateProperty") && member.value) {
        if (hosty(evalExpr(member.value))) cls.hosty = true;
        const name = member.key?.name || member.key?.id?.name || "";
        const v = member.value._value;
        if (v?.kind === "fn" && v.info) cls.members.set(name, { kind: "method", info: v.info });
      }
    }
    thisStack.pop();
    // A decorator receives the class or method and may call it from anywhere, so a decorated method is never
    // proven to run inside executeAsModal.
    for (const member of body) {
      if (member.decorators?.length) decorate(member.decorators);
      if ((member.type === "ClassMethod" || member.type === "ClassPrivateMethod") && (member.decorators?.length || node.decorators?.length)) {
        callSites.push({ calleeId: infoFor(member).id, inside: null, confers: false });
      }
    }
    const ordered = [...body.filter((m) => m.type === "ClassMethod" && m.kind === "constructor"), ...body.filter((m) => !(m.type === "ClassMethod" && m.kind === "constructor"))];
    for (const member of ordered) {
      if (member.type === "ClassMethod" || member.type === "ClassPrivateMethod") enterFunction(member);
      else if (member.type === "StaticBlock") {
        thisStack.push(UNKNOWN);
        for (const stmt of member.body) walkNode(stmt);
        thisStack.pop();
      }
    }
    return value;
  };

  const evalRaw = (node) => {
    const current = unwrap(node);
    if (!current) return UNKNOWN;
    if (current !== node && current._value) return current._value;
    switch (current.type) {
      case "Identifier": {
        const found = look(current.name);
        if (found) return copyValue(found);
        if (current.name === "require" || current.name === "eval") return { kind: "evil", label: current.name };
        if (current.name === "Function") return { kind: "evil", label: "Function" };
        if (LANGUAGE.has(current.name)) return { kind: "skip", label: current.name, method: "" };
        return UNKNOWN;
      }
      case "ThisExpression":
        return thisStack.at(-1) || UNKNOWN;
      case "Super":
        return UNKNOWN;
      case "NumericLiteral":
        return NUMERIC;
      case "StringLiteral":
      case "BooleanLiteral":
      case "NullLiteral":
      case "BigIntLiteral":
      case "RegExpLiteral":
        return PLAIN;
      case "TemplateLiteral":
        for (const expr of current.expressions) evalExpr(expr);
        return PLAIN;
      case "TaggedTemplateExpression": {
        // A tagged template calls its tag with the strings and the substitutions. It is checked as that call.
        const strings = { type: "ArrayExpression", elements: [], start: current.quasi.start, end: current.quasi.end, parent: current };
        const synthetic = { type: "CallExpression", callee: current.tag, arguments: [strings, ...current.quasi.expressions], start: current.start, end: current.end, parent: current.parent, tagged: true };
        return evalCall(synthetic);
      }
      case "ObjectExpression":
        return objectValue(current);
      case "ArrayExpression": {
        const parts = [];
        for (const element of current.elements) {
          if (!element) continue;
          const spread = element.type === "SpreadElement";
          parts.push({ spread, value: evalExpr(spread ? element.argument : element) });
        }
        const hostParts = parts.filter((part) => hosty(part.value));
        // A single spread of a host list is that list, so forEach and map see its elements.
        if (parts.length === 1 && parts[0].spread && (parts[0].value.kind === "host" || parts[0].value.kind === "maybe") && parts[0].value.lineage) return copyValue(parts[0].value);
        return hostParts.length ? { kind: "container", label: "array" } : PLAIN;
      }
      case "FunctionExpression":
      case "ArrowFunctionExpression":
      case "FunctionDeclaration":
      case "ObjectMethod":
      case "ClassMethod":
      case "ClassPrivateMethod": {
        const info = enterFunction(current);
        return { kind: "fn", id: info.id, info, label: current.id?.name || "" };
      }
      case "ClassExpression":
      case "ClassDeclaration":
        return classValue(current);
      case "MemberExpression":
      case "OptionalMemberExpression": {
        const object = evalExpr(current.object);
        const key = keyOf(current);
        if (key.index) {
          if (object && (object.kind === "host" || object.kind === "maybe")) {
            const type = object.elementType || elementType(index, object.type);
            return { ...object, kind: "maybe", method: "", fromMethod: "", type, ownerType: "", elementType: "", seg: "" };
          }
          if (object && (object.kind === "container" || object.kind === "laundered")) return { kind: "laundered", label: `${object.label}[${key.name}]`, method: "" };
          if (object?.kind === "dynamic") return object;
          if (object?.kind === "self" || object?.kind === "instance") return object.cls.hosty ? { kind: "laundered", label: "this[index]", method: "" } : UNKNOWN;
          return UNKNOWN;
        }
        if (key.literal && key.name) return withType(access(object, key.name));
        if (object && (object.kind === "host" || object.kind === "maybe" || object.kind === "dynamic")) return { kind: "dynamic", label: `${object.label}[dynamic]`, method: "" };
        if (object && (object.kind === "container" || object.kind === "laundered")) return { kind: "laundered", label: `${object.label}[dynamic]`, method: "" };
        if (object?.kind === "skip" && GLOBAL_OBJECTS.has(object.label)) return { kind: "evil", label: `${object.label}[dynamic]` };
        if ((object?.kind === "self" || object?.kind === "instance") && object.cls.hosty) return { kind: "laundered", label: "this[dynamic]", method: "" };
        return UNKNOWN;
      }
      case "CallExpression":
      case "OptionalCallExpression":
      case "NewExpression":
        return evalCall(current);
      case "AwaitExpression": {
        const value = evalExpr(current.argument);
        return value && value.promise ? { ...value, promise: false } : value;
      }
      case "YieldExpression": {
        const value = evalExpr(current.argument);
        const info = fnStack.at(-1);
        if (info) info.yields = mergeValues(info.yields, current.delegate && hosty(value) ? { kind: "container", label: "yield*" } : value);
        return UNKNOWN;
      }
      case "UnaryExpression":
        evalExpr(current.argument);
        return current.operator === "-" || current.operator === "+" || current.operator === "~" ? NUMERIC : PLAIN;
      case "UpdateExpression":
        if (current.argument.type === "MemberExpression" || current.argument.type === "OptionalMemberExpression") memberWrite(current.argument, NUMERIC);
        else evalExpr(current.argument);
        return NUMERIC;
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
        if (current.left.type === "ArrayPattern" || current.left.type === "ObjectPattern") {
          patternWrite(current.left);
          return evalExpr(current.right);
        }
        if (current.left.type === "Identifier") {
          let value = evalExpr(current.right);
          if ((current.operator === "=" || current.operator === "||=" || current.operator === "??=" || current.operator === "&&=") && mutableExports.has(current.left.name) && fnStack.length && hosty(value)) {
            value = { kind: "dynamic", label: current.left.name, method: "", why: `exported let ${current.left.name} is assigned a host value inside a function, so importers do not see one stable owner class` };
            call("call", `${current.left.name} needs review: ${value.why}. Use a const import of the host binding`);
          }
          if (current.operator === "=" || current.operator === "||=" || current.operator === "??=" || current.operator === "&&=") {
            const before = look(current.left.name);
            rebind(current.left.name, current.operator === "=" ? value : mergeValues(before, value));
          }
          return value;
        }
        if (current.left.type === "MemberExpression" || current.left.type === "OptionalMemberExpression") {
          const value = evalExpr(current.right);
          memberWrite(current.left, value);
          return value;
        }
        evalExpr(current.left);
        evalExpr(current.right);
        return UNKNOWN;
      }
      case "BinaryExpression": {
        const left = evalExpr(current.left);
        const right = evalExpr(current.right);
        if (["-", "*", "/", "%", "**", "|", "&", "^", "<<", ">>", ">>>"].includes(current.operator)) return NUMERIC;
        if (current.operator === "+" && left?.numeric && right?.numeric) return NUMERIC;
        return PLAIN;
      }
      case "SpreadElement":
        return evalExpr(current.argument);
      case "ChainExpression":
        return evalExpr(current.expression);
      case "JSXElement":
      case "JSXFragment":
        for (const child of childNodes(current)) walkJsx(child);
        return PLAIN;
      default:
        for (const child of childNodes(current)) walkNode(child);
        return UNKNOWN;
    }
  };

  const walkJsx = (node) => {
    if (!node || node._done) return;
    if (node.type === "JSXExpressionContainer") {
      node._done = true;
      if (node.expression && node.expression.type !== "JSXEmptyExpression") evalExpr(node.expression);
      return;
    }
    if (node.type === "JSXSpreadAttribute" || node.type === "JSXSpreadChild") {
      node._done = true;
      evalExpr(node.argument || node.expression);
      return;
    }
    if (node.type === "JSXElement" || node.type === "JSXFragment") {
      evalExpr(node);
      return;
    }
    node._done = true;
    for (const child of childNodes(node)) walkJsx(child);
  };

  const walkFor = (node) => {
    node._done = true;
    const right = evalExpr(node.right);
    const element = node.type === "ForInStatement" ? PLAIN : elementOf(right);
    scopes.push(new Map());
    if (node.left.type === "VariableDeclaration") {
      node.left._done = true;
      for (const declarator of node.left.declarations) bindPattern(declarator.id, element);
    } else if (node.left.type === "Identifier") rebind(node.left.name, element);
    else if (node.left.type === "MemberExpression" || node.left.type === "OptionalMemberExpression") memberWrite(node.left, element);
    else patternWrite(node.left);
    walkNode(node.body);
    scopes.pop();
  };

  const walkNode = (node) => {
    if (!node || node._done) return;
    if (node.type === "VariableDeclaration") {
      node._done = true;
      for (const declarator of node.declarations) {
        if (declarator.init) {
          const init = evalExpr(declarator.init);
          bindPattern(declarator.id, init);
        } else {
          bindPattern(declarator.id, isAnyType(declarator.id.typeAnnotation) ? PLAIN : (name) => ({ kind: "unknown", label: name, method: "" }));
        }
      }
      return;
    }
    if (node.type === "ExpressionStatement") {
      node._done = true;
      evalExpr(node.expression);
      return;
    }
    if (node.type === "ReturnStatement") {
      node._done = true;
      if (node.argument) {
        const value = evalExpr(node.argument);
        const info = fnStack.at(-1);
        if (info) info.ret = mergeValues(info.ret, value);
      }
      return;
    }
    if (node.type === "ThrowStatement") {
      node._done = true;
      if (node.argument) evalExpr(node.argument);
      return;
    }
    if (node.type === "ForOfStatement" || node.type === "ForInStatement") {
      walkFor(node);
      return;
    }
    if (node.type === "ClassDeclaration") {
      node._done = true;
      evalExpr(node);
      return;
    }
    if (node.type === "CatchClause") {
      node._done = true;
      scopes.push(new Map());
      if (node.param) bindPattern(node.param, (name) => ({ kind: "unknown", label: name, method: "" }));
      walkNode(node.body);
      scopes.pop();
      return;
    }
    if (isFunctionNode(node)) {
      evalExpr(node);
      return;
    }
    if (node.type.startsWith("TS") && node.type !== "TSExportAssignment") {
      node._done = true;
      return;
    }
    if (node.type === "ImportDeclaration") {
      node._done = true;
      return;
    }
    if (node.type !== "Program" && node.type !== "BlockStatement" && node.type !== "ClassBody" && !node.type.endsWith("Statement") && !node.type.endsWith("Declaration") && node.type !== "SwitchCase" && node.type !== "VariableDeclarator" && node.type !== "StaticBlock") {
      evalExpr(node);
      return;
    }
    node._done = true;
    for (const child of childNodes(node)) walkNode(child);
  };

  const bindImport = (stmt) => {
    if (isTypeOnly(stmt)) return;
    const spec = stmt.source?.value || "";
    const resolved = moduleExports(spec, rel);
    for (const item of stmt.specifiers || []) {
      if (isTypeOnly(item)) continue;
      if (item.type === "ImportNamespaceSpecifier") {
        if (resolved.host) bind(item.local.name, hostRoot(resolved.host));
        else if (resolved.missing) bind(item.local.name, { kind: "dynamic", label: `${item.local.name} (import "${spec}" did not resolve)`, method: "" });
        else if (resolved.exports) {
          const carries = [...resolved.exports.values()].some(hosty);
          bind(item.local.name, carries ? { kind: "container", label: item.local.name } : PLAIN);
        } else bind(item.local.name, PLAIN);
      } else if (item.type === "ImportDefaultSpecifier") {
        if (resolved.host) bind(item.local.name, hostRoot(resolved.host));
        else if (resolved.exports) bind(item.local.name, resolved.exports.get("default") || UNKNOWN);
        else if (resolved.missing) bind(item.local.name, { kind: "dynamic", label: `${item.local.name} (import "${spec}" did not resolve)`, method: "" });
        else bind(item.local.name, PLAIN);
      } else if (item.type === "ImportSpecifier") {
        const imported = item.imported.type === "Identifier" ? item.imported.name : item.imported.value;
        if (resolved.host) bind(item.local.name, withType(access(hostRoot(resolved.host), imported)));
        else if (imported === "createRequire") bind(item.local.name, { kind: "evil", label: "createRequire" });
        else if (resolved.exports) bind(item.local.name, resolved.exports.get(imported) || UNKNOWN);
        else if (resolved.missing) bind(item.local.name, { kind: "dynamic", label: `${item.local.name} (import "${spec}" did not resolve)`, method: "" });
        else bind(item.local.name, PLAIN);
      }
    }
  };

  const hoist = (body) => {
    for (const stmt of body) {
      const decl = stmt.type === "ExportNamedDeclaration" || stmt.type === "ExportDefaultDeclaration" ? stmt.declaration : stmt;
      if (decl?.type === "FunctionDeclaration" && decl.id && !isTypeOnly(stmt)) {
        const info = infoFor(decl);
        bind(decl.id.name, { kind: "fn", id: info.id, info, label: decl.id.name });
      }
    }
  };

  const exportDeclaration = (stmt) => {
    if (stmt.type === "ExportDefaultDeclaration") {
      const decl = stmt.declaration;
      if (!decl) return;
      if (decl.id && look(decl.id.name)) exports.set("default", copyValue(look(decl.id.name)));
      else exports.set("default", copyValue(decl._value || evalExpr(decl)));
      return;
    }
    if (stmt.type === "ExportAllDeclaration") {
      const resolved = moduleExports(stmt.source.value, rel);
      if (resolved.exports) for (const [name, value] of resolved.exports) if (name !== "default") exports.set(name, copyValue(value));
      return;
    }
    if (stmt.source) {
      const resolved = moduleExports(stmt.source.value, rel);
      for (const spec of stmt.specifiers || []) {
        if (isTypeOnly(spec)) continue;
        const imported = spec.local?.name || spec.exported?.name;
        const exported = spec.exported.name || spec.exported.value;
        if (spec.type === "ExportNamespaceSpecifier") {
          exports.set(exported, resolved.host ? hostRoot(resolved.host) : { kind: "dynamic", label: exported, method: "" });
          continue;
        }
        if (resolved.host) exports.set(exported, imported === "default" ? hostRoot(resolved.host) : withType(access(hostRoot(resolved.host), imported)));
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
    if ((decl?.type === "FunctionDeclaration" || decl?.type === "ClassDeclaration") && decl.id) exports.set(decl.id.name, copyValue(look(decl.id.name) || UNKNOWN));
    if (decl?.type === "VariableDeclaration") {
      const names = [];
      const collectNames = (pattern) => {
        if (!pattern) return;
        if (pattern.type === "Identifier") names.push(pattern.name);
        else if (pattern.type === "ObjectPattern") pattern.properties.forEach((prop) => collectNames(prop.type === "RestElement" ? prop.argument : prop.value));
        else if (pattern.type === "ArrayPattern") pattern.elements.forEach((element) => collectNames(element));
        else if (pattern.type === "AssignmentPattern") collectNames(pattern.left);
        else if (pattern.type === "RestElement") collectNames(pattern.argument);
      };
      for (const declarator of decl.declarations) collectNames(declarator.id);
      for (const name of names) exports.set(name, copyValue(look(name) || UNKNOWN));
      if (decl.kind !== "const") for (const name of names) mutableExports.add(name);
    }
  };

  for (const stmt of ast.program.body) {
    if (stmt.type === "ImportDeclaration") bindImport(stmt);
  }
  hoist(ast.program.body);
  for (const stmt of ast.program.body) {
    if (stmt.type === "ExportNamedDeclaration" || stmt.type === "ExportDefaultDeclaration") {
      if (stmt.declaration) walkNode(stmt.declaration);
      stmt._done = true;
      exportDeclaration(stmt);
    } else if (stmt.type === "ExportAllDeclaration") {
      stmt._done = true;
      exportDeclaration(stmt);
    } else walkNode(stmt);
  }
  for (const name of mutableExports) {
    const value = scopes[0].get(name);
    if (value) exports.set(name, copyValue(value));
  }

  return {
    exports,
    summaries,
    raw: {
      findings,
      writes,
      seeds: [...seeds],
      callSites,
      functions: [...functions.values()].map((info) => ({ id: info.id, async: info.async }))
    }
  };
}

function safeFunctions(raw) {
  const safe = new Set();
  const seeds = new Set(raw.seeds);
  const sitesFor = new Map();
  for (const site of raw.callSites) {
    if (!sitesFor.has(site.calleeId)) sitesFor.set(site.calleeId, []);
    sitesFor.get(site.calleeId).push(site);
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const fn of raw.functions) {
      if (safe.has(fn.id)) continue;
      const sites = sitesFor.get(fn.id) || [];
      const callsOk = sites.every((site) => site.confers && site.inside && safe.has(site.inside));
      if ((seeds.has(fn.id) && callsOk) || (!seeds.has(fn.id) && sites.length && callsOk)) {
        safe.add(fn.id);
        changed = true;
      }
    }
  }
  return safe;
}

function writeFindings(raw) {
  const safe = safeFunctions(raw);
  const out = [];
  for (const write of raw.writes) {
    if (write.reflect) {
      out.push(`${write.target.label} on a host value needs review. Reflect is outside the accepted subset. ${RENAME_DYNAMIC}`);
      continue;
    }
    if (write.stored) {
      out.push(`${write.target.label || "stored host value"}.${write.key.literal ? write.key.name : "[dynamic]"} needs review. ${RENAME_STORED}`);
      continue;
    }
    const dynamic = write.target.kind === "dynamic" || !write.key.literal;
    if (dynamic) {
      out.push(`${write.target.label || "host value"}[dynamic] needs review. ${RENAME_DYNAMIC}`);
      continue;
    }
    if (write.key.name !== "name") continue;
    if (write.fn && safe.has(write.fn)) continue;
    out.push(RENAME_OUTSIDE);
  }
  return out;
}

function isTestPath(rel) {
  const name = String(rel || "").split(path.sep).join("/");
  return /(^|\/)(test|tests|__tests__)(\/|$)/.test(name) || /\.(test|spec)\.[cm]?[jt]sx?$/.test(name);
}

/** Every script and component file the package can ship is reviewed, including .vue and .svelte. */
export function isReviewedSource(rel) {
  return /\.(?:[cm]?[jt]sx?|vue|svelte)$/i.test(String(rel || "")) && !/\.d\.ts$/i.test(String(rel || ""));
}

function analyzeAll(feature, docText, project) {
  const memory = new Map();
  for (const item of feature || []) memory.set(String(item.rel || "").split(path.sep).join("/"), item.body);
  const cache = new Map();
  const loading = new Set();
  const merged = { findings: [], writes: [], seeds: [], callSites: [], functions: [] };
  const parseFailures = [];
  for (const item of feature || []) {
    const rel = String(item.rel || "").split(path.sep).join("/");
    if (isTestPath(rel) || !isReviewedSource(rel)) continue;
    try {
      const result = analyzeSource(item.body, rel, { docs: docText, project, memory, cache, loading, record: true });
      merged.findings.push(...result.raw.findings);
      merged.writes.push(...result.raw.writes);
      merged.seeds.push(...result.raw.seeds);
      merged.callSites.push(...result.raw.callSites);
      merged.functions.push(...result.raw.functions);
    } catch (error) {
      parseFailures.push(`${rel} host parse needs review: ${error instanceof Error ? error.message : "the file did not parse"}`);
    }
  }
  return { merged, parseFailures };
}

export function hostReview(feature, docText, project = "") {
  const { merged, parseFailures } = analyzeAll(feature, docText, project);
  const calls = [...new Set([...parseFailures, ...merged.findings.filter((item) => item.kind === "call").map((item) => item.text)])];
  const writes = [...new Set([...parseFailures, ...writeFindings(merged)])];
  return { calls, writes, findings: [...new Set([...calls, ...writes])] };
}

export function hostFindings(feature, docText, project = "") {
  return hostReview(feature, docText, project).findings;
}

export function hostCallFindings(feature, docText, project = "") {
  return hostReview(feature, docText, project).calls;
}

/** A parse failure is "needs review" for the rename check too. It never fails open. */
export function renameFindings(feature, docText, project = "") {
  return hostReview(feature, docText, project).writes;
}
