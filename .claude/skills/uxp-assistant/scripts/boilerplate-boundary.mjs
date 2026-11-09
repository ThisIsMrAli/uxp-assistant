import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * The only path from UXP Assistant into the skill boilerplate.
 *
 * The repo layout keeps the boilerplate at the repository root. An
 * `npx skills add` layout keeps it beside this skill. Either way this
 * file imports api.mjs and nothing under the boilerplate skill tree.
 */
export function findBoilerplateApi(start = here) {
  let dir = start;
  for (let i = 0; i < 8; i += 1) {
    const beside = path.join(dir, "skill-boilerplate", "api.mjs");
    if (fs.existsSync(beside)) return beside;
    const sibling = path.join(path.dirname(dir), "skill-boilerplate", "api.mjs");
    if (fs.existsSync(sibling)) return sibling;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return "";
}

export const BOILERPLATE_API = findBoilerplateApi();
export const BOILERPLATE_ROOT = BOILERPLATE_API ? path.dirname(BOILERPLATE_API) : "";

export async function loadBoilerplate() {
  if (!BOILERPLATE_API) {
    throw new Error("Cannot find skill-boilerplate/api.mjs. Install that folder beside this skill, or at the repository root. This skill does not fetch it.");
  }
  return import(pathToFileURL(BOILERPLATE_API).href);
}
