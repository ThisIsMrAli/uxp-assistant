import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { skillRoot } from "./paths.mjs";

/** The installer is resolved from this repository, not from process.cwd(). */
export const repoRoot = path.resolve(skillRoot, "../../..");

export function installerEntry(root = repoRoot) {
  return path.join(root, "node_modules/create-bolt-uxp/dist/index.js");
}

export function starterIconsDir(root = repoRoot) {
  return path.join(root, "node_modules/bolt-uxp/public/icons");
}

/**
 * sampleCode:false strips the globals import and leaves `uxp.entrypoints`.
 * Vite does not typecheck that identifier. Import the starter's uxp binding.
 */
export function repairEntrypoint(project) {
  const relative = "src/main.tsx";
  const main = path.join(project, relative);
  if (!fs.existsSync(main)) return { repaired: false, reason: "no main.tsx" };
  const text = fs.readFileSync(main, "utf8");
  const uses = /\buxp\s*\./.test(text);
  const imported = /import\s*\{[^}]*\buxp\b[^}]*\}\s*from\s*["']\.\/globals["']/.test(text);
  if (!uses) return { repaired: false, reason: "main.tsx does not reference uxp." };
  if (imported) return { repaired: false, reason: "uxp is already imported." };
  fs.writeFileSync(main, `import { uxp } from "./globals";\n${text}`);
  return { repaired: true, file: relative, reason: "Added the globals import that sampleCode:false removes." };
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
    const repair = repairEntrypoint(folder);
    const icons = copyStarterIcons(folder, options.repoRoot);
    return {
      folder,
      installer: "create-bolt-uxp@1.3.27",
      webview: options.webview,
      hybrid: options.hybrid,
      repair,
      icons,
      result: result ?? null
    };
  } finally {
    process.chdir(previous);
  }
}
