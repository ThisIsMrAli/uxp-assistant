// UXP Assistant dashboard. No dependencies, no network except this server.
// Every string from the add-on goes in through textContent, never through innerHTML.

const token = document.body.dataset.token;
const root = document.getElementById("app");
const NS = "http://www.w3.org/2000/svg";

const ui = { tab: "", tabPinned: false, filter: "all", shotTheme: "all", pickedShot: null, choice: {}, secret: {}, error: {}, sending: {}, conn: "live", skew: 0, copied: "", theme: "auto" };
const fromHash = location.hash.slice(1);
if (["findings", "panel", "listing", "activity"].includes(fromHash)) { ui.tab = fromHash; ui.tabPinned = true; }
try { ui.theme = localStorage.getItem("review-theme") || "auto"; } catch { /* storage off */ }
let state = null;
let downTimer = null;
let loading = false;
let again = false;

const api = (path) => `${path}${path.includes("?") ? "&" : "?"}t=${token}`;
const fileUrl = (file) => api(`/files/${file.split("/").map(encodeURIComponent).join("/")}`);
const nowMs = () => Date.now() + ui.skew;

// ---- building blocks ------------------------------------------------------------------------

function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value == null || value === false) continue;
    if (key === "class") el.className = value;
    else if (key === "text") el.textContent = value;
    else if (key.startsWith("on")) el.addEventListener(key.slice(2), value);
    else if (value === true) el.setAttribute(key, "");
    else el.setAttribute(key, value);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

/** replaceChildren turns a null argument into the text "null", so empty values are dropped first. */
function fill(node, ...kids) {
  node.replaceChildren(...kids.flat().filter((kid) => kid != null && kid !== false));
}

const ICONS = {
  check: "M5 12.5l4.5 4.5L19 7.5",
  dash: "M7 12h10",
  x: "M6 6l12 12M18 6L6 18",
  alert: "M21.7 18l-8-14a2 2 0 0 0-3.5 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3zM12 9v4M12 17h.01",
  info: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 16v-4M12 8h.01",
  clock: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2",
  hand: "M18 11V6a2 2 0 0 0-4 0M14 10V4a2 2 0 0 0-4 0v2M10 10.5V6a2 2 0 0 0-4 0v8M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.9-5.9-2.4L3.4 16a2 2 0 0 1 3.2-2.4L8 15",
  copy: "M10 8h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2zM4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2",
  external: "M15 3h6v6M10 14L21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6",
  sun: "M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4",
  moon: "M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z",
  auto: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 2v20",
  bug: "M8 2l1.9 1.9M16 2l-1.9 1.9M9 7.1V6a3 3 0 0 1 6 0v1.1M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6zM12 20v-9M6.5 13H2M22 13h-4.5M6 17l-3 1.5M18 17l3 1.5M6 9L3 7.5M18 9l3-1.5",
  zoom: "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3M11 8v6M8 11h6",
  doc: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M8 13h8M8 17h5",
  layers: "M12 2l10 5-10 5L2 7zM2 12l10 5 10-5M2 17l10 5 10-5"
};

function icon(name, width = 2.4) {
  const svg = document.createElementNS(NS, "svg");
  for (const [k, v] of Object.entries({ viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "stroke-width": String(width), "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true", class: "i" })) svg.setAttribute(k, v);
  const path = document.createElementNS(NS, "path");
  path.setAttribute("d", ICONS[name] || ICONS.info);
  svg.append(path);
  return svg;
}

function markSvg() {
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 36 36");
  svg.setAttribute("class", "mark");
  svg.setAttribute("aria-hidden", "true");
  const defs = document.createElementNS(NS, "defs");
  const grad = document.createElementNS(NS, "linearGradient");
  grad.setAttribute("id", "mg");
  grad.setAttribute("x1", "0"); grad.setAttribute("y1", "0"); grad.setAttribute("x2", "1"); grad.setAttribute("y2", "1");
  for (const [offset, color] of [["0", "#4F46E5"], ["1", "#8B5CF6"]]) {
    const stop = document.createElementNS(NS, "stop");
    stop.setAttribute("offset", offset); stop.setAttribute("stop-color", color);
    grad.append(stop);
  }
  defs.append(grad);
  const rect = document.createElementNS(NS, "rect");
  for (const [k, v] of Object.entries({ width: "36", height: "36", rx: "11", fill: "url(#mg)" })) rect.setAttribute(k, v);
  const frame = document.createElementNS(NS, "rect");
  for (const [k, v] of Object.entries({ x: "11", y: "8", width: "14", height: "20", rx: "3", fill: "none", stroke: "#fff", "stroke-width": "2", opacity: "0.9" })) frame.setAttribute(k, v);
  const tick = document.createElementNS(NS, "path");
  for (const [k, v] of Object.entries({ d: "M14.5 18.5l2.7 2.7 4.6-5", fill: "none", stroke: "#fff", "stroke-width": "2.2", "stroke-linecap": "round", "stroke-linejoin": "round" })) tick.setAttribute(k, v);
  svg.append(defs, rect, frame, tick);
  return svg;
}

const pad = (n) => String(n).padStart(2, "0");
function dur(ms) {
  const total = Math.max(0, Math.round(ms / 1000));
  if (total < 60) return `${total}s`;
  const m = Math.floor(total / 60);
  if (m < 60) return `${m}m ${pad(total % 60)}s`;
  return `${Math.floor(m / 60)}h ${pad(m % 60)}m`;
}
function ago(iso) {
  if (!iso) return "";
  const seconds = Math.round((nowMs() - Date.parse(iso)) / 1000);
  if (seconds < 4) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return `${Math.floor(seconds / 3600)}h ago`;
}
const plural = (n, word) => (n === 1 ? word : `${word}s`);
const cap = (text) => String(text).charAt(0).toUpperCase() + String(text).slice(1);
const clean = (label) => String(label).replace(/\s*\(recommended\)\s*$/i, "");
const suggested = (option) => /\(recommended\)\s*$/i.test(option.label);
const sevWord = (severity) => ({ error: "Error", warn: "Warning", pattern: "Pattern", fixed: "Fixed", open: "Open", skipped: "Skipped" }[severity] || severity);
const sevIcon = (severity) => ({ error: "x", warn: "alert", pattern: "info", fixed: "check", open: "info" }[severity] || "info");

