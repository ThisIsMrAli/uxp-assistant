import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { dashboard, refresh, session, start } from "../api.mjs";
import { refreshSources } from "../.claude/skills/skill-boilerplate/scripts/lib/refresh.mjs";

const boilerplateRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const extensionPath = path.join(boilerplateRoot, "examples/blank/extension.mjs");
const bins = {
  sessionBin: "node scripts/session.mjs",
  dashboardBin: "node scripts/dashboard.mjs",
  refreshBin: "node scripts/refresh.mjs"
};

const created = [];
function temp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "skill-bp-"));
  created.push(dir);
  return dir;
}
process.on("exit", () => {
  for (const dir of created) fs.rmSync(dir, { recursive: true, force: true });
});

test("start asks mode before any network call", async () => {
  const out = temp();
  const original = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("network");
  };
  try {
    const result = await start({ extensionPath, out, ...bins });
    assert.equal(result.network, false);
    assert.equal(result.questions[0], "mode");
    assert.equal(fs.existsSync(path.join(out, "session.json")), true);
    assert.equal(fs.existsSync(path.join(out, "docs")), false);
  } finally {
    globalThis.fetch = original;
  }
});

test("dashboard start returns a url in under three seconds and does not fetch", async () => {
  const out = temp();
  await start({ extensionPath, out, ...bins });
  await session(["mode", "--set", "dashboard", "--out", out], { extensionPath, out, ...bins });
  const original = globalThis.fetch;
  let fetched = 0;
  globalThis.fetch = async () => {
    fetched += 1;
    throw new Error("network");
  };
  const began = Date.now();
  const started = dashboard(["start", "--no-open"], { extensionPath, out, ...bins, homeDirName: ".skill-boilerplate" });
  const ms = Date.now() - began;
  try {
    assert.equal(started.status, 0, started.stdout + started.stderr);
    assert.equal(started.json.ok, true);
    assert.match(started.json.url, /^http:\/\/127\.0\.0\.1:\d+\/\?t=/);
    assert.ok(ms < 3000, `dashboard start took ${ms}ms`);
    assert.equal(fetched, 0);
    const nxt = await session(["next", "--out", out], { extensionPath, out, ...bins });
    assert.equal(JSON.stringify(nxt).includes("AskQuestion"), false);
  } finally {
    globalThis.fetch = original;
    dashboard(["stop"], { extensionPath, out, ...bins });
  }
});

test("chat mode names AskQuestion and dashboard mode uses it only as the server-down fallback", async () => {
  const out = temp();
  await start({ extensionPath, out, ...bins });
  await session(["mode", "--set", "chat", "--out", out], { extensionPath, out, ...bins });
  const chat = await session(["ask", "--id", "sample", "--out", out], { extensionPath, out, ...bins });
  assert.match(chat.next, /AskQuestion/);
  await session(["mode", "--set", "dashboard", "--out", out], { extensionPath, out, ...bins });
  const down = await session(["ask", "--id", "goal", "--out", out], { extensionPath, out, ...bins });
  assert.equal(down.fallback, "server-down");
  assert.match(down.next, /AskQuestion/);
});

test("a choice and a text answer move through ask and wait", async () => {
  const out = temp();
  await start({ extensionPath, out, ...bins });
  await session(["mode", "--set", "chat", "--out", out], { extensionPath, out, ...bins });
  await session(["ask", "--id", "goal", "--out", out], { extensionPath, out, ...bins });
  await session(["answer", "--id", "goal", "--value", "Show the title", "--out", out], { extensionPath, out, ...bins });
  const goal = await session(["wait", "--id", "goal", "--timeout", "1", "--out", out], { extensionPath, out, ...bins });
  assert.equal(goal.status, "answered");
  assert.equal(goal.value, "Show the title");
  await session(["ask", "--id", "sample", "--out", out], { extensionPath, out, ...bins });
  await session(["answer", "--id", "sample", "--value", "yes", "--out", out], { extensionPath, out, ...bins });
  const sample = await session(["wait", "--id", "sample", "--timeout", "1", "--out", out], { extensionPath, out, ...bins });
  assert.equal(sample.value, "yes");
  const nxt = await session(["next", "--out", out], { extensionPath, out, ...bins });
  assert.equal(nxt.action, "refresh");
});

