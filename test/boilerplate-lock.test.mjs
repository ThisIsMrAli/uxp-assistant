import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { agentInstallRoots, hashTree, syncBoilerplate } from "../scripts/sync-boilerplate.mjs";

const root = path.resolve("skill-boilerplate");
const lockPath = path.resolve("BOILERPLATE.lock");

test("the vendored boilerplate matches BOILERPLATE.lock", () => {
  const lock = JSON.parse(fs.readFileSync(lockPath, "utf8"));
  assert.equal(lock.sourceRepo, "ThisIsMrAli/skill-boilerplate");
  assert.equal(lock.sourceCommit, null);
  assert.equal(lock.contentHash, hashTree(root));
  assert.match(lock.algorithm, /symlink/);
  assert.match(lock.algorithm, /install-agents/);
  const roots = agentInstallRoots(root);
  assert.equal(roots.length, 21);
  assert.ok(roots.includes(".cursor"));
  for (const agent of roots) assert.equal(fs.existsSync(path.join(root, agent)), false);
});

test("sync copies a checkout, skips secrets, and rewrites the lock", () => {
  const source = fs.mkdtempSync(path.join(os.tmpdir(), "bp-src-"));
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "bp-dest-"));
  const kept = path.join(dest, "keep.txt");
  fs.writeFileSync(kept, "keep");
  fs.mkdirSync(path.join(source, ".git"));
  fs.writeFileSync(path.join(source, ".git", "config"), "secret");
  fs.mkdirSync(path.join(source, "node_modules", "pkg"), { recursive: true });
  fs.writeFileSync(path.join(source, "node_modules", "pkg", "index.js"), "nope");
  fs.writeFileSync(path.join(source, ".env"), "TOKEN=1");
  fs.writeFileSync(path.join(source, "package.json"), "{}\n");
  fs.writeFileSync(path.join(source, "readme.txt"), "hello");
  fs.symlinkSync("readme.txt", path.join(source, "link.txt"));
  const lockFile = path.join(dest, "BOILERPLATE.lock");
  const lock = syncBoilerplate({ source, dest: path.join(dest, "skill-boilerplate"), lockFile, commit: "abc1234" });
  const copied = path.join(dest, "skill-boilerplate");
  assert.equal(fs.readFileSync(path.join(copied, "readme.txt"), "utf8"), "hello");
  assert.equal(fs.readlinkSync(path.join(copied, "link.txt")), "readme.txt");
  assert.equal(fs.existsSync(path.join(copied, ".git")), false);
  assert.equal(fs.existsSync(path.join(copied, "node_modules")), false);
  assert.equal(fs.existsSync(path.join(copied, ".env")), false);
  assert.equal(fs.existsSync(kept), true);
  assert.equal(lock.sourceCommit, "abc1234");
  assert.equal(lock.contentHash, hashTree(copied));
  assert.equal(JSON.parse(fs.readFileSync(lockFile, "utf8")).contentHash, lock.contentHash);
});

test("sync keeps a .. symlink that stays inside and refuses one that escapes", () => {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "bp-safe-"));
  fs.writeFileSync(path.join(dest, "marker.txt"), "stay");
  const source = fs.mkdtempSync(path.join(os.tmpdir(), "bp-inside-"));
  fs.writeFileSync(path.join(source, "readme.txt"), "hello");
  fs.mkdirSync(path.join(source, "nested"));
  fs.symlinkSync("../readme.txt", path.join(source, "nested", "up"));
  const copied = path.join(dest, "skill-boilerplate");
  syncBoilerplate({ source, dest: copied, lockFile: path.join(dest, "BOILERPLATE.lock"), commit: null });
  assert.equal(fs.readlinkSync(path.join(copied, "nested", "up")), "../readme.txt");
  assert.equal(fs.readFileSync(path.join(copied, "readme.txt"), "utf8"), "hello");
  fs.rmSync(copied, { recursive: true, force: true });
  for (const target of ["/tmp/outside", "../outside", "nested/../../outside"]) {
    const source = fs.mkdtempSync(path.join(os.tmpdir(), "bp-bad-"));
    fs.writeFileSync(path.join(source, "package.json"), "{}\n");
    fs.symlinkSync(target, path.join(source, "bad"));
    assert.throws(() => syncBoilerplate({
      source,
      dest: path.join(dest, "skill-boilerplate"),
      lockFile: path.join(dest, "BOILERPLATE.lock"),
      commit: null
    }), /Refusing/);
    assert.equal(fs.readFileSync(path.join(dest, "marker.txt"), "utf8"), "stay");
    assert.equal(fs.existsSync(path.join(dest, "skill-boilerplate")), false);
  }
});

test("sync from a checkout with agent install links matches the vendored lock", () => {
  const source = fs.mkdtempSync(path.join(os.tmpdir(), "bp-real-"));
  fs.cpSync(root, source, { recursive: true });
  const canonical = path.join(source, ".claude", "skills", "skill-boilerplate");
  for (const agent of agentInstallRoots(source)) {
    const link = path.join(source, agent, "skills", "skill-boilerplate");
    fs.mkdirSync(path.dirname(link), { recursive: true });
    fs.symlinkSync(path.relative(path.dirname(link), canonical), link);
    assert.match(fs.readlinkSync(link), /\.\./);
  }
  const packed = path.join(os.tmpdir(), `${path.basename(source)}.zip`);
  const zipped = spawnSync("zip", ["-r", "-y", "-X", packed, "."], { cwd: source, encoding: "utf8" });
  assert.equal(zipped.status, 0, zipped.stderr);
  const extracted = fs.mkdtempSync(path.join(os.tmpdir(), "bp-extract-"));
  const unzipped = spawnSync("unzip", ["-q", packed, "-d", extracted], { encoding: "utf8" });
  assert.equal(unzipped.status, 0, unzipped.stderr);
  assert.match(fs.readlinkSync(path.join(extracted, ".cursor", "skills", "skill-boilerplate")), /\.\./);
  const destParent = fs.mkdtempSync(path.join(os.tmpdir(), "bp-vendor-"));
  const copied = path.join(destParent, "skill-boilerplate");
  const lock = syncBoilerplate({
    source: extracted,
    dest: copied,
    lockFile: path.join(destParent, "BOILERPLATE.lock"),
    commit: null
  });
  const committed = JSON.parse(fs.readFileSync(lockPath, "utf8"));
  assert.equal(lock.contentHash, committed.contentHash);
  assert.equal(lock.contentHash, hashTree(copied));
  assert.equal(fs.existsSync(path.join(copied, ".cursor")), false);
  assert.equal(fs.existsSync(path.join(copied, ".claude", "skills", "skill-boilerplate", "SKILL.md")), true);
});

test("a changed vendored byte no longer matches its hash", () => {
  const source = fs.mkdtempSync(path.join(os.tmpdir(), "bp-hash-"));
  fs.writeFileSync(path.join(source, "a.txt"), "one");
  const before = hashTree(source);
  fs.writeFileSync(path.join(source, "a.txt"), "two");
  assert.notEqual(hashTree(source), before);
});
