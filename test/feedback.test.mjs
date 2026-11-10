import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { feedbackQuestion, runFeedback } from "../.claude/skills/uxp-assistant/scripts/lib/feedback.mjs";
import { run } from "../.claude/skills/uxp-assistant/scripts/skill.mjs";
import { session, start } from "../.claude/skills/uxp-assistant/scripts/runtime/api.mjs";
import { createDashboardServer } from "../.claude/skills/uxp-assistant/scripts/runtime/lib/server.mjs";
import { nextAction } from "../.claude/skills/uxp-assistant/scripts/runtime/lib/next.mjs";
import { assetsDir } from "../.claude/skills/uxp-assistant/scripts/runtime/lib/paths.mjs";
import { publishAsk, readMerged, setStep } from "../.claude/skills/uxp-assistant/scripts/runtime/lib/session.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const extensionPath = path.join(root, ".claude/skills/uxp-assistant/extension.mjs");
const bins = { sessionBin: "node scripts/skill.mjs session", dashboardBin: "node scripts/skill.mjs dashboard" };
const QR = "create a plugin that create high quality qr codes in premiere";
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

const made = [];
function temp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "uxp-fb-"));
  made.push(dir);
  return dir;
}
process.on("exit", () => made.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));

/** A session whose plugin has passed check, which is when the try step starts. */
async function checked(mode = "chat") {
  const out = path.join(temp(), "session");
  const ctx = { extensionPath, out, ...bins };
  await start({ ...ctx, input: temp(), kind: "empty", extra: { goal: QR } });
  await session(["mode", "--set", mode, "--out", out], ctx);
  await session(["ask", "--id", "plan", "--out", out], ctx);
  await session(["answer", "--id", "plan", "--value", "build", "--out", out], ctx);
  for (const step of ["docs", "build", "implement", "check"]) setStep(out, step, "done", "ok");
  fs.writeFileSync(path.join(out, "load.txt"), "Open UXP Developer Tool, choose Add Plugin, select /p/dist/manifest.json, then Load.\n");
  return { out, ctx };
}

const askFeedback = (out, ctx, changed = "") => runFeedback(out, { changed, ask: (file) => session(["ask", "--id", "feedback", "--definition", file, "--out", out], ctx) });

test("the try step comes after check and before done, and refuses to start before the plugin is clean", async () => {
  const { out, ctx } = await checked();
  assert.deepEqual(readMerged(out).steps.map((step) => step.id).slice(-3), ["check", "try", "done"]);
  assert.equal(nextAction(out).action, "try");
  assert.match(nextAction(out).command, /skill\.mjs feedback/);
  setStep(out, "check", "running", "fixing");
  const early = await askFeedback(out, ctx);
  assert.equal(early.ok, false);
  assert.match(early.error, /check/);
});

test("round one says how to load it, takes words and screenshots, and ends only on the developer's word", async () => {
  const { out, ctx } = await checked();
  const published = await askFeedback(out, ctx);
  assert.equal(published.round, 1);
  assert.match(published.question.prompt, /Nobody has run it in Premiere Pro/);
  assert.match(published.question.prompt, /Add Plugin/);
  const card = readMerged(out).asks.find((item) => item.id === "feedback");
  assert.equal(card.attach, true);
  assert.deepEqual(card.options.map((item) => item.id), ["bugs", "good"]);
  assert.equal(card.options[0].repeat, true);
  assert.equal(readMerged(out).steps.find((step) => step.id === "try").status, "waiting");

  const shot = path.join(temp(), "bug.png");
  fs.writeFileSync(shot, PNG);
  const answered = await session(["answer", "--id", "feedback", "--value", "bugs", "--text", "The QR is blurry and Save does nothing", "--image", shot, "--out", out], ctx);
  assert.equal(answered.note, "fb1");
  assert.match(answered.next, /report 1/);

  const merged = readMerged(out);
  const note = merged.notes.find((item) => item.id === "fb1");
  assert.match(note.text, /blurry/);
  assert.equal(note.status, "open");
  assert.equal(note.shots.length, 1);
  assert.ok(fs.existsSync(path.join(out, note.shots[0])), "the screenshot is under shots/");
  assert.notEqual(merged.steps.find((step) => step.id === "try").status, "done", "a bug report does not finish the step");

  const action = nextAction(out);
  assert.equal(action.action, "apply");
  assert.match(action.say, /blurry/);
  assert.match(action.say, new RegExp(path.join(out, "shots").replace(/[\\^$.*+?()[\]{}|]/g, "\\$&")));
  assert.match(action.say, /feedback --changed/);

  const second = await askFeedback(out, ctx, "Sharper QR and Save now writes the file.");
  assert.equal(second.round, 2);
  assert.match(second.question.prompt, /Round 2\. Sharper QR/);
  assert.equal(nextAction(out).action, "ask-in-chat", "the new round is waiting for the developer, not for the agent");

  const done = await session(["answer", "--id", "feedback", "--value", "good", "--out", out], ctx);
  assert.equal(done.value, "good");
  assert.equal(readMerged(out).steps.find((step) => step.id === "try").status, "done");
  const closed = readMerged(out).notes.find((item) => item.id === "fb1");
  assert.equal(closed.status, "fixed");
  assert.equal(closed.fixedBy, "developer", "the developer's no-more-bugs closes the reports");
  assert.equal(nextAction(out).action, "finish");
});