test("dashboard click answers a published question", async () => {
  const out = temp();
  await start({ extensionPath, out, ...bins });
  await session(["mode", "--set", "dashboard", "--out", out], { extensionPath, out, ...bins });
  const started = dashboard(["start", "--no-open"], { extensionPath, out, ...bins });
  try {
    assert.equal(started.json.ok, true);
    await session(["ask", "--id", "sample", "--out", out], { extensionPath, out, ...bins });
    const info = JSON.parse(fs.readFileSync(path.join(out, "server.json"), "utf8"));
    const posted = await fetch(`http://127.0.0.1:${info.port}/api/answer`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${info.token}`,
        origin: `http://127.0.0.1:${info.port}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({ id: "sample", value: "yes" })
    });
    assert.equal(posted.status, 200);
    const waited = await session(["wait", "--id", "sample", "--timeout", "2", "--out", out], { extensionPath, out, ...bins });
    assert.equal(waited.status, "answered");
    assert.equal(waited.value, "yes");
    assert.equal(waited.via, "dashboard");
  } finally {
    dashboard(["stop"], { extensionPath, out, ...bins });
  }
});

test("refresh labels fresh, stale, and failed without calling a stale page fresh", async () => {
  const target = temp();
  fs.writeFileSync(path.join(target, "kept.txt"), "older");
  const began = Date.now();
  const summary = await refreshSources(target, [
    { id: "ok", url: "https://example.test/ok" },
    { id: "kept", url: "https://example.test/kept" },
    { id: "missing", url: "https://example.test/missing" },
    { id: "slow", url: "https://example.test/slow" }
  ], {
    pageTimeoutMs: 250,
    budgetMs: 1000,
    fetchImpl: async (url) => {
      if (String(url).endsWith("/slow")) await new Promise((resolve) => setTimeout(resolve, 600));
      if (String(url).endsWith("/ok")) return { ok: true, async text() { return "<p>Hello</p>"; } };
      throw new Error("nope");
    }
  });
  const elapsed = Date.now() - began;
  assert.ok(summary.fresh.includes("ok"));
  assert.ok(summary.stale.includes("kept"));
  assert.ok(summary.failed.includes("missing"));
  assert.equal(summary.fresh.includes("kept"), false);
  assert.equal(summary.fresh.includes("missing"), false);
  assert.ok(elapsed < 900, `parallel refresh took ${elapsed}ms`);
  const out = temp();
  await start({ extensionPath, out, ...bins });
  await session(["mode", "--set", "chat", "--out", out], { extensionPath, out, ...bins });
  await session(["answer", "--id", "goal", "--value", "Title", "--out", out], { extensionPath, out, ...bins }).catch(() => {});
  await session(["ask", "--id", "goal", "--out", out], { extensionPath, out, ...bins });
  await session(["answer", "--id", "goal", "--value", "Title", "--out", out], { extensionPath, out, ...bins });
  await session(["ask", "--id", "sample", "--out", out], { extensionPath, out, ...bins });
  await session(["answer", "--id", "sample", "--value", "yes", "--out", out], { extensionPath, out, ...bins });
  const result = await refresh({
    extensionPath,
    out,
    fetchImpl: async () => ({ ok: true, async text() { return "page"; } })
  });
  assert.deepEqual(result.fresh, ["example"]);
  const sessionFile = JSON.parse(fs.readFileSync(path.join(out, "session.json"), "utf8"));
  assert.equal(sessionFile.docs.pages[0].freshness, "fresh");
  assert.equal(sessionFile.steps.find((step) => step.id === "docs").status, "done");
});

