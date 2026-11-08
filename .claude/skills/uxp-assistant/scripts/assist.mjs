#!/usr/bin/env node
/**
 * Start or continue a UXP Assistant session.
 *
 *   assist.mjs start --empty /path/to/parent --answers answers.json --out /tmp/session
 *   assist.mjs start --project /path/to/existing --answers answers.json --out /tmp/session
 *   assist.mjs continue --out /tmp/session
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { rememberOut, resolveOut } from "./lib/paths.mjs";
import { implementLayerRename } from "./lib/implement.mjs";
import { readMerged, readSession } from "./lib/session.mjs";
import { recordImplementation, runWorkflow } from "./lib/workflow.mjs";

const ranDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (ranDirectly) {
  const [command, ...rest] = process.argv.slice(2);
  const args = parse(rest);
  try {
    const result = await execute(command, args);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (result && result.ok === false) process.exitCode = 2;
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ ok: false, error: error.message })}\n`);
    process.exitCode = 1;
  }
}

export async function execute(command, args) {
  if (command === "record") return record(args);
  if (command === "apply-fixture") return applyFixture(args);
  if (command !== "start" && command !== "continue") throw new Error("Use start, continue, record, or apply-fixture.");
  const answers = args.answers ? JSON.parse(fs.readFileSync(path.resolve(args.answers), "utf8")) : {};
  const out = command === "start" ? path.resolve(args.out || path.join(process.cwd(), ".uxp-session")) : resolveOut(args.out);
  if (command === "start" && readSession(out) && !args.force) throw new Error(`A session already exists in ${out}.`);
  rememberOut(out);
  const kind = args.project ? "existing" : "empty";
  return runWorkflow({
    out,
    kind,
    projectPath: args.project ? path.resolve(args.project) : "",
    answers,
    offline: Boolean(args.offline) || process.env.UXP_ASSISTANT_OFFLINE === "1",
    installDeps: Boolean(args.install),
    packageProject: Boolean(args.package),
    workDir: args.work ? path.resolve(args.work) : undefined
  });
}

function record(args) {
  const out = resolveOut(args.out);
  const claimed = JSON.parse(fs.readFileSync(path.resolve(args.result), "utf8"));
  return recordImplementation(out, claimed);
}

function applyFixture(args) {
  const out = resolveOut(args.out);
  const session = readMerged(out);
  const contract = session?.contract;
  if (contract?.fixture !== "selected-layer-rename" || !/rename/i.test(contract.goal || "") || !/layer/i.test(contract.goal || "")) {
    throw new Error("The rename fixture applies only when the contract names it and the goal is still a layer rename.");
  }
  const written = implementLayerRename(contract.projectPath, { narrowPermissions: false });
  return {
    ok: false,
    success: false,
    state: "awaiting-agent-implementation",
    wrote: written.files,
    hostExecuted: false,
    say: "Fixture files were written. Record them with agent-result.json. This is not completion."
  };
}

function parse(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) args[key] = true;
    else {
      args[key] = value;
      i += 1;
    }
  }
  return args;
}