function badge(kind, text) {
  return h("span", { class: "sev", "data-k": kind }, icon(sevIcon(kind), 3), text || sevWord(kind));
}

// ---- state --------------------------------------------------------------------------------

const session = () => state?.session || null;
const report = () => state?.report || { findings: [], views: [] };
const steps = () => session()?.steps || [];
const pendingAsk = () => session()?.asks?.find((ask) => ask.status === "pending") || null;
const finished = () => steps().find((step) => step.id === "done")?.status === "done";

function derived() {
  const findings = report().findings;
  const present = new Set(findings.map((finding) => `${finding.id}|${finding.file}`));
  const baseline = session()?.baseline || [];
  const notes = session()?.notes || [];
  const bugs = notes.filter((note) => note.severity === "error" || note.severity === "warn");
  return {
    errors: findings.filter((f) => f.severity === "error"),
    warnings: findings.filter((f) => f.severity === "warn"),
    patterns: findings.filter((f) => f.severity === "pattern"),
    fixed: baseline.filter((entry) => !present.has(entry.key)),
    total: baseline.length,
    bugsOpen: bugs.filter((note) => note.status === "open"),
    bugsFixed: bugs.filter((note) => note.status === "fixed")
  };
}

/** Is the agent still on the job? An open `wait` call is proof it is listening for the user. */
function agentState() {
  const s = session();
  if (!s || finished()) return null;
  const info = state?.agent || {};
  const seen = Date.parse(info.seenAt) || 0;
  const poll = Date.parse(info.lastPollAt) || 0;
  const t = nowMs();
  const listening = (info.waiting || 0) > 0 || (poll && t - poll < 35000);
  const last = Math.max(seen, poll);
  const quiet = last ? t - last : 0;
  const pending = s.mode === "dashboard" ? pendingAsk() : null;
  if (pending) {
    if (listening) return { tone: "ok", live: true, label: "Agent is listening for your answer", quiet };
    if (quiet > 30000) return { tone: "warn", label: `Agent is not listening (${dur(quiet)})`, quiet, stalled: "listening" };
    return { tone: "work", live: true, label: "Agent is about to listen", quiet };
  }
  const waitingForPickup = (s.asks || []).find((ask) => ask.status === "answered" && ask.via === "dashboard" && !ask.deliveredAt);
  if (waitingForPickup && !listening && quiet > 25000) return { tone: "warn", label: `Agent has not picked up your answer (${dur(quiet)})`, quiet, stalled: "pickup" };
  if (!last) return { tone: "idle", label: "Waiting for the agent to report in", quiet };
  if (quiet < 20000) return { tone: "work", live: true, label: "Agent active", quiet };
  if (quiet < 180000) return { tone: "work", live: true, label: `Agent working, last update ${dur(quiet)} ago`, quiet };
  return { tone: "warn", label: `No update for ${dur(quiet)}`, quiet, stalled: "quiet" };
}

// ---- keyed regions: a region repaints only when what it shows has changed ---------------------

const painted = new Map();
function region(node, key, build) {
  if (painted.get(node) === key) return;
  painted.set(node, key);
  const active = document.activeElement?.dataset?.fid;
  fill(node, build());
  if (active) node.querySelector(`[data-fid="${active}"]`)?.focus();
}

const el = {
  who: h("div", { class: "who" }),
  facts: h("div", { class: "facts" }),
  steps: h("ol", { class: "steps" }),
  railHead: h("div", { class: "rail-head" }),
  alert: h("div", { id: "alert", role: "status" }),
  stats: h("section", { class: "stats", "aria-label": "Summary" }),
  hero: h("section", { class: "card hero", "aria-live": "polite", "aria-labelledby": "hero-title" }),
  sheet: h("div", { id: "sheet" }),
  tabs: h("div", { class: "tabs", role: "tablist", "aria-label": "Review details" }),
  pane: h("div", { class: "pane", role: "tabpanel" }),
  strip: h("aside", { class: "card strip", "aria-label": "Panel at 320 pixels" }),
  box: h("dialog", { class: "lightbox", "aria-labelledby": "lightbox-title" })
};
const TABS = [["findings", "Findings"], ["panel", "Notes"], ["listing", "Artifacts"], ["activity", "Activity"]];
const tabButtons = {};
for (const [id, label] of TABS) {
  const count = h("span", { class: "n" });
  const button = h("button", { class: "tab", role: "tab", id: `tab-${id}`, onclick: () => { ui.tab = id; ui.tabPinned = true; history.replaceState(null, "", `#${id}`); paintTabs(); paintPane(); } }, label, count);
  tabButtons[id] = { button, count };
  el.tabs.append(button);
}
el.tabs.addEventListener("keydown", (event) => {
  const ids = TABS.map(([id]) => id);
  const at = ids.indexOf(ui.tab);
  const next = event.key === "ArrowRight" ? ids[(at + 1) % ids.length] : event.key === "ArrowLeft" ? ids[(at + ids.length - 1) % ids.length] : null;
  if (!next) return;
  ui.tab = next;
  ui.tabPinned = true;
  paintTabs();
  paintPane();
  tabButtons[next].button.focus();
});
el.box.addEventListener("click", (event) => { if (event.target === el.box) el.box.close(); });

root.append(
  h("header", { class: "topbar" }, h("div", { class: "brand" }, markSvg(), el.who), el.facts),
  h("div", { class: "frame" },
    h("nav", { class: "rail", "aria-label": "Session steps" }, el.railHead, el.steps),
    h("main", { class: "main", id: "main" }, el.alert, el.sheet, el.hero, el.stats, el.tabs, el.pane),
    el.strip),
  el.box
);

// ---- loading ------------------------------------------------------------------------------

async function load() {
  if (loading) { again = true; return; }
  loading = true;
  try {
    const res = await fetch(api("/api/state"), { cache: "no-store" });
    if (res.ok) {
      state = await res.json();
      ui.skew = Date.parse(state.serverTime) - Date.now();
      root.setAttribute("aria-busy", "false");
      paint();
    }
  } catch {
    // The connection indicator tells the story.
  }
  loading = false;
  if (again) { again = false; load(); }
}

