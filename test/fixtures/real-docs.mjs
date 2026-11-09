// The docs the skill really fetches for a Photoshop and a Premiere goal, as its refresh step wrote them.
// See real-docs/SOURCES.md. The host corpora are scored on these pages, not on synthetic ones.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { joinPages } from "../../.claude/skills/uxp-assistant/scripts/lib/docs-index.mjs";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "real-docs");
export const REAL_DOC_IDS = fs.readdirSync(dir).filter((name) => name.endsWith(".txt")).sort().map((name) => name.slice(0, -4));
export const REAL_DOCS = joinPages(REAL_DOC_IDS.map((id) => fs.readFileSync(path.join(dir, `${id}.txt`), "utf8")));
/** The same pages without photoshop.app and photoshop.core, as fetched before this skill version asked for them. */
export const REAL_DOCS_BEFORE_APP_CORE = joinPages(REAL_DOC_IDS.filter((id) => id !== "photoshop.app" && id !== "photoshop.core").map((id) => fs.readFileSync(path.join(dir, `${id}.txt`), "utf8")));
