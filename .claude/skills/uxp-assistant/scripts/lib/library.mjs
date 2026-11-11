import fs from "node:fs";
import path from "node:path";
import { homeDir } from "../runtime/lib/paths.mjs";

/**
 * The docs library: every page Adobe lists for a host, saved as text on this computer.
 *
 * Adobe publishes a page list for each host (config.md). This reads that list, fetches each page,
 * converts it to markdown, and writes it under <dir>/pages/ with the same folders as the site.
 * Premiere also gets Adobe's TypeScript types, which hold exact signatures for the whole API.
 *
 * A page is fresh when this run fetched it. When a fetch fails and an older copy exists (in this
 * folder, or in the cache from a previous session), the older copy is kept and the page is stale.
 * A page with neither is failed. A fetch that fails never stops the session.
 */

const ORIGIN = "https://developer.adobe.com";

export const HOSTS = {
  ppro: {
    label: "Premiere Pro",
    config: `${ORIGIN}/premiere-pro/uxp/config.md`,
    types: [{ file: "premierepro.d.ts", url: "https://raw.githubusercontent.com/adobe/premierepro-types/main/src/premierepro.d.ts" }],
    core: ["plugins/concepts/manifest", "plugins/concepts/entrypoints", "introduction", "uxp-api/known-issues", "resources/fundamentals/user-interfaces"]
  },
  phxs: {
    label: "Photoshop",
    config: `${ORIGIN}/photoshop/uxp/2022/config.md`,
    types: [],
    core: ["guides/uxp-guide/uxp-misc/manifest-v5", "ps-reference/classes/photoshop", "ps-reference/known-issues", "uxp-api/known-issues", "guides/theme-awareness"]
  },
  idsn: {
    label: "InDesign",
    config: `${ORIGIN}/indesign/uxp/config.md`,
    types: [],
    core: ["introduction", "plugins/concepts/manifest", "plugins/tutorials/adding-command-entrypoints", "reference/uxp-api/known-issues"]
  },
  ame: {
    label: "Media Encoder",
    config: `${ORIGIN}/media-encoder/uxp/config.md`,
    types: [],
    core: ["get-started", "media-encoder-api"]
  },
  ilst: {
    label: "Illustrator",
    config: `${ORIGIN}/uxp/config.md`,
    types: [],
    core: ["guides/explanation/concepts/manifest", "guides/explanation/fundamentals/user-interfaces"]
  },
  aeft: {
    label: "After Effects",
    config: `${ORIGIN}/after-effects/uxp/config.md`,
    types: [],
    core: ["get-started", "after-effects-api/application", "after-effects-api/project"]
  }
};

const HOST_ALIASES = { premierepro: "ppro", PS: "phxs", ID: "idsn", AI: "ilst", aftereffects: "aeft", mediaencoder: "ame" };

export function hostKey(host) {
  const value = String(host || "");
  return HOSTS[value] ? value : HOST_ALIASES[value] || "";
}

/** `- [Title](/path/)` lines of a config.md, in page order, with the folder the line sits under. */
export function parseConfig(markdown) {
  const pages = [];
  const seen = new Set();
  const groups = [];
  for (const line of String(markdown || "").split("\n")) {
    const match = line.match(/^(\s*)-\s+(?:\[([^\]]+)\]\((\/[^)\s]*)\)|([^\[\n]+?))\s*$/);
    if (!match) continue;
    const depth = Math.floor(match[1].length / 2);
    if (match[4]) {
      const name = match[4].trim().replace(/:$/, "");
      groups.length = depth;
      groups[depth] = /^(pages|versions|pathPrefix)$/i.test(name) || name.startsWith("/") ? "" : name;
      continue;
    }
    const href = match[3].split("#")[0];
    if (!href || seen.has(href)) continue;
    seen.add(href);
    groups.length = Math.max(0, Math.min(groups.length, depth));
    pages.push({ title: match[2].trim(), path: href, url: `${ORIGIN}${href}`, group: groups.filter(Boolean).join(" / ") });
  }
  return pages;
}

