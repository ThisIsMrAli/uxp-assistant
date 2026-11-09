import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { hostReview, panelRendersState } from "../.claude/skills/uxp-assistant/scripts/lib/host-flow.mjs";
import { strongAssertions } from "../.claude/skills/uxp-assistant/scripts/lib/test-strength.mjs";
import { installTree, verifyTree } from "../.claude/skills/uxp-assistant/scripts/lib/tooling.mjs";
import { RERUN6_GLOBALS, RERUN6_IMPORT } from "./fixtures/host-corpus-rerun6.mjs";
import { REAL_DOCS } from "./fixtures/real-docs.mjs";
import { fakeCiScript, linkTree, repoModules } from "./fixtures/tooling-tree.mjs";

function review(rel, body, extra = []) {
  const feature = [{ rel: "src/globals.ts", body: RERUN6_GLOBALS }, ...extra, { rel, body: (/\.(vue|svelte)$/.test(rel) ? "" : RERUN6_IMPORT) + body }];
  return hostReview(feature, REAL_DOCS).findings;
}

const flagged = (findings, pattern) => findings.some((line) => pattern.test(line));

test("NK1 non-static loads, getters, exported let, modal returns, and cross-module host args fail closed", () => {
  const move = [{ rel: "src/move.ts", body: "export function move(d){ return d.translate(1, 1); }\n" }];
  const run = [{ rel: "src/run.ts", body: "export function run(a){ return a.executeAsModal(() => {}, { commandName: \"x\" }); }\n" }];
  const mute = [{ rel: "src/mute.ts", body: "export function mute(s){ return s.setMute(true); }\n" }];
  assert.ok(flagged(review("src/feature.ts", "import { move } from \"./move\";\nexport function f(){ return move(photoshop.app.activeDocument); }", move), /translate/), "document translate through another module");
  assert.deepEqual(review("src/feature.ts", "import { move } from \"./move\";\nexport function f(){ return move(photoshop.app.activeDocument.activeLayers[0]); }", move), [], "layer translate through another module");
  assert.ok(flagged(review("src/feature.ts", "import { run } from \"./run\";\nexport function f(){ return run(photoshop.action); }", run), /executeAsModal/), "action.executeAsModal through another module");
  assert.ok(flagged(review("src/feature.ts", "import { mute } from \"./mute\";\nexport async function f(){ const p = await premierepro.Project.getActiveProject(); const s = await p.getActiveSequence(); return mute(s); }", mute), /setMute/), "sequence setMute through another module");
  assert.deepEqual(review("src/feature.ts", "import { mute } from \"./mute\";\nexport async function f(){ const p = await premierepro.Project.getActiveProject(); const s = await p.getActiveSequence(); return mute(await s.getVideoTrack(0)); }", mute), [], "video track setMute");
  assert.ok(flagged(review("src/feature.ts", "export function f(){ const [a = photoshop.action] = []; return a.subscribeToEverything(); }"), /subscribeToEverything/), "array destructuring default");
  assert.deepEqual(review("src/feature.ts", "export function f(){ const [a = photoshop.action] = []; return a.batchPlay([], {}); }"), [], "destructuring default of the real action method");
  assert.ok(flagged(review("src/feature.ts", "Object.defineProperty(globalThis, \"ps\", { get(){ return photoshop; } });\nexport function f(){ return globalThis.ps; }"), /defineProperty|getter/), "globalThis getter");
  assert.ok(flagged(review("src/feature.ts", "export function f(){ return import.meta.glob(\"./mods/*.js\", { eager: true }); }"), /import\.meta\.glob/), "import.meta.glob");
  assert.ok(flagged(review("src/feature.ts", "export function f(module){ return module.require(\"photoshop\"); }"), /require/), "module.require");
  assert.ok(flagged(review("src/feature.ts", "import { createRequire } from \"module\";\nexport function f(){ return createRequire(import.meta.url)(\"photoshop\"); }"), /createRequire/), "createRequire");
  assert.ok(flagged(review("src/host.ts", "export let action;\nexport function init(){ action = photoshop.action; }\n"), /exported let/), "exported let assigned in init");
  assert.deepEqual(review("src/feature.ts", "export const action = photoshop.action;\nexport function f(){ return action.batchPlay([], {}); }"), [], "export const stays a tracked binding");
  assert.ok(flagged(review("src/feature.ts", "export async function f(){ const layer = photoshop.app.activeDocument.activeLayers[0]; const rename = await photoshop.core.executeAsModal(() => (name) => { layer.name = name; }, { commandName: \"x\" }); return rename; }"), /executeAsModal/), "function returned from the modal");
  assert.deepEqual(review("src/feature.ts", "export async function f(n: string){ await photoshop.core.executeAsModal(async () => { const layer = photoshop.app.activeDocument.activeLayers[0]; return Promise.resolve().then(() => { layer.name = n; }); }, { commandName: \"Rename\" }); }"), [], "then-chain returned inside the modal");
});

