import fs from "node:fs";
import path from "node:path";
import { hostLabel } from "./intent.mjs";
import { resolvePlan } from "./flow.mjs";
import { sessionBin } from "../runtime/lib/paths.mjs";
import { mutate, readMerged, setStep } from "../runtime/lib/session.mjs";

/**
 * The try loop. Nothing here can open the plugin in the Adobe app, so the developer does.
 * Each round is one card: load it, use it, then send words and screenshots, or say there are no more bugs.
 * A report becomes a note, the assistant fixes it and checks again, and the card comes back until the developer
 * chooses "No more bugs". The developer is the only one who can end the loop.
 */

export const loadFile = (out) => path.join(out, "load.txt");

/** `check` writes the sentence that says how to load the build into this file when it succeeds. */
function loadHelp(out) {
  try {
    return fs.readFileSync(loadFile(out), "utf8").trim();
  } catch {
    return "Open UXP Developer Tool, choose Add Plugin, pick the dist/manifest.json in the project, then Load.";
  }
}

/** The question for the round that is about to start. */
export function feedbackQuestion(out) {
  const session = readMerged(out);
  const plan = resolvePlan(out);
  const label = hostLabel(plan.host);
  const round = (session.asks.find((ask) => ask.id === "feedback")?.round || 0) + 1;
  const next = round + 1;
  const reports = session.notes.filter((note) => /^fb\d/.test(note.id));
  const fixedNotes = reports.filter((note) => note.status === "fixed");
  const stillOpen = reports.filter((note) => note.status === "open");
  const sinceLast = (session.feedbackChanged || "").trim();
  const prompt = round === 1
    ? [
      `The plugin is built and packaged. Nobody has run it in ${label} yet, so you are the first test.`,
      `Load it: ${loadHelp(out)}`,
      "Use it the way a real user would. If anything is wrong (a bug, an error message, wrong text, a layout that looks off, a missing feature), choose the first option, type what you saw, and add screenshots. If everything works, choose the second."
    ].join("\n\n")
    : [
      `Round ${round}.${sinceLast ? ` ${sinceLast}` : ""}`,
      fixedNotes.length ? `Fixed since you last looked: ${fixedNotes.map((note) => brief(note.text)).join("; ")}.` : "",
      stillOpen.length ? `Still open: ${stillOpen.map((note) => brief(note.text)).join("; ")}.` : "",
      `Reload the plugin (UXP Developer Tool: Reload, or install the new .ccx), try the same steps again, then tell me what is still wrong, or that there are no more bugs.`
    ].filter(Boolean).join("\n\n");
  const check = `${session.steps.find((step) => step.id === "check")?.command || "node scripts/skill.mjs check"} --out ${quoted(out)}`;
  const again = `node scripts/skill.mjs feedback --changed "<one line: what you changed, or the question you need answered>" --out ${quoted(out)}`;
  return {
    id: "feedback",
    title: round === 1 ? "Try it in the app" : `Try it again (round ${round})`,
    prompt,
    attach: true,
    round,
    maxLength: 4000,
    options: [
      {
        id: "bugs",
        label: "Something is wrong, or I want a change",
        detail: "Type what you saw and add screenshots of the bug, error, or wrong text. The assistant fixes it, rebuilds, and asks you to try again.",
        repeat: true,
        then: `The developer sent report ${round} (note fb${round}). 1) Read their words and open every screenshot file; you can view images. If the words already name what is wrong and what they expected, that is the fix; only ask a question in --changed when the expected result is missing. 2) If there is more than one problem, add one note each: ${sessionBin()} note --id fb${round}-1 --text "..." --out ${quoted(out)}. 3) Fix the code. Change only what the report names, and do not remove a feature to make a problem go away. 4) Run \`${check}\` until it says ok. 5) Mark each fixed note: ${sessionBin()} note --id <id> --status fixed --out ${quoted(out)}. 6) Run \`${again}\` to ask round ${next}. After step 1 the report is already read: later \`check\` / \`session next\` lines say "mark notes, then feedback", not "read the screenshots again". A request for a new feature or a change is handled the same way. Do not end your turn and do not ask the developer in chat.`
      },
      {
        id: "good",
        label: "No more bugs, finish",
        detail: "Everything I tried works. This ends the session."
      }
    ]
  };
}

/** Publish the round. Returns what to tell the agent, or why not. */
export async function runFeedback(out, { changed = "", skip = false, ask } = {}) {
  const session = readMerged(out);
  const check = session.steps.find((step) => step.id === "check");
  if (skip) {
    setStep(out, "try", "skipped", "Nobody was there to try it", { doing: "" });
    return { ok: true, skipped: true, note: "The try step was skipped. The plugin was built and packaged but not run in the Adobe app." };
  }
  if (!check || check.status !== "done") {
    return { ok: false, error: "The plugin has not passed check yet.", next: "Run the check command and fix what it lists. The try step comes after it is clean." };
  }
  const last = session.asks.find((item) => item.id === "feedback");
  if (last?.status === "pending") return { ok: true, id: "feedback", already: true, next: "The question is already waiting. Run the wait command for it." };
  // The developer said there are no more bugs and the agent never read it (a restart, a lost wait). Do not ask again.
  if (last?.status === "answered" && !last.options.find((item) => item.id === last.answer)?.repeat) {
    setStep(out, "try", "done", "No more bugs, you said");
    return { ok: true, id: "feedback", answered: last.answer, next: "The developer already said there are no more bugs. Run the session next command." };
  }
  mutate(out, (draft) => {
    draft.feedbackChanged = String(changed || "").trim();
  });
  const definition = feedbackQuestion(out);
  const file = path.join(out, "feedback-ask.json");
  fs.writeFileSync(file, `${JSON.stringify(definition, null, 2)}\n`);
  return { ok: true, round: definition.round, ...(await ask(file)) };
}

const brief = (text) => String(text).split("\n")[0].slice(0, 120).replace(/[.\s]+$/, "");

function quoted(value) {
  const text = String(value);
  return /[\s"]/.test(text) ? `"${text.replaceAll("\\", "\\\\").replaceAll("\"", "\\\"")}"` : text;
}