test("questionsAfterDocs receives the session folder and everyInvocation false reuses the summary", async () => {
  const dir = temp();
  const ext = path.join(dir, "extension.mjs");
  fs.writeFileSync(ext, `import fs from "node:fs";
import path from "node:path";
export default {
  id: "cache",
  title: "Cache",
  steps: [{ id: "prepare", label: "Prepare" }, { id: "docs", label: "Docs" }, { id: "done", label: "Wrap up" }],
  docs: { everyInvocation: false, pageTimeoutMs: 1000, budgetMs: 2000 },
  prepare() { return { name: "Cache", path: "/tmp/cache-root" }; },
  questions() { return []; },
  sources() { return [{ id: "page", url: "https://example.test/page" }]; },
  questionsAfterDocs(session, out) {
    const text = fs.readFileSync(path.join(out, "docs", "page.txt"), "utf8");
    return [{ id: "after", title: "After", prompt: text, options: [{ id: "yes", label: "Yes", detail: "Continues." }] }];
  }
};
`);
  const out = temp();
  let fetches = 0;
  const fetchImpl = async () => {
    fetches += 1;
    return { ok: true, async text() { return "<p>document name</p>"; } };
  };
  await start({ extensionPath: ext, out, input: "/tmp/cache-root", ...bins });
  await session(["mode", "--set", "chat", "--out", out], { extensionPath: ext, out, ...bins });
  const first = await refresh({ extensionPath: ext, out, fetchImpl });
  assert.equal(first.network, true);
  assert.equal(fetches, 1);
  const questions = JSON.parse(fs.readFileSync(path.join(out, "questions.json"), "utf8"));
  assert.equal(questions.find((item) => item.id === "after").prompt, "document name");
  const second = await refresh({ extensionPath: ext, out, fetchImpl });
  assert.equal(second.cached, true);
  assert.equal(second.network, false);
  assert.equal(fetches, 1);
  const sessionFile = JSON.parse(fs.readFileSync(path.join(out, "session.json"), "utf8"));
  assert.equal(sessionFile.addon.path, "/tmp/cache-root");
  assert.deepEqual(sessionFile.docs.fresh, ["page"]);
});

test("the dashboard copy stays generic until a session supplies a surface", () => {
  const page = fs.readFileSync(path.join(boilerplateRoot, ".claude/skills/skill-boilerplate/assets/dashboard/app.js"), "utf8");
  const html = fs.readFileSync(path.join(boilerplateRoot, ".claude/skills/skill-boilerplate/assets/dashboard/index.html"), "utf8");
  const joined = `${page}\n${html}`;
  for (const phrase of ["Panel bugs", "From the scan", "Skip to the review", "review pattern", "Panel at 320", "Waiting for a review", "Measured at 320"]) {
    assert.equal(joined.includes(phrase), false, phrase);
  }
  assert.match(html, /Skip to the session/);
  assert.match(page, /function surfaceFlags/);
  assert.match(page, /Docs fresh /);
  assert.match(page, /docs\.fresh\.length/);
});

test("the dashboard question card does not offer a chat answer", () => {
  const page = fs.readFileSync(path.join(boilerplateRoot, ".claude/skills/skill-boilerplate/assets/dashboard/app.js"), "utf8");
  const theme = fs.readFileSync(path.join(boilerplateRoot, ".claude/skills/skill-boilerplate/assets/dashboard/theme.js"), "utf8");
  const hint = page.match(/const DASHBOARD_CARD_HINT = "([^"]*)"/);
  assert.ok(hint, "dashboard card hint is missing");
  assert.equal(/chat/i.test(hint[1]), false);
  assert.equal(page.includes("You can also answer in chat."), false);
  assert.match(page, /This decision is being asked in chat/);
  assert.match(page, /Reply in chat instead/);
  assert.match(page, /skill-boilerplate-theme/);
  assert.match(page, /getItem\("review-theme"\)/);
  assert.equal(page.includes("setItem(\"review-theme\""), false);
  assert.match(theme, /skill-boilerplate-theme/);
  assert.match(theme, /getItem\("review-theme"\)/);
  assert.equal(theme.includes("setItem(\"review-theme\""), false);
});

test("the boilerplate folder does not import the parent repo", () => {
  const root = boilerplateRoot;
  const bad = [];
  walk(root, (file, text) => {
    const outside = ["uxp-", "assistant"].join("") ;
    const other = ["cep-", "to-", "uxp"].join("");
    if (text.includes(outside) || text.includes(other)) bad.push(file);
    const specifiers = [...text.matchAll(/from\s+["']([^"']+)["']/g)].map((match) => match[1]);
    for (const spec of specifiers) {
      if (!spec.startsWith(".")) continue;
      const resolved = path.resolve(path.dirname(file), spec);
      if (!resolved.startsWith(root + path.sep) && resolved !== root) bad.push(`${file} -> ${spec}`);
    }
  });
  assert.deepEqual(bad, []);
});

function walk(dir, visit) {
  for (const name of fs.readdirSync(dir)) {
    if (name === "node_modules" || name === ".git") continue;
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) walk(full, visit);
    else if (/\.(mjs|js|md|json)$/.test(name)) visit(full, fs.readFileSync(full, "utf8"));
  }
}
