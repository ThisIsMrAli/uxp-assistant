#!/usr/bin/env node
/**
 * Session commands print one JSON object and a next line.
 *
 *   mode --set dashboard|chat
 *   step --id <id> --status running|waiting|done|skipped [--doing "..."] [--progress 3/12]
 *   ask  --id <id>
 *   wait --id <id> [--timeout 90]
 *   answer --id <id> --value <option id> [--text "<their words>"] [--image <file>]...
 *   note --text "<what is wrong>" [--id <id>] [--screen "<where>"] [--shot <image>] | --id <id> --status open|fixed|skipped
 *   next
 *   done [--summary "..."]
 *   show
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { loopbackJson } from "./lib/loopback.mjs";
import { nextAction, reminder } from "./lib/next.mjs";
import { dashboardBin, resolveOut, sessionBin } from "./lib/paths.mjs";
import {
  addNote, addShot, answerFromChat, dashboardUp, finish, noteDelivered, noteFeedback, parseProgress, publishAsk, readMerged, readServer, readSession, setMode, setNoteStatus, setStep
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
    return { ok: true, mode: args.set, next: nextAction(out, { dashboardUp: dashboardUp(out) }).say };
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
    const option = answerFromChat(out, args.id, args.value, { text: typeof args.text === "string" ? args.text : "", images: args.image || [] });
    const noted = noteFeedback(out, args.id);
    if (readSession(out).asks.find((item) => item.id === args.id)?.attach && !option.repeat) settleReports(out);
    return { ok: true, id: args.id, value: option.id, label: option.label, via: "chat", ...(noted ? { note: noted } : {}), ...(option.then ? { next: option.then } : {}) };
  }
  if (command === "note") return note(out, args);
  if (command === "done") {
    finish(out, args.summary, { stopped: Boolean(args.stopped) });
    return { ok: true, next: "The session is finished. Stop the dashboard if it is still up." };
  }
  if (command === "next") {
    const action = nextAction(out, { dashboardUp: dashboardUp(out) });
    return { ok: true, ...action, next: action.say, neverStop: action.action === "finished" ? undefined : "A session ends at done. Do not end your turn before then. Do not write to the user between ask and wait." };
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

function note(out, args) {
  if (args.status && args.id && !args.text) {
    setNoteStatus(out, args.id, args.status);
    return { ok: true, id: args.id, status: args.status };
  }
  if (!args.text || args.text === true) throw new Error("Use --text with what is wrong, or --id with --status.");
  let shot = "";
  if (typeof args.shot === "string") shot = addShot(out, { file: args.shot, label: args.screen || "Note", kind: "note" }).shot.file;
  addNote(out, { text: args.text, id: typeof args.id === "string" ? args.id : undefined, screen: typeof args.screen === "string" ? args.screen : "", shot, severity: "error" });
  const added = readSession(out).notes.at(-1);
  if (args.status) setNoteStatus(out, added.id, args.status);
  return { ok: true, id: added.id, status: args.status || "open" };
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
  const question = {
    title: definition.title || definition.id,
    prompt: definition.prompt,
    ...(definition.input === "text" ? { input: "text" } : { options: (definition.options || []).map((option) => ({ id: option.id, label: option.label, detail: option.detail || "" })) })
  };
  return {
    ok: true,
    id: args.id,
    channel,
    question,
    fallback: fallback ? "server-down" : undefined,
    next: fallback
      ? `The dashboard is not running. Run \`${dashboardBin()} start --out ${out}\` once, then ask this question again. AskQuestion is the fallback only after that start fails.`
      : definition.input === "text"
        ? `Ask the developer this question in chat, then record their words: ${sessionBin()} answer --id ${args.id} --value "<their words>" --out ${out}`
        : definition.attach
          ? `Call AskQuestion with question.prompt and one option per question.options entry (same labels). If they choose "${(definition.options || []).find((option) => option.repeat)?.id || "bugs"}", ask them in chat what is wrong and to paste a screenshot, and wait for that reply: it is their input, so this is the one place you end your turn. You cannot copy a pasted image, so write what each screenshot shows into the text. Record it: ${sessionBin()} answer --id ${args.id} --value ${(definition.options || []).find((option) => option.repeat)?.id || "bugs"} --text "<their words and what each screenshot shows>" --out ${out}. If they choose the other option: ${sessionBin()} answer --id ${args.id} --value ${(definition.options || []).find((option) => !option.repeat)?.id || "good"} --out ${out}`
        : `Call AskQuestion with question.prompt and one option per question.options entry (same labels), then record the click: ${sessionBin()} answer --id ${args.id} --value <option id> --out ${out}`
  };
}

async function wait(out, args) {
  if (!args.id) throw new Error("Use --id.");
  const session = readSession(out);
  // A person at the dashboard often needs more than 25s. Default to 90 there; still re-run if pending.
  const seconds = Math.min(Math.max(Number(args.timeout) || (session.mode === "dashboard" ? 90 : 25), 1), 110);
  const info = readServer(out);
  if (session.mode === "dashboard") {
    if (!info) return { status: "server-down", id: args.id, next: `The dashboard is down. Run \`${dashboardBin()} start --out ${out}\` once, then run the same wait command again.` };
    try {
      const res = await loopbackJson(`http://127.0.0.1:${info.port}/api/wait?id=${encodeURIComponent(args.id)}&timeout=${seconds}`, {
        headers: { authorization: `Bearer ${info.token}` },
        timeoutMs: (seconds + 8) * 1000
      });
      const body = res.body;
      if (body.status === "pending") body.next = "Not answered yet. Run the same wait command again right now. Do not write to the user.";
      if (body.status === "answered") return delivered(out, args.id, body);
      return body;
    } catch {
      return { status: "server-down", id: args.id, next: `The dashboard is down. Run \`${dashboardBin()} start --out ${out}\` once, then run the same wait command again.` };
    }
  }
  const end = Date.now() + seconds * 1000;
  for (;;) {
    const item = readMerged(out)?.asks.find((ask) => ask.id === args.id);
    if (!item) return { status: "missing", id: args.id };
    if (item.status === "answered") {
      return delivered(out, args.id, { status: "answered", id: args.id, value: item.answer, label: item.answerLabel, via: item.via, ...(item.answerText ? { text: item.answerText } : {}), ...(item.answerImages?.length ? { images: item.answerImages } : {}) });
    }
    if (Date.now() > end) return { status: "pending", id: args.id, next: "Not answered yet. Run the same wait command again right now. Do not write to the user." };
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

/** "No more bugs" is the developer's word that every report is settled, so the notes say who closed them. */
function settleReports(out) {
  for (const note of readSession(out).notes.filter((item) => /^fb\d/.test(item.id) && (item.status === "open" || item.fixedBy === "agent"))) setNoteStatus(out, note.id, "fixed", "developer");
}

