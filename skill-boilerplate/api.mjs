/**
 * Public surface of the skill boilerplate.
 * A skill imports this file and nothing under .claude/ or scripts/.
 *
 * The intended future home is https://github.com/ThisIsMrAli/skill-boilerplate.
 * That repo is not created or written by this tree. Switch the consumer's
 * one path only after the owner confirms the repo is private.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { refreshSkill } from "./.claude/skills/skill-boilerplate/scripts/refresh.mjs";
import { sessionCommand } from "./.claude/skills/skill-boilerplate/scripts/session.mjs";
import { startSkill } from "./.claude/skills/skill-boilerplate/scripts/start.mjs";

const root = path.dirname(fileURLToPath(import.meta.url));
const skill = path.join(root, ".claude", "skills", "skill-boilerplate");
const dashboardScript = path.join(skill, "scripts", "dashboard.mjs");

export const PUBLIC_ENTRY = "api.mjs";

export async function start(options) {
  applyEnv(options);
  return startSkill(options);
}

export async function session(argv, options = {}) {
  applyEnv(options);
  return sessionCommand(argv, options.out);
}

export async function refresh(options) {
  applyEnv(options);
  return refreshSkill(options);
}

/** Start, stop, or status. Returns the dashboard JSON. Does not fetch docs. */
export function dashboard(argv, options = {}) {
  applyEnv(options);
  const args = [...argv];
  if (options.out && !args.includes("--out")) args.push("--out", options.out);
  const result = spawnSync(process.execPath, [dashboardScript, ...args], {
    encoding: "utf8",
    env: process.env
  });
  let json = null;
  const raw = result.stdout || "";
  const startAt = raw.indexOf("{");
  if (startAt >= 0) {
    try {
      json = JSON.parse(raw.slice(startAt));
    } catch {
      json = null;
    }
  }
  return { status: result.status, stdout: result.stdout, stderr: result.stderr, json };
}

function applyEnv(options = {}) {
  if (options.extensionPath) process.env.SKILL_EXTENSION = options.extensionPath;
  if (options.extension?.homeDirName) process.env.SKILL_HOME_NAME = options.extension.homeDirName;
  if (options.homeDirName) process.env.SKILL_HOME_NAME = options.homeDirName;
  if (options.out) process.env.SKILL_OUT = options.out;
  if (options.sessionBin) process.env.SKILL_SESSION_BIN = options.sessionBin;
  if (options.dashboardBin) process.env.SKILL_DASHBOARD_BIN = options.dashboardBin;
  if (options.refreshBin) process.env.SKILL_REFRESH_BIN = options.refreshBin;
}
