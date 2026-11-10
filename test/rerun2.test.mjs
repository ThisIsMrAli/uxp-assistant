import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { docsRetryAsk, scriptChangeAsk } from "../.claude/skills/uxp-assistant/scripts/lib/ask.mjs";
import { pagesForRequest } from "../.claude/skills/uxp-assistant/scripts/lib/registry.mjs";
import { reviewClaim, showsHonestUiState, testsCoverFeature, undocumentedHostCalls } from "../.claude/skills/uxp-assistant/scripts/lib/review.mjs";
import { run } from "../.claude/skills/uxp-assistant/scripts/skill.mjs";
import extension from "../.claude/skills/uxp-assistant/extension.mjs";
import { nextAction } from "../.claude/skills/uxp-assistant/scripts/runtime/lib/next.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DOCS = `
getVideoTrack
Returns: Promise<VideoTrack>
VideoTrack
getTrackItems
Returns: Array
getActiveProject
Returns: Promise<Project>
Project
getActiveSequence
Returns: Promise<Sequence>
executeAsModal
Returns: Promise
`;

function temp(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), name));
}

test("NR4 a chained call to a missing method fails, and the documented chain does not", () => {
  const chain = "export async function list(sequence) { return (await sequence.getVideoTrack(0)).getClips(); }\n";
  const missing = undocumentedHostCalls([{ rel: "src/clips.ts", body: chain }], DOCS);
  assert.ok(missing.some((item) => item.includes("getClips")), missing.join(" | "));
  const invented = undocumentedHostCalls([{ rel: "src/clips.ts", body: "export function open(ppro) { return ppro.Project.openActiveProjectNow(); }\n" }], DOCS);
  assert.ok(invented.some((item) => item.includes("openActiveProjectNow")), invented.join(" | "));
  const action = undocumentedHostCalls([{ rel: "src/listen.ts", body: "export function listen(photoshop) { return photoshop.action.subscribeToEverything(() => {}); }\n" }], DOCS);
  assert.ok(action.some((item) => item.includes("subscribeToEverything")), action.join(" | "));
  const real = undocumentedHostCalls([{ rel: "src/clips.ts", body: "export async function list(sequence) { const track = await sequence.getVideoTrack(0); return track.getTrackItems(); }\n" }], DOCS);
  assert.equal(real.some((item) => item.includes("getTrackItems")), false, real.join(" | "));
});

test("NR5 a rename through an alias, an index, Object.assign, or a fake modal fails", () => {
  const contract = { goal: "Rename the selected layer", docText: "executeAsModal activeDocument" };
  const cases = [
    "export function rename(app, layer, name) { const target = layer; void app.activeDocument; target.name = name; }\n",
    "export function rename(app, active, name) { void app.activeDocument; active[0].name = name; }\n",
    "export function rename(app, layer, name) { void app.activeDocument; Object.assign(layer, { name }); }\n",
    "export function rename(app, layer, name) { void app.activeDocument; const executeAsModal = (fn) => fn(); return executeAsModal(() => { layer.name = name; }); }\n"
  ];
  for (const body of cases) {
    const claim = reviewClaim({ contract, files: ["src/layers.ts"], bodies: [body] });
    assert.equal(claim.ok, false, body);
    assert.match(claim.say, /executeAsModal/);
  }
  const inside = reviewClaim({
    contract,
    files: ["src/layers.ts"],
    bodies: ["export async function rename(app, core, layer, name) { void app.activeDocument; return core.executeAsModal(async () => { const target = layer; target.name = name; }); }\n"]
  });
  assert.equal(/executeAsModal/.test(inside.say || ""), false, inside.say);
});

test("NR6 a typeof function check is not a feature test", () => {
  const project = temp("uxp-nr6-");
  fs.mkdirSync(path.join(project, "src"), { recursive: true });
  fs.mkdirSync(path.join(project, "test"), { recursive: true });
  fs.writeFileSync(path.join(project, "package.json"), `${JSON.stringify({ scripts: { test: "node --test" } })}\n`);
  fs.writeFileSync(path.join(project, "src", "read.mjs"), "export function read(app) { return app.activeDocument.title; }\n");
  fs.writeFileSync(path.join(project, "test", "read.test.mjs"), `import assert from "node:assert/strict";
