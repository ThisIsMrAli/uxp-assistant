import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

const skill = path.resolve(".claude/skills/uxp-assistant");

test("the skill folder contains no skill-boilerplate directory", () => {
  const found = [];
  walk(skill, (full, stat) => {
    if (stat.isDirectory() && path.basename(full) === "skill-boilerplate") found.push(full);
  });
  assert.deepEqual(found, []);
});

test("a copied skill folder resolves its scripts inside itself", () => {
  const copy = fs.mkdtempSync(path.join(os.tmpdir(), "uxp-skill-copy-"));
  fs.cpSync(skill, copy, { recursive: true, filter: (source) => path.basename(source) !== "node_modules" });
  const escapes = [];
  walk(copy, (full, stat) => {
    if (!stat.isFile() || !full.endsWith(".mjs")) return;
    const text = fs.readFileSync(full, "utf8");
    const specs = [...text.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)].map((match) => match[1]);
    for (const spec of specs) {
      if (!spec.startsWith(".")) continue;
      const resolved = path.resolve(path.dirname(full), spec);
      const inside = resolved === copy || resolved.startsWith(copy + path.sep);
      if (!inside) escapes.push(`${path.relative(copy, full)} -> ${spec}`);
    }
  });
  assert.deepEqual(escapes, []);

  const home = fs.mkdtempSync(path.join(os.tmpdir(), "uxp-skill-home-"));
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "uxp-skill-out-"));
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), "uxp-skill-empty-"));
  const env = { ...process.env, HOME: home, SKILL_TEST_HOME: home };
  for (const key of Object.keys(env)) if (key.startsWith("NODE_TEST") || key === "NODE_CHANNEL_FD") delete env[key];
  const started = spawnSync(process.execPath, ["scripts/skill.mjs", "start", "--empty", empty, "--out", out], {
    cwd: copy,
    encoding: "utf8",
    env
  });
  assert.equal(started.status, 0, started.stdout + started.stderr);
  assert.equal(`${started.stdout}\n${started.stderr}`.includes("Cannot find"), false, started.stdout + started.stderr);
  const body = JSON.parse(started.stdout.trim().split("\n").filter(Boolean).at(-1));
  assert.equal(body.ok, true);
  assert.equal(body.network, false);
  assert.equal(fs.existsSync(path.join(copy, "skill-boilerplate")), false);
});

test("UXP dashboard start is under three seconds and mode comes before the network", () => {
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
  } finally {
    run(["dashboard", "stop", "--out", out]);
  }
});

function walk(dir, visit) {
  for (const name of fs.readdirSync(dir)) {
    if (name === "node_modules" || name === ".git") continue;
    const full = path.join(dir, name);
    const stat = fs.lstatSync(full);
    visit(full, stat);
    if (stat.isDirectory()) walk(full, visit);
  }
}
