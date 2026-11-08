import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { readZip } from "../.claude/skills/uxp-assistant/scripts/lib/archive.mjs";
import { LEAST_LOCAL_WEBVIEW, narrowRequiredPermissions, starterPermissionsAreBroad } from "../.claude/skills/uxp-assistant/scripts/lib/permissions.mjs";
import { runtimeOffer } from "../.claude/skills/uxp-assistant/scripts/lib/runtime.mjs";
import { writeLocalWebviewHost } from "../.claude/skills/uxp-assistant/scripts/lib/webview-shell.mjs";
import { scaffoldWithInstaller } from "../.claude/skills/uxp-assistant/scripts/lib/scaffold.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("vue and svelte empty folders package, and the webview document is a separate build", { timeout: 600_000 }, async () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "uxp-stacks-"));
  const report = {
    hostExecuted: false,
    acceptanceSlice: "react+photoshop only. Vue and Svelte package results are not that slice.",
    stacks: {}
  };
  for (const framework of ["vue", "svelte"]) {
    const built = await packageFramework(parent, framework);
    report.stacks[framework] = built;
    assert.equal(built.ccxStatus, 0, `${framework} ccx failed: ${built.ccxTail}`);
    assert.ok(built.ccxBytes > 0, framework);
    assert.deepEqual(built.packagedPermissions, {}, `${framework} packaged manifest`);
  }
  const web = await packageWebview(parent);
  const { documentHtml, ...webviewReport } = web;
  report.webview = webviewReport;
  assert.equal(web.panelStatus, 0, web.panelTail);
  assert.equal(web.documentStatus, 0, web.documentTail);
  assert.match(web.documentHtml, /WebView document/);
  assert.match(web.documentHtml, /Mark read/);
  assert.doesNotMatch(web.documentHtml, /api\.notify/);
  assert.deepEqual(web.packagedPermissions, { webview: LEAST_LOCAL_WEBVIEW });
  assert.equal(web.shellWrote, true);
  assert.equal(web.hostBridge.postMessage, false);
  assert.equal(web.hostBridge.themeUpdated, false);
  assert.equal(web.hostBridge.createsWebview, true);
  report.unavoidable = {
    native: {},
    localWebview: { webview: LEAST_LOCAL_WEBVIEW },
    dropped: ["localFileSystem", "launchProcess", "clipboard", "network", "ipc", "allowCodeGenerationFromStrings", "webview.domains all", "enableMessageBridge localAndRemote"],
    note: "allow yes, domains [], and allowLocalRendering yes are the documented local plugin:/ enablement. enableMessageBridge no is the manifest default because this document does not postMessage. Host execution was not run."
  };
  const evidence = path.join(root, "evidence");
  fs.mkdirSync(evidence, { recursive: true });
  fs.writeFileSync(path.join(evidence, "stacks.json"), `${JSON.stringify(report, null, 2)}\n`);
  if (web.documentFile) fs.copyFileSync(web.documentFile, path.join(evidence, "webview-document.html"));
});

async function packageFramework(parent, framework) {
  const result = await scaffoldWithInstaller(parent, {
    folderName: framework,
    displayName: framework,
    id: `com.example.${framework}`,
    framework,
    app: "phxs",
    installDeps: true,
    webview: false,
    hybrid: false
  });
  const least = applyLeast(result.folder, "native");
  const ccx = spawnSync("npm", ["run", "ccx"], { cwd: result.folder, encoding: "utf8", timeout: 180000 });
  const ccxFile = newestCcx(result.folder);
  return {
    repair: result.repair,
    auditFix: result.auditFix,
    ccxStatus: ccx.status,
    ccxTail: `${ccx.stdout || ""}\n${ccx.stderr || ""}`.slice(-800),
    ccxFile: ccxFile ? path.basename(ccxFile) : "",
    ccxBytes: ccxFile ? fs.statSync(ccxFile).size : 0,
    ccxSha256: ccxFile ? sha(fs.readFileSync(ccxFile)) : "",
    configHasBroadGrant: least.broad,
    packagedPermissions: ccxFile ? packagedPermissions(ccxFile) : null
  };
}

