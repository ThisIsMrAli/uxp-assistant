/**
 * Members the fetched API pages document, by owner class.
 * A name that appears only in prose ("rename the history state") is not a documented member.
 * A member counts when a page lists it in a property table, as a versioned method entry,
 * as a camelCase API token, as a code call such as `.batchPlay(`, or on its own line.
 */

const cache = new Map();

function decode(text) {
  return String(text || "")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, num) => String.fromCodePoint(Number(num)))
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&");
}

function baseType(type) {
  let value = String(type || "").trim();
  const promise = value.match(/^Promise\s*<\s*([A-Za-z_$][\w$.]*)/);
  if (promise) value = promise[1];
  value = value.replace(/\[\]$/, "").replace(/[<>|].*$/, "");
  return value;
}

function pageMembers(text) {
  const members = new Set();
  const props = new Map();
  for (const match of text.matchAll(/\b([A-Za-z_$][\w$]*)\s+([A-Za-z_$][\w$.]*(?:\s*\[\])?)\s+R(?:\s+W)?\s+\d+(?:\.\d+)+/g)) {
    members.add(match[1]);
    if (!props.has(match[1])) props.set(match[1], match[2].replace(/\s+/g, ""));
  }
  for (const match of text.matchAll(/\b([a-z_$][\w$]*)\s+\d+\.\d+(?:\.\d+)?\s+(?:async\s*:\s*)?(?:Promise|void|boolean|number|string|any|[A-Z][\w$]*)/g)) members.add(match[1]);
  for (const match of text.matchAll(/\b([a-z][a-z0-9]*[A-Z][A-Za-z0-9]*)\b/g)) members.add(match[1]);
  for (const match of text.matchAll(/\.([A-Za-z_$][\w$]*)\s*\(/g)) members.add(match[1]);
  for (const match of text.matchAll(/\b([a-z_$][\w$]*)\s*\(\s*\)/g)) members.add(match[1]);
  return { members, props };
}

const PRIMITIVE = new Set(["number", "string", "boolean", "void", "any", "object", "undefined", "null"]);

/**
 * Return types of the methods a page documents, in the two shapes the fetched reference pages use:
 *  - Photoshop: `createLayer 23.0 async : Promise Layer >`, `batchPlaySync 23.1 ActionDescriptor[]`;
 *  - Premiere: `getActiveSequence Get the active sequence Since: 25.6 Returns: Promise Sequence >`.
 * A type is kept only when it is a fetched class page, an array of one, or a primitive.
 */
function methodReturns(line, pages) {
  const out = [];
  const keep = (type) => {
    const raw = String(type || "").replace(/\s+/g, "");
    if (!raw) return "";
    if (PRIMITIVE.has(raw)) return raw;
    const base = raw.replace(/\[\]$/, "");
    if (pages.has(base) || /\[\]$/.test(raw) || /^[A-Z][\w$]*\.[A-Z][\w$]*$/.test(raw)) return raw;
    return "";
  };
  for (const match of line.matchAll(/\b([a-z_$][\w$]*)\s+\d+\.\d+(?:\.\d+)?\s+(?:async\s*:\s*)?(?:(Promise)\s*<?\s*(?:([A-Za-z_$][\w$.]*(?:\s*\[\s*\])?)\s*>)?|([A-Za-z_$][\w$]*(?:\s*\[\s*\])?)(?=\s))/g)) {
    const promise = Boolean(match[2]);
    out.push([match[1], keep(promise ? match[3] : match[4]), promise]);
  }
  let previous = 0;
  for (const match of line.matchAll(/Since:\s*\d+(?:\.\d+)*\s+Returns:\s*(?:(Promise)\s*<?\s*)?([A-Za-z_$][\w$.]*(?:\s*\[\s*\])?)/g)) {
    const segment = line.slice(previous, match.index);
    previous = match.index + match[0].length;
    const cuts = [0];
    for (const cut of segment.matchAll(/\s(?:-|>)\s|\b(?:Static Methods|Instance Methods|Methods)\s/g)) cuts.push(cut.index + cut[0].length);
    let method = "";
    for (let i = cuts.length - 1; i >= 0 && !method; i -= 1) {
      const head = segment.slice(cuts[i]).trim().match(/^([a-z_$][\w$]*)\s+\S/);
      if (head) method = head[1];
    }
    if (!method) continue;
    const promise = Boolean(match[1]) || match[2] === "Promise";
    out.push([method, match[2] === "Promise" ? "" : keep(match[2]), promise]);
  }
  return out;
}

export function docIndex(docs) {
  const key = String(docs || "");
  if (cache.has(key)) return cache.get(key);
  const text = decode(key);
  const pages = new Map();
  const global = new Set();
  const propTypes = new Map();
  const returns = new Map();
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (/^[A-Za-z_$][\w$]*$/.test(trimmed)) {
      global.add(trimmed);
      continue;
    }
    const { members, props } = pageMembers(trimmed);
    for (const member of members) global.add(member);
    for (const [name, type] of props) {
      if (!propTypes.has(name)) propTypes.set(name, new Set());
      propTypes.get(name).add(baseType(type));
    }
    const words = trimmed.split(/\s+/);
    if (words.length > 20 && words[0] === words[1] && /^[A-Za-z_$][\w$]*$/.test(words[0])) {
      const owner = words[0];
      const previous = pages.get(owner);
      if (previous) for (const member of members) previous.add(member);
      else pages.set(owner, new Set(members));
    }
  }
  const asyncReturns = new Set();
  const owned = new Map();
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    const words = trimmed.split(/\s+/);
    const owner = words.length > 20 && words[0] === words[1] && /^[A-Za-z_$][\w$]*$/.test(words[0]) ? words[0] : "";
    for (const [method, type, promise] of methodReturns(trimmed, pages)) {
      if (promise) asyncReturns.add(method);
      if (!type) continue;
      if (owner && !owned.has(`${owner}.${method}`)) owned.set(`${owner}.${method}`, type);
      if (!returns.has(method)) returns.set(method, type);
    }
  }
  for (const match of text.matchAll(/\b([a-z_$][\w$]*)\s+\d+\.\d+(?:\.\d+)?\s+(?:async\s*:\s*)?Promise\b/g)) asyncReturns.add(match[1]);
  const calls = new Set();
  for (const match of text.matchAll(/\b([A-Za-z_$][\w$]*)\s*\.\s*([A-Za-z_$][\w$]*)\s*\(/g)) calls.add(`${match[1]}.${match[2]}`);
  const index = { pages, global, propTypes, returns, owned, asyncReturns, calls };
  cache.set(key, index);
  return index;
}

