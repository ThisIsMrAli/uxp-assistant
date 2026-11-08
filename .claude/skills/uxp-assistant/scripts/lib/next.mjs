import { readMerged } from "./session.mjs";

const OPEN = new Set(["pending", "running", "waiting"]);

/**
 * The next command, from the session alone.
 * Waiting for the assistant is not completion.
 * A failed or missing command is not done.
 */
export function nextAction(out, { dashboardUp = false } = {}) {
  const session = readMerged(out);
  if (!session) return { action: "start", success: false, say: "No session yet. Run assist.mjs first." };
  const step = (id) => session.steps.find((item) => item.id === id);
  const dashboard = session.mode === "dashboard" && dashboardUp;
  if (step("done")?.status === "done" && session.outcome === "commands-finished" && session.verification?.hostExecuted === false) {
    return { action: "finished", success: true, hostExecuted: false, say: "Commands finished. The Adobe host was NOT TESTED. Run `node scripts/dashboard.mjs stop` if the dashboard is still up." };
  }
  if (!session.mode) {
    return { action: "ask-mode", success: false, say: "Ask the `mode` question with AskQuestion, then `session.mjs mode --set dashboard|chat`." };
  }
  if (session.mode === "dashboard" && !dashboardUp) {
    return { action: "start-dashboard", success: false, command: "node scripts/dashboard.mjs start", say: "The dashboard is not running. Start it, or `session.mjs mode --set chat`." };
  }
  const pending = session.asks.find((ask) => ask.status === "pending");
  if (pending) {
    return dashboard
      ? { action: "wait", success: false, ask: pending.id, command: `node scripts/session.mjs wait --id ${pending.id}`, say: `The question "${pending.title || pending.id}" is on the dashboard. Do not write the feature while it is pending.` }
      : { action: "ask-in-chat", success: false, ask: pending.id, say: `Ask "${pending.title || pending.id}" with AskQuestion, then record it with \`session.mjs answer --id ${pending.id} --value <option id>\`.` };
  }
  if (session.outcome === "awaiting-agent-implementation") {
    return {
      action: "implement",
      success: false,
      state: session.outcome,
      hostExecuted: false,
      say: `Implement the requested goal in the project, then \`node scripts/assist.mjs record --result agent-result.json\`. Goal: ${session.contract?.goal || ""}`
    };
  }
  if (session.outcome === "unknown") {
    return { action: "unknown", success: false, state: "unknown", hostExecuted: false, say: "The capability is unknown. Do not invent an API, do not swap in the rename fixture, and do not mark the feature done." };
  }
  if (session.outcome === "unsupported-with-evidence") {
    return { action: "unsupported", success: false, state: "unsupported-with-evidence", hostExecuted: false, say: "A fresh page says this is unsupported. Do not implement it and do not report success." };
  }
  if (session.outcome === "not-yet-implemented" || session.outcome === "failed" || session.outcome === "stopped") {
    return { action: "incomplete", success: false, state: session.outcome, hostExecuted: false, say: `The session is ${session.outcome}. Tests and package are not done.` };
  }
  if (session.verification?.hostExecuted) {
    return { action: "stop", success: false, say: "verification.hostExecuted is true. This skill must not claim the Adobe host ran." };
  }
  const open = (id) => OPEN.has(step(id)?.status);
  for (const id of ["intake", "docs", "plan", "scaffold", "implementation", "ui", "tests", "host-verification", "package"]) {
    if (!open(id)) continue;
    return { action: "continue", success: false, step: id, command: "node scripts/assist.mjs continue", say: `The ${id} step is ${step(id)?.status}. Continue it. Do not mark it done by hand.` };
  }
  return { action: "blocked", success: false, say: "The session is not ready to finish." };
}

export function reminder(action) {
  if (!action || action.action === "finished") return "";
  return "A session is finished only after commands-finished. Do not report success before then.";
}
