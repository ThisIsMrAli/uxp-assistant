import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

export const skillRoot = path.resolve(here, "../..");
export const liveDir = path.join(skillRoot, "references", "live");
export const assetsDir = path.join(skillRoot, "assets", "dashboard");
export const templateDir = path.join(skillRoot, "templates");

function homeBase() {
  if (!process.env.SKILL_TEST_HOME && process.env.NODE_TEST_CONTEXT) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "uxp-home-"));
    process.env.SKILL_TEST_HOME = dir;
    process.on("exit", () => fs.rmSync(dir, { recursive: true, force: true }));
  }
  if (process.env.SKILL_TEST_HOME) return process.env.SKILL_TEST_HOME;
  return process.env.HOME || os.homedir();
}

/** Sessions live outside the skill and outside the plugin being built. */
export function homeDir() {
  return path.join(homeBase(), ".uxp-assistant");
}

function pointer() {
  return path.join(homeDir(), "current.json");
}

export function defaultOut(slug) {
  return path.join(homeDir(), slug);
}

export function rememberOut(out) {
  fs.mkdirSync(homeDir(), { recursive: true });
  fs.writeFileSync(pointer(), `${JSON.stringify({ out, at: new Date().toISOString() })}\n`);
}

export function rememberedOut() {
  try {
    const last = JSON.parse(fs.readFileSync(pointer(), "utf8")).out;
    return last && fs.existsSync(last) ? last : null;
  } catch {
    return null;
  }
}

/** `--out`, then UXP_ASSISTANT_OUT, then the folder the last session wrote. */
export function resolveOut(explicit) {
  if (explicit) return path.resolve(explicit);
  if (process.env.UXP_ASSISTANT_OUT) return path.resolve(process.env.UXP_ASSISTANT_OUT);
  const last = rememberedOut();
  if (last) return last;
  throw new Error("No session folder. Run assist.mjs first, or pass --out.");
}
