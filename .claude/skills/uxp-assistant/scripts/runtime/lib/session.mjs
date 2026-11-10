import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { imageSize, sniffImage } from "./images.mjs";

/**
 * One review session lives in one folder:
 *
 *   session.json   written only by the agent's CLI calls
 *   answers.jsonl  written only by the dashboard server, append-only
 *   server.json    the running dashboard (pid, port, token)
 *   shots/         copies of every image the dashboard may show
 *
 * The two writers never touch the same file, so a click in the browser can
 * never be lost by an agent update. `readMerged` joins them.
 */

export const DEFAULT_STEPS = [
  { id: "prepare", label: "Prepare", hint: "Creates the session. No network." },
  { id: "docs", label: "Docs", hint: "Fetches the skill's sources after the dashboard is up." },
  { id: "decide", label: "Decide", hint: "The skill's questions." },
  { id: "done", label: "Wrap up" }
];

const STEP_STATUS = new Set(["pending", "running", "waiting", "done", "skipped"]);

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

/** True while the dashboard process for this session is alive. */
export function dashboardUp(out) {
  const info = readServer(out);
  if (!info) return false;
  try {
    process.kill(info.pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
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
  fs.appendFileSync(files.answers(out), `${JSON.stringify(line)}\n`);
}

/** Session plus the answers the dashboard wrote. This is what the UI and `wait` read. */
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
      hasSecret: Boolean(answer.secret),
      ...(answer.text ? { answerText: answer.text } : {}),
      ...(answer.images?.length ? { answerImages: answer.images } : {}),
      deliveredAt: delivered?.at || null
    };
  });
  return { ...session, asks };
}

