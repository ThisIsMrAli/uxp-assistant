import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { holdTemps, releaseTemps } from "./temps.mjs";

export function readScripts(project) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(project, "package.json"), "utf8"));
    return pkg.scripts || {};
  } catch {
    return null;
  }
}

export function runPackage(project, { npm = "npm", runner = spawnSync, install = false, only = null } = {}) {
  const scripts = readScripts(project);
  if (!scripts) return { status: "unavailable", reason: "No package.json. Nothing was packaged.", runs: [], artifacts: [], hostExecuted: false };
  const names = only || ["build", "ccx"].filter((name) => scripts[name]);
  const missing = names.filter((name) => !scripts[name]);
  if (missing.length) {
    return { status: "unavailable", reason: `Missing script ${missing.join(", ")}. The step was not marked done.`, runs: [], artifacts: [], hostExecuted: false };
  }
  if (!names.length) return { status: "unavailable", reason: "No script was run.", runs: [], artifacts: [], hostExecuted: false };
  const commands = [];
  if (install) commands.push(["install", "--no-fund", "--no-audit"]);
  for (const name of names) commands.push(["run", name]);
  const runs = [];
  holdTemps();
  try {
  for (const args of commands) {
    const env = { ...process.env };
    for (const key of Object.keys(env)) {
      if (key === "NODE_CHANNEL_FD" || key === "NODE_TEST_CONTEXT" || key.startsWith("NODE_TEST_")) delete env[key];
    }
    const result = runner(npm, args, { cwd: project, encoding: "utf8", timeout: 15 * 60 * 1000, env });
    const output = `${result.stdout || ""}\n${result.stderr || ""}`;
    const excerpt = output.trim().slice(-1200);
    runs.push({ args, status: result.status, error: result.error ? String(result.error.message || result.error) : "", output: excerpt });
    if (result.status !== 0) {
      return { status: "failed", runs, artifacts: [], hostExecuted: false, output: excerpt, reason: `${args.join(" ")} exited ${result.status}.\n${excerpt}` };
    }
    if (args[0] === "run" && args[1] === "build" && fs.existsSync(path.join(project, "webview-ui", "package.json"))) {
      const wrote = fs.existsSync(path.join(project, "webview-ui", "dist")) || fs.existsSync(path.join(project, "dist"));
      if (/WEBVIEW MODULES NOT INSTALLED/i.test(output) || (!output.trim() && !wrote)) {
        return {
          status: "failed",
          runs,
          artifacts: [],
          hostExecuted: false,
          reason: /WEBVIEW MODULES NOT INSTALLED/i.test(output)
            ? "npm run build exited 0 and reported WEBVIEW MODULES NOT INSTALLED. Run npm install inside webview-ui, then build again."
            : "npm run build exited 0 and wrote no webview output."
        };
      }
    }
  }
  const artifacts = findArtifacts(project);
  if (names.includes("ccx") && !artifacts.length) {
    return { status: "failed", runs, artifacts, hostExecuted: false, reason: "The ccx script exited 0 and wrote no .ccx or .zip." };
  }
  return {
    status: names.includes("ccx") ? "written" : "script-ok-no-artifact",
    runs,
    artifacts,
    hostExecuted: false,
    note: "Exit 0 is the command result. It is not evidence that Photoshop or Premiere ran the feature."
  };
  } finally {
    releaseTemps();
  }
}

function findArtifacts(project) {
  const found = [];
  const walk = (dir, depth) => {
    if (depth > 3 || !fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, depth + 1);
      else if (entry.name.endsWith(".ccx") || entry.name.endsWith(".zip")) {
        const data = fs.readFileSync(full);
        found.push({
          file: path.relative(project, full),
          bytes: data.length,
          sha256: crypto.createHash("sha256").update(data).digest("hex")
        });
      }
    }
  };
  walk(project, 0);
  return found;
}
