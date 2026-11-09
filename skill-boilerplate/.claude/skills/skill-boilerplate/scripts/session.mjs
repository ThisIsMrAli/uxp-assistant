#!/usr/bin/env node
/**
 * Session commands print one JSON object and a next line.
 *
 *   mode --set dashboard|chat
 *   step --id <id> --status running|waiting|done|skipped [--doing "..."] [--progress 3/12]
 *   ask  --id <id>
 *   wait --id <id> [--timeout 25]
 *   answer --id <id> --value <option id>
 *   next
 *   done [--summary "..."]
 *   show
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { nextAction, reminder } from "./lib/next.mjs";
import { resolveOut, sessionBin } from "./lib/paths.mjs";
import {
  answerFromChat, finish, noteDelivered, parseProgress, publishAsk, readMerged, readServer, readSession, setMode, setStep
} from "./lib/session.mjs";

const ranDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

export async function sessionCommand(argv, envOut) {
  const [command, ...rest] = argv;
  const args = parseArgs(rest);
  if (envOut) process.env.SKILL_OUT = envOut;
  const out = resolveOut(args.out);
  if (!readSession(out)) throw new Error(`No session in ${out}. Run start.mjs first.`);
  if (command === "mode") {
    if (!["dashboard", "chat"].includes(args.set)) throw new Error("Use --set dashboard or --set chat.");
    setMode(out, args.set);
    return { ok: true, mode: args.set };
  }
  if (command === "step") {
    if (!args.id || !args.status) throw new Error("Use --id and --status.");
    const session = setStep(out, args.id, args.status, args.detail, { doing: args.doing, progress: args.progress ? parseProgress(args.progress) : undefined });
    return { ok: true, step: session.steps.find((step) => step.id === args.id) };
  }
  if (command === "ask") return ask(out, args);
  if (command === "wait") return wait(out, args);
  if (command === "answer") {
    if (!args.id || args.value == null) throw new Error("Use --id and --value.");
    ensureAsk(out, args);
    const option = answerFromChat(out, args.id, args.value);
    return { ok: true, id: args.id, value: option.id, label: option.label, via: "chat" };
  }
  if (command === "done") {
    finish(out, args.summary);
    return { ok: true, next: "The session is finished. Stop the dashboard if it is still up." };
  }
  if (command === "next") {
    const action = nextAction(out, { dashboardUp: dashboardUp(out) });
    return { ok: true, ...action, neverStop: action.action === "finished" ? undefined : "A session ends at done. Do not end your turn before then. Do not write to the user between ask and wait." };
  }
  if (command === "show") {
    const merged = readMerged(out);
    return {
      ok: true,
      out,
      mode: merged.mode,
      steps: merged.steps.map((step) => `${step.id}:${step.status}`),
      pending: merged.asks.filter((item) => item.status === "pending").map((item) => item.id),
      answered: merged.asks.filter((item) => item.status === "answered").map((item) => `${item.id}=${item.answer}`)
    };
  }
  throw new Error("Use mode, step, ask, wait, answer, next, done, or show.");
}

function ask(out, args) {
  if (!args.id) throw new Error("Use --id.");
  const definition = definitionFor(out, args);
  publishAsk(out, definition);
  const session = readSession(out);
  const channel = session.mode === "dashboard" && dashboardUp(out) ? "dashboard" : "chat";
  if (channel === "dashboard") {
    return { ok: true, id: args.id, channel, next: `The question is on the dashboard. Do not write to the user. Run \`${sessionBin()} wait --id ${args.id}\` now, and run it again while status is pending.` };
  }
  const fallback = session.mode === "dashboard";
  return {
    ok: true,
    id: args.id,
    channel,
    fallback: fallback ? "server-down" : undefined,
    next: fallback
      ? "The dashboard is not running. This is the chat fallback. Ask this with AskQuestion, then record it with the answer command."
      : `Call AskQuestion with this question, then record the click: ${sessionBin()} answer --id ${args.id} --value <option id>`
  };
}

async function wait(out, args) {
  if (!args.id) throw new Error("Use --id.");
  const seconds = Math.min(Math.max(Number(args.timeout) || 25, 1), 110);
  const session = readSession(out);
  const info = readServer(out);
  if (session.mode === "dashboard") {
    if (!info) return { status: "server-down", id: args.id, next: "The dashboard is down. Ask this in chat with AskQuestion, then record it with the answer command." };
    try {
      const res = await fetch(`http://127.0.0.1:${info.port}/api/wait?id=${encodeURIComponent(args.id)}&timeout=${seconds}`, {
        headers: { authorization: `Bearer ${info.token}` },
        signal: AbortSignal.timeout((seconds + 8) * 1000)
      });
      const body = await res.json();
      if (body.status === "pending") body.next = "Not answered yet. Run the same wait command again right now. Do not write to the user.";
      if (body.status === "answered") noteDelivered(out, args.id, body.label, body.via);
      return body;
    } catch {
      return { status: "server-down", id: args.id, next: "The dashboard is down. Ask this in chat with AskQuestion, then record it with the answer command." };
    }
  }
  const end = Date.now() + seconds * 1000;
  for (;;) {
    const item = readMerged(out)?.asks.find((ask) => ask.id === args.id);
    if (!item) return { status: "missing", id: args.id };
    if (item.status === "answered") {
      noteDelivered(out, args.id, item.answerLabel, item.via);
      return { status: "answered", id: args.id, value: item.answer, label: item.answerLabel, via: item.via };
    }
    if (Date.now() > end) return { status: "pending", id: args.id, next: "Not answered yet. Run the same wait command again right now. Do not write to the user." };
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

function ensureAsk(out, args) {
  if (readSession(out).asks.some((item) => item.id === args.id)) return;
  publishAsk(out, definitionFor(out, args));
}

function definitionFor(out, args) {
  if (args.prompt) {
    const options = args.option || [];
    if (options.length < 2 && args.input !== "text") throw new Error("A custom question needs at least two --option values.");
    return {
      id: args.id,
      title: args.title || args.id,
      prompt: args.prompt,
      input: args.input || "",
      options: options.map((raw) => {
        const [optionId, label, ...detail] = raw.split(":");
        return { id: optionId, label: label || optionId, detail: detail.join(":") };
      })
    };
  }
  const found = readQuestions(out).find((item) => item.id === args.id);
  if (!found) throw new Error(`No question named ${args.id}.`);
  return found;
}

function readQuestions(out) {
  try {
    return JSON.parse(fs.readFileSync(path.join(out, "questions.json"), "utf8"));
  } catch {
    return [];
  }
}

function dashboardUp(out) {
  const info = readServer(out);
  if (!info) return false;
  try {
    process.kill(info.pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

function parseArgs(argv) {
  const parsed = { option: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const value = argv[i + 1];
    if (key === "option") {
      parsed.option.push(value);
      i += 1;
    } else if (value === undefined || value.startsWith("--")) parsed[key] = true;
    else {
      parsed[key] = value;
      i += 1;
    }
  }
  return parsed;
}

if (ranDirectly) {
  try {
    const [command, ...rest] = process.argv.slice(2);
    const result = await sessionCommand([command, ...rest]);
    const out = resolveOut(parseArgs(rest).out);
    const shown = result.next ? result : { ...result, next: result.status === "pending" || result.status === "server-down" ? result.next : reminder(out, { dashboardUp: dashboardUp(out) }) };
    process.stdout.write(`${JSON.stringify(shown)}\n`);
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ ok: false, error: error.message })}\n`);
    process.exitCode = 1;
  }
}
