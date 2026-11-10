import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { htmlToText } from "../.claude/skills/uxp-assistant/scripts/lib/html-text.mjs";
import { runPackage } from "../.claude/skills/uxp-assistant/scripts/lib/package-project.mjs";
import {
  commandChangeSet,
  reviewClaim,
  showsHonestUiState,
  testsCoverFeature,
  undocumentedHostCalls
} from "../.claude/skills/uxp-assistant/scripts/lib/review.mjs";
import { toolingPrefix } from "../.claude/skills/uxp-assistant/scripts/lib/scaffold.mjs";
import { installTree, verifyTree } from "../.claude/skills/uxp-assistant/scripts/lib/tooling.mjs";
import { stageDecision } from "../.claude/skills/uxp-assistant/scripts/lib/stages.mjs";
import { snapshotTemps, sweepOwnedTemps } from "../.claude/skills/uxp-assistant/scripts/lib/temps.mjs";
import { applyDocsRefresh, run } from "../.claude/skills/uxp-assistant/scripts/skill.mjs";
import { scriptChangeAsk } from "../.claude/skills/uxp-assistant/scripts/lib/ask.mjs";
import { refreshExitCode } from "../.claude/skills/uxp-assistant/scripts/runtime/refresh.mjs";
import { refreshSources } from "../.claude/skills/uxp-assistant/scripts/runtime/lib/refresh.mjs";
import { start } from "../.claude/skills/uxp-assistant/scripts/runtime/api.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DOCS = `
addNotificationListener
getVideoTrack
Returns: Promise<VideoTrack>
VideoTrack
getTrackItems
activeDocument
executeAsModal
`;
const GLOBALS = `export const uxp = require("uxp") as typeof import("uxp");
const hostName = uxp && uxp.host && uxp.host.name;
export const photoshop = (
  hostName === "photoshop" ? require("photoshop") : {}
) as typeof import("photoshop");
export const premierepro = (
  hostName === "premierepro" ? require("premierepro") : {}
) as typeof import("premierepro");
`;

function temp(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), name));
}

test("NS1 a Bolt globals import, a bracket call, and a destructured call are host calls", () => {
  const project = temp("uxp-ns1-");
  fs.mkdirSync(path.join(project, "src"), { recursive: true });
  fs.writeFileSync(path.join(project, "src", "globals.ts"), GLOBALS);
  fs.writeFileSync(path.join(project, "src", "host.ts"), "export { photoshop } from \"./globals\";\n");
  const main = `import { uxp, photoshop } from "./globals";
const id = uxp.entrypoints._pluginInfo.id;
export function listen() {
  photoshop.action.addNotificationListener(["open"], () => {});
  return photoshop.action.subscribeToEverything(() => {});
}
`;
  fs.writeFileSync(path.join(project, "src", "main.tsx"), main);
  const viaGlobals = undocumentedHostCalls([{ rel: "src/main.tsx", body: main }], DOCS, project);
  assert.ok(viaGlobals.some((item) => item.includes("subscribeToEverything")), viaGlobals.join(" | "));
  const reexport = `import { photoshop } from "./host";