import { test } from "node:test";
import { read } from "../src/read.mjs";
test("exists", () => { assert.equal(typeof read, "function"); });
`);
  const smoke = testsCoverFeature(project, [], ["activeDocument"], ["src/read.mjs"]);
  assert.equal(smoke.ok, false);
  assert.match(smoke.say, /typeof/);
  fs.writeFileSync(path.join(project, "test", "read.test.mjs"), `import assert from "node:assert/strict";
import { test } from "node:test";
import { read } from "../src/read.mjs";
test("reads the title", () => { assert.equal(read({ activeDocument: { title: "Poster" } }), "Poster"); });
`);
  const real = testsCoverFeature(project, [], ["activeDocument"], ["src/read.mjs"]);
  assert.equal(real.ok, true, real.say);
  fs.rmSync(project, { recursive: true, force: true });
});

test("NR7 static error text fails and a rendered state variable passes", () => {
  assert.equal(showsHonestUiState("export function Panel(){ return <sp-body>Error codes are listed in the docs.</sp-body>; }"), false);
  const honest = `export function Panel(){
    const [msg, setMsg] = useState("");
    function onRead(){ try { setMsg(read()); } catch (e) { setMsg(String(e)); } }
    return <button onClick={onRead}>{msg || "No open document."}</button>;
  }`;
  assert.equal(showsHonestUiState(honest), true);
  const anyState = `export function Panel(){
    const [msg, setMsg] = useState("");
    function onRead(){ setMsg("No open document."); }
    return <button onClick={onRead}>{msg || "No open document."}</button>;
  }`;
  assert.equal(showsHonestUiState(anyState), false, "NT8: any rendered useState no longer counts");
});

test("NR8 a temp directory created with the preload is gone after the process exits", () => {
  const parent = temp("uxp-nr8-parent-");
  const child = spawnSync(process.execPath, ["--import", path.join(root, "test/preload.mjs"), "--input-type=module", "-e", `
    import fs from "node:fs";
    import os from "node:os";
    import path from "node:path";
    fs.mkdtempSync(path.join(os.tmpdir(), "uxp-nr8-leak-"));
    fs.mkdirSync(path.join(os.tmpdir(), "uxp-stacks-leak"), { recursive: true });
    fs.writeFileSync(path.join(os.tmpdir(), "uxp-stacks-leak", "keep.txt"), "x");
  `], { encoding: "utf8", env: { ...process.env, TMPDIR: parent } });
  assert.equal(child.status, 0, child.stderr);
  const left = fs.readdirSync(parent);
  fs.rmSync(parent, { recursive: true, force: true });
  assert.deepEqual(left.filter((name) => name.startsWith("uxp-nr8-leak")), []);
});

test("NR12 the approval question shows the command", () => {
  const ask = scriptChangeAsk({
    changes: [
      { kind: "command", name: "test", to: "node --test test/layers.test.mjs" },
      { kind: "file", name: "src/layers.ts", to: "abc" }
    ]
  });
  assert.match(ask.prompt, /node --test test\/layers\.test\.mjs/);
  assert.equal(ask.prompt.includes("not printed"), false);
  assert.match(ask.options[0].detail, /command text/);
});

test("NR16 Photoshop action and Premiere constants are fetched", () => {
  const ps = pagesForRequest({ host: "phxs", goal: "Listen for a layer change" });
  assert.ok(ps.some((page) => page.id === "photoshop.action"));
  const pp = pagesForRequest({ host: "ppro", goal: "List clips" });
  assert.ok(pp.some((page) => page.id === "premiere.constants" && page.url.includes("constants")));
});

test("NR3 a failed fetch offers refresh and next runs refresh", async () => {
  const out = temp("uxp-nr3-");
  const questions = extension.questionsAfterDocs({ asks: [], docs: { pages: [] } }, out);
  assert.equal(questions.length, 1);
  assert.equal(questions[0].id, "docs-retry");
  assert.equal(questions[0].options[0].id, "refresh");
  assert.match(questions[0].options[0].label, /Recommended/);
  const started = await run(["start", "--empty", temp("uxp-nr3-empty-"), "--out", out]);
  assert.equal(started.ok, true, JSON.stringify(started));
  await run(["session", "mode", "--set", "dashboard", "--out", out]);
  const sessionPath = path.join(out, "session.json");
  const session = JSON.parse(fs.readFileSync(sessionPath, "utf8"));
  session.docs = { ok: false, fresh: [], stale: [], failed: ["manifest"], pages: [] };
  session.asks.push({
    id: "docs-retry",
    nonce: "n1",
    status: "answered",
    answer: "refresh",
    title: docsRetryAsk().title,
    options: docsRetryAsk().options
  });
  fs.writeFileSync(sessionPath, `${JSON.stringify(session, null, 2)}\n`);
  fs.appendFileSync(path.join(out, "answers.jsonl"), `${JSON.stringify({ type: "answer", askId: "docs-retry", nonce: "n1", value: "refresh" })}\n`);
  const next = await run(["session", "next", "--out", out]);
  assert.equal(next.action, "refresh", JSON.stringify(next));
  assert.match(next.next, /refresh/);
  assert.equal(next.action === "domain", false);
  fs.rmSync(out, { recursive: true, force: true });
});

test("NR2 chat mode asks the script-change question in chat", async () => {
  const out = temp("uxp-nr2-");
  await run(["start", "--empty", temp("uxp-nr2-empty-"), "--out", out]);
  await run(["session", "mode", "--set", "chat", "--out", out]);
  fs.mkdirSync(path.join(out, "domain"), { recursive: true });
  fs.writeFileSync(path.join(out, "domain", "record-result.json"), `${JSON.stringify({ state: "script-change" })}\n`);
  fs.writeFileSync(path.join(out, "domain", "session.json"), `${JSON.stringify({ outcome: "script-change", asks: [{ id: "script-change", nonce: "s1", status: "pending" }] })}\n`);
  const session = JSON.parse(fs.readFileSync(path.join(out, "session.json"), "utf8"));
  session.asks.push({ id: "script-change", nonce: "s1", status: "pending", title: "Approve", options: [{ id: "approve", label: "Run" }] });
  fs.writeFileSync(path.join(out, "session.json"), `${JSON.stringify(session, null, 2)}\n`);
  const next = await run(["session", "next", "--out", out]);
  assert.equal(next.action, "ask-in-chat", JSON.stringify(next));
  assert.match(next.next, /AskQuestion/);
  assert.match(next.next, /session answer --id script-change/);
  assert.equal(next.next.includes("on the dashboard"), false);
  fs.rmSync(out, { recursive: true, force: true });
});

test("NR9 a record error includes a next line", async () => {
  const out = temp("uxp-nr9-");
  await run(["start", "--empty", temp("uxp-nr9-empty-"), "--out", out]);
  const recorded = await run(["record", "--out", out]);
  assert.equal(recorded.ok, false);
  assert.match(recorded.next || "", /record --out/);
  fs.rmSync(out, { recursive: true, force: true });
});

test("NR11 dashboard start answers on loopback when the proxy is set", () => {
  const out = temp("uxp-nr11-");
  const home = temp("uxp-nr11-home-");
  const skill = path.join(root, ".claude/skills/uxp-assistant/scripts/skill.mjs");
  const env = {
    ...process.env,
    HOME: home,
    SKILL_TEST_HOME: home,
    HTTPS_PROXY: "http://127.0.0.1:9",
    HTTP_PROXY: "http://127.0.0.1:9",
    NODE_USE_ENV_PROXY: "1"
  };
  delete env.NO_PROXY;
  delete env.no_proxy;
  const call = (args) => spawnSync(process.execPath, [skill, ...args], { cwd: root, encoding: "utf8", env, timeout: 30000 });
  try {
    const startedSession = call(["start", "--empty", temp("uxp-nr11-empty-"), "--out", out]);
    assert.equal(startedSession.status, 0, startedSession.stdout + startedSession.stderr);
    call(["session", "mode", "--set", "dashboard", "--out", out]);
    const started = call(["dashboard", "start", "--no-open", "--out", out]);
    const body = JSON.parse((started.stdout || "").trim().split("\n").filter(Boolean).at(-1) || "{}");
    assert.equal(body.ok, true, started.stdout + started.stderr);
    call(["dashboard", "stop", "--out", out]);
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("NR15 the printed done command has a real summary", () => {
  const out = temp("uxp-nr15-");
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, "session.json"), `${JSON.stringify({
    mode: "chat",
    asks: [],
    steps: [{ id: "prepare", status: "done" }, { id: "done", status: "pending" }]
  })}\n`);
  fs.writeFileSync(path.join(out, "questions.json"), "[]\n");
  const next = nextAction(out, { dashboardUp: false });
  assert.equal(next.command.includes("<one short paragraph>"), false, next.command);
  assert.match(next.command, /NOT TESTED/);
  fs.rmSync(out, { recursive: true, force: true });
});

test("NR1 the advertised skills install can scaffold and finish", { timeout: 600000 }, () => {
  const into = temp("uxp-nr1-into-");
  const added = spawnSync("npx", ["--yes", "skills", "add", root, "--skill", "uxp-assistant", "-a", "cursor", "-y"], {
    cwd: into,
    encoding: "utf8",
    timeout: 90000
  });
  assert.equal(added.status, 0, `${added.stdout}\n${added.stderr}`);
  const skill = path.join(into, ".agents", "skills", "uxp-assistant");
  const home = temp("uxp-nr1-home-");
  const session = temp("uxp-nr1-session-");
  const folder = temp("uxp-nr1-empty-");
  const env = {
    ...process.env,
    HOME: home,
    SKILL_TEST_HOME: home,
    SKILL_DOC_FIXTURE: "layerComps is the list of layer comps. app.activeDocument title executeAsModal HTMLWebViewElement panel manifest"
  };
  const runSkill = (args) => {
    const result = spawnSync(process.execPath, ["scripts/skill.mjs", ...args], { cwd: skill, encoding: "utf8", env, timeout: 180000 });
    const line = (result.stdout || "").trim().split("\n").filter(Boolean).at(-1) || "";
    let json = {};
    try { json = JSON.parse(line); } catch { json = { raw: result.stdout, err: result.stderr, status: result.status }; }
    return { status: result.status, json, stdout: result.stdout, stderr: result.stderr };
  };
  const started = runSkill(["start", "--empty", folder, "--out", session]);
  assert.equal(started.json.ok, true, started.stdout + started.stderr);
  runSkill(["session", "mode", "--set", "chat", "--out", session]);
  const answers = {
    goal: "Show the document title",
    host: "phxs",
    framework: "react",
    context: "panel",
    name: "Title",
    id: "com.example.title",
    permissions: "none",
    feasibility: "continue",
    runtime: "native",
    design: "uxp-constraints",
    validation: "commands",
    "narrow-permissions": "narrow",
    consequential: "proceed"
  };
  for (let i = 0; i < 20; i += 1) {
    const next = runSkill(["session", "next", "--out", session]);
    if (next.json.action === "ask" || next.json.action === "ask-in-chat") {
      const value = answers[next.json.ask];
      assert.ok(value, JSON.stringify(next.json));
      runSkill(["session", "answer", "--id", next.json.ask, "--value", value, "--out", session]);
      continue;
    }
    if (next.json.action === "refresh") {
      const refreshed = runSkill(["refresh", "--out", session]);
      assert.equal(refreshed.status, 0, refreshed.stdout + refreshed.stderr);
      continue;
    }
    if (next.json.action === "domain") break;
    if (next.json.action === "start-dashboard") continue;
  }
  const handed = runSkill(["domain", "--out", session]);
  assert.equal(handed.status, 0, handed.stdout + handed.stderr);
  assert.equal(handed.json.state, "awaiting-agent-implementation", handed.stdout + handed.stderr);
  assert.equal(String(handed.json.error || "").includes("create-bolt-uxp was not found"), false, handed.stdout);
  const project = handed.json.project;
  assert.ok(project && fs.existsSync(path.join(project, "package.json")), handed.stdout);
  fs.mkdirSync(path.join(project, "src"), { recursive: true });
  fs.mkdirSync(path.join(project, "test"), { recursive: true });
  fs.writeFileSync(path.join(project, "src", "read-title.mjs"), "export function readTitle(app) { if (!app || !app.activeDocument) return { ok: false, title: \"\" }; return { ok: true, title: app.activeDocument.title + (app.layerComps ? \":yes\" : \":no\") }; }\n");
  fs.writeFileSync(path.join(project, "src", "TitlePanel.tsx"), "export function TitlePanel(){ const [phase, setPhase] = useState(\"waiting\"); return <button disabled={phase === \"reading\"} onClick={() => { setPhase(\"reading\"); try { setPhase(\"ready\"); } catch (e) { setPhase(String(e)); } }}>{phase}</button>; }\n");
  fs.writeFileSync(path.join(project, "test", "read-title.test.mjs"), `import assert from "node:assert/strict";
