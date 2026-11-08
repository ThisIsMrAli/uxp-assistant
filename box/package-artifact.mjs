import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeStoredZip } from "../.claude/skills/uxp-assistant/scripts/lib/archive.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const listed = spawnSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" });
if (listed.status !== 0) throw new Error("git ls-files failed");
const commit = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" });
if (commit.status !== 0) throw new Error("git rev-parse failed");
const revision = commit.stdout.trim();
const files = [];
for (const rel of listed.stdout.split("\0")) {
  if (!rel || rel.startsWith(".git/") || rel.includes("node_modules/") || rel.split("/").includes("..")) continue;
  if (rel.endsWith(".env") || path.basename(rel).startsWith(".env")) continue;
  const full = path.resolve(root, rel);
  if (!full.startsWith(`${root}${path.sep}`)) continue;
  if (!fs.existsSync(full) || !fs.statSync(full).isFile()) continue;
  const data = fs.readFileSync(full);
  files.push({
    name: rel.split(path.sep).join("/"),
    sha256: crypto.createHash("sha256").update(data).digest("hex"),
    bytes: data.length,
    data
  });
}
const manifest = {
  revision,
  archiveDigest: "filled-after-zip",
  note: "The archive digest can change when zip timestamps change. The per-file sha256 values are the source bytes. This tree does not include .git, node_modules, or secrets.",
  files: files.map(({ name, sha256, bytes }) => ({ name, sha256, bytes }))
};
const stamp = Buffer.from(`${JSON.stringify({ ...manifest, archiveDigest: "" }, null, 2)}\n`);
const entries = [
  ...files.map(({ name, data }) => ({ name, data })),
  { name: "SOURCE-MANIFEST.json", data: stamp }
];
const outDir = "/opt/cursor/artifacts";
fs.mkdirSync(outDir, { recursive: true });
const short = revision.slice(0, 12);
const archive = path.join(outDir, `uxp-assistant-${short}.zip`);
writeStoredZip(archive, entries);
const archiveBytes = fs.readFileSync(archive);
const archiveDigest = crypto.createHash("sha256").update(archiveBytes).digest("hex");
manifest.archiveDigest = archiveDigest;
manifest.archiveBytes = archiveBytes.length;
fs.writeFileSync(path.join(outDir, `uxp-assistant-${short}-manifest.json`), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify({ archive, revision, archiveDigest, files: files.length, bytes: archiveBytes.length }));
