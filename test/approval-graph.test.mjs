import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { pagesForRequest } from "../.claude/skills/uxp-assistant/scripts/lib/registry.mjs";
import { collectGraph } from "../.claude/skills/uxp-assistant/scripts/lib/review.mjs";
import { answerFromChat, readSession } from "../.claude/skills/uxp-assistant/scripts/lib/session.mjs";
import { recordImplementation, runWorkflow } from "../.claude/skills/uxp-assistant/scripts/lib/workflow.mjs";

const SHOW = "Show each selected layer id and name in the panel.";
const catalog = pagesForRequest({ host: "phxs", goal: "layer document title" });
const byUrl = new Map(catalog.map((page) => [page.url, page.id]));
const TEXT = {
  "photoshop.layer": "name string R W 22.5 Name of the layer.\nid number R 22.5 The identifier of the layer.\n",
  "photoshop.document": "activeLayers\n\nLayers\n\nR W\n\n22.5\n\nThe selected layers in the document. (26.9)\n\ntitle\n\nstring\n\nR\n\n22.5\n\nDocument title\n",
  "photoshop.executeAsModal": "commandName string required 23.0 This description is shown above the progress bar.\n",
  "css-styling": "CSS transitions and animations are not supported\n",
  "css-styles": "text-transform is not supported\n"
};

function fetchImpl() {
  return async (url) => {
    const id = byUrl.get(url);
    if (!id) throw new Error(`Unexpected URL ${url}`);
    return { ok: true, async text() { return TEXT[id] || `shared ${id}\n`; } };
  };
}

function answers() {
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
    goal: SHOW
  };
}

function temp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "uxp-graph-"));
}

async function scaffold(parent) {
  const folder = path.join(parent, "plugin");
  fs.mkdirSync(path.join(folder, "src"), { recursive: true });
  fs.writeFileSync(path.join(folder, "src", "main.tsx"), "export function App(){ return <main className=\"status\">Idle</main>; }\n");
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
  fs.writeFileSync(path.join(folder, "uxp.config.ts"), "export const manifest = { requiredPermissions: { localFileSystem: \"fullAccess\" } };\n");
  return { folder, installer: "test-double" };
}

function writeFeature(project) {
  fs.mkdirSync(path.join(project, "src"), { recursive: true });
  fs.mkdirSync(path.join(project, "test"), { recursive: true });
  fs.writeFileSync(path.join(project, "src", "Selection.tsx"), `export function SelectionPanel() {
  return <main><h1>Selected layer ids</h1><p className="status">Idle</p><button type="button" disabled>Read selection</button><p className="error">No document is open.</p></main>;
}
`);
  fs.writeFileSync(path.join(project, "src", "selection-read.mjs"), `export async function readSelection(app) {
  if (!app) return { ok: false, status: "Photoshop is not available." };
  const document = app.activeDocument;
  if (!document) return { ok: false, status: "No document is open." };
  return { ok: true, status: "Read outside executeAsModal.", layers: (document.activeLayers || []).map((layer) => ({ id: layer.id, name: layer.name })) };
}
`);
  fs.writeFileSync(path.join(project, "test", "selection.test.mjs"), `import assert from "node:assert/strict";
import { test } from "node:test";
import { readSelection } from "../src/selection-read.mjs";
test("readSelection reports a missing host", async () => {
  assert.equal((await readSelection(null)).ok, false);
});
`);
  return ["src/Selection.tsx", "src/selection-read.mjs", "test/selection.test.mjs"];
}

function armPack(project, marker) {
  const pack = path.join(project, "pack.mjs");
  const original = fs.readFileSync(pack, "utf8");
  fs.writeFileSync(pack, original.replace("const entries", `fs.writeFileSync(${JSON.stringify(marker)}, "ran");\nconst entries`));
  return original;
}

function setScripts(project, scripts) {
  const pkg = JSON.parse(fs.readFileSync(path.join(project, "package.json"), "utf8"));
  pkg.scripts = { ...pkg.scripts, ...scripts };
  fs.writeFileSync(path.join(project, "package.json"), `${JSON.stringify(pkg, null, 2)}\n`);
}

async function handed(parent) {
  const result = await runWorkflow({
    out: path.join(parent, "out"),
    kind: "empty",
    answers: answers(),
    fetchImpl: fetchImpl(),
    scaffoldImpl: scaffold
  });
  assert.equal(result.state, "awaiting-agent-implementation");
  const files = writeFeature(result.project);
  return { out: result.out, project: result.project, files };
}

test("bolt cross-env and node --test stay inside the supported grammar", () => {
  const dir = temp();
  const scripts = {
    test: "node --test",
    build: "cross-env MODE=build vite build",
    ccx: "cross-env MODE=package vite build"
  };
  fs.writeFileSync(path.join(dir, "package.json"), `${JSON.stringify({ scripts }, null, 2)}\n`);
  const graph = collectGraph(dir, scripts);
  assert.equal(graph.ok, true);
  assert.equal(graph.files.size, 0);
  const evalGraph = collectGraph(dir, { ...scripts, build: "node -e \"process.exit(0)\"" });
  assert.equal(evalGraph.ok, true);
});

