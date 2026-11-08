import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { appendAnswerLine, files, matchOption, now, readMerged, readReport, readSession } from "./session.mjs";

const MAX_BODY = 64 * 1024;
const IMAGE_TYPES = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" };
const ASSET_TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8" };
const CSP = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";

/**
 * The assistant dashboard. One session folder, one token, loopback only.
 *
 * What it will not do: answer for the user. An answer is only recorded from a
 * POST that carries the token, a same-origin Origin header, and a JSON body.
 * A test license typed in the page stays in this process for the length of the
 * session. The audit script fetches it from here, so it never has to travel
 * through the agent's output, and a lost `wait` answer can be recovered.
 * It is never written to disk.
 */
export function createDashboardServer({ out, assets, token = crypto.randomBytes(18).toString("base64url"), idleMs = 45 * 60 * 1000, onIdle = () => {} }) {
  const secrets = new Map();
  const waiters = new Set();
  const streams = new Set();
  let signature = "";
  let lastActivity = Date.now();
  let lastPollAt = 0;
  let port = 0;

  const server = http.createServer((req, res) => {
    handle(req, res).catch((error) => send(res, 500, { error: error.message }));
  });

  async function handle(req, res) {
    const url = new URL(req.url, "http://localhost");
    if (!hostAllowed(req.headers.host)) return send(res, 421, { error: "Wrong host. Use the link the agent printed." });
    if (!originAllowed(req)) return send(res, 403, { error: "Cross-site request refused." });
    if (!tokenOk(req, url)) return deny(res, req, url);

    if (req.method === "GET" && url.pathname === "/") return page(res);
    if (req.method === "GET" && (url.pathname === "/app.css" || url.pathname === "/app.js" || url.pathname === "/theme.js")) return asset(res, url.pathname.slice(1));
    if (req.method === "GET" && url.pathname === "/api/ping") return send(res, 200, { ok: true, pid: process.pid });
    if (req.method === "GET" && url.pathname === "/api/state") return send(res, 200, snapshot());
    if (req.method === "GET" && url.pathname === "/api/events") return events(req, res);
    if (req.method === "GET" && url.pathname === "/api/wait") return wait(req, res, url);
    if (req.method === "GET" && url.pathname === "/api/secret") return secret(req, res, url);
    if (req.method === "GET" && url.pathname.startsWith("/files/")) return file(res, decodePath(url.pathname.slice(7)));
    if (req.method === "POST" && url.pathname === "/api/answer") {
      noteActivity();
      return answer(req, res);
    }
    return send(res, 404, { error: "Not found." });
  }

  function hostAllowed(host) {
    if (!host || !port) return false;
    return host === `127.0.0.1:${port}` || host === `localhost:${port}`;
  }

  function originAllowed(req) {
    const origin = req.headers.origin;
    if (!origin) return req.method !== "POST";
    return origin === `http://127.0.0.1:${port}` || origin === `http://localhost:${port}`;
  }

  function tokenOk(req, url) {
    const header = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    const given = header || url.searchParams.get("t") || "";
    const a = Buffer.from(given);
    const b = Buffer.from(token);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  function deny(res, req, url) {
    if (req.method === "GET" && url.pathname === "/") {
      res.writeHead(401, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      res.end("<!doctype html><meta charset=utf-8><title>UXP Assistant</title><body style=\"font:16px system-ui;margin:3rem\"><h1>Open the link from the agent</h1><p>This page needs the private link the agent printed when it started the dashboard.</p>");
      return;
    }
    send(res, 401, { error: "Missing or wrong token." });
  }

  function page(res) {
    const html = fs.readFileSync(path.join(assets, "index.html"), "utf8").replaceAll("%%TOKEN%%", token);
    res.writeHead(200, headers("text/html; charset=utf-8"));
    res.end(html);
  }

  function asset(res, name) {
    const full = path.join(assets, name);
    res.writeHead(200, headers(ASSET_TYPES[path.extname(name)]));
    res.end(fs.readFileSync(full));
  }

  function snapshot() {
    const merged = readMerged(out) || null;
    const report = readReport(out) || {};
    return {
      serverTime: now(),
      rev: merged?.rev ?? 0,
      // Is anyone listening for the user's answer? An open long poll is the proof.
      agent: { waiting: waiters.size, lastPollAt: lastPollAt ? new Date(lastPollAt).toISOString() : "", seenAt: merged?.agentSeenAt || "" },
      session: merged,
      report: {
        addon: report.addon || "",
        docsSha: report.docsSha || "",
        fetchedAt: report.fetchedAt || "",
        state: report.state || "",
        success: report.success === true,
        hostExecuted: false,
        goal: report.goal || "",
        skipped: (report.skipped || []).length,
        views: (report.views || []).map((view) => ({ kind: view.kind, name: view.name, file: view.file, line: view.line })),
        findings: (report.findings || []).map((finding) => ({
          id: finding.id,
          severity: finding.source?.kind === "review-pattern" ? "pattern" : finding.severity,
          file: finding.file,
          line: finding.line,
          message: finding.message,
          suggestion: finding.suggestion,
          url: finding.source?.url || "",
          origin: finding.source?.kind || ""
        }))
      }
    };
  }

  function events(req, res) {
    res.writeHead(200, { ...headers("text/event-stream"), connection: "keep-alive" });
    res.write("retry: 2000\n\n");
    res.write(`event: state\ndata: ${JSON.stringify({ rev: readSession(out)?.rev ?? 0 })}\n\n`);
    streams.add(res);
    req.on("close", () => streams.delete(res));
  }

  function broadcast() {
    const rev = readSession(out)?.rev ?? 0;
    for (const stream of streams) stream.write(`event: state\ndata: ${JSON.stringify({ rev })}\n\n`);
  }

  async function answer(req, res) {
    if (!/^application\/json/i.test(req.headers["content-type"] || "")) return send(res, 415, { error: "Send JSON." });
    let body;
    try {
      body = JSON.parse(await readBody(req));
    } catch {
      return send(res, 400, { error: "That body is not JSON." });
    }
    const session = readMerged(out);
    const ask = session?.asks.find((item) => item.id === body.id && item.status === "pending");
    if (!ask) return send(res, 409, { error: "That question is not waiting for an answer." });
    const option = matchOption(ask, body.value);
    if (!option) return send(res, 400, { error: "That is not one of the choices." });
    let secret = "";
    if (option.requiresSecret) {
      secret = String(body.secret || "");
      if (!secret.trim()) return send(res, 400, { error: "A secret is required for this choice." });
      if (secret.length > 2000) return send(res, 400, { error: "That is too long." });
      secrets.set(ask.nonce, secret);
    }
    appendAnswerLine(out, { type: "answer", askId: ask.id, nonce: ask.nonce, value: option.id, via: "dashboard", secret: Boolean(secret), at: now() });
    wake();
    return send(res, 200, { ok: true });
  }

  /** Long poll. The agent's `wait` command calls this and gets an answer or a quiet "still pending". */
  function wait(req, res, url) {
    noteActivity();
    lastPollAt = Date.now();
    const id = url.searchParams.get("id");
    const seconds = Math.min(Math.max(Number(url.searchParams.get("timeout")) || 25, 1), 110);
    const started = Date.now();
    const check = () => {
      const session = readMerged(out);
      const ask = session?.asks.find((item) => item.id === id);
      if (!ask) return { status: "missing", id };
      if (ask.status === "answered") {
        if (!ask.deliveredAt) appendAnswerLine(out, { type: "delivered", askId: ask.id, nonce: ask.nonce, at: now() });
        return {
          status: "answered", id, value: ask.answer, label: ask.answerLabel, via: ask.via,
          ...(ask.hasSecret ? { secretHeld: secrets.has(ask.nonce), secretNote: "A secret is held only in this process. It is not written to the session and this response does not include it." } : {})
        };
      }
      return null;
    };
    const first = check();
    if (first) return send(res, 200, first);
    const waiter = {
      poke() {
        const result = check();
        if (result) done(result);
      }
    };
    const timer = setTimeout(() => done({ status: "pending", id, waitedSeconds: Math.round((Date.now() - started) / 1000) }), seconds * 1000);
    function done(result) {
      clearTimeout(timer);
      waiters.delete(waiter);
      if (!res.writableEnded) send(res, 200, result);
    }
    waiters.add(waiter);
    req.on("close", () => {
      clearTimeout(timer);
      waiters.delete(waiter);
    });
  }

  /** The secret stays in this process. A bearer client with no Origin does not receive it. */
  function secret(req, res) {
    return send(res, 403, { error: "The secret stays in this process and is not returned." });
  }

  function wake() {
    for (const waiter of [...waiters]) waiter.poke();
    broadcast();
  }

  function file(res, relative) {
    if (relative === null) return send(res, 400, { error: "Bad path." });
    const allowed = relative === "report.md" || /^shots\/[a-zA-Z0-9._-]+\.(png|jpe?g|webp)$/i.test(relative);
    if (!allowed) return send(res, 404, { error: "Not found." });
    const full = path.resolve(out, relative);
    if (!full.startsWith(path.resolve(out) + path.sep)) return send(res, 404, { error: "Not found." });
    let data;
    try {
      data = fs.readFileSync(full);
    } catch {
      return send(res, 404, { error: "Not found." });
    }
    const type = relative === "report.md" ? "text/plain; charset=utf-8" : IMAGE_TYPES[path.extname(relative).toLowerCase()];
    res.writeHead(200, headers(type));
    res.end(data);
  }

  function noteActivity() {
    lastActivity = Date.now();
  }

  function sign() {
    return [files.session(out), files.answers(out), files.report(out)]
      .map((file) => {
        try {
          const stat = fs.statSync(file);
          return `${stat.mtimeMs}:${stat.size}`;
        } catch {
          return "-";
        }
      })
      .join("|");
  }

  let ticks = 0;
  const poll = setInterval(() => {
    const next = sign();
    if (next !== signature) {
      signature = next;
      noteActivity();
      wake();
    }
    ticks += 1;
    if (ticks % 35 === 0) for (const stream of streams) stream.write(": keep-alive\n\n");
    if (Date.now() - lastActivity > idleMs) onIdle();
  }, 400);
  poll.unref();

  return {
    server,
    token,
    listen(wantedPort = 0) {
      return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(wantedPort, "127.0.0.1", () => {
          port = server.address().port;
          signature = sign();
          resolve({ port, token, url: `http://127.0.0.1:${port}/?t=${token}` });
        });
      });
    },
    close() {
      clearInterval(poll);
      for (const stream of streams) stream.end();
      return new Promise((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections?.();
      });
    }
  };
}

function headers(type) {
  return {
    "content-type": type,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "content-security-policy": CSP
  };
}

function send(res, status, body) {
  if (res.headersSent) return;
  res.writeHead(status, headers("application/json; charset=utf-8"));
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error("Body too large."));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function decodePath(value) {
  try {
    const decoded = decodeURIComponent(value);
    if (decoded.includes("\0") || decoded.includes("\\") || decoded.split("/").includes("..")) return null;
    return decoded;
  } catch {
    return null;
  }
}

