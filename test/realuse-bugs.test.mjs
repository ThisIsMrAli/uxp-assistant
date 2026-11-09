import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import extension from "../.claude/skills/uxp-assistant/extension.mjs";
import { scriptChangeAsk } from "../.claude/skills/uxp-assistant/scripts/lib/ask.mjs";
import { homeDir as uxpHome, rememberOut as rememberUxp } from "../.claude/skills/uxp-assistant/scripts/lib/paths.mjs";
import { previewTarget } from "../.claude/skills/uxp-assistant/scripts/lib/preview-target.mjs";
import { appendAnswerLine, publishAsk } from "../.claude/skills/uxp-assistant/scripts/lib/session.mjs";
import { readScriptGrant } from "../.claude/skills/uxp-assistant/scripts/lib/workflow.mjs";
import { nextAction } from "../skill-boilerplate/.claude/skills/skill-boilerplate/scripts/lib/next.mjs";
import { homeDir as boilerplateHome } from "../skill-boilerplate/.claude/skills/skill-boilerplate/scripts/lib/paths.mjs";
import { refreshSources } from "../skill-boilerplate/.claude/skills/skill-boilerplate/scripts/lib/refresh.mjs";
import { recordDocs, readSession, setMode, startSession } from "../skill-boilerplate/.claude/skills/skill-boilerplate/scripts/lib/session.mjs";
import { refreshSkill } from "../skill-boilerplate/.claude/skills/skill-boilerplate/scripts/refresh.mjs";
import { startSkill } from "../skill-boilerplate/.claude/skills/skill-boilerplate/scripts/start.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const blank = path.join(root, "skill-boilerplate/examples/blank/extension.mjs");

function temp(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), name));
}