/** The agent has the answer. Close the waiting state, file a report as a note, and say what to do with it. */
function delivered(out, id, body) {
  noteDelivered(out, id, body.label, body.via);
  const noted = noteFeedback(out, id);
  const ask = readSession(out)?.asks.find((item) => item.id === id);
  const option = ask?.options.find((item) => item.id === body.value);
  if (ask?.attach && option && !option.repeat) settleReports(out);
  return {
    ...body,
    ...(body.images ? { images: body.images.map((file) => path.join(out, file)) } : {}),
    ...(noted ? { note: noted } : {}),
    ...(option?.then ? { next: option.then } : {})
  };
}

function ensureAsk(out, args) {
  if (readSession(out).asks.some((item) => item.id === args.id)) return;
  publishAsk(out, definitionFor(out, args));
}

function definitionFor(out, args) {
  // A question the skill built for this moment, such as a round of bug reports. It is not in questions.json.
  if (typeof args.definition === "string") {
    const built = JSON.parse(fs.readFileSync(path.resolve(args.definition), "utf8"));
    if (built.id !== args.id) throw new Error(`That file defines ${built.id}, not ${args.id}.`);
    return built;
  }
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

function parseArgs(argv) {
  const parsed = { option: [], image: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const value = argv[i + 1];
    if (key === "option" || key === "image") {
      parsed[key].push(value);
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
