import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { scriptChangeAsk } from "../.claude/skills/uxp-assistant/scripts/lib/ask.mjs";
import { hostCallFindings, renameFindings } from "../.claude/skills/uxp-assistant/scripts/lib/host-flow.mjs";
import { commandChangeSet, reviewClaim, reviewCommandProvenance, showsHonestUiState, testsCoverFeature } from "../.claude/skills/uxp-assistant/scripts/lib/review.mjs";
import { linkTree, repoModules, fakeCiScript } from "./fixtures/tooling-tree.mjs";
import { INSTALLER_VERSION, ensureInstaller, installerEntry, installerRoots, verifyInstaller } from "../.claude/skills/uxp-assistant/scripts/lib/scaffold.mjs";
import { answerFromChat, emptySession, publishAsk, readMerged } from "../.claude/skills/uxp-assistant/scripts/lib/session.mjs";
import { strongAssertions } from "../.claude/skills/uxp-assistant/scripts/lib/test-strength.mjs";
import { readScriptGrant, scriptChangeDecision } from "../.claude/skills/uxp-assistant/scripts/lib/workflow.mjs";
import { dashboardActivity, domainDocsNext, specialize } from "../.claude/skills/uxp-assistant/scripts/skill.mjs";
import { DOCS_RERUN5, GLOBALS } from "./fixtures/host-corpus-rerun5.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const globals = { rel: "src/globals.ts", body: GLOBALS };

function temp(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), name));
}

const sha = (text) => crypto.createHash("sha256").update(text).digest("hex");

const VUE_HONEST = `<template>
  <main>
    <p v-if="error" class="error">{{ error }}</p>
    <p v-else-if="!info">Loading…</p>
    <dl v-else><dt>Title</dt><dd>{{ info.title }}</dd></dl>
    <sp-button :disabled="busy" @click="refresh">Refresh</sp-button>
  </main>
</template>
<script setup lang="ts">
import { ref, onMounted } from "vue";
import { photoshop } from "./globals";
const error = ref("");
const busy = ref(false);
const info = ref<{ title: string } | null>(null);
function refresh() {
  busy.value = true;
  try {
    error.value = "";
    info.value = { title: photoshop.app.activeDocument?.title ?? "" };
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    busy.value = false;
  }
}
onMounted(refresh);
</script>
`;

const SVELTE_HONEST = `<script lang="ts">
  import { photoshop } from "./globals";
  let error = "";
  let busy = false;
  async function rename(name: string) {
    busy = true;
    try {
      await photoshop.core.executeAsModal(async () => { photoshop.app.activeDocument.activeLayers[0].name = name; }, { commandName: "Rename" });
    } catch (e) {
      error = String(e);
    }
    busy = false;
  }
</script>
{#if error}<p class="error">{error}</p>{/if}
<button disabled={busy} on:click={() => rename("Hero")}>Rename</button>
`;

test("NU4 Vue and Svelte panels with an error or busy state pass, and the same panels without one do not", () => {
  assert.equal(showsHonestUiState(VUE_HONEST, "src/main.vue"), true);
  assert.equal(showsHonestUiState(SVELTE_HONEST, "src/App.svelte"), true);
  const vueDead = VUE_HONEST.replace('<p v-if="error" class="error">{{ error }}</p>', '<p v-if="false" class="error">{{ error }}</p>').replace('<p v-else-if="!info">Loading…</p>', "").replace(':disabled="busy"', "");
  assert.equal(showsHonestUiState(vueDead, "src/main.vue"), false);
  const svelteStatic = SVELTE_HONEST.replace("{#if error}<p class=\"error\">{error}</p>{/if}", "<p>Error: rename failed</p>").replace("disabled={busy}", "");
  assert.equal(showsHonestUiState(svelteStatic, "src/App.svelte"), false);
});

