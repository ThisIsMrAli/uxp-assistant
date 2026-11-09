import path from "node:path";
import { pathToFileURL } from "node:url";

/** Load a skill extension. The extension is the only file a skill adds. */
export async function loadExtension(file) {
  if (!file) throw new Error("Pass the extension file.");
  const mod = await import(pathToFileURL(path.resolve(file)).href);
  const ext = mod.default || mod.extension;
  if (!ext || typeof ext !== "object") throw new Error("The extension must default-export an object.");
  if (!ext.id) throw new Error("The extension needs an id.");
  if (!Array.isArray(ext.steps) || !ext.steps.length) throw new Error("The extension needs a steps array.");
  if (!ext.steps.some((step) => step.id === "done")) throw new Error("The extension steps must include done.");
  return ext;
}
