import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { skillRoot } from "./paths.mjs";

/**
 * NQ11 and NQ12: the whole pinned tool tree, not only create-bolt-uxp/dist/index.js.
 *
 * The skill ships tooling/package.json, tooling/package-lock.json (exact versions, resolved URLs
 * and sha512 integrity for every package) and tooling/tree.json (a sha256 digest of every file of
 * every package, including each platform build of the TypeScript native compiler). A tree is used
 * only when every package the lock installs on this platform is present with exactly those bytes,
 * no unknown package sits beside them, no package directory or file is a symlink, and every
 * .bin link resolves inside the tree. npm is run by absolute path (this node binary plus the
 * npm-cli.js shipped beside it), never by a PATH lookup. Installs take a lock beside the folder,
 * install into a staging folder with `npm ci`, verify it, and only then swap it into place, so
 * concurrent sessions cannot leave a half-written tree, and a broken tree is replaced.
 */
export const toolingSource = (skillDirectory = skillRoot) => path.join(path.resolve(skillDirectory), "tooling");

const verified = new Map();

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

export function treeManifest(skillDirectory = skillRoot) {
  return readJson(path.join(toolingSource(skillDirectory), "tree.json"));
}

/** Lines `relative-path<TAB>sha256`, sorted, for files that belong to this package (nested node_modules are other packages). */
export function digestFiles(files) {
  const lines = files.map(([rel, hash]) => `${rel}\t${hash}\n`).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return crypto.createHash("sha256").update(lines.join("")).digest("hex");
}

/** The digest of an installed package folder, or { error } when it holds a symlink or cannot be read. */
export function packageDigest(dir) {
  const files = [];
  const walk = (current, rel) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      const name = rel ? `${rel}/${entry.name}` : entry.name;
      if (!rel && entry.name === "node_modules") continue;
      const stat = fs.lstatSync(full);
      if (stat.isSymbolicLink()) throw new Error(`${full} is a symlink. The pinned tooling holds no symlinks inside a package.`);
      if (stat.isDirectory()) walk(full, name);
      else if (stat.isFile()) files.push([name, crypto.createHash("sha256").update(fs.readFileSync(full)).digest("hex")]);
      else throw new Error(`${full} is not a regular file.`);
    }
  };
  try {
    const stat = fs.lstatSync(dir);
    if (stat.isSymbolicLink()) return { error: `${dir} is a symlink. A pinned package must be a real folder inside the tooling.` };
    if (!stat.isDirectory()) return { error: `${dir} is not a folder.` };
    walk(dir, "");
  } catch (error) {
    return { error: error.code === "ENOENT" ? `${dir} is missing` : error.message };
  }
  return { digest: digestFiles(files) };
}

export function forThisPlatform(entry, platform = process.platform, arch = process.arch) {
  const match = (list, value) => !Array.isArray(list) || !list.length || list.some((item) => (item.startsWith("!") ? item.slice(1) !== value : item === value));
  return match(entry.os, platform) && match(entry.cpu, arch);
}

function insideRoot(root, target) {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

/** Every package directory under node_modules (scoped and nested), as lock keys like node_modules/a/node_modules/b. */
function installedPackages(modulesDir) {
  const found = [];
  const scan = (dir, key) => {
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name === ".bin" || entry.name === ".package-lock.json" || entry.name === ".cache") continue;
      const full = path.join(dir, entry.name);
      if (entry.name.startsWith("@") && entry.isDirectory()) {
        for (const scoped of fs.readdirSync(full, { withFileTypes: true })) {
          const sub = `${key}/${entry.name}/${scoped.name}`;
          found.push({ key: sub, dir: path.join(full, scoped.name) });
          scan(path.join(full, scoped.name, "node_modules"), `${sub}/node_modules`);
        }
        continue;
      }
      const sub = `${key}/${entry.name}`;
      found.push({ key: sub, dir: full });
      if (entry.isDirectory() && !entry.isSymbolicLink()) scan(path.join(full, "node_modules"), `${sub}/node_modules`);
    }
  };
  scan(modulesDir, "node_modules");
  return found;
}

