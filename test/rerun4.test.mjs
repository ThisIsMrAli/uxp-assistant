import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { scriptChangeAsk } from "../.claude/skills/uxp-assistant/scripts/lib/ask.mjs";
import { commandChangeSet, reviewCommandProvenance, showsHonestUiState, testsCoverFeature } from "../.claude/skills/uxp-assistant/scripts/lib/review.mjs";
import { emptySession, publishAsk, readMerged } from "../.claude/skills/uxp-assistant/scripts/lib/session.mjs";
import { readScriptGrant } from "../.claude/skills/uxp-assistant/scripts/lib/workflow.mjs";
import { run } from "../.claude/skills/uxp-assistant/scripts/skill.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function temp(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), name));
}

test("NT4 a script-change stop is closed, and a new question can be approved", async () => {
  const project = temp("uxp-nt4-project-");
  fs.writeFileSync(path.join(project, "package.json"), `${JSON.stringify({ scripts: { test: "node --test" } })}\n`);
  const baseline = { scripts: { test: "" }, files: {}, commandFiles: {}, packaging: {} };
  const drift = commandChangeSet(project, baseline);
  assert.ok(drift.changes.length > 0);
  const out = temp("uxp-nt4-");
  await run(["start", "--empty", temp("uxp-nt4-empty-"), "--out", out]);
  const sessionPath = path.join(out, "session.json");
  const live = JSON.parse(fs.readFileSync(sessionPath, "utf8"));
  live.asks.push({
    id: "script-change",
    nonce: "s1",
    status: "pending",
    options: [{ id: "approve", label: "Run" }, { id: "stop", label: "Stop" }]
  });
  fs.writeFileSync(sessionPath, `${JSON.stringify(live, null, 2)}\n`);
  const stopped = await run(["session", "answer", "--id", "script-change", "--value", "stop", "--out", out]);
  assert.equal(stopped.ok, true, JSON.stringify(stopped));
  await assert.rejects(() => run(["session", "answer", "--id", "script-change", "--value", "approve", "--out", out]), /already answered stop/);
  assert.equal(fs.readFileSync(path.join(out, "answers.jsonl"), "utf8").includes("\"value\":\"approve\""), false);
  const domain = temp("uxp-nt4-domain-");
  fs.mkdirSync(domain, { recursive: true });
  fs.writeFileSync(path.join(domain, "session.json"), `${JSON.stringify(emptySession(), null, 2)}\n`);
  publishAsk(domain, scriptChangeAsk({ changes: drift.changes, scope: drift.scope }));
  const { answerFromChat } = await import("../.claude/skills/uxp-assistant/scripts/lib/session.mjs");
  answerFromChat(domain, "script-change", "stop");
  const declined = readScriptGrant(domain);
  assert.equal(declined.declined, true);
  const blocked = reviewCommandProvenance(project, baseline, declined);
  assert.equal(blocked.ok, false);
  assert.ok(blocked.scope, blocked.say);
  const current = readMerged(domain).asks.find((item) => item.id === "script-change");
  const pendingSame = current && current.status !== "answered" && JSON.stringify(current.scope) === JSON.stringify(blocked.scope);
  assert.equal(pendingSame, false);
  publishAsk(domain, scriptChangeAsk(blocked));
  const again = readMerged(domain).asks.find((item) => item.id === "script-change");
  assert.equal(again.status, "pending");
  assert.notEqual(again.nonce, current.nonce);
  answerFromChat(domain, "script-change", "approve");
  const grant = readScriptGrant(domain);
  assert.equal(grant.declined, undefined);
  const allowed = reviewCommandProvenance(project, baseline, grant);
  assert.equal(allowed.ok, true, allowed.say);
  fs.rmSync(project, { recursive: true, force: true });
  fs.rmSync(out, { recursive: true, force: true });
  fs.rmSync(domain, { recursive: true, force: true });
});

test("NT5 offline names pause, stop, and a manual refresh", async () => {
  const out = temp("uxp-nt5-");
  await run(["start", "--empty", temp("uxp-nt5-empty-"), "--out", out]);
  const sessionPath = path.join(out, "session.json");
  const session = JSON.parse(fs.readFileSync(sessionPath, "utf8"));
  session.docs = { ok: false, fresh: [], stale: [], failed: ["manifest"], pages: [] };
  session.asks.push({ id: "docs-retry", nonce: "n1", status: "answered", options: [{ id: "refresh", label: "Refresh" }, { id: "pause", label: "Pause" }, { id: "stop", label: "Stop" }] });
  fs.writeFileSync(sessionPath, `${JSON.stringify(session, null, 2)}\n`);
  fs.writeFileSync(path.join(out, "answers.jsonl"), `${JSON.stringify({ type: "answer", askId: "docs-retry", nonce: "n1", value: "refresh" })}\n`);
  fs.writeFileSync(path.join(out, "docs-retry-state.json"), `${JSON.stringify({ attempts: 3, appliedNonce: "n1" })}\n`);
  const offline = await run(["session", "next", "--out", out]);
  assert.equal(offline.action, "offline", JSON.stringify(offline));
  assert.match(offline.next, /pause/i);
  assert.match(offline.next, /stop/i);
  assert.match(offline.next, /node scripts\/skill\.mjs refresh --out/);
  assert.equal(offline.next.includes("Do not run refresh"), false);
  assert.match(offline.command, /session ask --id docs-retry/);
  const asked = await run(["session", "ask", "--id", "docs-retry", "--out", out]);
  assert.equal(asked.ok, true, JSON.stringify(asked));
  const refreshedAsk = JSON.parse(fs.readFileSync(sessionPath, "utf8")).asks.find((item) => item.id === "docs-retry");
  assert.notEqual(refreshedAsk.nonce, "n1");
  fs.appendFileSync(path.join(out, "answers.jsonl"), `${JSON.stringify({ type: "answer", askId: "docs-retry", nonce: refreshedAsk.nonce, value: "refresh" })}\n`);
  const manual = await run(["session", "next", "--out", out]);
  assert.equal(manual.action, "refresh", JSON.stringify(manual));
  const skill = fs.readFileSync(path.join(root, ".claude/skills/uxp-assistant/SKILL.md"), "utf8");
  assert.match(skill, /offline/);
  assert.match(skill, /manual refresh/i);
  assert.match(skill, /session ask --id <the paused question>/);
  fs.rmSync(out, { recursive: true, force: true });
});

