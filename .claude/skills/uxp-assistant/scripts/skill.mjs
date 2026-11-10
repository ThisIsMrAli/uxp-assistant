#!/usr/bin/env node
/**
 * UXP Assistant's one command.
 *
 *   start    --goal "<the request, word for word>" [--empty <folder> | --project <folder>] [--mode dashboard|chat] [--yes]
 *   session  mode | ask | wait | answer | next | step | done | show   (the session runtime)
 *   dashboard start | stop | status
 *   docs     save Adobe's docs for the plan's app            (--skip only after two failed tries)
 *   find     search the saved docs                           (find <words> [--host ppro])
 *   build    create the project                              (flags override the plan: --name --id --host --framework)
 *   check    build, package, and read the code against the docs
 *   feedback publish the "try it" card; the developer sends bugs (words, screenshots) until there are none
 *            [--changed "<what you changed>"] [--skip when no person is there]
 *   install  --into <folder>
 *
 * Every command prints one JSON object. `next` says what to run after it.
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { docsDir, planSummary, projectPath, resolvePlan, runBuild, runCheck, runDocs } from "./lib/flow.mjs";
import { runFeedback } from "./lib/feedback.mjs";
import { findInLibrary, hostKey } from "./lib/library.mjs";
import * as api from "./runtime/api.mjs";
import { nextAction, reminder } from "./runtime/lib/next.mjs";
import { homeDir, resolveOut } from "./runtime/lib/paths.mjs";
import { dashboardUp, readSession, setStep } from "./runtime/lib/session.mjs";

const extensionPath = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../extension.mjs");
const bins = {
  sessionBin: "node scripts/skill.mjs session",
  dashboardBin: "node scripts/skill.mjs dashboard"
};
const COMMANDS = "start, session, dashboard, docs, find, build, check, feedback, or install";

const ranDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (ranDirectly) {
  try {
    const result = await run(process.argv.slice(2));
    process.stdout.write(`${JSON.stringify(result)}\n`);
    process.exit(result && result.ok === false && !result.next ? 2 : 0);
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ ok: false, error: error.message })}\n`);
    process.exit(1);
  }
}

export async function run(argv) {
  const [command, ...rest] = argv;
  const args = parse(rest);
  const common = () => ({ extensionPath, out: args.out ? path.resolve(args.out) : "", homeDirName: ".uxp-assistant", ...bins });
  if (command === "start") return start(args);
  if (command === "session") {
    const out = outFor(args);
    if (rest[0] === "ask" && args.id === "plan") refreshPlanCard(out);
    const result = await api.session(rest, { ...common(), out });
    return result && !result.next ? { ...result, next: reminder(out, { dashboardUp: dashboardUp(out) }) } : result;
  }
  if (command === "dashboard") {
    const result = api.dashboard(rest, { ...common(), out: outFor(args) });
    return result.json || { ok: false, status: result.status, error: result.stderr || result.stdout };
  }
  if (command === "docs") {
    const out = outFor(args);
    applyEnv();
    return withNext(out, await runDocs(out, { skip: Boolean(args.skip), overrides: overrides(args) }));
  }
  if (command === "find") return find(args);
  if (command === "build") {
    const out = outFor(args);
    applyEnv();
    const built = await runBuild(out, { overrides: overrides(args) });
    if (built.ask) {
      const file = path.join(out, `${built.ask.id}-ask.json`);
      fs.writeFileSync(file, `${JSON.stringify(built.ask, null, 2)}\n`);
      await api.session(["ask", "--id", built.ask.id, "--definition", file, "--out", out], { ...bins, out });
      return withNext(out, { ok: false, blocked: built.blocked, error: built.error || built.blocked.join(" ") });
    }
    return withNext(out, built);
  }
  if (command === "check") {
    const out = outFor(args);
    applyEnv();
    return withNext(out, await runCheck(out, { overrides: overrides(args) }));
  }
  if (command === "feedback") {
    const out = outFor(args);
    applyEnv();
    const ask = (file) => api.session(["ask", "--id", "feedback", "--definition", file, "--out", out], { ...bins, out });
    return withNext(out, await runFeedback(out, { changed: typeof args.changed === "string" ? args.changed : "", skip: Boolean(args.skip), ask }));
  }
  if (command === "install") return installInto(args.into);
  throw new Error(`Use ${COMMANDS}.`);
}

function applyEnv() {
  process.env.SKILL_HOME_NAME = ".uxp-assistant";
  process.env.SKILL_SESSION_BIN = bins.sessionBin;
  process.env.SKILL_DASHBOARD_BIN = bins.dashboardBin;
}

function outFor(args) {
  applyEnv();
  return resolveOut(args.out);
}

function overrides(args) {
  const keep = {};
  for (const key of ["host", "framework", "name", "id", "runtime", "permissions", "folder"]) if (typeof args[key] === "string") keep[key] = args[key];
  return keep;
}

/** Add the line that says what to run next, from the session alone. */
function withNext(out, result) {
  const session = readSession(out);
  if (!session || result.next) return result;
  const action = nextAction(out, { dashboardUp: dashboardUp(out) });
  return { ...result, next: action.say, ...(action.command ? { command: action.command } : {}) };
}

