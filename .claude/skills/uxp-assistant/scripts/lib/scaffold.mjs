import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { DECLARED_MANIFEST } from "./floors.mjs";
import { skillRoot } from "./paths.mjs";

/** The installer is resolved by walking parents, not from process.cwd() alone. */
export const repoRoot = path.resolve(skillRoot, "../../..");

function walkFor(start, relative) {
  const seeds = [start, repoRoot, process.cwd()].filter(Boolean);
  for (const seed of seeds) {
    let dir = path.resolve(seed);
    for (let i = 0; i < 8; i += 1) {
      const candidate = path.join(dir, relative);
      if (fs.existsSync(candidate)) return candidate;
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return "";
}

export function installerEntry(start = repoRoot) {
  return walkFor(start, "node_modules/create-bolt-uxp/dist/index.js");
}

export function starterIconsDir(start = repoRoot) {
  const icons = walkFor(start, "node_modules/bolt-uxp/public/icons");
  return icons || path.join(repoRoot, "node_modules/bolt-uxp/public/icons");
}

/**
 * sampleCode:false strips the globals import and leaves `uxp.entrypoints`.
 * Vite does not typecheck that identifier. Import the starter's uxp binding.
 */
export function repairEntrypoint(project) {
  const files = [];
  const tsx = path.join(project, "src", "main.tsx");
  if (fs.existsSync(tsx)) {
    const text = fs.readFileSync(tsx, "utf8");
    const uses = /\buxp\s*\./.test(text);
    const imported = /import\s*\{[^}]*\buxp\b[^}]*\}\s*from\s*["']\.\/globals["']/.test(text);
    if (uses && !imported) {
      fs.writeFileSync(tsx, `import { uxp } from "./globals";\n${text}`);
      files.push("src/main.tsx");
    }
  }
  const vue = path.join(project, "src", "main.vue");
  if (fs.existsSync(vue)) {
    const text = fs.readFileSync(vue, "utf8");
    if (/\buxp\s*\./.test(text) && !/import\s*\{[^}]*\buxp\b/.test(text)) {
      fs.writeFileSync(vue, text.replace("<script setup lang=\"ts\">", "<script setup lang=\"ts\">\nimport { uxp } from \"./globals\";"));
      files.push("src/main.vue");
    }
  }
  const svelte = path.join(project, "src", "main.svelte");
  if (fs.existsSync(svelte)) {
    const text = fs.readFileSync(svelte, "utf8");
    if (/\bwebviewUI\b/.test(text) && !/const webviewUI\b/.test(text)) {
      fs.writeFileSync(svelte, text.replace("<script lang=\"ts\">", "<script lang=\"ts\">\n  const webviewUI = import.meta.env.VITE_BOLT_WEBVIEW_UI === \"true\";"));
      files.push("src/main.svelte");
    }
  }
  return {
    repaired: files.length > 0,
    file: files[0] || "",
    files,
    reason: files.length ? "Restored identifiers that sampleCode:false removed, without changing the starter stack." : "No stripped entrypoint identifier needed a repair."
  };
}

/** The installer globalIncludes list omits public/**. Copy the starter icons the manifest names. */
export function copyStarterIcons(project, root = repoRoot) {
  const from = starterIconsDir(root);
  const to = path.join(project, "public", "icons");
  if (!fs.existsSync(from)) return { copied: [], reason: "bolt-uxp public/icons is not installed." };
  fs.mkdirSync(to, { recursive: true });
  const copied = [];
  for (const name of fs.readdirSync(from)) {
    const dest = path.join(to, name);
    if (!fs.existsSync(dest)) {
      fs.copyFileSync(path.join(from, name), dest);
      copied.push(`public/icons/${name}`);
    }
  }
  return { copied, reason: copied.length ? "" : "Icons were already in the project." };
}

/**
 * Empty-folder projects are created by the published create-bolt-uxp installer.
 * This module does not copy Bolt's template tree itself.
 */
export async function scaffoldWithInstaller(parent, options) {
  process.env.BOLT_MODULEONLY = "true";
  const entryPath = installerEntry(options.repoRoot);
  if (!fs.existsSync(entryPath)) {
    throw new Error(`create-bolt-uxp was not found at ${entryPath}. The lookup uses the skill repository, not the process cwd (${process.cwd()}).`);
  }
  const loaded = await import(pathToFileURL(entryPath).href);
  const create = loaded.createBoltUXP || loaded.default?.createBoltUXP;
  if (typeof create !== "function") {
    throw new Error("create-bolt-uxp did not export createBoltUXP. The skill will not clone a boilerplate tree in its place.");
  }
  const previous = process.cwd();
  process.chdir(parent);
  try {
    if (typeof options.webview !== "boolean" || typeof options.hybrid !== "boolean") {
    throw new Error("Runtime was not chosen. The installer will not force webview or hybrid.");
  }
  const result = await create({
      folder: options.folderName,
      displayName: options.displayName,
      id: options.id,
      framework: options.framework,
      apps: [options.app],
      hybrid: options.hybrid,
      webview: options.webview,
      sampleCode: false,
      installDeps: Boolean(options.installDeps)
    });
    const folder = path.join(parent, options.folderName);
    const declared = declareManifest(folder, {
      id: options.id,
      displayName: options.displayName,
      host: options.app
    });
    const repair = repairEntrypoint(folder);
    const icons = copyStarterIcons(folder, options.repoRoot || folder);
    const auditFix = options.installDeps ? applyNonBreakingAuditFix(folder) : { applied: false, reason: "Dependencies were not installed." };
    return {
      folder,
      installer: "create-bolt-uxp@1.3.27",
      webview: options.webview,
      hybrid: options.hybrid,
      repair,
      icons,
      declared,
      auditFix,
      result: result ?? null
    };
  } finally {
    process.chdir(previous);
  }
}

/**
 * Adobe's manifest page says current UXP hosts use manifest version 5.
 * Premiere's introduction says Premiere (version 25.6). uniqueIds true appends a host suffix the user did not type.
 */
export function declareManifest(project, { id = "", displayName = "", host = "" } = {}) {
  const configPath = path.join(project, "uxp.config.ts");
  if (!fs.existsSync(configPath)) return { applied: false, reason: "uxp.config.ts is missing." };
  let text = fs.readFileSync(configPath, "utf8");
  text = text.replace(/uniqueIds:\s*true/, "uniqueIds: false");
  text = text.replace(/manifestVersion:\s*\d+/, `manifestVersion: ${DECLARED_MANIFEST.version}`);
  if (id) text = text.replace(/export const id = "[^"]+"/, `export const id = ${JSON.stringify(id)}`);
  if (displayName) {
    text = text.replace(/const name = "[^"]+"/, `const name = ${JSON.stringify(displayName)}`);
    text = text.replaceAll("Bolt UXP", displayName);
  }
  if (host === "ppro" || host === "premierepro") {
    text = text.replace(/(app:\s*"premierepro"[\s\S]*?minVersion:\s*")[^"]+"/, `$1${DECLARED_MANIFEST.premiereMinVersion}"`);
  }
  fs.writeFileSync(configPath, text);
  for (const relative of ["index.html", "package.json"]) {
    const file = path.join(project, relative);
    if (!fs.existsSync(file) || !displayName) continue;
    fs.writeFileSync(file, fs.readFileSync(file, "utf8").replaceAll("Bolt UXP", displayName));
  }
  return {
    applied: true,
    manifestVersion: DECLARED_MANIFEST.version,
    uniqueIds: false,
    premiereMinVersion: host === "ppro" || host === "premierepro" ? DECLARED_MANIFEST.premiereMinVersion : ""
  };
}

/** Update the generated lockfile inside the ranges Bolt already declared. Never pass --force. */
function applyNonBreakingAuditFix(folder) {
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const pkgPath = path.join(folder, "package.json");
  const lockPath = path.join(folder, "package-lock.json");
  const before = fs.existsSync(pkgPath) ? fs.readFileSync(pkgPath, "utf8") : "";
  const lockBefore = fs.existsSync(lockPath) ? fs.readFileSync(lockPath) : null;
  const result = spawnSync(npm, ["audit", "fix", "--package-lock-only"], {
    cwd: folder,
    encoding: "utf8",
    timeout: 180000
  });
  if (before && fs.existsSync(pkgPath) && fs.readFileSync(pkgPath, "utf8") !== before) {
    fs.writeFileSync(pkgPath, before);
    if (lockBefore) fs.writeFileSync(lockPath, lockBefore);
    return {
      applied: false,
      status: result.status,
      reason: "npm audit fix rewrote package.json. The Bolt dependency declarations were restored and the lockfile update was not installed."
    };
  }
  if (!(result.status === 0 || result.status === 1)) {
    return {
      applied: false,
      status: result.status,
      reason: `npm audit fix did not finish (${result.error ? result.error.message : result.status}). The installer tree was left as create-bolt-uxp wrote it.`
    };
  }
  const install = spawnSync(npm, ["ci"], { cwd: folder, encoding: "utf8", timeout: 180000 });
  return {
    applied: install.status === 0,
    status: result.status,
    installStatus: install.status,
    reason: install.status === 0
      ? "The lockfile was updated inside the declared ranges and reinstalled. npm audit fix was not passed --force. Remaining advisories were left in place."
      : "The lockfile update did not reinstall. The generated tree may still be the original install."
  };
}