test("NK2 a typed receiver only accepts that class's own members", () => {
  assert.ok(flagged(review("src/feature.ts", "export function f(){ return photoshop.app.activeDocument.activeLayers[0].saveAs.psd(); }"), /saveAs/), "layer.saveAs.psd");
  assert.deepEqual(review("src/feature.ts", "export function f(){ return photoshop.app.activeDocument.activeLayers[0].translate(1, 1); }"), [], "layer.translate");
  assert.deepEqual(review("src/feature.ts", "export function f(){ return photoshop.app.activeDocument.saveAs.psd(); }"), [], "document.saveAs.psd");
});

test("NK3 a Vue v-for item method is checked against the element class", () => {
  const fake = "<template><button v-for=\"l in photoshop.app.activeDocument.layers\" @click=\"l.fakeRename()\">x</button></template>\n<script setup lang=\"ts\">\nimport { photoshop } from \"./globals\";\n</script>\n";
  const real = fake.replace("fakeRename()", "translate(1, 1)");
  assert.ok(flagged(review("src/panel.vue", fake), /fakeRename/), "v-for fake method");
  assert.deepEqual(review("src/panel.vue", real), [], "v-for translate");
});

test("NK4 Array.from and a spread of a host list stay that list inside the modal", () => {
  const from = "export async function f(n: string){ const doc = photoshop.app.activeDocument; await photoshop.core.executeAsModal(async () => { Array.from(doc.activeLayers).forEach((l) => { l.name = n; }); }, { commandName: \"Rename\" }); }";
  const spread = "export async function f(n: string){ const layers = photoshop.app.activeDocument.activeLayers; await photoshop.core.executeAsModal(async () => { [...layers].forEach((l) => { l.name = n; }); }, { commandName: \"Rename\" }); }";
  const stored = "export function f(){ return Array.from([photoshop.action])[0].subscribeToEverything(); }";
  assert.deepEqual(review("src/feature.ts", from), [], "Array.from forEach rename");
  assert.deepEqual(review("src/feature.ts", spread), [], "spread forEach rename");
  assert.ok(review("src/feature.ts", stored).length > 0, "Array.from of a stored action is still rejected");
});

const WEAK_HEAD = `import test from "node:test";
import assert from "node:assert/strict";
import { listLayers, renameSelected } from "../src/layers.ts";
const fx = { app: { activeDocument: { activeLayers: [{ id: 2 }], layers: [{ id: 1, name: "Top", layers: [] }, { id: 2, name: "Bottom", layers: [] }] } } };
const W = [{ id: 1, name: "Top", depth: 0, selected: false }, { id: 2, name: "Bottom", depth: 0, selected: true }];
`;

function weak(body) {
  return strongAssertions(WEAK_HEAD + body, "test/layers.test.mjs", ["src/layers.ts"]);
}

