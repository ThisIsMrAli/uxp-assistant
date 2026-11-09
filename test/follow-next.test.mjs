import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURE = `panel command dialog
HTMLWebViewElement allowLocalRendering plugin:/
app.activeDocument document name selected layer layer name
manifest entrypoints
local page postMessage
project clips importFiles
Premiere version 25.6
manifest version 5`;

function run(skill, args, env) {
  const childEnv = { ...env };
  for (const key of Object.keys(childEnv)) if (key.startsWith("NODE_TEST") || key === "NODE_CHANNEL_FD") delete childEnv[key];
  const result = spawnSync(process.execPath, ["scripts/skill.mjs", ...args], {
    cwd: skill,
    encoding: "utf8",
    env: childEnv
  });
  const line = (result.stdout || "").trim().split("\n").filter(Boolean).at(-1) || "";
  let json;
  try {
    json = JSON.parse(line);
  } catch {
    throw new Error(`no json from ${args.join(" ")}\n${result.stdout}\n${result.stderr}`);
  }
  if (result.status && json.ok !== false && !json.status && !json.state) {
    throw new Error(json.error || result.stderr || result.stdout);
  }
  return json;
}

async function post(session, id, value, env) {
  const info = JSON.parse(fs.readFileSync(path.join(session, "server.json"), "utf8"));
  const posted = await fetch(`http://127.0.0.1:${info.port}/api/answer`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${info.token}`,
      origin: `http://127.0.0.1:${info.port}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({ id, value })
  });
  const body = await posted.json().catch(() => ({}));
  assert.equal(posted.status, 200, JSON.stringify(body));
  return body;
}

async function follow(skill, session, answers, env, { chat }) {
  let result = run(skill, ["start", "--empty", answers.folder, "--out", session], env);
  assert.match(result.next || "", /mode/);
  run(skill, ["session", "mode", "--set", chat ? "chat" : "dashboard", "--out", session], env);
  if (!chat) {
    const dash = run(skill, ["dashboard", "start", "--no-open", "--out", session], env);
    assert.equal(dash.ok, true, JSON.stringify(dash));
  }
  for (let turn = 0; turn < 40; turn += 1) {
    result = run(skill, ["session", "next", "--out", session], env);
    assert.ok(result.next, JSON.stringify(result));
    assert.equal(/mark it done|status done/.test(result.next), false, result.next);
    if (result.action === "domain") {
      return run(skill, ["domain", "--out", session], env);
    }
    if (result.action === "refresh") {
      const refreshed = run(skill, ["refresh", "--out", session], env);
      assert.equal(refreshed.ok, true, JSON.stringify(refreshed));
      assert.match(refreshed.next, /--out/);
      continue;
    }
    if (result.ask && answers[result.ask] !== undefined) {
      if (result.action === "ask") run(skill, ["session", "ask", "--id", result.ask, "--out", session], env);
      if (chat) {
        run(skill, ["session", "answer", "--id", result.ask, "--value", answers[result.ask], "--out", session], env);
      } else {
        await post(session, result.ask, answers[result.ask]);
        const waited = run(skill, ["session", "wait", "--id", result.ask, "--timeout", "2", "--out", session], env);
        assert.equal(waited.status, "answered", JSON.stringify(waited));
      }
      continue;
    }
    throw new Error(`stuck on ${JSON.stringify(result)}`);
  }
  throw new Error("the next lines did not reach domain");
}

