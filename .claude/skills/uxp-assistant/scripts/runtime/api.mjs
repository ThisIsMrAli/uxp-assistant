/**
 * Session runtime used by scripts/skill.mjs.
 * The session files, the dashboard server, the wait contract, and the dashboard page
 * are derived from express-addon-review 0.4.0. The MIT notice is in LICENSE.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sessionCommand } from "./session.mjs";
import { adoptAsk as adoptAskImpl } from "./lib/session.mjs";
import { startSkill } from "./start.mjs";

const dashboardScript = fileURLToPath(new URL("./dashboard.mjs", import.meta.url));

export async function start(options) {
  applyEnv(options);
  return startSkill(options);
}

export async function session(argv, options = {}) {
  applyEnv(options);
  return sessionCommand(argv, options.out);
}

export function adoptAsk(out, ask) {
  return adoptAskImpl(out, ask);
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
}
