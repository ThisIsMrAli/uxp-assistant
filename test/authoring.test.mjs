import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { implementLayerRename } from "../.claude/skills/uxp-assistant/scripts/lib/implement.mjs";
import { nextAction } from "../.claude/skills/uxp-assistant/scripts/lib/next.mjs";
import { pagesForRequest } from "../.claude/skills/uxp-assistant/scripts/lib/registry.mjs";
import { createDashboardServer } from "../.claude/skills/uxp-assistant/scripts/lib/server.mjs";
import { assetsDir } from "../.claude/skills/uxp-assistant/scripts/lib/paths.mjs";
import { answerFromChat, finish, publishAsk, readReport, readSession, setStep } from "../.claude/skills/uxp-assistant/scripts/lib/session.mjs";
import { recordImplementation, runWorkflow } from "../.claude/skills/uxp-assistant/scripts/lib/workflow.mjs";

const SHOW = "Show each selected layer id and name in the panel.";
const RENAME = "Rename each selected layer with a prefix, suffix, and padded sequence.";
const catalog = [
  ...pagesForRequest({ host: "phxs", goal: "layer document title" }),
  ...pagesForRequest({ host: "ppro", goal: "importFiles" })
];
const byUrl = new Map(catalog.map((page) => [page.url, page.id]));
const TEXT = {
  "photoshop.layer": "name string R W 22.5 Name of the layer.\nid number R 22.5 The identifier of the layer.\nopacity number R W 23.0 The layer opacity.\n",
  "photoshop.document": "activeLayers\n\nLayers\n\nR W\n\n22.5\n\nThe selected layers in the document. (26.9)\n\ntitle\n\nstring\n\nR\n\n22.5\n\nDocument title\n",
  "photoshop.executeAsModal": "commandName string required 23.0 This description is shown above the progress bar.\nsuspendHistory 23.0\n",
  "photoshop.changelog": "set Document activeLayers by providing an array of Layer objects.\n",
  manifest: "Current UXP hosts use manifest version 5.\nminVersion is a required string.\n",
  "premiere.reference": "importFiles\n\nfunction\n\nImport files into the active project.\n",
  "css-styling": "CSS transitions and animations are not supported\n",
  "css-styles": "text-transform is not supported\n"
};

function fetchImpl(failId) {
  return async (url) => {
    const id = byUrl.get(url);
    if (!id) throw new Error(`Unexpected URL ${url}`);
    if (id === failId) throw new Error("offline");
    return { ok: true, async text() { return TEXT[id] || `shared ${id}\n`; } };
  };
}

function answers(goal, extra = {}) {
  return {
    mode: "chat",
    framework: "react",
    host: "phxs",
    os: "linux",
    context: "panel",
    name: "Selection Panel",
    id: "com.example.selection",
    consequential: "proceed",
    "narrow-permissions": "narrow",
    "keep-listener": "keep",
    "keep-native-addon": "keep",
    "keep-system": "keep",
    feasibility: "continue",
    runtime: "native",
    design: "uxp-constraints",
    validation: "commands",
    "context-evidence": "keep-unverified",
    goal,
    ...extra
  };
}

async function scaffold(parent, intake) {
  const folder = path.join(parent, "plugin");
  fs.mkdirSync(path.join(folder, "src", "api"), { recursive: true });
  fs.writeFileSync(path.join(folder, "src", "api", "errors.ts"), "export const errors = { error: \"starter\" };\n");
  writePackage(folder);
  fs.writeFileSync(path.join(folder, "uxp.config.ts"), "export const manifest = {\n  host: [{ app: \"PS\", minVersion: \"24.2.0\" }],\n  requiredPermissions: {\n    localFileSystem: \"fullAccess\",\n  },\n};\n");
  fs.writeFileSync(path.join(folder, "src", "main.tsx"), "import React, { useState } from \"react\";\nconst id = uxp.entrypoints._pluginInfo.id;\nexport function App(){ const [count, setCount] = useState(0); return <main className=\"status\">{id}{count}{setCount}</main>; }\n");
  fs.writeFileSync(path.join(folder, "implementation-note.txt"), intake.goal);
  return { folder, installer: "test-double" };
}

function writePackage(folder) {
  const mod = pathToFileURL(path.resolve(".claude/skills/uxp-assistant/scripts/lib/archive.mjs")).href;
  fs.writeFileSync(path.join(folder, "pack.mjs"), `import fs from "node:fs";
import { writeStoredZip } from ${JSON.stringify(mod)};
function walk(dir, acc = []) {
  for (const name of fs.readdirSync(dir)) {
    const full = dir + "/" + name;
    if (fs.statSync(full).isDirectory()) walk(full, acc);
    else acc.push(full);
  }
  return acc;
}
const entries = walk("src").map((name) => ({ name, data: fs.readFileSync(name) }));
entries.push({ name: "manifest.json", data: Buffer.from('{"name":"unit"}') });
writeStoredZip("out.ccx", entries);
`);
  fs.writeFileSync(path.join(folder, "package.json"), `${JSON.stringify({
    name: "plugin",
    scripts: {
      test: "node --test",
      build: "node -e \"process.exit(0)\"",
      ccx: "node pack.mjs"
    }
  }, null, 2)}\n`);
}

