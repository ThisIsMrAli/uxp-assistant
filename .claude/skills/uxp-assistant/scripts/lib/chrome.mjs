import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { holdTemps, releaseTemps } from "./temps.mjs";

/** Chromium-family browsers, best first. Any of them takes the same flags. */
export function chromeCandidates(platform = process.platform, env = process.env) {
  if (platform === "darwin") {
    return [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser"
    ];
  }
  if (platform === "win32") {
    const roots = [env.PROGRAMFILES, env["PROGRAMFILES(X86)"], env.LOCALAPPDATA].filter(Boolean);
    const relative = [
      "Google\\Chrome\\Application\\chrome.exe",
      "Microsoft\\Edge\\Application\\msedge.exe",
      "Chromium\\Application\\chrome.exe"
    ];
    return roots.flatMap((root) => relative.map((name) => path.win32.join(root, name)));
  }
  const names = ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "microsoft-edge", "microsoft-edge-stable"];
  const dirs = String(env.PATH || "/usr/local/bin:/usr/bin:/bin:/snap/bin").split(path.delimiter).filter(Boolean);
  return dirs.flatMap((dir) => names.map((name) => path.join(dir, name)));
}

/** `CHROME_PATH` wins. Returns null when nothing is installed. */
export function findChrome({ platform = process.platform, env = process.env, exists = fs.existsSync } = {}) {
  if (env.CHROME_PATH && exists(env.CHROME_PATH)) return env.CHROME_PATH;
  return chromeCandidates(platform, env).find((candidate) => exists(candidate)) || null;
}

export const NO_CHROME =
  "No Chrome, Edge, or Chromium was found. Install one, or set CHROME_PATH to its executable.";

/**
 * Remove a Chrome profile. A written screenshot is a separate fact from this cleanup.
 * ENOTEMPTY is retried once. A profile that is still there is reported, not hidden.
 */
export function removeProfile(profile, rm = fs.rmSync) {
  try {
    rm(profile, { recursive: true, force: true });
    return { status: "removed", attempts: 1 };
  } catch (error) {
    if (error?.code !== "ENOTEMPTY") return { status: "left-in-place", attempts: 1, code: error?.code || "error", message: error.message };
    try {
      rm(profile, { recursive: true, force: true });
      return { status: "removed-after-retry", attempts: 2, code: "ENOTEMPTY" };
    } catch (again) {
      return { status: "left-in-place", attempts: 2, code: again?.code || "ENOTEMPTY", message: again.message };
    }
  }
}

/** Photographs `url` at an exact viewport. Throws only when the PNG is missing. */
export function shoot({ chrome, url, out, width, height, scale = 1, background = "FFFFFFFF" }) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "uxp-assistant-chrome-"));
  holdTemps();
  fs.rmSync(out, { force: true });
  const args = [
    "--headless=new",
    "--disable-gpu",
    "--hide-scrollbars",
    "--no-first-run",
    "--no-default-browser-check",
    `--user-data-dir=${profile}`,
    `--force-device-scale-factor=${scale}`,
    `--window-size=${width},${height}`,
    `--default-background-color=${background}`,
    `--screenshot=${out}`,
    url
  ];
  // Linux containers that are root need this. It is not added for any other user.
  if (process.platform === "linux" && typeof process.getuid === "function" && process.getuid() === 0) args.unshift("--no-sandbox");
  let spawned = { status: null, error: null };
  try {
    const result = spawnSync(chrome, args, { encoding: "utf8", timeout: 60_000, stdio: ["ignore", "ignore", "ignore"] });
    spawned = { status: result.status, error: result.error ? String(result.error.message || result.error) : null };
  } catch (error) {
    spawned = { status: null, error: error.message };
  }
  const cleanup = removeProfile(profile);
  releaseTemps();
  const artifact = fs.existsSync(out) ? "written" : "missing";
  const report = { artifact, spawnStatus: spawned.status, spawnError: spawned.error, cleanup, out };
  if (artifact !== "written") {
    const error = new Error(`Chrome did not write ${out}. spawnStatus=${spawned.status}. cleanup=${cleanup.status}.`);
    error.report = report;
    throw error;
  }
  return report;
}