/** The page's place in the library: /premiere-pro/uxp/ppro-reference/classes/project/ is ppro-reference/classes/project. */
export function pageFile(page, prefix) {
  let rel = page.path.replace(/^\/+|\/+$/g, "");
  if (prefix && rel.startsWith(prefix)) rel = rel.slice(prefix.length);
  rel = rel.replace(/^\/+/, "") || "index";
  rel = rel.split("/").map((part) => part.replace(/[^A-Za-z0-9._-]/g, "-")).join("/");
  return `pages/${rel}.md`;
}

function decode(text) {
  return String(text)
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, num) => String.fromCodePoint(Number(num)))
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&apos;/gi, "'")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&");
}

const VOID = new Set(["br", "hr", "img", "input", "meta", "link", "source", "wbr"]);
const SKIP = new Set(["script", "style", "noscript", "svg", "nav", "header", "footer"]);

/**
 * Adobe's pages as markdown. Headings, paragraphs, lists, code blocks, and tables survive.
 * Tables on these pages are rows of <div> cells, so a div table is read by depth.
 */
export function htmlToMarkdown(html) {
  const source = String(html || "");
  const mainAt = source.search(/<main[\s>]/i);
  const body = mainAt >= 0 ? source.slice(mainAt) : source;
  const tokens = body.matchAll(/<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>|<!--[\s\S]*?-->|([^<]+)/g);
  let out = "";
  let pre = 0;
  let skip = 0;
  let divDepth = 0;
  let tableAt = -1;
  let cellOpen = false;
  const title = (source.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || "";
  const emit = (text) => { out += text; };
  for (const token of tokens) {
    if (token[4] !== undefined) {
      if (skip) continue;
      if (pre) emit(decode(token[4]));
      else emit(decode(token[4]).replace(/\s+/g, " "));
      continue;
    }
    if (!token[2]) continue;
    const closing = token[1] === "/";
    const name = token[2].toLowerCase();
    const attrs = token[3] || "";
    if (SKIP.has(name)) {
      if (closing) skip = Math.max(0, skip - 1);
      else if (!/\/\s*$/.test(attrs)) skip += 1;
      continue;
    }
    if (skip) continue;
    if (VOID.has(name)) {
      if (name === "br") emit("\n");
      if (name === "hr") emit("\n\n---\n\n");
      continue;
    }
    if (name === "div") {
      if (!closing) {
        divDepth += 1;
        if (tableAt < 0 && /class\s*=\s*"[^"]*\btable\b/.test(attrs)) {
          tableAt = divDepth;
          emit("\n\n");
        } else if (tableAt >= 0 && divDepth === tableAt + 1) {
          emit("\n|");
        } else if (tableAt >= 0 && divDepth === tableAt + 2) {
          emit(" ");
          cellOpen = true;
        }
      } else {
        if (tableAt >= 0 && divDepth === tableAt + 2 && cellOpen) {
          emit(" |");
          cellOpen = false;
        } else if (tableAt >= 0 && divDepth === tableAt) {
          emit("\n\n");
          tableAt = -1;
        } else if (tableAt < 0) emit("\n");
        divDepth -= 1;
      }
      continue;
    }
    if (/^h[1-6]$/.test(name)) {
      emit(closing ? "\n\n" : `\n\n${"#".repeat(Number(name[1]))} `);
      continue;
    }
    if (name === "p" || name === "ul" || name === "ol" || name === "blockquote" || name === "section") {
      if (tableAt < 0) emit("\n\n");
      continue;
    }
    if (name === "li") {
      if (!closing) emit("\n- ");
      continue;
    }
    if (name === "tr") {
      if (!closing) emit("\n|");
      continue;
    }
    if (name === "td" || name === "th") {
      emit(closing ? " |" : " ");
      continue;
    }
    if (name === "pre") {
      if (!closing) {
        pre += 1;
        emit("\n\n```\n");
      } else {
        pre = Math.max(0, pre - 1);
        emit("\n```\n\n");
      }
      continue;
    }
    if (name === "code" && !pre && tableAt < 0) emit("`");
  }
  let text = out
    .replace(/```\n(?:data-[a-z-]+=[^\n]*\n?\s*)+```\n*/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\|[ ]+\|/g, "| |")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const heading = decode(title).replace(/\s*[—-]\s*UXP.*$/i, "").trim();
  if (!/^#\s/.test(text) && heading) text = `# ${heading}\n\n${text}`;
  return text;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchText(fetchImpl, url, { timeoutMs, retries }) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetchImpl(url, { headers: { accept: "text/html, text/plain, */*", "user-agent": "uxp-assistant" }, signal: AbortSignal.timeout(timeoutMs) });
      if (!response.ok) {
        const error = new Error(`HTTP ${response.status}`);
        error.status = response.status;
        throw error;
      }
      const text = await response.text();
      if (!String(text).trim()) throw new Error("Empty page.");
      return text;
    } catch (error) {
      lastError = error;
      if (error.status === 404) break;
      if (attempt < retries) await sleep(300 * (attempt + 1));
    }
  }
  throw lastError;
}