function paint() {
  chooseTab();
  paintTop();
  paintRail();
  paintAlert();
  paintSheet();
  paintHero();
  paintStats();
  paintTabs();
  paintPane();
  paintStrip();
  paintTitle();
}

/** Follow the work: the panel tab while the walk runs, the listing tab when it starts, until the user picks one. */
function chooseTab() {
  if (ui.tabPinned) return;
  const running = steps().find((step) => step.status === "running" || step.status === "waiting");
  ui.tab = running?.id === "panel" || running?.id === "access" ? "panel" : running?.id === "listing" ? "listing" : ui.tab || "findings";
}

// ---- top bar ------------------------------------------------------------------------------

function cycleTheme() {
  ui.theme = ui.theme === "auto" ? "light" : ui.theme === "light" ? "dark" : "auto";
  try { localStorage.setItem("review-theme", ui.theme); } catch { /* storage off */ }
  if (ui.theme === "auto") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = ui.theme;
  painted.delete(el.facts);
  paintTop();
}

function paintTop() {
  const s = session();
  const r = report();
  const sha = (s?.addon?.docsSha || r.docsSha || "").slice(0, 7);
  const fetched = s?.addon?.fetchedAt || r.fetchedAt;
  const when = fetched ? new Date(fetched).toLocaleDateString([], { month: "short", day: "numeric" }) : "";
  region(el.who, JSON.stringify([s?.addon?.name, r.addon, s?.addon?.path]), () => [
    h("h1", { text: s?.addon?.name || r.addon || "UXP Assistant" }),
    h("p", { class: "path", text: s?.addon?.path || "Waiting for a session to start" })
  ]);
  const conn = { live: ["ok", "Live", true], retry: ["warn", "Reconnecting"], down: ["bad", "Dashboard stopped"] }[ui.conn];
  region(el.facts, JSON.stringify([ui.conn, ui.theme, s?.mode, sha, when, s?.outcome, r.state, r.success, r.hostExecuted]), () => [
    h("span", { class: "pill", text: s?.mode === "chat" ? "Decisions in chat" : "Decisions here" }),
    h("span", { class: "pill", "data-tone": s?.outcome === "commands-finished" && r.success === true ? "work" : "warn", text: `State: ${s?.outcome || r.state || "none"}` }),
    h("span", { class: "pill", text: s?.outcome === "commands-finished" && r.success === true ? "Commands recorded. Host NOT TESTED." : "Not complete" }),
    h("span", { class: "pill", text: sha ? `Adobe docs ${sha}${when ? `, ${when}` : ""}` : "Adobe docs from cache" }),
    h("a", { class: "pill", href: fileUrl("report.md"), target: "_blank", rel: "noopener" }, icon("doc", 2), "Full report"),
    h("span", { class: "pill", role: "status", "data-tone": conn[0], "data-live": conn[2] ? "true" : "false" }, h("i", { class: "dot" }), conn[1]),
    h("button", { class: "pill iconbtn", type: "button", "aria-label": `Theme: ${ui.theme}. Press to change.`, title: `Theme: ${ui.theme}`, onclick: cycleTheme }, icon(ui.theme === "dark" ? "moon" : ui.theme === "light" ? "sun" : "auto", 2))
  ]);
}

// ---- the step rail ------------------------------------------------------------------------

function visibleSteps() {
  const s = session();
  return steps().filter((step) => step.status !== "skipped" || (step.id === "access" && s?.needsCredential));
}

function paintRail() {
  const list = visibleSteps();
  const counted = list.filter((step) => step.status !== "skipped");
  const doneCount = counted.filter((step) => step.status === "done").length;
  region(el.railHead, `${doneCount}/${counted.length}`, () => [h("p", { class: "eyebrow", text: "Workflow" }), h("b", { text: `${doneCount} of ${counted.length}` })]);
  const key = JSON.stringify(list.map((step) => [step.id, step.status, step.detail, step.progress, step.startedAt, step.endedAt]));
  region(el.steps, key, () => list.map((step) => {
    const took = step.status === "done" && step.startedAt && step.endedAt ? Date.parse(step.endedAt) - Date.parse(step.startedAt) : 0;
    const showDetail = step.detail && ["done", "running", "waiting", "skipped", "failed"].includes(step.status);
    const live = step.status === "running";
    return h("li", { class: "step", "data-status": step.status, "aria-current": live ? "step" : null },
      h("span", { class: "mark-step" }, step.status === "done" ? icon("check", 3.4) : step.status === "skipped" ? icon("dash", 3) : step.status === "waiting" ? icon("hand", 2.2) : live ? h("span", { class: "spin" }) : null),
      h("div", null,
        h("div", { class: "name" }, step.label,
          step.status === "running" ? h("span", { class: "tag", "data-k": "running", text: "Now" }) : null,
          step.status === "waiting" ? h("span", { class: "tag", "data-k": "waiting", text: "Your turn" }) : null,
          step.optional ? h("span", { class: "tag", text: "Optional" }) : null,
          h("span", { class: "sr", text: `. ${statusWord(step.status)}` })),
        showDetail ? h("p", { class: "detail", text: step.detail }) : null,
        live && step.progress ? progressBar(step.progress, { thin: true, live: true }) : null,
        took > 1500 ? h("p", { class: "took", text: `Took ${dur(took)}` }) : null));
  }));
}

function statusWord(status) {
  return { pending: "Not started", running: "In progress", waiting: "Waiting for you", done: "Done", skipped: "Skipped", failed: "Failed" }[status] || status;
}

