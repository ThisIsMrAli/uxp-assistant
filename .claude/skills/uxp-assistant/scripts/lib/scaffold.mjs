import path from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Empty-folder projects are created by the published create-bolt-uxp installer.
 * This module does not copy Bolt's template tree itself.
 */
export async function scaffoldWithInstaller(parent, options) {
  process.env.BOLT_MODULEONLY = "true";
  const entry = pathToFileURL(path.resolve("node_modules/create-bolt-uxp/dist/index.js")).href;
  const loaded = await import(entry);
  const create = loaded.createBoltUXP || loaded.default?.createBoltUXP;
  if (typeof create !== "function") {
    throw new Error("create-bolt-uxp did not export createBoltUXP. The skill will not clone a boilerplate tree in its place.");
  }
  const previous = process.cwd();
  process.chdir(parent);
  try {
    const result = await create({
      folder: options.folderName,
      displayName: options.displayName,
      id: options.id,
      framework: options.framework,
      apps: [options.app],
      hybrid: false,
      webview: false,
      sampleCode: false,
      installDeps: Boolean(options.installDeps)
    });
    return {
      folder: path.join(parent, options.folderName),
      installer: "create-bolt-uxp@1.3.27",
      webview: false,
      hybrid: false,
      result: result ?? null
    };
  } finally {
    process.chdir(previous);
  }
}