async function pool(items, size, worker) {
  let next = 0;
  const run = async () => {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      await worker(items[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, run));
}

export function cacheDir(host) {
  return path.join(homeDir(), "library", hostKey(host) || "shared");
}

function readIfExists(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

function frontMatter(page, fetchedAt) {
  return `---\ntitle: ${JSON.stringify(page.title)}\nurl: ${page.url}\nfetched: ${fetchedAt}\n---\n\n`;
}

/**
 * Build the library for one host in `dir`.
 * Returns { ok, host, label, fresh, stale, failed, pages, summary }. `ok` is true when the library has
 * enough to work from: a page list and at least half of its pages, fresh or kept from before.
 */
export async function buildLibrary({
  host,
  dir,
  fetchImpl = globalThis.fetch,
  concurrency = 16,
  pageTimeoutMs = 15000,
  budgetMs = 150000,
  retries = 1,
  onProgress = () => {},
  cache = true,
  now = () => new Date().toISOString()
} = {}) {
  const key = hostKey(host);
  if (!key) throw new Error(`Unknown host "${host}". Hosts are ${Object.keys(HOSTS).join(", ")}.`);
  const spec = HOSTS[key];
  const cacheRoot = cache ? cacheDir(key) : "";
  fs.mkdirSync(path.join(dir, "pages"), { recursive: true });
  const fetchedAt = now();
  const deadline = Date.now() + budgetMs;

  let listing = null;
  let listingError = "";
  try {
    const markdown = await fetchText(fetchImpl, spec.config, { timeoutMs: pageTimeoutMs, retries: 2 });
    listing = parseConfig(markdown);
    if (!listing.length) throw new Error("The page list was empty.");
    fs.writeFileSync(path.join(dir, "config.md"), markdown);
    if (cacheRoot) {
      fs.mkdirSync(cacheRoot, { recursive: true });
      fs.writeFileSync(path.join(cacheRoot, "config.md"), markdown);
    }
  } catch (error) {
    listingError = error.message || String(error);
    const kept = readIfExists(path.join(dir, "config.md")) || (cacheRoot && readIfExists(path.join(cacheRoot, "config.md")));
    if (kept) listing = parseConfig(kept);
  }
  if (!listing || !listing.length) {
    const summary = { host: key, label: spec.label, ok: false, fetchedAt, error: `Could not read Adobe's page list: ${listingError}`, fresh: [], stale: [], failed: [], pages: [] };
    fs.writeFileSync(path.join(dir, "library.json"), `${JSON.stringify(summary, null, 2)}\n`);
    return summary;
  }

  const prefix = `${spec.config.replace(ORIGIN, "").replace(/config\.md$/, "").replace(/^\/+|\/+$/g, "")}/`;
  const entries = listing.map((page) => {
    const trimmed = page.path.replace(/^\/+|\/+$/g, "");
    const id = (trimmed.startsWith(prefix) ? trimmed.slice(prefix.length) : trimmed) || "index";
    return { ...page, file: pageFile(page, prefix), id };
  });
  const results = new Array(entries.length);
  let done = 0;
  const total = entries.length + spec.types.length;

  await pool(entries, concurrency, async (entry, index) => {
    const dest = path.join(dir, entry.file);
    const cached = cacheRoot ? path.join(cacheRoot, entry.file) : "";
    let result;
    if (Date.now() >= deadline) {
      result = { error: "The docs time budget ran out." };
    } else {
      try {
        const remaining = Math.max(1000, Math.min(pageTimeoutMs, deadline - Date.now()));
        const html = await fetchText(fetchImpl, entry.url, { timeoutMs: remaining, retries });
        const markdown = htmlToMarkdown(html);
        if (markdown.length < 40) {
          results[index] = { id: entry.id, title: entry.title, url: entry.url, file: entry.file, group: entry.group, freshness: "empty", bytes: 0 };
          done += 1;
          onProgress({ done, total, page: entry.title, freshness: "empty" });
          return;
        }
        const text = `${frontMatter(entry, fetchedAt)}${markdown}\n`;
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, text);
        if (cached) {
          fs.mkdirSync(path.dirname(cached), { recursive: true });
          fs.writeFileSync(cached, text);
        }
        result = { freshness: "fresh", bytes: text.length };
      } catch (error) {
        result = { error: error.message || String(error) };
      }
    }
    if (!result.freshness) {
      const keptHere = fs.existsSync(dest);
      const keptCache = !keptHere && cached && fs.existsSync(cached);
      if (keptCache) {
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.copyFileSync(cached, dest);
      }
      result = keptHere || keptCache
        ? { freshness: "stale", bytes: fs.statSync(dest).size, error: result.error }
        : { freshness: "failed", bytes: 0, error: result.error };
    }
    results[index] = { id: entry.id, title: entry.title, url: entry.url, file: entry.file, group: entry.group, ...result };
    done += 1;
    onProgress({ done, total, page: entry.title, freshness: result.freshness });
  });

  const typeResults = [];
  for (const type of spec.types) {
    const dest = path.join(dir, "api", type.file);
    const cached = cacheRoot ? path.join(cacheRoot, "api", type.file) : "";
    let result;
    try {
      const text = await fetchText(fetchImpl, type.url, { timeoutMs: pageTimeoutMs * 2, retries });
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, text);
      if (cached) {
        fs.mkdirSync(path.dirname(cached), { recursive: true });
        fs.writeFileSync(cached, text);
      }
      result = { freshness: "fresh", bytes: text.length };
    } catch (error) {
      const kept = fs.existsSync(dest) || (cached && fs.existsSync(cached));
      if (kept && !fs.existsSync(dest)) {
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.copyFileSync(cached, dest);
      }
      result = kept ? { freshness: "stale", bytes: fs.statSync(dest).size, error: error.message } : { freshness: "failed", bytes: 0, error: error.message };
    }
    done += 1;
    onProgress({ done, total, page: type.file, freshness: result.freshness });
    typeResults.push({ id: `api/${type.file}`, title: `${spec.label} TypeScript types`, url: type.url, file: `api/${type.file}`, group: "API types", ...result });
  }

  const pages = [...results, ...typeResults];
  const fresh = pages.filter((page) => page.freshness === "fresh").map((page) => page.id);
  const stale = pages.filter((page) => page.freshness === "stale").map((page) => page.id);
  const failed = pages.filter((page) => page.freshness === "failed").map((page) => page.id);
  const have = fresh.length + stale.length;
  const listed = pages.filter((page) => page.freshness !== "empty").length;
  const summary = {
    host: key,
    label: spec.label,
    ok: have >= Math.ceil(listed / 2),
    complete: failed.length === 0 && stale.length === 0,
    fetchedAt,
    listError: listingError,
    fresh,
    stale,
    failed,
    pages
  };
  writeIndex(dir, summary);
  writeLimits(dir);
  fs.writeFileSync(path.join(dir, "library.json"), `${JSON.stringify(summary, null, 2)}\n`);
  return summary;
}