function assertProject(session, folder, handed, { id, title, bridge, premiere, home }) {
  assert.equal(handed.state, "awaiting-agent-implementation", JSON.stringify(handed));
  assert.equal(handed.hostExecuted, false);
  assert.ok(handed.next, JSON.stringify(handed));
    assert.match(handed.next, /agent-result\.json/);
    assert.match(handed.next, /npm install/);
  assert.equal(/status done/.test(handed.next), false);
  const project = path.resolve(handed.project);
  assert.equal(project.startsWith(`${path.resolve(folder)}${path.sep}`), true, project);
  assert.equal(project.includes(`${path.sep}domain${path.sep}work${path.sep}`), false, project);
  const config = fs.readFileSync(path.join(project, "uxp.config.ts"), "utf8");
  assert.match(config, /manifestVersion:\s*5/);
  assert.match(config, /uniqueIds:\s*false/);
  assert.match(config, new RegExp(`export const id = ${JSON.stringify(id)}`));
  assert.match(config, new RegExp(`const name = ${JSON.stringify(title)}`));
  assert.equal(config.includes("Bolt UXP"), false);
  if (bridge) assert.match(config, new RegExp(`enableMessageBridge:\\s*"${bridge}"`));
  if (premiere) assert.match(config, /minVersion:\s*"25\.6\.0"/);
  const pointer = JSON.parse(fs.readFileSync(path.join(home, ".uxp-assistant", "current.json"), "utf8"));
  assert.equal(path.resolve(pointer.out), path.resolve(session));
}

async function scenario(answers, { chat = false, bridge = "", premiere = false, keep = false } = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "uxp-follow-home-"));
  const into = fs.mkdtempSync(path.join(os.tmpdir(), "uxp-follow-into-"));
  const env = {
    ...process.env,
    HOME: home,
    SKILL_TEST_HOME: home,
    SKILL_DOC_FIXTURE: FIXTURE
  };
  const installed = run(path.join(root, ".claude/skills/uxp-assistant"), ["install", "--into", into], env);
  assert.equal(installed.ok, true, JSON.stringify(installed));
  const skill = installed.skill;
  const session = fs.mkdtempSync(path.join(os.tmpdir(), "uxp-follow-session-"));
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "uxp-follow-empty-"));
  try {
    const handed = await follow(skill, session, { ...answers, folder }, env, { chat });
    assertProject(session, folder, handed, { id: answers.id, title: answers.name, bridge, premiere, home });
    if (keep) {
      const marker = path.join(handed.project, "USER_WORK.txt");
      fs.writeFileSync(marker, "do not delete");
      const again = run(skill, ["domain", "--out", session], env);
      assert.equal(again.kept, true, JSON.stringify(again));
      assert.equal(fs.readFileSync(marker, "utf8"), "do not delete");
    }
    const pkg = path.join(handed.project, "package.json");
    const sha256 = crypto.createHash("sha256").update(fs.readFileSync(pkg)).digest("hex");
    fs.writeFileSync(path.join(session, "agent-result.json"), `${JSON.stringify({
      goal: answers.goal,
      files: [{ path: "package.json", sha256 }]
    })}\n`);
    const recorded = run(skill, ["record", "--out", session], env);
    assert.equal(recorded.hostExecuted, false);
    assert.notEqual(recorded.state, "commands-finished");
    assert.match(`${recorded.say || ""} ${recorded.next || ""}`, /NOT TESTED|feature|documented/);
    const again = run(skill, ["session", "next", "--out", session], env);
    assert.notEqual(again.step, "intake");
    assert.notEqual(again.action, "finished");
  } finally {
    if (!chat) run(skill, ["dashboard", "stop", "--out", session], env);
  }
}

const native = {
  goal: "Show the document name and the selected layer name",
  host: "phxs",
  framework: "react",
  context: "panel",
  name: "Layer Names",
  id: "com.example.layernames",
  permissions: "none",
  feasibility: "continue",
  runtime: "native",
  design: "uxp-constraints",
  validation: "commands",
  "narrow-permissions": "narrow",
  consequential: "proceed"
};

test("an agent can follow each next line for a native Photoshop panel", async () => {
  await scenario(native, { keep: true });
});

test("an agent can follow each next line for a Photoshop WebView that needs postMessage", async () => {
  await scenario({
    ...native,
    goal: "Show a local page with postMessage and the document name",
    name: "Local Page",
    id: "com.example.webview",
    runtime: "webview"
  }, { bridge: "localOnly" });
});

test("an agent can follow each next line for Premiere", async () => {
  await scenario({
    ...native,
    goal: "List project clips using importFiles",
    host: "ppro",
    name: "Clip List",
    id: "com.example.premiere"
  }, { premiere: true });
});

test("an agent can follow each next line in chat mode", async () => {
  await scenario({
    ...native,
    name: "Chat Panel",
    id: "com.example.chat"
  }, { chat: true });
});
