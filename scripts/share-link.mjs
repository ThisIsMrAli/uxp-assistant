#!/usr/bin/env node
/**
 * Mints the unlisted preview address and stores it as GitHub Actions secrets.
 * The address is not committed. GitHub Pages cannot verify a signature, so the
 * address is an unguessable path that the deploy stops publishing after --days.
 *
 *   node scripts/share-link.mjs
 *   node scripts/share-link.mjs --days 30
 *   node scripts/share-link.mjs --rotate
 *   node scripts/share-link.mjs --publish
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const file = path.join(root, ".share", "link.json");
const argv = process.argv.slice(2);
const rotate = argv.includes("--rotate");
const publish = argv.includes("--publish");
const daysAt = argv.indexOf("--days");
const days = daysAt >= 0 ? Number(argv[daysAt + 1]) : null;

if (days !== null && (!Number.isInteger(days) || days < 1 || days > 365)) {
  process.stderr.write("--days needs a whole number from 1 to 365.\n");
  process.exit(1);
}

fs.mkdirSync(path.dirname(file), { recursive: true });
let link = {};
try {
  link = JSON.parse(fs.readFileSync(file, "utf8"));
} catch {
  link = {};
}
if (rotate || !/^[A-Za-z0-9_-]{32,128}$/.test(link.token || "")) {
  link.token = crypto.randomBytes(32).toString("base64url");
}
if (days !== null) link.expiresAt = new Date(Date.now() + days * 86_400_000).toISOString();
else if (rotate) link.expiresAt = null;
fs.writeFileSync(file, `${JSON.stringify(link, null, 2)}\n`, { mode: 0o600 });

const origin = gitOrigin();
if (!origin) {
  process.stdout.write("Saved the link on this computer. There is no origin remote yet, so nothing was published.\n");
  process.exit(0);
}
const visibility = gh(["repo", "view", `${origin.owner}/${origin.repo}`, "--json", "visibility", "--jq", ".visibility"]);
if (visibility.status !== 0) {
  process.stderr.write(`${visibility.stderr || visibility.stdout}`.trim() + "\n");
  process.exit(1);
}
if (visibility.stdout.trim() !== "PRIVATE") {
  process.stderr.write("Refusing to publish the link. The repository is not private.\n");
  process.exit(1);
}

const tokenSet = gh(["secret", "set", "PAGES_SHARE_TOKEN", "--repo", `${origin.owner}/${origin.repo}`], link.token);
if (tokenSet.status !== 0) fail(tokenSet);
if (link.expiresAt) {
  const expirySet = gh(["secret", "set", "PAGES_SHARE_EXPIRES", "--repo", `${origin.owner}/${origin.repo}`], String(Math.floor(Date.parse(link.expiresAt) / 1000)));
  if (expirySet.status !== 0) fail(expirySet);
} else {
  gh(["secret", "delete", "PAGES_SHARE_EXPIRES", "--repo", `${origin.owner}/${origin.repo}`]);
}

const url = `https://${origin.owner.toLowerCase()}.github.io/${origin.repo}/${link.token}/`;
process.stdout.write(`${url}\n`);
if (link.expiresAt) process.stdout.write(`Expires ${link.expiresAt}. The path is removed on the next deploy after that.\n`);
else process.stdout.write("No expiry. Run with --rotate to invalidate this address.\n");

if (publish) {
  const run = gh(["workflow", "run", "Pages", "--repo", `${origin.owner}/${origin.repo}`, "--ref", "main"]);
  if (run.status !== 0) fail(run);
  process.stdout.write("Deploy requested. The address starts working when that run finishes.\n");
}

function gitOrigin() {
  const result = spawnSync("git", ["remote", "get-url", "origin"], { cwd: root, encoding: "utf8" });
  if (result.status !== 0) return null;
  const match = result.stdout.trim().match(/github\.com[:/]([^/]+)\/([^/.]+)/);
  return match ? { owner: match[1], repo: match[2] } : null;
}

function gh(args, input) {
  return spawnSync("gh", args, { cwd: root, encoding: "utf8", input });
}

function fail(result) {
  process.stderr.write(`${result.stderr || result.stdout}`.trim() + "\n");
  process.exit(result.status || 1);
}