export function listen() { return photoshop.action.subscribeToEverything(() => {}); }
`;
  fs.writeFileSync(path.join(project, "src", "reexport.ts"), reexport);
  const viaReexport = undocumentedHostCalls([{ rel: "src/reexport.ts", body: reexport }], DOCS, project);
  assert.ok(viaReexport.some((item) => item.includes("subscribeToEverything")), viaReexport.join(" | "));
  const bracket = "export async function list(sequence) { const track = await sequence.getVideoTrack(0); return track[\"getClips\"](0); }\n";
  const destructured = "export function read(track) { const { getClips } = track; return getClips.call(track, 0); }\n";
  const bracketMissing = undocumentedHostCalls([{ rel: "src/clips.ts", body: bracket }], DOCS, project);
  const callMissing = undocumentedHostCalls([{ rel: "src/clips.ts", body: destructured }], DOCS, project);
  assert.ok(bracketMissing.some((item) => item.includes("getClips")), bracketMissing.join(" | "));
  assert.ok(callMissing.some((item) => item.includes("getClips")), callMissing.join(" | "));
  const real = undocumentedHostCalls([{ rel: "src/clips.ts", body: "export async function list(sequence) { const track = await sequence.getVideoTrack(0); return track.getTrackItems(); }\n" }], DOCS, project);
  assert.equal(real.some((item) => item.includes("getTrackItems")), false, real.join(" | "));
  const claim = reviewClaim({
    contract: { goal: "Listen for a document change", docText: DOCS, projectPath: project, baseline: { files: {}, surface: "", fileSurfaces: {} } },
    files: ["src/main.tsx"],
    bodies: [main]
  });
  assert.equal(claim.ok, false, claim.say);
  assert.match(claim.say, /subscribeToEverything/);
  fs.rmSync(project, { recursive: true, force: true });
});

test("NS2 a helper called inside executeAsModal and a plain row.name are accepted", () => {
  const contract = { goal: "Rename the selected layer", docText: DOCS, baseline: { files: {}, surface: "", fileSurfaces: {} } };
  const helper = `export async function rename(app, core, layer, name) {
  void app.activeDocument;
  const setName = (l, n) => { l.name = n; };
  return core.executeAsModal(async () => { setName(layer, name); });
}
`;
  const rows = `export function list(app) {
  void app.activeDocument;
  const layer = app.activeDocument.activeLayers[0];
  const row = { id: layer.id };
  row.name = layer.name;
  return row;
}
`;
  const helperClaim = reviewClaim({ contract, files: ["src/layers.ts"], bodies: [helper] });
  const rowClaim = reviewClaim({ contract, files: ["src/layers.ts"], bodies: [rows] });
  assert.equal(/executeAsModal/.test(helperClaim.say || ""), false, helperClaim.say);
  assert.equal(/executeAsModal/.test(rowClaim.say || ""), false, rowClaim.say);
  const outside = `export async function rename(app, core, layer, name) {
  void app.activeDocument;
  const setName = (l, n) => { l.name = n; };
  setName(layer, name);
  return core.executeAsModal(async () => { setName(layer, "also"); });
}
`;
  const leaked = reviewClaim({ contract, files: ["src/layers.ts"], bodies: [outside] });
  assert.equal(leaked.ok, false, leaked.say);
  assert.match(leaked.say, /executeAsModal/);
});

test("NS3 a bracket rename, Reflect.set, and defineProperty outside the modal fail", () => {
  const contract = { goal: "Rename the selected layer", docText: DOCS, baseline: { files: {}, surface: "", fileSurfaces: {} } };
  const cases = [
    "export function rename(app, layer, name) { void app.activeDocument; layer['name'] = name; }\n",
    "export function rename(app, layer, name) { void app.activeDocument; Reflect.set(layer, \"name\", name); }\n",
    "export function rename(app, layer, name) { void app.activeDocument; Object.defineProperty(layer, \"name\", { value: name }); }\n"
  ];
  for (const body of cases) {
    const claim = reviewClaim({ contract, files: ["src/layers.ts"], bodies: [body] });
    assert.equal(claim.ok, false, body);
    assert.match(claim.say, /executeAsModal/);
  }
});

test("NS4 a failed refresh is asked again and then stops, and it does not say the docs step is done", async () => {
  const out = temp("uxp-ns4-");
  await run(["start", "--empty", temp("uxp-ns4-empty-"), "--out", out]);
  await run(["session", "mode", "--set", "dashboard", "--out", out]);
  const sessionPath = path.join(out, "session.json");
  const session = JSON.parse(fs.readFileSync(sessionPath, "utf8"));
  session.docs = { ok: false, fresh: [], stale: [], failed: ["manifest"], pages: [] };
  session.asks.push({ id: "docs-retry", nonce: "n1", status: "answered", answer: "refresh", options: [{ id: "refresh", label: "Refresh" }] });
  fs.writeFileSync(sessionPath, `${JSON.stringify(session, null, 2)}\n`);
  fs.appendFileSync(path.join(out, "answers.jsonl"), `${JSON.stringify({ type: "answer", askId: "docs-retry", nonce: "n1", value: "refresh" })}\n`);
  const first = await run(["session", "next", "--out", out]);
  assert.equal(first.action, "refresh", JSON.stringify(first));
  const recorded = applyDocsRefresh(out, { ok: false, fresh: [], stale: [], failed: ["manifest"], next: "Docs recorded (fresh 0, stale 0, failed 1). The docs step is done." });
  assert.match(recorded.next, /not done/);
  assert.equal(recorded.next.includes("The docs step is done"), false);
  const again = await run(["session", "next", "--out", out]);
  assert.equal(again.action, "ask", JSON.stringify(again));
  assert.equal(again.ask, "docs-retry");
  assert.equal(again.action === "refresh", false);
  fs.writeFileSync(path.join(out, "docs-retry-state.json"), `${JSON.stringify({ attempts: 3, appliedNonce: "n1" })}\n`);
  const bounded = await run(["session", "next", "--out", out]);
  assert.equal(bounded.action, "offline", JSON.stringify(bounded));
  assert.match(bounded.next, /not done/);
  assert.equal(bounded.next.includes("Run node scripts/skill.mjs refresh"), false);
  fs.rmSync(out, { recursive: true, force: true });
});

test("NS5 an added test script is listed on the approval card", () => {
  const project = temp("uxp-ns5-");
  fs.mkdirSync(path.join(project, "test"), { recursive: true });
  fs.writeFileSync(path.join(project, "test", "layers.test.mjs"), "import assert from \"node:assert/strict\";\n");
  const scripts = { test: "node --test test/layers.test.mjs", build: "node -e \"process.exit(0)\"", ccx: "node -e \"process.exit(0)\"" };
  fs.writeFileSync(path.join(project, "package.json"), `${JSON.stringify({ scripts })}\n`);
  const drift = commandChangeSet(project, { scripts: { test: "", build: scripts.build, ccx: scripts.ccx }, commandFiles: {}, files: {}, packaging: {} });
  assert.equal(drift.unresolved, "", drift.unresolved);
  const ask = scriptChangeAsk(drift);
  assert.match(ask.prompt, /test: node --test test\/layers\.test\.mjs/);
  assert.equal(ask.prompt.includes("commands before they run: none"), false);
  fs.rmSync(project, { recursive: true, force: true });
});

test("NS6 the chat approval next carries the user's choice and does not presume approve", async () => {
  const out = temp("uxp-ns6-");
  await run(["start", "--empty", temp("uxp-ns6-empty-"), "--out", out]);
  await run(["session", "mode", "--set", "chat", "--out", out]);
  fs.mkdirSync(path.join(out, "domain"), { recursive: true });
  fs.writeFileSync(path.join(out, "domain", "record-result.json"), `${JSON.stringify({ state: "script-change" })}\n`);
  fs.writeFileSync(path.join(out, "domain", "session.json"), `${JSON.stringify({ outcome: "script-change" })}\n`);
  const session = JSON.parse(fs.readFileSync(path.join(out, "session.json"), "utf8"));
  session.asks.push({ id: "script-change", nonce: "s1", status: "pending", title: "Approve", options: [{ id: "approve", label: "Run" }, { id: "stop", label: "Stop" }] });
  fs.writeFileSync(path.join(out, "session.json"), `${JSON.stringify(session, null, 2)}\n`);
  const next = await run(["session", "next", "--out", out]);
  assert.equal(next.action, "ask-in-chat", JSON.stringify(next));
  assert.match(next.next, /approve and stop/);
  assert.match(next.next, /the option the user chose/);
  assert.equal(next.next.includes("--value approve"), false);
  assert.equal(next.command.includes("--value approve"), false);
  fs.rmSync(out, { recursive: true, force: true });
});

test("NS7 a failing test keeps its output in the record reason", () => {
  const project = temp("uxp-ns7-");
  fs.mkdirSync(path.join(project, "test"), { recursive: true });
  fs.writeFileSync(path.join(project, "package.json"), `${JSON.stringify({ scripts: { test: "node --test test/title.test.mjs" } })}\n`);
  fs.writeFileSync(path.join(project, "test", "title.test.mjs"), `import assert from "node:assert/strict";
