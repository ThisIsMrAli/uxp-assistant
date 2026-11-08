#!/usr/bin/env node
/**
 * Session commands print one JSON object.
 * This CLI does not print secret values.
 *
 *   mode --set dashboard|chat
 *   step --id docs --status done
 *   ask  --id consequential
 *   wait --id consequential
 *   answer --id consequential --value proceed
 *   next
 *   done --summary "..."
 *   show
 */
import { consequentialAsk, frameworkAsk, hostAsk, keepAsk, modeAsk, narrowAsk, planAll } from "./lib/ask.mjs";
import { nextAction, reminder } from "./lib/next.mjs";
import { resolveOut } from "./lib/paths.mjs";
import {
  answerFromChat, finish, noteDelivered, parseProgress, publishAsk, readMerged, readServer, readSession, setMode, setStep
} from "./lib/session.mjs";

const [command, ...rest] = process.argv.slice(2);
const args = parseArgs(rest);
const QUESTIONS = Object.fromEntries(planAll({
  permissionsBroad: true,
  behaviors: ["cep-listener", "native-addon", "host-system-call"]
}).map((question) => [question.id, question]));

try {
  const out = resolveOut(args.out);
  if (!command || command === "help") usage();
  if (!readSession(out)) throw new Error(`No session in ${out}. Run assist.mjs first.`);
  await run(out);
} catch (error) {
  process.stdout.write(`${JSON.stringify({ ok: false, error: error.message })}\n`);
  process.exit(1);
}

async function run(out) {
  switch (command) {
    case "mode": {
      if (!["dashboard", "chat"].includes(args.set)) throw new Error("Use --set dashboard or --set chat.");
      setMode(out, args.set);
      return print({ ok: true, mode: args.set });
    }
    case "step": {
      if (!args.id || !args.status) throw new Error("Use --id and --status.");
      const session = setStep(out, args.id, args.status, args.detail, { doing: args.doing, progress: parseProgress(args.progress) });
      return print({ ok: true, step: session.steps.find((step) => step.id === args.id) });
    }
    case "ask": {
      if (!args.id || !QUESTIONS[args.id]) throw new Error(`Unknown question ${args.id || ""}.`);
      publishAsk(out, QUESTIONS[args.id]);
      const channel = readSession(out).mode === "dashboard" && dashboardUp(out) ? "dashboard" : "chat";
      return print({
        ok: true,
        id: args.id,
        channel,
        next: channel === "dashboard"
          ? `Run \`node scripts/session.mjs wait --id ${args.id}\`.`
          : `Call AskQuestion, then \`node scripts/session.mjs answer --id ${args.id} --value <option id>\`.`
      });
    }
    case "wait": return wait(out);
    case "answer": {
      if (!args.id || !args.value) throw new Error("Use --id and --value.");
      if (!readSession(out).asks.some((ask) => ask.id === args.id)) publishAsk(out, QUESTIONS[args.id]);
      const option = answerFromChat(out, args.id, args.value);
      return print({ ok: true, id: args.id, value: option.id, label: option.label, via: "chat" });
    }
    case "done": {
      finish(out, args.summary);
      return print({ ok: true, success: true, state: "commands-finished", hostExecuted: false, say: "Commands finished. The Adobe host was NOT TESTED." });
    }
    case "next": {
      const action = nextAction(out, { dashboardUp: dashboardUp(out) });
      return print({ ...action, ok: action.success === true, neverStop: reminder(action) || undefined });
    }
    case "show": {
      const merged = readMerged(out);
      const finished = merged.outcome === "commands-finished" && merged.steps.find((step) => step.id === "done")?.status === "done" && merged.verification?.hostExecuted !== true;
      return print({
        ok: finished,
        success: finished,
        state: merged.outcome,
        out,
        mode: merged.mode,
        hostExecuted: false,
        goal: merged.contract?.goal || merged.intake?.goal || "",
        steps: merged.steps.map((step) => `${step.id}:${step.status}`),
        pending: merged.asks.filter((item) => item.status === "pending").map((item) => item.id),
        answered: merged.asks.filter((item) => item.status === "answered").map((item) => `${item.id}=${item.answer}`)
      });
    }
    default:
      usage();
  }
}

async function wait(out) {
  if (!args.id) throw new Error("Use --id.");
  const seconds = Math.min(Math.max(Number(args.timeout) || 25, 1), 110);
  const info = readServer(out);
  if (!info) throw new Error("The dashboard is not running.");
  const url = `http://127.0.0.1:${info.port}/api/wait?id=${encodeURIComponent(args.id)}&timeout=${seconds}`;
  const response = await fetch(url, { headers: { authorization: `Bearer ${info.token}` } });
  const body = await response.json();
  if (body.status === "answered") noteDelivered(out, args.id, body.label, body.via);
  if (JSON.stringify(body).match(/secret"\s*:/)) delete body.secret;
  return print({ ok: true, ...body });
}

function dashboardUp(out) {
  const info = readServer(out);
  return Boolean(info?.port);
}

function print(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
  if (value && Object.prototype.hasOwnProperty.call(value, "success") && value.success !== true) process.exitCode = 2;
}

function usage() {
  throw new Error("Use mode, step, ask, wait, answer, next, done, or show.");
}

function parseArgs(argv) {
  const args = { image: [] };
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

void modeAsk;
void frameworkAsk;
void hostAsk;
void consequentialAsk;
void narrowAsk;
void keepAsk;
