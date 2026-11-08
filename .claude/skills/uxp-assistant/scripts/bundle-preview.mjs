import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launch } from "./lib/cdp.mjs";
import { findChrome } from "./lib/chrome.mjs";
import { bundleEntries, serveBundle } from "./lib/bundle-preview.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const ccxPath = path.resolve(process.argv[2] || path.join(root, "evidence/artifacts/document-title.ccx"));
const evidence = path.join(root, "evidence/preview");
const chrome = findChrome();
if (!chrome) {
  console.error("No Chrome, Edge, or Chromium is installed. The bundle was not opened.");
  process.exit(1);
}
const { script, entries } = bundleEntries(ccxPath);
const scriptBytes = entries.get(script);
const served = await serveBundle(ccxPath);
const page = await launch({ width: 960, height: 800, chrome });
const log = {
  capturedOn: "this cloud environment",
  boxBrowser: false,
  hostExecuted: false,
  ccx: path.relative(root, ccxPath),
  script,
  scriptSha256: crypto.createHash("sha256").update(scriptBytes).digest("hex"),
  scriptBytes: scriptBytes.length,
  loadOrder: "The package index.html puts the script in the head, before #app. This page keeps those script bytes and places the tag after #app so the bundle can mount. The component was not rewritten.",
  webview: "The acceptance choice was native. This archive has no WebView document, so none was served.",
  css: "Variables are the dark table copied from bolt-uxp src/api/themes.ts. Bolt's polyfill returns early when the host name is Photoshop, and this browser has no host variables. The table is not Spectrum and not the host theme.",
  dom: "The built panel uses plain h1, p, and button elements. The bundle contains no Spectrum components.",
  api: "require('uxp') and require('photoshop') are shim objects. activeDocument.title is the mock string Poster. executeAsModal and batchPlay record a block and do not mutate a host.",
  cepShim: "cep-to-uxp CSS and HTML shims are not in this repository. They were not copied. The color table is the maintained Bolt file.",
  layout: "The bundle's own stylesheet places the panel content. The brown banner is this page's label, not part of the component and not a host frame.",
  equivalence: "Not claimed. Adobe host NOT TESTED."
};
try {
  await page.goto(served.url);
  await page.eval("new Promise((resolve) => setTimeout(resolve, 400))");
  const idle = await page.eval("document.body.innerText");
  log.idleText = idle;
  log.shim = await page.eval("window.__shim");
  log.error = await page.eval("document.getElementById('shim-error').textContent");
  fs.mkdirSync(evidence, { recursive: true });
  await page.screenshot(path.join(evidence, "bundle-idle.png"));
  const after = await page.eval(`(async () => {
    const button = [...document.querySelectorAll("#app button")].find((item) => /Read title/.test(item.textContent || ""));
    if (!button) return { clicked: false, text: document.body.innerText };
    button.click();
    await new Promise((resolve) => setTimeout(resolve, 400));
    return { clicked: true, text: document.body.innerText, shim: window.__shim };
  })()`);
  log.after = after;
  await page.screenshot(path.join(evidence, "bundle-after-read.png"));
  log.rendered = Boolean(after.clicked) && /Document title/.test(idle) && /Poster/.test(after.text || "");
} finally {
  await page.close();
  await served.close();
}
fs.writeFileSync(path.join(evidence, "bundle-preview-log.json"), `${JSON.stringify(log, null, 2)}\n`);
console.log(JSON.stringify({ rendered: log.rendered, error: log.error, clicked: log.after?.clicked, script: log.script }, null, 2));
if (!log.rendered) process.exit(1);
