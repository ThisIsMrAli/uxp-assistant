import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { feasibilityAsk, runtimeAsk } from "../.claude/skills/uxp-assistant/scripts/lib/ask.mjs";
import { resolveCapability } from "../.claude/skills/uxp-assistant/scripts/lib/capability.mjs";
import { runPackage } from "../.claude/skills/uxp-assistant/scripts/lib/package-project.mjs";
import { pagesForRequest } from "../.claude/skills/uxp-assistant/scripts/lib/registry.mjs";
import { reviewClaim, showsHonestUiState, undocumentedHostCalls } from "../.claude/skills/uxp-assistant/scripts/lib/review.mjs";
import { runtimeOffer } from "../.claude/skills/uxp-assistant/scripts/lib/runtime.mjs";
import { hashTree } from "../scripts/sync-boilerplate.mjs";
import { run } from "../.claude/skills/uxp-assistant/scripts/skill.mjs";
import { nextAction } from "../skill-boilerplate/.claude/skills/skill-boilerplate/scripts/lib/next.mjs";
import { adoptAsk, readMerged, setMode, startSession } from "../skill-boilerplate/.claude/skills/skill-boilerplate/scripts/lib/session.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const blank = path.join(root, "skill-boilerplate/examples/blank/extension.mjs");

function temp(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), name));
}

function runNode(script, args, env, cwd = root) {
  const childEnv = { ...process.env, ...env };
  for (const key of Object.keys(childEnv)) if (key.startsWith("NODE_TEST") || key === "NODE_CHANNEL_FD") delete childEnv[key];
  return spawnSync(process.execPath, [script, ...args], { cwd, encoding: "utf8", env: childEnv, timeout: 20000 });
}

test("B10 refresh asks for the Premiere sequence, track, clip, project, and tick time pages", () => {
  const pages = pagesForRequest({ host: "ppro", goal: "List the name and duration of each clip on the first video track" });
  for (const id of ["premiere.sequence", "premiere.videotrack", "premiere.videocliptrackitem", "premiere.project", "premiere.ticktime"]) {
    assert.ok(pages.some((page) => page.id === id && page.url.includes("ppro-reference/classes/")), id);
  }
  assert.ok(pages.some((page) => page.id === "premiere.constants" && page.url.includes("ppro-reference/constants")));
});

test("N7 a WebView goal recommends WebView", () => {
  const offer = runtimeOffer({
    pages: [
      { id: "entrypoints", freshness: "fresh", text: "panel command" },
      { id: "manifest", freshness: "fresh", text: "manifest version 5" },
      { id: "webview", freshness: "fresh", text: "HTMLWebViewElement allowLocalRendering plugin:/" }
    ],
    goal: "Show the document title in a WebView and postMessage the result"
  });
  assert.equal(offer.choices[0].id, "webview");
  assert.match(runtimeAsk(offer).options[0].label, /Recommended/);
  assert.equal(offer.choices[0].detail.includes("extractDocFacts"), false);
});

test("N11 an offline runtime question has a Recommended option and is never empty", () => {
  const ask = runtimeAsk({ choices: [], gaps: ["The pages are not fresh."] });
  assert.ok(ask.options.length >= 2);
  assert.match(ask.options[0].label, /\(Recommended\)/);
  assert.equal(ask.options.some((item) => item.id === "refresh"), true);
  const pause = feasibilityAsk({ state: "docs-incomplete", detail: "No fresh page." });
  assert.match(pause.options[0].label, /\(Recommended\)/);
});

test("N13 a wired waiting state passes and static text does not", () => {
  const wired = "export function Panel(){ const [busy, setBusy] = useState(false); async function go(){ setBusy(true); await run(); setBusy(false); } return <button disabled={busy} onClick={go}>{busy ? 'Waiting for Photoshop' : 'Read'}</button>; }";
  assert.equal(showsHonestUiState(wired), true);
  const setOnce = "export function Panel(){ const [phase, setPhase] = useState('waiting'); return <button onClick={() => setPhase('ready')}>{phase}</button>; }";
  assert.equal(showsHonestUiState(setOnce), false, "NT8: a rendered state set once to a constant is not a waiting state");
  assert.equal(showsHonestUiState("export function Panel(){ return <p>Waiting for Photoshop</p>; }"), false);
  assert.equal(showsHonestUiState("export function Panel(){ return <sp-body>Error codes are listed in the docs.</sp-body>; }"), false);
  assert.equal(showsHonestUiState("export const status = 1;\nexport function Panel(){ return <p>{status}</p>; }"), false);
});