test("a bug report needs words or a screenshot, and only real images are kept", async () => {
  const { out, ctx } = await checked();
  await askFeedback(out, ctx);
  await assert.rejects(session(["answer", "--id", "feedback", "--value", "bugs", "--out", out], ctx), /words|screenshot/);
  const fake = path.join(temp(), "x.png");
  fs.writeFileSync(fake, "not an image at all");
  await assert.rejects(session(["answer", "--id", "feedback", "--value", "bugs", "--image", fake, "--out", out], ctx), /not a PNG/);
  assert.equal(readMerged(out).asks.find((item) => item.id === "feedback").status, "pending");
});

test("session note records a problem with a screenshot and closes it", async () => {
  const { out, ctx } = await checked();
  const shot = path.join(temp(), "bug.png");
  fs.writeFileSync(shot, PNG);
  const added = await session(["note", "--id", "x1", "--text", "Button is clipped", "--screen", "Main panel", "--shot", shot, "--out", out], ctx);
  assert.equal(added.id, "x1");
  const note = readMerged(out).notes.find((item) => item.id === "x1");
  assert.equal(note.screen, "Main panel");
  assert.match(note.shot, /^shots\//);
  await session(["note", "--id", "x1", "--status", "fixed", "--out", out], ctx);
  assert.equal(readMerged(out).notes.find((item) => item.id === "x1").status, "fixed");
});

test("start --yes has no one to try it, so the try step is skipped and the run still ends at done", async () => {
  const out = path.join(temp(), "s");
  const original = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("network"); };
  try {
    await run(["start", "--goal", QR, "--empty", temp(), "--yes", "--out", out]);
  } finally {
    globalThis.fetch = original;
  }
  assert.equal(readMerged(out).steps.find((step) => step.id === "try").status, "skipped");
  for (const step of ["docs", "build", "implement", "check"]) setStep(out, step, "done", "ok");
  assert.equal(nextAction(out).action, "finish");
});

test("feedback --skip ends the step for a run with no person", async () => {
  const { out } = await checked();
  const skipped = await runFeedback(out, { skip: true });
  assert.equal(skipped.skipped, true);
  assert.equal(nextAction(out).action, "finish");
});

// ---- the dashboard endpoint --------------------------------------------------------------

async function served() {
  const { out, ctx } = await checked("dashboard");
  publishAsk(out, feedbackQuestion(out));
  const dash = createDashboardServer({ out, assets: assetsDir });
  const { port, token } = await dash.listen(0);
  const call = (method, pathname, body, { origin = `http://127.0.0.1:${port}`, host = `127.0.0.1:${port}` } = {}) => new Promise((resolve, reject) => {
    const data = body === undefined ? null : Buffer.from(typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body));
    const req = http.request({ host: "127.0.0.1", port, method, path: `${pathname}${pathname.includes("?") ? "&" : "?"}t=${token}`, headers: { host, ...(origin && method === "POST" ? { origin } : {}), ...(data ? { "content-type": "application/json", "content-length": data.length } : {}) } }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const raw = Buffer.concat(chunks);
        let json = null;
        try { json = JSON.parse(raw.toString("utf8")); } catch { /* an image, not JSON */ }
        resolve({ status: res.statusCode, json, raw, type: res.headers["content-type"] });
      });
    });
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
  return { out, ctx, dash, call, nonce: () => readMerged(out).asks.find((item) => item.id === "feedback").nonce };
}

const png64 = `data:image/png;base64,${PNG.toString("base64")}`;

test("the dashboard saves screenshots under shots/, serves them back, and gives the agent words and paths", async () => {
  const { out, dash, call } = await served();
  try {
    const sent = await call("POST", "/api/answer", { id: "feedback", value: "bugs", text: "  Text says undefined  ", images: [{ name: "a.png", data: png64 }, { name: "b.png", data: png64 }] });
    assert.equal(sent.status, 200, sent.raw.toString());
    assert.equal(sent.json.images, 2);
    const ask = readMerged(out).asks.find((item) => item.id === "feedback");
    assert.equal(ask.status, "answered");
    assert.equal(ask.answerText, "Text says undefined");
    assert.equal(ask.answerImages.length, 2);
    for (const file of ask.answerImages) {
      assert.match(file, /^shots\/fb-[a-f0-9]+-\d\.png$/);
      assert.ok(fs.readFileSync(path.join(out, file)).equals(PNG));
    }
    const served = await call("GET", `/files/${ask.answerImages[0]}`);
    assert.equal(served.status, 200);
    assert.equal(served.type, "image/png");
    const waited = await call("GET", "/api/wait?id=feedback&timeout=1");
    assert.equal(waited.json.status, "answered");
    assert.equal(waited.json.value, "bugs");
    assert.equal(waited.json.text, "Text says undefined");
    assert.deepEqual(waited.json.images, ask.answerImages);
  } finally {
    await dash.close();
  }
});

