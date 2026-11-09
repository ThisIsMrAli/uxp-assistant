import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { test } from "node:test";

// NQ11: the lock and digests shipped in the skill are the repo's lock, with every package (all platforms) pinned.
test("NQ11 the shipped tooling lock matches package-lock.json and pins every package with integrity", () => {
  const checked = spawnSync(process.execPath, ["scripts/tooling-manifest.mjs", "--check"], { encoding: "utf8" });
  assert.equal(checked.status, 0, checked.stderr || checked.stdout);
  const lock = JSON.parse(fs.readFileSync(".claude/skills/uxp-assistant/tooling/package-lock.json", "utf8"));
  const tree = JSON.parse(fs.readFileSync(".claude/skills/uxp-assistant/tooling/tree.json", "utf8"));
  const pkg = JSON.parse(fs.readFileSync(".claude/skills/uxp-assistant/tooling/package.json", "utf8"));
  assert.deepEqual(pkg.dependencies, { "create-bolt-uxp": "1.3.27" });
  for (const [key, entry] of Object.entries(lock.packages)) {
    if (!key) continue;
    assert.match(entry.version, /^\d+\.\d+\.\d+/, key);
    if (!entry.inBundle) assert.match(entry.integrity || "", /^sha512-/, key);
    assert.match(tree.packages[key].digest, /^[0-9a-f]{64}$/, key);
  }
  const platforms = Object.keys(tree.packages).filter((key) => tree.packages[key].os);
  assert.equal(platforms.length, 20);
});