import { test } from "node:test";
test("title", () => { assert.equal(1, 2); });
`);
  const failed = runPackage(project, { only: ["test"] });
  assert.equal(failed.status, "failed");
  assert.match(failed.reason, /exited 1/);
  assert.match(failed.reason, /AssertionError|1 !== 2/);
  assert.match(failed.output, /1 !== 2|AssertionError/);
  fs.rmSync(project, { recursive: true, force: true });
});

test("NS8 create-bolt-uxp is pinned beside the skill, not at the project root", { timeout: 180000 }, () => {
  const install = temp("uxp-ns8-");
  const skillDir = path.join(install, ".agents", "skills", "uxp-assistant");
  fs.mkdirSync(skillDir, { recursive: true });
  const prefix = toolingPrefix(skillDir);
  assert.equal(prefix, path.join(install, ".agents", "skills", ".uxp-tooling"));
  assert.equal(prefix.endsWith(`${path.sep}.uxp-tooling`) && prefix.includes(`${path.sep}skills${path.sep}`), true);
  assert.notEqual(prefix, path.join(install, ".uxp-tooling"));
  // NQ11: the real install, npm ci of the shipped lock with npm by absolute path. A fake npm first on PATH must not run.
  const fakeBin = path.join(install, "fake-bin");
  const marker = path.join(install, "fake-npm-ran.txt");
  fs.mkdirSync(fakeBin, { recursive: true });
  fs.writeFileSync(path.join(fakeBin, "npm"), `#!/bin/sh\necho ran > "${marker}"\nexit 0\n`);
  fs.chmodSync(path.join(fakeBin, "npm"), 0o755);
  const savedPath = process.env.PATH;
  process.env.PATH = `${fakeBin}${path.delimiter}${savedPath}`;
  try {
    installTree(prefix);
  } finally {
    process.env.PATH = savedPath;
  }
  assert.equal(fs.existsSync(marker), false, "the npm on PATH ran");
  assert.deepEqual(verifyTree(path.join(prefix, "node_modules"), { fresh: true }), { ok: true });
  const pkg = JSON.parse(fs.readFileSync(path.join(prefix, "package.json"), "utf8"));
  assert.equal(pkg.dependencies["create-bolt-uxp"], "1.3.27");
  assert.equal(fs.readFileSync(path.join(prefix, ".gitignore"), "utf8").includes("*"), true);
  assert.equal(fs.existsSync(`${prefix}.lock`), false);
  fs.rmSync(install, { recursive: true, force: true });
});

