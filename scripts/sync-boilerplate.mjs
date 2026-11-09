#!/usr/bin/env node
/**
 * Replace the vendored skill-boilerplate folder from a local checkout and
 * rewrite BOILERPLATE.lock. Does not fetch, push, or create a repository.
 *
 *   node scripts/sync-boilerplate.mjs <path-to-skill-boilerplate-checkout> [--commit <sha>]
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const SOURCE_REPO = "ThisIsMrAli/skill-boilerplate";
export const ALGORITHM = "sha256 of sorted lines `type<TAB>relative-path<TAB>sha256`, UTF-8, with a trailing newline. Paths use `/` and sort by raw UTF-8 bytes. A file hashes its bytes. A symlink hashes its target string and is not followed. Entries named .git, node_modules, or .env are omitted. Root directories named by install-agents.mjs projectAgents are omitted; those are agent install links and are not vendored. A relative symlink target may contain '..' when the resolved path stays inside the checkout. An absolute target, or a target that resolves outside the checkout, is refused.";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function hashTree(root) {
  return hashEntries(collect(root, { strict: false }));
}

export function syncBoilerplate({ source, dest, lockFile, commit = null }) {
  const entries = collect(source, { strict: true });
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });
  const destRoot = path.resolve(dest);
  for (const entry of entries) {
    const to = path.resolve(destRoot, entry.path);
    if (to !== destRoot && !to.startsWith(destRoot + path.sep)) throw new Error(`Refusing to write outside the destination: ${entry.path}`);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    if (entry.type === "symlink") fs.symlinkSync(entry.target, to);
    else fs.copyFileSync(path.join(source, entry.path), to);
  }
  const lock = {
    algorithm: ALGORITHM,
    contentHash: hashEntries(entries),
    sourceCommit: commit,
    sourceRepo: SOURCE_REPO
  };
  fs.mkdirSync(path.dirname(path.resolve(lockFile)), { recursive: true });
  fs.writeFileSync(lockFile, `${JSON.stringify(lock, null, 2)}\n`);
  return lock;
}

export function agentInstallRoots(root) {
  const file = path.join(root, "install-agents.mjs");
  if (!fs.existsSync(file)) return [];
  const stat = fs.lstatSync(file);
  if (!stat.isFile()) return [];
  const block = fs.readFileSync(file, "utf8").match(/const projectAgents = \[([\s\S]*?)\];/);
  if (!block) return [];
  return [...new Set([...block[1].matchAll(/"([^"]+)"/g)].map((hit) => hit[1].split("/")[0]))];
}

export function collect(root, { strict }) {
  const resolved = path.resolve(root);
  const entries = [];
  walk(resolved, resolved, entries, strict, new Set(agentInstallRoots(resolved)));
  entries.sort((a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)));
  return entries;
}

function walk(dir, root, entries, strict, agentRoots) {
  for (const name of fs.readdirSync(dir)) {
    if (skipped(name)) continue;
    const full = path.join(dir, name);
    const rel = path.relative(root, full).split(path.sep).join("/");
    if (rel.split("/").includes("..")) throw new Error(`Refusing a path that contains '..': ${rel}`);
    if (!rel.includes("/") && agentRoots.has(rel)) continue;
    const stat = fs.lstatSync(full);
    if (stat.isSymbolicLink()) {
      const target = fs.readlinkSync(full);
      if (strict) assertSymlink(full, root, target, rel);
      entries.push({ path: rel, type: "symlink", target, sha256: digest(Buffer.from(target)) });
    } else if (stat.isDirectory()) {
      walk(full, root, entries, strict, agentRoots);
    } else if (stat.isFile()) {
      entries.push({ path: rel, type: "file", sha256: digest(fs.readFileSync(full)) });
    } else if (strict) {
      throw new Error(`Refusing special file ${rel}.`);
    }
  }
}

function assertSymlink(full, root, target, rel) {
  if (path.isAbsolute(target)) throw new Error(`Refusing absolute symlink ${rel} -> ${target}`);
  const resolved = path.resolve(path.dirname(full), target);
  const base = path.resolve(root);
  if (resolved !== base && !resolved.startsWith(base + path.sep)) {
    throw new Error(`Refusing symlink ${rel} because it escapes the checkout.`);
  }
}

function hashEntries(entries) {
  const body = `${entries.map((entry) => `${entry.type}\t${entry.path}\t${entry.sha256}`).join("\n")}\n`;
  return digest(Buffer.from(body));
}

function skipped(name) {
  return name === ".git" || name === "node_modules" || name === ".env" || name.startsWith(".env.");
}

function digest(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

const ranDirectly = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (ranDirectly) {
  const args = process.argv.slice(2);
  const source = args.find((arg) => !arg.startsWith("--"));
  const commitFlag = args.indexOf("--commit");
  const commit = commitFlag >= 0 ? args[commitFlag + 1] : null;
  if (!source) {
    process.stderr.write("Pass the path of a skill-boilerplate checkout.\n");
    process.exitCode = 1;
  } else if (commitFlag >= 0 && !/^[0-9a-f]{7,64}$/i.test(commit || "")) {
    process.stderr.write("Pass --commit as a hex sha.\n");
    process.exitCode = 1;
  } else {
    const lock = syncBoilerplate({
      source: path.resolve(source),
      dest: path.join(repoRoot, "skill-boilerplate"),
      lockFile: path.join(repoRoot, "BOILERPLATE.lock"),
      commit
    });
    process.stdout.write(`${JSON.stringify({ contentHash: lock.contentHash, sourceCommit: lock.sourceCommit, files: "rewritten" })}\n`);
  }
}
