#!/usr/bin/env node
/**
 * UXP Assistant's only door into the skill boilerplate.
 * start, session, dashboard, and refresh are the boilerplate.
 * domain runs the existing handoff after those questions, in a nested folder,
 * so it does not overwrite the dashboard session.
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { loadBoilerplate } from "./boilerplate-boundary.mjs";

const here = path.dirname(pathToFileURL(process.argv[1] || "").pathname || "");
const extensionPath = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../extension.mjs");
const bins = {
  sessionBin: "node scripts/skill.mjs session",
  dashboardBin: "node scripts/skill.mjs dashboard",
  refreshBin: "node scripts/skill.mjs refresh"
};

const ranDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (ranDirectly) {
  try {
    const result = await run(process.argv.slice(2));
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (result && result.ok === false) process.exitCode = 2;
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ ok: false, error: error.message })}\n`);
    process.exitCode = 1;
  }
}

export async function run(argv) {
  const [command, ...rest] = argv;
  const args = parse(rest);
  const out = args.out ? path.resolve(args.out) : "";
  const api = await loadBoilerplate();
  const common = { extensionPath, out, homeDirName: ".uxp-assistant", ...bins };
  if (command === "start") {
    if (!out) throw new Error("Pass --out.");
    const result = await api.start({
      ...common,
      input: args.project || args.input || "",
      kind: args.project ? "existing" : "empty",
      remote: Boolean(args.remote)
    });
    fs.writeFileSync(path.join(out, "launch.json"), `${JSON.stringify({ kind: args.project ? "existing" : "empty", project: args.project || "" })}\n`);
    return result;
  }
  if (command === "session") return api.session(rest, common);
  if (command === "dashboard") {
    const result = api.dashboard(rest, common);
    return result.json || { ok: false, status: result.status, error: result.stderr || result.stdout };
  }
  if (command === "refresh") return api.refresh(common);
  if (command === "domain") return domain(api, out);
  throw new Error("Use start, session, dashboard, refresh, or domain.");
}

async function domain(api, out) {
  if (!out) throw new Error("Pass --out.");
  const answers = answersFrom(out);
  if (typeof answers.permissions === "string") {
    answers.permissions = answers.permissions.trim() === "none" || answers.permissions.trim() === ""
      ? []
      : answers.permissions.split(",").map((item) => item.trim()).filter(Boolean);
  }
  const launch = JSON.parse(fs.readFileSync(path.join(out, "launch.json"), "utf8"));
  const { runWorkflow } = await import("./lib/workflow.mjs");
  return runWorkflow({
    out: path.join(out, "domain"),
    kind: launch.kind,
    projectPath: launch.project ? path.resolve(launch.project) : "",
    answers
  });
}

function answersFrom(folder) {
  const session = JSON.parse(fs.readFileSync(path.join(folder, "session.json"), "utf8"));
  let lines = [];
  try {
    lines = fs.readFileSync(path.join(folder, "answers.jsonl"), "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));
  } catch {
    lines = [];
  }
  const answers = {};
  for (const ask of session.asks || []) {
    const line = lines.find((item) => item.type === "answer" && item.askId === ask.id && item.nonce === ask.nonce);
    if (line) answers[ask.id] = line.value;
  }
  return answers;
}

function parse(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) parsed[key] = true;
    else {
      parsed[key] = value;
      i += 1;
    }
  }
  return parsed;
}

void here;
