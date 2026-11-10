import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { auditProject, authoredFiles, changedSinceBaseline, snapshotSource, testFiles } from "./audit.mjs";
import { applyAnswers, detectHost, folderIsEmpty, hostLabel, namedPermissions, slugify } from "./intent.mjs";
import { buildLibrary, findInLibrary, HOSTS, libraryFiles } from "./library.mjs";
import { runPackage } from "./package-project.mjs";
import { narrowRequiredPermissions } from "./permissions.mjs";
import { designSection } from "./design.mjs";
import { applyPlanning, blockedGoalQuestion, blockedQuestion, buildWays, featureLines, goalIsThin, hardBlocks, panelGuide } from "./planning.mjs";
import { patchReactBundles, prepareStarter } from "./starter.mjs";
import { BOLT_FRAMEWORKS, findApp } from "./stack.mjs";
import { typecheck } from "./typecheck.mjs";
import { addNote, mutate, readMerged, recordDocs, setNoteStatus, setStep } from "../runtime/lib/session.mjs";

/**
 * The three commands that do the work: docs, build, check.
 * Each reads the plan from the session folder, so none of them asks the assistant to repeat a fact.
 */

export const planFile = (out) => path.join(out, "plan.json");
export const docsDir = (out) => path.join(out, "docs");
export const briefFile = (out) => path.join(out, "BRIEF.md");
const baselineFile = (out) => path.join(out, "baseline.json");

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

export function writePlan(out, plan) {
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(planFile(out), `${JSON.stringify(plan, null, 2)}\n`);
  return plan;
}

function answersOf(out) {
  const session = readMerged(out);
  const answers = {};
  for (const ask of session?.asks || []) if (ask.status === "answered") answers[ask.id] = ask.answer;
  return answers;
}

