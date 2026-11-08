import fs from "node:fs";
import path from "node:path";
import { assessGoal, assessTree, summarize } from "./assess.mjs";
import { resolveCapability } from "./capability.mjs";
import { discoverOfficialPages } from "./discover.mjs";
import { buildContract, writeContractFiles } from "./contract.mjs";
import { consequentialAsk, frameworkAsk, hostAsk, keepAsk, modeAsk, narrowAsk, scriptChangeAsk } from "./ask.mjs";
import { assessCepSources } from "./cep/signals.mjs";
import { writeDesignConstraints } from "./design-skill.mjs";
import { skillRoot } from "./paths.mjs";
import { previewDocument } from "./preview.mjs";
import { stageDecision } from "./stages.mjs";
import { effectiveHostFloor, floorsFromText } from "./floors.mjs";
import { narrowRequiredPermissions } from "./permissions.mjs";
import { runPackage } from "./package-project.mjs";
import { rememberOut } from "./paths.mjs";
import { REVIEW_LIMIT, reviewArchive, reviewClaim, reviewCommandProvenance, selectArchives, snapshotProject, testsCoverFeature } from "./review.mjs";
import { refreshPages, readPageText } from "./refresh.mjs";
import { pagesForRequest } from "./registry.mjs";
import { bindScope, publishAsk, readAnswers, readMerged, recordFacts, setMode, setStep, startSession } from "./session.mjs";
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
  if (!intake.host) return block(out, hostAsk());
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
  let capability = resolveCapability({ goal: intake.goal, pages: pageText });
  if (capability.state === "unknown" && summary.ok) {
    const extra = await discoverOfficialPages({
      host: intake.host,
      goal: intake.goal,
      fetchImpl: options.fetchImpl,
      docsDir: path.join(out, "docs")
    });
    if (extra.length) {
      pageText.push(...extra);
      for (const page of extra) {
        summary.pages.push({ id: page.id, url: page.url, scope: page.scope, ok: true, freshness: "fresh", source: page.source });
        summary.fresh.push(page.id);
      }
      capability = resolveCapability({ goal: intake.goal, pages: pageText });
    }
  }
  plan.capability = capability;
  plan.fixture = capability.fixture;
  plan.recipe = capability.fixture;
  recordFacts(out, { plan });
  setStep(out, "plan", "done", `${capability.state}. ${capability.detail}`);

  if (!summary.ok) {
    const paused = {
      ...capability,
      state: "docs-incomplete",
      detail: `Docs are not fresh. Failed: ${summary.failed.join(", ") || "none"}. Stale: ${summary.stale.join(", ") || "none"}. Failed or stale pages are not evidence.`
    };
    const held = hold(out, intake, paused, options.projectPath || "", summary, plan, behaviors, []);
    return { ok: false, success: false, state: "docs-incomplete", out, hostExecuted: false, contract: held, say: paused.detail };
  }

  const cep = assessCepSources(files);
  plan.cep = { hybrid: cep.hybrid, origins: cep.origins, rejected: cep.rejected, notes: cep.notes };
  const staged = stageDecision({
    choice,
    capability,
    pages: pageText,
    behaviors,
    goal: intake.goal,
    context: intake.context,
    skillRoots: options.skillRoots || [path.resolve(skillRoot, "..")],
    skipDesign: options.skipDesign || [skillRoot],
    cepHybrid: cep.hybrid
  });
  if (staged.action === "ask") return block(out, staged.ask);
  if (staged.action === "reject-continue" || staged.action === "hold-state") {
    const held = hold(out, intake, capability, options.projectPath || "", summary, plan, behaviors, [], { notes: cep.notes });
    return {
      ok: false,
      success: false,
      state: capability.state,
      out,
      hostExecuted: false,
      contract: held,
      say: staged.say || capability.detail
    };
  }
  if (staged.action === "stop" || staged.action === "reject-runtime" || staged.action === "reject-design") {
    recordFacts(out, { outcome: "stopped", verification: { hostExecuted: false, status: "NOT TESTED" } });
    return { ok: false, success: false, state: "stopped", out, hostExecuted: false, say: staged.say };
  }
  const runtimeChoice = staged.runtime;
  intake.webview = runtimeChoice === "webview";
  intake.hybrid = runtimeChoice === "hybrid";

  const groups = new Map();
  for (const item of plan.askBeforeDrop) {
    if (!KEEP[item.behavior] || !item.file) continue;
    const list = groups.get(item.behavior) || [];
    list.push(item.file);
    groups.set(item.behavior, list);
  }
  const drops = [];
  for (const [behavior, files] of groups) {
    const id = KEEP[behavior];
    const unique = [...new Set(files)];
    const picked = choice(id);
    if (!picked) return block(out, keepAsk(id, behavior, unique));
    if (picked === "drop") drops.push({ behavior, files: unique });
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
        installDeps: Boolean(options.installDeps),
        webview: intake.webview,
        hybrid: intake.hybrid
      });
    project = scaffold.folder;
    const manifestFloor = readStarterMin(project, app?.manifestApp);
    recordFacts(out, { scaffold: { ...scaffold, manifestMinVersion: manifestFloor, effective: floor, webview: intake.webview, hybrid: intake.hybrid }, addon: { path: project } });
    setStep(out, "scaffold", "done", `Installer wrote ${project}. webview=${intake.webview} hybrid=${intake.hybrid}. Those flags are the answered runtime, not a hidden default.`);
  } else {
    setStep(out, "scaffold", "skipped", "Existing project. The installer did not replace it.");
  }

  const broad = project && fs.existsSync(path.join(project, "uxp.config.ts")) && /localFileSystem/.test(fs.readFileSync(path.join(project, "uxp.config.ts"), "utf8"));
  const permissions = choice("narrow-permissions");
  if (broad && !permissions) return block(out, narrowAsk());
  if (broad && permissions === "narrow") {
    const config = path.join(project, "uxp.config.ts");
    const source = fs.readFileSync(config, "utf8");
    const narrowed = narrowRequiredPermissions(source);
    if (!narrowed.ok) {
      setStep(out, "scaffold", "failed", narrowed.reason);
      return { ok: false, success: false, state: "failed", out, hostExecuted: false, say: narrowed.reason };
    }
    fs.writeFileSync(config, narrowed.source);
  }

  const removed = applyDrops(project, drops);
  const kept = [...new Set(behaviors.map((item) => item.file).filter((file) => file && !removed.includes(file)))];
  const constraints = writeDesignConstraints({
    runtime: runtimeChoice,
    discovery: staged.discovery,
    limits: staged.offer.limits,
    contextNote: staged.contextCheck?.reason
  });
  fs.writeFileSync(path.join(project, "design-constraints.md"), constraints);
  const preview = {
    surface: runtimeChoice === "webview" ? "webview-browser" : runtimeChoice === "hybrid" ? "native-simulation" : "native-simulation",
    hostExecuted: false,
    file: "preview/index.html",
    note: "Browser preview only. Native mutations are not executed. The Adobe host was NOT TESTED."
  };
  fs.mkdirSync(path.join(out, "preview"), { recursive: true });
  fs.writeFileSync(path.join(out, "preview", "index.html"), previewDocument({
    mode: runtimeChoice,
    goal: intake.goal,
    limits: staged.offer.limits.map((item) => item.quote)
  }));
  setStep(out, "design", "done", staged.design.skill
    ? `Recorded ${staged.design.skill.name} at ${staged.design.skill.path}. It was not called as a model. design-constraints.md quotes the retrieved limits.`
    : `No separate design skill was selected. design-constraints.md quotes the retrieved limits. ${staged.design.example.note}`);
  const notes = [...entryNotes(project, options.kind), ...cep.notes];
  if (runtimeChoice === "webview" || runtimeChoice === "hybrid") {
    notes.push("A shim or a browser preview does not add a host API that the fresh pages did not document.");
  }
  const contract = hold(out, intake, capability, project, summary, plan, behaviors, kept, {
    baseline: snapshotProject(project),
    notes,
    runtime: { id: runtimeChoice, webview: intake.webview, hybrid: intake.hybrid },
    design: staged.design,
    preview
  });
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
  if (contract.state !== "awaiting-agent-implementation") {
    return incomplete(out, contract.state || "unknown", "The contract is not waiting for an implementation. Refresh evidence before recording files.");
  }
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
  const claim = reviewClaim({ contract, files, bodies });
  if (!claim.ok) return incomplete(out, "not-yet-implemented", claim.say);
  setStep(out, "implementation", "done", `Changed code uses ${claim.usedSymbols.join(", ")}. ${REVIEW_LIMIT}`, { verified: true });
  setStep(out, "ui", "done", "A changed file shows an error, disabled, or loading state. That marker is not the feature by itself.", { verified: true });
  const docsStep = session.steps.find((step) => step.id === "docs");
  if (docsStep?.status !== "done") {
    recordFacts(out, { outcome: "failed", verification: { hostExecuted: false, status: "NOT TESTED" } });
    publishOutcome(out, "failed", false);
    return { ok: false, success: false, state: "failed", hostExecuted: false, say: "Official docs are not all fresh. Tests and package were not run and were not marked done." };
  }
  const grant = readScriptGrant(out);
  const provenance = reviewCommandProvenance(project, contract.baseline, grant, { ignoredClaim: Boolean(claimed?.approveScripts) });
  if (!provenance.ok) {
    if (provenance.scope) {
      const current = readMerged(out).asks.find((item) => item.id === "script-change");
      const pendingSame = current && current.status !== "answered" && JSON.stringify(current.scope) === JSON.stringify(provenance.scope);
      if (!pendingSame) publishAsk(out, scriptChangeAsk(provenance));
      return { ok: false, success: false, state: "script-change", blocked: "script-change", hostExecuted: false, say: provenance.say };
    }
    setStep(out, "package", "failed", provenance.say);
    recordFacts(out, { outcome: "failed", verification: { hostExecuted: false, status: "NOT TESTED" }, commandProvenance: provenance });
    publishOutcome(out, "failed", false);
    return { ok: false, success: false, state: "failed", hostExecuted: false, say: provenance.say };
  }
  const covered = testsCoverFeature(project, claim.changed, claim.usedSymbols);
  if (!covered.ok) {
    setStep(out, "tests", "failed", covered.say);
    recordFacts(out, { outcome: "failed", verification: { hostExecuted: false, status: "NOT TESTED" } });
    publishOutcome(out, "failed", false);
    return { ok: false, success: false, state: "failed", hostExecuted: false, say: covered.say };
  }

  const tests = runPackage(project, { runner, only: ["test"] });
  if (tests.status === "unavailable" || tests.status === "failed") {
    setStep(out, "tests", "failed", tests.reason);
    recordFacts(out, { outcome: "failed", packageResult: tests, verification: { hostExecuted: false, status: "NOT TESTED" } });
    publishOutcome(out, "failed", false);
    return { ok: false, success: false, state: "failed", hostExecuted: false, say: tests.reason };
  }
  setStep(out, "tests", "done", `test exited 0. ${covered.file} imports the module that uses the documented API and has a non-tautological assertion. ${tests.note || ""} ${REVIEW_LIMIT}`, { verified: true });

  const packed = runPackage(project, { runner, only: ["build", "ccx"] });
  if (packed.status !== "written") {
    setStep(out, "package", "failed", packed.reason || packed.status);
    recordFacts(out, { outcome: "failed", packageResult: packed, verification: { hostExecuted: false, status: "NOT TESTED" } });
    publishOutcome(out, "failed", false);
    return { ok: false, success: false, state: "failed", hostExecuted: false, say: packed.reason || packed.status };
  }
  const selected = selectArchives(packed.artifacts, contract.baseline?.archives || [], claimed.outputArchives);
  if (!selected.ok) {
    packed.preexisting = selected.preexisting;
    packed.hostExecuted = false;
    setStep(out, "package", "failed", selected.say);
    recordFacts(out, { outcome: "failed", packageResult: packed, verification: { hostExecuted: false, status: "NOT TESTED" } });
    publishOutcome(out, "failed", false);
    return { ok: false, success: false, state: "failed", hostExecuted: false, say: selected.say, package: packed };
  }
  const reviews = selected.fresh.map((artifact) => reviewArchive({
    project,
    artifact,
    symbols: claim.usedSymbols,
    baselineArchives: contract.baseline?.archives || []
  }));
  packed.reviews = reviews;
  packed.preexisting = selected.preexisting;
  packed.provenance = provenance.provenance;
  packed.hostExecuted = false;
  recordFacts(out, { packageResult: packed, verification: { hostExecuted: false, status: "NOT TESTED" }, commandProvenance: provenance });
  const bad = reviews.filter((item) => !item.ok);
  if (bad.length) {
    const say = bad.map((item) => item.say).join(" ");
    setStep(out, "package", "failed", say);
    recordFacts(out, { outcome: "failed" });
    publishOutcome(out, "failed", false);
    return { ok: false, success: false, state: "failed", hostExecuted: false, say, package: packed };
  }
  const listed = reviews.map((item) => `${item.file} ${item.digest} (${item.bytes} bytes, ${item.matched.join(", ")})`).join("; ");
  setStep(out, "package", "done", `New archives: ${listed}. Pre-existing zips were not treated as this run. Digests can change when zip timestamps change. ${REVIEW_LIMIT}`, { verified: true });
  fs.writeFileSync(path.join(out, "host-verification.md"), hostManual({ goal: contract.goal, host: contract.host }, session.docs?.effective));
  setStep(out, "host-verification", "done", "NOT TESTED. Manual steps are in host-verification.md. Source and behavior review is still pending.", { verified: true });
  recordFacts(out, { outcome: "commands-finished" });
  publishOutcome(out, "commands-finished", true, listed);
  return { ok: true, success: true, state: "commands-finished", hostExecuted: false, limits: REVIEW_LIMIT, sourceReview: "pending", featureCorrectness: "not-decided", package: packed };
}