async function start(args) {
  applyEnv();
  const goal = typeof args.goal === "string" ? args.goal.trim() : "";
  if (!goal) throw new Error("Pass --goal with the developer's request, word for word.");
  const project = typeof args.project === "string" ? path.resolve(args.project) : "";
  const empty = typeof args.empty === "string" ? path.resolve(args.empty) : "";
  const kind = project ? "existing" : "empty";
  const input = project || empty || path.join(homeDir(), "projects");
  const out = args.out ? path.resolve(args.out) : path.join(homeDir(), "sessions", `${slug(goal)}-${stamp()}`);
  const result = await api.start({
    ...bins,
    extensionPath,
    homeDirName: ".uxp-assistant",
    out,
    input,
    kind,
    remote: Boolean(args.remote),
    extra: { goal, project, host: args.host, framework: args.framework, name: args.name, id: args.id, runtime: args.runtime }
  });
  const plan = resolvePlan(out);
  const mode = args.yes ? "chat" : args.mode;
  if (mode === "dashboard" || mode === "chat") {
    await api.session(["mode", "--set", mode, "--out", out], { ...bins, out });
  }
  const auto = [];
  if (args.yes) {
    auto.push("mode=chat");
    // Nobody is there to load it in the Adobe app, so the try step has no one to ask.
    setStep(out, "try", "skipped", "Not asked: this run had no one to try it");
    const questions = JSON.parse(fs.readFileSync(path.join(out, "questions.json"), "utf8"));
    for (const question of questions) {
      if (question.id === "mode" || question.id === "tweak" || question.id === "host" || question.when) continue;
      const value = assumedAnswer(question, goal, resolvePlan(out));
      if (!value) continue;
      if (question.id === "plan" && !resolvePlan(out).host) continue;
      await api.session(["ask", "--id", question.id, "--out", out], { ...bins, out });
      await api.session(["answer", "--id", question.id, "--value", value, "--out", out], { ...bins, out });
      auto.push(`${question.id}=${value}`);
    }
  }
  const action = nextAction(out, { dashboardUp: dashboardUp(out) });
  const settled = resolvePlan(out);
  return {
    ...result,
    asked: action.ask || null,
    ...(auto.length ? { autoAnswered: auto, assumptions: `${settled.runtime === "webview" ? "WebView" : "Native UXP"}, Spectrum, and a host-matching look were chosen because nobody was there to answer.` } : {}),
    out,
    plan: { host: settled.host || "(ask)", name: settled.name, id: settled.id, framework: settled.framework, runtime: settled.runtime || "(ask)", widgets: settled.widgets || "(ask)", permissions: settled.permissions, folder: settled.kind === "existing" ? settled.project : projectPath(settled) },
    card: planSummary(settled),
    next: action.say,
    ...(action.command ? { command: action.command } : {}),
    neverStop: "A session ends only at done. Keep running `session next` and do what it says until it says finished."
  };
}

/** The plan card shows the plan as it stands now, after a host answer or a tweak. */
function refreshPlanCard(out) {
  const file = path.join(out, "questions.json");
  let questions = [];
  try {
    questions = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return;
  }
  const plan = resolvePlan(out);
  const card = questions.find((item) => item.id === "plan");
  if (!card) return;
  card.prompt = planSummary(plan);
  fs.writeFileSync(file, `${JSON.stringify(questions, null, 2)}\n`);
}

function find(args) {
  const words = args._.join(" ").trim();
  if (!words) throw new Error("Pass the words to look for, for example: find import files into project.");
  let dir = "";
  const asked = typeof args.host === "string" ? hostKey(args.host) : "";
  let host = asked;
  try {
    const out = outFor(args);
    const planned = resolvePlan(out).host;
    if (!asked || asked === planned) {
      host = planned;
      dir = docsDir(out);
    }
  } catch {
    // No session. The saved copy for the app is searched.
  }
  if (!dir || !fs.existsSync(path.join(dir, "library.json"))) {
    dir = host ? path.join(homeDir(), "library", host) : "";
  }
  if (!dir || !fs.existsSync(dir)) {
    return { ok: false, error: "No saved docs. Run: node scripts/skill.mjs docs", next: "Run the docs command first." };
  }
  const found = findInLibrary(dir, words, { limit: Number(args.limit) || 8, lines: 3 });
  return {
    ok: true,
    query: words,
    terms: found.terms,
    results: found.results.map((item) => ({ file: path.join(dir, item.file), score: item.score, lines: item.lines })),
    next: found.results.length ? "Open the best files and read them before you write the call." : "Nothing matched. Try other words (the class or the verb), or open INDEX.md in the docs folder."
  };
}

function slug(text) {
  return String(text).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32) || "session";
}

function assumedAnswer(question, goal, plan) {
  if (question.id === "plan") return "build";
  if (question.id === "runtime") return "native";
  if (question.id === "widgets") return "spectrum";
  if (question.id === "design") return "match";
  if (question.id === "name") return plan.name && plan.name !== "UXP Plugin" ? plan.name : "Plugin";
  if (question.input === "text") return String(goal || "").trim() || "UXP Plugin";
  return question.options?.[0]?.id || "";
}

function stamp() {
  return new Date().toISOString().replace(/[-:T]/g, "").slice(4, 12);
}

function installInto(dest) {
  if (!dest || dest === true) throw new Error("Pass --into <folder>.");
  const skillDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
  const into = path.resolve(dest);
  const skillDest = path.join(into, ".agents", "skills", "uxp-assistant");
  fs.cpSync(skillDir, skillDest, {
    recursive: true,
    filter: (source) => !source.split(path.sep).includes("node_modules")
  });
  return {
    ok: true,
    skill: skillDest,
    next: `From ${skillDest}, run node scripts/skill.mjs start --goal "<the request>" --empty <folder>.`
  };
}

function parse(argv) {
  const parsed = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) {
      parsed._.push(token);
      continue;
    }
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