test("NU5 .vue and .svelte files are host and rename checked, in script and template", () => {
  const vueFake = VUE_HONEST.replace("info.value = {", "photoshop.action.subscribeToEverything();\n    info.value = {");
  assert.match(hostCallFindings([globals, { rel: "src/main.vue", body: vueFake }], DOCS_RERUN5).join(" "), /subscribeToEverything/);
  const templateFake = VUE_HONEST.replace("{{ info.title }}", "{{ photoshop.app.activeDocument.fakeTitle() }}").replace('import { ref, onMounted } from "vue";', 'import { ref, onMounted } from "vue";');
  assert.match(hostCallFindings([globals, { rel: "src/main.vue", body: templateFake }], DOCS_RERUN5).join(" "), /fakeTitle/);
  assert.deepEqual(hostCallFindings([globals, { rel: "src/main.vue", body: VUE_HONEST }], DOCS_RERUN5), []);
  assert.deepEqual(renameFindings([globals, { rel: "src/App.svelte", body: SVELTE_HONEST }], DOCS_RERUN5), []);
  const unresolved = SVELTE_HONEST.replace('"./globals"', '"../missing-globals"');
  assert.match(renameFindings([globals, { rel: "src/App.svelte", body: unresolved }], DOCS_RERUN5).join(" "), /did not resolve/);
  const outside = SVELTE_HONEST.replace('await photoshop.core.executeAsModal(async () => { photoshop.app.activeDocument.activeLayers[0].name = name; }, { commandName: "Rename" });', "photoshop.app.activeDocument.activeLayers[0].name = name;");
  assert.match(renameFindings([globals, { rel: "src/App.svelte", body: outside }], DOCS_RERUN5).join(" "), /outside executeAsModal/);
});

function claimProject(extra = {}) {
  const project = temp("uxp-nu6-");
  fs.mkdirSync(path.join(project, "src"), { recursive: true });
  fs.writeFileSync(path.join(project, "src", "globals.ts"), GLOBALS);
  const feature = "import { photoshop } from \"./globals\";\nexport function readTitle(){ return photoshop.app.activeDocument.title; }\n";
  const panel = "export function Panel(){ const [msg, setMsg] = useState(\"\"); const go = () => { try { setMsg(readTitle()); } catch (e) { setMsg(String(e)); } }; return <button onClick={go}>{msg}</button>; }\n";
  fs.writeFileSync(path.join(project, "src", "title.ts"), feature);
  fs.writeFileSync(path.join(project, "src", "Panel.tsx"), panel);
  for (const [rel, body] of Object.entries(extra)) {
    fs.mkdirSync(path.dirname(path.join(project, rel)), { recursive: true });
    fs.writeFileSync(path.join(project, rel), body);
  }
  const contract = { goal: "Show the document title", docText: `${DOCS_RERUN5}\nactiveDocument title string`, projectPath: project, baseline: { files: { "src/globals.ts": sha(GLOBALS) }, surface: "", fileSurfaces: {} } };
  return { project, contract, files: ["src/title.ts", "src/Panel.tsx"], bodies: [feature, panel] };
}

test("NU6 every changed source that ships is reviewed, including an undeclared main.tsx or main.vue", () => {
  const clean = claimProject();
  assert.equal(reviewClaim(clean).ok, true, reviewClaim(clean).say);
  const tsx = claimProject({ "src/main.tsx": "import { photoshop } from \"./globals\";\nphotoshop.action.subscribeToEverything();\n" });
  const tsxClaim = reviewClaim(tsx);
  assert.equal(tsxClaim.ok, false);
  assert.match(tsxClaim.say, /subscribeToEverything/);
  const vue = claimProject({ "src/main.vue": VUE_HONEST.replace("info.value = {", "photoshop.app.subscribeToEverything();\n    info.value = {") });
  const vueClaim = reviewClaim(vue);
  assert.equal(vueClaim.ok, false);
  assert.match(vueClaim.say, /subscribeToEverything/);
  const tooling = claimProject({ "pack.mjs": "import fs from \"node:fs\";\nimport fs from \"node:fs\";\n", "test/x.test.mjs": "photoshop.action.subscribeToEverything();\n" });
  assert.equal(reviewClaim(tooling).ok, true, reviewClaim(tooling).say);
});

