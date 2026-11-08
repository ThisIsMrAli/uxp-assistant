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

function writeTitle(project) {
  fs.mkdirSync(path.join(project, "test"), { recursive: true });
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
  return (
    <section>
      <h1>Document title</h1>
      <p className="status">{status}</p>
      <button type="button" disabled={busy} onClick={read}>{busy ? "Loading" : "Read title"}</button>
      {title ? <p>{title}</p> : <p className="error">{status}</p>}
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