async function packageWebview(parent) {
  const webviewUrl = "https://developer.adobe.com/uxp/uxp-api/reference-js/global-members/html-elements/html-web-view-element";
  const entryUrl = "https://developer.adobe.com/uxp/guides/explanation/concepts/panels-and-commands/";
  const [webviewText, entryText] = await Promise.all([liveText(webviewUrl), liveText(entryUrl)]);
  const offer = runtimeOffer({
    pages: [
      { id: "webview", freshness: "fresh", text: webviewText },
      { id: "entrypoints", freshness: "fresh", text: entryText }
    ],
    goal: "Show the active document title in the panel."
  });
  const offered = offer.choices.some((item) => item.id === "webview");
  assert.equal(offered, true, offer.gaps.join(" "));
  const result = await scaffoldWithInstaller(parent, {
    folderName: "webview",
    displayName: "WebView document",
    id: "com.example.webview",
    framework: "react",
    app: "phxs",
    installDeps: true,
    webview: true,
    hybrid: false
  });
  const ui = path.join(result.folder, "webview-ui");
  fs.writeFileSync(path.join(ui, "src", "webview-document.css"), `html, body { margin: 0; background: #1b1b1b; color: var(--uxp-host-text-color, #e8e8e8); }
main.webview-document { display: block; width: 100%; margin: 0; padding: 12px; text-align: start; box-sizing: border-box; }
main.webview-document h1 { font-size: 14px; line-height: 18px; font-weight: 600; margin: 0 0 8px; }
main.webview-document p, main.webview-document button { font-size: 12px; line-height: 16px; }
main.webview-document button { margin-top: 8px; padding: 6px 10px; color: var(--uxp-host-text-color, #e8e8e8); background: var(--uxp-host-widget-hover-background-color, #3a3a3a); border: 1px solid var(--uxp-host-border-color, #6e6e6e); border-radius: 4px; }
`);
  fs.writeFileSync(path.join(ui, "src", "main-webview.tsx"), `import React, { useState } from "react";
import "./webview-document.css";

export const App = () => {
  const [status, setStatus] = useState("Idle");
  return (
    <main className="webview-document">
      <h1>WebView document</h1>
      <p role="status">{status}</p>
      <button type="button" onClick={() => setStatus("Clicked in the WebView document. No host API was called.")}>Mark read</button>
    </main>
  );
};
`);
  const scssPath = path.join(ui, "src", "index.scss");
  if (fs.existsSync(scssPath)) {
    const scss = fs.readFileSync(scssPath, "utf8")
      .replace(/transition\s*:[^;]*;/g, "")
      .replace(/display\s*:\s*flex\s*;/g, "display: block;")
      .replace(/justify-content\s*:[^;]*;/g, "")
      .replace(/align-items\s*:[^;]*;/g, "");
    fs.writeFileSync(scssPath, scss);
  }
  const appCss = path.join(ui, "src", "app.css");
  if (fs.existsSync(appCss)) {
    const css = fs.readFileSync(appCss, "utf8")
      .replace(/transition\s*:[^;]*;/g, "")
      .replace(/display\s*:\s*flex\s*;/g, "")
      .replace(/place-items\s*:[^;]*;/g, "")
      .replace(/min-height\s*:\s*100vh\s*;/g, "")
      .replace(/min-width\s*:\s*320px\s*;/g, "")
      .replace(/font-size\s*:\s*3\.2em\s*;/g, "font-size: 14px;")
      .replace(/#app\s*\{[^}]*\}/g, "#app { max-width: 100%; margin: 0; padding: 0; text-align: start; }")
      .replace(/button:hover\s*\{[^}]*\}/g, "");
    fs.writeFileSync(appCss, css);
  }
  const install = spawnSync("npm", ["install"], { cwd: ui, encoding: "utf8", timeout: 180000 });
  const documentBuild = spawnSync("npm", ["run", "build"], { cwd: ui, encoding: "utf8", timeout: 180000 });
  const least = applyLeast(result.folder, "webview");
  const shell = writeLocalWebviewHost(result.folder);
  const panel = spawnSync("npm", ["run", "ccx"], { cwd: result.folder, encoding: "utf8", timeout: 180000 });
  const documentFile = [
    path.join(result.folder, "public/webview-ui/index.html"),
    path.join(result.folder, "dist/webview-ui/index.html"),
    path.join(ui, "dist/index.html"),
    path.join(ui, "index.html")
  ].find((name) => fs.existsSync(name) && /WebView document/.test(fs.readFileSync(name, "utf8"))) || "";
  const panelFile = newestCcx(result.folder);
  const panelMembers = panelFile ? readZip(panelFile).map((member) => member.name) : [];
  return {
    repair: result.repair,
    webviewOffered: offered,
    installerBooleans: { webview: true, hybrid: false },
    manifestWebview: /webview\s*:\s*\{/.test(fs.readFileSync(path.join(result.folder, "uxp.config.ts"), "utf8")),
    installStatus: install.status,
    documentStatus: documentBuild.status,
    documentTail: `${documentBuild.stdout || ""}\n${documentBuild.stderr || ""}`.slice(-800),
    documentFile,
    documentHtml: documentFile ? fs.readFileSync(documentFile, "utf8") : "",
    panelStatus: panel.status,
    panelTail: `${panel.stdout || ""}\n${panel.stderr || ""}`.slice(-800),
    panelHtmlHasWebviewTag: readZip(panelFile).some((member) => member.name.endsWith(".html") && /<webview\b/i.test(member.data.toString("utf8"))),
    scriptCreatesWebview: readZip(panelFile).some((member) => member.name.endsWith(".js") && /document\.createElement\("webview"\)/.test(member.data.toString("utf8")) && /plugin:\/webview-ui\//.test(member.data.toString("utf8"))),
    configHasBroadGrant: least.broad,
    packagedPermissions: panelFile ? packagedPermissions(panelFile) : null,
    shellWrote: shell.wrote,
    hostBridge: panelFile ? hostBridge(panelFile) : null,
    panelMembers: panelMembers.filter((name) => /html|webview|index/.test(name)).slice(0, 30)
  };
}

function applyLeast(folder, runtime) {
  const config = path.join(folder, "uxp.config.ts");
  const narrowed = narrowRequiredPermissions(fs.readFileSync(config, "utf8"), { runtime });
  assert.equal(narrowed.ok, true, narrowed.reason);
  fs.writeFileSync(config, narrowed.source);
  return { broad: starterPermissionsAreBroad(narrowed.source) };
}

function hostBridge(ccxFile) {
  const member = readZip(ccxFile).find((item) => /^assets\/index-.*\.js$/.test(item.name));
  const text = member ? member.data.toString("utf8") : "";
  return {
    postMessage: /webview\.postMessage|updateColorScheme|windowEndpoint|uxpHost\.postMessage/.test(text),
    themeUpdated: /theme\.onUpdated|theme\.getCurrent/.test(text),
    createsWebview: /createElement\("webview"\)/.test(text) && /plugin:\/webview-ui\//.test(text)
  };
}

function packagedPermissions(ccxFile) {
  const member = readZip(ccxFile).find((item) => item.name === "manifest.json");
  assert.ok(member, ccxFile);
  return JSON.parse(member.data.toString("utf8")).requiredPermissions;
}

function newestCcx(folder) {
  const dir = path.join(folder, "ccx");
  if (!fs.existsSync(dir)) return "";
  const files = fs.readdirSync(dir).filter((name) => name.endsWith(".ccx")).map((name) => path.join(dir, name));
  return files.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0] || "";
}

async function liveText(url) {
  const response = await fetch(url, { headers: { accept: "*/*", "user-agent": "uxp-assistant" } });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  const raw = await response.text();
  return raw.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, "\n");
}

function sha(data) {
  return crypto.createHash("sha256").update(data).digest("hex");
}