function binLinks(modulesDir) {
  const problems = [];
  const check = (binDir) => {
    let entries = [];
    try {
      entries = fs.readdirSync(binDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(binDir, entry.name);
      if (!entry.isSymbolicLink()) continue;
      let target = "";
      try {
        target = fs.realpathSync(full);
      } catch {
        problems.push(`${full} is a broken link`);
        continue;
      }
      if (!insideRoot(modulesDir, target)) problems.push(`${full} points outside the pinned tooling (${target})`);
    }
  };
  check(path.join(modulesDir, ".bin"));
  for (const { dir } of installedPackages(modulesDir)) check(path.join(dir, "node_modules", ".bin"));
  return problems;
}

/** path, size, mtime, ctime and inode of every entry: a cheap signature, so a remembered pass is reused only for an unchanged tree. */
function statSignature(root) {
  const hash = crypto.createHash("sha256");
  const walk = (dir) => {
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      const stat = fs.lstatSync(full, { bigint: true });
      hash.update(`${full}\0${stat.size}\0${stat.mtimeNs}\0${stat.ctimeNs}\0${stat.ino}\0${stat.mode}\n`);
      if (entry.isDirectory() && !entry.isSymbolicLink()) walk(full);
    }
  };
  walk(root);
  return hash.digest("hex");
}

/**
 * Verify a node_modules tree against the shipped manifest. { ok, reason }.
 * A pass is remembered for this process with a stat signature of the tree, so any later change
 * (bytes, a replaced file, a new link) is hashed again.
 */
export function verifyTree(modulesDir, { skillDirectory = skillRoot, platform = process.platform, arch = process.arch, fresh = false } = {}) {
  const manifest = treeManifest(skillDirectory);
  if (!manifest?.packages) return { ok: false, reason: `${path.join(toolingSource(skillDirectory), "tree.json")} is missing. The skill install is incomplete.` };
  const resolved = path.resolve(modulesDir);
  const memo = `${resolved}\0${manifest.contentHash}\0${platform}\0${arch}`;
  const signature = fs.existsSync(resolved) ? statSignature(resolved) : "";
  if (!fresh && verified.get(memo)?.signature === signature) return { ok: true };
  let real = "";
  try {
    real = fs.realpathSync(resolved);
  } catch {
    return { ok: false, reason: `${resolved} is missing` };
  }
  if (real !== resolved) return { ok: false, reason: `${resolved} resolves to ${real} through a symlink. The pinned tooling must be a real folder, so its dependencies load from inside it.` };
  const wanted = new Map(Object.entries(manifest.packages).filter(([, entry]) => forThisPlatform(entry, platform, arch)));
  const present = installedPackages(resolved);
  for (const { key } of present) {
    if (!wanted.has(key)) return { ok: false, reason: `${key} is in ${resolved} but not in the pinned lock. The tree is not the pinned one.` };
  }
  const have = new Set(present.map((item) => item.key));
  for (const [key, entry] of wanted) {
    if (!have.has(key)) return { ok: false, reason: `${key}@${entry.version} is not installed in ${resolved}` };
  }
  for (const { key, dir } of present) {
    const entry = wanted.get(key);
    const pkg = readJson(path.join(dir, "package.json"));
    if (pkg?.version !== entry.version) return { ok: false, reason: `${key} is ${pkg?.version || "?"}, not the pinned ${entry.version}` };
    const got = packageDigest(dir);
    if (got.error) return { ok: false, reason: got.error };
    if (got.digest !== entry.digest) return { ok: false, reason: `${key}@${entry.version} files do not match the pinned sha256 (${got.digest.slice(0, 12)}… is not ${entry.digest.slice(0, 12)}…). A file was changed.` };
  }
  const links = binLinks(resolved);
  if (links.length) return { ok: false, reason: links[0] };
  verified.set(memo, { signature });
  return { ok: true };
}

export function forgetVerified() {
  verified.clear();
}

/**
 * npm by absolute path: [node, npm-cli.js] from the npm that ships with this node binary.
 * PATH is never searched, so a fake npm earlier on PATH is not run.
 */