test("NK5 an assertion in an unawaited timer, in assert.throws or assert.rejects, or assert.ok of a function is weak", () => {
  assert.equal(weak("test(\"x\", () => { setTimeout(() => { assert.deepEqual(listLayers(fx), W); }, 0); });").ok, false);
  assert.equal(weak("test(\"x\", () => { assert.throws(() => { assert.deepEqual(listLayers(fx), [{ id: 9, name: \"Nope\" }]); }); });").ok, false);
  assert.equal(weak("test(\"x\", async () => { await assert.rejects(async () => { assert.deepEqual(listLayers(fx), [{ id: 9, name: \"Nope\" }]); }); });").ok, false);
  assert.equal(weak("function check(){ assert.deepEqual(listLayers(fx), W); }\ntest(\"x\", () => { assert.ok(check); });").ok, false);
  assert.equal(weak("test(\"x\", () => { assert.deepEqual(listLayers(fx), W); });").ok, true);
});

test("NK6 a mutated fixture alias is a real assertion, and a non-constant skip still runs", () => {
  const mutated = "test(\"x\", async () => { const layer = { id: 2, name: \"Old\" }; const ps = { app: { activeDocument: { activeLayers: [layer] } }, core: { executeAsModal: async (fn) => fn() } }; await renameSelected(ps, \"New\"); assert.equal(layer.name, \"New\"); });";
  assert.equal(weak(mutated).ok, true, weak(mutated).reason);
  assert.equal(weak("test(\"x\", { skip: process.platform === \"aix\" }, () => { assert.deepEqual(listLayers(fx), W); });").ok, true);
  assert.equal(weak("test(\"x\", { skip: true }, () => { assert.deepEqual(listLayers(fx), W); });").ok, false);
});

function react(body) {
  return `import { useState } from "react";\n${body}`;
}

test("NK7 a hidden, contradictory, unwired, or title-only error is not a rendered state", () => {
  const go = "const [error, setError] = useState(\"\"); const go = async () => { try { await photoshop.core.showAlert(\"x\"); } catch (e) { setError(String(e)); } };";
  assert.equal(panelRendersState(react(`export function P(){ ${go} return <p style={{ opacity: 0 }}><button onClick={go}>Go</button>{error}</p>; }`), "src/main.tsx"), false);
  assert.equal(panelRendersState(react(`export function P(){ ${go} return <div aria-hidden style={{ height: 0 }}><button onClick={go}>Go</button><p>{error}</p></div>; }`), "src/main.tsx"), false);
  assert.equal(panelRendersState(react(`export function P(){ ${go} return <button title={error} onClick={go}>Go</button>; }`), "src/main.tsx"), false);
  assert.equal(panelRendersState(react(`export function P(){ ${go} return <div><button onClick={go}>Go</button>{error && !error && <p>{error}</p>}</div>; }`), "src/main.tsx"), false);
  assert.equal(panelRendersState(react(`export function P(){ ${go.replace("const go = async () => {", "const go = async () => { const setError = () => {};")} return <div><button onClick={go}>Go</button><p>{error}</p></div>; }`), "src/main.tsx"), false);
  assert.equal(panelRendersState(react(`import { createPortal } from "react-dom";\nexport function P(){ ${go} return <div><button onClick={go}>Go</button>{createPortal(<p>{error}</p>, document.createElement("div"))}</div>; }`), "src/main.tsx"), false);
  const vue = (template) => `<script setup lang="ts">\nimport { ref, computed } from "vue";\nconst error = ref("");\nconst show = computed(() => false);\nasync function go(){ try { await photoshop.core.showAlert("x"); } catch (e) { error.value = String(e); } }\n</script>\n<template>${template}</template>\n`;
  assert.equal(panelRendersState(vue("<button @click=\"go\">Go</button><p :style=\"{ display: 'none' }\">{{ error }}</p>"), "src/main.vue"), false);
  assert.equal(panelRendersState(vue("<button @click=\"go\">Go</button><p v-if=\"true\">ok</p><p v-else>{{ error }}</p>"), "src/main.vue"), false);
  assert.equal(panelRendersState(vue("<button @click=\"go\" :title=\"error\">Go</button>"), "src/main.vue"), false);
  assert.equal(panelRendersState(vue("<button @click=\"go\">Go</button><p v-show=\"show\">{{ error }}</p>"), "src/main.vue"), false);
  const svelte = (markup) => `<script lang="ts">\nlet error = "";\nasync function go(){ try { await photoshop.core.showAlert("x"); } catch (e) { error = String(e); } }\n</script>\n${markup}\n`;
  assert.equal(panelRendersState(svelte("<button on:click={go}>Go</button><p style:display=\"none\">{error}</p>"), "src/main.svelte"), false);
  assert.equal(panelRendersState(svelte("<button on:click={go}>Go</button>{#if true}<p>ok</p>{:else}<p>{error}</p>{/if}"), "src/main.svelte"), false);
  assert.equal(panelRendersState(svelte("<button on:click={go} title={error}>Go</button>"), "src/main.svelte"), false);
  assert.equal(panelRendersState(svelte("<p>{error}</p>"), "src/main.svelte"), false);
  assert.equal(panelRendersState(react(`export function P(){ ${go} return <div><button onClick={go}>Go</button><p>{error}</p></div>; }`), "src/main.tsx"), true);
  assert.equal(panelRendersState(vue("<button @click=\"go\">Go</button><p v-if=\"error\">{{ error }}</p>"), "src/main.vue"), true);
});

