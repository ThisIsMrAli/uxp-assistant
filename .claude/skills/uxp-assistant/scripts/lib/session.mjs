import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/**
 * session.json is written only by CLI commands.
 * answers.jsonl is written only by the dashboard server.
 * A secret value is never stored in either file.
 */

export const STEPS = [
  { id: "intake", label: "Intake", hint: "Goal, host, framework, OS, context, name, id, and permissions." },
  { id: "docs", label: "Official docs", hint: "Fetch shared UXP pages and the host pages this goal needs." },
  { id: "plan", label: "Plan", hint: "Classify by behavior. A missing shared page is not an unsupported host API." },
  { id: "design", label: "Design", hint: "Choose a design source that is on disk, then apply the retrieved UXP limits." },
  { id: "scaffold", label: "Scaffold", hint: "An empty folder uses create-bolt-uxp. An existing project keeps its files." },
  { id: "implementation", label: "Implementation", hint: "The invoking assistant writes the requested goal in the project. A missing recipe is not success and is not a rename." },
  { id: "ui", label: "UI", hint: "Visible errors, disabled actions, loading, and keyboard." },
  { id: "tests", label: "Tests", hint: "Skill checks and the project build. A build is not a host pass." },
  { id: "host-verification", label: "Host verification", hint: "Manual steps in the Adobe app. This step does not claim the host ran." },
  { id: "package", label: "Package", hint: "Build and CCX when the project has a package script." },
  { id: "done", label: "Wrap up" }
];

const STEP_STATUS = new Set(["pending", "running", "waiting", "done", "skipped", "failed"]);

export const files = {
  session: (out) => path.join(out, "session.json"),
  answers: (out) => path.join(out, "answers.jsonl"),
  server: (out) => path.join(out, "server.json"),
  report: (out) => path.join(out, "report.json"),
  lock: (out) => path.join(out, ".session.lock")
};

export function now() {
  return new Date().toISOString();
}

export function readSession(out) {
  return readJson(files.session(out));
}

export function readReport(out) {
  return readJson(files.report(out));
}

export function readServer(out) {
  return readJson(files.server(out));
}

export function readAnswers(out) {
  let raw = "";
  try {
    raw = fs.readFileSync(files.answers(out), "utf8");
  } catch {
    return [];
  }
  const lines = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      lines.push(JSON.parse(line));
    } catch {
      // A half-written line is skipped. The next read sees it whole.
    }
  }
  return lines;
}

export function appendAnswerLine(out, line) {
  fs.mkdirSync(out, { recursive: true });
  const safe = { ...line };
  delete safe.secret;
  if ("secret" in line) safe.secretHeld = Boolean(line.secret);
  fs.appendFileSync(files.answers(out), `${JSON.stringify(safe)}\n`);
}

export function readMerged(out) {
  const session = readSession(out);
  if (!session) return null;
  const answers = readAnswers(out);
  const asks = (session.asks || []).map((ask) => {
    const answer = answers.find((line) => line.type === "answer" && line.askId === ask.id && line.nonce === ask.nonce);
    if (!answer) return { ...ask, status: "pending" };
    const delivered = answers.find((line) => line.type === "delivered" && line.askId === ask.id && line.nonce === ask.nonce);
    const option = ask.options.find((item) => item.id === answer.value);
    return {
      ...ask,
      status: "answered",
      answer: answer.value,
      answerLabel: option?.label || answer.value,
      via: answer.via,
      answeredAt: answer.at,
      hasSecret: Boolean(answer.secretHeld),
      deliveredAt: delivered?.at || null
    };
  });
  return { ...session, asks };
}

export function mutate(out, change) {
  fs.mkdirSync(out, { recursive: true });
  const release = acquire(files.lock(out));
  try {
    const current = readSession(out) || emptySession();
    const draft = structuredClone(current);
    change(draft);
    draft.rev = (current.rev || 0) + 1;
    draft.updatedAt = now();
    draft.agentSeenAt = draft.updatedAt;
    const target = files.session(out);
    const tmp = `${target}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(draft, null, 2)}\n`);
    fs.renameSync(tmp, target);
    return draft;
  } finally {
    release();
  }
}

export function emptySession() {
  return {
    v: 1,
    rev: 0,
    mode: null,
    startedAt: now(),
    updatedAt: now(),
    addon: {},
    project: {},
    intake: null,
    plan: null,
    docs: null,
    verification: { hostExecuted: false, status: "NOT TESTED" },
    outcome: null,
    contract: null,
    packageResult: null,
    baseline: [],
    steps: STEPS.map((step) => ({
      id: step.id,
      label: step.label,
      hint: step.hint || "",
      status: "pending",
      detail: "",
      doing: "",
      progress: null,
      startedAt: null,
      endedAt: null
    })),
    notes: [],
    asks: [],
    shots: [],
    listing: null,
    audit: null,
    agentSeenAt: null,
    log: [],
    summary: null
  };
}

