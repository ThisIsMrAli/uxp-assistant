import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launch } from "./lib/cdp.mjs";
import { findChrome } from "./lib/chrome.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const htmlPath = path.resolve(process.argv[2] || path.join(root, "evidence/webview-document.html"));
const evidence = path.join(root, "evidence/webview");
if (!fs.existsSync(htmlPath)) {
  console.error("No WebView document HTML. The package build did not leave one.");
  process.exit(1);
}
const chrome = findChrome();
if (!chrome) {
  console.error("No Chrome, Edge, or Chromium is installed. The WebView document was not opened.");
  process.exit(1);
}
const html = fs.readFileSync(htmlPath);
const server = http.createServer((req, res) => {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  const banner = `<p id="webview-banner" style="margin:0;padding:8px 12px;background:#14301f;color:#d7ffe6;font:12px/16px sans-serif">This is the packaged WebView document. It is browser content. The native panel bridge was not executed. window.uxpHost is not invented here. Adobe host: NOT TESTED.</p>`;
  res.end(html.toString("utf8").replace("<body>", `<body>${banner}`));
});
const served = await new Promise((resolve) => {
  server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${server.address().port}/`));
});
const page = await launch({ width: 420, height: 520, chrome });
const log = { capturedOn: "this cloud environment", boxBrowser: false, hostExecuted: false, surface: "webview-document", html: path.relative(root, htmlPath) };
try {
  await page.goto(served);
  await page.send("Emulation.setDeviceMetricsOverride", { width: 420, height: 320, deviceScaleFactor: 2, mobile: false });
  await page.eval("new Promise((resolve) => setTimeout(resolve, 300))");
  fs.mkdirSync(evidence, { recursive: true });
  await page.screenshot(path.join(evidence, "document-idle.png"), { x: 0, y: 0, width: 420, height: 320, scale: 2 });
  const after = await page.eval(`(async () => {
    const button = [...document.querySelectorAll("button")].find((item) => /Mark read/.test(item.textContent || ""));
    if (!button) return { clicked: false, text: document.body.innerText };
    button.click();
    await new Promise((resolve) => setTimeout(resolve, 200));
    return { clicked: true, text: document.body.innerText };
  })()`);
  log.after = after;
  await page.screenshot(path.join(evidence, "document-after-click.png"), { x: 0, y: 0, width: 420, height: 320, scale: 2 });
  log.rendered = Boolean(after.clicked) && /No host API was called/.test(after.text || "");
} finally {
  await page.close();
  await new Promise((resolve) => server.close(resolve));
}
fs.writeFileSync(path.join(evidence, "webview-preview-log.json"), `${JSON.stringify(log, null, 2)}\n`);
console.log(JSON.stringify({ rendered: log.rendered, clicked: log.after?.clicked }, null, 2));
if (!log.rendered) process.exit(1);
