import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { DECLARED_MANIFEST } from "./floors.mjs";
import { skillRoot } from "./paths.mjs";
import { installTree, npmCommand, verifyTree } from "./tooling.mjs";

export const repoRoot = path.resolve(skillRoot, "../../..");

export const INSTALLER_VERSION = "1.3.27";
/** sha256 of create-bolt-uxp@1.3.27 dist/index.js as published on npm. Published versions are immutable. */
export const INSTALLER_SHA256 = "11a89a9092af122af104a696852c5442c766ed69e6eb571592244b411090ee47";

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

/** The skill's own source repo, where npm ci installs the pinned tooling for development. */
function sourceRepo(skillDirectory = skillRoot) {
  const repo = path.resolve(skillDirectory, "../../..");
  return readJson(path.join(repo, "package.json"))?.name === "uxp-assistant" ? repo : "";
}

/** The documented install is the directory next to the skill, not the project root. */
export function toolingPrefix(skillDirectory = skillRoot) {
  return path.join(path.resolve(skillDirectory), "..", ".uxp-tooling");
}

/**
 * The only places the installer is loaded from, as absolute paths computed from the skill's own folder:
 * the pinned tooling beside the skill, then the skill's source repo. Parent folders and process.cwd()
 * are never searched, so a planted node_modules/create-bolt-uxp in an ancestor does not run, and the
 * lookup is the same from any working directory.
 */
export function installerRoots(skillDirectory = skillRoot) {
  const roots = [path.join(toolingPrefix(skillDirectory), "node_modules")];
  const repo = sourceRepo(skillDirectory);
  if (repo) roots.push(path.join(repo, "node_modules"));
  return roots;
}

/**
 * create-bolt-uxp must be exactly 1.3.27 with the published bytes, and (NQ11) the whole tree it loads
 * must match the lock and file digests shipped in tooling/: every dependency, exact versions, no
 * symlink out of the folder, no extra package.
 */
export function verifyInstaller(modulesDir) {
  const dir = path.join(modulesDir, "create-bolt-uxp");
  const pkg = readJson(path.join(dir, "package.json"));
  if (!pkg) return { ok: false, reason: `${dir} has no create-bolt-uxp package.json` };
  if (pkg.name !== "create-bolt-uxp" || pkg.version !== INSTALLER_VERSION) {
    return { ok: false, reason: `${dir} is ${pkg.name || "?"}@${pkg.version || "?"}, not create-bolt-uxp@${INSTALLER_VERSION}` };
  }
  const entry = path.join(dir, "dist", "index.js");
  let digest = "";
  try {
    digest = crypto.createHash("sha256").update(fs.readFileSync(entry)).digest("hex");
  } catch {
    return { ok: false, reason: `${entry} is missing` };
  }
  if (digest !== INSTALLER_SHA256) return { ok: false, reason: `${entry} sha256 ${digest} is not the published create-bolt-uxp@${INSTALLER_VERSION}` };
  for (const name of Object.keys(pkg.dependencies || {})) {
    const nested = path.join(dir, "node_modules", name, "package.json");
    const hoisted = path.join(modulesDir, name, "package.json");
    if (!fs.existsSync(nested) && !fs.existsSync(hoisted)) return { ok: false, reason: `${name} is not installed beside create-bolt-uxp in ${modulesDir}` };
  }
  const tree = verifyTree(modulesDir);
  if (!tree.ok) return { ok: false, reason: tree.reason };
  return { ok: true, entry };
}

export function installerEntry(skillDirectory = skillRoot) {
  for (const root of installerRoots(skillDirectory)) {
    const checked = verifyInstaller(root);
    if (checked.ok) return checked.entry;
  }
  return "";
}

/** The install the skill runs: npm ci of the shipped lock (exact versions and integrity), with no install scripts. */
export function pinnedInstallArgs(prefix) {
  return ["ci", "--prefix", prefix, "--no-audit", "--no-fund", "--ignore-scripts", "--loglevel=error"];
}

/**
 * Install the pinned tooling beside the skill when no verified copy is there. A tree that fails
 * verification (tampered, half-written by a concurrent install, a symlinked copy) is replaced.
 * notify(text) is called before and after the install so the dashboard shows it.
 * options.npm is for tests only: an absolute executable run instead of node + npm-cli.js.
 */
export function ensureInstaller(options = {}) {
  const skillDirectory = options.skillDirectory || skillRoot;
  const notify = typeof options.notify === "function" ? options.notify : () => {};
  const found = installerEntry(skillDirectory);
  if (found) return found;
  const prefix = toolingPrefix(skillDirectory);
  const before = fs.existsSync(path.join(prefix, "node_modules")) ? verifyInstaller(path.join(prefix, "node_modules")) : null;
  if (before && !before.ok) notify(`The pinned tooling in ${prefix} failed verification (${before.reason}). It will be replaced.`);
  notify(`Installing create-bolt-uxp@${INSTALLER_VERSION} into ${prefix}. This needs the network once and takes about 15 seconds.`);
  let installed;
  try {
    installed = installTree(prefix, { npm: options.npm, notify });
  } catch (error) {
    notify(`create-bolt-uxp@${INSTALLER_VERSION} install into ${prefix} failed.`);
    throw new Error(`create-bolt-uxp@${INSTALLER_VERSION} was not found beside the skill, and installing the pinned tooling failed: ${error.message} Fix that and run the same command again; the skill repairs ${prefix} itself.`);
  }
  const checked = verifyInstaller(path.join(prefix, "node_modules"));
  if (!checked.ok) {
    notify(`create-bolt-uxp@${INSTALLER_VERSION} install into ${prefix} failed.`);
    throw new Error(`create-bolt-uxp@${INSTALLER_VERSION} install into ${prefix} did not give the published package: ${checked.reason}`);
  }
  notify(`Installed create-bolt-uxp@${INSTALLER_VERSION} into ${prefix}${installed.repaired ? " (the broken copy was replaced)" : ""}.`);
  return checked.entry;
}

export function starterIconsDir(skillDirectory = skillRoot) {
  for (const root of installerRoots(typeof skillDirectory === "string" && fs.existsSync(path.join(skillDirectory, "SKILL.md")) ? skillDirectory : skillRoot)) {
    for (const dir of [path.join(root, "bolt-uxp", "public", "icons"), path.join(root, "create-bolt-uxp", "node_modules", "bolt-uxp", "public", "icons")]) {
      if (fs.existsSync(dir)) return dir;
    }
  }
  return path.join(toolingPrefix(), "node_modules", "bolt-uxp", "public", "icons");
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
  const entryPath = ensureInstaller({ notify: options.onActivity });
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
      installer: `create-bolt-uxp@${INSTALLER_VERSION}`,
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
  const npm = npmCommand();
  const pkgPath = path.join(folder, "package.json");
  const lockPath = path.join(folder, "package-lock.json");
  const before = fs.existsSync(pkgPath) ? fs.readFileSync(pkgPath, "utf8") : "";
  const lockBefore = fs.existsSync(lockPath) ? fs.readFileSync(lockPath) : null;
  const result = spawnSync(npm.command, [...npm.args, "audit", "fix", "--package-lock-only"], {
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
  const install = spawnSync(npm.command, [...npm.args, "ci"], { cwd: folder, encoding: "utf8", timeout: 180000 });
  return {
    applied: install.status === 0,
    status: result.status,
    installStatus: install.status,
    reason: install.status === 0
      ? "The lockfile was updated inside the declared ranges and reinstalled. npm audit fix was not passed --force. Remaining advisories were left in place."
      : "The lockfile update did not reinstall. The generated tree may still be the original install."
  };
}
