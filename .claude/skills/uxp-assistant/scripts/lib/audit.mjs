import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { permissionCapabilities } from "./permissions.mjs";

/**
 * The check step's reader. It reads the project the assistant wrote and reports what Adobe's saved
 * docs already say is wrong. It is not a host run: nothing here says the plugin works in the app.
 *
 * error: the plugin will not build, load, or call the host the way it is written. check does not pass.
 * warn:  worth fixing, does not block.
 * A line that holds `audit-ignore` is skipped.
 */

const SOURCE_EXT = /\.(?:[cm]?[jt]sx?|vue|svelte|html?|css|scss|sass)$/i;
const SKIP_DIRS = new Set(["node_modules", "dist", "dist-zip", "dist-ccx", "build", ".git", ".vscode", "public-zip"]);

export function digestFile(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function sourceFiles(project) {
  const files = walk(path.join(project, "src"));
  const index = path.join(project, "index.html");
  if (fs.existsSync(index)) files.push(index);
  return files;
}

/**
 * Every source file with its digest and text, taken when the project is created. The check uses it to tell
 * what the assistant wrote from what the starter gave, down to the line.
 */
export function snapshotSource(project) {
  const files = {};
  for (const file of sourceFiles(project)) {
    const text = fs.readFileSync(file, "utf8");
    files[path.relative(project, file)] = { sha: digestFile(file), ...(text.length < 300000 ? { text } : {}) };
  }
  for (const name of ["uxp.config.ts", "manifest.json"]) {
    const file = path.join(project, name);
    if (fs.existsSync(file)) files[name] = { sha: digestFile(file) };
  }
  return files;
}

function walk(dir) {
  const found = [];
  if (!fs.existsSync(dir)) return found;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...walk(full));
    else if (SOURCE_EXT.test(entry.name) && !/\.d\.ts$/.test(entry.name) && !/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(entry.name)) found.push(full);
  }
  return found;
}

/**
 * Files the assistant wrote, as { file, text }. A new file is whole. A changed starter file keeps only its
 * new lines (the others are blanked, so line numbers stay true). With no baseline, every file whole.
 */
export function authoredFiles(project, baseline) {
  const out = [];
  for (const file of sourceFiles(project)) {
    const rel = path.relative(project, file);
    const text = fs.readFileSync(file, "utf8");
    const before = baseline?.[rel];
    if (!baseline || !before) {
      out.push({ file: rel, text });
      continue;
    }
    if (before.sha === digestFile(file)) continue;
    if (before.text === undefined) {
      out.push({ file: rel, text });
      continue;
    }
    const known = new Set(before.text.split("\n").map((line) => line.trim()));
    out.push({ file: rel, text: text.split("\n").map((line) => (known.has(line.trim()) ? "" : line)).join("\n") });
  }
  return out;
}

/** Test files under src. The starter has none, so every one is the assistant's. */
export function testFiles(project) {
  const found = [];
  const walkTests = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (SKIP_DIRS.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walkTests(full);
      else if (/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(entry.name)) found.push(path.relative(project, full));
    }
  };
  walkTests(path.join(project, "src"));
  return found;
}

export function changedSinceBaseline(project, baseline) {
  if (!baseline) return { changed: [], total: 0 };
  const now = snapshotSource(project);
  const changed = Object.keys(now).filter((name) => baseline[name]?.sha !== now[name].sha);
  const removed = Object.keys(baseline).filter((name) => !(name in now));
  return { changed: [...changed, ...removed], total: Object.keys(now).length };
}

function lineOf(text, index) {
  return text.slice(0, index).split("\n").length;
}

function add(findings, finding) {
  findings.push({ severity: "error", ...finding });
}

