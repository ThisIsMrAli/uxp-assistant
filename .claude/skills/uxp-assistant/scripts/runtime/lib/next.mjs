import fs from "node:fs";
import path from "node:path";
import { readMerged } from "./session.mjs";
import { dashboardBin, refreshBin, sessionBin } from "./paths.mjs";

const OPEN = new Set(["pending", "running", "waiting"]);
const HANDS_OFF = new Set(["tests", "test", "package", "host", "host-verification"]);

function quote(value) {
  const text = String(value);
  return /[\s"]/.test(text) ? `"${text.replaceAll("\\", "\\\\").replaceAll("\"", "\\\"")}"` : text;
}

/**
 * The next command, from the session alone.
 * Mode comes first. In dashboard mode the dashboard starts before docs are fetched.
 * A pending question is waited on. AskQuestion is named only in chat mode.
 */
export function nextAction(out, { dashboardUp = false } = {}) {
  const session = readMerged(out);
  if (!session) return { action: "start", say: `No session yet. Run start.mjs first.` };
  const step = (id) => session.steps.find((item) => item.id === id);
  const dashboard = session.mode === "dashboard" && dashboardUp;
  const sessionCmd = sessionBin();
  const dashCmd = dashboardBin();
  const refreshCmd = refreshBin();

  if (step("done")?.status === "done") {
    return { action: "finished", say: `The session is finished. Run \`${dashCmd} stop\` if the dashboard is still up.` };
  }
  const outArg = `--out ${quote(out)}`;
  if (!session.mode) {
    return { action: "ask-mode", command: `${sessionCmd} mode --set dashboard|chat ${outArg}`, say: `Ask the mode question with AskQuestion, then \`${sessionCmd} mode --set dashboard|chat ${outArg}\`. Do not fetch docs.` };
  }
  if (session.mode === "dashboard" && !dashboardUp) {
    return { action: "start-dashboard", command: `${dashCmd} start ${outArg}`, say: `The dashboard is not running. Start it before any docs fetch. If it fails, \`${sessionCmd} mode --set chat ${outArg}\` and continue in chat.` };
  }

  const pending = session.asks.find((ask) => ask.status === "pending");
  if (pending) {
    return dashboard
      ? { action: "wait", ask: pending.id, command: `${sessionCmd} wait --id ${pending.id} ${outArg}`, say: `The question "${pending.title || pending.id}" is on the dashboard. Do not write to the user. Run \`${sessionCmd} wait --id ${pending.id} ${outArg}\` now, and run it again while status is pending.` }
      : { action: "ask-in-chat", ask: pending.id, command: `${sessionCmd} answer --id ${pending.id} --value <option id> ${outArg}`, say: `Ask "${pending.title || pending.id}" with AskQuestion, then record the click with \`${sessionCmd} answer --id ${pending.id} --value <option id> ${outArg}\`.` };
  }

  const questions = readQuestions(out);
  for (const question of questions) {
    if (question.id === "mode") continue;
    const asked = session.asks.find((item) => item.id === question.id);
    if (!asked) {
      return { action: "ask", ask: question.id, command: `${sessionCmd} ask --id ${question.id} ${outArg}`, say: dashboard
        ? `Publish \`${question.id}\` on the dashboard, then wait. Do not ask it in chat. Command: \`${sessionCmd} ask --id ${question.id} ${outArg}\`.`
        : `Ask \`${question.id}\` with AskQuestion, then record the answer with \`${sessionCmd} answer --id ${question.id} --value <option id> ${outArg}\`.` };
    }
  }

  const docs = step("docs");
  if (docs && OPEN.has(docs.status)) {
    return { action: "refresh", command: `${refreshCmd} --out ${quote(out)}`, say: `Fetch the skill's sources now with \`${refreshCmd} --out ${quote(out)}\`. The dashboard is already up when this session is in dashboard mode. Report each page as fresh, stale, or failed. The docs step finishes as done with those counts.` };
  }

  const work = session.steps.find((item) => item.id !== "done" && item.id !== "prepare" && item.id !== "docs" && OPEN.has(item.status));
  if (work) {
    if (HANDS_OFF.has(work.id)) {
      return { action: "run", step: work.id, say: `Run the real command for \`${work.id}\` and record its exit. Do not mark it done from this line. The host is not launched.` };
    }
    return { action: "apply", step: work.id, say: `Apply the answers for \`${work.id}\`. Do not mark tests, package, or the host done unless those commands ran.` };
  }
  const summary = "Session finished. The host was NOT TESTED.";
  return { action: "finish", command: `${sessionCmd} done --summary "${summary}" ${outArg}`, say: `Everything asked so far is answered. Run \`${sessionCmd} done --summary "${summary}" ${outArg}\`, then stop the dashboard. Do not mark tests, package, or the host done unless those commands ran.` };
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