test("B1 refresh resolves the session and the next line includes --out", async () => {
  const out = temp("uxp-b1-");
  const previous = process.env.SKILL_OUT;
  delete process.env.SKILL_OUT;
  await startSkill({ extensionPath: blank, out, input: "/tmp/named" });
  await setMode(out, "chat");
  const refreshed = await refreshSkill({
    extensionPath: blank,
    fetchImpl: async () => ({ ok: true, text: async () => "panel document name" })
  });
  assert.equal(path.resolve(refreshed.out), path.resolve(out));
  assert.match(refreshed.next, /--out/);
  const nxt = nextAction(out, { dashboardUp: false });
  assert.match(`${nxt.command || ""} ${nxt.say}`, new RegExp(`--out ${out.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  if (previous === undefined) delete process.env.SKILL_OUT;
  else process.env.SKILL_OUT = previous;
});

test("B2 a failed page finishes the docs step as done", () => {
  const out = temp("uxp-b2-");
  startSession(out, { addon: "Blank", addonPath: "/tmp/named", steps: [
    { id: "docs", label: "Docs" },
    { id: "done", label: "Done" }
  ] });
  recordDocs(out, {
    ok: false,
    fresh: [],
    stale: ["old"],
    failed: ["missing"],
    retrievedAt: "t",
    pages: [
      { id: "old", url: "https://example.test/old", freshness: "stale" },
      { id: "missing", url: "https://example.test/missing", freshness: "failed" }
    ]
  });
  const docs = readSession(out).steps.find((step) => step.id === "docs");
  assert.equal(docs.status, "done");
  assert.match(docs.detail, /fresh 0, stale 1, failed 1/);
  assert.equal(readSession(out).docs.failed[0], "missing");
});

test("B3 a finished fetch clears its timeout", async () => {
  const out = temp("uxp-b3-");
  let cleared = false;
  const original = global.clearTimeout;
  global.clearTimeout = (id) => {
    cleared = true;
    return original(id);
  };
  try {
    const started = Date.now();
    await refreshSources(out, [{ id: "page", url: "https://example.test/page" }], {
      fetchImpl: async () => ({ ok: true, text: async () => "panel" }),
      pageTimeoutMs: 8000
    });
    assert.ok(Date.now() - started < 1000);
    assert.equal(cleared, true);
  } finally {
    global.clearTimeout = original;
  }
});

test("B4 a dashboard approve without a copied scope hash still grants that question", () => {
  const out = temp("uxp-b4-");
  const published = publishAsk(out, scriptChangeAsk({
    scope: { commands: ["npm test"], files: ["src/main.tsx"] },
    changes: [{ kind: "file", name: "src/main.tsx" }]
  }));
  appendAnswerLine(out, {
    type: "answer",
    askId: "script-change",
    nonce: published.ask.nonce,
    value: "approve",
    via: "dashboard",
    at: new Date().toISOString()
  });
  const grant = readScriptGrant(out);
  assert.equal(grant.mismatch, undefined);
  assert.equal(grant.scopeSha, published.ask.scopeSha);
  assert.equal(grant.via, "dashboard");
});

test("B5 the next line does not mark tests, package, or the host done", () => {
  const out = temp("uxp-b5-");
  startSession(out, { addon: "Blank", addonPath: "/tmp/named", steps: [
    { id: "prepare", label: "Prepare" },
    { id: "docs", label: "Docs" },
    { id: "tests", label: "Tests" },
    { id: "package", label: "Package" },
    { id: "host-verification", label: "Host" },
    { id: "done", label: "Done" }
  ] });
  setMode(out, "chat");
  const session = readSession(out);
  session.steps.find((step) => step.id === "docs").status = "done";
  session.steps.find((step) => step.id === "tests").status = "running";
  fs.writeFileSync(path.join(out, "session.json"), `${JSON.stringify(session)}\n`);
  fs.writeFileSync(path.join(out, "questions.json"), "[]\n");
  const nxt = nextAction(out);
  assert.equal(nxt.step, "tests");
  assert.equal(/status done/.test(nxt.say), false);
  assert.match(nxt.say, /Do not mark it done/);
});

test("B6 the record format is documented and every next line is present", () => {
  const skill = fs.readFileSync(path.join(root, ".claude/skills/uxp-assistant/SKILL.md"), "utf8");
  assert.match(skill, /agent-result\.json/);
  assert.match(skill, /"goal"/);
  assert.match(skill, /"sha256"/);
  assert.match(skill, /scripts\/skill\.mjs record --out/);
  const boilerplate = fs.readFileSync(path.join(root, "skill-boilerplate/.claude/skills/skill-boilerplate/SKILL.md"), "utf8");
  assert.match(boilerplate, /refresh\.mjs --out/);
});

test("B12 a test process does not write the real home", () => {
  const out = temp("uxp-b12-");
  const uxp = uxpHome();
  const boilerplate = boilerplateHome();
  assert.equal(uxp.startsWith(process.env.SKILL_TEST_HOME), true);
  assert.equal(boilerplate.startsWith(process.env.SKILL_TEST_HOME), true);
  assert.equal(uxp.startsWith(path.join(os.homedir(), ".uxp-assistant")), false);
  rememberUxp(out);
  const pointer = path.join(uxp, "current.json");
  assert.equal(fs.existsSync(pointer), true);
  assert.equal(pointer.includes(`${path.sep}.uxp-assistant${path.sep}`) || pointer.endsWith(`${path.sep}.uxp-assistant${path.sep}current.json`), true);
  assert.equal(pointer.startsWith(os.homedir() + path.sep), false);
});

test("B13 boilerplate tests resolve their files from any working directory", () => {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith("NODE_TEST") || key === "NODE_CHANNEL_FD") delete env[key];
  const result = spawnSync(process.execPath, ["--test", path.join(root, "skill-boilerplate/test/parity.test.mjs")], {
    cwd: os.tmpdir(),
    encoding: "utf8",
    env
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /pass /);
  const script = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).scripts.test;
  assert.equal(script, "node scripts/run-tests.mjs");
  const runner = fs.readFileSync(path.join(root, "scripts/run-tests.mjs"), "utf8");
  assert.match(runner, /"--test"/);
  assert.match(runner, /skill-boilerplate/);
  assert.doesNotMatch(runner, /"--test", "test"/);
});

test("B14 starting again keeps answers", async () => {
  const out = temp("uxp-b14-");
  await startSkill({ extensionPath: blank, out, input: "/tmp/named" });
  fs.appendFileSync(path.join(out, "answers.jsonl"), `${JSON.stringify({ type: "answer", askId: "goal", nonce: "abc", value: "keep me" })}\n`);
  const again = await startSkill({ extensionPath: blank, out, input: "/tmp/named" });
  assert.equal(again.kept, true);
  assert.match(fs.readFileSync(path.join(out, "answers.jsonl"), "utf8"), /keep me/);
  const questions = JSON.parse(fs.readFileSync(path.join(out, "questions.json"), "utf8"));
  assert.equal(questions[0].id, "mode");
});

test("B16 preview output stays beside the package and does not claim a cloud capture", () => {
  const ccx = path.join(temp("uxp-b16-"), "plugin.ccx");
  const target = previewTarget({ ccx });
  assert.equal(target.capturedOn, "this machine");
  assert.equal(target.evidence, path.join(path.dirname(ccx), "preview"));
  assert.equal(target.hostExecuted, false);
  const page = fs.readFileSync(path.join(root, ".claude/skills/uxp-assistant/scripts/bundle-preview.mjs"), "utf8");
  assert.equal(page.includes("this cloud environment"), false);
});

test("B17 the dashboard drops the Express leftovers", () => {
  const page = fs.readFileSync(path.join(root, "skill-boilerplate/.claude/skills/skill-boilerplate/assets/dashboard/app.js"), "utf8");
  const server = fs.readFileSync(path.join(root, "skill-boilerplate/.claude/skills/skill-boilerplate/scripts/lib/server.mjs"), "utf8");
  assert.equal(page.includes("listing-review"), false);
  assert.equal(page.includes("listingBlock"), false);
  assert.equal(page.includes('step.id === "access"'), false);
  assert.equal(server.includes("Review dashboard"), false);
  assert.match(server, /Session dashboard/);
  assert.match(page, /status === "running" \? h\("span", \{ class: "tag", "data-k": "running", text: "Now" \}/);
});

test("UX questions skip the empty-folder set for an existing project and recommend one choice", () => {
  const existing = extension.questions({ kind: "existing", path: "/tmp/plugin" });
  const ids = existing.map((item) => item.id);
  for (const skipped of ["os", "name", "id", "framework", "context"]) assert.equal(ids.includes(skipped), false, skipped);
  assert.deepEqual(ids, ["goal", "host", "permissions"]);
  const empty = extension.questions({ kind: "empty", path: "/tmp/parent" });
  assert.equal(empty.some((item) => item.id === "os"), false);
  const permissions = empty.find((item) => item.id === "permissions");
  assert.equal(permissions.input, undefined);
  assert.match(permissions.options[0].label, /\(Recommended\)/);
  for (const question of empty) {
    if (!question.options?.length) continue;
    assert.ok(question.options.some((item) => /\(Recommended\)/.test(item.label)), question.id);
  }
});

test("an advisory note lists the create-bolt-uxp chain without downgrading it", () => {
  const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  assert.equal(pkg.dependencies["create-bolt-uxp"], "1.3.27");
  assert.match(readme, /GHSA-g3hv-75wg-m249/);
  assert.equal(readme.includes("create-bolt-uxp@0.2.5"), false);
});
