import fs from "node:fs";
import path from "node:path";
import { assessGoal, assessTree, summarize } from "./assess.mjs";
import { resolveCapability } from "./capability.mjs";
import { buildContract, goalWasReplaced, writeContractFiles } from "./contract.mjs";
import { consequentialAsk, frameworkAsk, hostAsk, keepAsk, modeAsk, narrowAsk } from "./ask.mjs";
import { effectiveHostFloor, floorsFromText } from "./floors.mjs";
import { runPackage } from "./package-project.mjs";
import { rememberOut } from "./paths.mjs";
import { refreshPages, readPageText } from "./refresh.mjs";
import { pagesForRequest } from "./registry.mjs";
import { publishAsk, readMerged, recordFacts, setMode, setStep, startSession } from "./session.mjs";
import { findApp, findFramework, stackInventory } from "./stack.mjs";

const KEEP = {
  "cep-listener": "keep-listener",
  "native-addon": "keep-native-addon",
  "host-system-call": "keep-system"
};

export async function runWorkflow(options) {
  const out = path.resolve(options.out);
  const answers = options.answers || {};
  if (!readMerged(out)) {
    startSession(out, { name: answers.name || "UXP plugin", projectPath: options.projectPath || "", kind: options.kind || "empty" });
    rememberOut(out);
  }
  const prior = readMerged(out);
  if (prior?.outcome === "awaiting-agent-implementation" && prior.contract?.projectPath) {
    return {
      ok: false,
      success: false,
      state: prior.outcome,
      out,
      project: prior.contract.projectPath,
      contract: prior.contract,
      hostExecuted: false,
      say: "Still waiting for the assistant to implement the requested goal."
    };
  }
  if (!readMerged(out).mode) {
    if (!answers.mode) return block(out, modeAsk());
    setMode(out, answers.mode);
  }
  const intake = {
    goal: answers.goal || "",
    framework: answers.framework || "",
    host: answers.host || "",
    os: answers.os || process.platform,
    context: answers.context || "panel",
    name: answers.name || "",
    id: answers.id || "",
    permissions: answers.permissions || [],
    kind: options.kind || "empty"
  };
  const choice = (id) => answers[id] || readMerged(out).asks.find((item) => item.id === id && item.status === "answered")?.answer || "";
  if (!intake.goal || !intake.name || !intake.id) {
    setStep(out, "intake", "waiting", "Goal, name, and id are required.");
    return { ok: false, blocked: "intake", say: "Set goal, name, and id in the answers. The skill does not invent them." };
  }
  if (options.kind !== "existing" && !intake.framework) return block(out, frameworkAsk());
  if (options.kind !== "existing" && !intake.host) return block(out, hostAsk());
  const framework = findFramework(intake.framework);
  const app = findApp(intake.host);
  if (options.kind !== "existing" && (!framework || !app)) {
    return { ok: false, blocked: "intake", say: "The framework or host is not in the create-bolt-uxp 1.3.27 inventory. It was not invented." };
  }
  setStep(out, "intake", "done", `${intake.name} on ${intake.host || "existing"} / ${intake.framework || "existing"}.`, { log: "Intake recorded." });
  recordFacts(out, { intake, addon: { name: intake.name, path: options.projectPath || "" } });

  setStep(out, "docs", "running", "Fetching official pages.");
  const pages = pagesForRequest({ host: intake.host, goal: intake.goal, behaviors: (options.files || []).map((file) => file.text) });
  const summary = options.offline
    ? await refreshPages(path.join(out, "docs"), pages, { fetchImpl: async () => { throw new Error("offline"); } })
    : await refreshPages(path.join(out, "docs"), pages, { fetchImpl: options.fetchImpl });
  const pageText = summary.pages.map((page) => ({ ...page, text: readPageText(path.join(out, "docs"), page.id) }));
  const parsed = floorsFromText(pageText);
  const floor = effectiveHostFloor(parsed);
  recordFacts(out, { docs: { summary: { ok: summary.ok, fresh: summary.fresh, stale: summary.stale, failed: summary.failed }, floors: parsed, effective: floor } });
  setStep(out, "docs", summary.ok ? "done" : "failed", summary.ok ? "Every requested page is fresh." : `Not fresh. Fresh: ${summary.fresh.join(", ") || "none"}. Failed or stale pages stay failed or stale.`);

  const files = options.files || readProjectFiles(options.projectPath);
  const behaviors = assessTree(files);
  const goal = assessGoal({ goal: intake.goal, host: intake.host || app?.id, framework: intake.framework });
  const plan = summarize(behaviors, goal);
  plan.stack = stackInventory();
  plan.acceptanceSlice = framework?.acceptanceTested && app?.acceptanceTested
    ? "react+photoshop"
    : "not-the-acceptance-slice";
  plan.floors = floor;
  plan.hostExecuted = false;
  recordFacts(out, { plan });
  writeReport(out, intake, plan, summary, behaviors);
  const capability = resolveCapability({ goal: intake.goal, pages: pageText });
  plan.capability = capability;
  plan.fixture = capability.fixture;
  plan.recipe = capability.fixture;
  recordFacts(out, { plan });
  setStep(out, "plan", "done", `${capability.state}. ${capability.detail}`);

  for (const item of plan.askBeforeDrop) {
    const id = KEEP[item.behavior];
    if (!id) continue;
    const picked = choice(id);
    if (!picked) return block(out, keepAsk(id, item.behavior));
    if (picked === "drop") plan.drops = [...(plan.drops || []), item.behavior];
  }

  if (capability.state !== "awaiting-agent-implementation") {
    const held = hold(out, intake, capability, options.projectPath || "", summary, plan, behaviors, []);
    return { ok: false, success: false, state: capability.state, out, hostExecuted: false, contract: held, say: capability.detail };
  }

  const consequential = choice("consequential");
  if (consequential !== "proceed" && consequential !== "stop") return block(out, consequentialAsk());
  if (consequential === "stop") {
    recordFacts(out, { outcome: "stopped", verification: { hostExecuted: false, status: "NOT TESTED" } });
    return { ok: false, success: false, state: "stopped", out, hostExecuted: false, say: "No feature files were written." };
  }

  let project = options.projectPath;
  if (options.kind === "empty") {
    setStep(out, "scaffold", "running", "Running create-bolt-uxp.");
    const parent = options.workDir || path.join(out, "work");
    fs.mkdirSync(parent, { recursive: true });
    const scaffold = options.scaffoldImpl
      ? await options.scaffoldImpl(parent, intake)
      : await (await import("./scaffold.mjs")).scaffoldWithInstaller(parent, {
        folderName: slug(intake.id),
        displayName: intake.name,
        id: intake.id,
        framework: intake.framework,
        app: intake.host,
        installDeps: Boolean(options.installDeps)
      });
    project = scaffold.folder;
    const manifestFloor = readStarterMin(project, app?.manifestApp);
    recordFacts(out, { scaffold: { ...scaffold, manifestMinVersion: manifestFloor, effective: floor }, addon: { path: project } });
    setStep(out, "scaffold", "done", `Installer wrote ${project}. WebView was not requested.`);
  } else {
    setStep(out, "scaffold", "skipped", "Existing project. The installer did not replace it.");
  }

  const broad = project && fs.existsSync(path.join(project, "uxp.config.ts")) && /localFileSystem/.test(fs.readFileSync(path.join(project, "uxp.config.ts"), "utf8"));
  const permissions = choice("narrow-permissions");
  if (broad && !permissions) return block(out, narrowAsk());
  if (broad && permissions === "narrow") {
    const config = path.join(project, "uxp.config.ts");
    const source = fs.readFileSync(config, "utf8");
    const next = source.replace(/requiredPermissions:\s*\{[\s\S]*?\n\s*\},/m, "requiredPermissions: {},");
    if (next !== source) fs.writeFileSync(config, next);
  }

  const kept = listKept(project, plan.drops || []);
  const contract = hold(out, intake, capability, project, summary, plan, behaviors, kept);
  setStep(out, "implementation", "waiting", "awaiting-agent-implementation");
  return {
    ok: false,
    success: false,
    state: "awaiting-agent-implementation",
    out,
    project,
    fixture: capability.fixture,
    hostExecuted: false,
    contract,
    say: "The project is ready. The invoking assistant writes the requested goal. A missing recipe does not write a rename panel instead."
  };
}

