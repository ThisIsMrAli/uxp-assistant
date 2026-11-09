import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Archive skill-boilerplate/ as its own repository root.
 * Does not push anywhere. Symlinks stay symlinks. .git, node_modules, and .env are omitted.
 */
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(repo, "skill-boilerplate");
const commit = spawnSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" });
if (commit.status !== 0) throw new Error("git rev-parse failed");
const revision = commit.stdout.trim();
const files = [];
walk(source, source, files);
files.sort((a, b) => a.name.localeCompare(b.name));

const outDir = "/opt/cursor/artifacts";
fs.mkdirSync(outDir, { recursive: true });
const short = revision.slice(0, 12);
const archive = path.join(outDir, `skill-boilerplate-${short}.zip`);
fs.rmSync(archive, { force: true });
const zipped = spawnSync("zip", ["-r", "-y", "-X", archive, "."], { cwd: source, encoding: "utf8" });
if (zipped.status !== 0) throw new Error(zipped.stderr || "zip failed");

const archiveBytes = fs.readFileSync(archive);
const archiveDigest = crypto.createHash("sha256").update(archiveBytes).digest("hex");
const manifest = {
  name: "skill-boilerplate",
  layout: "repository root",
  revision,
  note: "Only the standalone skill-boilerplate folder, with its package.json at the archive root. Not pushed to https://github.com/ThisIsMrAli/skill-boilerplate. The archive contains no .git, node_modules, or .env. Symlinks are stored as symlinks.",
  archiveDigest,
  archiveBytes: archiveBytes.length,
  files
};
fs.writeFileSync(path.join(outDir, `skill-boilerplate-${short}-manifest.json`), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify({ archive, revision, archiveDigest, files: files.length, bytes: archiveBytes.length }));

function walk(dir, base, acc) {
  for (const name of fs.readdirSync(dir)) {
    if (name === ".git" || name === "node_modules" || name === ".env" || name.startsWith(".env.")) continue;
    const full = path.join(dir, name);
    const rel = path.relative(base, full).split(path.sep).join("/");
    const stat = fs.lstatSync(full);
    if (stat.isSymbolicLink()) {
      const target = fs.readlinkSync(full);
      acc.push({ name: rel, type: "symlink", target, sha256: crypto.createHash("sha256").update(target).digest("hex"), bytes: Buffer.byteLength(target) });
    } else if (stat.isDirectory()) walk(full, base, acc);
    else if (stat.isFile()) {
      const data = fs.readFileSync(full);
      acc.push({ name: rel, type: "file", sha256: crypto.createHash("sha256").update(data).digest("hex"), bytes: data.length });
    }
  }
}
