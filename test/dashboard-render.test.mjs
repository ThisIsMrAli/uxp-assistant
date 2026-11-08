import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { launch } from "../.claude/skills/uxp-assistant/scripts/lib/cdp.mjs";
import { findChrome } from "../.claude/skills/uxp-assistant/scripts/lib/chrome.mjs";
import { assetsDir } from "../.claude/skills/uxp-assistant/scripts/lib/paths.mjs";
import { pagesForRequest } from "../.claude/skills/uxp-assistant/scripts/lib/registry.mjs";
import { createDashboardServer } from "../.claude/skills/uxp-assistant/scripts/lib/server.mjs";
import { finish } from "../.claude/skills/uxp-assistant/scripts/lib/session.mjs";
import { recordImplementation, runWorkflow } from "../.claude/skills/uxp-assistant/scripts/lib/workflow.mjs";

const SHOW = "Show each selected layer id and name in the panel.";
const catalog = pagesForRequest({ host: "phxs", goal: "layer" });
const byUrl = new Map(catalog.map((page) => [page.url, page.id]));

test("the dashboard shows the outcome and does not call a skipped feature finished", { timeout: 60_000 }, async (t) => {
  const chrome = findChrome();
  if (!chrome) {
    t.skip("No Chrome, Edge, or Chromium is installed.");
    return;
  }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "uxp-dashboard-"));
  const unknownOut = path.join(root, "unknown");
  const doneOut = path.join(root, "done");
  await runWorkflow({ out: unknownOut, kind: "empty", answers: answers("Export a hologram with app.fluxCapacitor()."), fetchImpl, scaffoldImpl });
  const ready = await runWorkflow({ out: doneOut, kind: "empty", answers: answers(SHOW), fetchImpl, scaffoldImpl });
  writeShow(ready.project);
  recordImplementation(doneOut, { goal: SHOW, files: ["src/Selection.tsx", "src/selection-read.mjs"] });
  finish(doneOut, "Commands finished. The Adobe host was NOT TESTED.");

  const unknownDash = createDashboardServer({ out: unknownOut, assets: assetsDir, token: "token" });
  const doneDash = createDashboardServer({ out: doneOut, assets: assetsDir, token: "token" });
  const unknownInfo = await unknownDash.listen(0);
  const doneInfo = await doneDash.listen(0);
  const page = await launch({ width: 1280, height: 900, chrome });
  try {
    await page.goto(unknownInfo.url);
    await page.eval("new Promise((resolve) => setTimeout(resolve, 400))");
    const unknownText = await page.eval("document.body.innerText");
    assert.match(unknownText, /State: unknown/);
    assert.match(unknownText, /Not complete/);
    assert.match(unknownText, /NOT TESTED/);
    assert.match(unknownText, /Export a hologram with app\.fluxCapacitor\(\)\./);
    assert.doesNotMatch(unknownText, /Review finished/);
    assert.doesNotMatch(unknownText, /Everything you chose is done/);
    await page.goto(doneInfo.url);
    await page.eval("new Promise((resolve) => setTimeout(resolve, 400))");
    const doneText = await page.eval("document.body.innerText");
    assert.match(doneText, /Commands finished/);
    assert.match(doneText, /The Adobe host was NOT TESTED/);
    assert.match(doneText, /Show each selected layer id and name/);
    assert.doesNotMatch(doneText, /Review finished/);
    assert.doesNotMatch(doneText, /Everything you chose is done/);
  } finally {
    await page.close();
    await unknownDash.close();
    await doneDash.close();
  }
});

function answers(goal) {
  return {
    mode: "dashboard",
    framework: "react",
    host: "phxs",
    os: "linux",
    context: "panel",
    name: "Selection Panel",
    id: "com.example.selection",
    consequential: "proceed",
    "narrow-permissions": "narrow",
    goal
  };
}

async function fetchImpl(url) {
  const id = byUrl.get(url);
  const text = id === "photoshop.layer"
    ? "name string R W 22.5 Name of the layer.\n"
    : id === "photoshop.document"
      ? "activeLayers Layers R W 22.5 The selected layers in the document. (26.9)\n"
      : id === "photoshop.executeAsModal"
        ? "commandName string required 23.0 shown above the progress bar.\n"
        : `shared ${id || "page"}\n`;
  return { ok: true, async text() { return text; } };
}

async function scaffoldImpl(parent) {
  const folder = path.join(parent, "plugin");
  fs.mkdirSync(path.join(folder, "src"), { recursive: true });
  fs.writeFileSync(path.join(folder, "package.json"), `${JSON.stringify({
    name: "plugin",
    scripts: {
      test: "node -e \"process.exit(0)\"",
      build: "node -e \"process.exit(0)\"",
      ccx: "node -e \"require('fs').writeFileSync('out.ccx','PK')\""
    }
  }, null, 2)}\n`);
  fs.writeFileSync(path.join(folder, "uxp.config.ts"), "export const manifest = { requiredPermissions: {} };\n");
  fs.writeFileSync(path.join(folder, "src", "main.tsx"), "export const App = () => null;\n");
  return { folder, installer: "test-double" };
}

function writeShow(project) {
  fs.writeFileSync(path.join(project, "src", "Selection.tsx"), "export function SelectionPanel(){ return <button type=\"button\" disabled>Read selection</button>; }\n");
  fs.writeFileSync(path.join(project, "src", "selection-read.mjs"), "export function readSelection(){ return { status: \"Read outside executeAsModal.\" }; }\n");
}
