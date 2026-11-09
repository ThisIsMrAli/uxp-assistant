import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { BOILERPLATE_API, BOILERPLATE_ROOT } from "../.claude/skills/uxp-assistant/scripts/boilerplate-boundary.mjs";

const skill = path.resolve(".claude/skills/uxp-assistant");
const outside = ["skill-", "boilerplate"].join("");

test("the boilerplate folder runs its own tests with no parent imports", () => {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith("NODE_TEST") || key === "NODE_CHANNEL_FD") delete env[key];
  const result = spawnSync("npm", ["test"], { cwd: BOILERPLATE_ROOT, encoding: "utf8", env });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const summary = `${result.stdout}\n${result.stderr}`.replace(/\u001b\[[0-9;]*m/g, "");
  const fails = summary.match(/^[^\d\n]*fail\s+(\d+)\s*$/m);
  assert.ok(fails, summary);
  assert.equal(Number(fails[1]), 0);
});

test("UXP Assistant imports the boilerplate only through api.mjs", () => {
  const hits = [];
  walk(skill, (file, text) => {
    if (!text.includes(outside)) return;
    hits.push(path.relative(skill, file));
  });
  assert.deepEqual(hits, ["scripts/boilerplate-boundary.mjs"]);
  const boundary = fs.readFileSync(path.join(skill, "scripts/boilerplate-boundary.mjs"), "utf8");
  assert.equal(path.resolve(BOILERPLATE_API), path.join(BOILERPLATE_ROOT, "api.mjs"));
  assert.match(boundary, /api\.mjs/);
  assert.equal(boundary.includes("/scripts/"), false);
  assert.equal(boundary.includes("/assets/"), false);
});

test("UXP dashboard start is under three seconds and mode comes before the network", async () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "uxp-boundary-"));
  const skillCli = path.resolve(".claude/skills/uxp-assistant/scripts/skill.mjs");
  const run = (args) => {
    const result = spawnSync(process.execPath, [skillCli, ...args], { encoding: "utf8" });
    let json = null;
    const raw = result.stdout || "";
    const at = raw.indexOf("{");
    if (at >= 0) json = JSON.parse(raw.slice(at));
    return { status: result.status, json, stdout: result.stdout, stderr: result.stderr };
  };
  const started = run(["start", "--out", out]);
  assert.equal(started.status, 0, started.stdout + started.stderr);
  assert.equal(started.json.network, false);
  assert.equal(started.json.questions[0], "mode");
  assert.equal(fs.existsSync(path.join(out, "docs")), false);
  run(["session", "mode", "--set", "dashboard", "--out", out]);
  const began = Date.now();
  const dash = run(["dashboard", "start", "--no-open", "--out", out]);
  const ms = Date.now() - began;
  try {
    assert.equal(dash.json.ok, true, dash.stdout + dash.stderr);
    assert.match(dash.json.url, /^http:\/\/127\.0\.0\.1:\d+\/\?t=/);
    assert.ok(ms < 3000, `UXP dashboard start took ${ms}ms`);
    const nxt = run(["session", "next", "--out", out]);
    assert.equal(JSON.stringify(nxt.json).includes("AskQuestion"), false);
    fs.writeFileSync(path.resolve("evidence/dashboard-timing.json"), `${JSON.stringify({
      method: "Wall clock around dashboard start --no-open after the session exists. No browser is opened. The reference used the same command on express-addon-review 0.4.0.",
      referenceMs: 180,
      boilerplateMeasuredByItsOwnSuite: true,
      uxpAssistantMs: ms,
      uxpUrlShape: "http://127.0.0.1:<port>/?t=<token>"
    }, null, 2)}\n`);
  } finally {
    run(["dashboard", "stop", "--out", out]);
  }
});

function walk(dir, visit) {
  for (const name of fs.readdirSync(dir)) {
    if (name === "node_modules") continue;
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) walk(full, visit);
    else if (/\.(mjs|js|md)$/.test(name)) visit(full, fs.readFileSync(full, "utf8"));
  }
}
