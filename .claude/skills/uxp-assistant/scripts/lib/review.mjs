import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { readZip } from "./archive.mjs";
import { goalWasReplaced } from "./contract.mjs";
import { readScripts } from "./package-project.mjs";

export const REVIEW_LIMIT = "A changed file that mentions evidence from the fresh pages, a test that imports that file, and an archive that contains one of its strings are checks on the package. They are not semantic proof and they are not a host pass. The Adobe host was NOT TESTED.";

const STOP = new Set(["the", "a", "an", "in", "on", "to", "for", "of", "and", "or", "with", "each", "into", "from", "panel", "show", "read", "list", "display", "using", "use", "plugin", "feature", "please", "that", "this", "its", "not", "are", "was", "were", "this", "goal"]);

function sha(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

export function snapshotProject(project) {
  const files = {};
  const archives = [];
  if (!project || !fs.existsSync(project)) return { files, archives };
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
        archives.push({ file: rel, bytes: data.length, sha256: crypto.createHash("sha256").update(data).digest("hex") });
      } else if (/\.(jsx?|tsx?|mjs|cjs|css|html|json|md)$/.test(entry.name)) {
        files[rel] = sha(fs.readFileSync(full));
      }
    }
  };
  walk(project);
  return { files, archives };
}

export function isNoopTestScript(script) {
  const text = String(script || "").replace(/\s+/g, " ").trim();
  if (!text) return true;
  if (/node --test|\bvitest\b|\bjest\b|\bmocha\b|\.test\.|\.spec\./.test(text)) return false;
  return /process\.exit\s*\(\s*0\s*\)/.test(text) || text === "true" || text === "exit 0";
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
  const tokens = evidenceTokens(contract);
  const featureText = feature.map((item) => item.body).join("\n");
  const hit = tokens.filter((token) => featureText.toLowerCase().includes(token.toLowerCase()));
  if (!hit.length) {
    return { ok: false, say: "The changed files do not mention a documented symbol or phrase from the fresh-page evidence. disabled, error, Loading, or status alone does not establish the goal.", tokens };
  }
  if (goalWasReplaced(contract, featureText)) {
    return { ok: false, say: "The changed files replace the requested goal with the rename fixture." };
  }
  const ui = feature.filter((item) => /\.(tsx|jsx|vue|svelte|html)$/.test(item.rel));
  const uiText = (ui.length ? ui : feature).map((item) => item.body).join("\n");
  if (!/disabled|error|Loading|status/i.test(uiText)) {
    return { ok: false, say: "The changed files do not show an error, disabled, or loading state." };
  }
  return { ok: true, changed, feature, hit, limits: REVIEW_LIMIT };
}

export function testsCoverFeature(project, changed) {
  const scripts = readScripts(project);
  if (!scripts) return { ok: false, say: "No package.json. Tests were not run." };
  if (!scripts.test) return { ok: false, say: "The project has no test script. The Bolt starter does not ship one, and a missing script is not a passing test." };
  if (isNoopTestScript(scripts.test)) return { ok: false, say: "The test script is a no-op. process.exit(0) does not exercise the feature and is not marked done." };
  const names = changed
    .filter((item) => item.rel !== "package.json" && !isTestPath(item.rel))
    .map((item) => path.basename(item.rel, path.extname(item.rel)));
  const texts = [];
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules") continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (isTestPath(path.relative(project, full))) texts.push(fs.readFileSync(full, "utf8"));
    }
  };
  walk(project);
  const body = texts.join("\n");
  if (!names.some((name) => body.includes(name))) {
    return { ok: false, say: "No test file references a changed feature module. A green test run that ignores the feature is not acceptance." };
  }
  return { ok: true };
}

function iconRefs(text) {
  return [...new Set([...String(text || "").matchAll(/icons\/[A-Za-z0-9@._-]+\.png/g)].map((match) => match[0]))];
}

function distinctiveStrings(source) {
  const found = [];
  for (const match of String(source || "").matchAll(/["'`]([^"'`\n]{12,120})["'`]/g)) found.push(match[1]);
  return [...new Set(found)];
}

export function reviewArchive({ project, artifact, changed, baselineArchives }) {
  const full = path.resolve(project, artifact.file);
  const data = fs.readFileSync(full);
  const digest = crypto.createHash("sha256").update(data).digest("hex");
  if ((baselineArchives || []).some((item) => item.sha256 === digest)) {
    return { ok: false, say: "The archive digest matches the package saved at handoff. It does not include a later feature. A rebuild can also change the digest only because zip timestamps differ, so contents are checked separately." };
  }
  let members;
  try {
    members = readZip(full);
  } catch (error) {
    return { ok: false, say: `The package is not a readable zip. ${error.message}` };
  }
  const names = members.map((member) => member.name);
  const text = members
    .filter((member) => /\.(js|mjs|cjs|html|json|css|txt|md|tsx|jsx)$/i.test(member.name))
    .map((member) => member.data.toString("utf8"))
    .join("\n");
  const featureText = changed.filter((item) => !isTestPath(item.rel) && item.rel !== "package.json").map((item) => item.body).join("\n");
  const strings = distinctiveStrings(featureText).filter((value) => text.includes(value));
  const ids = identifiers(featureText).filter((value) => value.length >= 8 && text.includes(value));
  if (!strings.length && !ids.length) {
    return { ok: false, say: "The archive does not contain a string or documented symbol from the changed feature files. The packager exit is not the feature.", names };
  }
  const manifest = members.find((member) => member.name === "manifest.json" || member.name.endsWith("/manifest.json"));
  const config = fs.existsSync(path.join(project, "uxp.config.ts")) ? fs.readFileSync(path.join(project, "uxp.config.ts"), "utf8") : "";
  const packaged = iconRefs(manifest ? manifest.data.toString("utf8") : "");
  const presentOnDisk = iconRefs(config).filter((ref) => fs.existsSync(path.join(project, "public", ref)));
  const refs = [...new Set([...packaged, ...presentOnDisk])];
  const missing = refs.filter((ref) => !names.some((name) => name.endsWith(ref)));
  if (missing.length) {
    return { ok: false, say: `The package omits icon files named by the manifest: ${missing.join(", ")}.`, names, digest, bytes: data.length };
  }
  return {
    ok: true,
    digest,
    bytes: data.length,
    names,
    matched: strings.length ? strings.slice(0, 5) : ids.slice(0, 5),
    limits: REVIEW_LIMIT
  };
}