export function startSession(out, report = {}) {
  return mutate(out, (draft) => {
    const fresh = emptySession();
    Object.assign(draft, fresh);
    draft.addon = {
      name: report.name || report.addon || "UXP plugin",
      path: report.projectPath || "",
      docsSha: report.docsSha || "",
      fetchedAt: report.fetchedAt || ""
    };
    draft.project = {
      kind: report.kind || "empty",
      path: report.projectPath || ""
    };
    log(draft, "intake", "Session started.");
  });
}

export function setMode(out, mode) {
  return mutate(out, (draft) => {
    draft.mode = mode;
    log(draft, "intake", mode === "dashboard" ? "Dashboard mode." : "Chat mode.");
  });
}

const VERIFIED_DONE = new Set(["implementation", "ui", "tests", "package", "host-verification"]);

export function setStep(out, id, status, detail, extra = {}) {
  return mutate(out, (draft) => {
    if (status === "done" && VERIFIED_DONE.has(id) && !extra.verified) {
      throw new Error(`Refusing to mark ${id} done. A skipped, failed, or ungenerated step is not success.`);
    }
    setStepIn(draft, id, status, detail, extra);
    if (extra.log) log(draft, id, extra.log);
    else if (detail) log(draft, id, detail);
  });
}

export function recordFacts(out, patch) {
  return mutate(out, (draft) => {
    for (const key of ["intake", "plan", "docs", "verification", "packageResult", "scaffold", "outcome", "contract", "commandProvenance"]) {
      if (patch[key] !== undefined) draft[key] = patch[key];
    }
    if (patch.addon) draft.addon = { ...draft.addon, ...patch.addon };
    if (patch.log) log(draft, patch.log.step, patch.log.text);
  });
}

export function parseProgress(value) {
  if (value === undefined || value === null || value === "") return undefined;
  const ratio = String(value).match(/^(\d+)\s*\/\s*(\d+)$/);
  if (ratio) return { done: Number(ratio[1]), total: Math.max(Number(ratio[2]), 1) };
  const percent = String(value).match(/^(\d+(?:\.\d+)?)\s*%$/);
  if (percent) return { done: Math.min(Number(percent[1]), 100), total: 100 };
  throw new Error("Progress looks like 3/12 or 40%.");
}

export function publishAsk(out, ask) {
  const nonce = crypto.randomBytes(6).toString("hex");
  const normalized = {
    id: ask.id,
    nonce,
    title: ask.title || "",
    prompt: ask.prompt,
    options: ask.options.map((option) => ({
      id: option.id,
      label: option.label,
      detail: option.detail || "",
      requiresSecret: Boolean(option.requiresSecret)
    })),
    affects: ask.affects || [],
    images: ask.images || [],
    blocks: ask.blocks || [],
    askedAt: now(),
    ...(ask.scope ? { scope: ask.scope, scopeSha: bindScope(ask.scope) } : {})
  };
  const session = mutate(out, (draft) => {
    draft.asks = draft.asks.filter((item) => item.id !== ask.id);
    draft.asks.push(normalized);
    const step = stepForAsk(ask.id, draft);
    if (step) setStepIn(draft, step, "waiting", "Waiting for your answer");
    log(draft, step, `Needs a decision: ${ask.title || ask.id}.`);
  });
  return { session, ask: normalized };
}

export function bindScope(scope) {
  if (!scope) return "";
  return crypto.createHash("sha256").update(JSON.stringify(scope)).digest("hex");
}

export function answerFromChat(out, id, value) {
  const session = readMerged(out);
  const ask = session?.asks.find((item) => item.id === id);
  if (!ask) throw new Error(`No question named ${id}. Publish it with the ask command first.`);
  const option = matchOption(ask, value);
  if (!option) throw new Error(`"${value}" is not one of: ${ask.options.map((item) => item.id).join(", ")}.`);
  if (ask.status === "answered") {
    if (ask.answer === option.id) return option;
    throw new Error(`The ${id} question was already answered ${ask.answer}. That answer is closed. A new question is required before another choice. This answer was not recorded.`);
  }
  appendAnswerLine(out, answerLine(ask, option.id, "chat"));
  mutate(out, (draft) => {
    const step = stepForAsk(id, draft);
    if (step) setStepIn(draft, step, "running", `You chose: ${plainLabel(option.label)}`);
    log(draft, step, `You chose: ${plainLabel(option.label)}.`);
  });
  return option;
}