test("NU7 a rename file that does not parse is needs review, not a pass", () => {
  const broken = "import { photoshop } from \"./globals\";\nexport function f(n){ const layer = photoshop.app.activeDocument.activeLayers[0 layer.name = n; }\n";
  assert.match(renameFindings([globals, { rel: "src/f.ts", body: broken }], DOCS_RERUN5).join(" "), /parse needs review/);
  assert.match(hostCallFindings([globals, { rel: "src/f.ts", body: broken }], DOCS_RERUN5).join(" "), /parse needs review/);
});

test("NU8 the rename check runs whatever words the goal uses", () => {
  const writes = "import { photoshop } from \"./globals\";\nexport function readTitle(){ photoshop.app.activeDocument.activeLayers[0].name = \"x\"; return photoshop.app.activeDocument.title; }\n";
  const claim = claimProject();
  claim.contract.goal = "Tidy up the layer labels in the panel";
  claim.bodies[0] = writes;
  fs.writeFileSync(path.join(claim.project, "src", "title.ts"), writes);
  const result = reviewClaim(claim);
  assert.equal(result.ok, false);
  assert.match(result.say, /outside executeAsModal/);
});

function plantedSkill() {
  const top = temp("uxp-nu10-");
  fs.mkdirSync(path.join(top, "node_modules", "create-bolt-uxp", "dist"), { recursive: true });
  fs.writeFileSync(path.join(top, "node_modules", "create-bolt-uxp", "package.json"), JSON.stringify({ name: "create-bolt-uxp", version: "0.0.1", main: "dist/index.js" }));
  const marker = path.join(top, "planted-ran.txt");
  fs.writeFileSync(path.join(top, "node_modules", "create-bolt-uxp", "dist", "index.js"), `require("node:fs").writeFileSync(${JSON.stringify(marker)}, "ran");\n`);
  const skill = path.join(top, "proj", ".agents", "skills", "uxp-assistant");
  fs.mkdirSync(skill, { recursive: true });
  fs.writeFileSync(path.join(skill, "SKILL.md"), "---\nname: uxp-assistant\n---\n");
  return { top, skill, marker };
}

function fakeNpm(dir, script) {
  const file = path.join(dir, "npm-stub.sh");
  fs.writeFileSync(file, `#!/bin/sh\n${script}\n`);
  fs.chmodSync(file, 0o755);
  return file;
}

test("NU10 a planted ancestor create-bolt-uxp is never loaded, and only the pinned 1.3.27 bytes count", () => {
  const { top, skill, marker } = plantedSkill();
  assert.equal(INSTALLER_VERSION, "1.3.27");
  assert.deepEqual(installerRoots(skill), [path.join(path.dirname(skill), ".uxp-tooling", "node_modules")]);
  assert.equal(installerEntry(skill), "");
  const failing = fakeNpm(top, "exit 1");
  assert.throws(() => ensureInstaller({ skillDirectory: skill, npm: failing }), /1\.3\.27/);
  assert.equal(fs.existsSync(marker), false);
  const forged = path.join(path.dirname(skill), ".uxp-tooling", "node_modules", "create-bolt-uxp");
  fs.mkdirSync(path.join(forged, "dist"), { recursive: true });
  fs.writeFileSync(path.join(forged, "package.json"), JSON.stringify({ name: "create-bolt-uxp", version: "1.3.27" }));
  fs.writeFileSync(path.join(forged, "dist", "index.js"), "export const createBoltUXP = () => {};\n");
  assert.match(verifyInstaller(path.dirname(forged)).reason, /sha256/);
  assert.equal(installerEntry(skill), "");
  assert.match(verifyInstaller(path.join(top, "node_modules")).reason, /0\.0\.1/);
});

function copyPinned(prefixModules) {
  // NQ11: a stub with only create-bolt-uxp no longer counts, so this is a linked copy of the whole verified tree.
  linkTree(repoModules, prefixModules);
}

