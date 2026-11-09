import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { hashTree, syncBoilerplate } from "../scripts/sync-boilerplate.mjs";

const root = path.resolve("skill-boilerplate");
const lockPath = path.resolve("BOILERPLATE.lock");

test("the vendored boilerplate matches BOILERPLATE.lock", () => {
  const lock = JSON.parse(fs.readFileSync(lockPath, "utf8"));
  assert.equal(lock.sourceRepo, "ThisIsMrAli/skill-boilerplate");
  assert.equal(lock.sourceCommit, null);
  assert.equal(lock.contentHash, hashTree(root));
  assert.match(lock.algorithm, /symlink/);
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

test("sync refuses an absolute path, a .. symlink, and an escaping symlink before it replaces the folder", () => {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "bp-safe-"));
  fs.writeFileSync(path.join(dest, "marker.txt"), "stay");
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

test("a changed vendored byte no longer matches its hash", () => {
  const source = fs.mkdtempSync(path.join(os.tmpdir(), "bp-hash-"));
  fs.writeFileSync(path.join(source, "a.txt"), "one");
  const before = hashTree(source);
  fs.writeFileSync(path.join(source, "a.txt"), "two");
  assert.notEqual(hashTree(source), before);
});
