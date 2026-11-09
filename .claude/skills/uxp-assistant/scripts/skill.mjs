#!/usr/bin/env node
/**
 * UXP Assistant's only door into the skill boilerplate.
 * start, session, dashboard, and refresh are the boilerplate.
 * domain runs the existing handoff after those questions, in a nested folder,
 * so it does not overwrite the dashboard session.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { findBoilerplateApi, loadBoilerplate } from "./boilerplate-boundary.mjs";

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
    process.exit(result && result.ok === false ? 2 : 0);
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ ok: false, error: error.message })}\n`);
    process.exit(1);
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
    const project = typeof args.project === "string" ? args.project : "";
    const empty = typeof args.empty === "string" ? args.empty : "";
    const input = project || empty || (typeof args.input === "string" ? args.input : "");
    const kind = project ? "existing" : "empty";
    const result = await api.start({
      ...common,
      input,
      kind,
      remote: Boolean(args.remote)
    });
    fs.writeFileSync(path.join(out, "launch.json"), `${JSON.stringify({ kind, project, input })}\n`);
    return result;
  }
  if (command === "session") return specialize(await api.session(rest, common), out);
  if (command === "dashboard") {
    const result = api.dashboard(rest, common);
    return result.json || { ok: false, status: result.status, error: result.stderr || result.stdout };
  }
  if (command === "refresh") return api.refresh(common);
  if (command === "domain") return domain(out, api);
  if (command === "record") return recordResult(out, api);
  if (command === "install") return installInto(args.into);
  throw new Error("Use start, session, dashboard, refresh, domain, record, or install.");
}

async function domain(out, api) {
  if (!out) throw new Error("Pass --out.");
  const answers = answersFrom(out);
  if (typeof answers.permissions === "string") {
    answers.permissions = answers.permissions.trim() === "none" || answers.permissions.trim() === ""
      ? []
      : answers.permissions.split(",").map((item) => item.trim()).filter(Boolean);
  }
  const launch = JSON.parse(fs.readFileSync(path.join(out, "launch.json"), "utf8"));
  if (launch.kind === "existing" && launch.project) {
    const facts = projectFacts(path.resolve(launch.project));
    answers.name = answers.name || facts.name;
    answers.id = answers.id || facts.id;
    answers.framework = answers.framework || facts.framework;
    answers.context = answers.context || facts.context;
  }
  if (launch.kind === "empty" && !launch.input) {
    throw new Error("Pass --empty <folder>. The scaffold is created in that folder, not under the session.");
  }
  const { runWorkflow } = await import("./lib/workflow.mjs");
  const fixture = process.env.SKILL_DOC_FIXTURE;
  const handed = await runWorkflow({
    out: path.join(out, "domain"),
    kind: launch.kind,
    projectPath: launch.kind === "existing" && launch.project ? path.resolve(launch.project) : "",
    workDir: launch.kind === "empty" ? path.resolve(launch.input) : undefined,
    remember: false,
    dashboardOut: out,
    answers,
    ...(fixture ? { fetchImpl: async (url) => ({ ok: true, status: 200, text: async () => `${fixture}\n${url}` }) } : {})
  });
  if (handed?.state === "awaiting-agent-implementation" && api) {
    await api.session(["step", "--id", "intake", "--status", "done", "--detail", "Intake answered.", "--out", out]);
    await api.session(["step", "--id", "decide", "--status", "running", "--doing", "Writing the feature", "--out", out]);
  }
  return handed;
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function specialize(result, out) {
  if (!result || typeof result !== "object" || !out) return result;
  const domainSession = readJson(path.join(out, "domain", "session.json"));
  const recorded = readJson(path.join(out, "domain", "record-result.json"));
  const outcome = domainSession?.outcome || "";
  const command = `node scripts/skill.mjs record --out ${out}`;
  if (outcome === "commands-finished" || recorded?.state === "commands-finished") {
    const next = "Commands finished. The Adobe host was NOT TESTED. The session is finished. Run node scripts/skill.mjs dashboard stop if the dashboard is still up.";
    return { ...result, action: "finished", step: "done", command: "", next, say: next, hostExecuted: false };
  }
  if (recorded?.state === "script-change" || outcome === "script-change") {
    const pending = scriptChangePending(out);
    if (pending) {
      const next = `The script-change approval is on the dashboard. Run node scripts/skill.mjs session wait --id script-change --out ${out}. Do not run the changed scripts before it is approved.`;
      return { ...result, action: "wait", ask: "script-change", step: "decide", command: `node scripts/skill.mjs session wait --id script-change --out ${out}`, next, say: next };
    }
    const next = `The script-change answer is recorded. Run ${command} again for that exact set. The host was NOT TESTED.`;
    return { ...result, action: "record", step: "decide", command, next, say: next };
  }
  if (recorded?.state && recorded.state !== "commands-finished") {
    const next = `${recorded.say || "The record did not finish."} Fix the project, update agent-result.json, and run ${command} again. The host was NOT TESTED.`;
    return { ...result, action: "record", step: "decide", command, next, say: next, hostExecuted: false };
  }
  const handed = outcome === "awaiting-agent-implementation";
  if (handed && (result.action === "finish" || result.action === "apply" || result.action === "domain")) {
    const next = `Add a "test" script and run npm install in the project. A WebView project also needs npm install inside webview-ui. Write agent-result.json as {"goal":"<the same goal>","files":[{"path":"<relative>","sha256":"<hex>"}]}. Then run ${command}. That command runs the validator and records the test, build, and package exits. The host was NOT TESTED.`;
    return { ...result, action: "record", step: "decide", command, next, say: next };
  }
  if (result.action === "finish" || result.action === "apply") {
    const command = `node scripts/skill.mjs domain --out ${out}`;
    const next = `Run ${command}. Do not mark tests, package, or the host done. The host is not launched.`;
    return { ...result, action: "domain", command, next, say: next };
  }
  return { ...result, next: result.next || result.say };
}

function scriptChangePending(out) {
  const session = readJson(path.join(out, "session.json"));
  const ask = (session?.asks || []).find((item) => item.id === "script-change");
  if (!ask) return false;
  let lines = [];
  try {
    lines = fs.readFileSync(path.join(out, "answers.jsonl"), "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));
  } catch {
    lines = [];
  }
  return !lines.some((line) => line.type === "answer" && line.askId === "script-change" && line.nonce === ask.nonce);
}

function mirrorScriptAnswer(mainOut, domainOut) {
  const domain = readJson(path.join(domainOut, "session.json"));
  const ask = (domain?.asks || []).find((item) => item.id === "script-change");
  if (!ask) return;
  let mainLines = [];
  try {
    mainLines = fs.readFileSync(path.join(mainOut, "answers.jsonl"), "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));
  } catch {
    mainLines = [];
  }
  const line = mainLines.find((item) => item.type === "answer" && item.askId === "script-change" && item.nonce === ask.nonce);
  if (!line) return;
  const answers = path.join(domainOut, "answers.jsonl");
  const existing = fs.existsSync(answers) ? fs.readFileSync(answers, "utf8") : "";
  if (existing.includes(`"nonce":${JSON.stringify(ask.nonce)}`) && existing.includes('"askId":"script-change"')) return;
  fs.appendFileSync(answers, `${JSON.stringify(line)}\n`);
}

async function recordResult(out, api) {
  if (!out) throw new Error("Pass --out.");
  const file = path.join(out, "agent-result.json");
  if (!fs.existsSync(file)) throw new Error("Write agent-result.json first. It is { goal, files: [{ path, sha256 }] }.");
  const body = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!body || typeof body.goal !== "string" || !Array.isArray(body.files)) {
    throw new Error("agent-result.json needs a goal string and a files array of { path, sha256 }.");
  }
  const domainSession = JSON.parse(fs.readFileSync(path.join(out, "domain", "session.json"), "utf8"));
  const project = domainSession.contract?.projectPath;
  if (!project) throw new Error("The domain handoff has no project yet.");
  if (body.goal !== domainSession.contract.goal) throw new Error("The recorded goal does not match the requested goal.");
  for (const item of body.files) {
    if (!item || typeof item.path !== "string" || !/^[0-9a-f]{64}$/i.test(item.sha256 || "")) {
      throw new Error("Each file needs a relative path and a sha256 hex string.");
    }
    const full = path.resolve(project, item.path);
    const root = path.resolve(project);
    if (full !== root && !full.startsWith(`${root}${path.sep}`)) throw new Error("A recorded path escapes the project.");
    if (!fs.existsSync(full)) throw new Error(`${item.path} is missing.`);
    const hash = crypto.createHash("sha256").update(fs.readFileSync(full)).digest("hex");
    if (hash !== item.sha256) throw new Error(`${item.path} hash does not match the file on disk.`);
  }
  const domainOut = path.join(out, "domain");
  mirrorScriptAnswer(out, domainOut);
  const { recordImplementation } = await import("./lib/workflow.mjs");
  const result = recordImplementation(domainOut, { goal: body.goal, files: body.files.map((item) => item.path) });
  fs.writeFileSync(path.join(domainOut, "record-result.json"), `${JSON.stringify({
    state: result.state,
    say: result.say || "",
    blocked: result.blocked || "",
    hostExecuted: false
  }, null, 2)}\n`);
  fs.writeFileSync(path.join(domainOut, "recorded.json"), `${JSON.stringify({ goal: body.goal, files: body.files, hostExecuted: false, state: result.state }, null, 2)}\n`);
  if (result.state === "script-change") {
    const ask = (readJson(path.join(domainOut, "session.json"))?.asks || []).find((item) => item.id === "script-change");
    if (ask && api?.adoptAsk) api.adoptAsk(out, ask);
    return {
      ok: false,
      state: "script-change",
      hostExecuted: false,
      say: result.say,
      next: `The script-change approval is on the dashboard. Run node scripts/skill.mjs session wait --id script-change --out ${out}. Do not run the changed scripts before it is approved.`
    };
  }
  if (result.state === "commands-finished") {
    try {
      await api.session(["done", "--summary", "Commands finished. The Adobe host was NOT TESTED.", "--out", out]);
    } catch (error) {
      return {
        ok: true,
        state: "commands-finished",
        hostExecuted: false,
        say: error.message,
        next: `Commands finished. The Adobe host was NOT TESTED. ${error.message}`
      };
    }
    return {
      ok: true,
      state: "commands-finished",
      files: body.files.length,
      hostExecuted: false,
      next: `Commands finished. The Adobe host was NOT TESTED. Run node scripts/skill.mjs session next --out ${out}. It should say the session is finished.`
    };
  }
  return {
    ok: false,
    state: result.state,
    hostExecuted: false,
    say: result.say,
    next: `${result.say || "The record did not finish."} Fix the project, update agent-result.json, and run node scripts/skill.mjs record --out ${out} again. The host was NOT TESTED.`
  };
}

function installInto(dest) {
  if (!dest || dest === true) throw new Error("Pass --into <folder>.");
  const skillDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
  const api = findBoilerplateApi(path.join(skillDir, "scripts"));
  const bpName = ["skill", "boilerplate"].join("-");
  if (!api) throw new Error(`Cannot find ${bpName}/api.mjs to install beside the skill.`);
  const into = path.resolve(dest);
  const skillDest = path.join(into, ".agents", "skills", "uxp-assistant");
  const bpDest = path.join(into, ".agents", "skills", bpName);
  fs.cpSync(skillDir, skillDest, { recursive: true });
  fs.cpSync(path.dirname(api), bpDest, {
    recursive: true,
    filter: (source) => !source.split(path.sep).includes("node_modules")
  });
  const modules = path.join(into, "node_modules");
  const realModules = path.resolve(skillDir, "../../..", "node_modules");
  if (fs.existsSync(realModules) && !fs.existsSync(modules)) fs.symlinkSync(realModules, modules, "dir");
  return {
    ok: true,
    skill: skillDest,
    next: `From ${skillDest}, run node scripts/skill.mjs start --empty <folder> --out <session>.`
  };
}

function projectFacts(project) {
  const config = path.join(project, "uxp.config.ts");
  let id = "";
  let name = "";
  let framework = "react";
  if (fs.existsSync(config)) {
    const text = fs.readFileSync(config, "utf8");
    id = (text.match(/export const id = "([^"]+)"/) || [])[1] || "";
    name = (text.match(/const name = "([^"]+)"/) || [])[1] || "";
  }
  if (fs.existsSync(path.join(project, "src", "main.vue"))) framework = "vue";
  else if (fs.existsSync(path.join(project, "src", "main.svelte"))) framework = "svelte";
  const pkg = path.join(project, "package.json");
  if (!name && fs.existsSync(pkg)) {
    try { name = JSON.parse(fs.readFileSync(pkg, "utf8")).name || ""; } catch { name = ""; }
  }
  return { id, name: name || path.basename(project), framework, context: "panel" };
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
  if (session.mode) answers.mode = session.mode;
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