test("NU11 the pinned tooling beside the skill is found from any working directory without a reinstall", () => {
  const { top, skill } = plantedSkill();
  const modules = path.join(path.dirname(skill), ".uxp-tooling", "node_modules");
  copyPinned(modules);
  const expected = path.join(modules, "create-bolt-uxp", "dist", "index.js");
  const previous = process.cwd();
  try {
    for (const cwd of [top, os.tmpdir(), skill, "/"]) {
      process.chdir(cwd);
      assert.equal(installerEntry(skill), expected, cwd);
      const npm = fakeNpm(top, "echo should-not-run; exit 3");
      assert.equal(ensureInstaller({ skillDirectory: skill, npm, notify: () => assert.fail("no install expected") }), expected);
    }
    process.chdir(os.tmpdir());
    assert.equal(fs.existsSync(installerEntry()), true, "the source repo's pinned copy is found from another cwd");
  } finally {
    process.chdir(previous);
  }
});

test("NU12 session next leaves the domain loop when the domain step cannot fetch docs", () => {
  const out = temp("uxp-nu12-");
  fs.mkdirSync(path.join(out, "domain"), { recursive: true });
  fs.mkdirSync(path.join(out, "docs"), { recursive: true });
  fs.writeFileSync(path.join(out, "docs", "manifest.txt"), "manifest\n");
  const old = new Date(Date.now() - 60000);
  fs.utimesSync(path.join(out, "docs", "manifest.txt"), old, old);
  fs.writeFileSync(path.join(out, "session.json"), JSON.stringify({ docs: { ok: true, failed: [], stale: [] }, asks: [] }));
  fs.writeFileSync(path.join(out, "domain", "session.json"), JSON.stringify({ outcome: "docs-incomplete" }));
  const base = { ok: true, action: "domain", command: "node scripts/skill.mjs domain" };
  const first = specialize(base, out);
  assert.equal(first.action, "refresh", first.next);
  assert.equal(specialize(base, out).action, "refresh", "no new refresh, so still refresh, not domain");
  let actions = [];
  for (let round = 0; round < 5; round += 1) {
    const later = new Date(Date.now() + (round + 1) * 2000);
    fs.utimesSync(path.join(out, "docs", "manifest.txt"), later, later);
    const after = domainDocsNext(out, base);
    actions.push(after.action);
    const domainLater = new Date(Date.now() + (round + 1) * 2000 + 1000);
    fs.utimesSync(path.join(out, "domain", "session.json"), domainLater, domainLater);
    actions.push(domainDocsNext(out, base).action);
  }
  assert.deepEqual(actions.slice(0, 6), ["domain", "refresh", "domain", "refresh", "domain", "offline"]);
  assert.ok(actions.slice(6).every((item) => item === "offline"));
  assert.equal(actions.filter((item) => item === "domain").length, 3);
});

test("NU13 a stopped script change is not asked again unless record --reask", () => {
  const project = temp("uxp-nu13-project-");
  fs.writeFileSync(path.join(project, "package.json"), `${JSON.stringify({ scripts: { test: "node --test" } })}\n`);
  const baseline = { scripts: { test: "" }, files: {}, commandFiles: {}, packaging: {} };
  const drift = commandChangeSet(project, baseline);
  const domain = temp("uxp-nu13-domain-");
  fs.writeFileSync(path.join(domain, "session.json"), `${JSON.stringify(emptySession(), null, 2)}\n`);
  publishAsk(domain, scriptChangeAsk({ changes: drift.changes, scope: drift.scope }));
  const open = readMerged(domain).asks.find((item) => item.id === "script-change");
  assert.equal(scriptChangeDecision(open, drift.scope), "pending");
  answerFromChat(domain, "script-change", "stop");
  const blocked = reviewCommandProvenance(project, baseline, readScriptGrant(domain));
  const stopped = readMerged(domain).asks.find((item) => item.id === "script-change");
  assert.equal(scriptChangeDecision(stopped, blocked.scope), "stopped");
  assert.equal(scriptChangeDecision(stopped, blocked.scope, { reask: true }), "ask");
  assert.equal(scriptChangeDecision(stopped, { ...blocked.scope, commands: [{ name: "build", to: "vite build" }] }), "ask");
  assert.equal(scriptChangeDecision(undefined, blocked.scope), "ask");
  const out = temp("uxp-nu13-out-");
  fs.mkdirSync(path.join(out, "domain"), { recursive: true });
  fs.writeFileSync(path.join(out, "domain", "session.json"), JSON.stringify({ outcome: "awaiting-agent-implementation" }));
  fs.writeFileSync(path.join(out, "domain", "record-result.json"), JSON.stringify({ state: "script-change-stopped", say: "You chose stop for this exact script change." }));
  fs.writeFileSync(path.join(out, "session.json"), JSON.stringify({ docs: { ok: true }, asks: [] }));
  const next = specialize({ ok: true, action: "record" }, out);
  assert.equal(next.action, "paused");
  assert.equal(next.command, "");
  assert.match(next.next, /--reask/);
  assert.doesNotMatch(next.next, /dashboard/);
});