function progressBar(progress, { thin = false, live = false, tone = "" } = {}) {
  // A step that is still finding out how much there is reports `found`, not `done` of `total`. It shows as indeterminate.
  const ratio = progress && progress.total ? Math.min(1, Math.max(0, progress.done / Math.max(progress.total, 1))) : null;
  const fillBar = h("span");
  if (ratio !== null) fillBar.style.width = `${Math.max(3, Math.round(ratio * 100))}%`;
  return h("div", {
    class: `bar${thin ? " thin" : ""}${live ? " is-live" : ""}${ratio === null ? " indeterminate" : ""}${tone ? ` ${tone}` : ""}`,
    role: "progressbar",
    "aria-label": "Progress",
    "aria-valuemin": ratio === null ? null : "0",
    "aria-valuemax": ratio === null ? null : String(progress.total),
    "aria-valuenow": ratio === null ? null : String(progress.done),
    "aria-valuetext": ratio === null ? "Working. This step has no percentage." : `${progress.done} of ${progress.total}`
  }, fillBar);
}

// ---- alerts: say so when the agent seems to have stopped -----------------------------------

function paintAlert() {
  const agent = agentState();
  const stalled = agent?.stalled || "";
  region(el.alert, stalled, () => {
    if (!stalled) return null;
    const copy = () => copyText("continue", "continue");
    const ask = h("button", { class: "btn small", type: "button", onclick: copy, "data-fid": "copy-continue" }, icon("copy", 2), ui.copied === "continue" ? "Copied" : "Copy “continue”");
    const messages = {
      listening: ["The agent is not listening for your answer yet", "You can still answer. It is saved right away. If the agent's chat looks idle, type "],
      pickup: ["Your answer is saved, but the agent has not picked it up", "Go to the agent's chat and type "],
      quiet: ["The agent has not reported in for a while", "It may be reading or editing code. If its chat looks idle, type "]
    }[stalled];
    return h("div", { class: "alert", "data-tone": stalled === "quiet" ? "info" : "warn" },
      icon(stalled === "quiet" ? "info" : "alert", 2.2),
      h("div", null, h("strong", { text: messages[0] }), h("p", null, messages[1], h("code", { text: "continue" }), ". It picks up exactly where it stopped.")),
      ask);
  });
}

function copyText(text, tag) {
  const done = () => { ui.copied = tag; painted.delete(el.alert); painted.delete(el.pane); paintAlert(); paintPane(); setTimeout(() => { ui.copied = ""; painted.delete(el.alert); painted.delete(el.pane); paintAlert(); paintPane(); }, 1600); };
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(done, () => {});
}

// ---- the hero: what is happening right now ----------------------------------------------------

function paintHero() {
  const s = session();
  const agent = agentState();
  const d = derived();
  const pending = s?.mode === "dashboard" ? pendingAsk() : null;
  const list = visibleSteps().filter((step) => step.status !== "skipped");
  const running = steps().find((step) => step.status === "running");
  const waiting = steps().find((step) => step.status === "waiting");
  const next = steps().find((step) => step.status === "pending" && step.id !== "done");
  const feed = [...(s?.log || [])].slice(-4).reverse();
  const tone = !s ? "idle" : finished() ? "ok" : pending ? "wait" : (waiting || running) ? "work" : "idle";
  const current = pending ? waiting : waiting || running || next;
  const index = current ? list.findIndex((step) => step.id === current.id) + 1 : 0;
  const key = JSON.stringify([tone, s?.outcome, s?.contract?.goal, current && [current.id, current.status, current.doing, current.detail, current.progress, current.startedAt], pending && pending.id, feed.map((entry) => entry.at + entry.text), s?.summary, agent && [agent.tone, agent.label.replace(/\(.*\)|, last update.*/, "")], d.bugsOpen.length, d.errors.length]);
  el.hero.dataset.tone = tone;
  region(el.hero, key, () => {
    if (!s) {
      return [
        h("div", { class: "hero-top" }, h("p", { class: "eyebrow", text: "Waiting" })),
        h("h2", { id: "hero-title", text: "No session yet" }),
        h("p", { class: "lede", text: "Run the assistant from your agent. This page fills in as it works." }),
        h("div", { class: "meter" }, progressBar(null))
      ];
    }
    if (finished()) {
      return [
        h("div", { class: "hero-top" }, h("div", { class: "hero-step" }, icon("check", 3), h("p", { class: "eyebrow", text: "Finished" }))),
        h("h2", { id: "hero-title", text: "Commands finished" }),
        h("p", { class: "summary", text: "The Adobe host was NOT TESTED." }),
        s?.contract?.goal ? h("p", { class: "lede", text: `Goal: ${s.contract.goal}` }) : null,
        h("p", { class: "lede", text: s.summary || "Command results are recorded. A browser preview is not a host pass." }),
        d.total || d.bugsFixed.length ? h("p", { class: "lede" }, [d.total ? `${d.fixed.length} of ${d.total} findings fixed` : "", d.total && d.bugsFixed.length ? ", " : "", d.bugsFixed.length ? `${d.bugsFixed.length} panel ${plural(d.bugsFixed.length, "bug")} confirmed fixed` : ""].join("") + ".") : null
      ];
    }
    const label = current?.label || "Review";
    const eyebrow = `${index ? `Step ${index} of ${list.length}` : "Review"} · ${label}`;
    if (tone === "wait") {
      return [
        h("div", { class: "hero-top" }, h("div", { class: "hero-step" }, icon("hand", 2.4), h("p", { class: "eyebrow", text: eyebrow })), timer(pending.askedAt, "Waiting")),
        h("h2", { id: "hero-title", text: `Paused until you answer: ${pending.title || pending.id}` }),
        h("p", { class: "lede", text: "Nothing is running while the agent waits. Your choice goes to it the moment you confirm, and it carries on by itself." }),
        h("div", { class: "meter" }, progressBar({ done: 1, total: 1 }, { tone: "paused" }))
      ];
    }
    if (tone === "work") {
      const doing = current.doing || current.detail || current.label;
      const p = current.progress;
      const phase = p?.label ? (["light", "dark"].includes(p.label) ? `${cap(p.label)} theme` : p.label) : "";
      return [
        h("div", { class: "hero-top" }, h("div", { class: "hero-step" }, h("span", { class: "spin" }), h("p", { class: "eyebrow", text: eyebrow })), timer(current.startedAt, "Running")),
        h("h2", { id: "hero-title", text: doing }),
        s?.contract?.goal ? h("p", { class: "lede", text: `Goal: ${s.contract.goal}` }) : null,
        current.hint ? h("p", { class: "lede", text: current.hint }) : null,
        h("div", { class: "meter" },
          progressBar(p || null, { live: true }),
          h("div", { class: "meter-row" },
            h("span", null, p ? [h("b", { text: p.total ? `${p.done} of ${p.total === 100 ? "100%" : p.exact ? p.total : `about ${p.total}`}` : `${p.found || 0} ${plural(p.found || 0, "screen")} found so far` }), phase ? `  ·  ${phase}` : ""] : "Working. This step does not report a percentage."),
            h("span", { "data-ago": feed[0]?.at || "", text: feed[0] ? `Updated ${ago(feed[0].at)}` : "" }))),
        feedList(feed),
        agentLine(agent)
      ];
    }
    return [
      h("div", { class: "hero-top" }, h("p", { class: "eyebrow", text: current ? `Up next · ${label}` : "Review" })),
      h("h2", { id: "hero-title", text: current ? current.label : "Working" }),
      h("p", { class: "lede", text: s?.outcome ? `State: ${s.outcome}. This is not a completed feature. The Adobe host was NOT TESTED.` : "This is not a completed feature. The Adobe host was NOT TESTED." }),
      s?.contract?.goal ? h("p", { class: "lede", text: `Goal: ${s.contract.goal}` }) : null,
      current?.hint ? h("p", { class: "lede", text: current.hint }) : null,
      feed.length ? feedList(feed) : null,
      agentLine(agent)
    ];
  });
}

