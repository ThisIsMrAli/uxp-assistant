import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { run } from "../.claude/skills/uxp-assistant/scripts/skill.mjs";

const FIXTURE = `<html><body><p>
panel command dialog
HTMLWebViewElement allowLocalRendering
app.activeDocument document name selected layer layer name
Name of the layer
manifest entrypoints
</p></body></html>`;

const ANSWERS = {
  goal: "Show the document name and the selected layer name",
  host: "phxs",
  framework: "react",
  os: "darwin",
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

test("the dashboard walk answers every stage from the page and hands off the goal", async () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "uxp-empty-"));
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "uxp-walk-"));
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const href = String(url);
    if (href.includes("developer.adobe.com") || href.includes("example.test")) {
      return { ok: true, async text() { return FIXTURE; } };
    }
    return original(url, init);
  };
  try {
    const started = await run(["start", "--empty", parent, "--out", out]);
    assert.equal(started.network, false);
    assert.equal(started.questions[0], "mode");
    const launch = JSON.parse(fs.readFileSync(path.join(out, "launch.json"), "utf8"));
    assert.equal(launch.kind, "empty");
    assert.equal(launch.project, "");
    assert.equal(launch.input, parent);
    assert.equal(JSON.parse(fs.readFileSync(path.join(out, "session.json"), "utf8")).addon.path, parent);

    await run(["session", "mode", "--set", "dashboard", "--out", out]);
    const began = Date.now();
    const dash = await run(["dashboard", "start", "--no-open", "--out", out]);
    const ms = Date.now() - began;
    assert.equal(dash.ok, true, JSON.stringify(dash));
    assert.match(dash.url, /^http:\/\/127\.0\.0\.1:\d+\/\?t=/);
    assert.ok(ms < 3000, `dashboard start took ${ms}ms`);
    console.log(`time-to-dashboard-ms ${ms}`);

    const seen = [];
    for (let turn = 0; turn < 30; turn += 1) {
      const nxt = await run(["session", "next", "--out", out]);
      assert.equal(JSON.stringify(nxt).includes("AskQuestion"), false, JSON.stringify(nxt));
      if (nxt.action === "refresh") {
        const refreshed = await run(["refresh", "--out", out]);
        assert.equal(refreshed.ok, true, JSON.stringify(refreshed));
        assert.equal(refreshed.fresh.length, 19);
        assert.deepEqual(refreshed.stale, []);
        assert.deepEqual(refreshed.failed, []);
        const state = await dashboardState(out);
        assert.equal(state.session.addon.path, parent);
        assert.equal(state.session.docs.fresh.length, 19);
        assert.equal(state.session.addon.docsSha || "", "");
        const page = await dashboardText(out, `/?t=${serverInfo(out).token}`);
        assert.match(page, /Skip to the session/);
        assert.equal(page.includes("Skip to the review"), false);
        assert.equal(page.includes("Panel bugs"), false);
        assert.equal(page.includes("From the scan"), false);
        continue;
      }
      if (nxt.action === "ask") {
        const questions = JSON.parse(fs.readFileSync(path.join(out, "questions.json"), "utf8"));
        const question = questions.find((item) => item.id === nxt.ask);
        assert.ok(question, nxt.ask);
        if (nxt.ask === "feasibility") {
          assert.ok(question.options.some((item) => item.id === "continue"));
          assert.equal(question.options.some((item) => item.id === "pause"), false);
        }
        if (nxt.ask === "runtime") {
          const ids = question.options.map((item) => item.id);
          assert.deepEqual(ids.filter((id) => id === "native" || id === "webview").sort(), ["native", "webview"]);
          assert.ok(ids.length >= 2);
        }
        assert.equal(ANSWERS[nxt.ask] !== undefined, true, `unexpected question ${nxt.ask}`);
        await run(["session", "ask", "--id", nxt.ask, "--out", out]);
        await postAnswer(out, nxt.ask, ANSWERS[nxt.ask]);
        const waited = await run(["session", "wait", "--id", nxt.ask, "--timeout", "2", "--out", out]);
        assert.equal(waited.status, "answered", JSON.stringify(waited));
        assert.equal(waited.via, "dashboard");
        assert.equal(waited.value, ANSWERS[nxt.ask]);
        seen.push(nxt.ask);
        continue;
      }
      if (nxt.action === "apply" || nxt.action === "finish" || nxt.action === "domain") break;
      throw new Error(`unexpected next ${JSON.stringify(nxt)}`);
    }

    assert.deepEqual(seen, [
      "goal", "host", "framework", "context", "name", "id", "permissions",
      "feasibility", "runtime", "design", "validation", "narrow-permissions", "consequential"
    ]);
    const lines = fs.readFileSync(path.join(out, "answers.jsonl"), "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));
    const answers = lines.filter((line) => line.type === "answer");
    assert.equal(answers.length, seen.length);
    assert.ok(answers.every((line) => line.via === "dashboard"));

    const handed = await run(["domain", "--out", out]);
    assert.equal(handed.state, "awaiting-agent-implementation", JSON.stringify(handed));
    assert.equal(handed.hostExecuted, false);
    assert.equal(handed.contract.goal, ANSWERS.goal);
    assert.equal(JSON.parse(fs.readFileSync(path.join(out, "session.json"), "utf8")).mode, "dashboard");
    assert.equal(fs.existsSync(path.join(out, "domain")), true);
  } finally {
    globalThis.fetch = original;
    await run(["dashboard", "stop", "--out", out]).catch(() => {});
  }
});

function serverInfo(out) {
  return JSON.parse(fs.readFileSync(path.join(out, "server.json"), "utf8"));
}

async function postAnswer(out, id, value) {
  const info = serverInfo(out);
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
}

async function dashboardState(out) {
  const info = serverInfo(out);
  const response = await fetch(`http://127.0.0.1:${info.port}/api/state?t=${info.token}`);
  assert.equal(response.status, 200);
  return response.json();
}

async function dashboardText(out, pathname) {
  const info = serverInfo(out);
  const response = await fetch(`http://127.0.0.1:${info.port}${pathname}`);
  assert.equal(response.status, 200);
  return response.text();
}