const START_HERE = [
  { match: /\/introduction\/?$|^introduction$/, label: "Host introduction" },
  { match: /manifest/, label: "Manifest" },
  { match: /entrypoints/, label: "Entrypoints and panels" },
  { match: /known-issues/, label: "Known issues" },
  { match: /user-interfaces/, label: "User interfaces" },
  { match: /filesystem/, label: "Filesystem" }
];

function writeIndex(dir, summary) {
  const lines = [`# ${summary.label} UXP docs`, "", `Saved ${summary.fetchedAt}. ${summary.fresh.length} fresh, ${summary.stale.length} stale, ${summary.failed.length} failed.`, "", "Search: `node scripts/skill.mjs find <words>`. Read a page by opening its file below. Limits: `LIMITS.md`.", ""];
  const have = summary.pages.filter((page) => page.freshness === "fresh" || page.freshness === "stale");
  const api = have.filter((page) => page.file.startsWith("api/"));
  if (api.length) {
    lines.push("## Exact API (TypeScript)", "");
    for (const page of api) lines.push(`- \`${page.file}\` (${page.bytes} bytes). Every class, method, and parameter, with types.`);
    lines.push("");
  }
  const start = [];
  for (const rule of START_HERE) {
    const hit = have.find((page) => rule.match.test(page.id) && !start.includes(page));
    if (hit) start.push(hit);
  }
  if (start.length) {
    lines.push("## Start here", "");
    for (const page of start) lines.push(`- ${page.title}: \`${page.file}\``);
    lines.push("");
  }
  const groups = new Map();
  for (const page of have.filter((item) => !item.file.startsWith("api/"))) {
    const group = page.group || "Pages";
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(page);
  }
  for (const [group, list] of groups) {
    lines.push(`## ${group}`, "");
    for (const page of list) lines.push(`- ${page.title}: \`${page.file}\``);
    lines.push("");
  }
  if (summary.failed.length) lines.push("## Not saved", "", ...summary.pages.filter((page) => page.freshness === "failed").map((page) => `- ${page.title}: ${page.url} (${page.error || "failed"})`), "");
  fs.writeFileSync(path.join(dir, "INDEX.md"), `${lines.join("\n")}\n`);
}