test("NK8 a Vue options-API data error and a Svelte {:catch} count as rendered", () => {
  const vue = `<script lang="ts">\nexport default {\n  data(){ return { error: "" }; },\n  methods: { async go(){ try { await photoshop.core.showAlert("x"); } catch (e) { this.error = String(e); } } }\n};\n</script>\n<template><button @click="go">Go</button><p>{{ error }}</p></template>\n`;
  const svelte = `<script lang="ts">\nlet pending = Promise.resolve();\n</script>\n{#await pending}<p>wait</p>{:catch error}<p>{error.message}</p>{/await}\n`;
  assert.equal(panelRendersState(vue, "src/main.vue"), true);
  assert.equal(panelRendersState(svelte, "src/main.svelte"), true);
  const hiddenCatch = `<script lang="ts">\nlet pending = Promise.resolve();\n</script>\n{#if false}{#await pending}{:catch error}<p>{error.message}</p>{/await}{/if}\n`;
  assert.equal(panelRendersState(hiddenCatch, "src/main.svelte"), false);
});

function planted() {
  const top = fs.mkdtempSync(path.join(os.tmpdir(), "uxp-nk-"));
  const skill = path.join(top, "proj", ".agents", "skills", "uxp-assistant");
  fs.mkdirSync(skill, { recursive: true });
  const prefix = path.join(path.dirname(skill), ".uxp-tooling");
  const modules = path.join(prefix, "node_modules");
  return { top, skill, prefix, modules };
}

test("NK9 a package.json fifo is refused without reading it", () => {
  const { modules } = planted();
  linkTree(repoModules, modules);
  const pkg = path.join(modules, "prettier", "package.json");
  fs.unlinkSync(pkg);
  const made = spawnSync("mkfifo", [pkg]);
  assert.equal(made.status, 0, made.stderr?.toString());
  const started = Date.now();
  const result = verifyTree(modules, { fresh: true });
  assert.ok(Date.now() - started < 2000, "verify hung on the fifo");
  assert.match(result.reason, /package\.json is not a regular file/);
});