/** Names the host module exports, read from the saved TypeScript types. */
export function parseHostTypes(source) {
  const text = String(source || "");
  const blocks = new Map();
  const heads = text.matchAll(/export declare type (\w+)\s*=\s*\{/g);
  for (const head of heads) {
    const open = head.index + head[0].length - 1;
    let depth = 0;
    let close = -1;
    for (let i = open; i < text.length; i += 1) {
      if (text[i] === "{") depth += 1;
      else if (text[i] === "}") {
        depth -= 1;
        if (depth === 0) {
          close = i;
          break;
        }
      }
    }
    if (close < 0) continue;
    const members = new Set();
    let level = 0;
    for (const raw of text.slice(open + 1, close).split("\n")) {
      const line = raw.trim();
      if (level === 0) {
        const member = line.match(/^(?:readonly\s+|static\s+)*([A-Za-z_$][\w$]*)\??\s*[:(<]/);
        if (member) members.add(member[1]);
      }
      level += (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length;
    }
    blocks.set(head[1], members);
  }
  const top = blocks.get("premierepro");
  const names = top ? [...top] : [];
  const statics = new Map();
  for (const name of names) {
    const staticType = text.match(new RegExp(`\\b${name}\\s*:\\s*(\\w+)\\s*;`));
    const typeName = staticType ? staticType[1] : "";
    if (typeName && blocks.has(typeName) && blocks.get(typeName).size) statics.set(name, blocks.get(typeName));
  }
  return { names: new Set(names), statics, any: names.length > 0 };
}

/** Variable names bound to the host module in a file. */
function hostAliases(text, host) {
  const module = host === "ppro" ? "premierepro" : host === "phxs" ? "photoshop" : host === "idsn" ? "indesign" : "";
  if (!module) return [];
  const aliases = new Set([module]);
  for (const match of text.matchAll(new RegExp(`(?:const|let|var)\\s+(\\w+)\\s*=\\s*require\\(\\s*["']${module}["']\\s*\\)`, "g"))) aliases.add(match[1]);
  for (const match of text.matchAll(new RegExp(`import\\s+\\*\\s+as\\s+(\\w+)\\s+from\\s+["']${module}["']`, "g"))) aliases.add(match[1]);
  for (const match of text.matchAll(new RegExp(`import\\s+(\\w+)\\s+from\\s+["']${module}["']`, "g"))) aliases.add(match[1]);
  return [...aliases];
}

function checkHostApi(findings, { file, text, plan, types }) {
  if (plan.host !== "ppro" || !types?.any) return;
  const lines = text.split("\n");
  for (const alias of hostAliases(text, plan.host)) {
    const re = new RegExp(`(?<![\\w$.])${alias}\\.([A-Za-z_$][\\w$]*)(?:\\.([A-Za-z_$][\\w$]*))?`, "g");
    for (const match of text.matchAll(re)) {
      const line = lineOf(text, match.index);
      if (/audit-ignore/.test(lines[line - 1] || "")) continue;
      const [, top, second] = match;
      if (!types.names.has(top)) {
        add(findings, {
          id: "api-unknown", file, line,
          text: `${alias}.${top} is not in the saved Premiere types.`,
          fix: `Find the real name with: node scripts/skill.mjs find ${top}. Do not guess API names.`
        });
        continue;
      }
      const members = types.statics.get(top);
      if (second && members && !members.has(second)) {
        add(findings, {
          id: "api-unknown", file, line,
          text: `${alias}.${top}.${second} is not in the saved Premiere types. ${top} has: ${[...members].slice(0, 12).join(", ")}.`,
          fix: `Use a member that exists, or search: node scripts/skill.mjs find ${second}.`
        });
      }
    }
  }
}

const USES = [
  { permission: "localFileSystem", test: /\b(?:getFileForOpening|getFileForSaving|getFolder)\s*\(/, what: "a file or folder picker" },
  { permission: "network", test: /\bfetch\s*\(|\bXMLHttpRequest\b|\bnew\s+WebSocket\s*\(/, what: "a network request" },
  { permission: "clipboard", test: /\bclipboard\s*\.\s*(?:read|write)|\bnavigator\.clipboard\b|\bcopyToClipboard\b/, what: "the clipboard" },
  { permission: "launchProcess", test: /\bshell\s*\.\s*(?:openExternal|openPath)\s*\(/, what: "opening another app or link" }
];

function checkPermissions(findings, { files, plan, configSource, configFile }) {
  const declared = new Set(permissionCapabilities(configSource).map((name) => name.split(":")[0]));
  const used = new Map();
  for (const { file, text } of files) {
    const lines = text.split("\n");
    for (const use of USES) {
      const match = use.test.exec(text);
      if (!match) continue;
      const line = lineOf(text, match.index);
      if (/audit-ignore/.test(lines[line - 1] || "")) continue;
      if (!used.has(use.permission)) used.set(use.permission, { file, line, what: use.what });
    }
  }
  for (const [permission, where] of used) {
    if (declared.has(permission)) continue;
    add(findings, {
      id: "permission-missing", file: where.file, line: where.line,
      text: `The code uses ${where.what} but requiredPermissions in ${configFile} has no ${permission}. The host will refuse it.`,
      fix: `Add ${permission} to requiredPermissions with the narrowest value the docs allow (read the manifest page: node scripts/skill.mjs find requiredPermissions ${permission}).`
    });
  }
  for (const permission of declared) {
    if (["webview", "ipc", "allowCodeGenerationFromStrings", "enableMessageBridge"].includes(permission)) continue;
    if (used.has(permission) || plan.permissions.includes(permission)) continue;
    add(findings, {
      id: "permission-unused", severity: "warn", file: configFile,
      text: `requiredPermissions declares ${permission}, but no code uses it and the request does not name it.`,
      fix: permission === "localFileSystem"
        ? `Remove it unless the plugin opens a file or folder picker (getFileForOpening, getFileForSaving, getFolder). Files under plugin:/, plugin-data:/ and plugin-temp:/ need no permission.`
        : `Remove ${permission} from ${configFile} unless the plugin needs it.`
    });
  }
}

/**
 * Each rule is a limit the saved Known Issues or canvas pages state. A rule only runs when its
 * phrase is on a saved page, so the audit never invents a limit Adobe did not write.
 */
const LIMITS = [
  { id: "limit-transitions", files: /\.(?:css|scss|sass|vue|svelte|[jt]sx?)$/i, test: /(?:^|[\s;{"'`])(?:transition|animation)\s*:|@keyframes\b/, phrase: "transitions and animations are not supported", text: "CSS transitions and animations are not supported in UXP." },
  { id: "limit-text-transform", files: /\.(?:css|scss|sass|vue|svelte|[jt]sx?)$/i, test: /(?:^|[\s;{"'`])text-transform\s*:/, phrase: "text-transform", text: "`text-transform` is not supported in UXP." },
  { id: "limit-font-shorthand", files: /\.(?:css|scss|sass|vue|svelte)$/i, test: /(?:^|[\s;{])font\s*:\s*[^;{}]*\d/, phrase: "shorthand css rule is not supported", text: "The `font` shorthand is not supported in UXP. Set font-size, font-family, and font-weight separately." },
  { id: "limit-input-file", files: /\.(?:html?|vue|svelte|[jt]sx)$/i, test: /type\s*=\s*["']file["']/, phrase: "type=\"file\"", text: "`<input type=\"file\">` is not supported. Use storage.localFileSystem.getFileForOpening()." },
  { id: "limit-input-color", files: /\.(?:html?|vue|svelte|[jt]sx)$/i, test: /type\s*=\s*["']color["']/, phrase: "type=\"color\"", text: "`<input type=\"color\">` is not supported." },
  { id: "limit-label-for", files: /\.(?:html?|vue|svelte|[jt]sx)$/i, test: /<label\b[^>]*\b(?:for|htmlFor)\s*=/, phrase: "label for", text: "`<label for=...>` is not supported. Wrap the label around the control." },
  { id: "limit-keypress", files: /\.(?:vue|svelte|[jt]sx?)$/i, test: /["'`]keypress["'`]|\bonKeyPress\b|\bonkeypress\b/, phrase: "keypress", text: "`keypress` is not supported. Use keydown or keyup." },
  { id: "limit-webgl", files: /\.(?:vue|svelte|[jt]sx?)$/i, test: /getContext\(\s*["'`](?:webgl2?|experimental-webgl|bitmaprenderer)["'`]|\bOffscreenCanvas\b/, phrase: "only '2d'", text: "Only the '2d' canvas context is supported. WebGL and OffscreenCanvas are not." },
  { id: "limit-canvas-export", severity: "warn", files: /\.(?:vue|svelte|[jt]sx?)$/i, test: /\.(?:toDataURL|toBlob|convertToBlob)\s*\(/, phrase: "only basic shapes", text: "The saved canvas pages document only basic shapes and the 2d context. toDataURL/toBlob are not documented for UXP, so encode the image bytes yourself and write them with the file API." },
  { id: "limit-select-value", severity: "warn", files: /\.(?:html?|vue|svelte|[jt]sx)$/i, test: /<option\b(?![^>]*\bvalue\s*=)[^>]*>/, phrase: "must have a `value` attribute", text: "`<option>` needs a value attribute, or the select's value is undefined." }
];

function readLibraryText(libDir) {
  let text = "";
  for (const rel of ["pages/uxp-api/known-issues.md", "LIMITS.md"]) {
    try {
      text += fs.readFileSync(path.join(libDir, rel), "utf8").toLowerCase();
    } catch {
      // The page may not be saved for this host.
    }
  }
  try {
    for (const entry of walkMd(path.join(libDir, "pages"))) {
      if (/canvas/.test(entry)) text += fs.readFileSync(entry, "utf8").toLowerCase();
    }
  } catch {
    // No pages saved.
  }
  return text;
}

function walkMd(dir) {
  const found = [];
  if (!fs.existsSync(dir)) return found;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...walkMd(full));
    else if (entry.name.endsWith(".md")) found.push(full);
  }
  return found;
}

function checkLimits(findings, { files, libText, docsAvailable }) {
  for (const { file, text } of files) {
    const lines = text.split("\n");
    for (const rule of LIMITS) {
      if (!rule.files.test(file)) continue;
      if (docsAvailable && !libText.includes(rule.phrase.toLowerCase())) continue;
      const match = rule.test.exec(text);
      if (!match) continue;
      const line = lineOf(text, match.index);
      if (/audit-ignore/.test(lines[line - 1] || "")) continue;
      add(findings, { id: rule.id, severity: rule.severity || "error", file, line, text: rule.text, fix: "Change the code, or read the saved page: LIMITS.md in the docs folder." });
    }
  }
}

function checkManifest(findings, { project, plan, configSource, configFile }) {
  if (!configSource) return;
  const version = (configSource.match(/manifestVersion:\s*(\d+)/) || [])[1];
  if (version && Number(version) < 5) {
    add(findings, { id: "manifest-version", file: configFile, text: `manifestVersion is ${version}. Adobe's manifest page says current hosts use 5.`, fix: "Set manifestVersion: 5." });
  }
  const dist = path.join(project, "dist", "manifest.json");
  if (fs.existsSync(dist)) {
    let manifest = null;
    try {
      manifest = JSON.parse(fs.readFileSync(dist, "utf8"));
    } catch (error) {
      add(findings, { id: "manifest-json", file: "dist/manifest.json", text: `dist/manifest.json is not valid JSON: ${error.message}`, fix: "Fix uxp.config.ts and build again." });
    }
    if (manifest) {
      if (!manifest.id) add(findings, { id: "manifest-id", file: "dist/manifest.json", text: "The built manifest has no id.", fix: "Set id in uxp.config.ts." });
      if (!Array.isArray(manifest.entrypoints) || !manifest.entrypoints.length) {
        add(findings, { id: "manifest-entrypoints", file: "dist/manifest.json", text: "The built manifest has no entrypoints, so the host shows nothing.", fix: "Declare a panel entrypoint in uxp.config.ts." });
      }
      if (manifest.main && !fs.existsSync(path.join(project, "dist", manifest.main))) {
        add(findings, { id: "manifest-main", file: "dist/manifest.json", text: `The manifest main file ${manifest.main} is not in dist.`, fix: "Build again and check vite.config.ts." });
      }
      for (const icon of [...(manifest.icons || []), ...(manifest.entrypoints || []).flatMap((entry) => entry.icons || [])]) {
        if (icon.path && !fs.existsSync(path.join(project, "dist", icon.path))) {
          add(findings, { id: "manifest-icon", severity: "warn", file: "dist/manifest.json", text: `Icon ${icon.path} is named in the manifest but missing from dist.`, fix: "Put the icon in public/icons and build again." });
        }
      }
    }
  }
}

export function auditProject({ project, plan, libDir = "", baseline = null }) {
  const findings = [];
  const configFile = fs.existsSync(path.join(project, "uxp.config.ts")) ? "uxp.config.ts" : fs.existsSync(path.join(project, "manifest.json")) ? "manifest.json" : "";
  const configSource = configFile ? fs.readFileSync(path.join(project, configFile), "utf8") : "";
  const authored = authoredFiles(project, baseline);
  let types = null;
  const typesFile = libDir ? path.join(libDir, "api", "premierepro.d.ts") : "";
  if (typesFile && fs.existsSync(typesFile)) types = parseHostTypes(fs.readFileSync(typesFile, "utf8"));
  const libText = libDir ? readLibraryText(libDir) : "";

  checkManifest(findings, { project, plan, configSource, configFile });
  if (configSource) checkPermissions(findings, { files: authored, plan, configSource, configFile });
  for (const item of authored) checkHostApi(findings, { ...item, plan, types });
  checkLimits(findings, { files: authored, libText, docsAvailable: libText.length > 0 });
  checkCompat(findings, project);
  checkBundle(findings, project);

  const scripts = readScripts(project);
  if (!scripts.test) {
    findings.push({ severity: "warn", id: "no-tests", file: "package.json", text: "package.json has no test script, so nothing checks the plugin's own logic.", fix: 'Put host-free logic in its own module and add the script "test": "node --test \\"src/**/*.test.ts\\"" (Node 22.18+).' });
  }
  return { findings, scanned: authored.map((item) => item.file), typesRead: Boolean(types?.any) };
}

function checkCompat(findings, project) {
  const htmlPath = path.join(project, "index.html");
  if (!fs.existsSync(htmlPath)) return;
  const html = fs.readFileSync(htmlPath, "utf8");
  const firstScript = html.search(/<script\b/i);
  if (firstScript < 0) return;
  const compatAt = html.search(/<script[^>]*src=["'][^"']*uxp-compat\.js["']/i);
  if (compatAt < 0 || compatAt > firstScript) {
    add(findings, {
      id: "compat-script",
      file: "index.html",
      text: "uxp-compat.js is not the first script, so the panel can crash on observers, localStorage, or ownerDocument.",
      fix: "Add <script src=\"./uxp-compat.js\"></script> before every other script, and keep public/uxp-compat.js."
    });
  }
  const guardPath = path.join(project, "src", "uxp-guard.js");
  const guardText = fs.existsSync(guardPath) ? fs.readFileSync(guardPath, "utf8") : "";
  if (!guardText.includes("TextEncoder") || !guardText.includes("TextDecoder")) {
    add(findings, {
      id: "compat-text-encoder",
      file: "src/uxp-guard.js",
      text: "UXP has no TextEncoder or TextDecoder. Packages such as qrcode throw \"TextEncoder is not defined\" without the guard.",
      fix: "Restore src/uxp-guard.js from the skill and import it first in the panel entry."
    });
  }
  if (!fs.existsSync(path.join(project, "public", "uxp-compat.js")) && !fs.existsSync(guardPath)) {
    add(findings, { id: "compat-file", file: "src/uxp-guard.js", text: "The UXP document guard script is missing.", fix: "Restore src/uxp-guard.js from the skill assets." });
  }
  for (const item of authoredFiles(project, null)) {
    if (/\bchild_process\b|\brequire\(\s*["']util["']\s*\)/.test(item.text) && /TextEncoder|TextDecoder/.test(item.text)) {
      add(findings, { id: "host-missing-encoder", file: item.file, text: "This file reaches for Node's TextEncoder. UXP does not provide it.", fix: "Use the panel's uxp-guard.js. Do not import util.TextEncoder." });
    }
    if (/@radix-ui|react-remove-scroll/.test(item.text)) {
      add(findings, { id: "limit-radix", file: item.file, text: "Radix dialogs and react-remove-scroll crash the UXP document.", fix: "Draw a dialog as an absolutely positioned layer inside the panel." });
    }
    if (/crossorigin\s*=/.test(item.text)) {
      add(findings, { id: "limit-crossorigin", file: item.file, text: "plugin:/ does not answer a CORS request, so a crossorigin script never loads.", fix: "Remove the crossorigin attribute." });
    }
  }
  const vitePath = path.join(project, "vite.config.ts");
  if (fs.existsSync(vitePath) && !/modulePreload\s*:\s*false/.test(fs.readFileSync(vitePath, "utf8"))) {
    add(findings, {
      id: "modulepreload",
      file: "vite.config.ts",
      text: "Vite modulepreload is on. Premiere has no MutationObserver, so the panel never paints.",
      fix: "Set build.modulePreload to false."
    });
  }
}

/** Vite names an external Node built-in `require$$1`. UXP has no such global, so the panel never paints. */
function checkBundle(findings, project) {
  const dist = path.join(project, "dist");
  if (!fs.existsSync(dist)) return;
  for (const file of walkJs(dist)) {
    const text = fs.readFileSync(file, "utf8");
    if (!text.includes("require$$")) continue;
    add(findings, {
      id: "bundle-require",
      file: path.relative(project, file),
      text: "The bundle calls require$$. A Node built-in, usually fs, was left external. UXP throws \"require$$1 is not defined\" and the panel stays blank.",
      fix: "Do not import qrcode/lib/server.js or Node's fs into the panel. Use qrcode/lib/core/qrcode.js and render the modules without fs. Remove fs from the bundle's external list only if nothing imports it."
    });
    break;
  }
}

function walkJs(dir) {
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...walkJs(full));
    else if (entry.name.endsWith(".js")) found.push(full);
  }
  return found;
}

function readScripts(project) {
  try {
    return JSON.parse(fs.readFileSync(path.join(project, "package.json"), "utf8")).scripts || {};
  } catch {
    return {};
  }
}