const LIMIT_PAGES = [/known-issues/, /unsupported/, /html-canvas-element$/, /canvas-rendering-context2-d$/, /reference-css\/styles\/?$|reference-css\/styles\/index|css-styles/];

/** One file with the limits Adobe documents, so the agent reads them before it writes UI. */
function writeLimits(dir) {
  const files = [];
  const walk = (folder) => {
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      const full = path.join(folder, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".md")) files.push(full);
    }
  };
  if (fs.existsSync(path.join(dir, "pages"))) walk(path.join(dir, "pages"));
  const picked = files.filter((file) => {
    const rel = path.relative(path.join(dir, "pages"), file).replace(/\.md$/, "");
    return LIMIT_PAGES.some((rule) => rule.test(rel)) || /unsupported/.test(rel) || /known-issues/.test(rel);
  }).sort();
  const parts = ["# Limits Adobe documents for UXP", "", "These come from the saved pages. Follow a limit that is here. Do not invent one that is not.", ""];
  for (const file of picked) {
    const text = fs.readFileSync(file, "utf8").replace(/^---[\s\S]*?---\s*/, "");
    parts.push(`## ${path.relative(path.join(dir, "pages"), file)}`, "", text.trim().slice(0, 12000), "");
  }
  fs.writeFileSync(path.join(dir, "LIMITS.md"), `${parts.join("\n")}\n`);
}

/** Every saved text file in the library, with its path relative to `dir`. */
export function libraryFiles(dir) {
  const found = [];
  const walk = (folder) => {
    if (!fs.existsSync(folder)) return;
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      const full = path.join(folder, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".md") || entry.name.endsWith(".d.ts")) found.push(path.relative(dir, full));
    }
  };
  walk(path.join(dir, "pages"));
  walk(path.join(dir, "api"));
  return found;
}

