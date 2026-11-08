import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { classifyDomain } from "../.claude/skills/uxp-assistant/scripts/lib/cep/domains.mjs";
import { extractDocFacts } from "../.claude/skills/uxp-assistant/scripts/lib/cep/docs-facts.mjs";
import { processNeedsHybrid, collectProcessCalls } from "../.claude/skills/uxp-assistant/scripts/lib/cep/signals.mjs";
import { pagesForRequest } from "../.claude/skills/uxp-assistant/scripts/lib/registry.mjs";
import { scaffoldWithInstaller } from "../.claude/skills/uxp-assistant/scripts/lib/scaffold.mjs";
import { runWorkflow } from "../.claude/skills/uxp-assistant/scripts/lib/workflow.mjs";

const SHOW = "Show each selected layer id and name in the panel.";
const catalog = pagesForRequest({ host: "phxs", goal: "layer document title" });
const byUrl = new Map(catalog.map((page) => [page.url, page.id]));
const TEXT = {
  "photoshop.layer": "name string R W 22.5 Name of the layer.\n",
  "photoshop.document": "activeLayers\n\nLayers\n\nR W\n\n22.5\n\nThe selected layers in the document. (26.9)\n",
  "css-styling": "CSS transitions and animations are not supported\n",
  "css-styles": "text-transform is not supported\n"
};

function temp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "uxp-stages-"));
}

function fetchImpl(pageText = {}) {
  return async (url) => {
    const id = byUrl.get(url);
    if (!id) throw new Error(`Unexpected URL ${url}`);
    if (pageText[id] === false) throw new Error("offline");
    return { ok: true, async text() { return pageText[id] || TEXT[id] || `shared ${id}\n`; } };
  };
}

function answers(extra = {}) {
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
    goal: SHOW,
    ...extra
  };
}

async function scaffold(parent, intake) {
  const folder = path.join(parent, "plugin");
  fs.mkdirSync(path.join(folder, "src"), { recursive: true });
  fs.writeFileSync(path.join(folder, "src", "main.tsx"), "export function App(){ return <main className=\"status\">Idle</main>; }\n");
  fs.writeFileSync(path.join(folder, "uxp.config.ts"), "export const manifest = { requiredPermissions: { localFileSystem: \"fullAccess\" } };\n");
  fs.writeFileSync(path.join(folder, "flags.json"), JSON.stringify({ webview: intake.webview, hybrid: intake.hybrid }));
  return { folder, installer: "test-double", webview: intake.webview, hybrid: intake.hybrid };
}

test("cep facts classify a webview page, a domain, and a non-opener process", () => {
  const facts = extractDocFacts("HTMLWebViewElement allowLocalRendering\nCSS transitions and animations are not supported");
  assert.equal(facts.webview, true);
  assert.ok(facts.limits.includes("css-animations"));
  assert.equal(extractDocFacts("shared webview").webview, false);
  assert.equal(classifyDomain("https://*.adobe.com").ok, true);
  assert.equal(classifyDomain("https://adobe.*").ok, false);
  assert.equal(processNeedsHybrid(collectProcessCalls("cep.process.createProcess('/usr/bin/open')")), false);
  assert.equal(processNeedsHybrid(collectProcessCalls("cep.process.createProcess('node')")), true);
});

