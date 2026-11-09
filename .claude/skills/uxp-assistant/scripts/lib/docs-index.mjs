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
  for (const match of text.matchAll(/Returns:\s*(?:Promise\s*<\s*([A-Za-z_][\w]*)|([A-Za-z_][\w]*))/g)) {
    const type = match[1] || match[2];
    const before = text.slice(Math.max(0, match.index - 240), match.index);
    const names = [...before.matchAll(/\b([a-z][A-Za-z0-9]*)\b/g)];
    const method = names.at(-1)?.[1];
    if (method && type && type !== "Promise" && !returns.has(method)) returns.set(method, type);
  }
  const index = { pages, global, propTypes, returns };
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

export function hostModuleType(index, root, name) {
  const candidate = `${root}${name.charAt(0).toUpperCase()}${name.slice(1)}`;
  return index.pages.has(candidate) ? candidate : "";
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

export function returnType(index, method) {
  return index.returns.get(method) || "";
}