export function noteDelivered(out, id, label, via) {
  const session = readSession(out);
  if (!session) return;
  const step = stepForAsk(id, session);
  const waiting = step && session.steps.find((item) => item.id === step)?.status === "waiting";
  if (!waiting) return;
  mutate(out, (draft) => {
    setStepIn(draft, step, "running", `You chose: ${plainLabel(label)}`);
    log(draft, step, `You chose: ${plainLabel(label)}${via === "dashboard" ? " on the dashboard" : ""}.`);
  });
}

const plainLabel = (label) => String(label || "").replace(/\s*\(recommended\)\s*$/i, "");

export function matchOption(ask, value) {
  const wanted = String(value || "").trim().toLowerCase();
  return ask.options.find((item) => item.id.toLowerCase() === wanted)
    || ask.options.find((item) => item.label.toLowerCase().replace(/\s*\(recommended\)$/, "") === wanted);
}

export function finish(out, summary) {
  return mutate(out, (draft) => {
    const required = ["implementation", "ui", "tests", "package"];
    const open = required.filter((id) => draft.steps.find((step) => step.id === id)?.status !== "done");
    if (draft.outcome !== "commands-finished" || open.length) {
      throw new Error(`Cannot finish. outcome=${draft.outcome || "none"}. Not done: ${open.join(", ") || "none"}.`);
    }
    if (draft.verification?.hostExecuted) throw new Error("hostExecuted must stay false.");
    draft.summary = summary || null;
    if (draft.verification) draft.verification.hostExecuted = false;
    const stillOpen = draft.steps.filter((step) => step.id !== "done" && (step.status === "running" || step.status === "waiting" || step.status === "failed"));
    if (stillOpen.length) throw new Error(`Cannot finish while ${stillOpen.map((step) => `${step.id}:${step.status}`).join(", ")}.`);
    setStepIn(draft, "done", "done", "Commands finished. The Adobe host was NOT TESTED.");
    log(draft, "done", "Session finished.");
  });
}

const ASK_STEP = {
  mode: "intake",
  framework: "intake",
  host: "intake",
  consequential: "implementation",
  feasibility: "plan",
  "context-evidence": "plan",
  runtime: "plan",
  design: "design",
  validation: "design",
  "narrow-permissions": "scaffold",
  "script-change": "package",
  "keep-listener": "plan",
  "keep-native-addon": "plan",
  "keep-system": "plan"
};

export function stepForAsk(id, draft) {
  if (ASK_STEP[id]) return ASK_STEP[id];
  return draft.steps.find((step) => step.status === "running")?.id || "plan";
}

function answerLine(ask, value, via) {
  return {
    type: "answer",
    askId: ask.id,
    nonce: ask.nonce,
    value,
    via,
    at: now(),
    ...(ask.scope ? { scopeSha: ask.scopeSha || bindScope(ask.scope) } : {})
  };
}

export function dashboardAnswerLine(ask, value) {
  return answerLine(ask, value, "dashboard");
}

function setStepIn(draft, id, status, detail, extra = {}) {
  const step = draft.steps.find((item) => item.id === id);
  if (!step) throw new Error(`Unknown step "${id}". Steps are ${draft.steps.map((item) => item.id).join(", ")}.`);
  if (!STEP_STATUS.has(status)) throw new Error(`Unknown status "${status}". Use ${[...STEP_STATUS].join(", ")}.`);
  const stamp = now();
  if (status === "pending") {
    step.startedAt = null;
    step.endedAt = null;
  }
  if (status === "running" || status === "waiting") {
    if (!step.startedAt) step.startedAt = stamp;
    step.endedAt = null;
  }
  if (status === "done" || status === "skipped") {
    if (!step.startedAt) step.startedAt = stamp;
    step.endedAt = stamp;
    step.doing = "";
    step.progress = null;
  }
  step.status = status;
  if (detail !== undefined && detail !== null) step.detail = detail;
  if (status === "running" || status === "waiting") {
    if (extra.doing !== undefined) step.doing = String(extra.doing).slice(0, 160);
    if (extra.progress !== undefined) step.progress = extra.progress;
  }
}

function log(draft, step, text) {
  draft.log.push({ at: now(), step: step || "", text });
  if (draft.log.length > 120) draft.log.splice(0, draft.log.length - 120);
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function acquire(lockFile) {
  const deadline = Date.now() + 3000;
  for (;;) {
    try {
      const fd = fs.openSync(lockFile, "wx");
      fs.closeSync(fd);
      return () => fs.rmSync(lockFile, { force: true });
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      try {
        const age = Date.now() - fs.statSync(lockFile).mtimeMs;
        if (age > 5000) fs.rmSync(lockFile, { force: true });
      } catch {
        // The holder just released it.
      }
      if (Date.now() > deadline) throw new Error("The session file is locked by another command.");
      sleepSync(25);
    }
  }
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