function publishOutcome(out, state, success, archives = "") {
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
  report.commandSuccess = success ? "recorded" : "not-recorded";
  report.featureCorrectness = "not-decided";
  report.sourceReview = "pending";
  if (archives) report.archives = archives;
  fs.writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(path.join(out, "report.md"), `# Status\n\nCommand success: ${success ? "recorded" : "not recorded"}\n\nFeature correctness: not decided\n\nSource and behavior review: pending\n\nState: ${state}\n\nGoal: ${report.goal || ""}\n\nHost executed: no\n\n${archives ? `New archives: ${archives}\n\n` : ""}${success ? REVIEW_LIMIT : "A failed or paused state is not a finished feature."}\n`);
}

function readScriptGrant(out) {
  const session = readMerged(out);
  const ask = session?.asks.find((item) => item.id === "script-change" && item.status === "answered");
  if (!ask) return null;
  if (ask.answer === "stop") return { source: "session-answer", declined: true, via: ask.via, scope: ask.scope };
  if (ask.answer !== "approve") return null;
  const line = readAnswers(out).find((item) => item.type === "answer" && item.askId === ask.id && item.nonce === ask.nonce && item.value === "approve");
  if (!line) return null;
  if (ask.scopeSha && line.scopeSha !== ask.scopeSha) return { source: "session-answer", via: line.via, scope: ask.scope, scopeSha: line.scopeSha || "" };
  if (ask.scopeSha && ask.scopeSha !== bindScope(ask.scope)) return { source: "session-answer", via: line.via, scope: ask.scope, scopeSha: "" };
  return { source: "session-answer", via: line.via, at: line.at, nonce: line.nonce, scope: ask.scope, scopeSha: line.scopeSha };
}