/** Read, change, and write session.json under a lock so two quick CLI calls cannot clobber each other. */
export function mutate(out, change) {
  fs.mkdirSync(out, { recursive: true });
  const release = acquire(files.lock(out));
  try {
    const current = readSession(out) || emptySession();
    const draft = structuredClone(current);
    change(draft);
    draft.rev = (current.rev || 0) + 1;
    draft.updatedAt = now();
    // Only the agent's commands write this file, so every write proves the agent is still working.
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

export function emptySession(steps = DEFAULT_STEPS) {
  return {
    v: 1,
    rev: 0,
    mode: null,
    startedAt: now(),
    updatedAt: now(),
    addon: {},
    baseline: [],
    steps: steps.map((step) => ({ id: step.id, label: step.label, optional: Boolean(step.optional), hint: step.hint || "", command: step.command || "", say: step.say || "", status: "pending", detail: "", doing: "", progress: null, startedAt: null, endedAt: null })),
    askSteps: {},
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

/**
 * Start a session from a fresh scan. With `keep`, the earlier steps, notes,
 * asks, and shots stay and only the add-on facts and the current findings move.
 */
export function startSession(out, report, { keep = false } = {}) {
  return mutate(out, (draft) => {
    const previous = keep ? structuredClone(draft) : null;
    const steps = report.steps?.length ? report.steps : DEFAULT_STEPS;
    const fresh = emptySession(steps);
    Object.assign(draft, previous && sameAddon(previous, report) ? previous : fresh);
    if (!previous || !sameAddon(previous, report)) draft.steps = emptySession(steps).steps;
    draft.addon = {
      name: report.addon || "Session",
      path: report.addonPath || report.projectPath || "",
      docsSha: report.docsSha || "",
      fetchedAt: report.fetchedAt || ""
    };
    draft.askSteps = report.askSteps || {};
    if (report.extensionPath) draft.extensionPath = report.extensionPath;
    draft.needsCredential = false;
    if (!previous || !sameAddon(previous, report) || !draft.baseline.length) {
      draft.baseline = (report.findings || []).map(baselineEntry);
    }
    const first = draft.steps.find((step) => step.id !== "done");
    if (!previous || !sameAddon(previous, report)) {
      if (first && first.status === "pending") setStepIn(draft, first.id, "done", "Started.");
      log(draft, first?.id || "", "Session started.");
    } else {
      log(draft, first?.id || "", "Session kept.");
    }
  });
}

export function setMode(out, mode) {
  return mutate(out, (draft) => {
    draft.mode = mode;
    log(draft, null, mode === "dashboard" ? "Dashboard mode. Decisions are made here." : "Chat mode. Decisions are made in the chat.");
  });
}

export function setStep(out, id, status, detail, extra = {}) {
  return mutate(out, (draft) => {
    const before = draft.steps.find((item) => item.id === id)?.status;
    setStepIn(draft, id, status, detail, extra);
    const step = draft.steps.find((item) => item.id === id);
    const said = extra.log !== undefined ? extra.log : extra.silent ? "" : detail || (status !== before ? `${step?.label}: ${status}` : "");
    if (said) log(draft, id, said);
  });
}

/** The audit's result, kept so `next` knows which passes ran and which findings are still open. */
export function setAudit(out, audit) {
  return mutate(out, (draft) => {
    draft.audit = { ...(draft.audit || {}), ...audit, at: now(), rev: (draft.rev || 0) + 1 };
  });
}

/** `3/12` or `40%` into `{ done, total }`. */
export function parseProgress(value) {
  if (value === undefined || value === null || value === "") return undefined;
  const ratio = String(value).match(/^(\d+)\s*\/\s*(\d+)$/);
  if (ratio) return { done: Number(ratio[1]), total: Math.max(Number(ratio[2]), 1) };
  const percent = String(value).match(/^(\d+(?:\.\d+)?)\s*%$/);
  if (percent) return { done: Math.min(Number(percent[1]), 100), total: 100 };
  throw new Error('Progress looks like 3/12 or 40%.');
}

export function addNote(out, { text, screen, shot, shots, id, severity, rule, theme, themes, source, selector, key, auto }) {
  return mutate(out, (draft) => {
    if (id) {
      const existing = draft.notes.find((note) => note.id === id);
      if (existing) {
        if (text) existing.text = text;
        if (screen) existing.screen = screen;
        if (shot) existing.shot = shot;
        if (shots?.length) existing.shots = shots;
        return;
      }
    }
    const note = {
      id: id || `n${draft.notes.length + 1}`,
      text,
      screen: screen || "",
      shot: shot || "",
      ...(shots?.length ? { shots } : {}),
      status: "open",
      at: now(),
      ...(severity ? { severity } : {}),
      ...(rule ? { rule } : {}),
      ...(theme ? { theme } : {}),
      ...(themes ? { themes } : {}),
      ...(source ? { source } : {}),
      ...(selector ? { selector } : {}),
      ...(key ? { key } : {}),
      ...(auto ? { auto: true } : {})
    };
    draft.notes.push(note);
    if (!auto) log(draft, "panel", `Noted: ${text}`);
  });
}

/**
 * `by` says who is closing the note. The agent's "fixed" is a claim. Only the audit, which measures the
 * panel again, confirms it, so `next` asks for another audit while a claim is newer than the last one.
 */
export function setNoteStatus(out, id, status, by = "agent") {
  if (!["open", "fixed", "skipped"].includes(status)) throw new Error(`A note is open, fixed, or skipped, not ${status}.`);
  return mutate(out, (draft) => {
    const note = draft.notes.find((item) => item.id === id);
    if (!note) throw new Error(`No note named ${id}.`);
    note.status = status;
    // `rev` is the number this write will get, so "after the last audit" is exact and never a tie on the clock.
    if (status === "fixed") {
      note.fixedBy = by;
      note.fixedRev = (draft.rev || 0) + 1;
    } else {
      delete note.fixedBy;
      delete note.fixedRev;
    }
    log(draft, "fix", `Note ${id} ${status}.`);
  });
}

/** Copy an image under shots/ so the dashboard only ever serves files from the session folder. */
export function addShot(out, { file, label, kind = "panel", auto = false, theme = "" }) {
  const source = path.resolve(file);
  const buf = fs.readFileSync(source);
  const size = imageSize(buf);
  if (!size) throw new Error(`${source} is not a PNG or JPEG.`);
  const dir = path.join(out, "shots");
  fs.mkdirSync(dir, { recursive: true });
  const safe = path.basename(source).replace(/[^a-zA-Z0-9._-]/g, "-");
  let draftEntry = null;
  const session = mutate(out, (draft) => {
    const id = `s${Math.max(0, ...draft.shots.map((shot) => Number(String(shot.id).slice(1)) || 0)) + 1}`;
    const name = `${id}-${kind}-${safe}`;
    fs.writeFileSync(path.join(dir, name), buf);
    draftEntry = { id, kind, label: label || safe, file: `shots/${name}`, width: size.width, height: size.height, at: now(), ...(auto ? { auto: true } : {}), ...(theme ? { theme } : {}) };
    draft.shots.push(draftEntry);
    // The audit takes two captures per screen. The step's own progress already says so.
    if (!auto) log(draft, kind === "listing" ? "listing" : "panel", `Captured ${draftEntry.label}.`);
  });
  return { session, shot: draftEntry };
}

/** A new audit replaces the last audit's captures, except the ones a note still points to. */
export function dropAutoShots(out) {
  return mutate(out, (draft) => {
    const used = new Set(draft.notes.map((note) => note.shot).filter(Boolean));
    draft.shots = draft.shots.filter((shot) => !shot.auto || used.has(shot.file));
  });
}

export function setListing(out, listing) {
  return mutate(out, (draft) => {
    draft.listing = { ...listing, at: now() };
    log(draft, "listing", "Drafted the listing text.");
  });
}

export function publishAsk(out, ask) {
  const nonce = crypto.randomBytes(6).toString("hex");
  const normalized = {
    id: ask.id,
    nonce,
    title: ask.title || "",
    prompt: ask.prompt,
    input: ask.input || "",
    maxLength: ask.maxLength || 500,
    // `attach` makes the card take typed words and screenshots with the choice.
    ...(ask.attach ? { attach: true } : {}),
    ...(ask.round ? { round: ask.round } : {}),
    options: (ask.options || []).map((option) => ({
      id: option.id,
      label: option.label,
      detail: option.detail || "",
      secret: option.secret || "",
      ...(option.ends ? { ends: true } : {}),
      // `repeat` means this answer opens another round, so the step stays open. `then` is what the agent does next.
      ...(option.repeat ? { repeat: true } : {}),
      ...(option.then ? { then: option.then } : {})
    })),
    affects: ask.affects || [],
    images: ask.images || [],
    blocks: ask.blocks || [],
    askedAt: now(),
    ...(ask.scope ? { scope: ask.scope, scopeSha: ask.scopeSha || "" } : {})
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

/** Show a question that another session already published, keeping its nonce. */
export function adoptAsk(out, ask) {
  if (!ask?.id || !ask?.nonce) throw new Error("An adopted question needs an id and a nonce.");
  if (!Array.isArray(ask.options) || ask.options.length < 1) throw new Error("An adopted question needs at least one option.");
  return mutate(out, (draft) => {
    draft.askSteps = draft.askSteps || {};
    if (!draft.askSteps[ask.id]) draft.askSteps[ask.id] = "decide";
    draft.asks = draft.asks.filter((item) => item.id !== ask.id);
    draft.asks.push(ask);
    const step = stepForAsk(ask.id, draft);
    if (step) setStepIn(draft, step, "waiting", ask.title || "Waiting for your answer");
    log(draft, step, `Needs a decision: ${ask.title || ask.id}.`);
  });
}

/** Record an answer given in chat, so the session shows what was decided and how. */
export function answerFields(ask, value, via, extra = {}) {
  return {
    type: "answer",
    askId: ask.id,
    nonce: ask.nonce,
    value,
    via,
    at: now(),
    ...extra,
    ...(ask.scope ? { scope: ask.scope, scopeSha: ask.scopeSha || "" } : {})
  };
}

export function answerFromChat(out, id, value, extra = {}) {
  const session = readSession(out);
  const ask = session?.asks.find((item) => item.id === id);
  if (!ask) throw new Error(`No question named ${id}. Publish it with the ask command first.`);
  if (ask.input === "text") {
    const text = String(value || "").trim();
    if (!text || text.length > (ask.maxLength || 500)) throw new Error("That text is empty or too long.");
    appendAnswerLine(out, answerFields(ask, text, "chat"));
    return { id: text, label: text };
  }
  const option = matchOption(ask, value);
  if (!option) throw new Error(`"${value}" is not one of: ${ask.options.map((item) => item.id).join(", ")}.`);
  const attached = ask.attach ? attachmentFields(out, ask, option, extra) : {};
  appendAnswerLine(out, answerFields(ask, option.id, "chat", attached));
  mutate(out, (draft) => {
    const step = stepForAsk(id, draft);
    if (step) setStepIn(draft, step, "running", `You chose: ${plainLabel(option.label)}`);
    log(draft, step, `You chose: ${plainLabel(option.label)}.`);
    settleStep(out, draft, step);
  });
  return option;
}

export const ATTACH_LIMITS = { images: 6, imageBytes: 5 * 1024 * 1024, text: 4000 };

/** Words and screenshots that travel with a choice. The choice that opens another round needs at least one of them. */
function attachmentFields(out, ask, option, { text = "", images = [] } = {}) {
  const words = String(text || "").trim();
  if (words.length > ATTACH_LIMITS.text) throw new Error(`Keep the text under ${ATTACH_LIMITS.text} characters.`);
  if (images.length > ATTACH_LIMITS.images) throw new Error(`Send at most ${ATTACH_LIMITS.images} screenshots.`);
  if (option.repeat && !words && !images.length) throw new Error("Say what is wrong in words, or add a screenshot.");
  const saved = saveFeedbackImages(out, ask, images.map((file) => (Buffer.isBuffer(file) ? file : fs.readFileSync(path.resolve(file)))));
  return { ...(words ? { text: words } : {}), ...(saved.length ? { images: saved } : {}) };
}

/** Write each image under shots/ with a name the dashboard may serve. Returns the session-relative paths. */
export function saveFeedbackImages(out, ask, buffers) {
  const dir = path.join(out, "shots");
  fs.mkdirSync(dir, { recursive: true });
  return buffers.map((buf, index) => {
    if (buf.length > ATTACH_LIMITS.imageBytes) throw new Error(`Screenshot ${index + 1} is over ${ATTACH_LIMITS.imageBytes / 1024 / 1024} MB.`);
    const kind = sniffImage(buf);
    if (!kind) throw new Error(`Screenshot ${index + 1} is not a PNG, JPEG, or WebP image.`);
    const name = `fb-${ask.nonce}-${index + 1}.${kind.ext}`;
    fs.writeFileSync(path.join(dir, name), buf);
    return `shots/${name}`;
  });
}

/**
 * A report from the developer becomes a note, so it shows in the Notes tab and the agent closes it when fixed.
 * Safe to call twice. The same round updates the same note.
 */
export function noteFeedback(out, id) {
  const ask = readMerged(out)?.asks.find((item) => item.id === id && item.status === "answered");
  if (!ask?.attach) return null;
  const option = ask.options.find((item) => item.id === ask.answer);
  if (!option?.repeat || (!ask.answerText && !ask.answerImages?.length)) return null;
  const noteId = `fb${ask.round || 1}`;
  addNote(out, {
    id: noteId,
    text: ask.answerText || "Screenshot only. Read it and find what is wrong.",
    screen: `Your report, round ${ask.round || 1}`,
    shot: ask.answerImages?.[0] || "",
    shots: ask.answerImages || [],
    severity: "error"
  });
  return noteId;
}

/**
 * The agent has read an answer the dashboard recorded. Move the step that was
 * waiting back to running and note the choice. Safe to call twice.
 */
export function noteDelivered(out, id, label, via) {
  const session = readSession(out);
  if (!session) return;
  const step = stepForAsk(id, session);
  const waiting = step && session.steps.find((item) => item.id === step)?.status === "waiting";
  if (!waiting) return;
  mutate(out, (draft) => {
    // The step said "Waiting for your answer". Replace it, or it keeps saying so while the agent works.
    setStepIn(draft, step, "running", `You chose: ${plainLabel(label)}`);
    log(draft, step, `You chose: ${plainLabel(label)}${via === "dashboard" ? " on the dashboard" : ""}.`);
    settleStep(out, draft, step);
  });
}

function settleStep(out, draft, stepId) {
  if (!stepId) return;
  const published = (draft.asks || []).filter((ask) => stepForAsk(ask.id, draft) === stepId);
  if (!published.length) return;
  const lines = readAnswers(out);
  const open = published.some((ask) => !lines.some((line) => line.type === "answer" && line.askId === ask.id && line.nonce === ask.nonce));
  if (open) return;
  // An answer that opens another round keeps the step going until a round ends without one.
  const again = published.some((ask) => {
    const line = lines.find((item) => item.type === "answer" && item.askId === ask.id && item.nonce === ask.nonce);
    return ask.options.find((item) => item.id === line?.value)?.repeat;
  });
  if (again) return;
  const detail = draft.steps.find((step) => step.id === stepId)?.detail || "";
  setStepIn(draft, stepId, "done", detail);
}

const plainLabel = (label) => String(label || "").replace(/\s*\(recommended\)\s*$/i, "");

export function matchOption(ask, value) {
  const wanted = String(value || "").trim().toLowerCase();
  return ask.options.find((item) => item.id.toLowerCase() === wanted) || ask.options.find((item) => item.label.toLowerCase().replace(/\s*\(recommended\)$/, "") === wanted);
}

export function finish(out, summary, { stopped = false } = {}) {
  const current = readSession(out);
  const docs = current?.steps?.find((step) => step.id === "docs");
  if (!stopped && docs && docs.status !== "done" && docs.status !== "skipped") {
    throw new Error("The docs were never saved. Run the docs command before done.");
  }
  return mutate(out, (draft) => {
    draft.summary = summary || null;
    for (const step of draft.steps) {
      if (step.status === "running" || step.status === "waiting") setStepIn(draft, step.id, "done", null);
    }
    setStepIn(draft, "done", "done", "Finished.");
    log(draft, "done", "Session finished.");
  });
}

export function stepForAsk(id, draft) {
  if (draft.askSteps?.[id]) return draft.askSteps[id];
  if (id === "mode") return null;
  return draft.steps.find((step) => step.status === "running")?.id || null;
}

export function recordDocs(out, summary) {
  return mutate(out, (draft) => {
    draft.docs = {
      ok: summary.ok,
      fresh: summary.fresh,
      stale: summary.stale,
      failed: summary.failed,
      pages: summary.pages.map((page) => ({ id: page.id, url: page.url, freshness: page.freshness, error: page.error || "" }))
    };
    draft.addon.docsSha = summary.sha || draft.addon.docsSha || "";
    draft.addon.fetchedAt = summary.retrievedAt || "";
    const detail = `Adobe docs saved: ${summary.fresh.length + summary.stale.length} pages (${summary.fresh.length} fresh, ${summary.stale.length} stale, ${summary.failed.length} failed)`;
    if (draft.steps.some((step) => step.id === "docs")) {
      setStepIn(draft, "docs", "done", detail, { doing: detail, progress: { done: summary.pages.length, total: summary.pages.length } });
    }
    log(draft, "docs", detail);
  });
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

function baselineEntry(finding) {
  return {
    key: `${finding.id}|${finding.file}`,
    id: finding.id,
    file: finding.file,
    severity: finding.source?.kind === "review-pattern" ? "pattern" : finding.severity
  };
}

function sameAddon(previous, report) {
  const path = report.addonPath || report.projectPath || "";
  return Boolean(previous?.addon?.path) && previous.addon.path === path;
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
