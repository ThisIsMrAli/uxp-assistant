import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { readZip } from "./archive.mjs";
import { goalWasReplaced } from "./contract.mjs";
import { readScripts } from "./package-project.mjs";

export const REVIEW_LIMIT = "These checks are bounded automated evidence: a changed file uses a documented API symbol the starter did not already contain, a test imports that module and asserts something other than a tautology, and every new archive contains that symbol. They are not semantic proof. Command success is not feature correctness and not a host pass. Source and behavior review is still pending. The Adobe host was NOT TESTED.";

const STOP = new Set(["the", "a", "an", "in", "on", "to", "for", "of", "and", "or", "with", "each", "into", "from", "panel", "show", "read", "list", "display", "using", "use", "plugin", "feature", "please", "that", "this", "its", "not", "are", "was", "were", "goal", "string", "number", "boolean", "object", "array", "function", "promise", "layers", "layer", "document"]);
const PACKAGING = new Set(["uxp.config.ts", "vite.config.ts", "vite.config.js"]);
const TYPE_WORD = "string|number|boolean|object|array|function|Promise|Layers|Layer|Document";

function sha(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

function emptySnapshot() {
  return {
    files: {},
    archives: [],
    scripts: { test: "", build: "", ccx: "" },
    commandFiles: {},
    packaging: {},
    surface: ""
  };
}

export function snapshotProject(project) {
  const snap = emptySnapshot();
  if (!project || !fs.existsSync(project)) return snap;
  const surfaces = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "dist") continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      const rel = path.relative(project, full);
      if (entry.name.endsWith(".ccx") || entry.name.endsWith(".zip")) {
        const data = fs.readFileSync(full);
        snap.archives.push({ file: rel, bytes: data.length, sha256: crypto.createHash("sha256").update(data).digest("hex") });
      } else if (/\.(jsx?|tsx?|mjs|cjs|css|html|json|md)$/.test(entry.name)) {
        const text = fs.readFileSync(full, "utf8");
        snap.files[rel] = sha(text);
        if (/\.(jsx?|tsx?|mjs|cjs)$/.test(entry.name)) surfaces.push(codeSurface(text));
        if (PACKAGING.has(rel)) snap.packaging[rel] = sha(text);
      }
    }
  };
  walk(project);
  const scripts = readScripts(project) || {};
  snap.scripts = { test: scripts.test || "", build: scripts.build || "", ccx: scripts.ccx || "" };
  for (const rel of commandRefs(`${snap.scripts.build}\n${snap.scripts.ccx}`)) {
    const full = path.join(project, rel);
    if (fs.existsSync(full) && fs.statSync(full).isFile()) snap.commandFiles[rel] = sha(fs.readFileSync(full));
  }
  snap.surface = surfaces.join("\n");
  return snap;
}

export function isNoopTestScript(script) {
  const text = String(script || "").replace(/\s+/g, " ").trim();
  if (!text) return true;
  if (/node --test|\bvitest\b|\bjest\b|\bmocha\b|\.test\.|\.spec\./.test(text)) return false;
  return /process\.exit\s*\(\s*0\s*\)/.test(text) || text === "true" || text === "exit 0";
}

