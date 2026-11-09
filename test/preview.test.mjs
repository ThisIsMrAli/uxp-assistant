import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { launch } from "../.claude/skills/uxp-assistant/scripts/lib/cdp.mjs";
import { findChrome } from "../.claude/skills/uxp-assistant/scripts/lib/chrome.mjs";
import { previewDocument, servePreview } from "../.claude/skills/uxp-assistant/scripts/lib/preview.mjs";

const limits = ["CSS transitions and animations are not supported", "text-transform is not supported"];

test("the browser preview blocks native mutation and a missing host bridge", async (t) => {
  const supplied = ["Document title", "Read title"];
  const native = previewDocument({ mode: "native", goal: "Show the layer name", limits, supplied });
  const web = previewDocument({ mode: "webview", goal: "Show the layer name", limits, supplied });
  assert.match(native, /Supplied panel text/);
  assert.match(native, /not a UXP UI preview/);
  assert.match(native, /not a host render/);
  assert.match(native, /Document title/);
  assert.match(native, /data-surface="native-simulation"/);
  assert.match(native, /disabled/);
  assert.doesNotMatch(native, /require\(["']photoshop["']\)|executeAsModal\s*\(/);
  assert.match(web, /data-surface="webview-browser"/);
  assert.match(web, /uxpHost is unavailable/);
  assert.doesNotMatch(web, /layer\.name\s*=/);

  const chrome = findChrome();
  if (!chrome) {
    t.skip("No Chrome, Edge, or Chromium is installed.");
    return;
  }
  const evidence = path.resolve("evidence/preview");
  fs.mkdirSync(evidence, { recursive: true });
  const nativePage = await servePreview(native);
  const webPage = await servePreview(web);
  const page = await launch({ width: 900, height: 700, chrome });
  const log = {
    capturedOn: "this machine",
    boxBrowser: false,
    hostExecuted: false,
    supplied: "source text from the supplied UI, not a host render",
    note: "These screenshots are the labelled preview in this environment. They show supplied source text inside the labelled frame. They are not the box browser, not Photoshop, and not Premiere."
  };
  try {
    await page.goto(nativePage.url);
    await page.eval("document.getElementById('read').click()");
    await page.eval("document.getElementById('mutate').disabled = false; document.getElementById('mutate').click()");
    const nativeText = await page.eval("document.body.innerText");
    assert.match(nativeText, /Mock: the host app is not available/);
    assert.match(nativeText, /Blocked: the native mutation was not executed/);
    assert.match(nativeText, /CSS transitions and animations are not supported/);
    assert.match(nativeText, /Document title/);
    assert.match(nativeText, /not a host render/);
    assert.equal(await page.eval("window.__preview.hostExecuted"), false);
    await page.screenshot(path.join(evidence, "cloud-native-simulation.png"));
    log.native = { surface: "native-simulation", text: nativeText };

    await page.goto(webPage.url);
    await page.eval("document.getElementById('bridge').click()");
    const webText = await page.eval("document.body.innerText");
    assert.match(webText, /Blocked: window.uxpHost is unavailable/);
    assert.equal(await page.eval("window.__preview.hostExecuted"), false);
    assert.equal(await page.eval("document.body.dataset.hostExecuted"), "false");
    await page.screenshot(path.join(evidence, "cloud-webview-browser.png"));
    log.webview = { surface: "webview-browser", text: webText };
  } finally {
    await page.close();
    await nativePage.close();
    await webPage.close();
  }
  fs.writeFileSync(path.join(evidence, "preview-log.json"), `${JSON.stringify(log, null, 2)}\n`);
  assert.equal(log.hostExecuted, false);
});