export function recordImplementation(out, claimed, { runner } = {}) {
  const session = readMerged(out);
  const contract = session?.contract;
  if (!contract) throw new Error("There is no implementation contract.");
  const project = contract.projectPath;
  if (claimed?.goal !== contract.goal) {
    return incomplete(out, "not-yet-implemented", "The recorded goal does not match the requested goal.");
  }
  const files = claimed.files || [];
  if (!files.length) return incomplete(out, "not-yet-implemented", "The assistant recorded no files.");
  const bodies = [];
  for (const relative of files) {
    const full = path.resolve(project, relative);
    if (!full.startsWith(path.resolve(project) + path.sep)) return incomplete(out, "not-yet-implemented", "A recorded path escapes the project.");
    if (!fs.existsSync(full) || !fs.statSync(full).size) return incomplete(out, "not-yet-implemented", `${relative} is missing or empty.`);
    bodies.push(fs.readFileSync(full, "utf8"));
  }
  if (goalWasReplaced(contract, bodies.join("\n"))) {
    return incomplete(out, "not-yet-implemented", "The written files replace the requested goal with the rename fixture.");
  }
  setStep(out, "implementation", "done", "The assistant wrote the files named in agent-result.", { verified: true });
  const uiOk = bodies.some((body) => /disabled|error|Loading|status/i.test(body));
  if (!uiOk) return incomplete(out, "not-yet-implemented", "The files do not show an error, disabled, or loading state.");
  setStep(out, "ui", "done", "The written panel includes a visible error, disabled, or loading state.", { verified: true });
  const docsStep = session.steps.find((step) => step.id === "docs");
  if (docsStep?.status !== "done") {
    recordFacts(out, { outcome: "failed", verification: { hostExecuted: false, status: "NOT TESTED" } });
    publishOutcome(out, "failed", false);
    return { ok: false, success: false, state: "failed", hostExecuted: false, say: "Official docs are not all fresh. Tests and package were not run and were not marked done." };
  }

  const tests = runPackage(project, { runner, only: ["test"] });
  if (tests.status === "unavailable" || tests.status === "failed") {
    setStep(out, "tests", "failed", tests.reason);
    recordFacts(out, { outcome: "failed", packageResult: tests, verification: { hostExecuted: false, status: "NOT TESTED" } });
    publishOutcome(out, "failed", false);
    return { ok: false, success: false, state: "failed", hostExecuted: false, say: tests.reason };
  }
  setStep(out, "tests", "done", `test exited 0. ${tests.note}`, { verified: true });

  const packed = runPackage(project, { runner, only: ["build", "ccx"] });
  recordFacts(out, { packageResult: packed, verification: { hostExecuted: false, status: "NOT TESTED" } });
  if (packed.status !== "written") {
    setStep(out, "package", "failed", packed.reason || packed.status);
    recordFacts(out, { outcome: "failed", verification: { hostExecuted: false, status: "NOT TESTED" } });
    publishOutcome(out, "failed", false);
    return { ok: false, success: false, state: "failed", hostExecuted: false, say: packed.reason || packed.status };
  }
  setStep(out, "package", "done", `${packed.status}. The host was not executed.`, { verified: true });
  fs.writeFileSync(path.join(out, "host-verification.md"), hostManual({ goal: contract.goal, host: contract.host }, session.docs?.effective));
  setStep(out, "host-verification", "done", "NOT TESTED. Manual steps are in host-verification.md.", { verified: true });
  recordFacts(out, { outcome: "commands-finished" });
  publishOutcome(out, "commands-finished", true);
  return { ok: true, success: true, state: "commands-finished", hostExecuted: false, package: packed };
}