test("N4 a rename outside executeAsModal fails, and one inside it does not fail for that reason", () => {
  const contract = {
    goal: "Rename the selected layer",
    baseline: { files: {}, fileSurfaces: {}, surface: "" },
    evidence: [{ quote: "executeAsModal layer.name" }],
    docText: "executeAsModal suspendHistory resumeHistory"
  };
  const outside = reviewClaim({
    contract,
    files: ["src/layers.ts"],
    bodies: ["export function rename(layer, name) { layer.name = name; }\n"]
  });
  assert.equal(outside.ok, false);
  assert.match(outside.say, /outside executeAsModal/);
  const inside = reviewClaim({
    contract,
    files: ["src/layers.ts"],
    bodies: ["import { core } from \"photoshop\";\nexport async function rename(layer, name) { return core.executeAsModal(async () => { layer.name = name; }); }\n"]
  });
  assert.equal(/outside executeAsModal/.test(inside.say || ""), false);
});

test("N5 an unchanged starter file does not satisfy the API review", () => {
  const main = "import { photoshop } from \"globals\";\nexport const id = photoshop.action;\n";
  const claim = reviewClaim({
    contract: {
      goal: "Rename the selected layer",
      baseline: {
        files: { "src/main.tsx": crypto.createHash("sha256").update(main).digest("hex") },
        fileSurfaces: { "src/main.tsx": "photoshop . action" },
        surface: "photoshop . action"
      },
      evidence: [{ quote: "activeLayers executeAsModal" }],
      docText: "executeAsModal activeLayers"
    },
    files: ["src/main.tsx", "src/layers.ts"],
    bodies: [main, "export function rename(){ return null; }\n"]
  });
  assert.equal(claim.ok, false);
  assert.match(claim.say, /unchanged file|documented API/);
  assert.equal((claim.introducedFiles || []).includes("src/main.tsx"), false);
});

test("N10 a host call missing from the fetched docs fails even when a test repeats it", () => {
  const feature = "export async function list(track) { const project = await track.getActiveSequence(); return track.getClips(); }\n";
  const missing = undocumentedHostCalls([
    { rel: "src/clips.ts", body: feature },
    { rel: "test/clips.test.mjs", body: "track.getClips(); track.getActiveSequence();\n" }
  ], "getActiveSequence getTrackItems getName getDuration");
  assert.ok(missing.some((item) => item.includes("getClips")));
  const documented = undocumentedHostCalls([
    { rel: "src/clips.ts", body: "export async function list(track) { return track.getTrackItems(); }\n" }
  ], "getTrackItems getName");
  assert.deepEqual(documented, []);
});

test("N8 a WebView build that exits 0 with no modules is a failure", () => {
  const project = temp("uxp-n8-");
  fs.mkdirSync(path.join(project, "webview-ui"));
  fs.writeFileSync(path.join(project, "webview-ui", "package.json"), "{}\n");
  fs.writeFileSync(path.join(project, "package.json"), `${JSON.stringify({ scripts: { build: "echo build" } })}\n`);
  const result = runPackage(project, {
    runner: () => ({ status: 0, stdout: "WEBVIEW MODULES NOT INSTALLED\n", stderr: "" })
  });
  assert.equal(result.status, "failed");
  assert.match(result.reason, /WEBVIEW MODULES NOT INSTALLED/);
});

