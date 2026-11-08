import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { implementLayerRename } from "../.claude/skills/uxp-assistant/scripts/lib/implement.mjs";
import { nextAction } from "../.claude/skills/uxp-assistant/scripts/lib/next.mjs";
import { pagesForRequest } from "../.claude/skills/uxp-assistant/scripts/lib/registry.mjs";
import { createDashboardServer } from "../.claude/skills/uxp-assistant/scripts/lib/server.mjs";
import { assetsDir } from "../.claude/skills/uxp-assistant/scripts/lib/paths.mjs";
import { finish, publishAsk, readReport, readSession, setStep } from "../.claude/skills/uxp-assistant/scripts/lib/session.mjs";
import { recordImplementation, runWorkflow } from "../.claude/skills/uxp-assistant/scripts/lib/workflow.mjs";

const SHOW = "Show each selected layer id and name in the panel.";
const RENAME = "Rename each selected layer with a prefix, suffix, and padded sequence.";
const catalog = pagesForRequest({ host: "phxs", goal: "layer activeLayers" });
const byUrl = new Map(catalog.map((page) => [page.url, page.id]));
const TEXT = {
  "photoshop.layer": "name string R W 22.5 Name of the layer.\nid number R 22.5 The identifier of the layer.\n",
  "photoshop.document": "activeLayers Layers R W 22.5 The selected layers in the document. (26.9)\n",
  "photoshop.executeAsModal": "commandName string required 23.0 This description is shown above the progress bar.\nsuspendHistory 23.0\n",
  "photoshop.changelog": "set Document activeLayers by providing an array of Layer objects.\n",
  manifest: "Current UXP hosts use manifest version 5.\nminVersion is a required string.\n",
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

function answers(goal) {
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
    goal
  };
}

async function scaffold(parent, intake) {
  const folder = path.join(parent, "plugin");
  fs.mkdirSync(path.join(folder, "src"), { recursive: true });
  writePackage(folder, { ccx: "node -e \"require('fs').writeFileSync('out.ccx','PK')\"" });
  fs.writeFileSync(path.join(folder, "uxp.config.ts"), "export const manifest = {\n  host: [{ app: \"PS\", minVersion: \"24.2.0\" }],\n  requiredPermissions: {\n    localFileSystem: \"fullAccess\",\n  },\n};\n");
  fs.writeFileSync(path.join(folder, "src", "main.tsx"), "export const App = () => null;\n");
  fs.writeFileSync(path.join(folder, "implementation-note.txt"), intake.goal);
  return { folder, installer: "test-double" };
}

function writePackage(folder, scripts) {
  fs.writeFileSync(path.join(folder, "package.json"), `${JSON.stringify({
    name: "plugin",
    scripts: {
      test: "node -e \"process.exit(0)\"",
      build: "node -e \"process.exit(0)\"",
      ...scripts
    }
  }, null, 2)}\n`);
}

function writeShow(project) {
  fs.mkdirSync(path.join(project, "src"), { recursive: true });
  const panel = "src/Selection.tsx";
  const reader = "src/selection-read.mjs";
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
  return [panel, reader];
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
  assert.equal(recorded.success, true);
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
  writePackage(project, { ccx: "node -e \"require('fs').writeFileSync('out.ccx','PK')\"" });
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
  fs.writeFileSync(path.join(ready.project, "src", "Wrong.tsx"), "export const title = \"Rename selected layers\";\n<button disabled>Apply</button>\n");
  const replaced = recordImplementation(missingOut, { goal: SHOW, files: ["src/Wrong.tsx"] });
  assert.equal(replaced.success, false);
  assert.equal(replaced.state, "not-yet-implemented");
  assert.match(replaced.say, /rename fixture/);
  assert.equal(readReport(missingOut).success, false);

  const failedOut = temp();
  const failedReady = await runWorkflow({ out: failedOut, kind: "empty", answers: answers(SHOW), fetchImpl: fetchImpl(), scaffoldImpl: scaffold });
  writePackage(failedReady.project, { ccx: "node -e \"process.exit(1)\"" });
  const files = writeShow(failedReady.project);
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
  const files = writeShow(result.project);
  const recorded = recordImplementation(out, { goal: SHOW, files });
  assert.equal(recorded.success, false);
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
