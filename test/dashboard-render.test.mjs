import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
import { launch } from "../.claude/skills/uxp-assistant/scripts/lib/cdp.mjs";
import { findChrome } from "../.claude/skills/uxp-assistant/scripts/lib/chrome.mjs";
import { assetsDir } from "../.claude/skills/uxp-assistant/scripts/lib/paths.mjs";
import { createDashboardServer } from "../.claude/skills/uxp-assistant/scripts/lib/server.mjs";
import { answerFromChat, finish } from "../.claude/skills/uxp-assistant/scripts/lib/session.mjs";
import { recordImplementation, runWorkflow } from "../.claude/skills/uxp-assistant/scripts/lib/workflow.mjs";

import { SHOW, answers, fetchImpl, scaffoldImpl, writeShow } from "./fixtures/dashboard-session.mjs";

test("the dashboard shows the outcome and does not call a skipped feature finished", { timeout: 60_000 }, async (t) => {
  const chrome = findChrome();
  if (!chrome) {
    t.skip("No Chrome, Edge, or Chromium is installed.");
    return;
  }
  // NQ10: every temp dir, server and browser is released in finally, also when an assertion fails.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "uxp-dashboard-"));
  let unknownDash;
  let doneDash;
  let page;
  try {
  const unknownOut = path.join(root, "unknown");
  const doneOut = path.join(root, "done");
  await runWorkflow({ out: unknownOut, kind: "empty", answers: answers("Export a hologram with app.fluxCapacitor()."), fetchImpl, scaffoldImpl });
  const ready = await runWorkflow({ out: doneOut, kind: "empty", answers: answers(SHOW), fetchImpl, scaffoldImpl });
  writeShow(ready.project);
  recordImplementation(doneOut, { goal: SHOW, files: ["src/Selection.tsx", "src/selection-read.mjs"] });
  finish(doneOut, "Commands finished. The Adobe host was NOT TESTED.");

  unknownDash = createDashboardServer({ out: unknownOut, assets: assetsDir, token: "token" });
  doneDash = createDashboardServer({ out: doneOut, assets: assetsDir, token: "token" });
  const unknownInfo = await unknownDash.listen(0);
  const doneInfo = await doneDash.listen(0);
  page = await launch({ width: 1280, height: 900, chrome });
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
    await page.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await page.goto(doneInfo.url);
    await page.eval("new Promise((resolve) => setTimeout(resolve, 400))");
    const phone = await page.eval("document.body.innerText");
    assert.match(phone, /Manual steps are in host-verification.md/);
    const dashDir = path.join(repoRoot, "evidence/dashboard");
    fs.mkdirSync(dashDir, { recursive: true });
    await page.screenshot(path.join(dashDir, "commands-finished.png"), { x: 0, y: 0, width: 390, height: 844, scale: 1 });
  } finally {
    await page?.close().catch(() => {});
    await unknownDash?.close().catch(() => {});
    await doneDash?.close().catch(() => {});
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("the dashboard shows each staged choice before the session continues", { timeout: 90_000 }, async (t) => {
  const chrome = findChrome();
  if (!chrome) {
    t.skip("No Chrome, Edge, or Chromium is installed.");
    return;
  }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "uxp-walk-"));
  const out = path.join(root, "session");
  const base = {
    mode: "dashboard",
    framework: "react",
    host: "phxs",
    os: "linux",
    context: "panel",
    name: "Selection Panel",
    id: "com.example.selection",
    consequential: "proceed",
    "narrow-permissions": "narrow",
    goal: SHOW
  };
  const steps = [
    ["feasibility", "continue", /Evidence before edits/],
    ["context-evidence", "keep-unverified", /Context is not confirmed/],
    ["runtime", "native", /Native UXP, WebView, or a bridge/],
    ["design", "uxp-constraints", /Design source/],
    ["validation", "commands", /What validation can record/]
  ];
  let dash;
  let page;
  try {
    dash = createDashboardServer({ out, assets: assetsDir, token: "token" });
    const info = await dash.listen(0);
    page = await launch({ width: 1100, height: 800, chrome });
    const dashDir = path.join(repoRoot, "evidence/dashboard");
    fs.mkdirSync(dashDir, { recursive: true });
    for (const [id, option, title] of steps) {
      const result = await runWorkflow({ out, kind: "empty", answers: base, fetchImpl, scaffoldImpl });
      assert.equal(result.blocked, id, result.say);
      await page.goto(info.url);
      await page.eval("new Promise((resolve) => setTimeout(resolve, 800))");
      const text = await page.eval("document.body.innerText");
      assert.match(text, title);
      await page.screenshot(path.join(dashDir, `${id}.png`), { x: 0, y: 0, width: 1100, height: 800, scale: 1 });
      answerFromChat(out, id, option);
    }
    const ready = await runWorkflow({
      out,
      kind: "empty",
      answers: base,
      fetchImpl,
      scaffoldImpl
    });
    assert.equal(ready.state, "awaiting-agent-implementation");
    await page.goto(info.url);
    await page.eval("new Promise((resolve) => setTimeout(resolve, 500))");
    const waiting = await page.eval("document.body.innerText");
    assert.match(waiting, /awaiting-agent-implementation|Implement|Waiting/);
    await page.screenshot(path.join(dashDir, "awaiting-implementation.png"), { x: 0, y: 0, width: 1100, height: 800, scale: 1 });
  } finally {
    await page?.close().catch(() => {});
    await dash?.close().catch(() => {});
    fs.rmSync(root, { recursive: true, force: true });
  }
});