function publishOutcome(out, state, success) {
  const file = path.join(out, "report.json");
  let report = {};
  try {
    report = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    report = {};
  }
  report.state = state;
  report.success = Boolean(success);
  report.hostExecuted = false;
  fs.writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(path.join(out, "report.md"), `# Status\n\nSuccess: ${success ? "command results recorded" : "no"}\n\nState: ${state}\n\nGoal: ${report.goal || ""}\n\nHost executed: no\n`);
}

function hold(out, intake, capability, projectPath, summary, plan, behaviors, kept) {
  const contract = buildContract({
    intake: { ...intake, kind: intake.kind || "" },
    capability,
    projectPath,
    docs: summary.pages,
    kept
  });
  if (projectPath) writeContractFiles(projectPath, contract);
  fs.writeFileSync(path.join(out, "implementation-contract.json"), `${JSON.stringify(contract, null, 2)}\n`);
  recordFacts(out, { outcome: capability.state, contract, verification: { hostExecuted: false, status: "NOT TESTED" } });
  writeReport(out, intake, plan, summary, behaviors, capability.state);
  return contract;
}

function incomplete(out, state, say) {
  setStep(out, "implementation", "failed", `${state}: ${say}`);
  recordFacts(out, { outcome: state, verification: { hostExecuted: false, status: "NOT TESTED" } });
  publishOutcome(out, state, false);
  return { ok: false, success: false, state, hostExecuted: false, say };
}

