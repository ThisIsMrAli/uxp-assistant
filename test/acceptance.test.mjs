import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { readZip } from "../.claude/skills/uxp-assistant/scripts/lib/archive.mjs";
import { narrowRequiredPermissions } from "../.claude/skills/uxp-assistant/scripts/lib/permissions.mjs";
import { installerEntry, starterIconsDir } from "../.claude/skills/uxp-assistant/scripts/lib/scaffold.mjs";
import { recordImplementation, runWorkflow } from "../.claude/skills/uxp-assistant/scripts/lib/workflow.mjs";

const GOAL = "Show the active document title in the panel.";

test("create-bolt-uxp scaffolds from a cwd that is not the repository, and both entry paths package the document title", { timeout: 300_000 }, async () => {
  assert.equal(fs.existsSync(installerEntry()), true, "create-bolt-uxp is not installed");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "uxp-accept-"));
  const previous = process.cwd();
  process.chdir(os.tmpdir());
  let empty;
  let existing;
  let observedAudit;
  try {
    empty = await runWorkflow({
      out: path.join(root, "empty-session"),
      kind: "empty",
      workDir: path.join(root, "empty-work"),
      installDeps: true,
      answers: answers(GOAL),
      fetchImpl
    });
    assert.equal(empty.state, "awaiting-agent-implementation");
    assert.equal(empty.fixture, null);
    assert.equal(empty.success, false);
    const narrowed = fs.readFileSync(path.join(empty.project, "uxp.config.ts"), "utf8");
    assert.match(narrowed, /minVersion: "24\.2\.0"/);
    assert.match(narrowed, /requiredPermissions: \{\}/);
    assert.doesNotMatch(narrowed, /network:/);
    const template = fs.readFileSync(path.join(path.dirname(starterIconsDir()), "..", "uxp.config.ts"), "utf8");
    const fromTemplate = narrowRequiredPermissions(template);
    assert.equal(fromTemplate.ok, true);
    assert.doesNotMatch(fromTemplate.source, /network:/);
    assert.match(fromTemplate.source, /requiredPermissions: \{\}/);
    const main = fs.readFileSync(path.join(empty.project, "src", "main.tsx"), "utf8");
    assert.match(main, /import\s*\{[^}]*\buxp\b[^}]*\}\s*from\s*["']\.\/globals["']/);
    assert.equal(fs.existsSync(path.join(empty.project, "public", "icons", "dark.png")), true);
    assert.equal(fs.existsSync(path.join(empty.project, "public", "icons", "light.png")), true);
    const starterMain = fs.readFileSync(path.join(empty.project, "src", "main.tsx"), "utf8");
    const starterConfig = fs.readFileSync(path.join(empty.project, "uxp.config.ts"), "utf8");
    writeTitle(empty.project);
    const recorded = recordImplementation(path.join(root, "empty-session"), { goal: GOAL, files: ["src/document-title.mjs", "src/DocumentTitle.tsx", "src/main.tsx"] });
    assert.equal(recorded.success, true);
    assert.equal(recorded.hostExecuted, false);
    assert.match(recorded.limits, /NOT TESTED/);
    const archive = recorded.package.artifacts[0];
    const full = path.join(empty.project, archive.file);
    const members = readZip(full).map((member) => member.name);
    assert.ok(members.some((name) => name.endsWith("icons/dark.png")));
    assert.ok(members.some((name) => name.endsWith("icons/light.png")));
    const js = readZip(full).filter((member) => member.name.endsWith(".js")).map((member) => member.data.toString("utf8")).join("\n");
    assert.match(js, /Document title/);
    assert.match(js, /document-title-panel/);
    assert.match(js, /CSS transitions and animations are not supported/);
    assert.match(js, /font-size: 14px/);
    assertNoStarterChrome(js);
    assertNoStarterChrome(fs.readFileSync(path.join(empty.project, "src", "app.css"), "utf8"));
    assertNoStarterChrome(fs.readFileSync(path.join(empty.project, "src", "index.scss"), "utf8"));
    assertNoStarterChrome(fs.readFileSync(path.join(empty.project, "src", "panel-design.css"), "utf8"));
    const pkg = JSON.parse(fs.readFileSync(path.join(empty.project, "package.json"), "utf8"));
    const lock = JSON.parse(fs.readFileSync(path.join(empty.project, "package-lock.json"), "utf8"));
    assert.equal(pkg.devDependencies.vite, "^6.3.5");
    assert.equal(pkg.devDependencies.ws, "^8.14.2");
    assert.notEqual(pkg.devDependencies["vite-uxp-plugin"], "0.2.5");
    const shellQuote = lock.packages["node_modules/shell-quote"].version;
    const viteVersion = lock.packages["node_modules/vite"].version;
    const wsVersion = lock.packages["node_modules/ws"].version;
    assert.notEqual(shellQuote, "1.8.1");
    assert.notEqual(viteVersion, "6.3.5");
    assert.notEqual(wsVersion, "8.14.2");
    const audit = spawnSync("npm", ["audit", "--json"], { cwd: empty.project, encoding: "utf8" });
    const report = JSON.parse(audit.stdout);
    assert.equal(report.metadata.vulnerabilities.critical, 0);
    assert.equal(report.metadata.vulnerabilities.high, 0);
    observedAudit = {
      project: "acceptance empty-folder tree after npm audit fix --package-lock-only and npm ci",
      force: false,
      packageJsonRanges: { vite: pkg.devDependencies.vite, ws: pkg.devDependencies.ws, "vite-uxp-plugin": pkg.devDependencies["vite-uxp-plugin"] },
      installed: { "shell-quote": shellQuote, vite: viteVersion, ws: wsVersion },
      vulnerabilities: report.metadata.vulnerabilities,
      note: "critical and high are zero after the in-range lockfile update. Remaining moderate advisories are not dismissed. vite-uxp-plugin was not downgraded."
    };
    fs.mkdirSync(path.join(root, "kept"), { recursive: true });
    fs.copyFileSync(full, path.join(root, "kept", "document-title.ccx"));
    fs.writeFileSync(path.join(root, "kept", "document-title.json"), `${JSON.stringify({
      bytes: archive.bytes,
      sha256: archive.sha256,
      members,
      hostExecuted: false
    }, null, 2)}\n`);

    const copy = path.join(root, "existing-project");
    fs.cpSync(empty.project, copy, { recursive: true });
    fs.rmSync(path.join(copy, "dist"), { recursive: true, force: true });
    fs.rmSync(path.join(copy, "ccx"), { recursive: true, force: true });
    fs.rmSync(path.join(copy, "src", "DocumentTitle.tsx"), { force: true });
    fs.rmSync(path.join(copy, "src", "document-title.mjs"), { force: true });
    fs.rmSync(path.join(copy, "test", "document-title.test.mjs"), { force: true });
    fs.writeFileSync(path.join(copy, "src", "main.tsx"), starterMain);
    fs.writeFileSync(path.join(copy, "uxp.config.ts"), starterConfig);
    existing = await runWorkflow({
      out: path.join(root, "existing-session"),
      kind: "existing",
      projectPath: copy,
      answers: answers(GOAL, { "narrow-permissions": "keep" }),
      fetchImpl
    });
    assert.equal(existing.state, "awaiting-agent-implementation");
    assert.equal(existing.fixture, null);
    assert.match(fs.readFileSync(path.join(copy, "uxp.config.ts"), "utf8"), /requiredPermissions: \{\}/);
    writeTitle(copy);
    const again = recordImplementation(path.join(root, "existing-session"), { goal: GOAL, files: ["src/document-title.mjs", "src/DocumentTitle.tsx", "src/main.tsx"] });
    assert.equal(again.success, true);
    assert.equal(again.hostExecuted, false);
    fs.copyFileSync(path.join(copy, again.package.artifacts[0].file), path.join(root, "kept", "existing-document-title.ccx"));
  } finally {
    process.chdir(previous);
  }
  const kept = path.join(root, "kept", "document-title.ccx");
  const data = fs.readFileSync(kept);
  fs.mkdirSync("evidence/artifacts", { recursive: true });
  fs.copyFileSync(kept, "evidence/artifacts/document-title.ccx");
  fs.copyFileSync(path.join(root, "kept", "existing-document-title.ccx"), "evidence/artifacts/existing-document-title.ccx");
  const note = {
    goal: GOAL,
    hostExecuted: false,
    empty: {
      bytes: data.length,
      sha256: crypto.createHash("sha256").update(data).digest("hex"),
      project: empty.project
    },
    existingBytes: fs.statSync("evidence/artifacts/existing-document-title.ccx").size,
    limits: "Zip timestamps can change a later digest. These files are the retained archives from this run. Photoshop and Premiere were not launched."
  };
  fs.writeFileSync("evidence/artifacts/acceptance.json", `${JSON.stringify(note, null, 2)}\n`);
  fs.writeFileSync("evidence/generated-plugin-audit-observed.json", `${JSON.stringify(observedAudit, null, 2)}\n`);
  const log = spawnSync(process.execPath, ["-e", "process.stdout.write('acceptance recorded')"], { encoding: "utf8" });
  assert.equal(log.status, 0);
});

