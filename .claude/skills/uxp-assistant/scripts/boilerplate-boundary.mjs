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
  const found = [];
  let dir = path.resolve(start);
  for (let i = 0; i < 8; i += 1) {
    for (const candidate of [
      path.join(dir, "skill-boilerplate", "api.mjs"),
      path.join(path.dirname(dir), "skill-boilerplate", "api.mjs")
    ]) {
      const resolved = path.resolve(candidate);
      if (fs.existsSync(resolved) && !found.includes(resolved)) found.push(resolved);
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  const skillRoot = path.resolve(here, "..");
  const nested = path.join(skillRoot, "skill-boilerplate", "api.mjs");
  const outside = found.find((item) => item !== path.resolve(nested));
  return outside || found[0] || "";
}

export const BOILERPLATE_API = findBoilerplateApi();
export const BOILERPLATE_ROOT = BOILERPLATE_API ? path.dirname(BOILERPLATE_API) : "";

export async function loadBoilerplate() {
  if (!BOILERPLATE_API) {
    throw new Error("Cannot find skill-boilerplate/api.mjs. Install that folder beside this skill, or at the repository root. This skill does not fetch it.");
  }
  return import(pathToFileURL(BOILERPLATE_API).href);
}