export function npmCommand(execPath = process.execPath) {
  // <prefix>/bin/node with <prefix>/lib/node_modules/npm (Unix installers), node.exe with
  // node_modules/npm beside it (Windows), and <prefix>/lib/nodejs/node with <prefix>/lib/node_modules/npm.
  const bin = path.dirname(fs.realpathSync(execPath));
  const candidates = [
    path.join(bin, "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"),
    path.join(bin, "node_modules", "npm", "bin", "npm-cli.js"),
    path.join(bin, "..", "node_modules", "npm", "bin", "npm-cli.js")
  ];
  for (const cli of candidates) {
    if (fs.existsSync(cli)) return { command: execPath, args: [fs.realpathSync(cli)] };
  }
  throw new Error(`npm-cli.js was not found beside ${execPath} (looked in ${candidates.join(" and ")}). Install Node.js with its bundled npm. The skill does not run an npm found on PATH.`);
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * A lock folder beside the tooling. mkdir is atomic, so one process installs at a time. A lock whose
 * owner is gone, or that is older than staleMs, is taken over. Returns release().
 */
export function acquireLock(lockDir, { waitMs = 300000, staleMs = 600000, onWait = () => {} } = {}) {
  const started = Date.now();
  let told = false;
  for (;;) {
    try {
      fs.mkdirSync(lockDir);
      fs.writeFileSync(path.join(lockDir, "owner.json"), JSON.stringify({ pid: process.pid, at: Date.now() }));
      return () => fs.rmSync(lockDir, { recursive: true, force: true });
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
    const owner = readJson(path.join(lockDir, "owner.json"));
    let age = 0;
    try {
      age = Date.now() - fs.statSync(lockDir).mtimeMs;
    } catch {
      continue;
    }
    const stale = (owner?.pid && !alive(owner.pid)) || age > staleMs || (!owner && age > 5000);
    if (stale) {
      fs.rmSync(lockDir, { recursive: true, force: true });
      continue;
    }
    if (Date.now() - started > waitMs) {
      throw new Error(`Another session is installing the pinned tooling (lock ${lockDir}, pid ${owner?.pid || "?"}). Wait for it to finish and run again. If no other session is running, delete ${lockDir} and run again.`);
    }
    if (!told) {
      told = true;
      onWait(owner);
    }
    sleep(250);
  }
}

/**
 * Make prefix/node_modules the verified pinned tree. Returns { repaired } on success, throws with an
 * actionable message otherwise. A broken or tampered tree is replaced (self-repair), never patched.
 * options.npm is an absolute executable used by tests instead of node + npm-cli.js.
 */
export function installTree(prefix, { skillDirectory = skillRoot, npm, notify = () => {}, timeout = 180000 } = {}) {
  const modules = path.join(prefix, "node_modules");
  const lockDir = `${prefix}.lock`;
  fs.mkdirSync(path.dirname(prefix), { recursive: true });
  const release = acquireLock(lockDir, { onWait: (owner) => notify(`Waiting for another session (pid ${owner?.pid || "?"}) to finish installing the pinned tooling into ${prefix}.`) });
  try {
    const already = verifyTree(modules, { skillDirectory, fresh: true });
    if (already.ok) return { repaired: false, reused: true };
    const broken = fs.existsSync(prefix) ? already.reason : "";
    const staging = `${prefix}.staging-${process.pid}-${Date.now()}`;
    fs.rmSync(staging, { recursive: true, force: true });
    fs.mkdirSync(staging, { recursive: true });
    const source = toolingSource(skillDirectory);
    fs.copyFileSync(path.join(source, "package.json"), path.join(staging, "package.json"));
    fs.copyFileSync(path.join(source, "package-lock.json"), path.join(staging, "package-lock.json"));
    fs.writeFileSync(path.join(staging, ".gitignore"), "*\n");
    const runner = npm ? { command: npm, args: [] } : npmCommand();
    const args = [...runner.args, "ci", "--prefix", staging, "--no-audit", "--no-fund", "--ignore-scripts", "--loglevel=error"];
    const ran = spawnSync(runner.command, args, { cwd: staging, encoding: "utf8", timeout });
    const checked = ran.status === 0 ? verifyTree(path.join(staging, "node_modules"), { skillDirectory, fresh: true }) : { ok: false, reason: `npm ci exited ${ran.status ?? ran.error?.message}` };
    if (!checked.ok) {
      fs.rmSync(staging, { recursive: true, force: true });
      const tail = (ran.stderr || ran.stdout || "").slice(-400).trim();
      throw new Error(`${checked.reason}.${tail ? ` npm said: ${tail}` : ""}${broken ? ` The existing tree at ${prefix} was left in place (${broken}).` : ""} Check the network and run again.`);
    }
    const old = `${prefix}.old-${process.pid}-${Date.now()}`;
    if (fs.existsSync(prefix)) fs.renameSync(prefix, old);
    fs.renameSync(staging, prefix);
    fs.rmSync(old, { recursive: true, force: true });
    forgetVerified();
    return { repaired: Boolean(broken), reason: broken };
  } finally {
    release();
  }
}