test("staged choices block before edits, and native is not a hidden webview default", async () => {
  const missingRuntime = await runWorkflow({
    out: temp(),
    kind: "empty",
    answers: answers({ runtime: "" }),
    fetchImpl: fetchImpl(),
    scaffoldImpl: scaffold
  });
  assert.equal(missingRuntime.blocked, "runtime");
  assert.equal(fs.existsSync(path.join(missingRuntime.out, "work")), false);

  const unknown = await runWorkflow({
    out: temp(),
    kind: "empty",
    answers: answers({ goal: "Export a hologram with app.fluxCapacitor()." }),
    fetchImpl: fetchImpl(),
    scaffoldImpl: scaffold
  });
  assert.equal(unknown.state, "unknown");
  assert.match(unknown.say, /continue is not offered/);
  assert.equal(fs.existsSync(path.join(unknown.out, "work")), false);

  const webOut = temp();
  const web = await runWorkflow({
    out: webOut,
    kind: "empty",
    answers: answers({ runtime: "webview" }),
    fetchImpl: fetchImpl({ webview: "HTMLWebViewElement allowLocalRendering plugin:/" }),
    scaffoldImpl: scaffold
  });
  assert.equal(web.state, "awaiting-agent-implementation");
  assert.equal(web.contract.runtime.webview, true);
  assert.equal(web.contract.runtime.hybrid, false);
  assert.equal(JSON.parse(fs.readFileSync(path.join(web.project, "flags.json"), "utf8")).webview, true);
  assert.match(fs.readFileSync(path.join(webOut, "preview", "index.html"), "utf8"), /data-surface="webview-browser"/);
  const constraints = fs.readFileSync(path.join(web.project, "design-constraints.md"), "utf8");
  assert.match(constraints, /CSS transitions and animations are not supported/);
  assert.match(constraints, /nothing about a latest version/);
  assert.doesNotMatch(constraints, /uxp-assistant/);

  const unnamed = await runWorkflow({
    out: temp(),
    kind: "empty",
    answers: answers({ runtime: "webview" }),
    fetchImpl: fetchImpl(),
    scaffoldImpl: scaffold
  });
  assert.equal(unnamed.state, "stopped");
  assert.match(unnamed.say, /not offered/);
  assert.equal(fs.existsSync(path.join(unnamed.out, "work")), false);

  const noHybrid = await runWorkflow({
    out: temp(),
    kind: "empty",
    answers: answers({ runtime: "hybrid" }),
    fetchImpl: fetchImpl(),
    scaffoldImpl: scaffold
  });
  assert.equal(noHybrid.state, "stopped");
  assert.match(noHybrid.say, /Hybrid was not offered/);

  const project = path.join(temp(), "existing");
  fs.mkdirSync(project, { recursive: true });
  fs.writeFileSync(path.join(project, "addon.js"), "const addon = require(\"./filter.node\");\n");
  const hybrid = await runWorkflow({
    out: temp(),
    kind: "existing",
    projectPath: project,
    answers: answers({ runtime: "hybrid" }),
    fetchImpl: fetchImpl()
  });
  assert.equal(hybrid.state, "awaiting-agent-implementation");
  assert.equal(hybrid.contract.runtime.hybrid, true);
  assert.equal(hybrid.contract.runtime.webview, false);
  assert.equal(fs.existsSync(path.join(project, "addon.js")), true);
  assert.match(hybrid.contract.notes.join("\n"), /does not add a host API/);

  const docs = await runWorkflow({
    out: temp(),
    kind: "empty",
    answers: answers(),
    fetchImpl: fetchImpl({ "css-styles": false }),
    scaffoldImpl: scaffold
  });
  assert.equal(docs.state, "docs-incomplete");
  assert.equal(fs.existsSync(path.join(docs.out, "work")), false);
});

test("design discovery reports a missing example and records a skill that is on disk", async () => {
  const missing = await runWorkflow({
    out: temp(),
    kind: "empty",
    answers: answers({ design: "ui-ux-pro-max" }),
    fetchImpl: fetchImpl(),
    scaffoldImpl: scaffold
  });
  assert.equal(missing.state, "stopped");
  assert.match(missing.say, /UI UX Pro Max was not/);
  assert.equal(fs.existsSync(path.join(missing.out, "work")), false);

  const root = temp();
  fs.mkdirSync(path.join(root, "panel-layout"), { recursive: true });
  fs.writeFileSync(path.join(root, "panel-layout", "SKILL.md"), "---\nname: Panel Layout\n---\nThis skill designs UI layout.\n");
  const found = await runWorkflow({
    out: temp(),
    kind: "empty",
    answers: answers({ design: "panel-layout" }),
    fetchImpl: fetchImpl(),
    scaffoldImpl: scaffold,
    skillRoots: [root]
  });
  assert.equal(found.state, "awaiting-agent-implementation");
  assert.equal(found.contract.design.latest, false);
  assert.match(found.contract.design.skill.path, /SKILL\.md$/);
  assert.equal(found.contract.design.example.found, false);
  assert.match(fs.readFileSync(path.join(found.project, "design-constraints.md"), "utf8"), /Panel Layout/);
});

test("the installer refuses to invent webview or hybrid when the booleans are omitted", async () => {
  await assert.rejects(
    () => scaffoldWithInstaller(temp(), {
      folderName: "plugin",
      displayName: "Plugin",
      id: "com.example.plugin",
      framework: "react",
      app: "phxs"
    }),
    /will not force webview or hybrid/
  );
});