function timer(since, word) {
  return h("span", { class: "timer", title: `${word} for` }, icon("clock", 2.2), h("span", { "data-since": since || "", text: since ? dur(nowMs() - Date.parse(since)) : "" }));
}

function feedList(feed) {
  return feed.length ? h("ol", { class: "feed", "aria-label": "Latest activity" }, feed.map((entry) => h("li", null, h("i", { class: "bullet" }), h("span", { text: entry.text }), h("time", { datetime: entry.at, "data-ago": entry.at, text: ago(entry.at) })))) : null;
}

function agentLine(agent) {
  if (!agent) return null;
  return h("div", { class: "agent" }, h("span", { class: "pill", "data-tone": agent.tone, "data-live": agent.live ? "true" : "false" }, h("i", { class: "dot" }), agent.label));
}

// ---- stats ---------------------------------------------------------------------------------

function paintStats() {
  const s = session();
  const d = derived();
  const list = visibleSteps().filter((step) => step.status !== "skipped");
  const done = list.filter((step) => step.status === "done").length;
  const audit = s?.audit;
  const outcome = s?.outcome || report().state || "none";
  const commandsRecorded = outcome === "commands-finished" && report().success === true && report().hostExecuted !== true && s?.verification?.hostExecuted !== true;
  const tiles = [
    { tone: commandsRecorded ? "work" : "warn", icon: commandsRecorded ? "info" : "alert", k: "Feature", v: outcome, s: commandsRecorded ? "Commands recorded. Host NOT TESTED." : "Not complete. A missing recipe is not success." },
    { tone: d.errors.length ? "bad" : "work", icon: d.errors.length ? "x" : "info", k: "Code errors", v: d.errors.length, s: d.total ? `${d.fixed.length} of ${d.total} findings fixed` : "An empty scan is not a finished feature." },
    { tone: d.warnings.length || !commandsRecorded ? "warn" : "work", icon: d.warnings.length || !commandsRecorded ? "alert" : "info", k: "Warnings", v: d.warnings.length, s: commandsRecorded ? `${d.patterns.length} review ${plural(d.patterns.length, "pattern")}` : "Not a completed feature." },
    { tone: d.bugsOpen.length ? "bad" : audit ? "ok" : "work", icon: "bug", k: "Panel bugs open", v: audit || d.bugsOpen.length || d.bugsFixed.length ? d.bugsOpen.length : "–", s: audit ? `${d.bugsFixed.length} fixed, ${audit.screens ?? 0} ${plural(audit.screens ?? 0, "screen")} measured` : "Measured at 320px" },
    { tone: "work", icon: "layers", k: "Steps done", v: `${done}/${list.length}`, s: s?.startedAt ? "Running for " : "", since: s?.startedAt }
  ];
  region(el.stats, JSON.stringify(tiles.map((tile) => [tile.v, tile.s, tile.tone])), () => tiles.map((tile) =>
    h("article", { class: "card stat", "data-tone": tile.tone }, h("div", { class: "k" }, icon(tile.icon, 2.6), tile.k), h("div", { class: "v", text: String(tile.v) }),
      h("div", { class: "s" }, tile.since ? [tile.s, h("span", { "data-since": tile.since, text: dur(nowMs() - Date.parse(tile.since)) })] : tile.s))));
}

// ---- the decision sheet ---------------------------------------------------------------------

function paintSheet() {
  const s = session();
  const pending = pendingAsk();
  const answered = (s?.asks || []).filter((ask) => ask.status === "answered").sort((a, b) => Date.parse(b.answeredAt) - Date.parse(a.answeredAt))[0];
  const fresh = !finished() && answered && (!answered.deliveredAt || nowMs() - Date.parse(answered.deliveredAt) < 20000);
  const key = JSON.stringify([pending && `${pending.id}:${pending.nonce}`, !pending && fresh && [answered.id, answered.nonce, answered.deliveredAt], s?.mode]);
  if (painted.get(el.sheet) === key) return;
  painted.set(el.sheet, key);
  if (pending) fill(el.sheet, s.mode === "dashboard" ? turn(pending) : chatTurn(pending));
  else if (fresh) fill(el.sheet, settled(answered));
  else fill(el.sheet);
  if (pending && s.mode === "dashboard") el.sheet.querySelector("input")?.focus({ preventScroll: true });
}