/** The documented type of a property, when every page that lists it agrees. */
export function propertyType(index, ownerType, name) {
  const types = index.propTypes.get(name);
  if (!types || types.size !== 1) return "";
  return [...types][0];
}

/** Collections such as Layers hold Layer items when a Layer page was fetched. */
export function elementType(index, type) {
  if (!type) return "";
  const raw = String(type);
  if (raw.endsWith("[]")) return raw.slice(0, -2);
  if (raw.endsWith("s") && index.pages.has(raw.slice(0, -1))) return raw.slice(0, -1);
  return "";
}

export function isCollectionType(type) {
  return /s$|\[\]$|Collection$|List$/.test(String(type || ""));
}

/**
 * The class a member of a host module has: photoshop.action is photoshopAction, photoshop.core is photoshopCore,
 * photoshop.app is the Photoshop class, and premierepro.Project is the Project class.
 * The name is returned even without a fetched page, so a call on it is matched to that owner or needs review.
 */
export function hostModuleType(index, root, name) {
  if (root === "photoshop" && name === "app") return "Photoshop";
  if (root === "premierepro" && /^[A-Z]/.test(name)) return name;
  const candidate = `${root}${name.charAt(0).toUpperCase()}${name.slice(1)}`;
  if (index.pages.has(candidate)) return candidate;
  if (root === "photoshop" && (name === "action" || name === "core")) return candidate;
  return "";
}

/**
 * Whether `method` is documented for a receiver of `type`.
 * With a fetched page for the owner class, the method must be on that page.
 * Without one, it must be a documented member somewhere, not a prose word.
 */
export function documentedMember(index, type, method) {
  if (type && index.pages.has(type)) return { ok: index.pages.get(type).has(method), owner: type };
  return { ok: index.global.has(method), owner: "" };
}

/** Whether the docs say this method returns a Promise, so then, catch, and finally are the Promise's. */
export function returnsPromise(index, method) {
  return Boolean(index.asyncReturns && index.asyncReturns.has(method));
}

/** The documented return type of `method`, for its owner class when that page was fetched. */
export function returnType(index, method, owner = "") {
  if (owner && index.pages.has(owner)) return index.owned.get(`${owner}.${method}`) || "";
  return index.returns.get(method) || "";
}

/** Whether a fetched page shows `receiver.method(` in code, such as `core.executeAsModal(` or `entrypoints.setup(`. */
export function calledOn(index, receiver, method) {
  return Boolean(receiver && index.calls.has(`${receiver}.${method}`));
}

/**
 * Whether a docs page set was fetched as one line per page, the shape docIndex reads.
 * Each page's whitespace is collapsed so a page with line breaks keeps its owner and members together.
 */
export function joinPages(texts) {
  return (texts || []).map((text) => String(text || "").replace(/\s+/g, " ").trim()).filter(Boolean).join("\n");
}
