import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

export const skillRoot = path.resolve(here, "../..");
export const assetsDir = path.join(skillRoot, "assets", "dashboard");

export function homeDir() {
  return path.join(os.homedir(), process.env.SKILL_HOME_NAME || ".skill-boilerplate");
}

const pointer = () => path.join(homeDir(), "current.json");

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

/** `--out`, then SKILL_OUT, then the folder the last start wrote. */
export function resolveOut(explicit) {
  if (explicit) return path.resolve(explicit);
  if (process.env.SKILL_OUT) return path.resolve(process.env.SKILL_OUT);
  const last = rememberedOut();
  if (last) return last;
  throw new Error("No session folder. Run start.mjs first, or pass --out.");
}

export function sessionBin() {
  return process.env.SKILL_SESSION_BIN || "node scripts/session.mjs";
}

export function dashboardBin() {
  return process.env.SKILL_DASHBOARD_BIN || "node scripts/dashboard.mjs";
}

export function refreshBin() {
  return process.env.SKILL_REFRESH_BIN || "node scripts/refresh.mjs";
}