test("NU14 the automatic create-bolt-uxp install shows a dashboard line before it runs", () => {
  const { top, skill } = plantedSkill();
  const lines = [];
  const failing = fakeNpm(top, "exit 1");
  assert.throws(() => ensureInstaller({ skillDirectory: skill, npm: failing, notify: (text) => lines.push(text) }));
  assert.match(lines[0], /Installing create-bolt-uxp@1\.3\.27 into .*\.uxp-tooling/);
  assert.match(lines.at(-1), /failed/);
  const modules = path.join(path.dirname(skill), ".uxp-tooling", "node_modules");
  const working = fakeCiScript(top);
  lines.length = 0;
  const entry = ensureInstaller({ skillDirectory: skill, npm: working, notify: (text) => lines.push(text) });
  assert.equal(entry, path.join(modules, "create-bolt-uxp", "dist", "index.js"));
  assert.match(lines[0], /^Installing create-bolt-uxp@1\.3\.27/);
  assert.match(lines.at(-1), /^Installed create-bolt-uxp@1\.3\.27/);
  const calls = [];
  dashboardActivity("/tmp/session", { session: (argv) => { calls.push(argv); return Promise.resolve({ ok: true }); } }, lines[0]);
  assert.deepEqual(calls[0].slice(0, 6), ["step", "--id", "decide", "--status", "running", "--detail"]);
  assert.equal(calls[0][6], lines[0]);
  assert.ok(calls[0].includes("--doing"));
});

const FEATURE = `export async function readSelection(app) {
  if (!app) return { ok: false, status: "Photoshop is not available." };
  const document = app.activeDocument;
  if (!document) return { ok: false, status: "No document is open." };
  return { ok: true, status: "Read", layers: (document.activeLayers || []).map((layer) => ({ id: layer.id, name: layer.name })) };
}
`;
const HEAD = "import assert from \"node:assert/strict\";\nimport { test } from \"node:test\";\nimport { readSelection } from \"../src/selection-read.mjs\";\nconst app = { activeDocument: { activeLayers: [{ id: 7, name: \"Hero\" }] } };\n";

