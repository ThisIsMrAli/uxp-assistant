import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function npmBin() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function cleanEnv() {
  const env = { ...process.env, UXP_README_NPM_TEST: "1" };
  for (const key of Object.keys(env)) {
    if (key.startsWith("NODE_TEST") || key === "NODE_CHANNEL_FD") delete env[key];
  }
  return env;
}

test("npm test from the README runs every test file", { timeout: 1_200_000 }, async () => {
  const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");
  assert.match(readme, /Node 20 or newer\./);
  const runSection = readme.split("## Run")[1].split("## ")[0];
  assert.match(runSection, /(^|\n)npm test\r?\n/);
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  assert.equal(pkg.scripts.test, "node scripts/run-tests.mjs");
  assert.equal(pkg.engines.node, ">=20");

  const names = fs.readdirSync(path.join(root, "test"))
    .filter((name) => name.endsWith(".test.mjs") && name !== "readme-npm-test.mjs")
    .sort();
  const output = await new Promise((resolve, reject) => {
    const child = spawn(npmBin(), ["test"], { cwd: root, env: cleanEnv(), stdio: ["ignore", "pipe", "pipe"] });
    let text = "";
    const take = (chunk) => {
      text += chunk.toString();
      process.stderr.write(chunk);
    };
    child.stdout.on("data", take);
    child.stderr.on("data", take);
    child.on("error", reject);
    child.on("close", (status) => resolve({ status, text }));
  });

  assert.equal(output.status, 0, output.text.slice(-4000));
  assert.doesNotMatch(output.text, /Cannot find module/);
  assert.doesNotMatch(output.text, /UXP_BOILERPLATE_TESTS/);
  const listed = output.text.match(/test files: ([^\n]+)/);
  assert.ok(listed, "runner did not list test files");
  assert.deepEqual(listed[1].trim().split(/\s+/), names.map((name) => path.join("test", name)));
  const nodePasses = reporterCounts(output.text, "pass");
  const nodeFails = reporterCounts(output.text, "fail");
  assert.equal(nodeFails.at(-1), 0, output.text.slice(-2000));
  assert.ok(nodePasses.at(-1) >= names.length, `node suite reported ${nodePasses.at(-1)} passes for ${names.length} files`);
  console.error(`npm test suite: node ${nodePasses.at(-1)} pass / ${nodeFails.at(-1)} fail`);
});

function reporterCounts(text, label) {
  return [...text.matchAll(new RegExp(`(?:#|ℹ)\\s+${label}\\s+(\\d+)`, "g"))].map((match) => Number(match[1]));
}