function commandRefs(script) {
  const found = [];
  for (const match of String(script || "").matchAll(/(?:^|[;&|\n])\s*node(?:\s+--[\w=-]+)*\s+([^\s"'&|;]+)/g)) {
    const rel = match[1];
    if (!rel.startsWith("-") && /\.(mjs|cjs|js|ts)$/.test(rel)) found.push(rel);
  }
  return [...new Set(found)];
}

function phrases(goal) {
  const raw = String(goal || "").toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length >= 4 && !STOP.has(word));
  const found = [];
  for (let i = 0; i < raw.length - 1; i += 1) found.push(`${raw[i]} ${raw[i + 1]}`);
  return found;
}

function identifiers(text) {
  const found = new Set();
  for (const match of String(text || "").matchAll(/\b[a-z]+[A-Z][A-Za-z0-9]*\b/g)) found.add(match[0]);
  for (const match of String(text || "").matchAll(/\b[A-Za-z_][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_.]*\b/g)) found.add(match[0]);
  return [...found];
}

export function evidenceTokens(contract) {
  const quotes = (contract?.evidence || []).map((item) => item.quote || "").join("\n");
  const goal = contract?.goal || "";
  const tokens = new Set(identifiers(`${goal}\n${quotes}`));
  for (const phrase of phrases(goal)) {
    if (quotes.toLowerCase().includes(phrase)) tokens.add(phrase);
  }
  return [...tokens];
}

/** Symbols a fresh page actually names, not every word in the goal sentence. */
export function apiSymbols(contract) {
  const symbols = new Set();
  for (const item of contract?.evidence || []) {
    const chunks = [item.token, item.quote].filter(Boolean).join("\n");
    for (const id of identifiers(chunks)) symbols.add(id);
    for (const match of chunks.matchAll(new RegExp(`\\b([A-Za-z_][A-Za-z0-9_]*)\\b\\s+(?:${TYPE_WORD})\\b`, "gi"))) symbols.add(match[1]);
    for (const match of chunks.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\b\s+is\s+a\s+(?:read\/write\s+|read-write\s+)?(?:string|number|boolean)\b/gi)) symbols.add(match[1]);
  }
  return [...symbols].filter((symbol) => {
    if (STOP.has(symbol.toLowerCase())) return false;
    return symbol.length >= 4 || symbol.includes(".");
  });
}

export function codeSurface(source) {
  let text = String(source || "");
  text = text.replace(/\/\*[\s\S]*?\*\//g, " ");
  text = text.replace(/(^|[^\\])\/\/.*$/gm, "$1");
  text = text.replace(/"(?:\\.|[^"\\])*"/g, "\"\"");
  text = text.replace(/'(?:\\.|[^'\\])*'/g, "\"\"");
  text = text.replace(/`(?:\\.|[^`$\\])*`/g, "\"\"");
  text = text.replace(/>([^<{]*)</g, "> <");
  return text;
}

export function symbolUsed(surface, symbol) {
  const escaped = String(symbol).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (symbol.includes(".") || /[A-Z]/.test(symbol)) return new RegExp(`\\b${escaped}\\b`).test(surface);
  return new RegExp(`\\.${escaped}\\b|\\[\\s*["']${escaped}["']\\s*\\]`).test(surface);
}

function usedApiSymbols(surface, symbols, baselineSurface) {
  return symbols.filter((symbol) => symbolUsed(surface, symbol) && !symbolUsed(baselineSurface || "", symbol));
}

function isTestPath(rel) {
  return /(^|\/)(test|tests|__tests__)(\/|$)/.test(rel) || /\.(test|spec)\.[cm]?[jt]sx?$/.test(rel);
}

export function reviewClaim({ contract, files, bodies }) {
  const baseline = contract?.baseline?.files || {};
  const changed = [];
  for (let i = 0; i < files.length; i += 1) {
    const rel = files[i];
    const hash = sha(bodies[i]);
    if (baseline[rel] && baseline[rel] === hash) continue;
    changed.push({ rel, body: bodies[i], hash });
  }
  if (!changed.length) {
    return { ok: false, say: "The recorded files match the handoff baseline. A stock file, including one that already contains the word error, is not the feature." };
  }
  const feature = changed.filter((item) => item.rel !== "package.json" && !isTestPath(item.rel));
  if (!feature.length) {
    return { ok: false, say: "No feature source changed. Editing package.json or adding a test script is not the feature." };
  }
  const featureText = feature.map((item) => item.body).join("\n");
  const surface = feature.map((item) => codeSurface(item.body)).join("\n");
  const symbols = apiSymbols(contract);
  const usedSymbols = usedApiSymbols(surface, symbols, contract?.baseline?.surface || "");
  if (!usedSymbols.length) {
    return {
      ok: false,
      say: "The changed code does not use a documented API symbol outside comments, strings, and static panel text. A phrase copied into the panel is not the call, and a starter token such as useState is not the feature. Source and behavior review is still pending. This is not commands-finished.",
      symbols
    };
  }
  if (goalWasReplaced(contract, featureText)) {
    return { ok: false, say: "The changed files replace the requested goal with the rename fixture." };
  }
  const ui = feature.filter((item) => /\.(tsx|jsx|vue|svelte|html)$/.test(item.rel));
  const uiText = (ui.length ? ui : feature).map((item) => item.body).join("\n");
  if (!/disabled|error|Loading|status/i.test(uiText)) {
    return { ok: false, say: "The changed files do not show an error, disabled, or loading state." };
  }
  return { ok: true, changed, feature, hit: usedSymbols, usedSymbols, limits: REVIEW_LIMIT };
}

function commentStripped(source) {
  return String(source || "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^\\])\/\/.*$/gm, "$1");
}

function importStatements(source) {
  const code = commentStripped(source);
  const statements = [];
  const patterns = [
    /(?:^|[;\n])\s*import\s+[\s\S]*?\sfrom\s*["']([^"']+)["']/g,
    /(?:^|[;\n])\s*import\s*["']([^"']+)["']/g,
    /(?:^|[;\n])\s*(?:const|let|var)\s+.+?=\s*require\(\s*["']([^"']+)["']\s*\)/g
  ];
  for (const pattern of patterns) {
    for (const match of code.matchAll(pattern)) statements.push({ spec: match[1], text: match[0] });
  }
  return statements;
}

function bindingsFrom(statement) {
  const text = String(statement || "").replace(/^[\s;]+/, "");
  const names = [];
  const brace = text.match(/\{([^}]+)\}/);
  if (brace && /^import\b/.test(text)) {
    for (const part of brace[1].split(",")) {
      const bits = part.trim().split(/\s+as\s+/);
      const local = (bits[bits.length - 1] || "").trim();
      if (/^[A-Za-z_$][\w$]*$/.test(local)) names.push(local);
    }
  }
  const named = text.match(/import\s+([A-Za-z_$][\w$]*)\s*(?:,|from\b)/);
  if (named) names.push(named[1]);
  const ns = text.match(/import\s*\*\s*as\s+([A-Za-z_$][\w$]*)/);
  if (ns) names.push(ns[1]);
  const required = text.match(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/);
  if (required && /require\(/.test(text)) names.push(required[1]);
  return names;
}

function resolvesTo(spec, testFile, rel) {
  if (!spec.startsWith(".")) return false;
  const from = path.posix.dirname(testFile.split(path.sep).join("/"));
  const resolved = path.posix.normalize(path.posix.join(from, spec));
  const target = rel.split(path.sep).join("/");
  const candidates = [resolved, `${resolved}.mjs`, `${resolved}.js`, `${resolved}.cjs`, `${resolved}.tsx`, `${resolved}.ts`, `${resolved}.jsx`];
  return candidates.includes(target);
}

function splitArgs(list) {
  const args = [];
  let current = "";
  let depth = 0;
  let quote = "";
  for (let i = 0; i < list.length; i += 1) {
    const ch = list[i];
    if (quote) {
      current += ch;
      if (ch === "\\" ) { current += list[i + 1] || ""; i += 1; continue; }
      if (ch === quote) quote = "";
      continue;
    }
    if (ch === "'" || ch === "\"" || ch === "`") { quote = ch; current += ch; continue; }
    if (ch === "(" || ch === "[" || ch === "{") depth += 1;
    else if (ch === ")" || ch === "]" || ch === "}") depth -= 1;
    else if (ch === "," && depth === 0) { args.push(current.trim()); current = ""; continue; }
    current += ch;
  }
  if (current.trim()) args.push(current.trim());
  return args;
}

function assertionScore(source) {
  const code = commentStripped(source);
  let real = 0;
  let tautology = 0;
  const re = /\b(?:assert\s*\.\s*[A-Za-z]+|expect)\s*\(([\s\S]*?)\)/g;
  for (const match of code.matchAll(re)) {
    const raw = match[0];
    const args = splitArgs(match[1]);
    const literal = /^(?:true|false|null|undefined|\d+|["'`][^"'`]*["'`])$/;
    const sameLiteral = args.length >= 2 && args[0] === args[1] && literal.test(args[0]);
    const okTrue = /assert\s*\.\s*ok\s*\(\s*(?:true|1)\s*\)/.test(raw);
    const expectLiteral = /expect\s*\(\s*(?:true|false|1|0)\s*\)\s*\.\s*to(?:Be|Equal)\s*\(\s*(?:true|false|1|0)\s*\)/.test(raw);
    if (sameLiteral || okTrue || expectLiteral) tautology += 1;
    else real += 1;
  }
  return { real, tautology };
}

export function testsCoverFeature(project, changed, usedSymbols) {
  const scripts = readScripts(project);
  if (!scripts) return { ok: false, say: "No package.json. Tests were not run." };
  if (!scripts.test) return { ok: false, say: "The project has no test script. The Bolt starter does not ship one, and a missing script is not a passing test." };
  if (isNoopTestScript(scripts.test)) return { ok: false, say: "The test script is a no-op. process.exit(0) does not exercise the feature and is not marked done." };
  const users = new Set((changed || [])
    .filter((item) => item.rel !== "package.json" && !isTestPath(item.rel))
    .filter((item) => usedApiSymbols(codeSurface(item.body), usedSymbols || [], "").length)
    .map((item) => item.rel));
  if (!users.size) return { ok: false, say: `No changed module uses a new documented API symbol (${(usedSymbols || []).join(", ")}), so a test cannot cover the call.` };
  const files = [];
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules") continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (isTestPath(path.relative(project, full))) files.push(path.relative(project, full));
    }
  };
  walk(project);
  for (const rel of files) {
    const text = fs.readFileSync(path.join(project, rel), "utf8");
    const code = commentStripped(text);
    const statements = importStatements(text);
    const imported = statements.filter((item) => [...users].some((feature) => resolvesTo(item.spec, rel, feature)));
    if (!imported.length) continue;
    const withoutImports = statements.reduce((body, item) => body.replace(item.text, " "), code);
    const usedBinding = imported.some((item) => bindingsFrom(item.text).some((name) => new RegExp(`\\b${name}\\b`).test(withoutImports)));
    const score = assertionScore(text);
    if (usedBinding && score.real > 0) return { ok: true, file: rel };
  }
  return { ok: false, say: `No test imports a changed module that uses the documented API (${[...users].join(", ")}) and then asserts on that use. Mentioning the file name, a comment-only import, or assert.equal(1, 1) is not that test.` };
}

function scopeHash(scope) {
  return crypto.createHash("sha256").update(JSON.stringify(scope)).digest("hex");
}

function canonicalScope(changes) {
  return {
    commands: changes.filter((item) => item.kind === "command").map((item) => ({ name: item.name, to: item.to })).sort((a, b) => a.name.localeCompare(b.name)),
    files: changes.filter((item) => item.kind === "file").map((item) => ({ name: item.name, sha256: item.to })).sort((a, b) => a.name.localeCompare(b.name))
  };
}

function describeChange(change) {
  if (change.kind === "command") return `${change.name} command is now ${JSON.stringify(change.to)}`;
  return `${change.name} sha256 ${change.to || "missing"}`;
}

function localImports(text, fromRel) {
  const found = [];
  const dir = path.posix.dirname(String(fromRel).split(path.sep).join("/"));
  const pattern = /(?:from\s+|import\s*\(\s*|import\s+|require\(\s*)["'](\.[^"']+)["']/g;
  for (const match of String(text).matchAll(pattern)) {
    const rel = path.posix.normalize(path.posix.join(dir, match[1]));
    if (!rel.startsWith("..")) found.push(rel);
  }
  return found;
}

function resolveLocal(project, rel) {
  const candidates = path.extname(rel) ? [rel] : [rel, `${rel}.mjs`, `${rel}.js`, `${rel}.cjs`, `${rel}.ts`];
  const root = path.resolve(project);
  for (const candidate of candidates) {
    const full = path.resolve(project, candidate);
    if (full !== root && !full.startsWith(`${root}${path.sep}`)) continue;
    if (fs.existsSync(full) && fs.statSync(full).isFile()) return { rel: candidate, full };
  }
  return null;
}

/** Commands plus the local scripts and configs they reach. Hashes are the trust boundary. */
export function commandChangeSet(project, baseline) {
  const scripts = readScripts(project) || {};
  const base = baseline?.scripts || {};
  const changes = [];
  for (const name of ["build", "ccx"]) {
    const from = base[name] || "";
    const to = scripts[name] || "";
    if (from !== to) changes.push({ kind: "command", name, from, to });
  }
  if ((base.test || "") !== (scripts.test || "")) {
    const addingRunner = !base.test && scripts.test && !isNoopTestScript(scripts.test);
    if (!addingRunner) changes.push({ kind: "command", name: "test", from: base.test || "", to: scripts.test || "" });
  }
  const seen = new Set();
  const queue = [...commandRefs(`${scripts.build || ""}\n${scripts.ccx || ""}`)];
  const hashed = new Map();
  while (queue.length && seen.size < 40) {
    const next = queue.shift();
    if (seen.has(next)) continue;
    seen.add(next);
    const resolved = resolveLocal(project, next);
    if (!resolved) {
      hashed.set(next, "");
      continue;
    }
    const data = fs.readFileSync(resolved.full);
    hashed.set(resolved.rel, sha(data));
    if (seen.size >= 40) break;
    for (const dep of localImports(data.toString("utf8"), resolved.rel)) queue.push(dep);
  }
  for (const rel of PACKAGING) {
    const full = path.join(project, rel);
    if (!fs.existsSync(full) || !fs.statSync(full).isFile()) continue;
    hashed.set(rel, sha(fs.readFileSync(full)));
  }
  for (const [rel, hash] of hashed) {
    const previous = baseline?.commandFiles?.[rel] || baseline?.packaging?.[rel] || baseline?.files?.[rel] || "";
    if (previous !== hash) changes.push({ kind: "file", name: rel, from: previous, to: hash });
  }
  return { scripts, changes, scope: canonicalScope(changes) };
}

/**
 * Fail closed. A reason on the implementation record is not authorization.
 * A session answer is authorization only while its bound hashes still match.
 */
export function reviewCommandProvenance(project, baseline, grant, options = {}) {
  const drift = commandChangeSet(project, baseline);
  const { scripts } = drift;
  if (!scripts.test || isNoopTestScript(scripts.test)) {
    return { ok: false, say: "The test script is missing or only exits 0. A missing Bolt test script may be replaced with a real runner such as node --test. A no-op is not that runner." };
  }
  if (!drift.changes.length) return { ok: true, provenance: "handoff", scripts };
  const listed = drift.changes.map(describeChange).join("; ");
  const claimNote = options.ignoredClaim
    ? " The record included approveScripts. That flag is not a session answer and was not used."
    : "";
  const bound = grant
    && grant.source === "session-answer"
    && !grant.declined
    && (grant.via === "chat" || grant.via === "dashboard")
    && grant.scope
    && grant.scopeSha
    && grant.scopeSha === scopeHash(grant.scope)
    && JSON.stringify(grant.scope) === JSON.stringify(drift.scope);
  if (bound) {
    return {
      ok: true,
      provenance: "session-answer",
      via: grant.via,
      nonce: grant.nonce,
      answeredAt: grant.at,
      scripts,
      changes: drift.changes.map((item) => item.name),
      scope: drift.scope
    };
  }
  const why = grant?.declined
    ? "The session answer declined the script change."
    : grant?.source === "session-answer"
      ? "The session answer does not match these command strings and file hashes. A later edit invalidates the earlier answer."
      : "A reason string is not authorization. Package, source, and doc text cannot grant it.";
  return {
    ok: false,
    say: `The handoff command or a local script it runs changed (${listed}). The altered script was not run. ${why}${claimNote} Answer the script-change question for these exact commands and hashes.`,
    scope: grant?.declined ? undefined : drift.scope,
    changes: drift.changes
  };
}

export function selectArchives(artifacts, baselineArchives, declared) {
  const known = new Set((baselineArchives || []).map((item) => item.sha256));
  const fresh = [];
  const preexisting = [];
  for (const artifact of artifacts || []) {
    if (known.has(artifact.sha256)) preexisting.push(artifact);
    else fresh.push(artifact);
  }
  if (Array.isArray(declared)) {
    const want = new Set(declared);
    const extra = fresh.filter((item) => !want.has(item.file));
    const missing = [...want].filter((file) => !fresh.some((item) => item.file === file));
    if (!declared.length || extra.length || missing.length) {
      return {
        ok: false,
        fresh,
        preexisting,
        say: `The declared archive set is not the set of new packages. New: ${fresh.map((item) => item.file).join(", ") || "none"}. Declared: ${declared.join(", ") || "none"}. A pre-existing zip is not this run's output.`
      };
    }
  }
  if (!fresh.length) {
    return { ok: false, fresh, preexisting, say: "The ccx command produced no new archive. A zip that was already present at the handoff is not this run's package." };
  }
  return { ok: true, fresh, preexisting };
}

function iconRefs(text) {
  return [...new Set([...String(text || "").matchAll(/icons\/[A-Za-z0-9@._-]+\.png/g)].map((match) => match[0]))];
}

export function reviewArchive({ project, artifact, symbols, baselineArchives }) {
  const full = path.resolve(project, artifact.file);
  const data = fs.readFileSync(full);
  const digest = crypto.createHash("sha256").update(data).digest("hex");
  if ((baselineArchives || []).some((item) => item.sha256 === digest)) {
    return { ok: false, file: artifact.file, say: "The archive digest matches the package saved at handoff. It does not include a later feature. A rebuild can also change the digest only because zip timestamps differ, so contents are checked separately." };
  }
  let members;
  try {
    members = readZip(full);
  } catch (error) {
    return { ok: false, file: artifact.file, say: `The package ${artifact.file} is not a readable zip. ${error.message}` };
  }
  const names = members.map((member) => member.name);
  const text = members
    .filter((member) => /\.(js|mjs|cjs|html|json|css|txt|md|tsx|jsx)$/i.test(member.name))
    .map((member) => member.data.toString("utf8"))
    .join("\n");
  const matched = (symbols || []).filter((symbol) => symbolUsed(text, symbol) || symbolUsed(codeSurface(text), symbol));
  if (!matched.length) {
    return {
      ok: false,
      file: artifact.file,
      say: `The archive ${artifact.file} does not contain a documented API symbol introduced by the changed code. Text that was already in the starter, including useState or uxp.entrypoints, is not that symbol.`,
      names,
      digest,
      bytes: data.length
    };
  }
  const manifest = members.find((member) => member.name === "manifest.json" || member.name.endsWith("/manifest.json"));
  const config = fs.existsSync(path.join(project, "uxp.config.ts")) ? fs.readFileSync(path.join(project, "uxp.config.ts"), "utf8") : "";
  const packaged = iconRefs(manifest ? manifest.data.toString("utf8") : "");
  const presentOnDisk = iconRefs(config).filter((ref) => fs.existsSync(path.join(project, "public", ref)));
  const refs = [...new Set([...packaged, ...presentOnDisk])];
  const missing = refs.filter((ref) => !names.some((name) => name.endsWith(ref)));
  if (missing.length) {
    return { ok: false, file: artifact.file, say: `The package ${artifact.file} omits icon files named by the manifest: ${missing.join(", ")}.`, names, digest, bytes: data.length };
  }
  return {
    ok: true,
    file: artifact.file,
    digest,
    bytes: data.length,
    names,
    matched,
    limits: REVIEW_LIMIT
  };
}
