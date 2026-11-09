import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * The only path from UXP Assistant into the skill boilerplate.
 *
 * Today the boilerplate is the standalone folder at the top of this repo.
 * The repository https://github.com/ThisIsMrAli/skill-boilerplate is private.
 * This run does not push to it. After the owner moves the folder, change
 * BOILERPLATE_ROOT to that package and leave this file as the only import.
 * Do not import the boilerplate's scripts, assets, or tests.
 */
export const BOILERPLATE_ROOT = path.resolve(here, "../../../../skill-boilerplate");
export const BOILERPLATE_API = path.join(BOILERPLATE_ROOT, "api.mjs");

export async function loadBoilerplate() {
  return import(pathToFileURL(BOILERPLATE_API).href);
}
