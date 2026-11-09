import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { findChrome, NO_CHROME } from "./chrome.mjs";
import { holdTemps, releaseTemps } from "./temps.mjs";
import { connect } from "./ws.mjs";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Starts a private headless Chrome and returns a page you can drive.
 * Nothing here touches the user's own browser or profile.
 *
 *   const page = await launch({ width: 320, height: 800 });
 *   await page.goto(url);
 *   const value = await page.eval("document.title");
 *   await page.close();
 */
export async function launch({ width = 320, height = 800, scale = 2, chrome = findChrome() } = {}) {
  if (!chrome) throw new Error(NO_CHROME);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "uxp-assistant-cdp-"));
  holdTemps();
  const args = [
    "--headless=new",
    // Software rendering, so a panel with a WebGL view (3D, charts) draws instead of failing.
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
    "--ignore-gpu-blocklist",
    "--hide-scrollbars",
    "--no-first-run",
    "--no-default-browser-check",
    "--remote-debugging-port=0",
    `--user-data-dir=${profile}`,
    `--window-size=${width},${height + 120}`,
    "about:blank"
  ];
  if (process.platform === "linux" && typeof process.getuid === "function" && process.getuid() === 0) args.unshift("--no-sandbox");
  const child = spawn(chrome, args, { stdio: "ignore", detached: process.platform !== "win32" });
  child.unref();

  const killChrome = () => {
    try {
      if (process.platform === "win32") spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
      else process.kill(-child.pid, "SIGKILL");
    } catch {
      try { child.kill("SIGKILL"); } catch { /* already gone */ }
    }
  };
  // However this process ends (an error, Ctrl-C, a timeout that stops the agent), its Chrome goes with it.
  process.once("exit", killChrome);
  const cleanup = () => {
    process.removeListener("exit", killChrome);
    killChrome();
    setTimeout(() => {
      fs.rmSync(profile, { recursive: true, force: true });
      releaseTemps();
    }, 400).unref();
  };

  try {
    const port = await debuggingPort(profile, child);
    const target = await pageTarget(port);
    const socket = await connect(target.webSocketDebuggerUrl);
    return await makePage(socket, { width, height, scale }, cleanup);
  } catch (error) {
    cleanup();
    throw error;
  }
}

async function debuggingPort(profile, child) {
  const file = path.join(profile, "DevToolsActivePort");
  const started = Date.now();
  while (Date.now() - started < 20_000) {
    if (child.exitCode !== null) throw new Error("Chrome closed before it was ready.");
    try {
      const port = Number(fs.readFileSync(file, "utf8").split("\n")[0]);
      if (port) return port;
    } catch {
      // Not written yet.
    }
    await sleep(100);
  }
  throw new Error("Chrome did not open its debugging port in 20 seconds.");
}

function getJson(port, route) {
  return new Promise((resolve, reject) => {
    http.get({ host: "127.0.0.1", port, path: route }, (res) => {
      let body = "";
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => {
        try { resolve(JSON.parse(body)); } catch (error) { reject(error); }
      });
    }).on("error", reject);
  });
}

async function pageTarget(port) {
  for (let i = 0; i < 50; i += 1) {
    const list = await getJson(port, "/json/list").catch(() => []);
    const page = list.find((item) => item.type === "page" && item.webSocketDebuggerUrl);
    if (page) return page;
    await sleep(100);
  }
  throw new Error("Chrome has no page to drive.");
}

async function makePage(socket, size, cleanup) {
  let nextId = 0;
  const pending = new Map();
  const listeners = new Map();
  const seen = { console: [], failed: [], exceptions: [] };

  socket.onMessage((text) => {
    const message = JSON.parse(text);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(`${message.error.message}`));
      else resolve(message.result || {});
      return;
    }
    for (const fn of listeners.get(message.method) || []) fn(message.params || {});
  });
  socket.onClose(() => {
    for (const { reject } of pending.values()) reject(new Error("Chrome closed the connection."));
    pending.clear();
  });

  const send = (method, params = {}) => new Promise((resolve, reject) => {
    nextId += 1;
    pending.set(nextId, { resolve, reject });
    socket.send(JSON.stringify({ id: nextId, method, params }));
  });
  const on = (method, fn) => listeners.set(method, [...(listeners.get(method) || []), fn]);
  const once = (method, timeout) => new Promise((resolve) => {
    const timer = setTimeout(() => { off(); resolve(false); }, timeout);
    const fn = () => { clearTimeout(timer); off(); resolve(true); };
    const off = () => listeners.set(method, (listeners.get(method) || []).filter((item) => item !== fn));
    on(method, fn);
  });

  on("Runtime.exceptionThrown", (event) => {
    const detail = event.exceptionDetails || {};
    seen.exceptions.push(String(detail.exception?.description || detail.text || "Script error").split("\n")[0].slice(0, 200));
  });
  on("Runtime.consoleAPICalled", (event) => {
    if (event.type === "error") seen.console.push((event.args || []).map((arg) => arg.value ?? arg.description ?? "").join(" ").slice(0, 200));
  });
  const requests = new Map();
  on("Network.requestWillBeSent", (event) => {
    requests.set(event.requestId, event.request?.url || "");
  });
  on("Network.loadingFailed", (event) => {
    if (event.canceled) return;
    seen.failed.push({ url: requests.get(event.requestId) || event.requestId, error: event.errorText || "failed" });
  });
  on("Page.javascriptDialogOpening", () => {
    send("Page.handleJavaScriptDialog", { accept: false }).catch(() => {});
  });

  await send("Page.enable");
  await send("Runtime.enable");
  await send("Network.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: size.width, height: size.height, deviceScaleFactor: size.scale, mobile: false });
  await send("Browser.setDownloadBehavior", { behavior: "deny" }).catch(() => {});
  // The panel must never open another tab or leave itself while it is reviewed.
  await send("Page.addScriptToEvaluateOnNewDocument", { source: "window.open = () => null;" });

  const page = {
    send,
    seen,

    async media(theme) {
      await send("Emulation.setEmulatedMedia", {
        features: [
          { name: "prefers-color-scheme", value: theme },
          { name: "prefers-reduced-motion", value: "reduce" }
        ]
      });
    },

    /** A reviewer opens the add-on for the first time, so every visit starts without saved state. */
    async forget(origin) {
      await send("Storage.clearDataForOrigin", { origin, storageTypes: "local_storage,session_storage,indexeddb,cookies,cache_storage,service_workers" }).catch(() => {});
    },

    async goto(url, { timeout = 20_000 } = {}) {
      const loaded = once("Page.loadEventFired", timeout);
      await send("Page.navigate", { url });
      await loaded;
    },

    async eval(expression) {
      const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
      if (result.exceptionDetails) {
        throw new Error(result.exceptionDetails.exception?.description?.split("\n")[0] || result.exceptionDetails.text || "Script error");
      }
      return result.result?.value;
    },

    async click(x, y) {
      await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
      await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
      await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
    },

    async type(text) {
      await send("Input.insertText", { text });
    },

    async key(key, code, keyCode) {
      for (const type of ["keyDown", "keyUp"]) {
        await send("Input.dispatchKeyEvent", { type, key, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode });
      }
    },

    async screenshot(file, clip) {
      const { data } = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false, ...(clip ? { clip } : {}) });
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, Buffer.from(data, "base64"));
      return file;
    },

    async close() {
      socket.close();
      cleanup();
    }
  };
  return page;
}