function turn(ask) {
  const k = `${ask.id}:${ask.nonce}`;
  const status = h("span", { class: "error", role: "alert" });
  const submit = h("button", { class: "btn primary", type: "submit", disabled: true, text: "Confirm choice" });
  const secretBox = h("div", { class: "field", hidden: true });
  const secretInput = h("input", { type: "password", id: `secret-${k}`, autocomplete: "off", spellcheck: "false", oninput: (event) => { ui.secret[k] = event.target.value; sync(); } });
  secretBox.append(h("label", { for: `secret-${k}`, id: `secret-label-${k}` }), secretInput, h("small", { text: "Kept in memory on this computer while the review runs. It is never written to a file." }));

  const choose = (id) => { ui.choice[k] = id; sync(); };
  const list = h("fieldset", { class: "choices" }, h("legend", { class: "sr", text: "Choose one option" }),
    ask.options.map((option) => h("label", { class: "choice" },
      h("input", { type: "radio", name: `choice-${k}`, value: option.id, checked: ui.choice[k] === option.id, onchange: () => choose(option.id) }),
      h("span", null,
        h("span", { class: "label", text: clean(option.label) }),
        suggested(option) ? h("span", { class: "tag", text: "Suggested" }) : null,
        option.detail ? h("span", { class: "what", text: option.detail }) : null))));

  function sync() {
    const option = ask.options.find((item) => item.id === ui.choice[k]);
    secretBox.hidden = !option?.requiresSecret;
    if (option?.requiresSecret) secretBox.querySelector("label").textContent = "Secret";
    const missingSecret = Boolean(option?.requiresSecret) && !String(ui.secret[k] || "").trim();
    submit.disabled = !option || missingSecret || Boolean(ui.sending[k]);
    submit.textContent = ui.sending[k] ? "Sending" : "Confirm choice";
    status.textContent = ui.error[k] || "";
  }

  const form = h("form", { onsubmit: async (event) => {
    event.preventDefault();
    ui.sending[k] = true;
    ui.error[k] = "";
    sync();
    try {
      const res = await fetch(api("/api/answer"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: ask.id, value: ui.choice[k], secret: ui.secret[k] || "" }) });
      if (!res.ok) ui.error[k] = (await res.json().catch(() => ({}))).error || "That did not go through.";
    } catch {
      ui.error[k] = "The agent's dashboard stopped answering. Reply in chat instead.";
    }
    ui.sending[k] = false;
    ui.secret[k] = "";
    sync();
    await load();
  } }, list, secretBox,
  h("div", { class: "actions" }, submit, h("span", { class: "hint", text: "The agent carries on the moment you confirm. You can also answer in chat." })), status);

  const s = session();
  const shots = (ask.images || []).map((id) => s.shots.find((shot) => shot.id === id)).filter(Boolean);
  const sheet = h("section", { class: "turn", "aria-labelledby": `turn-title-${k}` },
    h("header", null, h("span", { class: "badge" }, icon("hand", 2.6), "Your turn"), h("h2", { id: `turn-title-${k}`, text: ask.title || ask.id })),
    h("p", { class: "prompt", text: ask.prompt }),
    shots.length ? h("div", { class: "proofs" }, shots.map((shot) => h("figure", null, h("img", { src: fileUrl(shot.file), alt: shot.label, width: shot.width, height: shot.height }), h("figcaption", { text: `${shot.label}, ${shot.width} by ${shot.height}` })))) : null,
    ask.id === "listing-review" && s.listing ? listingBlock(s.listing) : null,
    form,
    ask.affects?.length ? h("details", { class: "will" }, h("summary", { text: `What this touches (${ask.affects.length})` }),
      h("ul", null, ask.affects.map((item) => h("li", null, badge(item.severity), h("code", { text: `${item.file}${item.line ? `:${item.line}` : ""}` }), item.id)))) : null);
  sync();
  return sheet;
}

function chatTurn(ask) {
  return h("section", { class: "turn" }, h("header", null, h("span", { class: "badge" }, icon("hand", 2.6), "Your turn"), h("h2", { text: ask.title || ask.id })),
    h("p", { class: "prompt", text: "This decision is being asked in chat. Answer there." }));
}

function settled(ask) {
  const delivered = Boolean(ask.deliveredAt) || ask.via === "chat";
  return h("div", { class: "settled", role: "status", "data-state": delivered ? "ok" : "sending" },
    delivered ? icon("check", 3) : h("span", { class: "spin" }),
    h("strong", { text: `You chose: ${clean(ask.answerLabel)}` }),
    h("span", { text: `${ask.title || ask.id}. ${ask.via === "chat" ? "Answered in chat." : delivered ? "The agent has it and is carrying on." : "Sent. Waiting for the agent to pick it up."}` }));
}

function listingBlock(listing) {
  const rows = [["Name", listing.name], ["Summary", listing.summary], ["Description", listing.description], ["Keywords", Array.isArray(listing.keywords) ? listing.keywords.join(", ") : listing.keywords]].filter(([, value]) => value);
  return h("dl", { class: "copy-block" }, rows.map(([term, value]) => h("div", null, h("dt", { text: `${term}, ${String(value).length} characters` }), h("dd", { text: value }))));
}

// ---- tabs and panes ---------------------------------------------------------------------------

function paintTabs() {
  const d = derived();
  const s = session();
  const counts = {
    findings: d.errors.length + d.warnings.length + d.patterns.length,
    panel: (s?.notes || []).length,
    listing: (s?.shots || []).filter((shot) => shot.kind === "listing").length,
    activity: s?.log?.length || 0
  };
  for (const [id] of TABS) {
    const { button, count } = tabButtons[id];
    button.setAttribute("aria-selected", String(ui.tab === id));
    button.setAttribute("tabindex", ui.tab === id ? "0" : "-1");
    count.textContent = counts[id] ? String(counts[id]) : "";
    if (id === "panel") count.dataset.tone = d.bugsOpen.length ? "bad" : "";
  }
  el.pane.setAttribute("aria-labelledby", `tab-${ui.tab}`);
}

function paintPane() {
  const s = session();
  const keys = {
    findings: [report().findings, ui.filter, session()?.baseline?.length],
    panel: [s?.notes, s?.audit, report().views, ui.copied],
    listing: [s?.listing, (s?.shots || []).filter((shot) => shot.kind === "listing")],
    activity: [s?.log, s?.steps?.map((step) => step.label)]
  };
  const view = { findings: findingsPane, panel: panelPane, listing: listingPane, activity: activityPane }[ui.tab] || findingsPane;
  region(el.pane, `${ui.tab}|${JSON.stringify(keys[ui.tab] || "")}`, () => [view()]);
}