function writeShow(project) {
  fs.mkdirSync(path.join(project, "src"), { recursive: true });
  fs.mkdirSync(path.join(project, "test"), { recursive: true });
  const panel = "src/Selection.tsx";
  const reader = "src/selection-read.mjs";
  const spec = "test/selection.test.mjs";
  fs.writeFileSync(path.join(project, panel), `export function SelectionPanel() {
  return (
    <main>
      <h1>Selected layer ids</h1>
      <p className="status">Idle</p>
      <button type="button" disabled={false}>Read selection</button>
      <p className="error">No document is open.</p>
    </main>
  );
}
`);
  fs.writeFileSync(path.join(project, reader), `export async function readSelection(app) {
  if (!app) return { ok: false, status: "Photoshop is not available." };
  const document = app.activeDocument;
  if (!document) return { ok: false, status: "No document is open." };
  const layers = document.activeLayers || [];
  return { ok: true, status: "Read outside executeAsModal.", layers: layers.map((layer) => ({ id: layer.id, name: layer.name })) };
}
`);
  fs.writeFileSync(path.join(project, spec), `import assert from "node:assert/strict";
import { test } from "node:test";
import { readSelection } from "../src/selection-read.mjs";
test("readSelection reports a missing host", async () => {
  const result = await readSelection(null);
  assert.equal(result.ok, false);
});
`);
  return [panel, reader, spec];
}

function step(out, id) {
  return readSession(out).steps.find((item) => item.id === id);
}

function temp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "uxp-assistant-"));
}

