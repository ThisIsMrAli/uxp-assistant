import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

/** The directory that holds SKILL.md. */
export const skillRoot = path.resolve(here, "../..");