function findingsPane() {
  const d = derived();
  const all = [...d.errors, ...d.warnings, ...d.patterns];
  const sets = { all, error: d.errors, warn: d.warnings, pattern: d.patterns, fixed: d.fixed };
  const chip = (id, label) => h("button", { class: "chip", type: "button", "data-fid": `chip-${id}`, "aria-pressed": String(ui.filter === id), onclick: () => { ui.filter = id; paintPane(); } }, `${label} ${sets[id].length}`);
  const rows = sets[ui.filter] || all;
  return h("div", null,
    h("div", { class: "chips", role: "group", "aria-label": "Filter findings" }, chip("all", "All"), chip("error", "Errors"), chip("warn", "Warnings"), chip("pattern", "Patterns"), d.fixed.length ? chip("fixed", "Fixed") : null),
    rows.length ? h("ul", { class: "list" }, rows.map((row) => ui.filter === "fixed" ? fixedRow(row) : findingRow(row))) : h("p", { class: "empty", text: ui.filter === "fixed" ? "Nothing fixed yet." : "None found." }));
}

function findingRow(finding) {
  return h("li", { class: "finding" },
    badge(finding.severity),
    h("div", null,
      h("p", { class: "msg", text: finding.message || finding.id }),
      h("p", { class: "where", text: `${finding.id}  ${finding.file}${finding.line ? `:${finding.line}` : ""}` }),
      finding.suggestion ? h("details", null, h("summary", { text: "Suggested edit" }), h("pre", { text: finding.suggestion })) : null),
    finding.url ? h("a", { class: "ext", href: finding.url, target: "_blank", rel: "noopener", text: finding.origin === "review-pattern" ? "Source" : "Guideline" }) : h("span"));
}

function fixedRow(entry) {
  return h("li", { class: "finding" }, badge("fixed"), h("div", null, h("p", { class: "msg", text: entry.id }), h("p", { class: "where", text: entry.file })), h("span"));
}

function panelPane() {
  const s = session();
  const d = derived();
  const notes = [...(s?.notes || [])].sort((a, b) => rankNote(a) - rankNote(b));
  const views = report().views || [];
  const audit = s?.audit;
  const walking = steps().find((step) => step.id === "panel")?.status === "running" && !audit;
  const head = notes.length || audit
    ? h("div", { class: "bugs-head" },
      h("p", null, h("b", { text: `${d.bugsOpen.length} open` }), `, ${d.bugsFixed.length} fixed`, audit ? `. ${audit.screens ?? 0} ${plural(audit.screens ?? 0, "screen")} measured at 320px in light and dark.` : "."),
      h("span", { class: "hint", text: "Bugs the walk measured are fixed without asking. Warnings are offered to you." }))
    : null;
  return h("div", null, head,
    notes.length ? h("ul", { class: "list" }, notes.map(bugCard))
      : audit ? h("p", { class: "empty", text: "Nothing to fix. Every screen the walk reached passed the measurements." })
      : h("p", { class: "empty", text: walking ? "The walk is running. Problems it measures appear here as it finds them." : "No panel problems recorded yet. They appear here while the panel is walked." }),
    views.length ? h("div", { class: "views" }, h("h3", { text: `Screens named in the code (${views.length})` }),
      h("ul", null, views.slice(0, 12).map((view) => h("li", null, h("b", { text: view.name }), `  ${view.kind}, ${view.file}${view.line ? `:${view.line}` : ""}`)))) : null);
}

const rankNote = (note) => (note.status === "open" ? (note.severity === "error" ? 0 : 1) : note.status === "fixed" ? 2 : 3);

function bugCard(note) {
  const [message, fix] = String(note.text).split(" Fix: ");
  const where = note.source ? `${note.source.file}:${note.source.line}` : "";
  const first = note.status === "open"
    ? note.severity === "error" ? badge("error", "Bug") : note.severity === "warn" ? badge("warn", "Warning") : badge("open", "Open")
    : note.status === "fixed" ? badge("fixed", "Confirmed fixed") : badge("open", "Skipped");
  return h("li", { class: "bug", "data-status": note.status },
    h("div", null,
      h("div", { class: "bug-top" },
        first,
        note.rule ? h("span", { class: "sev", text: note.rule }) : null,
        (note.themes || []).map((theme) => h("span", { class: "sev", text: cap(theme) }))),
      note.screen ? h("p", { class: "screen", text: note.screen }) : null,
      h("p", { class: "text", text: message }),
      fix ? h("p", { class: "how" }, h("b", { text: "Fix: " }), fix) : null,
      where ? h("div", { class: "src" }, h("span", { text: where }), h("button", { type: "button", "data-fid": `copy-${note.id}`, onclick: () => copyText(where, note.id) }, ui.copied === note.id ? "Copied" : "Copy")) : null),
    note.shot ? h("button", { class: "thumb", type: "button", "aria-label": `Open the capture for ${note.screen || "this problem"}`, onclick: () => openBox(note.shot, note.screen || "Capture") }, h("img", { src: fileUrl(note.shot), alt: "" }), h("span", { class: "zoom" }, icon("zoom", 2.4))) : null);
}

function listingPane() {
  const s = session();
  const shots = (s?.shots || []).filter((shot) => shot.kind === "listing");
  if (!s?.listing && !shots.length) return h("p", { class: "empty", text: "No package artifact yet. A CCX hash shows here after the package step. This page is not the Adobe host." });
  return h("div", null, s.listing ? listingBlock(s.listing) : null,
    shots.length ? h("div", { class: "shots" }, shots.map((shot) => h("figure", null, h("img", { src: fileUrl(shot.file), alt: shot.label, width: shot.width, height: shot.height }), h("figcaption", { text: `${shot.label}, ${shot.width} by ${shot.height}` })))) : null);
}