test("NS9 pause is not stop, and stop does not say to keep the turn open", async () => {
  const paused = stageDecision({
    choice: (id) => (id === "feasibility" ? "pause" : ""),
    capability: { state: "docs-incomplete" },
    pages: [],
    behaviors: [],
    goal: "Rename",
    context: "panel"
  });
  const stopped = stageDecision({
    choice: (id) => (id === "feasibility" ? "stop" : ""),
    capability: { state: "docs-incomplete" },
    pages: [],
    behaviors: [],
    goal: "Rename",
    context: "panel"
  });
  assert.equal(paused.action, "pause");
  assert.equal(stopped.action, "stop");
  assert.equal(paused.action === stopped.action, false);
  const out = temp("uxp-ns9-");
  await run(["start", "--empty", temp("uxp-ns9-empty-"), "--out", out]);
  const sessionPath = path.join(out, "session.json");
  const write = (value) => {
    const session = JSON.parse(fs.readFileSync(sessionPath, "utf8"));
    session.asks = session.asks.filter((item) => item.id !== "docs-retry");
    session.asks.push({ id: "docs-retry", nonce: "p1", status: "answered", options: [{ id: "pause", label: "Pause" }, { id: "stop", label: "Stop" }] });
    session.docs = { ok: false, fresh: [], stale: [], failed: ["manifest"] };
    fs.writeFileSync(sessionPath, `${JSON.stringify(session, null, 2)}\n`);
    fs.writeFileSync(path.join(out, "answers.jsonl"), `${JSON.stringify({ type: "answer", askId: "docs-retry", nonce: "p1", value })}\n`);
  };
  write("pause");
  const pauseNext = await run(["session", "next", "--out", out]);
  write("stop");
  const stopNext = await run(["session", "next", "--out", out]);
  assert.equal(pauseNext.action, "pause", JSON.stringify(pauseNext));
  assert.equal(stopNext.action, "stop", JSON.stringify(stopNext));
  assert.match(pauseNext.next, /not finished/);
  assert.match(stopNext.next, /ends here/);
  assert.equal(String(stopNext.next).includes("Do not end your turn"), false);
  assert.equal(stopNext.neverStop, undefined);
  fs.rmSync(out, { recursive: true, force: true });
});

test("NS10 server-down recovery starts the dashboard with --no-open", async () => {
  const out = temp("uxp-ns10-");
  await run(["start", "--empty", temp("uxp-ns10-empty-"), "--out", out]);
  await run(["session", "mode", "--set", "dashboard", "--out", out]);
  const waited = await run(["session", "wait", "--id", "goal", "--out", out]);
  assert.match(waited.next || "", /dashboard start --no-open/);
  assert.equal(/dashboard start(?! --no-open)/.test(waited.next || ""), false);
  fs.rmSync(out, { recursive: true, force: true });
});