test("the endpoint refuses a report with nothing in it, a file that is not an image, too many, and a cross-site post", async () => {
  const { out, dash, call } = await served();
  try {
    assert.equal((await call("POST", "/api/answer", { id: "feedback", value: "bugs" })).status, 400);
    const notImage = await call("POST", "/api/answer", { id: "feedback", value: "bugs", images: [{ data: Buffer.from("<svg onload=alert(1)>").toString("base64") }] });
    assert.equal(notImage.status, 400);
    assert.match(notImage.json.error, /PNG, JPEG, or WebP/);
    const many = await call("POST", "/api/answer", { id: "feedback", value: "bugs", images: Array.from({ length: 7 }, () => ({ data: png64 })) });
    assert.equal(many.status, 400);
    assert.equal((await call("POST", "/api/answer", { id: "feedback", value: "bugs", text: "x" }, { origin: "http://evil.example" })).status, 403);
    assert.equal((await call("POST", "/api/answer", { id: "feedback", value: "bugs", text: "x" }, { host: "evil.example" })).status, 421);
    assert.equal(readMerged(out).asks.find((item) => item.id === "feedback").status, "pending", "nothing was recorded");
    assert.deepEqual(fs.existsSync(path.join(out, "shots")) ? fs.readdirSync(path.join(out, "shots")) : [], [], "nothing was written");
  } finally {
    await dash.close();
  }
});

test("a body over the limit gets a 413 the page can show, and a question that takes no screenshots keeps the small limit", async () => {
  const { out, dash, call } = await served();
  try {
    const huge = "A".repeat(50 * 1024 * 1024);
    const refused = await call("POST", "/api/answer", { id: "feedback", value: "bugs", images: [{ data: huge }] });
    assert.equal(refused.status, 413);
    assert.match(refused.json.error, /too large/i);
    assert.equal(readMerged(out).asks.find((item) => item.id === "feedback").status, "pending");

    // With the screenshot question answered, nothing pending takes screenshots, so 64 KB is all any body gets.
    assert.equal((await call("POST", "/api/answer", { id: "feedback", value: "good" })).status, 200);
    publishAsk(out, { id: "plan", title: "Plan", prompt: "Go?", options: [{ id: "build", label: "Build" }, { id: "stop", label: "Stop" }] });
    assert.equal((await call("POST", "/api/answer", { id: "plan", value: "build", pad: "A".repeat(80 * 1024) })).status, 413);
    assert.equal((await call("POST", "/api/answer", { id: "plan", value: "build" })).status, 200);
  } finally {
    await dash.close();
  }
});

test("the good answer needs nothing else and ends the loop", async () => {
  const { out, dash, call } = await served();
  try {
    const sent = await call("POST", "/api/answer", { id: "feedback", value: "good" });
    assert.equal(sent.status, 200);
    const ask = readMerged(out).asks.find((item) => item.id === "feedback");
    assert.equal(ask.answer, "good");
    assert.equal(ask.answerText, undefined);
    // The agent's wait reads it. If that read was lost, asking again must not erase the answer.
    const again = await runFeedback(out, { ask: () => { throw new Error("must not publish again"); } });
    assert.equal(again.answered, "good");
    assert.equal(nextAction(out, { dashboardUp: true }).action, "finish");
  } finally {
    await dash.close();
  }
});

test("after a report is fixed and check runs again, next says mark notes then feedback, not read the screenshots", async () => {
  const { out, ctx } = await checked();
  await askFeedback(out, ctx);
  const shot = path.join(temp(), "bug.png");
  fs.writeFileSync(shot, PNG);
  await session(["answer", "--id", "feedback", "--value", "bugs", "--text", "Export does nothing", "--image", shot, "--out", out], ctx);
  assert.equal(nextAction(out).action, "apply");
  // Simulate: agent fixed the code and re-ran check after the report.
  const answeredAt = readMerged(out).asks.find((item) => item.id === "feedback").answeredAt;
  assert.ok(answeredAt);
  await new Promise((resolve) => setTimeout(resolve, 20));
  setStep(out, "check", "done", "Built and clean");
  const action = nextAction(out);
  assert.equal(action.action, "fix-and-ask", action.say);
  assert.match(action.say, /already read/);
  assert.match(action.say, /note --id <id> --status fixed/);
  assert.match(action.command, /feedback --changed/);
  assert.doesNotMatch(action.say, /Screenshots to read/);
});

