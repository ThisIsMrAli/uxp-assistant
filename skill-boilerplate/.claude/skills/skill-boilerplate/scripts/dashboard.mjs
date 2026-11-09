#!/usr/bin/env node
/**
 * Start, stop, or inspect the review dashboard.
 *
 *   node scripts/dashboard.mjs start  [--out dir] [--no-open] [--port n]
 *   node scripts/dashboard.mjs stop   [--out dir]
 *   node scripts/dashboard.mjs status [--out dir]
 *
 * `start` prints one JSON line. When `ok` is false the agent keeps the review
 * in chat and says why in one sentence. It never leaves a half-started server.
 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loopbackJson } from "./lib/loopback.mjs";
import { assetsDir, resolveOut, sessionBin } from "./lib/paths.mjs";
import { createDashboardServer } from "./lib/server.mjs";
import { files, readServer } from "./lib/session.mjs";

const self = fileURLToPath(import.meta.url);
const [command, ...rest] = process.argv.slice(2);
const args = parseArgs(rest);

try {
  if (command === "serve") await serve();
  else if (command === "start") await start();
  else if (command === "stop") await stop();
  else if (command === "status") await status();
  else fail("Usage: dashboard.mjs start|stop|status [--out dir] [--no-open]");
} catch (error) {
  fail(error.message);
}

async function start() {
  const out = resolveOut(args.out);
  if (!fs.existsSync(files.session(out))) fail(`No session in ${out}. Run start.mjs first.`);

  const live = await running(out);
  if (live) return report(out, live, true);

  fs.rmSync(files.server(out), { force: true });
  const logFile = path.join(out, "server.log");
  const fd = fs.openSync(logFile, "a");
  const child = spawn(process.execPath, [self, "serve", "--out", out, "--port", String(args.port || 0)], {
    detached: true,
    stdio: ["ignore", fd, fd],
    windowsHide: true
  });
  child.unref();

  const info = await until(() => {
    const found = readServer(out);
    return found && found.pid === child.pid ? found : null;
  }, 6000);
  if (!info || !(await ping(info))) {
    try {
      process.kill(child.pid);
    } catch {
      // It already exited.
    }
    const why = tail(logFile) || "The server did not answer on 127.0.0.1.";
    const sessionCmd = sessionBin();
    process.stdout.write(`${JSON.stringify({ ok: false, fallback: "chat", reason: why, next: `Run \`${sessionCmd} mode --set chat\`, tell the user in one sentence that decisions will be made in chat, then run \`${sessionCmd} next\`. Do not end your turn.` }, null, 2)}\n`);
    process.exit(2);
  }
  report(out, info, false);
}

function report(out, info, reused) {
  const opened = args.noOpen || process.env.SKILL_NO_OPEN ? false : openBrowser(info.url);
  process.stdout.write(`${JSON.stringify({ ok: true, reused, url: info.url, port: info.port, pid: info.pid, opened, out, next: `The dashboard is up. Write nothing to the user. Run \`${sessionBin()} next\` and do what it says.` }, null, 2)}\n`);
}

async function stop() {
  const out = resolveOut(args.out);
  const info = readServer(out);
  if (!info) return print({ ok: true, running: false });
  try {
    process.kill(info.pid, "SIGTERM");
  } catch {
    // Already gone.
  }
  await until(() => !alive(info.pid), 2500);
  fs.rmSync(files.server(out), { force: true });
  print({ ok: true, running: false, stopped: info.pid });
}

async function status() {
  const out = resolveOut(args.out);
  const live = await running(out);
  print(live ? { ok: true, running: true, url: live.url, pid: live.pid } : { ok: true, running: false });
}

async function serve() {
  const out = resolveOut(args.out);
  const dashboard = createDashboardServer({ out, assets: assetsDir, onIdle: () => shutdown() });
  const info = await dashboard.listen(Number(args.port) || 0);
  fs.writeFileSync(files.server(out), `${JSON.stringify({ pid: process.pid, port: info.port, token: info.token, url: info.url, startedAt: new Date().toISOString() })}\n`, { mode: 0o600 });
  let closing = false;
  async function shutdown() {
    if (closing) return;
    closing = true;
    const current = readServer(out);
    if (current?.pid === process.pid) fs.rmSync(files.server(out), { force: true });
    await dashboard.close();
    process.exit(0);
  }
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

async function running(out) {
  const info = readServer(out);
  if (!info || !alive(info.pid)) return null;
  return (await ping(info)) ? info : null;
}

async function ping(info) {
  try {
    const res = await loopbackJson(`http://127.0.0.1:${info.port}/api/ping`, {
      headers: { authorization: `Bearer ${info.token}` },
      timeoutMs: 1500
    });
    return res.ok;
  } catch {
    return false;
  }
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

async function until(probe, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const value = probe();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  return probe() || null;
}

/** Chrome first, because that is what the user asked for. The default browser is the fallback. */
function openBrowser(url) {
  if (process.platform === "darwin") {
    if (spawnSync("open", ["-a", "Google Chrome", url], { stdio: "ignore" }).status === 0) return "chrome";
    return spawnSync("open", [url], { stdio: "ignore" }).status === 0 ? "default" : false;
  }
  if (process.platform === "win32") {
    if (spawnSync("cmd", ["/c", "start", "", "chrome", url], { stdio: "ignore", windowsHide: true }).status === 0) return "chrome";
    return spawnSync("cmd", ["/c", "start", "", url], { stdio: "ignore", windowsHide: true }).status === 0 ? "default" : false;
  }
  for (const bin of ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"]) {
    if (spawnSync("which", [bin], { stdio: "ignore" }).status === 0) {
      spawn(bin, [url], { detached: true, stdio: "ignore" }).unref();
      return "chrome";
    }
  }
  if (spawnSync("which", ["xdg-open"], { stdio: "ignore" }).status === 0) {
    spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
    return "default";
  }
  return false;
}

function tail(file) {
  try {
    return fs.readFileSync(file, "utf8").trim().split("\n").slice(-3).join(" ");
  } catch {
    return "";
  }
}

function print(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--out") parsed.out = argv[++i];
    else if (token === "--port") parsed.port = argv[++i];
    else if (token === "--no-open") parsed.noOpen = true;
  }
  return parsed;
}