test("NK10 a .bin entry that is a regular file, or a symlink outside the lock bin map, is refused", () => {
  const { modules } = planted();
  linkTree(repoModules, modules);
  fs.writeFileSync(path.join(modules, ".bin", "planted-bin"), "#!/bin/sh\necho planted\n");
  assert.match(verifyTree(modules, { fresh: true }).reason, /not a symlink/);
  fs.rmSync(path.join(modules, ".bin", "planted-bin"));
  fs.symlinkSync("../prettier/package.json", path.join(modules, ".bin", "not-a-bin"));
  assert.match(verifyTree(modules, { fresh: true }).reason, /lock bin map/);
  fs.rmSync(path.join(modules, ".bin", "not-a-bin"));
  assert.equal(verifyTree(modules, { fresh: true }).ok, true);
});

test("NK11 a .cache directory is an unexpected package, and .package-lock.json stays allowed", () => {
  const { modules } = planted();
  linkTree(repoModules, modules);
  assert.equal(fs.existsSync(path.join(modules, ".package-lock.json")), true);
  assert.equal(verifyTree(modules, { fresh: true }).ok, true);
  fs.mkdirSync(path.join(modules, ".cache"));
  fs.writeFileSync(path.join(modules, ".cache", "payload.js"), "module.exports = 1;\n");
  assert.match(verifyTree(modules, { fresh: true }).reason, /\.cache/);
});

test("NK12 a staging folder left by a dead install is removed while the lock is held", () => {
  const { top, prefix, modules } = planted();
  linkTree(repoModules, modules);
  const stale = `${prefix}.staging-999999-1`;
  fs.mkdirSync(path.join(stale, "node_modules", "leftover"), { recursive: true });
  fs.writeFileSync(path.join(stale, "node_modules", "leftover", "index.js"), "module.exports = 1;\n");
  const old = `${prefix}.old-999999-2`;
  fs.mkdirSync(old);
  const result = installTree(prefix, { npm: fakeCiScript(top) });
  assert.equal(result.reused, true);
  assert.equal(fs.existsSync(stale), false);
  assert.equal(fs.existsSync(old), false);
  assert.equal(verifyTree(modules, { fresh: true }).ok, true);
});

test("NK13 npm is spawned without npm_config and without the user npmrc, and the error has a single period", () => {
  const { top, prefix } = planted();
  const marker = path.join(top, "seen.json");
  const script = path.join(top, "see.mjs");
  fs.writeFileSync(script, `import fs from "node:fs";
const args = process.argv.slice(2);
const userconfig = args[args.indexOf("--userconfig") + 1];
fs.writeFileSync(${JSON.stringify(marker)}, JSON.stringify({
  config: Object.keys(process.env).filter((key) => /^npm_config_/i.test(key)),
  userconfig,
  userconfigText: fs.readFileSync(userconfig, "utf8")
}));
console.error("install-strategy=linked.");
process.exit(1);
`);
  const runner = path.join(top, "see.sh");
  fs.writeFileSync(runner, `#!/bin/sh\n"${process.execPath}" "${script}" "$@"\n`, { mode: 0o755 });
  process.env.npm_config_omit = "optional";
  let error;
  try {
    installTree(prefix, { npm: runner });
  } catch (caught) {
    error = caught;
  } finally {
    delete process.env.npm_config_omit;
  }
  assert.ok(error, "the install should fail");
  assert.doesNotMatch(error.message, /\.\./);
  assert.match(error.message, /npm ci exited 1\. npm said: install-strategy=linked/);
  assert.match(error.message, /npm config from the environment/);
  const seen = JSON.parse(fs.readFileSync(marker, "utf8"));
  assert.deepEqual(seen.config, []);
  assert.equal(seen.userconfigText, "");
});

test("NK14 the changelog records a main-only history by ThisIsMrAli", () => {
  const text = fs.readFileSync(new URL("../.claude/skills/uxp-assistant/CHANGELOG.md", import.meta.url), "utf8");
  assert.doesNotMatch(text, /history not rewritten/);
  assert.doesNotMatch(text, /27 Cursor Agent commits/);
  assert.match(text, /main-only/);
  assert.match(text, /ThisIsMrAli/);
});