test("NS11 Chrome temp files and the ccx staging directory are removed", () => {
  const dir = temp("uxp-ns11-");
  const before = snapshotTemps(dir);
  fs.mkdirSync(path.join(dir, "com.google.Chrome.ns11"));
  fs.writeFileSync(path.join(dir, ".com.google.Chrome.ns11"), "x");
  fs.mkdirSync(path.join(dir, "ccx"));
  fs.writeFileSync(path.join(dir, "ccx", "stage.txt"), "bolt");
  fs.mkdirSync(path.join(dir, "node-compile-cache"));
  const removed = sweepOwnedTemps(before, dir);
  assert.ok(removed.includes("com.google.Chrome.ns11"));
  assert.ok(removed.includes("ccx"));
  assert.equal(fs.existsSync(path.join(dir, "com.google.Chrome.ns11")), false);
  assert.equal(fs.existsSync(path.join(dir, "ccx")), false);
  assert.equal(fs.existsSync(path.join(dir, "node-compile-cache")), true);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("NS12 a boilerplate refresh with one failed page exits 0 and names the pages", async () => {
  const dir = temp("uxp-ns12-");
  const ext = path.join(dir, "extension.mjs");
  const out = path.join(dir, "session");
  fs.writeFileSync(ext, `export default {
  id: "ns12",
  title: "NS12",
  steps: [{ id: "prepare", label: "Prepare" }, { id: "docs", label: "Docs" }, { id: "done", label: "Done" }],
  docs: { everyInvocation: true, pageTimeoutMs: 400, budgetMs: 1000 },
  prepare() { return { name: "NS12", path: "/tmp/ns12" }; },
  questions() { return []; },
  sources() { return [{ id: "missing", url: "http://127.0.0.1:9/missing" }]; }
};
`);
  const bins = {
    sessionBin: "node scripts/session.mjs",
    dashboardBin: "node scripts/dashboard.mjs",
    refreshBin: "node scripts/refresh.mjs",
    homeDirName: ".skill-boilerplate"
  };
  try {
    await start({ extensionPath: ext, out, input: "/tmp/ns12", ...bins });
    const { refresh, session } = await import("../.claude/skills/uxp-assistant/scripts/runtime/api.mjs");
    await session(["mode", "--set", "chat", "--out", out], { extensionPath: ext, out, ...bins });
    const script = path.join(root, ".claude/skills/uxp-assistant/scripts/runtime/refresh.mjs");
    const child = spawnSync(process.execPath, [script, "--out", out, "--extension", ext], { encoding: "utf8", timeout: 20000 });
    assert.equal(child.status, 0, child.stdout + child.stderr);
    const body = JSON.parse(child.stdout);
    assert.equal(refreshExitCode(body), 0);
    assert.ok(body.failed.includes("missing"), JSON.stringify(body));
    assert.match(body.next, /not done/);
    assert.equal(body.next.includes("The docs step is done"), false);
    const mixedExt = path.join(dir, "mixed.mjs");
    fs.writeFileSync(mixedExt, `export default {
  id: "ns12m",
  title: "NS12 mixed",
  steps: [{ id: "prepare", label: "Prepare" }, { id: "docs", label: "Docs" }, { id: "done", label: "Done" }],
  docs: { everyInvocation: true },
  prepare() { return { name: "NS12", path: "/tmp/ns12" }; },
  questions() { return []; },
  sources() { return [
    { id: "kept", url: "http://127.0.0.1/kept" },
    { id: "missing", url: "http://127.0.0.1/missing" }
  ]; }
};
`);
    const mixed = await refresh({
      extensionPath: mixedExt,
      out,
      ...bins,
      fetchImpl: async (url) => {
        if (String(url).includes("missing")) throw new Error("offline");
        return { ok: true, status: 200, text: async () => "<p>Before&#x3C;br />After</p>" };
      }
    });
    assert.equal(refreshExitCode(mixed), 0);
    assert.ok(mixed.fresh.includes("kept"), JSON.stringify(mixed));
    assert.ok(mixed.failed.includes("missing"), JSON.stringify(mixed));
    assert.match(mixed.next, /not done/);
    const page = fs.readFileSync(path.join(out, "docs", "kept.txt"), "utf8");
    assert.equal(page.includes("&#x3C;"), false);
    assert.match(page, /Before/);
    assert.match(page, /After/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("NS13 fetched HTML entities are decoded before the docs text is stored", async () => {
  assert.equal(htmlToText("<p>Before&#x3C;br />After</p>").includes("&#x3C;"), false);
  assert.match(htmlToText("<p>Before&#x3C;br />After</p>"), /Before/);
  const target = temp("uxp-ns13-");
  await refreshSources(target, [{ id: "page", url: "https://example.test/page" }], {
    fetchImpl: async () => ({ ok: true, status: 200, text: async () => "<p>Layer&#x3C;br />name</p>" })
  });
  const text = fs.readFileSync(path.join(target, "page.txt"), "utf8");
  assert.equal(text.includes("&#x"), false);
  assert.match(text, /Layer/);
  assert.match(text, /name/);
  fs.rmSync(target, { recursive: true, force: true });
});

test("NR6 Array.isArray and Object.keys length checks are not feature tests", () => {
  const project = temp("uxp-nr6b-");
  fs.mkdirSync(path.join(project, "src"), { recursive: true });
  fs.mkdirSync(path.join(project, "test"), { recursive: true });
  fs.writeFileSync(path.join(project, "package.json"), `${JSON.stringify({ scripts: { test: "node --test" } })}\n`);
  fs.writeFileSync(path.join(project, "src", "layers.mjs"), "export function listLayers(app) { return app.activeDocument ? [] : []; }\n");
  const write = (body) => fs.writeFileSync(path.join(project, "test", "layers.test.mjs"), body);
  write(`import assert from "node:assert/strict";
import { test } from "node:test";
import { listLayers } from "../src/layers.mjs";
test("array", () => { assert.ok(Array.isArray(listLayers({ app: { activeDocument: null } }))); });
`);
  const arrayOnly = testsCoverFeature(project, [], ["activeDocument"], ["src/layers.mjs"]);
  assert.equal(arrayOnly.ok, false, arrayOnly.say);
  write(`import assert from "node:assert/strict";
import { test } from "node:test";
import * as m from "../src/layers.mjs";
test("keys", () => { assert.ok(Object.keys(m).length > 0); });
`);
  const keysOnly = testsCoverFeature(project, [], ["activeDocument"], ["src/layers.mjs"]);
  assert.equal(keysOnly.ok, false, keysOnly.say);
  write(`import assert from "node:assert/strict";
import { test } from "node:test";
import { listLayers } from "../src/layers.mjs";
test("empty without a document", () => { assert.equal(listLayers({ app: { activeDocument: null } }).length, 0); });
`);
  const nullOnly = testsCoverFeature(project, [], ["activeDocument"], ["src/layers.mjs"]);
  assert.equal(nullOnly.ok, false, nullOnly.say);
  write(`import assert from "node:assert/strict";
import { test } from "node:test";
import { listLayers } from "../src/layers.mjs";
test("reads a layer", () => { assert.equal(listLayers({ app: { activeDocument: { title: "Poster" } } })[0], "Poster"); });
`);
  const real = testsCoverFeature(project, [], ["activeDocument"], ["src/layers.mjs"]);
  assert.equal(real.ok, true, real.say);
  fs.rmSync(project, { recursive: true, force: true });
});

test("NR7 static error text is not a live status", () => {
  const decoy = `export function Panel(){
    return <button disabled={true} onClick={() => {}}><sp-body>Error codes are listed in the docs.</sp-body></button>;
  }`;
  assert.equal(showsHonestUiState(decoy), false);
  assert.equal(showsHonestUiState("export function Panel(){ return <sp-body>Error codes are listed in the docs.</sp-body>; }"), false);
  const live = `export function Panel(){
    const [status, setStatus] = useState("Waiting for Photoshop…");
    const [busy, setBusy] = useState(false);
    async function read(){ setBusy(true); try { setStatus(await title()); } catch (e) { setStatus(String(e)); } finally { setBusy(false); } }
    return <button disabled={busy} onClick={read}>{status}</button>;
  }`;
  assert.equal(showsHonestUiState(live), true);
  const once = `export function Panel(){
    const [status, setStatus] = useState("Waiting for Photoshop…");
    return <button disabled={!status} onClick={() => setStatus("Ready")}>{status}</button>;
  }`;
  assert.equal(showsHonestUiState(once), false, "NT8: a disabled binding on a state set once to a constant is not a busy state");
  const claim = reviewClaim({
    contract: { goal: "Show the document title", docText: "activeDocument title string", baseline: { files: {}, surface: "", fileSurfaces: {} } },
    files: ["src/title.ts", "src/Panel.tsx"],
    bodies: [
      "export function read(app) { return app.activeDocument.title; }\n",
      decoy
    ]
  });
  assert.equal(claim.ok, false, claim.say);
  assert.match(claim.say, /state variable|Static text/);
});