/** The words a developer types on the "change something" card, read into plan fields. */
export function parseTweak(text, plan) {
  const value = String(text || "");
  const changes = {};
  const host = detectHost(value);
  if (host) changes.host = host;
  const framework = (value.match(/\b(react|vue|svelte)\b/i) || [])[1];
  if (framework) changes.framework = framework.toLowerCase();
  if (/\bweb\s?view\b/i.test(value)) changes.runtime = "webview";
  const quoted = value.match(/["“']([^"”']{2,60})["”']/);
  const called = value.match(/\b(?:called|named|name it|name:|rename (?:it )?(?:to)?)\s+([A-Za-z0-9][A-Za-z0-9 _-]{1,40}?)(?=$|[,.;]|\s+(?:and|with|use|using|for|in|needs?)\b)/i);
  const name = (quoted && quoted[1]) || (called && called[1]);
  if (name) changes.name = name.trim();
  const id = value.match(/\b(com\.[a-z0-9_-]+(?:\.[a-z0-9_-]+)+)\b/i);
  if (id) changes.id = id[1];
  const named = namedPermissions(value);
  if (named.length) changes.permissions = [...new Set([...(plan.permissions || []), ...named])].join(",");
  else if (/\b(?:no|without)\s+(?:extra\s+)?permissions?\b/i.test(value)) changes.permissions = "none";
  const folder = value.match(/(?:\bin(?:to)?|\bunder|\bat)\s+((?:~|\/)[^\s,;"']+)/i);
  if (folder) changes.folder = folder[1].replace(/^~/, process.env.HOME || "~");
  return changes;
}

/**
 * plan.json plus the answers the developer gave and the flags the assistant passed.
 * Saved back, so every later command reads one plan.
 */
export function resolvePlan(out, overrides = {}) {
  const base = readJson(planFile(out));
  if (!base) throw new Error(`No plan in ${out}. Run start first.`);
  const answers = answersOf(out);
  let plan = { ...base };
  plan = applyPlanning(plan, answers);
  if (answers.host) plan = applyAnswers(plan, { host: answers.host });
  if (answers.tweak && plan.tweakApplied !== answers.tweak) {
    const changes = parseTweak(answers.tweak, plan);
    const { folder, ...fields } = changes;
    plan = applyAnswers(plan, fields);
    if (folder && plan.kind === "empty") {
    plan.input = folder;
    plan.inPlace = folderIsEmpty(folder);
  }
    if (fields.name && !fields.id) plan.id = `com.example.${slugify(fields.name).replace(/-/g, "")}`;
    plan.tweakApplied = answers.tweak;
  }
  const flags = {};
  for (const key of ["host", "framework", "name", "id", "runtime", "permissions"]) {
    if (overrides[key] !== undefined && overrides[key] !== true) flags[key] = String(overrides[key]);
  }
  if (Object.keys(flags).length) plan = applyAnswers(plan, flags);
  if (overrides.folder && typeof overrides.folder === "string" && plan.kind === "empty") plan.input = path.resolve(overrides.folder);
  writePlan(out, plan);
  return plan;
}

export function projectPath(plan) {
  if (plan.kind === "existing") return plan.project || plan.input;
  if (plan.inPlace) return plan.input;
  return path.join(plan.input, slugify(plan.name));
}

export function planSummary(plan) {
  const permissions = plan.permissions.length
    ? plan.permissions.join(", ")
    : "none named in the request. The starter's broad access is removed; add one only when the code needs it.";
  const ui = plan.runtime === "webview" ? "WebView" : plan.runtime === "native" ? "Native UXP" : "not chosen yet";
  const widgets = plan.widgets === "html" ? "plain HTML" : plan.widgets === "spectrum" ? "Spectrum" : "not chosen yet";
  const ready = !goalIsThin(plan.goal);
  return [
    ready
      ? "Nothing is created until you choose Build it. This is the spec, including anything already said in chat."
      : "This is not ready to build. The job has not been described.",
    ready ? `${hostLabel(plan.host)} panel "${plan.name}"` : `Name: ${plan.name || "not chosen"}`,
    `Goal: ${plan.goal || "not described yet"}`,
    plan.description && plan.description !== plan.goal ? `Description: ${plan.description}` : "",
    `Plugin id: ${plan.id}`,
    plan.kind === "existing" ? `Project: ${plan.project || plan.input} (your existing plugin)` : `Stack: ${stackLabel(plan)}`,
    `UI: ${ui}. Controls: ${widgets}.`,
    plan.design ? `Look: ${plan.design}` : "",
    ...featureLines(plan),
    `Permissions: ${permissions}`,
    plan.kind === "existing" ? "" : `Folder: ${projectPath(plan)}${plan.inPlace ? " (this folder, not a subfolder)" : ""}`,
    `Steps after you confirm: save Adobe's current ${hostLabel(plan.host)} docs, ${plan.kind === "existing" ? "read the project" : "scaffold the project"}, write the plugin, build and package it.`
  ].filter(Boolean).join("\n");
}

function stackLabel(plan) {
  const framework = BOLT_FRAMEWORKS.find((item) => item.id === plan.framework)?.label || plan.framework;
  return `${framework}, ${plan.runtime === "webview" ? "WebView" : "native"} panel (create-bolt-uxp 1.3.27)`;
}

/* ---------------------------------------------------------------- docs */

export async function runDocs(out, { fetchImpl, skip = false, overrides = {} } = {}) {
  const plan = resolvePlan(out, overrides);
  if (goalIsThin(plan.goal)) {
    throw new Error("The request does not say what the plugin should do. Wait for the goal answer. Do not invent one.");
  }
  if (!plan.host) {
    throw new Error("The Adobe app is not known. Run: node scripts/skill.mjs docs --host ppro|phxs|idsn|ame|ilst|aeft");
  }
  const label = hostLabel(plan.host);
  if (skip) {
    setStep(out, "docs", "skipped", "Skipped. The plugin is built without saved docs.");
    return { ok: true, skipped: true, host: plan.host, warning: "No docs were saved. Say so in the summary and name every API you could not verify." };
  }
  setStep(out, "docs", "running", `Saving ${label} docs`, { doing: "Reading Adobe's page list" });
  const dir = docsDir(out);
  let last = 0;
  const summary = await buildLibrary({
    host: plan.host,
    dir,
    fetchImpl,
    onProgress: ({ done, total, page }) => {
      const stamp = Date.now();
      if (stamp - last < 600 && done < total) return;
      last = stamp;
      setStep(out, "docs", "running", undefined, { doing: page, progress: { done, total }, silent: true });
    }
  });
  if (!summary.ok) {
    setStep(out, "docs", "pending", `Could not save the docs: ${summary.error || "too many pages failed"}.`);
    return {
      ok: false,
      host: plan.host,
      error: summary.error || "Too many pages failed.",
      fresh: summary.fresh.length,
      failed: summary.failed.length,
      next: "Check the network and run the same docs command again. If it still fails after two tries, run it with --skip and say in the summary that the docs were not saved."
    };
  }
  recordDocs(out, {
    ok: true,
    fresh: summary.fresh,
    stale: summary.stale,
    failed: summary.failed,
    pages: summary.pages.filter((page) => page.freshness !== "fresh" && page.freshness !== "empty"),
    retrievedAt: summary.fetchedAt,
    sha: crypto.createHash("sha256").update(JSON.stringify(summary.pages.map((page) => [page.id, page.bytes]))).digest("hex").slice(0, 16)
  });
  const types = path.join(dir, "api");
  return {
    ok: true,
    host: plan.host,
    label,
    saved: dir,
    pages: { fresh: summary.fresh.length, stale: summary.stale.length, failed: summary.failed.length },
    complete: summary.complete,
    files: {
      index: path.join(dir, "INDEX.md"),
      limits: path.join(dir, "LIMITS.md"),
      ...(fs.existsSync(types) && fs.readdirSync(types).length ? { types: path.join(types, fs.readdirSync(types)[0]) } : {})
    },
    ...(summary.stale.length || summary.failed.length ? { warning: `${summary.stale.length} stale and ${summary.failed.length} failed pages. Stale pages are older copies; check them against the types before you rely on them.` } : {})
  };
}

/* --------------------------------------------------------------- build */

/** The scaffold tool prints a banner. Keep stdout to the one JSON line the command ends with. */
async function quiet(work) {
  const write = process.stdout.write;
  process.stdout.write = () => true;
  try {
    return await work();
  } finally {
    process.stdout.write = write;
  }
}

/** Where create-bolt-uxp writes. An empty folder gets a temp child that is then moved up. */
function scaffoldPlace(plan) {
  if (!plan.inPlace) return { parent: plan.input, folderName: slugify(plan.name), hoist: false };
  return { parent: projectPath(plan), folderName: ".uxp-scaffold", hoist: true };
}

function hoistScaffold(from, dest) {
  if (!fs.existsSync(from)) return;
  for (const name of fs.readdirSync(from)) {
    const target = path.join(dest, name);
    if (fs.existsSync(target)) throw new Error(`${target} already exists, so the scaffold was not moved up.`);
    fs.renameSync(path.join(from, name), target);
  }
  fs.rmdirSync(from);
}

/** A goal UXP cannot build. Returns a result for the command, or null to continue. */
function unsupported(out, plan) {
  const hits = hardBlocks(plan);
  if (!hits.length) return null;
  const answers = answersOf(out);
  if (answers.blocked === "stop") {
    return { ok: false, blocked: hits, next: "The user chose to stop. Run session done --stopped and tell them nothing was built." };
  }
  if (!answers.blocked) return { ok: false, blocked: hits, ask: blockedQuestion(hits) };
  if (answers.blocked === "change" && !String(answers.blockedGoal || "").trim()) {
    return { ok: false, blocked: hits, ask: blockedGoalQuestion() };
  }
  const still = hardBlocks({ ...plan, goal: answers.blockedGoal || plan.goal });
  if (still.length) {
    return {
      ok: false,
      blocked: still,
      error: "The new goal is still not supported.",
      next: `Still not supported: ${still.join(" ")} Stop with session done --stopped, or change the goal to something UXP can do and run build again.`
    };
  }
  return null;
}

function run(command, args, options) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key === "NODE_CHANNEL_FD" || key.startsWith("NODE_TEST_")) delete env[key];
  return spawnSync(command, args, { encoding: "utf8", env, ...options });
}

export async function runBuild(out, { overrides = {}, scaffoldImpl, installImpl, onActivity } = {}) {
  const plan = resolvePlan(out, overrides);
  const session = readMerged(out);
  const docsStep = session.steps.find((step) => step.id === "docs");
  if (docsStep && docsStep.status !== "done" && docsStep.status !== "skipped") {
    throw new Error("The docs are not saved yet. Run: node scripts/skill.mjs docs");
  }
  if (goalIsThin(plan.goal)) throw new Error("The request does not say what the plugin should do. Wait for the goal answer. Do not invent one.");
  if (!plan.host) throw new Error("The Adobe app is not known. Run docs with --host first.");
  const activity = (text) => {
    setStep(out, "build", "running", undefined, { doing: text, silent: true });
    if (typeof onActivity === "function") onActivity(text);
  };
  const blocked = unsupported(out, plan);
  if (blocked) return blocked;
  setStep(out, "build", "running", plan.kind === "existing" ? "Reading the project" : "Creating the project", { doing: "Starting" });
  const project = projectPath(plan);
  const steps = [];

  if (plan.kind === "existing") {
    if (!fs.existsSync(path.join(project, "package.json")) && !fs.existsSync(path.join(project, "manifest.json"))) {
      setStep(out, "build", "pending", `No plugin found in ${project}.`);
      throw new Error(`${project} has no package.json or manifest.json. Pass the folder of the plugin with --project.`);
    }
    steps.push("Read the existing project. Nothing was changed.");
  } else {
    if (fs.existsSync(path.join(project, "uxp.config.ts"))) {
      steps.push("The project was already created. It was kept.");
    } else {
      const place = scaffoldPlace(plan);
      fs.mkdirSync(place.parent, { recursive: true });
      activity("Creating the project with create-bolt-uxp (the first run installs it, about 20 seconds)");
      const scaffold = await quiet(async () => (scaffoldImpl
        ? scaffoldImpl(place.parent, plan)
        : (await import("./scaffold.mjs")).scaffoldWithInstaller(place.parent, {
          folderName: place.folderName,
          displayName: plan.name,
          id: plan.id,
          framework: plan.framework,
          app: plan.host,
          installDeps: false,
          webview: plan.runtime === "webview",
          hybrid: false,
          onActivity: activity
        })));
      if (place.hoist) hoistScaffold(path.join(place.parent, place.folderName), place.parent);
      steps.push(`Created ${scaffold.folder && !place.hoist ? scaffold.folder : project}.`);
      const config = path.join(project, "uxp.config.ts");
      const narrowed = narrowRequiredPermissions(fs.readFileSync(config, "utf8"), { runtime: plan.runtime, requested: plan.permissions });
      if (narrowed.ok) {
        fs.writeFileSync(config, narrowed.source);
        steps.push(`Narrowed requiredPermissions to ${narrowed.kept.length ? narrowed.kept.join(", ") : "none"} (the starter asks for full file access, network, clipboard, and a WebView).`);
      }
    }
    steps.push(...prepareStarter(project, { framework: plan.framework, runtime: plan.runtime || "native" }));
    if (!fs.existsSync(path.join(project, "node_modules"))) {
      activity("Installing the project's dependencies");
      const install = installImpl
        ? installImpl(project)
        : run(process.platform === "win32" ? "npm.cmd" : "npm", ["install", "--no-fund", "--no-audit"], { cwd: project, timeout: 10 * 60 * 1000 });
      if (install.status !== 0) {
        setStep(out, "build", "pending", "npm install failed.");
        return {
          ok: false,
          project,
          error: `npm install failed (${install.status}).`,
          output: `${install.stdout || ""}\n${install.stderr || ""}`.trim().slice(-1200),
          next: `Fix the error above (usually the network), then run node scripts/skill.mjs build again. The project in ${project} is kept.`
        };
      }
      steps.push("Installed dependencies.");
    }
    const webviewUi = path.join(project, "webview-ui");
    if (fs.existsSync(path.join(webviewUi, "package.json")) && !fs.existsSync(path.join(webviewUi, "node_modules"))) {
      activity("Installing the WebView UI dependencies");
      const uiInstall = installImpl
        ? installImpl(webviewUi)
        : run(process.platform === "win32" ? "npm.cmd" : "npm", ["install", "--no-fund", "--no-audit"], { cwd: webviewUi, timeout: 10 * 60 * 1000 });
      if (uiInstall.status !== 0) {
        setStep(out, "build", "pending", "The WebView UI install failed.");
        return {
          ok: false,
          project,
          error: `npm install in webview-ui failed (${uiInstall.status}).`,
          output: `${uiInstall.stdout || ""}\n${uiInstall.stderr || ""}`.trim().slice(-1200),
          next: `Fix the error above, then run node scripts/skill.mjs build again. The project in ${project} is kept.`
        };
      }
      steps.push("Installed the WebView UI dependencies.");
    }
    if (!installImpl) {
      activity("Building the empty starter to prove the toolchain works");
      const starter = runPackage(project, { only: ["build"] });
      if (starter.status === "failed") {
        setStep(out, "build", "pending", "The starter does not build.");
        return { ok: false, project, error: "The starter did not build.", output: starter.output || starter.reason, next: "Read the error, fix the project, and run build again." };
      }
      steps.push("The starter builds.");
    }
  }

  if (!fs.existsSync(baselineFile(out))) fs.writeFileSync(baselineFile(out), `${JSON.stringify(snapshotSource(project), null, 1)}\n`);
  mutate(out, (draft) => {
    draft.addon = { ...draft.addon, name: plan.name, path: project };
  });
  const brief = writeBrief(out, plan, project);
  setStep(out, "build", "done", `Project: ${project}`);
  setStep(out, "implement", "running", "Writing the plugin", { doing: "The assistant is writing the code" });
  return { ok: true, project, host: plan.host, brief, steps };
}

/* --------------------------------------------------------------- brief */

const UI_SECTIONS = /^##\s+(user interface|html elements|css|layout|dom|spectrum uxp components)\b/i;
const UI_RELEVANT = /canvas|svg|<img>|image|\binput\b|\bform|select|\bcss\b|layout|z-index|textarea|label|button|dialog|sp-|flex|scroll|font/i;

function limitBullets(libDir, goalText) {
  const bullets = [];
  const issuePages = libraryFiles(libDir).filter((rel) => /^pages\/(?:[^/]+\/)*uxp-api\/known-issues\.md$|^pages\/uxp-api\/known-issues\.md$|^pages\/reference\/uxp-api\/known-issues\.md$/.test(rel));
  for (const rel of issuePages) {
    try {
      const text = fs.readFileSync(path.join(libDir, rel), "utf8");
      let inside = false;
      for (const line of text.split("\n")) {
        if (/^##\s/.test(line)) inside = UI_SECTIONS.test(line);
        else if (inside && /^-\s/.test(line) && UI_RELEVANT.test(line)) {
          const first = line.replace(/^-\s*/, "").replace(/\s*\([A-Z]+-\d+\)/g, "").split(/(?<=[.!?])\s/)[0];
          const text1 = first.length > 190 ? `${first.slice(0, 187)}...` : first;
          if (!bullets.includes(text1)) bullets.push(text1);
        }
      }
    } catch {
      // Not saved for this host.
    }
  }
  const wanted = TOPICS.filter((topic) => topic.when.test(goalText) && topic.limits).map((topic) => topic.limits);
  const ranked = bullets
    .map((text, index) => ({ text, index, score: wanted.some((rule) => rule.test(text)) ? 1 : 0 }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((item) => `- ${item.text}`);
  return [...findCanvasLines(libDir, goalText), ...ranked].slice(0, 15);
}

function findCanvasLines(libDir, goalText) {
  const lines = [];
  if (!TOPICS[0].when.test(goalText)) return lines;
  for (const rel of ["pages/uxp-api/reference-js/global-members/html-elements/html-canvas-element.md"]) {
    try {
      for (const line of fs.readFileSync(path.join(libDir, rel), "utf8").split("\n")) {
        if (/supports only|only '2d'|not supported/i.test(line)) lines.push(`- Canvas: ${line.replace(/^[-\s]+/, "").replace(/<br><\/br>\s*/g, "").slice(0, 190)}`);
      }
    } catch {
      // Not saved for this host.
    }
  }
  const out = lines.slice(0, 2);
  // Adobe's canvas pages say nothing about exporting pixels. Say that only when the saved pages really lack it.
  try {
    const pages = ["pages/uxp-api/reference-js/global-members/html-elements/html-canvas-element.md", "pages/uxp-api/reference-js/global-members/html-dom/canvas-rendering-context2-d.md"]
      .filter((rel) => fs.existsSync(path.join(libDir, rel)))
      .map((rel) => fs.readFileSync(path.join(libDir, rel), "utf8"));
    if (pages.length && !pages.some((text) => /todataurl|toblob|getimagedata|convertToBlob/i.test(text))) {
      out.push("- Canvas: the saved canvas pages document no toDataURL, toBlob, or getImageData. To make an image file, encode the bytes yourself (PNG or SVG) and write them with `uxp.storage.localFileSystem`.");
    }
  } catch {
    // Not saved for this host.
  }
  return out;
}

/** What a request usually needs besides the host API. Each topic points at pages to read when it applies. */
const TOPICS = [
  { when: /\bqr\b|barcode|image|png|jpe?g|picture|graphic|draw|canvas|chart|thumbnail|render|generate/i, label: "drawing and writing an image", limits: /canvas|svg|<img>|image|grayscale|getFileForSaving|file picker|save/i, queries: ["HTMLCanvasElement canvas 2d context", "localFileSystem getTemporaryFolder createFile write binary", { q: "importFiles project insert", hosts: ["ppro"] }] },
  { when: /import|insert|add .*(project|timeline|sequence)|place|footage|media|asset|clip/i, label: "putting files into the project", queries: ["importFiles project insert", "ProjectItem FolderItem"], hosts: ["ppro"] },
  { when: /save|export|write|file|folder|disk|download|csv|json|srt|text file/i, label: "files and folders", limits: /getFileForSaving|file picker|picker|save|`input`|type="file"/i, queries: ["filesystem operations permissions getFileForSaving", "localFileSystem"] },
  { when: /sequence|timeline|track|playhead|in point|out point/i, label: "sequences", queries: ["Sequence videoTracks getActiveSequence", "TrackItem"], hosts: ["ppro"] },
  { when: /marker/i, label: "markers", queries: ["Markers createMarker"], hosts: ["ppro"] },
  { when: /layer|document|selection|filter|smart object/i, label: "documents and layers", pages: ["ps-reference/classes/layer", "ps-reference/classes/layers", "ps-reference/classes/document", "ps-reference/classes/photoshop"], queries: ["batchPlay descriptor"], hosts: ["phxs"] },
  { when: /http|api|network|fetch|upload|server|url|online/i, label: "network", queries: ["network fetch domains permissions"] },
  { when: /clipboard|copy/i, label: "clipboard", queries: ["clipboard permissions"] },
  { when: /./, label: "building the panel UI", limits: /sp-|dropdown|button|textfield|label|form|select|option|input|width|css|z-index/i, queries: ["Spectrum UXP components sp-button sp-textfield", "theme aware host colors css"] }
];

function pointers(lib, plan, seen) {
  const rows = [];
  const text = `${plan.goal} ${plan.name}`;
  for (const topic of TOPICS) {
    if (!topic.when.test(text) || (topic.hosts && !topic.hosts.includes(plan.host))) continue;
    const found = [];
    for (const id of topic.pages || []) {
      const rel = `pages/${id}.md`;
      if (!seen.has(rel) && fs.existsSync(path.join(lib, rel))) found.push(rel);
    }
    for (const entry of topic.queries) {
      const query = typeof entry === "string" ? entry : entry.q;
      if (typeof entry !== "string" && entry.hosts && !entry.hosts.includes(plan.host)) continue;
      let taken = 0;
      for (const hit of findInLibrary(lib, query, { limit: 4, lines: 0 }).results) {
        if (hit.file.startsWith("api/") || seen.has(hit.file) || found.includes(hit.file)) continue;
        found.push(hit.file);
        taken += 1;
        if (taken >= 2) break;
      }
    }
    for (const file of found) seen.add(file);
    if (found.length) rows.push(`- ${topic.label}: ${found.join(", ")}`);
  }
  return rows;
}

const CORE_WHY = {
  "plugins/concepts/manifest": "manifest fields and requiredPermissions",
  "plugins/concepts/entrypoints": "panel and command entrypoints",
  "introduction": "overview",
  "uxp-api/known-issues": "every known issue",
  "resources/fundamentals/user-interfaces": "UI basics",
  "guides/uxp_guide/uxp-misc/manifest-v5": "manifest fields and requiredPermissions",
  "ps_reference/classes/photoshop": "the Photoshop module"
};

export function writeBrief(out, plan, project) {
  const lib = docsDir(out);
  const have = fs.existsSync(path.join(lib, "library.json"));
  const label = hostLabel(plan.host);
  const fresh = plan.kind !== "existing";
  const lines = [
    `# Brief: ${plan.name} (${label})`,
    "",
    `Goal, as the developer typed it: ${plan.goal}`,
    "",
    "## The plan (already decided; do not ask again)",
    `- Adobe app: ${label}. Panel entrypoint. Plugin id ${plan.id}.`,
    `- Stack: ${plan.kind === "existing" ? "the existing project" : stackLabel(plan)}.`,
    `- Project: ${project}`,
    `- requiredPermissions: ${plan.permissions.length ? plan.permissions.join(", ") : "none by default"}. Add one only when the code needs it, with the narrowest value the manifest page allows. Files under plugin:/, plugin-data:/ and plugin-temp:/ need none.`,
    have ? `- Adobe's docs, saved on this computer: ${lib}  (every path below that does not start with / is inside this folder)` : "- No docs were saved. Name every API you could not verify.",
    "",
    "## Do this, in order",
    "1. Read the files under \"Read first\", then the pages under \"Read when it applies\". They are Adobe's current pages, not memory.",
    "2. For every host API you are about to call, run `node scripts/skill.mjs find <words>` and read the hit. Copy names from the docs or from the types file; never guess one.",
    `3. Write the plugin in ${path.join(project, "src")}. Keep the starter's files and structure. Put logic that needs no host (math, parsing, encoding) in its own module, such as src/lib/<name>.ts, with <name>.test.ts beside it that imports it with the .ts extension. Add the script \`"test": "node --test \\"src/**/*.test.ts\\""\` to package.json (Node 22.18 or newer runs TypeScript directly).`,
    "4. Lay out the panel using the Panel UI section below. The starter's demo CSS is not the design. Follow the limits below.",
    "5. Run `node scripts/skill.mjs check`. It builds, packages, type checks the files you wrote, runs the tests, and reads the code against the docs. Fix everything it names and run it again until it says ok.",
    "6. When `check` says ok, run `node scripts/skill.mjs session next` and do what it says. The next step is the try card: the developer loads the plugin in the Adobe app and sends bugs. You do not end the session yourself.",
    "",
    "Do not stop to ask the developer anything while you write and check. After `check` is ok, only the try card asks them. If something is unclear, choose the simplest reading of the goal, say so in the summary, and keep going.",
    ""
  ];
  if (fresh) {
    lines.push(
      "## What the starter already gives you",
      "- `npm run build` does not type check. `check` runs `tsc` and reports errors in the files you wrote. The starter has a few errors of its own; leave them.",
      plan.framework === "react" ? "- `src/spectrum.d.ts` already declares every `<sp-*>` element and `<uxp-panel>` for React. Do not declare them again." : "",
      "- `tsconfig.json` allows `.ts` imports, so a test can import `./thing.ts`. In panel code, import without the extension.",
      "- `uxp.storage` (`localFileSystem`, `formats`) and `uxp.shell` are typed. Call them directly, as Adobe's samples do; no cast is needed.",
      "- A native starter already has a Spectrum screen in the main component and `src/panel.css`: one heading, one labeled field, one `sp-button variant=\"cta\"`, and a status line. Edit that screen. `minimumSize` is 260×360 when the file still had Bolt's 230×200.",
      "- The host objects come from `src/globals.ts` (`uxp`, `premierepro`, `photoshop`, ...). Import them from there.",
      "- `src/uxp-guard.js` is imported first. It defines TextEncoder and TextDecoder, which UXP does not have. Vite `modulePreload` is false. Do not remove either.",
      plan.runtime === "webview" ? "- The page inside the WebView can use browser APIs. Remote `fetch` from that page is still blocked; do it on the host. The host document still loads the guard." : "",
      plan.host === "phxs" ? "- Photoshop has no saved types file. TypeScript checks your calls against `node_modules/@types/photoshop` in the project; grep it for a name or a signature (the `check` line `types` covers the files you wrote)." : "",
      plan.host === "ppro" ? "- Adobe's samples write `const app = require(\"premierepro\")`. Here the same object is `premierepro`, imported from `src/globals.ts`. It is typed by the `@adobe/premierepro` package, and `check` also compares every `premierepro.X.Y` name to the saved types file." : "",
      ""
    );
  }
  if (plan.host === "ppro") {
    lines.push(
      "## Premiere objects",
      "These rules are for Premiere Pro only. Photoshop, InDesign, Illustrator, After Effects, and Media Encoder do not use them.",
      "- Finish file and network awaits before you take a Project, Sequence, or ProjectItem. Across those awaits, keep only plain values, such as a file path.",
      "- A Project, Sequence, or ProjectItem stays valid while you await a method on that same object. After any other await, call Project.getActiveProject() again and use the new project, sequence, and items.",
      "- Call every create*Action() inside project.lockedAccess(() => { project.executeTransaction(...) }). The callback is synchronous. Do not await inside it, and do not keep an Action after the callback returns.",
      "Premiere throws \"The script object is no longer valid\" when code uses an object taken before that other await.",
      ""
    );
  }
  if (have) {
    const seen = new Set();
    const add = (rel, why) => {
      if (seen.has(rel) || !fs.existsSync(path.join(lib, rel))) return null;
      seen.add(rel);
      return `- ${rel} (${why})`;
    };
    const first = [];
    for (const file of fs.existsSync(path.join(lib, "api")) ? fs.readdirSync(path.join(lib, "api")) : []) first.push(add(path.join("api", file), "exact API types: grep it for a name, do not read it whole"));
    first.push(add("LIMITS.md", "what Adobe says UXP cannot do"), add("INDEX.md", "every saved page, by topic"));
    lines.push("## Read first", ...first.filter(Boolean), "");
    const topics = pointers(lib, plan, seen);
    if (topics.length) lines.push("## Read when it applies to this goal", ...topics.map((row) => row), "");
    const core = (HOSTS[plan.host]?.core || []).map((id) => add(`pages/${id}.md`, CORE_WHY[id] || "reference")).filter(Boolean);
    if (core.length) lines.push("## Look up when you need it (long; search them, do not read them whole)", ...core, "");
    const ways = buildWays(plan);
    if (ways.length) lines.push("## Limits, and what to do instead", ...ways, "", "The full saved list is LIMITS.md. A limit that is not there, and not in the lines above, is not a limit.", "");
  }
  lines.push(...designSection(plan));
  lines.push("## Panel UI", ...panelGuide(plan), "");
  const decided = featureLines(plan);
  if (decided.length) lines.push("## What they chose", ...decided, "");
  lines.push(
    "## Packages",
    "If the feature is a solved problem (QR codes, CSV, dates, color math), install a pure JavaScript package. Do not import `qrcode/lib/server.js` or Node's `fs` into the panel. The starter marks `fs` external, so the bundle ends in `require$$1`, UXP throws \"require$$1 is not defined\", and the panel stays blank. Use `qrcode/lib/core/qrcode.js` and render the modules with no `fs`. The package must not need WebGL.",
    ""
  );
  lines.push(
    "## Finish line",
    "`check` says ok, then run `node scripts/skill.mjs session next` and do what it says. That is the try card (`feedback`): the developer loads the plugin in the Adobe app and sends bugs, or says there are no more bugs. Only after they choose \"No more bugs\" (or you run `feedback --skip` because nobody is there) do you run `session done --summary \"...\"`. The summary says what was built, where it is, and how to load it. After \"No more bugs\" say they tried it and chose that; with `--skip` or `--yes` say it was built and packaged but not run in the Adobe app, because nothing here can open the app.",
    ""
  );
  fs.writeFileSync(briefFile(out), lines.join("\n").replace(/\n{3,}/g, "\n\n"));
  return briefFile(out);
}

/* --------------------------------------------------------------- check */

function noteId(finding) {
  return `a-${crypto.createHash("sha1").update(`${finding.id}|${finding.file}|${finding.text}`).digest("hex").slice(0, 8)}`;
}

function sync(out, findings) {
  const session = readMerged(out);
  const now = new Set(findings.map(noteId));
  for (const note of session.notes || []) {
    if (note.auto && note.id.startsWith("a-") && !now.has(note.id) && note.status === "open") setNoteStatus(out, note.id, "fixed", "audit");
  }
  for (const finding of findings) {
    const id = noteId(finding);
    const existing = (session.notes || []).find((note) => note.id === id);
    if (existing) {
      if (existing.status !== "open") setNoteStatus(out, id, "open", "audit");
      continue;
    }
    addNote(out, { id, text: `${finding.file}${finding.line ? `:${finding.line}` : ""} ${finding.text}`, severity: finding.severity === "error" ? "high" : "low", rule: finding.id, source: finding.file, key: id, auto: true });
  }
}

export async function runCheck(out, { runner, typecheckImpl, overrides = {} } = {}) {
  const plan = resolvePlan(out, overrides);
  const session = readMerged(out);
  const build = session.steps.find((step) => step.id === "build");
  if (!build || build.status !== "done") throw new Error("The project is not created yet. Run: node scripts/skill.mjs build");
  const project = session.addon.path || projectPath(plan);
  const baseline = readJson(baselineFile(out));
  const { changed } = changedSinceBaseline(project, baseline);
    if (baseline && !changed.length) {
    setStep(out, "implement", "running", "Waiting for the code", { doing: "The starter has not been changed yet" });
    return {
      docs: docsStamp(out, plan),
      ok: false,
      stage: "implement",
      error: "Nothing under src/ has changed since the starter, so there is no plugin yet.",
      next: `Write the plugin in ${path.join(project, "src")} (read ${briefFile(out)} first), then run check again.`
    };
  }
  setStep(out, "implement", "done", `${changed.length} file${changed.length === 1 ? "" : "s"} written`);
  setStep(out, "check", "running", "Building and reading the code", { doing: "Building" });
  const scripts = readScripts(project);
  const names = ["build", "ccx"].filter((name) => scripts[name]);
  const failures = [];
  if (!scripts.build) failures.push({ severity: "error", id: "no-build-script", file: "package.json", text: "package.json has no build script.", fix: "Add the build script the starter had." });

  let pack = { status: "unavailable", artifacts: [], runs: [] };
  if (scripts.build) {
    pack = runPackage(project, { only: names, ...(runner ? { runner } : {}) });
    if (pack.status === "failed") {
      failures.push({ severity: "error", id: "build-failed", file: "package.json", text: `The build failed. ${pack.reason}`.slice(0, 1500), fix: "Fix the compile error above and run check again." });
    }
  }

  if (plan.runtime !== "webview" && pack.status !== "failed") patchReactBundles(project);
  setStep(out, "check", "running", "Reading the code against Adobe's docs", { doing: "Auditing" });
  const audit = auditProject({ project, plan, libDir: fs.existsSync(path.join(docsDir(out), "library.json")) ? docsDir(out) : "", baseline });
  let findings = [...failures, ...audit.findings];

  const types = typecheck(project, [...authoredFiles(project, baseline).map((item) => item.file), ...testFiles(project)], { ...(typecheckImpl ? { runImpl: typecheckImpl } : {}) });
  // The audit already named a wrong host API with its real neighbours. The compiler's line about it adds nothing.
  const named = new Set(findings.filter((item) => item.id === "api-unknown").map((item) => `${item.file}:${item.line}`));
  findings.push(...types.findings.filter((item) => !named.has(`${item.file}:${item.line}`)));

  let tests = { ran: false };
  if (scripts.test) {
    const result = run(process.platform === "win32" ? "npm.cmd" : "npm", ["test"], { cwd: project, timeout: 5 * 60 * 1000 });
    tests = { ran: true, passed: result.status === 0, output: `${result.stdout || ""}\n${result.stderr || ""}`.trim().slice(-900) };
    if (!tests.passed) findings.push({ severity: "error", id: "tests-failed", file: "package.json", text: `npm test failed.\n${tests.output}`, fix: "Fix the code or the test and run check again." });
  }
  findings = findings.filter((finding, index, all) => all.findIndex((item) => noteId(item) === noteId(finding)) === index);
  sync(out, findings);

  const errors = findings.filter((finding) => finding.severity === "error");
  const warnings = findings.filter((finding) => finding.severity !== "error");
  const dist = path.join(project, "dist");
  const result = {
    docs: docsStamp(out, plan),
    project,
    build: pack.status,
    artifacts: (pack.artifacts || []).map((item) => path.join(project, item.file || String(item))),
    loadFrom: fs.existsSync(dist) ? dist : "",
    tests: tests.ran ? (tests.passed ? "passed" : "failed") : "none",
    types: types.ran ? (types.total ? `${types.total} error${types.total === 1 ? "" : "s"} in your files` : "clean (the files you wrote)") : "not checked",
    scanned: audit.scanned.length,
    errors: errors.map(show),
    warnings: warnings.map(show),
    hostExecuted: false
  };
  if (errors.length) {
    setStep(out, "check", "running", `${errors.length} problem${errors.length === 1 ? "" : "s"} to fix`, { doing: "Waiting for fixes" });
    return { ok: false, stage: "check", ...result, next: `Fix the ${errors.length} problem${errors.length === 1 ? "" : "s"} listed in errors (each has a fix line), then run node scripts/skill.mjs check again. Do not stop.` };
  }
  setStep(out, "check", "done", warnings.length ? `Built. ${warnings.length} warning${warnings.length === 1 ? "" : "s"}` : "Built and clean");
  const load = loadHelp(plan, result);
  fs.writeFileSync(path.join(out, "load.txt"), `${load}\n`);
  return {
    ok: true,
    ...result,
    note: "The plugin was built and packaged. It was not run in the Adobe app: nothing here can open it.",
    load
  };
}

function docsStamp(out, plan) {
  const lib = docsDir(out);
  const types = path.join(lib, "api", "premierepro.d.ts");
  if (plan.host === "ppro" && fs.existsSync(types)) {
    const when = fs.statSync(types).mtime.toISOString().replace(/\.\d{3}Z$/, "Z");
    return `Premiere types saved ${when} (api/premierepro.d.ts).`;
  }
  const library = path.join(lib, "library.json");
  if (fs.existsSync(library)) {
    try {
      const saved = JSON.parse(fs.readFileSync(library, "utf8")).fetchedAt;
      if (saved) return `Docs saved ${saved}.`;
    } catch {
      // The library file is unreadable. The line below covers that.
    }
  }
  return "No docs were saved for this check.";
}

function show(finding) {
  return `${finding.file}${finding.line ? `:${finding.line}` : ""} [${finding.id}] ${finding.text}${finding.fix ? ` Fix: ${finding.fix}` : ""}`;
}

function loadHelp(plan, result) {
  const label = hostLabel(plan.host);
  const ccx = result.artifacts.find((file) => /\.ccx$/i.test(file));
  return [
    `Open UXP Developer Tool, choose Add Plugin, select ${path.join(result.loadFrom || "dist", "manifest.json")}, then Load.`,
    ccx ? `Or double-click ${ccx} to install it in ${label}.` : ""
  ].filter(Boolean).join(" ");
}

function readScripts(project) {
  try {
    return JSON.parse(fs.readFileSync(path.join(project, "package.json"), "utf8")).scripts || {};
  } catch {
    return {};
  }
}

export { findApp };