function listKept(project, drops) {
  if (!project || !fs.existsSync(project)) return [];
  const drop = new Set(drops);
  const mapped = {
    "bridge/listen.js": "cep-listener",
    "native/filter-loader.js": "native-addon",
    "system/call.js": "host-system-call"
  };
  const kept = [];
  for (const [relative, behavior] of Object.entries(mapped)) {
    const full = path.join(project, relative);
    if (!fs.existsSync(full)) continue;
    if (drop.has(behavior)) fs.rmSync(full, { force: true });
    else kept.push(relative);
  }
  for (const relative of ["jsx/rename.jsx", "shim/webview.js"]) {
    if (fs.existsSync(path.join(project, relative))) kept.push(relative);
  }
  return kept;
}

function block(out, ask) {
  const session = readMerged(out);
  if (!session.asks.some((item) => item.id === ask.id && item.status === "pending")) publishAsk(out, ask);
  return { ok: false, blocked: ask.id, say: `Answer ${ask.id} before the skill writes or drops files.` };
}

function hostManual(intake, floor) {
  const goal = intake.goal || "";
  const rename = /rename/i.test(goal) && /layer/i.test(goal);
  const exercise = rename
    ? "Open a document, select layers, preview a prefix, suffix, and padded sequence, and apply only those layer ids inside executeAsModal. Duplicate names are a warning, not a host prohibition."
    : `Exercise this goal and no other:\n\n${goal}\n\nDo not substitute the selected-layer rename fixture.`;
  return `# Host verification

Status: NOT TESTED.

Goal: ${goal}

This environment did not launch ${intake.host || "the Adobe host"}. A dashboard in a browser, npm test, npm run build, and a CCX file do not execute the plugin.

${exercise}

Effective manifest floor: ${floor?.minVersion || "unknown"}.
${floor?.reason || "No floor was proven from fresh pages."}
`;
}

function writeReport(out, intake, plan, summary, behaviors, state = "unknown") {
  const report = {
    addon: intake.name,
    addonPath: intake.id,
    goal: intake.goal,
    state,
    success: false,
    hostExecuted: false,
    docsSha: summary.pages.map((page) => page.revision).join(","),
    fetchedAt: summary.retrievedAt,
    skipped: summary.failed,
    views: [],
    findings: [
      ...behaviors.map((item, index) => ({
        id: item.behavior || `b${index}`,
        severity: item.class === "unknown" ? "warn" : "warn",
        file: item.file || "goal",
        line: 1,
        message: `${item.class}: ${item.detail}`,
        suggestion: item.askBeforeDrop ? "Ask before removing this behavior." : "Use the named recipe only when the class is native-feasible.",
        source: { kind: "tool", url: "" }
      })),
      {
        id: "host-not-tested",
        severity: "warn",
        file: "host-verification.md",
        line: 1,
        message: "The Adobe host was not executed.",
        suggestion: "Follow host-verification.md in the host application.",
        source: { kind: "tool", url: "" }
      }
    ]
  };
  fs.writeFileSync(path.join(out, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(path.join(out, "report.md"), `# ${intake.name}\n\nSuccess: no\n\nState: ${state}\n\nGoal: ${intake.goal}\n\nHost executed: no\n\nFixture: ${plan?.fixture || "none"}\n`);
}

function readProjectFiles(projectPath) {
  if (!projectPath || !fs.existsSync(projectPath)) return [];
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(jsx?|tsx?|html|mjs|cjs)$/.test(entry.name)) {
        files.push({ path: path.relative(projectPath, full), text: fs.readFileSync(full, "utf8") });
      }
    }
  };
  walk(projectPath);
  return files;
}

function readStarterMin(project, app) {
  const config = path.join(project, "uxp.config.ts");
  if (!fs.existsSync(config) || !app) return null;
  const text = fs.readFileSync(config, "utf8");
  const match = text.match(new RegExp(`app:\\s*"${app}"[\\s\\S]{0,120}?minVersion:\\s*"([^"]+)"`));
  return match ? match[1] : null;
}

function listMtimes(project) {
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === "dist") continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(tsx?|jsx?|mjs|css|html)$/.test(entry.name)) {
        files.push({ rel: path.relative(project, full), mtimeMs: fs.statSync(full).mtimeMs });
      }
    }
  };
  if (fs.existsSync(project)) walk(project);
  return files;
}

function slug(id) {
  return String(id).toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-|-$/g, "") || "uxp-plugin";
}
