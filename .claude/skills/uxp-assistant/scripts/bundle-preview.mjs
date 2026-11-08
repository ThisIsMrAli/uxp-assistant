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
  widths: [320, 420],
  themes: ["dark", "light"],
  webview: "The acceptance choice was native. This archive has no WebView document, so none was served.",
  css: "Variables are the dark and light tables copied from bolt-uxp src/api/themes.ts. Bolt's polyfill returns early when the host name is Photoshop, and this browser has no host variables. The tables are not Spectrum and not the host theme. The page switches them with data-theme.",
  dom: "The built panel uses sp-heading, sp-body, and sp-button. Those tags stay in the package. This page adds handcrafted CSS for them. Spectrum Web Components are not loaded. The approximation is not the host widget.",
  api: "require('uxp') and require('photoshop') are shim objects. activeDocument.title is the mock string Poster. executeAsModal and batchPlay record a block and do not mutate a host.",
  cepShim: "cep-to-uxp CSS and HTML shims are not in this repository. They were not copied. The color table is the maintained Bolt file.",
  layout: "The bundle's own stylesheet places the panel content. The brown banner is this page's label, not part of the component and not a host frame.",
  equivalence: "Not claimed. Adobe host NOT TESTED."
};
try {
  await page.goto(served.url);
  await page.eval("new Promise((resolve) => setTimeout(resolve, 400))");
  log.error = await page.eval("document.getElementById('shim-error').textContent");
  log.shim = await page.eval("window.__shim");
  fs.mkdirSync(evidence, { recursive: true });
  log.views = [];
  for (const width of log.widths) {
    await page.send("Emulation.setDeviceMetricsOverride", { width, height: 520, deviceScaleFactor: 2, mobile: false });
    for (const theme of log.themes) {
      await page.media(theme);
      await page.eval(`document.documentElement.dataset.theme = ${JSON.stringify(theme)}`);
      const fill = theme === "light" ? { r: 184, g: 184, b: 184, a: 1 } : { r: 83, g: 83, b: 83, a: 1 };
      await page.send("Emulation.setDefaultBackgroundColorOverride", { color: fill });
      await page.eval("new Promise((resolve) => setTimeout(resolve, 150))");
      const view = await page.eval(`(() => {
        const panel = document.querySelector(".document-title-panel");
        const heading = panel && panel.querySelector("sp-heading");
        const button = panel && panel.querySelector("sp-button");
        const headingBox = heading ? heading.getBoundingClientRect() : null;
        const buttonBox = button ? button.getBoundingClientRect() : null;
        return {
          text: panel ? panel.innerText : "",
          headingHeight: headingBox ? headingBox.height : 0,
          buttonWidth: buttonBox ? buttonBox.width : 0,
          overflow: panel ? panel.scrollWidth - panel.clientWidth : null,
          appOverflow: document.getElementById("app").scrollWidth - document.getElementById("app").clientWidth
        };
      })()`);
      const name = `bundle-${width}-${theme}.png`;
      await page.screenshot(path.join(evidence, name), { x: 0, y: 0, width, height: 520, scale: 2 });
      log.views.push({ width, theme, file: `evidence/preview/${name}`, ...view });
    }
  }
  await page.send("Emulation.setDeviceMetricsOverride", { width: 320, height: 520, deviceScaleFactor: 2, mobile: false });
  await page.media("dark");
  await page.eval("document.documentElement.dataset.theme = 'dark'");
  await page.send("Emulation.setDefaultBackgroundColorOverride", { color: { r: 83, g: 83, b: 83, a: 1 } });
  const after = await page.eval(`(async () => {
    const buttons = [...document.querySelectorAll(".document-title-panel sp-button")];
    const readDocument = buttons.find((item) => /Read document/.test(item.textContent || ""));
    const readSelection = buttons.find((item) => /Read selection/.test(item.textContent || ""));
    if (!readDocument || !readSelection) return { clicked: false, text: "" };
    readDocument.click();
    await new Promise((resolve) => setTimeout(resolve, 200));
    readSelection.click();
    await new Promise((resolve) => setTimeout(resolve, 200));
    const panel = document.querySelector(".document-title-panel");
    return { clicked: true, text: panel ? panel.innerText : "", shim: window.__shim };
  })()`);
  log.after = after;
  await page.screenshot(path.join(evidence, "bundle-320-dark-after-read.png"), { x: 0, y: 0, width: 320, height: 520, scale: 2 });
  const compact = log.views.every((view) => view.headingHeight > 0 && view.headingHeight <= 36 && view.buttonWidth > 40 && view.overflow <= 1 && view.appOverflow <= 1);
  log.rendered = Boolean(after.clicked) && /Poster/.test(after.text || "") && /Mock layer/.test(after.text || "") && /Read document/.test(after.text || "") && compact;
} finally {
  await page.close();
  await served.close();
}
fs.writeFileSync(path.join(evidence, "bundle-preview-log.json"), `${JSON.stringify(log, null, 2)}\n`);
console.log(JSON.stringify({ rendered: log.rendered, error: log.error, clicked: log.after?.clicked, script: log.script }, null, 2));
if (!log.rendered) process.exit(1);