test("the live Premiere class pages resolve importFiles when the index does not list it", { timeout: 180_000 }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "uxp-premiere-"));
  const project = path.join(root, "existing");
  fs.mkdirSync(project, { recursive: true });
  fs.writeFileSync(path.join(project, "keep.js"), "export const keep = 1;\n");
  const result = await runWorkflow({
    out: path.join(root, "session"),
    kind: "existing",
    projectPath: project,
    answers: answers("Import files into the active Premiere project with importFiles.", { host: "ppro", "narrow-permissions": "keep" }),
    fetchImpl
  });
  assert.equal(result.state, "awaiting-agent-implementation");
  assert.equal(result.fixture, null);
  assert.equal(result.hostExecuted, false);
  assert.match(JSON.stringify(result.contract.evidence), /importFiles/);
  assert.doesNotMatch(result.contract.handoff, /Do not write feature code/);
  fs.mkdirSync("evidence/logs", { recursive: true });
  fs.writeFileSync("evidence/logs/premiere-importFiles.json", `${JSON.stringify({
    state: result.state,
    fixture: result.fixture,
    hostExecuted: false,
    evidence: result.contract.evidence
  }, null, 2)}\n`);
});

function answers(goal, extra = {}) {
  return {
    mode: "chat",
    framework: "react",
    host: "phxs",
    os: "linux",
    context: "panel",
    name: "Document Title",
    id: "com.example.title",
    consequential: "proceed",
    "narrow-permissions": "narrow",
    feasibility: "continue",
    runtime: "native",
    design: "uxp-constraints",
    validation: "commands",
    "context-evidence": "keep-unverified",
    goal,
    ...extra
  };
}

