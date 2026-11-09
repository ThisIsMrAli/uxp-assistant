#!/usr/bin/env node
/**
 * Writes .claude/skills/uxp-assistant/tooling/{package.json,package-lock.json,tree.json} from the
 * repo's package-lock.json and its npm ci install (NQ11).
 *
 *   node scripts/tooling-manifest.mjs --tarballs <dir>   write; <dir> holds the .tgz of every
 *                                                          platform-only package (from its resolved URL)
 *   node scripts/tooling-manifest.mjs --check             exit 1 when the shipped files are out of date
 *
 * A platform-only package (os/cpu set, such as each @typescript/typescript-<os>-<cpu> build) is
 * hashed from its published tarball after the tarball's sha512 matches the lock's integrity, so
 * every platform's tree is pinned, not only the one this machine installs.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import { digestFiles, packageDigest } from "../.claude/skills/uxp-assistant/scripts/lib/tooling.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const target = path.join(repo, ".claude/skills/uxp-assistant/tooling");
const args = process.argv.slice(2);
const lock = JSON.parse(fs.readFileSync(path.join(repo, "package-lock.json"), "utf8"));
const rootPkg = JSON.parse(fs.readFileSync(path.join(repo, "package.json"), "utf8"));

const pkg = { name: "uxp-assistant-tooling", private: true, dependencies: rootPkg.dependencies };
const toolLock = {
  name: pkg.name,
  lockfileVersion: lock.lockfileVersion,
  requires: true,
  packages: { "": { name: pkg.name, dependencies: rootPkg.dependencies }, ...Object.fromEntries(Object.entries(lock.packages).filter(([key]) => key)) }
};

export function tarFiles(buffer) {
  const data = zlib.gunzipSync(buffer);
  const files = [];
  let offset = 0;
  let longName = "";
  let paxPath = "";
  const text = (start, length) => data.subarray(start, start + length).toString("utf8").replace(/\0.*$/s, "");
  while (offset + 512 <= data.length) {
    const header = data.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const size = parseInt(text(offset + 124, 12).trim() || "0", 8);
    const type = String.fromCharCode(header[156] || 48);
    const prefix = text(offset + 345, 155);
    let name = text(offset, 100);
    if (prefix) name = `${prefix}/${name}`;
    const body = data.subarray(offset + 512, offset + 512 + size);
    offset += 512 + Math.ceil(size / 512) * 512;
    if (type === "L") { longName = body.toString("utf8").replace(/\0.*$/s, ""); continue; }
    if (type === "x") {
      const match = /\d+ path=([^\n]*)\n/.exec(body.toString("utf8"));
      paxPath = match ? match[1] : "";
      continue;
    }
    if (type === "g") continue;
    const full = paxPath || longName || name;
    paxPath = "";
    longName = "";
    if (type !== "0" && type !== "\0" && type !== "7") continue;
    const rel = full.split("/").slice(1).join("/");
    if (!rel) continue;
    files.push([rel, crypto.createHash("sha256").update(body).digest("hex")]);
  }
  return files;
}

function build(tarballs) {
  const packages = {};
  for (const [key, entry] of Object.entries(lock.packages)) {
    if (!key) continue;
    const item = { version: entry.version };
    if (entry.integrity) item.integrity = entry.integrity;
    if (entry.os) item.os = entry.os;
    if (entry.cpu) item.cpu = entry.cpu;
    if (entry.os || entry.cpu) {
      const file = path.join(tarballs, path.basename(new URL(entry.resolved).pathname));
      const buffer = fs.readFileSync(file);
      const [algo, expected] = entry.integrity.split(/-(.*)/s);
      const got = crypto.createHash(algo).update(buffer).digest("base64");
      if (got !== expected) throw new Error(`${file} does not match ${key} integrity`);
      item.digest = digestFiles(tarFiles(buffer));
      const local = path.join(repo, key);
      if (fs.existsSync(local)) {
        const installed = packageDigest(local);
        if (installed.digest !== item.digest) throw new Error(`${key}: the installed copy does not match its tarball`);
      }
    } else {
      const installed = packageDigest(path.join(repo, key));
      if (installed.error) throw new Error(`${key}: ${installed.error}. Run npm ci first.`);
      item.digest = installed.digest;
    }
    packages[key] = item;
  }
  const contentHash = crypto.createHash("sha256").update(JSON.stringify(packages)).digest("hex");
  return {
    format: 1,
    note: "sha256 of sorted lines `relative-path<TAB>sha256-of-file` for every file in a package folder, excluding its nested node_modules. Written by scripts/tooling-manifest.mjs.",
    contentHash,
    packages
  };
}

const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
if (args.includes("--check")) {
  const same = (name, value) => fs.existsSync(path.join(target, name)) && fs.readFileSync(path.join(target, name), "utf8") === json(value);
  const tree = JSON.parse(fs.readFileSync(path.join(target, "tree.json"), "utf8"));
  const problems = [];
  if (!same("package.json", pkg)) problems.push("tooling/package.json");
  if (!same("package-lock.json", toolLock)) problems.push("tooling/package-lock.json");
  for (const [key, entry] of Object.entries(lock.packages)) {
    if (key && (!tree.packages[key] || tree.packages[key].version !== entry.version || tree.packages[key].integrity !== entry.integrity)) problems.push(`tree.json ${key}`);
  }
  if (Object.keys(tree.packages).length !== Object.keys(lock.packages).length - 1) problems.push("tree.json package count");
  if (problems.length) {
    console.error(`Out of date: ${problems.join(", ")}. Run node scripts/tooling-manifest.mjs --tarballs <dir>.`);
    process.exit(1);
  }
  console.log("tooling manifest matches package-lock.json");
} else if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const at = args.indexOf("--tarballs");
  if (at < 0) throw new Error("--tarballs <dir> is required");
  fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(path.join(target, "package.json"), json(pkg));
  fs.writeFileSync(path.join(target, "package-lock.json"), json(toolLock));
  fs.writeFileSync(path.join(target, "tree.json"), json(build(args[at + 1])));
  console.log(`wrote ${target}`);
}