test("NT7 weak feature tests do not count, and a value check from a real fixture does", () => {
  const weak = {
    "Object.keys + notEqual": "test(\"x\", async () => { const r = await readSelection(app); assert.notEqual(Object.keys(r).length, 0); });",
    "instanceof + length": "test(\"x\", async () => { const r = await readSelection(app); assert.ok(r.layers instanceof Array); assert.equal(r.layers.length, 1); });",
    "null paths only": "test(\"x\", async () => { assert.equal((await readSelection(null)).status, \"Photoshop is not available.\"); assert.equal((await readSelection({ activeDocument: null })).status, \"No document is open.\"); });",
    "snapshot of self": "test(\"x\", async () => { const first = await readSelection(app); assert.deepEqual(await readSelection(app), first); });",
    "throws only": "test(\"x\", async () => { await assert.doesNotReject(() => readSelection(app)); assert.throws(() => { throw new Error(\"x\"); }); });",
    "typeof only": "test(\"x\", () => { assert.equal(typeof readSelection, \"function\"); });",
    "ok flag only": "test(\"x\", async () => { assert.equal((await readSelection(app)).ok, true); });"
  };
  for (const [name, body] of Object.entries(weak)) {
    const verdict = strongAssertions(HEAD + body, "test/selection.test.mjs", ["src/selection-read.mjs"]);
    assert.equal(verdict.ok, false, name);
  }
  const strong = "test(\"x\", async () => { const r = await readSelection(app); assert.deepEqual(r.layers, [{ id: 7, name: \"Hero\" }]); });";
  assert.equal(strongAssertions(HEAD + strong, "test/selection.test.mjs", ["src/selection-read.mjs"]).ok, true);
  const project = temp("uxp-nt7-");
  fs.mkdirSync(path.join(project, "src"), { recursive: true });
  fs.mkdirSync(path.join(project, "test"), { recursive: true });
  fs.writeFileSync(path.join(project, "package.json"), JSON.stringify({ scripts: { test: "node --test" } }));
  fs.writeFileSync(path.join(project, "src", "selection-read.mjs"), FEATURE);
  const changed = [{ rel: "src/selection-read.mjs", body: FEATURE }];
  for (const body of Object.values(weak)) {
    fs.writeFileSync(path.join(project, "test", "selection.test.mjs"), HEAD + body);
    assert.equal(testsCoverFeature(project, changed, ["activeLayers"], ["src/selection-read.mjs"]).ok, false, body);
  }
  fs.writeFileSync(path.join(project, "test", "selection.test.mjs"), HEAD + strong);
  assert.equal(testsCoverFeature(project, changed, ["activeLayers"], ["src/selection-read.mjs"]).ok, true);
});

test("NT8 static error text, static keywords, a dead status line, and a state set once are not UI state", () => {
  const cases = {
    "static error text": "export function Panel(){ const [rows, setRows] = useState([]); useEffect(() => setRows(list()), []); return <div><sp-body>Error: could not rename the layer.</sp-body>{rows.map((r) => <p>{r}</p>)}</div>; }",
    "static keywords": "export function Panel(){ return <div><p>Loading… error disabled busy</p><button disabled>Rename</button></div>; }",
    "dead status line": "export function Panel(){ const [msg, setMsg] = useState(\"\"); const go = () => { try { run(); } catch (e) { setMsg(String(e)); } }; return <div>{false && <p>{msg}</p>}<button onClick={go}>Go</button></div>; }",
    "rendered state set once": "export function Panel(){ const [msg, setMsg] = useState(\"\"); return <button onClick={() => setMsg(\"Done\")}>{msg}</button>; }",
    "disabled bound to a state set once": "export function Panel(){ const [ready, setReady] = useState(\"Waiting\"); return <button disabled={!ready} onClick={() => setReady(\"Ready\")}>{ready}</button>; }"
  };
  for (const [name, source] of Object.entries(cases)) assert.equal(showsHonestUiState(source, "src/Panel.tsx"), false, name);
  const honest = {
    "error in catch": "export function Panel(){ const [msg, setMsg] = useState(\"\"); const go = async () => { try { await run(); } catch (e) { setMsg(String(e)); } }; return <div>{msg && <p>{msg}</p>}<button onClick={go}>Go</button></div>; }",
    "busy toggle": "export function Panel(){ const [busy, setBusy] = useState(false); const go = async () => { setBusy(true); await run(); setBusy(false); }; return <button disabled={busy} onClick={go}>Go</button>; }",
    ".catch handler": "export function Panel(){ const [err, setErr] = useState(\"\"); const go = () => run().catch((e) => setErr(String(e))); return <div><p>{err}</p><button onClick={go}>Go</button></div>; }"
  };
  for (const [name, source] of Object.entries(honest)) assert.equal(showsHonestUiState(source, "src/Panel.tsx"), true, name);
});