async function fetchImpl(url) {
  const response = await fetch(url, { headers: { accept: "*/*", "user-agent": "uxp-assistant" } });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  const raw = await response.text();
  const type = response.headers.get("content-type") || "";
  const text = /html/i.test(type)
    ? raw.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, "\n").replace(/&amp;/g, "&")
    : raw;
  return { ok: true, async text() { return text; } };
}

function assertNoStarterChrome(source) {
  assert.doesNotMatch(source, /font-size:\s*3\.2em/);
  assert.doesNotMatch(source, /100vh/);
  assert.doesNotMatch(source, /100vw/);
  assert.doesNotMatch(source, /transition\s*:/);
  assert.doesNotMatch(source, /place-items\s*:/);
  assert.doesNotMatch(source, /display\s*:\s*flex/);
  assert.doesNotMatch(source, /background-color\s*:\s*transparent/);
  assert.doesNotMatch(source, /border\s*:\s*none/);
  assert.doesNotMatch(source, /min-width\s*:\s*320px/);
}

function stripConflictingStarterRules(css) {
  return css
    .replace(/(^|[;{\n])[ \t]*transition\s*:[^;]*;/g, "$1")
    .replace(/(^|[;{\n])[ \t]*min-height\s*:\s*100vh\s*;/g, "$1")
    .replace(/(^|[;{\n])[ \t]*height\s*:\s*100vh\s*;/g, "$1")
    .replace(/(^|[;{\n])[ \t]*width\s*:\s*100vw\s*;/g, "$1")
    .replace(/(^|[;{\n])[ \t]*min-width\s*:\s*320px\s*;/g, "$1")
    .replace(/(^|[;{\n])[ \t]*font-size\s*:\s*3\.2em\s*;/g, "$1")
    .replace(/(^|[;{\n])[ \t]*line-height\s*:\s*1\.1\s*;/g, "$1")
    .replace(/(^|[;{\n])[ \t]*place-items\s*:[^;]*;/g, "$1")
    .replace(/(^|[;{\n])[ \t]*display\s*:\s*flex\s*;/g, "$1")
    .replace(/(^|[;{\n])[ \t]*flex-direction\s*:[^;]*;/g, "$1")
    .replace(/(^|[;{\n])[ \t]*justify-content\s*:[^;]*;/g, "$1")
    .replace(/(^|[;{\n])[ \t]*align-items\s*:[^;]*;/g, "$1")
    .replace(/(^|[;{\n])[ \t]*background-color\s*:\s*transparent\s*;/g, "$1")
    .replace(/(^|[;{\n])[ \t]*background-color\s*:\s*#1a1a1a\s*;/g, "$1")
    .replace(/(^|[;{\n])[ \t]*border\s*:\s*1px solid transparent\s*;/g, "$1")
    .replace(/(^|[;{\n])[ \t]*border\s*:\s*none\s*;/g, "$1")
    .replace(/(^|[;{\n])[ \t]*border-color\s*:[^;]*;/g, "$1")
    .replace(/(^|[;{\n])[ \t]*outline\s*:\s*none\s*;/g, "$1")
    .replace(/(^|[;{\n])[ \t]*outline\s*:\s*4px auto -webkit-focus-ring-color\s*;/g, "$1");
}

function rewriteStarterChrome(project) {
  for (const name of ["app.css", "index.scss"]) {
    const file = path.join(project, "src", name);
    if (!fs.existsSync(file)) continue;
    fs.writeFileSync(file, stripConflictingStarterRules(fs.readFileSync(file, "utf8")));
  }
}

function designQuotes(project) {
  const file = path.join(project, "design-constraints.md");
  if (!fs.existsSync(file)) return [];
  return [...fs.readFileSync(file, "utf8").matchAll(/^-\s+Fresh page text[^:]*:\s*(.+)$/gm)].map((match) => match[1].trim());
}

function writeTitle(project) {
  fs.mkdirSync(path.join(project, "test"), { recursive: true });
  const quotes = designQuotes(project);
  fs.writeFileSync(path.join(project, "src", "panel-design.mjs"), `export const appliedConstraints = ${JSON.stringify(quotes, null, 2)};
export const surface = "plain-html-host-css";
export const spectrum = "UXP sp-* widgets are not used. A browser Spectrum library is not loaded and is not a stand-in for native UXP widgets.";
`);
  const quoteComment = quotes.length
    ? quotes.map((quote) => ` * ${quote}`).join("\n")
    : " * No fresh limit sentence was recorded. Transitions and text-transform are still omitted.";
  fs.writeFileSync(path.join(project, "src", "panel-design.css"), `/* Applied from design-constraints.md. This panel consumes those sentences.
${quoteComment}
 * Plain HTML uses host color variables. The button is a real button, not an sp-button mock.
 * Conflicting starter rules are deleted from app.css and index.scss before this file is added.
 */
html, body {
  display: block;
  height: auto;
  min-height: 0;
  min-width: 0;
  margin: 0;
}
#app {
  max-width: none;
  width: 100%;
  margin: 0;
  padding: 0;
  text-align: start;
  box-sizing: border-box;
}
main {
  display: block;
  width: 100%;
  height: auto;
  margin: 0;
  align-items: stretch;
  justify-content: flex-start;
}
.document-title-panel {
  box-sizing: border-box;
  width: 100%;
  max-width: 100%;
  padding: 12px;
  text-align: start;
  overflow-wrap: anywhere;
  background: var(--uxp-host-background-color, transparent);
  color: var(--uxp-host-text-color, inherit);
}
.document-title-panel h1 {
  font-size: 14px;
  line-height: 18px;
  font-weight: 600;
  margin: 0 0 8px;
}
.document-title-panel .status,
.document-title-panel .empty,
.document-title-panel .error,
.document-title-panel .title {
  margin: 8px 0 0;
  font-size: 12px;
  line-height: 16px;
}
.document-title-panel .error {
  color: #ffb4b4;
}
.document-title-panel button {
  font-size: 12px;
  line-height: 16px;
  margin-top: 8px;
  padding: 6px 10px;
  border-radius: 4px;
  border: 1px solid var(--uxp-host-border-color, currentColor);
  background: var(--uxp-host-widget-hover-background-color, transparent);
  color: var(--uxp-host-text-color, inherit);
  cursor: pointer;
}
.document-title-panel button:disabled {
  opacity: 0.55;
  cursor: default;
}
.document-title-panel button:focus-visible {
  outline: 2px solid var(--uxp-host-link-text-color, currentColor);
  outline-offset: 2px;
}
`);
  rewriteStarterChrome(project);
  fs.writeFileSync(path.join(project, "src", "document-title.mjs"), `export async function readDocumentTitle(app) {
  if (!app) return { ok: false, status: "Photoshop is not available." };
  const document = app.activeDocument;
  if (!document) return { ok: false, status: "No document is open." };
  const title = document.title;
  if (!title) return { ok: false, status: "The document has no title." };
  return { ok: true, status: "Read document.title outside executeAsModal.", title };
}
`);
  fs.writeFileSync(path.join(project, "src", "DocumentTitle.tsx"), `import React, { useState } from "react";
import { photoshop } from "./globals";
import { readDocumentTitle } from "./document-title.mjs";
import { appliedConstraints } from "./panel-design.mjs";
import "./panel-design.css";

export function DocumentTitlePanel() {
  const [status, setStatus] = useState("Idle");
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState("");
  async function read() {
    setBusy(true);
    setStatus("Loading");
    try {
      const result = await readDocumentTitle(photoshop?.app);
      setTitle(result.title || "");
      setStatus(result.status);
    } catch (error) {
      setTitle("");
      setStatus(error instanceof Error ? error.message : "The read failed.");
    } finally {
      setBusy(false);
    }
  }
  const empty = !title && status === "Idle";
  return (
    <section className="document-title-panel" aria-busy={busy} data-design={appliedConstraints.join(" | ")}>
      <h1>Document title</h1>
      <p className="status" role="status">{status}</p>
      <button type="button" disabled={busy} onClick={read}>{busy ? "Loading" : "Read title"}</button>
      {title ? <p className="title">{title}</p> : <p className={empty ? "empty" : "error"}>{empty ? "No title yet." : status}</p>}
    </section>
  );
}
`);
  fs.writeFileSync(path.join(project, "test", "document-title.test.mjs"), `import assert from "node:assert/strict";
import { test } from "node:test";
import { readDocumentTitle } from "../src/document-title.mjs";

test("readDocumentTitle does not invent a title when Photoshop is absent", async () => {
  const missing = await readDocumentTitle(null);
  assert.equal(missing.ok, false);
  assert.match(missing.status, /not available/);
});

test("readDocumentTitle reads document.title and does not rename", async () => {
  const result = await readDocumentTitle({ activeDocument: { title: "Poster" } });
  assert.equal(result.ok, true);
  assert.equal(result.title, "Poster");
});
`);
  const pkgPath = path.join(project, "package.json");
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  pkg.scripts.test = "node --test";
  fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
  const mainPath = path.join(project, "src", "main.tsx");
  let main = fs.readFileSync(mainPath, "utf8");
  if (!main.includes("DocumentTitlePanel")) {
    main = `import { DocumentTitlePanel } from "./DocumentTitle";\n${main}`;
    main = main.replace(/<main>\s*/, "<main>\n          <DocumentTitlePanel />\n");
    fs.writeFileSync(mainPath, main);
  }
}
