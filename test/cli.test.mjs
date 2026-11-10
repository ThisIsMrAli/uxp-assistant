import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { run } from "../.claude/skills/uxp-assistant/scripts/skill.mjs";
import { readMerged } from "../.claude/skills/uxp-assistant/scripts/runtime/lib/session.mjs";
import { fakeAdobe } from "./fixtures/fake-adobe.mjs";

const QR = "create a plugin that create high quality qr codes in premiere";
const made = [];
function temp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "uxp-cli-"));
  made.push(dir);
  return dir;
}
process.on("exit", () => made.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));

async function withFetch(work) {
  const original = globalThis.fetch;
  globalThis.fetch = fakeAdobe().fetchImpl;
  try {
    return await work();
  } finally {
    globalThis.fetch = original;
  }
}

test("a skill call with no description opens the interview instead of inventing a plugin", async () => {
  const out = path.join(temp(), "s");
  const started = await run(["start", "--goal", "/uxp-assistant", "--empty", temp(), "--mode", "chat", "--out", out]);
  assert.equal(started.plan.host, "(ask)");
  assert.equal(started.plan.name, "UXP Plugin");
  assert.equal(started.asked, "host");
  const ids = JSON.parse(fs.readFileSync(path.join(out, "questions.json"), "utf8")).map((item) => item.id);
  for (const id of ["host", "goal", "name", "description", "runtime", "widgets", "design", "plan"]) {
    assert.ok(ids.includes(id), id);
  }
  assert.ok(ids.indexOf("goal") < ids.indexOf("plan"));
  await assert.rejects(run(["start", "--yes", "--empty", temp()]), /nothing to build/i);
});

test("start in chat mode names the plan question, not the mode question, and the plan card says what was read", async () => {
  const out = path.join(temp(), "s");
  const started = await run(["start", "--goal", QR, "--empty", temp(), "--mode", "chat", "--out", out]);
  assert.equal(started.asked, "runtime");
  assert.equal(started.plan.host, "ppro");
  assert.equal(started.plan.name, "QR Codes");
  assert.match(started.card, /Premiere Pro panel "QR Codes"/);
  assert.match(started.next, /ask --id runtime/);
  assert.match(started.next, /AskQuestion/);
  assert.match(started.neverStop, /session next/);
});

test("start --yes picks chat, answers the plan card with Build it, and goes straight to the docs", async () => {
  const out = path.join(temp(), "s");
  const started = await run(["start", "--goal", QR, "--empty", temp(), "--yes", "--out", out]);
  assert.deepEqual(started.autoAnswered, ["mode=chat", "runtime=native", "widgets=spectrum", "design=match", "feat-output=both", "plan=build"]);
  assert.equal(started.asked, null);
  assert.match(started.command, /skill\.mjs docs --out /);
  assert.equal(readMerged(out).mode, "chat");
  assert.equal(readMerged(out).asks.find((ask) => ask.id === "plan").answer, "build");
});

test("start --yes still asks for the Adobe app when the request names none", async () => {
  const out = path.join(temp(), "s");
  const started = await run(["start", "--goal", "create a plugin that shows the document title", "--empty", temp(), "--yes", "--out", out]);
  assert.ok(started.autoAnswered.includes("mode=chat"));
  assert.ok(started.autoAnswered.includes("runtime=native"));
  assert.equal(started.autoAnswered.includes("plan=build"), false);
  assert.equal(started.asked, "host");
});

test("every command's next line carries --out, in chat mode no line mentions a dashboard, and find reads the session's own docs", async () => {
  const out = path.join(temp(), "s");
  await run(["start", "--goal", QR, "--empty", temp(), "--yes", "--out", out]);
  const docs = await withFetch(() => run(["docs", "--out", out]));
  assert.equal(docs.ok, true);
  assert.match(docs.command, /skill\.mjs build --out /);

  const found = await run(["find", "canvas", "2d", "--host", "ppro", "--out", out]);
  assert.equal(found.ok, true);
  assert.ok(found.results.length > 0);
  assert.ok(found.results.every((item) => item.file.startsWith(path.join(out, "docs"))), "the session's copy, not the shared one");

  const other = await run(["find", "canvas", "--host", "phxs", "--out", out]);
  assert.equal(other.ok, false, "a different app's docs are not saved, and the session's copy is not used for it");

  const state = await run(["session", "show", "--out", out]);
  assert.equal(state.ok !== false, true);
  const next = await run(["session", "next", "--out", out]);
  assert.doesNotMatch(JSON.stringify(next), /dashboard/i);
});

test("the implement line says how to run check for this session, and the closing line has no dashboard step in chat mode", async () => {
  const out = path.join(temp(), "s");
  await run(["start", "--goal", QR, "--empty", temp(), "--yes", "--out", out]);
  await withFetch(() => run(["docs", "--out", out]));
  const scaffold = path.join(temp(), "proj");
  // The build itself is covered in flow.test.mjs. Here the project exists, so build only reads and writes the brief.
  const plan = JSON.parse(fs.readFileSync(path.join(out, "plan.json"), "utf8"));
  plan.input = scaffold;
  plan.inPlace = false;
  fs.writeFileSync(path.join(out, "plan.json"), JSON.stringify(plan));
  const project = path.join(scaffold, "qr-codes");
  fs.mkdirSync(path.join(project, "src"), { recursive: true });
  fs.mkdirSync(path.join(project, "node_modules"));
  fs.writeFileSync(path.join(project, "uxp.config.ts"), "const manifest = { requiredPermissions: {} };\n");
  fs.writeFileSync(path.join(project, "package.json"), JSON.stringify({ scripts: { build: "node -e 0" } }));
  fs.writeFileSync(path.join(project, "src", "main.tsx"), "export {};\n");
  const built = await run(["build", "--out", out]);
  assert.equal(built.ok, true, JSON.stringify(built));
  assert.match(built.next, new RegExp(`skill\\.mjs check --out ${out.replaceAll("/", "\\/")}`));
  assert.doesNotMatch(built.next, /^.*dashboard/i);
});
