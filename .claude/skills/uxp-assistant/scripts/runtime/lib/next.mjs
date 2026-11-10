import fs from "node:fs";
import path from "node:path";
import { modeAsk } from "./ask.mjs";
import { readMerged } from "./session.mjs";
import { dashboardBin, sessionBin } from "./paths.mjs";

const OPEN = new Set(["pending", "running", "waiting"]);

function quote(value) {
  const text = String(value);
  return /[\s"]/.test(text) ? `"${text.replaceAll("\\", "\\\\").replaceAll("\"", "\\\"")}"` : text;
}

function answerOf(session, id) {
  const ask = session.asks.find((item) => item.id === id && item.status === "answered");
  return ask ? ask.answer : undefined;
}

/** A question with `when: { plan: "change" }` is asked only after that answer. */
export function whenMet(when, session) {
  if (!when) return true;
  return Object.entries(when).every(([id, wanted]) => {
    const got = answerOf(session, id);
    return Array.isArray(wanted) ? wanted.includes(got) : got === wanted;
  });
}

function fill(text, session, out) {
  const project = session.addon?.path || "";
  const check = `${session.steps.find((item) => item.id === "check")?.command || ""} --out ${quote(out)}`.trim();
  return String(text || "").replaceAll("{out}", quote(out)).replaceAll("{project}", project).replaceAll("{check}", check);
}

/**
 * The next command, from the session alone.
 * Order: mode, dashboard, pending question, unanswered question, then each step with its own command.
 * A step names its command in the extension. The session adds --out so the line works from any folder.
 */
export function nextAction(out, { dashboardUp = false } = {}) {
  const session = readMerged(out);
  if (!session) return { action: "start", say: "No session yet. Run start first." };
  const dashboard = session.mode === "dashboard" && dashboardUp;
  const sessionCmd = sessionBin();
  const dashCmd = dashboardBin();
  const outArg = `--out ${quote(out)}`;

  if (session.steps.find((item) => item.id === "done")?.status === "done") {
    return { action: "finished", say: session.mode === "dashboard" ? `The session is finished. Run \`${dashCmd} stop ${outArg}\` if the dashboard is still up, then give the user your closing summary.` : "The session is finished. Give the user your closing summary." };
  }
  if (!session.mode) {
    const mode = modeAsk();
    const choices = mode.options.map((option) => `"${option.label}" (${option.id}: ${option.detail})`).join(" or ");
    return {
      action: "ask-mode",
      command: `${sessionCmd} mode --set dashboard|chat ${outArg}`,
      say: `Call AskQuestion with the prompt "${mode.prompt}" and the options ${choices}. Then run \`${sessionCmd} mode --set <dashboard|chat> ${outArg}\`. If you cannot open a browser on the developer's computer (cloud agent, SSH), or the developer already said no dashboard, skip the question and run \`${sessionCmd} mode --set chat ${outArg}\`.`
    };
  }
  if (session.mode === "dashboard" && !dashboardUp) {
    return { action: "start-dashboard", command: `${dashCmd} start ${outArg}`, say: `The dashboard is not running. Run \`${dashCmd} start ${outArg}\`. Its output has the link for the developer. Then run \`${sessionCmd} next ${outArg}\` and do what it says. Do not write to the user. If start fails, run \`${sessionCmd} mode --set chat ${outArg}\` and continue in chat.` };
  }

  const pending = session.asks.find((ask) => ask.status === "pending");
  if (pending) {
    return dashboard
      ? { action: "wait", ask: pending.id, command: `${sessionCmd} wait --id ${pending.id} ${outArg}`, say: `The question "${pending.title || pending.id}" is on the dashboard. Do not write to the user. Run \`${sessionCmd} wait --id ${pending.id} ${outArg}\` now, and again while status is pending.` }
      : { action: "ask-in-chat", ask: pending.id, command: `${sessionCmd} answer --id ${pending.id} --value <option id> ${outArg}`, say: `"${pending.title || pending.id}" is waiting. Run \`${sessionCmd} ask --id ${pending.id} ${outArg}\` to read it, ask it with AskQuestion (or in chat for a text question), then record the answer with \`${sessionCmd} answer --id ${pending.id} --value <option id or their words> ${outArg}\`. Only when no person is there to answer (a background or cloud run) record the first option yourself.` };
  }

  for (const question of readQuestions(out)) {
    if (question.id === "mode" || !whenMet(question.when, session)) continue;
    const asked = session.asks.find((item) => item.id === question.id);
    if (!asked) {
      return { action: "ask", ask: question.id, command: `${sessionCmd} ask --id ${question.id} ${outArg}`, say: dashboard
        ? `Publish \`${question.id}\` on the dashboard with \`${sessionCmd} ask --id ${question.id} ${outArg}\`, then wait. Do not ask it in chat. Do not answer it yourself, and do not pick a recommended option.`
        : `Run \`${sessionCmd} ask --id ${question.id} ${outArg}\`, ask it with AskQuestion (pass the prompt and each option through unchanged), then record the click with \`${sessionCmd} answer --id ${question.id} --value <option id> ${outArg}\`. Only when no person is there to answer (a background or cloud run) record the first option yourself.` };
    }
  }

  // An answer that opens another round (a bug report) comes before any step: the agent works on it, then asks again.
  const again = session.asks.find((ask) => ask.status === "answered" && ask.options.find((option) => option.id === ask.answer)?.repeat);
  if (again) {
    const check = session.steps.find((item) => item.id === "check");
    const answeredAt = again.answeredAt ? Date.parse(again.answeredAt) : 0;
    const checkEnded = check?.endedAt ? Date.parse(check.endedAt) : 0;
    // After they fix and re-run check, do not reprint "read the screenshots". Say mark notes, then feedback.
    if (check?.status === "done" && answeredAt && checkEnded > answeredAt) {
      const nextFeedback = `node scripts/skill.mjs feedback --changed "<one line: what you changed>" ${outArg}`;
      return {
        action: "fix-and-ask",
        ask: again.id,
        step: "try",
        command: nextFeedback,
        say: `The report is already read. Mark each fixed note (\`${sessionCmd} note --id <id> --status fixed ${outArg}\`), then run \`${nextFeedback}\`. Do not re-read the screenshots; do not ask the developer in chat.`
      };
    }
    const option = again.options.find((item) => item.id === again.answer);
    const words = again.answerText ? ` Their words: "${again.answerText}".` : "";
    const shots = (again.answerImages || []).map((file) => path.join(out, file));
    const seen = shots.length ? ` Screenshots to read: ${shots.join(", ")}.` : "";
    return { action: "apply", ask: again.id, say: `${option.then || "Work on what they sent, then ask again."}${words}${seen}` };
  }

  const ended = session.asks.find((ask) => ask.status === "answered" && ask.options.find((option) => option.id === ask.answer)?.ends);
  if (ended) {
    const summary = `Stopped by the user at the ${String(ended.title || ended.id).toLowerCase()} question. Nothing was built.`;
    return { action: "stop", command: `${sessionCmd} done --stopped --summary "${summary}" ${outArg}`, say: `The user chose to stop. Run \`${sessionCmd} done --stopped --summary "${summary}" ${outArg}\` and tell them in one line.` };
  }

  const askBound = new Set(Object.values(session.askSteps || {}));
  const work = session.steps.find((item) => item.id !== "done" && item.id !== "prepare" && OPEN.has(item.status) && (item.command || item.say || !askBound.has(item.id)));
  if (work) {
    const command = work.command ? `${fill(work.command, session, out)} ${outArg}`.trim() : "";
    const say = work.say ? fill(work.say, session, out) : `Work on the "${work.label}" step, then run \`${sessionCmd} next ${outArg}\`.`;
    return { action: work.id, step: work.id, ...(command ? { command } : {}), say: command && !say.includes(command) ? `${say} Command: \`${command}\`` : say };
  }
  const summary = "Describe what was built, where it is, and how to load it.";
  return { action: "finish", command: `${sessionCmd} done --summary "<${summary}>" ${outArg}`, say: `Everything is done. Run \`${sessionCmd} done --summary "<${summary}>" ${outArg}\`${session.mode === "dashboard" ? ", then stop the dashboard" : ""}, then give the user your closing summary.` };
}

export function reminder(out, options) {
  const next = nextAction(out, options);
  if (next.action === "finished") return "The session is finished.";
  return `Not finished. Next: ${next.say} Do not end your turn until \`${sessionBin()} next\` says finished.`;
}

function readQuestions(out) {
  try {
    return JSON.parse(fs.readFileSync(path.join(out, "questions.json"), "utf8"));
  } catch {
    return [];
  }
}