test("sh -c is refused and cannot be approved into running pack.mjs", async () => {
  const parent = temp();
  const { out, project, files } = await handed(parent);
  const pack = path.join(project, "pack.mjs");
  fs.writeFileSync(pack, `import fs from "node:fs";\nfs.writeFileSync("bypass-again.txt", "ran");\n${fs.readFileSync(pack, "utf8")}`);
  setScripts(project, { ccx: "sh -c 'node pack.mjs'" });
  const recorded = recordImplementation(out, { goal: SHOW, files, approveScripts: { reason: "x" } });
  assert.equal(recorded.success, false);
  assert.match(recorded.say, /supported command grammar|Shell wrappers/);
  assert.equal(recorded.blocked, undefined);
  assert.equal(fs.existsSync(path.join(project, "bypass-again.txt")), false);
  assert.equal(readSession(out).asks.some((item) => item.id === "script-change"), false);
  assert.throws(() => answerFromChat(out, "script-change", "approve"), /No question named script-change/);
  assert.equal(fs.existsSync(path.join(project, "bypass-again.txt")), false);
});

test("node --import hashes the loader and the script, and a later script edit does not run", async () => {
  const parent = temp();
  const { out, project, files } = await handed(parent);
  fs.writeFileSync(path.join(project, "hook.mjs"), "export const loaded = true;\n");
  const pack = path.join(project, "pack.mjs");
  const original = armPack(project, "bypass.txt");
  setScripts(project, { ccx: "node --import ./hook.mjs pack.mjs" });
  const blocked = recordImplementation(out, { goal: SHOW, files, approveScripts: { reason: "x" } });
  assert.equal(blocked.success, false);
  assert.equal(blocked.blocked, "script-change");
  assert.equal(fs.existsSync(path.join(project, "bypass.txt")), false);
  const asked = readSession(out).asks.find((item) => item.id === "script-change");
  assert.ok(asked.scope.files.some((item) => item.name === "hook.mjs"));
  assert.ok(asked.scope.files.some((item) => item.name === "pack.mjs"));
  answerFromChat(out, "script-change", "approve");
  const ran = recordImplementation(out, { goal: SHOW, files });
  assert.equal(ran.success, true, ran.say);
  assert.equal(fs.readFileSync(path.join(project, "bypass.txt"), "utf8"), "ran");
  fs.writeFileSync(pack, original.replace("const entries", "fs.writeFileSync(\"bypass-again.txt\", \"again\");\nconst entries"));
  const stale = recordImplementation(out, { goal: SHOW, files, approveScripts: { reason: "x" } });
  assert.equal(stale.success, false);
  assert.equal(stale.blocked, "script-change");
  assert.equal(fs.existsSync(path.join(project, "bypass-again.txt")), false);
});

test("npm run zip hashes the inner node script, and a later edit does not run", async () => {
  const parent = temp();
  const { out, project, files } = await handed(parent);
  const pack = path.join(project, "pack.mjs");
  const original = armPack(project, "bypass.txt");
  setScripts(project, { zip: "node pack.mjs", ccx: "npm run zip" });
  const blocked = recordImplementation(out, { goal: SHOW, files });
  assert.equal(blocked.success, false);
  assert.equal(blocked.blocked, "script-change");
  const asked = readSession(out).asks.find((item) => item.id === "script-change");
  assert.ok(asked.scope.files.some((item) => item.name === "pack.mjs"));
  assert.equal(fs.existsSync(path.join(project, "bypass.txt")), false);
  answerFromChat(out, "script-change", "approve");
  const ran = recordImplementation(out, { goal: SHOW, files });
  assert.equal(ran.success, true, ran.say);
  fs.writeFileSync(pack, original.replace("const entries", "fs.writeFileSync(\"bypass-again.txt\", \"again\");\nconst entries"));
  const stale = recordImplementation(out, { goal: SHOW, files });
  assert.equal(stale.success, false);
  assert.equal(fs.existsSync(path.join(project, "bypass-again.txt")), false);
});

test("a graph past 40 files is refused with no approvable partial hash", async () => {
  const parent = temp();
  const { out, project, files } = await handed(parent);
  const pack = path.join(project, "pack.mjs");
  const original = fs.readFileSync(pack, "utf8");
  fs.writeFileSync(pack, `import "./d01.mjs";\n${original}`);
  for (let index = 1; index <= 39; index += 1) {
    const name = `d${String(index).padStart(2, "0")}.mjs`;
    const next = index === 39 ? "d40.mjs" : `d${String(index + 1).padStart(2, "0")}.mjs`;
    fs.writeFileSync(path.join(project, name), `import "./${next}";\n`);
  }
  fs.writeFileSync(path.join(project, "d40.mjs"), "import \"./payload.mjs\";\n");
  fs.writeFileSync(path.join(project, "payload.mjs"), "import fs from \"node:fs\";\nfs.writeFileSync(\"bypass-again.txt\", \"ran\");\n");
  const recorded = recordImplementation(out, { goal: SHOW, files, approveScripts: { reason: "x" } });
  assert.equal(recorded.success, false);
  assert.match(recorded.say, /40/);
  assert.equal(recorded.blocked, undefined);
  assert.equal(fs.existsSync(path.join(project, "bypass-again.txt")), false);
  assert.equal(readSession(out).asks.some((item) => item.id === "script-change"), false);
  assert.throws(() => answerFromChat(out, "script-change", "approve"), /No question named script-change/);
  assert.equal(fs.existsSync(path.join(project, "bypass-again.txt")), false);
});