const NOISE = new Set(["the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "with", "that", "this", "is", "are", "it", "by", "as", "at", "be", "plugin", "create", "high", "quality", "make", "build", "premiere", "pro", "photoshop", "indesign", "adobe", "uxp"]);

export function searchTerms(query) {
  const words = String(query || "").toLowerCase().match(/[a-z0-9_.$]+/g) || [];
  const terms = [];
  for (const word of words) {
    if (word.length < 2 || NOISE.has(word)) continue;
    if (!terms.includes(word)) terms.push(word);
  }
  return terms;
}

/**
 * Search the saved pages. A hit in a page's name counts most, then its headings, then its text.
 * Returns the best files with the lines that matched.
 */
export function findInLibrary(dir, query, { limit = 8, lines = 3 } = {}) {
  const exact = String(query || "").trim();
  const terms = searchTerms(query);
  if (!terms.length) return { terms, results: [] };
  // A camelCase word in the query ("getFileForSaving") names a member. It counts for far more than "write".
  const members = exact.split(/[^A-Za-z0-9_]+/).filter((word) => /[a-z][A-Z]/.test(word)).map((word) => word.toLowerCase());
  const rankings = [];
  for (const rel of libraryFiles(dir)) {
    const text = fs.readFileSync(path.join(dir, rel), "utf8");
    const lower = text.toLowerCase();
    const nameLower = rel.toLowerCase();
    let score = 0;
    let matched = 0;
    for (const term of terms) {
      const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const word = new RegExp(`(?<![a-z0-9_])${escaped}`, "g");
      const count = Math.min((lower.match(word) || []).length, 40);
      if (!count) continue;
      matched += 1;
      score += Math.min(count, 40);
      if (nameLower.includes(term)) score += 40;
      const heading = new RegExp(`^#{1,4}\\s+.*${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "im");
      if (heading.test(text)) score += 25;
    }
    if (!matched) continue;
    for (const member of members) {
      const escapedMember = member.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (new RegExp(`^#{1,4}\\s+${escapedMember}\\b`, "im").test(lower)) score += 120;
      else if (lower.includes(member)) score += 30 + Math.min((lower.match(new RegExp(escapedMember, "g")) || []).length, 10) * 3;
    }
    score *= 1 + matched / terms.length;
    if (exact.length > 3 && lower.includes(exact.toLowerCase())) score += 60;
    rankings.push({ rel, score, text });
  }
  rankings.sort((a, b) => b.score - a.score);
  const results = rankings.slice(0, limit).map((item) => {
    const rows = item.text.replace(/^---[\s\S]*?\n---\s*/, "").split("\n");
    // The lines that match the most words win, not the first ones. A heading or a table row of the member the
    // query names ("## importFiles()") beats a header row that happens to share one word.
    const scored = [];
    let section = "";
    const hasTerm = (text, term) => new RegExp(`(?<![a-z0-9_])${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(text);
    rows.forEach((row, index) => {
      const heading = /^#{2,4}\s+(.*)$/.exec(row);
      if (heading) section = heading[1].trim();
      if (row.trim().length <= 2) return;
      const lowerRow = row.toLowerCase();
      const own = terms.filter((term) => hasTerm(lowerRow, term)).length;
      const inSection = heading ? 0 : terms.filter((term) => section && hasTerm(section.toLowerCase(), term)).length;
      if (!own) return;
      const text = row.trim().slice(0, 200);
      scored.push({ index, row: !heading && section ? `${section}: ${text}`.slice(0, 220) : text, weight: own * 10 + inSection * 5 + (heading ? 4 : 0) + (/^\|\s*\w/.test(row) ? 2 : 0) });
    });
    scored.sort((a, b) => b.weight - a.weight || a.index - b.index);
    const snippets = scored.slice(0, lines).sort((a, b) => a.index - b.index).map((item) => item.row);
    return { file: item.rel, score: Math.round(item.score), lines: snippets };
  });
  return { terms, results };
}