function activityPane() {
  const log = [...(session()?.log || [])].reverse();
  const labels = Object.fromEntries(steps().map((step) => [step.id, step.label]));
  return log.length ? h("ol", { class: "list log" }, log.map((entry) => h("li", null,
    h("time", { datetime: entry.at, text: new Date(entry.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) }),
    h("span", { class: "st", text: labels[entry.step] || "" }), h("span", { text: entry.text })))) : h("p", { class: "empty", text: "Nothing yet." });
}

// ---- the 320px column -------------------------------------------------------------------------

function paintStrip() {
  const s = session();
  const all = (s?.shots || []).filter((shot) => shot.kind === "panel");
  const hasThemes = all.some((shot) => shot.theme);
  const shots = ui.shotTheme === "all" || !hasThemes ? all : all.filter((shot) => shot.theme === ui.shotTheme);
  const current = shots.find((shot) => shot.id === ui.pickedShot) || shots[shots.length - 1];
  const walking = steps().find((step) => step.id === "panel")?.status === "running";
  const key = JSON.stringify([shots.map((shot) => shot.id), current?.id, ui.shotTheme, walking]);
  region(el.strip, key, () => [
    h("div", { class: "strip-head" },
      h("h2", { text: "Panel at 320px" }),
      hasThemes ? h("div", { class: "seg", role: "group", "aria-label": "Theme" }, ["all", "light", "dark"].map((id) => h("button", { type: "button", "data-fid": `theme-${id}`, "aria-pressed": String(ui.shotTheme === id), onclick: () => { ui.shotTheme = id; ui.pickedShot = null; paintStrip(); } }, id === "all" ? "All" : cap(id)))) : null),
    h("p", { class: "cap", text: current ? current.label : walking ? "Opening the panel…" : "Captures appear as each screen is walked." }),
    current
      ? h("div", { class: "device" }, h("div", { class: "screen", tabindex: "0", role: "region", "aria-label": `Capture: ${current.label}` }, h("img", { src: fileUrl(current.file), alt: current.label })))
      : h("div", { class: `device blank` }, h("div", { class: "screen" }, walking ? [h("div", { class: "skeleton" }), h("div", { class: "skeleton" }), h("div", { class: "skeleton" }), h("p", { text: "Starting the browser and opening the panel." })] : h("p", { text: "No capture yet." }))),
    shots.length > 1 ? h("div", { class: "film", role: "group", "aria-label": "Captures" }, shots.map((shot) => h("button", { type: "button", "data-fid": `shot-${shot.id}`, "aria-label": shot.label, "aria-current": String(shot.id === current.id), onclick: () => { ui.pickedShot = shot.id; paintStrip(); } }, h("img", { src: fileUrl(shot.file), alt: "" })))) : null
  ]);
}

function openBox(file, title) {
  fill(el.box,
    h("header", null, h("h2", { id: "lightbox-title", text: title }), h("button", { class: "btn small", type: "button", "aria-label": "Close", onclick: () => el.box.close() }, icon("x", 2.6), "Close")),
    h("div", { class: "body" }, h("img", { src: fileUrl(file), alt: title })));
  el.box.showModal();
}

// ---- tab title and icon -------------------------------------------------------------------------

function faviconFor(tone) {
  const dot = { wait: "#F59E0B", ok: "#10B981", work: "#A78BFA" }[tone];
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' rx='9' fill='#4F46E5'/><path d='M9 16.5l4.5 4.5L23 11' fill='none' stroke='white' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'/>${dot ? `<circle cx='25' cy='7' r='6' fill='${dot}' stroke='white' stroke-width='2'/>` : ""}</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function paintTitle() {
  const s = session();
  const name = s?.addon?.name || "UXP plugin";
  const pending = s?.mode === "dashboard" && pendingAsk();
  const running = steps().find((step) => step.status === "running");
  const p = running?.progress;
  let title = `${name} session`;
  let tone = "idle";
  if (finished()) { title = `Done · ${name}`; tone = "ok"; }
  else if (pending) { title = `Your turn · ${name}`; tone = "wait"; }
  else if (running) { title = `${p?.total ? `${Math.min(p.done, p.total)}/${p.total} · ` : ""}${running.label} · ${name}`; tone = "work"; }
  if (document.title !== title) document.title = title;
  const link = document.getElementById("favicon");
  if (link && link.dataset.tone !== tone) {
    link.dataset.tone = tone;
    link.href = faviconFor(tone);
  }
}

// ---- time keeps moving between updates -----------------------------------------------------------

setInterval(() => {
  for (const node of document.querySelectorAll("[data-since]")) {
    if (node.dataset.since) node.textContent = dur(nowMs() - Date.parse(node.dataset.since));
  }
  for (const node of document.querySelectorAll("[data-ago]")) {
    if (!node.dataset.ago) continue;
    node.textContent = node.tagName === "TIME" ? ago(node.dataset.ago) : `Updated ${ago(node.dataset.ago)}`;
  }
  if (state) { paintAlert(); paintSheet(); paintHeroAgent(); }
}, 1000);

/** The agent pill is the one hero part that changes with the clock alone. */
function paintHeroAgent() {
  const agent = agentState();
  const pill = el.hero.querySelector(".agent .pill");
  if (!pill || !agent) return;
  pill.dataset.tone = agent.tone;
  pill.dataset.live = agent.live ? "true" : "false";
  const text = pill.lastChild;
  if (text && text.textContent !== agent.label) text.textContent = agent.label;
}

// ---- live connection ------------------------------------------------------------------------------

function connect() {
  const events = new EventSource(api("/api/events"));
  events.addEventListener("state", () => { ui.conn = "live"; clearTimeout(downTimer); load(); });
  events.onopen = () => { ui.conn = "live"; clearTimeout(downTimer); };
  events.onerror = () => {
    ui.conn = "retry";
    clearTimeout(downTimer);
    downTimer = setTimeout(() => { ui.conn = "down"; paintTop(); }, 20000);
    paintTop();
  };
}

// First paint is a skeleton the user can see at once, then real data.
fill(el.hero, h("div", { class: "skeleton" }), h("p", { class: "lede", text: "Loading the session." }));
paintTop();
load();
connect();
// A review in progress still moves when the server sends nothing, because the agent's clock is the server's.
setInterval(() => { if (ui.conn === "live") load(); }, 15000);