test("a non-rename goal stays on the agent path and is not marked done", async () => {
  const out = temp();
  const result = await runWorkflow({ out, kind: "empty", answers: answers(SHOW), fetchImpl: fetchImpl(), scaffoldImpl: scaffold });
  assert.equal(result.success, false);
  assert.equal(result.state, "awaiting-agent-implementation");
  assert.equal(result.fixture, null);
  assert.equal(result.contract.goal, SHOW);
  assert.equal(result.contract.kind, "empty");
  assert.equal(result.hostExecuted, false);
  assert.equal(fs.existsSync(path.join(result.project, "src", "layer-rename", "Panel.tsx")), false);
  assert.equal(step(out, "implementation").status, "waiting");
  assert.equal(step(out, "tests").status, "pending");
  assert.equal(step(out, "package").status, "pending");
  assert.equal(step(out, "done").status, "pending");
  const report = readReport(out);
  assert.equal(report.success, false);
  assert.equal(report.state, "awaiting-agent-implementation");
  assert.equal(report.goal, SHOW);
  assert.match(fs.readFileSync(path.join(result.project, "IMPLEMENT.md"), "utf8"), new RegExp(SHOW.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  const again = await runWorkflow({ out, kind: "empty", answers: answers(SHOW), fetchImpl: fetchImpl(), scaffoldImpl: scaffold });
  assert.equal(again.success, false);
  assert.equal(again.state, "awaiting-agent-implementation");
  assert.equal(fs.existsSync(path.join(result.project, "src", "layer-rename")), false);
  const fixture = spawnSync(process.execPath, [
    ".claude/skills/uxp-assistant/scripts/assist.mjs",
    "apply-fixture",
    "--out",
    out
  ], { encoding: "utf8" });
  assert.equal(fixture.status, 1);
  assert.match(fixture.stdout, /rename fixture applies only/);
});

test("recording the show-selection files runs the real scripts and still says the host was not tested", async () => {
  const out = temp();
  const result = await runWorkflow({ out, kind: "empty", answers: answers(SHOW), fetchImpl: fetchImpl(), scaffoldImpl: scaffold });
  const files = writeShow(result.project);
  const recorded = recordImplementation(out, { goal: SHOW, files });
  assert.equal(recorded.success, true, recorded.say);
  assert.equal(recorded.state, "commands-finished");
  assert.equal(recorded.hostExecuted, false);
  assert.equal(step(out, "tests").status, "done");
  assert.equal(step(out, "package").status, "done");
  assert.equal(step(out, "done").status, "pending");
  assert.equal(fs.existsSync(path.join(result.project, "out.ccx")), true);
  assert.match(fs.readFileSync(path.join(out, "host-verification.md"), "utf8"), /NOT TESTED/);
  assert.match(fs.readFileSync(path.join(out, "host-verification.md"), "utf8"), /Show each selected layer/);
  assert.doesNotMatch(fs.readFileSync(path.join(result.project, "src", "Selection.tsx"), "utf8"), /Rename selected layers/);
  finish(out, "Commands finished. The Adobe host was NOT TESTED.");
  assert.equal(step(out, "done").status, "done");
  assert.match(step(out, "done").detail, /NOT TESTED/);
  assert.equal(readSession(out).verification.hostExecuted, false);
  const action = nextAction(out);
  assert.equal(action.success, true);
  assert.equal(action.hostExecuted, false);
});

test("an existing project keeps its behaviors and the requested goal", async () => {
  const out = temp();
  const project = path.join(out, "existing");
  fs.mkdirSync(path.join(project, "src"), { recursive: true });
  fs.mkdirSync(path.join(project, "jsx"), { recursive: true });
  fs.mkdirSync(path.join(project, "bridge"), { recursive: true });
  fs.mkdirSync(path.join(project, "native"), { recursive: true });
  fs.mkdirSync(path.join(project, "system"), { recursive: true });
  fs.mkdirSync(path.join(project, "shim"), { recursive: true });
  fs.writeFileSync(path.join(project, "src", "App.tsx"), "export function App(){ return <main>{/* uxp-assistant-panel */}</main>; }\n");
  fs.writeFileSync(path.join(project, "jsx", "rename.jsx"), "var layer = app.activeDocument.activeLayer;\nlayer.name = \"same\";\n");
  fs.writeFileSync(path.join(project, "bridge", "listen.js"), "var cs = new CSInterface();\ncs.addEventListener(\"com.example\", function () {});\ncs.evalScript(\"alert(1)\");\n");
  fs.writeFileSync(path.join(project, "native", "filter-loader.js"), "require(\"./filter.node\");\n");
  fs.writeFileSync(path.join(project, "system", "call.js"), "app.system(\"echo hi\");\n");
  fs.writeFileSync(path.join(project, "shim", "webview.js"), "window.uxpHost.postMessage(\"no\");\n");
  writePackage(project);
  const result = await runWorkflow({ out, kind: "existing", projectPath: project, answers: answers(SHOW), fetchImpl: fetchImpl() });
  assert.equal(result.state, "awaiting-agent-implementation");
  assert.equal(result.contract.goal, SHOW);
  assert.equal(result.contract.fixture, null);
  assert.equal(result.contract.kind, "existing");
  for (const relative of ["jsx/rename.jsx", "bridge/listen.js", "native/filter-loader.js", "system/call.js", "shim/webview.js"]) {
    assert.equal(fs.existsSync(path.join(project, relative)), true, relative);
  }
  assert.match(fs.readFileSync(path.join(project, "src", "App.tsx"), "utf8"), /uxp-assistant-panel/);
  assert.doesNotMatch(fs.readFileSync(path.join(project, "src", "App.tsx"), "utf8"), /LayerRenamePanel/);
  const files = writeShow(project);
  const recorded = recordImplementation(out, { goal: SHOW, files });
  assert.equal(recorded.hostExecuted, false);
  assert.equal(recorded.state, "commands-finished");
  assert.equal(fs.existsSync(path.join(project, "jsx", "rename.jsx")), true);
});

test("the rename fixture is applied only for the rename goal and still needs a real package", async () => {
  const out = temp();
  const result = await runWorkflow({ out, kind: "empty", answers: answers(RENAME), fetchImpl: fetchImpl(), scaffoldImpl: scaffold });
  assert.equal(result.fixture, "selected-layer-rename");
  assert.equal(result.contract.goal, RENAME);
  assert.equal(result.success, false);
  assert.equal(fs.existsSync(path.join(result.project, "src", "layer-rename", "Panel.tsx")), false);
  const written = implementLayerRename(result.project);
  fs.mkdirSync(path.join(result.project, "test"), { recursive: true });
  fs.writeFileSync(path.join(result.project, "test", "rename.test.mjs"), `import assert from "node:assert/strict";
import { test } from "node:test";
import { previewRename } from "../src/layer-rename/preview.mjs";
test("previewRename keeps the current name", () => {
  const preview = previewRename([{ id: 1, name: "A" }], { prefix: "Shot " });
  assert.equal(preview.rows[0].next, "Shot A");
});
`);
  const recorded = recordImplementation(out, { goal: RENAME, files: written.files });
  assert.equal(recorded.state, "commands-finished");
  assert.equal(recorded.hostExecuted, false);
  assert.match(fs.readFileSync(path.join(result.project, "src", "layer-rename", "Panel.tsx"), "utf8"), /Rename selected layers/);
  assert.match(fs.readFileSync(path.join(result.project, "src", "layer-rename", "host.ts"), "utf8"), /executeAsModal/);
});

test("unknown, unsupported, incomplete output, and a failed package cannot report success", async () => {
  const unknownOut = temp();
  const unknown = await runWorkflow({
    out: unknownOut,
    kind: "empty",
    answers: answers("Export a hologram with app.fluxCapacitor()."),
    fetchImpl: fetchImpl(),
    scaffoldImpl: scaffold
  });
  assert.equal(unknown.success, false);
  assert.equal(unknown.state, "unknown");
  assert.equal(unknown.contract.goal, "Export a hologram with app.fluxCapacitor().");
  assert.match(unknown.contract.handoff, /Pause/);
  assert.doesNotMatch(unknown.contract.handoff, /Do not write feature code/);
  assert.equal(nextAction(unknownOut).action, "resolve-evidence");
  assert.notEqual(step(unknownOut, "implementation").status, "done");
  assert.notEqual(step(unknownOut, "tests").status, "done");
  assert.notEqual(step(unknownOut, "package").status, "done");
  assert.equal(readReport(unknownOut).success, false);
  assert.equal(nextAction(unknownOut).success, false);
  assert.throws(() => finish(unknownOut), /Cannot finish/);
  assert.throws(() => setStep(unknownOut, "tests", "done", "nothing generated"), /Refusing to mark tests done/);

  const unsupportedOut = temp();
  const unsupported = await runWorkflow({
    out: unsupportedOut,
    kind: "empty",
    answers: answers("Animate the panel with a CSS transition"),
    fetchImpl: fetchImpl(),
    scaffoldImpl: scaffold
  });
  assert.equal(unsupported.success, false);
  assert.equal(unsupported.state, "unsupported-with-evidence");
  assert.equal(unsupported.contract.evidence[0].quote, "CSS transitions and animations are not supported");
  assert.notEqual(step(unsupportedOut, "tests").status, "done");

  const missingOut = temp();
  const ready = await runWorkflow({ out: missingOut, kind: "empty", answers: answers(SHOW), fetchImpl: fetchImpl(), scaffoldImpl: scaffold });
  const empty = recordImplementation(missingOut, { goal: SHOW, files: [] });
  assert.equal(empty.success, false);
  assert.equal(empty.state, "not-yet-implemented");
  assert.notEqual(step(missingOut, "tests").status, "done");
  const swapped = recordImplementation(missingOut, { goal: "A different goal", files: ["src/main.tsx"] });
  assert.equal(swapped.state, "not-yet-implemented");
  fs.writeFileSync(path.join(ready.project, "src", "Wrong.tsx"), "export function Wrong(){ const layers = { activeLayers: [] }; return <p className=\"status\">{layers.activeLayers} Rename selected layers</p>; }\n");
  const replaced = recordImplementation(missingOut, { goal: SHOW, files: ["src/Wrong.tsx"] });
  assert.equal(replaced.success, false);
  assert.equal(replaced.state, "not-yet-implemented");
  assert.match(replaced.say, /rename fixture/);
  assert.equal(readReport(missingOut).success, false);

  const failedOut = temp();
  const failedReady = await runWorkflow({ out: failedOut, kind: "empty", answers: answers(SHOW), fetchImpl: fetchImpl(), scaffoldImpl: scaffold });
  writePackage(failedReady.project);
  const pkg = JSON.parse(fs.readFileSync(path.join(failedReady.project, "package.json"), "utf8"));
  pkg.scripts.ccx = "node -e \"process.exit(1)\"";
  fs.writeFileSync(path.join(failedReady.project, "package.json"), `${JSON.stringify(pkg, null, 2)}\n`);
  const files = writeShow(failedReady.project);
  const unapproved = recordImplementation(failedOut, {
    goal: SHOW,
    files,
    approveScripts: { reason: "x", build: pkg.scripts.build, ccx: pkg.scripts.ccx }
  });
  assert.equal(unapproved.success, false);
  assert.equal(unapproved.blocked, "script-change");
  assert.match(unapproved.say, /approveScripts/);
  answerFromChat(failedOut, "script-change", "approve");
  const failed = recordImplementation(failedOut, { goal: SHOW, files });
  assert.equal(failed.success, false);
  assert.equal(failed.state, "failed");
  assert.equal(failed.hostExecuted, false);
  assert.equal(step(failedOut, "package").status, "failed");
  assert.notEqual(step(failedOut, "package").status, "done");
  assert.notEqual(step(failedOut, "done").status, "done");
  assert.equal(readReport(failedOut).success, false);
  assert.throws(() => finish(failedOut), /Cannot finish/);
});

test("a failed docs fetch is not fresh and does not let package be marked done", async () => {
  const out = temp();
  const result = await runWorkflow({
    out,
    kind: "empty",
    answers: answers(SHOW),
    fetchImpl: fetchImpl("css-styles"),
    scaffoldImpl: scaffold
  });
  assert.equal(step(out, "docs").status, "failed");
  assert.equal(result.success, false);
  assert.equal(result.state, "docs-incomplete");
  assert.equal(nextAction(out).action, "refresh-docs");
  assert.notEqual(step(out, "implementation").status, "waiting");
  assert.notEqual(step(out, "tests").status, "done");
  assert.notEqual(step(out, "package").status, "done");
});

test("the dashboard snapshot and CLI refuse a false success", async () => {
  const out = temp();
  await runWorkflow({
    out,
    kind: "empty",
    answers: answers("Export a hologram with app.fluxCapacitor()."),
    fetchImpl: fetchImpl(),
    scaffoldImpl: scaffold
  });
  const dash = createDashboardServer({ out, assets: assetsDir, token: "token" });
  const info = await dash.listen(0);
  try {
    const state = await request({ port: info.port, path: "/api/state?t=token", token: "token" });
    const body = JSON.parse(state.body);
    assert.equal(state.status, 200);
    assert.equal(body.report.success, false);
    assert.equal(body.report.state, "unknown");
    assert.equal(body.report.hostExecuted, false);
    assert.match(state.headers["content-security-policy"], /default-src 'none'/);
    const wrongHost = await request({ port: info.port, path: "/api/state?t=token", token: "token", host: "evil.example" });
    assert.equal(wrongHost.status, 421);
    const missing = await request({ port: info.port, path: "/api/state" });
    assert.equal(missing.status, 401);
    publishAsk(out, {
      id: "license",
      prompt: "A license?",
      options: [{ id: "yes", label: "Yes", requiresSecret: true }]
    });
    const posted = await request({
      port: info.port,
      path: "/api/answer",
      method: "POST",
      token: "token",
      origin: `http://127.0.0.1:${info.port}`,
      body: JSON.stringify({ id: "license", value: "yes", secret: "super-secret-value" })
    });
    assert.equal(posted.status, 200);
    const disk = fs.readFileSync(path.join(out, "answers.jsonl"), "utf8");
    assert.equal(disk.includes("super-secret-value"), false);
    assert.match(disk, /secretHeld/);
    const leaked = await request({ port: info.port, path: "/api/secret?id=license", token: "token" });
    assert.equal(leaked.status, 403);
    assert.equal(leaked.body.includes("super-secret-value"), false);
  } finally {
    await dash.close();
  }

  const cli = spawnSync(process.execPath, [
    ".claude/skills/uxp-assistant/scripts/session.mjs",
    "show",
    "--out",
    out
  ], { encoding: "utf8" });
  const shown = JSON.parse(cli.stdout);
  assert.equal(shown.success, false);
  assert.equal(shown.ok, false);
  assert.equal(shown.hostExecuted, false);
  assert.equal(cli.status, 2);
  const marked = spawnSync(process.execPath, [
    ".claude/skills/uxp-assistant/scripts/session.mjs",
    "step",
    "--id",
    "package",
    "--status",
    "done",
    "--out",
    out
  ], { encoding: "utf8" });
  assert.equal(marked.status, 1);
  assert.match(marked.stdout, /Refusing to mark package done/);
});

test("a documented document title and Premiere importFiles are handoffs, not a dead end", async () => {
  const titleOut = temp();
  const title = await runWorkflow({
    out: titleOut,
    kind: "empty",
    answers: answers("Show the active document title in the panel."),
    fetchImpl: fetchImpl(),
    scaffoldImpl: scaffold
  });
  assert.equal(title.state, "awaiting-agent-implementation");
  assert.equal(title.fixture, null);
  assert.match(title.contract.handoff, /writes this goal/);
  assert.match(JSON.stringify(title.contract.evidence), /Document title/i);
  fs.mkdirSync(path.join(title.project, "test"), { recursive: true });
  fs.writeFileSync(path.join(title.project, "src", "document-title.mjs"), `export async function readDocumentTitle(app) {
  if (!app || !app.activeDocument) return { ok: false, status: "No document is open." };
  return { ok: true, status: "Read document.title outside executeAsModal.", title: app.activeDocument.title };
}
`);
  fs.writeFileSync(path.join(title.project, "src", "DocumentTitle.tsx"), `export function DocumentTitlePanel() {
  return <section><h1>Document title</h1><p className="status">Idle</p><button type="button" disabled={false}>Read title</button></section>;
}
`);
  fs.writeFileSync(path.join(title.project, "test", "document-title.test.mjs"), `import assert from "node:assert/strict";
import { test } from "node:test";
import { readDocumentTitle } from "../src/document-title.mjs";
test("readDocumentTitle reports a missing document", async () => {
  const result = await readDocumentTitle(null);
  assert.equal(result.ok, false);
});
`);
  const recorded = recordImplementation(titleOut, { goal: "Show the active document title in the panel.", files: ["src/document-title.mjs", "src/DocumentTitle.tsx"] });
  assert.equal(recorded.success, true);
  assert.equal(recorded.hostExecuted, false);
  assert.match(recorded.limits, /not semantic proof/);

  const premiereOut = temp();
  const premiere = await runWorkflow({
    out: premiereOut,
    kind: "existing",
    projectPath: title.project,
    answers: answers("Import files into the active Premiere project with importFiles.", { host: "ppro", framework: "react" }),
    fetchImpl: fetchImpl()
  });
  assert.equal(premiere.state, "awaiting-agent-implementation");
  assert.equal(premiere.fixture, null);
  assert.match(JSON.stringify(premiere.contract.evidence), /importFiles/);
  assert.doesNotMatch(premiere.contract.handoff, /Do not write feature code/);
});

test("a stock error module and a no-op test cannot finish the feature", async () => {
  const out = temp();
  const result = await runWorkflow({ out, kind: "empty", answers: answers(SHOW), fetchImpl: fetchImpl(), scaffoldImpl: scaffold });
  const pkgPath = path.join(result.project, "package.json");
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  pkg.scripts.test = "node -e \"process.exit(0)\"";
  fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
  const stock = recordImplementation(out, { goal: SHOW, files: ["src/api/errors.ts"] });
  assert.equal(stock.success, false);
  assert.notEqual(stock.state, "commands-finished");
  fs.writeFileSync(path.join(result.project, "src", "Stub.tsx"), "export const label = \"status: not the feature\";\n<button type=\"button\" disabled>Go</button>\n");
  const stub = recordImplementation(out, { goal: SHOW, files: ["src/Stub.tsx"] });
  assert.equal(stub.success, false);
  assert.match(stub.say, /documented symbol|stock file|feature/);
});

test("drop removes only the assessed listener files", async () => {
  const out = temp();
  const project = path.join(out, "existing");
  fs.mkdirSync(path.join(project, "src", "legacy"), { recursive: true });
  fs.mkdirSync(path.join(project, "bridge"), { recursive: true });
  fs.mkdirSync(path.join(project, "jsx"), { recursive: true });
  fs.writeFileSync(path.join(project, "src", "App.tsx"), "export function App(){ return <main>Keep</main>; }\n");
  fs.writeFileSync(path.join(project, "bridge", "listen.js"), "var cs = new CSInterface();\ncs.addEventListener(\"a\", function(){});\n");
  fs.writeFileSync(path.join(project, "src", "legacy", "cep-bridge.js"), "var cs = new CSInterface();\ncs.addEventListener(\"b\", function(){});\ncs.evalScript(\"1\");\n");
  fs.writeFileSync(path.join(project, "jsx", "rename.jsx"), "layer.name = \"same\";\n");
  fs.writeFileSync(path.join(project, "src", "unrelated.js"), "export const keep = true;\n");
  const result = await runWorkflow({
    out,
    kind: "existing",
    projectPath: project,
    answers: answers(SHOW, { "keep-listener": "drop" }),
    fetchImpl: fetchImpl()
  });
  assert.equal(result.success, false);
  assert.equal(fs.existsSync(path.join(project, "bridge", "listen.js")), false);
  assert.equal(fs.existsSync(path.join(project, "src", "legacy", "cep-bridge.js")), false);
  assert.equal(fs.existsSync(path.join(project, "jsx", "rename.jsx")), true);
  assert.equal(fs.existsSync(path.join(project, "src", "unrelated.js")), true);
  assert.equal(fs.existsSync(path.join(project, "src", "App.tsx")), true);
});

test("an existing project without a host does not skip host pages", async () => {
  const out = temp();
  const project = path.join(out, "existing");
  fs.mkdirSync(project, { recursive: true });
  fs.writeFileSync(path.join(project, "src-placeholder.js"), "export const keep = 1;\n");
  const result = await runWorkflow({
    out,
    kind: "existing",
    projectPath: project,
    answers: answers(SHOW, { host: "" }),
    fetchImpl: fetchImpl()
  });
  assert.equal(result.blocked, "host");
  assert.equal(result.success, false);
});

test("importFiles missing from the Premiere index is resolved from the official class page", async () => {
  const out = temp();
  const project = path.join(out, "existing");
  fs.mkdirSync(project, { recursive: true });
  fs.writeFileSync(path.join(project, "src.js"), "export const keep = 1;\n");
  const tree = {
    tree: [
      { type: "blob", path: "src/pages/ppro-reference/index.md" },
      { type: "blob", path: "src/pages/ppro-reference/classes/project.md" }
    ]
  };
  const markdown = "# Project\n\n### importFiles\n\nImport files into the project.\n";
  const result = await runWorkflow({
    out,
    kind: "existing",
    projectPath: project,
    answers: answers("Import files into the active Premiere project with importFiles.", { host: "ppro" }),
    fetchImpl: async (url) => {
      const target = String(url);
      if (target.includes("/git/trees/")) return { ok: true, async text() { return JSON.stringify(tree); } };
      if (target.endsWith("/classes/project.md")) return { ok: true, async text() { return markdown; } };
      return { ok: true, async text() { return "Premiere API overview. The method list is on the class pages."; } };
    }
  });
  assert.equal(result.state, "awaiting-agent-implementation");
  assert.equal(result.fixture, null);
  assert.match(JSON.stringify(result.contract.evidence), /importFiles/);
  assert.match(JSON.stringify(result.contract.evidence), /ppro-reference\/classes\/project/);
  assert.doesNotMatch(result.contract.handoff, /Do not write feature code/);
});

test("static text, comment-only API, a noop assertion, and starter tokens do not finish", async () => {
  const phrase = "Show the active document title in the panel.";
  const out = temp();
  const ready = await runWorkflow({ out, kind: "empty", answers: answers(phrase), fetchImpl: fetchImpl(), scaffoldImpl: scaffold });
  fs.writeFileSync(path.join(ready.project, "src", "TitleStub.tsx"), "export function TitleStub(){ return <p className=\"status\">document title stays on this static panel</p>; }\n");
  fs.mkdirSync(path.join(ready.project, "test"), { recursive: true });
  fs.writeFileSync(path.join(ready.project, "test", "title-stub.test.mjs"), "import { test } from \"node:test\"; import assert from \"node:assert/strict\"; test(\"mentions TitleStub\", () => { assert.equal(1, 1); });\n");
  const stub = recordImplementation(out, { goal: phrase, files: ["src/TitleStub.tsx"] });
  assert.equal(stub.success, false);
  assert.notEqual(stub.state, "commands-finished");
  assert.match(stub.say, /documented API|static panel|not commands-finished/);
  const shown = spawnSync(process.execPath, [".claude/skills/uxp-assistant/scripts/session.mjs", "show", "--out", out], { encoding: "utf8" });
  assert.notEqual(shown.status, 0);
  const done = spawnSync(process.execPath, [".claude/skills/uxp-assistant/scripts/session.mjs", "done", "--out", out], { encoding: "utf8" });
  assert.notEqual(done.status, 0);

  const commented = temp();
  const commentReady = await runWorkflow({ out: commented, kind: "empty", answers: answers(phrase), fetchImpl: fetchImpl(), scaffoldImpl: scaffold });
  fs.mkdirSync(path.join(commentReady.project, "test"), { recursive: true });
  fs.writeFileSync(path.join(commentReady.project, "src", "TitleStub.tsx"), "/* import { read } from \"./title-read.mjs\"; app.activeDocument.title */\nexport function TitleStub(){ return <p className=\"status\">document title stays on this static panel</p>; }\n");
  fs.writeFileSync(path.join(commentReady.project, "src", "title-read.mjs"), "/* document.title */\nexport function readTitle(){ return { status: \"static\" }; }\n");
  fs.writeFileSync(path.join(commentReady.project, "test", "title-stub.test.mjs"), "/* import { readTitle } from \"../src/title-read.mjs\"; */\nimport { test } from \"node:test\"; import assert from \"node:assert/strict\"; test(\"noop\", () => { assert.equal(1, 1); });\n");
  const comments = recordImplementation(commented, { goal: phrase, files: ["src/TitleStub.tsx", "src/title-read.mjs"] });
  assert.equal(comments.success, false);
  assert.match(comments.say, /comment|static panel|documented API|import/);

  const named = temp();
  const namedReady = await runWorkflow({ out: named, kind: "empty", answers: answers(phrase), fetchImpl: fetchImpl(), scaffoldImpl: scaffold });
  fs.mkdirSync(path.join(namedReady.project, "src"), { recursive: true });
  fs.mkdirSync(path.join(namedReady.project, "test"), { recursive: true });
  fs.writeFileSync(path.join(namedReady.project, "src", "title-read.mjs"), "export function readTitle(app){ if (!app || !app.activeDocument) return { ok: false, status: \"No document.\" }; return { ok: true, status: \"Read\", title: app.activeDocument.title }; }\n");
  fs.writeFileSync(path.join(namedReady.project, "src", "TitleStub.tsx"), "export function TitleStub(){ return <p className=\"status\">Idle</p>; }\n");
  fs.writeFileSync(path.join(namedReady.project, "test", "title-stub.test.mjs"), "import { test } from \"node:test\"; import assert from \"node:assert/strict\"; test(\"mentions TitleStub and skips the call\", () => { assert.equal(1, 1); });\n");
  const mention = recordImplementation(named, { goal: phrase, files: ["src/title-read.mjs", "src/TitleStub.tsx"] });
  assert.equal(mention.success, false);
  assert.match(mention.say, /import|assert\.equal\(1, 1\)|tautolog/);
});

test("a documented layer opacity feature finishes without being the document-title fixture", async () => {
  const goal = "Read each layer opacity in the panel.";
  const out = temp();
  const ready = await runWorkflow({ out, kind: "empty", answers: answers(goal), fetchImpl: fetchImpl(), scaffoldImpl: scaffold });
  assert.equal(ready.state, "awaiting-agent-implementation");
  assert.equal(ready.fixture, null);
  assert.doesNotMatch(ready.contract.goal, /document title/i);
  fs.mkdirSync(path.join(ready.project, "test"), { recursive: true });
  fs.writeFileSync(path.join(ready.project, "src", "opacity.mjs"), "export function readOpacity(layer){ if (!layer) return { ok: false, status: \"No layer.\" }; return { ok: true, status: \"Read\", opacity: layer.opacity }; }\n");
  fs.writeFileSync(path.join(ready.project, "src", "Opacity.tsx"), "export function OpacityPanel(){ return <section><h1>Layer opacity</h1><p className=\"status\">Idle</p><button type=\"button\" disabled={false}>Read opacity</button></section>; }\n");
  fs.writeFileSync(path.join(ready.project, "test", "opacity.test.mjs"), "import assert from \"node:assert/strict\"; import { test } from \"node:test\"; import { readOpacity } from \"../src/opacity.mjs\"; test(\"readOpacity returns the documented property\", () => { assert.equal(readOpacity({ opacity: 40 }).opacity, 40); assert.equal(readOpacity(null).ok, false); });\n");
  const recorded = recordImplementation(out, { goal, files: ["src/opacity.mjs", "src/Opacity.tsx"] });
  assert.equal(recorded.success, true, recorded.say);
  assert.equal(recorded.hostExecuted, false);
  assert.equal(recorded.featureCorrectness, "not-decided");
  assert.equal(recorded.sourceReview, "pending");
  assert.match(recorded.limits, /not feature correctness/);
  assert.match(recorded.package.reviews.map((item) => item.matched.join(" ")).join(" "), /opacity/);
});

test("a swapped ccx command is not run, and every new archive is reviewed", async () => {
  const out = temp();
  const ready = await runWorkflow({ out, kind: "empty", answers: answers(SHOW), fetchImpl: fetchImpl(), scaffoldImpl: scaffold });
  writeShow(ready.project);
  const pkgPath = path.join(ready.project, "package.json");
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  pkg.scripts.ccx = "node -e \"require('fs').writeFileSync('decoy.ccx','not a package')\"";
  fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
  const swapped = recordImplementation(out, { goal: SHOW, files: ["src/Selection.tsx", "src/selection-read.mjs"] });
  assert.equal(swapped.success, false);
  assert.match(swapped.say, /ccx/);
  assert.equal(fs.existsSync(path.join(ready.project, "decoy.ccx")), false);

  const two = temp();
  const twoReady = await runWorkflow({
    out: two,
    kind: "empty",
    answers: answers(SHOW),
    fetchImpl: fetchImpl(),
    scaffoldImpl: async (parent, intake) => {
      const created = await scaffold(parent, intake);
      const mod = pathToFileURL(path.resolve(".claude/skills/uxp-assistant/scripts/lib/archive.mjs")).href;
      fs.writeFileSync(path.join(created.folder, "pack.mjs"), `import fs from "node:fs";
import { writeStoredZip } from ${JSON.stringify(mod)};
function walk(dir, acc = []) {
  for (const name of fs.readdirSync(dir)) {
    const full = dir + "/" + name;
    if (fs.statSync(full).isDirectory()) walk(full, acc);
    else acc.push(full);
  }
  return acc;
}
const entries = walk("src").map((name) => ({ name, data: fs.readFileSync(name) }));
writeStoredZip("aaa-decoy.ccx", entries);
writeStoredZip("zzz-empty.ccx", [{ name: "note.txt", data: Buffer.from("no feature") }]);
`);
      return created;
    }
  });
  writeShow(twoReady.project);
  const both = recordImplementation(two, { goal: SHOW, files: ["src/Selection.tsx", "src/selection-read.mjs"] });
  assert.equal(both.success, false);
  assert.match(both.say, /zzz-empty\.ccx/);
  assert.ok((both.package?.reviews || []).length >= 2);

  const declared = temp();
  const declaredReady = await runWorkflow({ out: declared, kind: "empty", answers: answers(SHOW), fetchImpl: fetchImpl(), scaffoldImpl: scaffold });
  writeShow(declaredReady.project);
  const subset = recordImplementation(declared, { goal: SHOW, files: ["src/Selection.tsx", "src/selection-read.mjs"], outputArchives: ["aaa-decoy.ccx"] });
  assert.equal(subset.success, false);
  assert.match(subset.say, /declared archive set/);

  const prior = temp();
  const priorReady = await runWorkflow({
    out: prior,
    kind: "empty",
    answers: answers(SHOW),
    fetchImpl: fetchImpl(),
    scaffoldImpl: async (parent, intake) => {
      const created = await scaffold(parent, intake);
      fs.writeFileSync(path.join(created.folder, "aaa-decoy.ccx"), "not-a-zip-but-present");
      return created;
    }
  });
  writeShow(priorReady.project);
  const kept = recordImplementation(prior, { goal: SHOW, files: ["src/Selection.tsx", "src/selection-read.mjs"] });
  assert.equal(kept.success, true);
  assert.equal(kept.hostExecuted, false);
  assert.ok((kept.package.preexisting || []).some((item) => item.file === "aaa-decoy.ccx"));
  assert.ok((kept.package.reviews || []).every((item) => item.file !== "aaa-decoy.ccx"));
  assert.ok((kept.package.reviews || []).some((item) => item.file === "out.ccx"));
});

test("an approved build command is recorded as a change, and a starter-only zip is not the feature", async () => {
  const out = temp();
  const ready = await runWorkflow({ out, kind: "empty", answers: answers(SHOW), fetchImpl: fetchImpl(), scaffoldImpl: scaffold });
  writeShow(ready.project);
  const mod = pathToFileURL(path.resolve(".claude/skills/uxp-assistant/scripts/lib/archive.mjs")).href;
  fs.copyFileSync(path.join(ready.project, "pack.mjs"), path.join(ready.project, "pack-approved.mjs"));
  const pkgPath = path.join(ready.project, "package.json");
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  pkg.scripts.ccx = "node pack-approved.mjs";
  fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
  const silent = recordImplementation(out, {
    goal: SHOW,
    files: ["src/Selection.tsx", "src/selection-read.mjs"],
    approveScripts: { build: pkg.scripts.build, ccx: pkg.scripts.ccx, reason: "x" }
  });
  assert.equal(silent.success, false);
  assert.equal(silent.blocked, "script-change");
  assert.match(silent.say, /approveScripts|not a session answer/);
  assert.equal(fs.existsSync(path.join(ready.project, "out.ccx")), false);
  answerFromChat(out, "script-change", "approve");
  const approved = recordImplementation(out, { goal: SHOW, files: ["src/Selection.tsx", "src/selection-read.mjs"] });
  assert.equal(approved.success, true);
  assert.equal(approved.package.provenance, "session-answer");
  assert.equal(approved.featureCorrectness, "not-decided");

  const body = temp();
  const bodyReady = await runWorkflow({ out: body, kind: "empty", answers: answers(SHOW), fetchImpl: fetchImpl(), scaffoldImpl: scaffold });
  writeShow(bodyReady.project);
  const packPath = path.join(bodyReady.project, "pack.mjs");
  const originalPack = fs.readFileSync(packPath, "utf8");
  fs.writeFileSync(path.join(bodyReady.project, "pack-step.mjs"), "import fs from \"node:fs\";\nfs.writeFileSync(\"packer-body-ran.txt\", \"ran\");\n");
  fs.writeFileSync(packPath, `import "./pack-step.mjs";\n${originalPack}`);
  fs.writeFileSync(path.join(bodyReady.project, "APPROVED.md"), "approveScripts reason x. This file is not a session answer.\n");
  const sameCommand = JSON.parse(fs.readFileSync(path.join(bodyReady.project, "package.json"), "utf8"));
  const forged = recordImplementation(body, {
    goal: SHOW,
    files: ["src/Selection.tsx", "src/selection-read.mjs"],
    approveScripts: { build: sameCommand.scripts.build, ccx: sameCommand.scripts.ccx, reason: "x" }
  });
  assert.equal(forged.success, false);
  assert.equal(forged.blocked, "script-change");
  assert.equal(fs.existsSync(path.join(bodyReady.project, "packer-body-ran.txt")), false);
  const asked = readSession(body).asks.find((item) => item.id === "script-change");
  assert.ok(asked.scope.files.some((item) => item.name === "pack.mjs"));
  assert.ok(asked.scope.files.some((item) => item.name === "pack-step.mjs"));
  assert.equal(asked.scope.commands.length, 0);
  answerFromChat(body, "script-change", "approve");
  const ran = recordImplementation(body, { goal: SHOW, files: ["src/Selection.tsx", "src/selection-read.mjs"] });
  assert.equal(ran.success, true, ran.say);
  assert.equal(ran.package.provenance, "session-answer");
  assert.equal(fs.readFileSync(path.join(bodyReady.project, "packer-body-ran.txt"), "utf8"), "ran");
  fs.writeFileSync(path.join(bodyReady.project, "pack-step.mjs"), "import fs from \"node:fs\";\nfs.writeFileSync(\"packer-body-again.txt\", \"again\");\n");
  const stale = recordImplementation(body, {
    goal: SHOW,
    files: ["src/Selection.tsx", "src/selection-read.mjs"],
    approveScripts: { build: sameCommand.scripts.build, ccx: sameCommand.scripts.ccx, reason: "x" }
  });
  assert.equal(stale.success, false);
  assert.equal(stale.blocked, "script-change");
  assert.equal(fs.existsSync(path.join(bodyReady.project, "packer-body-again.txt")), false);

  const starter = temp();
  const starterReady = await runWorkflow({
    out: starter,
    kind: "empty",
    answers: answers(SHOW),
    fetchImpl: fetchImpl(),
    scaffoldImpl: async (parent, intake) => {
      const created = await scaffold(parent, intake);
      fs.writeFileSync(path.join(created.folder, "pack.mjs"), `import fs from "node:fs";
import { writeStoredZip } from ${JSON.stringify(mod)};
writeStoredZip("out.ccx", [{ name: "src/main.tsx", data: fs.readFileSync("src/main.tsx") }]);
`);
      return created;
    }
  });
  writeShow(starterReady.project);
  const tokens = recordImplementation(starter, { goal: SHOW, files: ["src/Selection.tsx", "src/selection-read.mjs"] });
  assert.equal(tokens.success, false);
  assert.match(tokens.say, /useState|uxp\.entrypoints|documented API symbol/);
});

function request({ port, path: pathname, host, origin, token, method = "GET", body }) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: "127.0.0.1",
      port,
      path: pathname,
      method,
      headers: {
        host: host || `127.0.0.1:${port}`,
        ...(origin ? { origin } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(body ? { "content-type": "application/json", "content-length": Buffer.byteLength(body) } : {})
      }
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}