test("N9 a handoff evidence quote is one short sentence", () => {
  const noise = `${"Skip to content | ".repeat(30)}Document title is the name of the open document. ${"More navigation. ".repeat(20)}`;
  const resolved = resolveCapability({
    goal: "Show the document title",
    pages: [{ id: "photoshop.document", freshness: "fresh", url: "https://example.test/document", text: noise }]
  });
  assert.ok(resolved.evidence.length > 0);
  for (const item of resolved.evidence) {
    assert.ok(item.quote.length <= 160, item.quote);
    assert.equal(/&#|const |\/\//.test(item.quote), false, item.quote);
  }
  const noisy = resolveCapability({
    goal: "Show the document title",
    pages: [{
      id: "photoshop.document",
      freshness: "fresh",
      url: "https://example.test/document",
      text: "op'); // The currently active document is open. const currentDocument = app. &#x3C;!-- Prerelease still. The document title is the name of the open document."
    }]
  });
  assert.ok(noisy.evidence.length > 0);
  for (const item of noisy.evidence) {
    assert.equal(/&#|const |\/\//.test(item.quote), false, item.quote);
    assert.match(item.quote, /document title|The page documents/i);
  }
});

test("B6 and N2 document one record command and one file format", () => {
  const page = fs.readFileSync(path.join(root, ".claude/skills/uxp-assistant/SKILL.md"), "utf8");
  assert.match(page, /npx skills add <owner>\/uxp-assistant --skill uxp-assistant -a cursor/);
  assert.match(page, /\{ "path": "src\/main\.tsx", "sha256": "<64 hex characters>" \}/);
  assert.match(page, /node scripts\/skill\.mjs record --out <session>/);
  assert.match(page, /Do not run `assist\.mjs record`/);
  assert.match(page, /npm install/);
  assert.match(page, /webview-ui/);
});

test("B16 new preview logs do not claim a cloud capture", () => {
  const preview = fs.readFileSync(path.join(root, ".claude/skills/uxp-assistant/scripts/webview-preview.mjs"), "utf8");
  assert.equal(preview.includes("this cloud environment"), false);
  assert.match(preview, /this machine/);
});

test("N1 a finished record makes next finished instead of record", async () => {
  const out = temp("uxp-n1-");
  const started = await run(["start", "--empty", temp("uxp-n1-empty-"), "--out", out]);
  assert.equal(started.ok, true, JSON.stringify(started));
  const domain = path.join(out, "domain");
  fs.mkdirSync(domain, { recursive: true });
  fs.writeFileSync(path.join(domain, "record-result.json"), `${JSON.stringify({ state: "commands-finished", hostExecuted: false })}\n`);
  fs.writeFileSync(path.join(domain, "session.json"), `${JSON.stringify({ outcome: "commands-finished" })}\n`);
  const next = await run(["session", "next", "--out", out]);
  assert.equal(next.action, "finished");
  assert.equal(next.step, "done");
  assert.match(next.say, /NOT TESTED/);
});

test("N3 an adopted script-change question is the dashboard's next step", () => {
  const out = temp("uxp-n3-");
  startSession(out, { addon: "UXP", steps: [{ id: "decide", label: "Decide" }, { id: "done", label: "Wrap up" }] });
  setMode(out, "dashboard");
  adoptAsk(out, {
    id: "script-change",
    nonce: "abc123",
    title: "Approve exact command and file changes",
    prompt: "Approve this exact set.",
    options: [
      { id: "approve", label: "Run this exact set (Recommended)" },
      { id: "stop", label: "Do not run the changed scripts" }
    ]
  });
  const merged = readMerged(out);
  assert.equal(merged.asks.some((ask) => ask.id === "script-change" && ask.status === "pending"), true);
  const next = nextAction(out, { dashboardUp: true });
  assert.equal(next.ask, "script-change");
  assert.equal(next.action, "wait");
});

test("NB1 the printed refresh command does not ask for the extension file again", () => {
  const out = temp("uxp-nb1-");
  const start = runNode(path.join(root, "skill-boilerplate/.claude/skills/skill-boilerplate/scripts/start.mjs"), ["--extension", blank, "--out", out]);
  assert.equal(start.status, 0, start.stdout + start.stderr);
  const mode = runNode(path.join(root, "skill-boilerplate/.claude/skills/skill-boilerplate/scripts/session.mjs"), ["mode", "--set", "chat", "--out", out]);
  assert.equal(mode.status, 0, mode.stdout + mode.stderr);
  const refreshed = runNode(path.join(root, "skill-boilerplate/.claude/skills/skill-boilerplate/scripts/refresh.mjs"), ["--out", out]);
  const text = `${refreshed.stdout}\n${refreshed.stderr}`;
  assert.notEqual(refreshed.status, null, text);
  assert.equal(text.includes("Pass the extension file."), false, text);
});

test("NB2 done is refused when docs were never fetched", () => {
  const out = temp("uxp-nb2-");
  const start = runNode(path.join(root, "skill-boilerplate/.claude/skills/skill-boilerplate/scripts/start.mjs"), ["--extension", blank, "--out", out]);
  assert.equal(start.status, 0, start.stdout + start.stderr);
  runNode(path.join(root, "skill-boilerplate/.claude/skills/skill-boilerplate/scripts/session.mjs"), ["mode", "--set", "chat", "--out", out]);
  const done = runNode(path.join(root, "skill-boilerplate/.claude/skills/skill-boilerplate/scripts/session.mjs"), ["done", "--summary", "too early", "--out", out]);
  assert.notEqual(done.status, 0);
  assert.match(`${done.stdout}\n${done.stderr}`, /Docs were never fetched/);
  const session = JSON.parse(fs.readFileSync(path.join(out, "session.json"), "utf8"));
  assert.notEqual(session.steps.find((step) => step.id === "done").status, "done");
});

test("N12 refresh exits while the proxy accepts and never answers", async () => {
  const server = net.createServer((socket) => {
    socket.on("error", () => {});
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const extension = path.join(temp("uxp-n12-ext-"), "extension.mjs");
  fs.mkdirSync(path.dirname(extension), { recursive: true });
  fs.writeFileSync(extension, `export default {
    id: "hang",
    title: "Hang",
    steps: [{ id: "docs", label: "Docs" }, { id: "done", label: "Wrap up" }],
    docs: { everyInvocation: true, parallel: true, pageTimeoutMs: 400, budgetMs: 1200 },
    sources() { return [{ id: "example", url: "https://example.com/" }]; }
  };\n`);
  const out = temp("uxp-n12-");
  runNode(path.join(root, "skill-boilerplate/.claude/skills/skill-boilerplate/scripts/start.mjs"), ["--extension", extension, "--out", out]);
  runNode(path.join(root, "skill-boilerplate/.claude/skills/skill-boilerplate/scripts/session.mjs"), ["mode", "--set", "chat", "--out", out]);
  const began = Date.now();
  const refreshed = runNode(
    path.join(root, "skill-boilerplate/.claude/skills/skill-boilerplate/scripts/refresh.mjs"),
    ["--out", out],
    { NODE_USE_ENV_PROXY: "1", HTTPS_PROXY: `http://127.0.0.1:${port}`, NO_PROXY: "127.0.0.1,localhost" }
  );
  const elapsed = Date.now() - began;
  server.close();
  assert.ok(elapsed < 8000, `refresh stayed up for ${elapsed}ms\n${refreshed.stdout}\n${refreshed.stderr}`);
  assert.notEqual(refreshed.status, null);
  assert.match(refreshed.stdout, /failed/);
});

test("B7 the advertised skills install can start", () => {
  const embedded = path.join(root, ".claude/skills/uxp-assistant/skill-boilerplate");
  assert.equal(fs.existsSync(path.join(embedded, "api.mjs")), true);
  assert.equal(fs.lstatSync(path.join(embedded, "api.mjs")).isSymbolicLink(), false);
  assert.equal(hashTree(embedded), hashTree(path.join(root, "skill-boilerplate")));
  const into = temp("uxp-b7-");
  const added = spawnSync("npx", ["--yes", "skills", "add", root, "--skill", "uxp-assistant", "-a", "cursor", "-y"], {
    cwd: into,
    encoding: "utf8",
    timeout: 60000
  });
  assert.equal(added.status, 0, added.stdout + added.stderr);
  const installed = path.join(into, ".agents/skills/uxp-assistant/skill-boilerplate/api.mjs");
  assert.equal(fs.existsSync(installed), true, added.stdout);
  const home = temp("uxp-b7-home-");
  const session = temp("uxp-b7-session-");
  const started = runNode(path.join(into, ".agents/skills/uxp-assistant/scripts/skill.mjs"), ["start", "--empty", temp("uxp-b7-empty-"), "--out", session], {
    HOME: home,
    SKILL_TEST_HOME: home
  }, path.join(into, ".agents/skills/uxp-assistant"));
  assert.equal(started.status, 0, started.stdout + started.stderr);
  assert.equal(`${started.stdout}\n${started.stderr}`.includes("Cannot find"), false, started.stdout + started.stderr);
  const body = JSON.parse(started.stdout.trim().split("\n").filter(Boolean).at(-1));
  assert.equal(body.ok, true);
});