test("NT6 pause resumes from its ask command and session next does not loop", async () => {
  const out = temp("uxp-nt6-");
  await run(["start", "--empty", temp("uxp-nt6-empty-"), "--out", out]);
  const sessionPath = path.join(out, "session.json");
  const write = (nonce, value) => {
    const session = JSON.parse(fs.readFileSync(sessionPath, "utf8"));
    session.asks = session.asks.filter((item) => item.id !== "docs-retry");
    session.asks.push({ id: "docs-retry", nonce, status: "answered", options: [{ id: "pause", label: "Pause" }, { id: "refresh", label: "Refresh" }, { id: "stop", label: "Stop" }] });
    session.docs = { ok: false, fresh: [], stale: [], failed: ["manifest"] };
    fs.writeFileSync(sessionPath, `${JSON.stringify(session, null, 2)}\n`);
    fs.writeFileSync(path.join(out, "answers.jsonl"), `${JSON.stringify({ type: "answer", askId: "docs-retry", nonce, value })}\n`);
  };
  write("p1", "pause");
  const first = await run(["session", "next", "--out", out]);
  assert.equal(first.action, "pause", JSON.stringify(first));
  assert.match(first.command, /session ask --id docs-retry/);
  assert.equal(first.command.includes("session next"), false);
  assert.match(first.next, /not finished/);
  const second = await run(["session", "next", "--out", out]);
  assert.equal(second.action, "resume", JSON.stringify(second));
  assert.equal(second.action === "pause", false);
  assert.match(second.command, /session ask --id docs-retry/);
  const asked = await run(["session", "ask", "--id", "docs-retry", "--out", out]);
  assert.equal(asked.ok, true, JSON.stringify(asked));
  const third = await run(["session", "next", "--out", out]);
  assert.equal(third.action === "pause", false, JSON.stringify(third));
  assert.equal(third.action === "resume", false, JSON.stringify(third));
  fs.rmSync(out, { recursive: true, force: true });
});

test("NT7 instanceof and a null-path assertion are not feature tests", () => {
  const project = temp("uxp-nt7-");
  fs.mkdirSync(path.join(project, "src"), { recursive: true });
  fs.mkdirSync(path.join(project, "test"), { recursive: true });
  fs.writeFileSync(path.join(project, "package.json"), `${JSON.stringify({ scripts: { test: "node --test" } })}\n`);
  fs.writeFileSync(path.join(project, "src", "layers.mjs"), "export function listLayers(app) { return app.activeDocument ? [\"Poster\"] : []; }\n");
  const write = (body) => fs.writeFileSync(path.join(project, "test", "layers.test.mjs"), body);
  write(`import assert from "node:assert/strict";
import { test } from "node:test";
import { listLayers } from "../src/layers.mjs";
test("type", () => { assert.equal(listLayers instanceof Function, true); });
`);
  const instanceOnly = testsCoverFeature(project, [], ["activeDocument"], ["src/layers.mjs"]);
  assert.equal(instanceOnly.ok, false, instanceOnly.say);
  assert.match(instanceOnly.say, /instanceof/);
  write(`import assert from "node:assert/strict";
import { test } from "node:test";
import { listLayers } from "../src/layers.mjs";
test("empty", () => { assert.equal(listLayers({ app: { activeDocument: null } }).length, 0); });
`);
  const nullOnly = testsCoverFeature(project, [], ["activeDocument"], ["src/layers.mjs"]);
  assert.equal(nullOnly.ok, false, nullOnly.say);
  write(`import assert from "node:assert/strict";
import { test } from "node:test";
import { listLayers } from "../src/layers.mjs";
test("reads a layer", () => { assert.equal(listLayers({ app: { activeDocument: { title: "Poster" } } })[0], "Poster"); });
`);
  const real = testsCoverFeature(project, [], ["activeDocument"], ["src/layers.mjs"]);
  assert.equal(real.ok, true, real.say);
  fs.rmSync(project, { recursive: true, force: true });
});

test("NT8 static and dead UI text is not rendered state", () => {
  assert.equal(showsHonestUiState("export function Panel(){ return <sp-body>Loading… Error: none. Retry later.</sp-body>; }"), false);
  assert.equal(showsHonestUiState("export function Panel(){ return <sp-body>Error codes are listed in the docs.</sp-body>; }"), false);
  const dead = `export function Panel(){
    const [status, setStatus] = useState("");
    function fail(){ setStatus("Error"); }
    return false ? <p>{status}</p> : null;
  }`;
  assert.equal(showsHonestUiState(dead), false);
  const honest = `export function Panel(){
    const [msg, setMsg] = useState("");
    function onRead(){ setMsg("No open document."); }
    return <button onClick={onRead}>{msg || "No open document."}</button>;
  }`;
  assert.equal(showsHonestUiState(honest), true);
});