import { test } from "node:test";
import { readTitle } from "../src/read-title.mjs";
test("reads a title", () => { assert.equal(readTitle({ activeDocument: { title: "Poster" } }).title, "Poster:no"); });
`);
  const pkgPath = path.join(project, "package.json");
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  pkg.scripts = pkg.scripts || {};
  pkg.scripts.test = "node --test";
  fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
  const mainPath = path.join(project, "src", "main.tsx");
  const mainText = fs.readFileSync(mainPath, "utf8");
  if (!mainText.includes("read-title")) {
    let imported = `import { readTitle } from "./read-title.mjs";\n${mainText}`;
    imported = imported.includes("<main>")
      ? imported.replace("<main>", "<main>{readTitle(uxp).title}")
      : imported.replace("return (", "return ( <span>{readTitle(uxp).title}</span>");
    fs.writeFileSync(mainPath, imported);
  }
  const files = ["src/read-title.mjs", "src/TitlePanel.tsx", "test/read-title.test.mjs", "package.json", "src/main.tsx"];
  const listed = files.map((rel) => ({
    path: rel,
    sha256: crypto.createHash("sha256").update(fs.readFileSync(path.join(project, rel))).digest("hex")
  }));
  fs.writeFileSync(path.join(session, "agent-result.json"), `${JSON.stringify({ goal: answers.goal, files: listed }, null, 2)}\n`);
  const install = spawnSync("npm", ["install", "--no-audit", "--no-fund"], { cwd: project, encoding: "utf8", timeout: 180000 });
  assert.equal(install.status, 0, install.stderr);
  let recorded = runSkill(["record", "--out", session]);
  if (recorded.json.state === "script-change") {
    runSkill(["session", "answer", "--id", "script-change", "--value", "approve", "--out", session]);
    const again = files.map((rel) => ({
      path: rel,
      sha256: crypto.createHash("sha256").update(fs.readFileSync(path.join(project, rel))).digest("hex")
    }));
    fs.writeFileSync(path.join(session, "agent-result.json"), `${JSON.stringify({ goal: answers.goal, files: again }, null, 2)}\n`);
    recorded = runSkill(["record", "--out", session]);
  }
  assert.equal(recorded.json.state, "commands-finished", `${recorded.stdout}\n${recorded.stderr}`);
  const finished = runSkill(["session", "next", "--out", session]);
  assert.equal(finished.json.action, "finished", JSON.stringify(finished.json));
  fs.rmSync(into, { recursive: true, force: true });
  fs.rmSync(home, { recursive: true, force: true });
  fs.rmSync(session, { recursive: true, force: true });
  fs.rmSync(folder, { recursive: true, force: true });
});

test("NR14 a stopped dashboard tells the agent to start it again", async () => {
  const out = temp("uxp-nr14-");
  await run(["start", "--empty", temp("uxp-nr14-empty-"), "--out", out]);
  await run(["session", "mode", "--set", "dashboard", "--out", out]);
  const waited = await run(["session", "wait", "--id", "goal", "--timeout", "1", "--out", out]);
  assert.match(waited.next || waited.say || "", /dashboard start/);
  assert.equal(String(waited.next || "").includes("Ask this in chat with AskQuestion"), false);
  fs.rmSync(out, { recursive: true, force: true });
});

test("NR10 a failed refresh exits 0 and prints the next command", () => {
  const out = temp("uxp-nr10-");
  const home = temp("uxp-nr10-home-");
  const skill = path.join(root, ".claude/skills/uxp-assistant/scripts/skill.mjs");
  const env = {
    ...process.env,
    HOME: home,
    SKILL_TEST_HOME: home,
    HTTPS_PROXY: "http://127.0.0.1:9",
    HTTP_PROXY: "http://127.0.0.1:9",
    NODE_USE_ENV_PROXY: "1",
    NO_PROXY: "127.0.0.1,localhost"
  };
  const call = (args) => spawnSync(process.execPath, [skill, ...args], { cwd: root, encoding: "utf8", env, timeout: 40000 });
  try {
    const started = call(["start", "--empty", temp("uxp-nr10-empty-"), "--out", out]);
    assert.equal(started.status, 0, started.stdout + started.stderr);
    call(["session", "mode", "--set", "chat", "--out", out]);
    const refreshed = call(["refresh", "--out", out]);
    const body = JSON.parse((refreshed.stdout || "").trim().split("\n").filter(Boolean).at(-1) || "{}");
    assert.equal(refreshed.status, 0, refreshed.stdout + refreshed.stderr);
    assert.ok(Array.isArray(body.failed) && body.failed.length > 0, JSON.stringify(body));
    assert.match(body.next || "", /next/);
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
});