function hold(out, intake, capability, projectPath, summary, plan, behaviors, kept, extras = {}) {
  const contract = buildContract({
    intake: { ...intake, kind: intake.kind || "" },
    capability,
    projectPath,
    docs: summary.pages,
    kept,
    baseline: extras.baseline,
    notes: extras.notes,
    runtime: extras.runtime,
    design: extras.design,
    preview: extras.preview
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

function applyDrops(project, drops) {
  if (!project || !fs.existsSync(project)) return [];
  const root = path.resolve(project);
  const removed = [];
  for (const drop of drops) {
    for (const relative of drop.files || []) {
      const full = path.resolve(project, relative);
      if (full !== root && !full.startsWith(`${root}${path.sep}`)) continue;
      if (!fs.existsSync(full) || !fs.statSync(full).isFile()) continue;
      fs.rmSync(full, { force: true });
      removed.push(relative);
    }
  }
  return removed;
}

function entryNotes(project, kind) {
  if (kind === "empty" || !project) return [];
  const main = path.join(project, "src", "main.tsx");
  if (!fs.existsSync(main)) return [];
  const text = fs.readFileSync(main, "utf8");
  if (/\buxp\s*\./.test(text) && !/import\s*\{[^}]*\buxp\b/.test(text)) {
    return ["src/main.tsx references uxp without importing it. Fix that import as part of the feature. This existing project was not rewritten automatically."];
  }
  return [];
}

function block(out, ask) {
  const session = readMerged(out);
  if (!session.asks.some((item) => item.id === ask.id && item.status === "pending")) publishAsk(out, ask);
  return { ok: false, success: false, blocked: ask.id, out, hostExecuted: false, say: `Answer ${ask.id} before the skill writes or drops files.` };
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
