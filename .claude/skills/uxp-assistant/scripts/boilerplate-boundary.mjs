import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * The only path from UXP Assistant into the skill boilerplate.
 *
 * Today the boilerplate is the vendored folder at the top of this repo.
 * BOILERPLATE.lock pins that folder by content hash. Replace it with the
 * repository sync script. The source repository is private and is not
 * pushed from here. Do not import anything except api.mjs.
 */
export const BOILERPLATE_ROOT = path.resolve(here, "../../../../skill-boilerplate");
export const BOILERPLATE_API = path.join(BOILERPLATE_ROOT, "api.mjs");

export async function loadBoilerplate() {
  return import(pathToFileURL(BOILERPLATE_API).href);
}
