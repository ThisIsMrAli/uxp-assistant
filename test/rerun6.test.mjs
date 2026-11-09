import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { spawn } from "node:child_process";
import { hostReview, panelRendersState } from "../.claude/skills/uxp-assistant/scripts/lib/host-flow.mjs";
import { parseSource } from "../.claude/skills/uxp-assistant/scripts/lib/parse.mjs";
import { HOST_PAGES } from "../.claude/skills/uxp-assistant/scripts/lib/registry.mjs";
import { strongAssertions } from "../.claude/skills/uxp-assistant/scripts/lib/test-strength.mjs";
import { acquireLock, forgetVerified, installTree, npmCommand, verifyTree } from "../.claude/skills/uxp-assistant/scripts/lib/tooling.mjs";
import { ensureInstaller, verifyInstaller } from "../.claude/skills/uxp-assistant/scripts/lib/scaffold.mjs";
import { domainDocsNext, specialize } from "../.claude/skills/uxp-assistant/scripts/skill.mjs";
import { BLIND, RERUN6_CASES, RERUN6_GLOBALS, RERUN6_IMPORT } from "./fixtures/host-corpus-rerun6.mjs";
import { REAL_DOCS, REAL_DOCS_BEFORE_APP_CORE } from "./fixtures/real-docs.mjs";
import { UI6_CASES } from "./fixtures/ui-rerun6.mjs";
import { WEAK6_CASES, WEAK6_HEADER } from "./fixtures/weak-tests-rerun6.mjs";
import { fakeCiScript, linkTree, replaceFile, repoModules } from "./fixtures/tooling-tree.mjs";

const temp = (prefix) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));

function review(entry, docs) {
  const rel = entry.rel || "src/feature.ts";
  const body = (entry.noG || /\.(vue|svelte)$/.test(rel) ? "" : RERUN6_IMPORT) + entry.body;
  const feature = [{ rel: "src/globals.ts", body: RERUN6_GLOBALS }, ...(entry.extra || []), { rel, body }];
  return hostReview(feature, docs).findings;
}

function score(list, docs) {
  const tally = { tp: 0, fp: 0, fn: 0, tn: 0, mistakes: [] };
  for (const entry of list) {
    const found = review(entry, docs);
    if (entry.expect === "fail" && found.length) tally.tp += 1;
    else if (entry.expect === "fail") {
      tally.fn += 1;
      tally.mistakes.push(`${entry.id} passed silently`);
    } else if (found.length) {
      tally.fp += 1;
      tally.mistakes.push(`${entry.id} was rejected: ${found.join(" | ")}`);
    } else tally.tn += 1;
  }
  tally.precision = tally.tp / (tally.tp + tally.fp);
  tally.recall = tally.tp / (tally.tp + tally.fn);
  return tally;
}

const byId = (prefix) => RERUN6_CASES.find((entry) => entry.id.startsWith(`${prefix} `));

test("rerun6 corpus: Adobe's 116 fresh host cases on the pages the skill fetches", () => {
  assert.equal(RERUN6_CASES.length, 116);
  const blindCases = RERUN6_CASES.filter(BLIND);
  assert.equal(blindCases.length, 100);
  const all = score(RERUN6_CASES, REAL_DOCS);
  const blind = score(blindCases, REAL_DOCS);
  console.log(`rerun6 blind 100: tp ${blind.tp} fp ${blind.fp} fn ${blind.fn} tn ${blind.tn} precision ${blind.precision} recall ${blind.recall}`);
  console.log(`rerun6 all 116: tp ${all.tp} fp ${all.fp} fn ${all.fn} tn ${all.tn} precision ${all.precision} recall ${all.recall}`);
  assert.equal(all.mistakes.join("\n"), "");
});

test("NQ2 without the photoshop.app and photoshop.core pages, every bypass is still caught (a missing page is needs review)", () => {
  const all = score(RERUN6_CASES, REAL_DOCS_BEFORE_APP_CORE);
  console.log(`rerun6 all 116 on the pages fetched before app/core: tp ${all.tp} fp ${all.fp} fn ${all.fn} tn ${all.tn}`);
  assert.equal(all.fn, 0, all.mistakes.join("\n"));
  for (const line of all.mistakes) assert.match(line, /no (?:Photoshop|photoshopCore) page was fetched|needs review/);
});

test("NQ2 the skill fetches the Photoshop app and photoshopCore class pages", () => {
  assert.equal(HOST_PAGES["photoshop.app"], "https://developer.adobe.com/photoshop/uxp/2022/ps-reference/classes/photoshop");
  assert.equal(HOST_PAGES["photoshop.core"], "https://developer.adobe.com/photoshop/uxp/2022/ps-reference/media/photoshopcore");
});

test("NQ2 wrong-class methods named in Adobe's report are flagged on the real docs", () => {
  const wrong = [
    "export const f = () => (photoshop.app.activeDocument as any).translate(1, 1);",
    "export const f = () => (photoshop.app as any).createLayer();",
    "export async function f(){ const p: any = await premierepro.Project.getActiveProject(); return p.setMute(true); }",
    "export async function f(){ const p = await premierepro.Project.getActiveProject(); const s = await p.getActiveSequence(); const t: any = await s.getVideoTrack(0); return t.getVideoTrackCount(); }",
    "export const f = () => (uxp.host as any).batchPlay([], {});"
  ];
  for (const body of wrong) {
    const found = review({ body }, REAL_DOCS);
    assert.ok(found.length > 0, body);
  }
  const right = [
    "export const f = () => photoshop.app.activeDocument.title;",
    "export const f = () => photoshop.app.showAlert(\"x\");",
    "export async function f(){ const p = await premierepro.Project.getActiveProject(); const s = await p.getActiveSequence(); return s.getVideoTrackCount(); }"
  ];
  for (const body of right) assert.deepEqual(review({ body }, REAL_DOCS), [], body);
});

test("NQ1 dynamic import and require of a host module are needs review", () => {
  for (const id of ["Q8", "Q9", "Q10", "Q53", "Q54"]) {
    const entry = byId(id);
    assert.ok(entry, id);
    assert.ok(review(entry, REAL_DOCS).length > 0, id);
  }
});

test("NQ3 a tagged template is a call", () => {
  for (const id of ["Q17", "Q18"]) assert.ok(review(byId(id), REAL_DOCS).length > 0, id);
});

test("NQ4 decorators parse, and a decorated file is not needs review by default", () => {
  assert.doesNotThrow(() => parseSource("function d(t: any){ return t; }\n@d class X { @d m(){} }\nexport const x = new X();", "src/x.ts"));
  assert.ok(review(byId("Q30"), REAL_DOCS).length > 0, "a rename in a decorated class method outside the modal is still rejected");
  assert.deepEqual(review({ body: "function d(t: any){ return t; }\n@d class Info { title(){ return photoshop.app.activeDocument.title; } }\nexport const f = () => new Info().title();" }, REAL_DOCS), []);
});

test("NQ5 a rename in a then-chain returned from the modal callback passes", () => {
  const body = "export async function f(n: string){ await photoshop.core.executeAsModal(async () => { const layer = photoshop.app.activeDocument.activeLayers[0]; return Promise.resolve().then(() => { layer.name = n; }); }, { commandName: \"Rename\" }); }";
  assert.deepEqual(review({ body, kind: "rename" }, REAL_DOCS), []);
  assert.ok(review(byId("Q21"), REAL_DOCS).length > 0, "a then after the awaited modal is still outside it");
});

test("NQ15 every needs-review finding says why", () => {
  for (const entry of RERUN6_CASES.filter((item) => item.expect === "fail")) {
    for (const line of review(entry, REAL_DOCS)) {
      if (!/needs review/.test(line)) continue;
      assert.match(line, /needs review(?:[.:]| because| —| \()\s*\S[^|]{12,}/, `${entry.id}: ${line}`);
    }
  }
});

function weak(body) {
  const src = body.startsWith("import")
    ? WEAK6_HEADER.replace('import test from "node:test";\n', `import test from "node:test";\n${body.split("\n")[0]}\n`) + body.split("\n").slice(1).join("\n")
    : WEAK6_HEADER + body;
  return strongAssertions(src, "test/layers.test.mjs", ["src/layers.ts"]);
}

test("NQ6 NQ7 Adobe's 24 weak and strong test cases", () => {
  const misses = [];
  for (const [id, expect, body] of WEAK6_CASES) {
    const result = weak(body);
    if ((expect === "reject") === result.ok) misses.push(`${id}: ${result.ok ? "passed" : result.reason}`);
  }
  console.log(`rerun6 weak tests: ${WEAK6_CASES.length - misses.length}/${WEAK6_CASES.length}`);
  assert.equal(misses.join("\n"), "");
});

test("NQ6 NQ7 further skip, todo, swallow and table cases", () => {
  const H = "import test, { describe, it } from \"node:test\";\nimport assert from \"node:assert/strict\";\nimport { listLayers } from \"../src/layers.ts\";\nconst fx = { app: { activeDocument: { layers: [{ id: 1, name: \"Top\" }] } } };\n";
  const W = "[{ id: 1, name: \"Top\" }]";
  const cases = [
    ["it.skip in describe", false, `describe("s", () => { it.skip("x", () => { assert.deepEqual(listLayers(fx), ${W}); }); });`],
    ["todo option", false, `test("x", { todo: "later" }, () => { assert.deepEqual(listLayers(fx), ${W}); });`],
    ["t.skip()", false, `test("x", (t) => { t.skip("no"); assert.deepEqual(listLayers(fx), ${W}); });`],
    ["describe skip option", false, `describe("s", { skip: true }, () => { it("x", () => { assert.deepEqual(listLayers(fx), ${W}); }); });`],
    ["helper only from a skipped test", false, `function check(){ assert.deepEqual(listLayers(fx), ${W}); }\ntest.skip("x", () => check());`],
    ["after throw", false, `test("x", () => { throw new Error("x"); assert.deepEqual(listLayers(fx), ${W}); });`],
    ["promise catch swallow", false, `test("x", async () => { await Promise.resolve().then(() => assert.deepEqual(listLayers(fx), [{ id: 9 }])).catch(() => {}); });`],
    ["xit", false, `xit("x", () => { assert.deepEqual(listLayers(fx), ${W}); });`],
    ["table with a trivial row", false, `const rows = [[fx, ${W}], [fx, []]];\ntest("x", () => { for (const [i, w] of rows) assert.deepEqual(listLayers(i), w); });`],
    ["helper given the feature output", false, `function check(i: any, w: any){ assert.deepEqual(listLayers(i), w); }\ntest("x", () => check(fx, listLayers(fx)));`],
    ["catch that rethrows", true, `test("x", () => { try { assert.deepEqual(listLayers(fx), ${W}); } catch (e) { throw e; } });`],
    ["skip false", true, `test("x", { skip: false }, () => { assert.deepEqual(listLayers(fx), ${W}); });`],
    ["forEach table", true, `const rows = [{ input: fx, want: ${W} }];\ntest("x", () => { rows.forEach(({ input, want }) => assert.deepEqual(listLayers(input), want)); });`],
    ["helper chain", true, `function inner(i: any, w: any){ assert.deepEqual(listLayers(i), w); }\nfunction outer(i: any){ inner(i, ${W}); }\ntest("x", () => outer(fx));`],
    ["subtest", true, `test("x", async (t) => { await t.test("y", () => { assert.deepEqual(listLayers(fx), ${W}); }); });`]
  ];
  for (const [id, ok, body] of cases) assert.equal(strongAssertions(H + body, "test/layers.test.mjs", ["src/layers.ts"]).ok, ok, id);
});

test("NQ8 NQ9 Adobe's 22 static and honest UI cases", () => {
  const misses = [];
  for (const [id, expect, rel, src] of UI6_CASES) {
    const ok = panelRendersState(src, rel) === true;
    if ((expect === "reject") === ok) misses.push(id);
  }
  console.log(`rerun6 UI cases: ${UI6_CASES.length - misses.length}/${UI6_CASES.length}`);
  assert.deepEqual(misses, []);
});

test("NQ13 after a chat stop, session next pauses instead of returning record again", () => {
  const out = temp("uxp-nq13-");
  fs.mkdirSync(path.join(out, "domain"), { recursive: true });
  fs.writeFileSync(path.join(out, "domain", "session.json"), JSON.stringify({ outcome: "awaiting-agent-implementation" }));
  fs.writeFileSync(path.join(out, "domain", "record-result.json"), JSON.stringify({ state: "script-change-stopped", say: "You chose stop for this exact script change." }));
  fs.writeFileSync(path.join(out, "session.json"), JSON.stringify({ docs: { ok: true }, asks: [] }));
  for (let round = 0; round < 3; round += 1) {
    const next = specialize({ ok: true, action: "record" }, out);
    assert.equal(next.action, "paused");
    assert.equal(next.command, "");
    assert.match(next.reask, /record .*--reask/);
    assert.match(next.next, /Do not run record again/);
  }
});

test("NQ14 the domain offline message names what failed, never 'Failed in the main docs: none'", () => {
  const out = temp("uxp-nq14-");
  fs.mkdirSync(path.join(out, "domain"), { recursive: true });
  fs.mkdirSync(path.join(out, "docs"), { recursive: true });
  fs.writeFileSync(path.join(out, "session.json"), JSON.stringify({ docs: { ok: true, failed: [], stale: [] }, asks: [] }));
  fs.writeFileSync(path.join(out, "domain", "session.json"), JSON.stringify({ outcome: "docs-incomplete", docs: { failed: ["photoshop.layer", "photoshop.core"] } }));
  const named = domainDocsNext(out, { ok: false });
  assert.doesNotMatch(named.next, /: none/);
  assert.match(named.next, /Failed in the domain step: photoshop\.layer, photoshop\.core/);
  fs.writeFileSync(path.join(out, "domain", "session.json"), JSON.stringify({ outcome: "docs-incomplete" }));
  fs.rmSync(path.join(out, "domain-docs-state.json"), { force: true });
  const unnamed = domainDocsNext(out, { ok: false });
  assert.doesNotMatch(unnamed.next, /none/);
  assert.match(unnamed.next, /did not record a fresh fetch/);
});

function plantedTooling() {
  const top = temp("uxp-nq11-");
  const skill = path.join(top, "proj", ".agents", "skills", "uxp-assistant");
  fs.mkdirSync(skill, { recursive: true });
  const prefix = path.join(path.dirname(skill), ".uxp-tooling");
  return { top, skill, prefix, modules: path.join(prefix, "node_modules") };
}

test("NQ11 the whole pinned tree is hashed: a changed dependency file, an extra package and a wrong version are refused", () => {
  const { modules } = plantedTooling();
  linkTree(repoModules, modules);
  assert.deepEqual(verifyTree(modules, { fresh: true }), { ok: true });
  const metaBolt = path.join(modules, "meta-bolt", "package.json");
  const original = fs.readFileSync(metaBolt, "utf8");
  replaceFile(metaBolt, original.replace(/\}\s*$/, ", \"x\": 1 }\n"));
  assert.match(verifyInstaller(modules).reason, /meta-bolt@.* do not match the pinned sha256/);
  replaceFile(metaBolt, original);
  assert.equal(verifyInstaller(modules).ok, true);
  const anyJs = fs.readdirSync(path.join(modules, "prettier")).find((name) => name.endsWith(".js") || name.endsWith(".mjs"));
  replaceFile(path.join(modules, "prettier", anyJs), "process.exit(0);\n");
  assert.match(verifyTree(modules, { fresh: true }).reason, /prettier@.* do not match/);
  fs.rmSync(path.join(modules, "prettier"), { recursive: true, force: true });
  linkTree(path.join(repoModules, "prettier"), path.join(modules, "prettier"));
  fs.mkdirSync(path.join(modules, "planted"), { recursive: true });
  fs.writeFileSync(path.join(modules, "planted", "package.json"), "{\"name\":\"planted\",\"version\":\"1.0.0\"}");
  assert.match(verifyTree(modules, { fresh: true }).reason, /node_modules\/planted is in .* but not in the pinned lock/);
});

test("NQ11 symlinks that leave the pinned folder are refused", () => {
  const linked = plantedTooling();
  fs.mkdirSync(linked.prefix, { recursive: true });
  fs.symlinkSync(repoModules, linked.modules, "dir");
  assert.match(verifyInstaller(linked.modules).reason, /through a symlink/);
  const pkg = plantedTooling();
  linkTree(repoModules, pkg.modules);
  fs.rmSync(path.join(pkg.modules, "bolt-uxp"), { recursive: true, force: true });
  fs.symlinkSync(path.join(repoModules, "bolt-uxp"), path.join(pkg.modules, "bolt-uxp"), "dir");
  assert.match(verifyTree(pkg.modules, { fresh: true }).reason, /bolt-uxp is a symlink/);
  const bin = plantedTooling();
  linkTree(repoModules, bin.modules);
  fs.symlinkSync("/bin/sh", path.join(bin.modules, ".bin", "escape"));
  assert.match(verifyTree(bin.modules, { fresh: true }).reason, /points outside the pinned tooling/);
});

test("NQ11 npm is run by absolute path, never by a PATH lookup", () => {
  const { top } = plantedTooling();
  const fakeBin = path.join(top, "bin");
  fs.mkdirSync(fakeBin);
  fs.writeFileSync(path.join(fakeBin, "npm"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  const saved = process.env.PATH;
  process.env.PATH = `${fakeBin}${path.delimiter}${saved}`;
  try {
    const npm = npmCommand();
    assert.equal(npm.command, process.execPath);
    assert.match(npm.args[0], /npm-cli\.js$/);
    assert.equal(path.isAbsolute(npm.args[0]), true);
    assert.equal(npm.args[0].startsWith(fakeBin), false);
  } finally {
    process.env.PATH = saved;
  }
  const source = fs.readFileSync(new URL("../.claude/skills/uxp-assistant/scripts/lib/scaffold.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /spawnSync\((?:options\.npm \|\| )?"npm|"npm\.cmd"/);
});

test("NQ12 a broken shared tooling folder is repaired, and a stale lock is taken over", () => {
  const { top, skill, prefix, modules } = plantedTooling();
  linkTree(repoModules, modules);
  fs.rmSync(path.join(modules, "bolt-uxp", "package.json"));
  const lines = [];
  const entry = ensureInstaller({ skillDirectory: skill, npm: fakeCiScript(top), notify: (text) => lines.push(text) });
  assert.equal(entry, path.join(modules, "create-bolt-uxp", "dist", "index.js"));
  assert.match(lines[0], /failed verification/);
  assert.match(lines.at(-1), /the broken copy was replaced/);
  assert.equal(verifyTree(modules, { fresh: true }).ok, true);
  assert.equal(fs.existsSync(`${prefix}.lock`), false);
  assert.deepEqual(fs.readdirSync(path.dirname(prefix)).filter((name) => /staging|\.old-/.test(name)), []);
  fs.mkdirSync(`${prefix}.lock`);
  fs.writeFileSync(path.join(`${prefix}.lock`, "owner.json"), JSON.stringify({ pid: 2 ** 22 + 12345, at: 0 }));
  const release = acquireLock(`${prefix}.lock`, { waitMs: 2000 });
  release();
  assert.equal(fs.existsSync(`${prefix}.lock`), false);
});

test("NQ12 a failed install leaves an actionable error and no half-written tree", () => {
  const { top, skill, prefix } = plantedTooling();
  const failing = path.join(top, "fail.sh");
  fs.writeFileSync(failing, "#!/bin/sh\necho offline >&2\nexit 1\n", { mode: 0o755 });
  assert.throws(() => ensureInstaller({ skillDirectory: skill, npm: failing }), /npm ci exited 1\. npm said: offline.*run the same command again/s);
  assert.equal(fs.existsSync(prefix), false);
  assert.equal(fs.existsSync(`${prefix}.lock`), false);
});

test("NQ12 two sessions installing the shared tooling at once both get one verified tree", async () => {
  const { top, prefix, modules } = plantedTooling();
  const npm = fakeCiScript(top, { delayMs: 600, marker: path.join(top, "installs.txt") });
  const script = path.join(top, "install.mjs");
  const lib = new URL("../.claude/skills/uxp-assistant/scripts/lib/tooling.mjs", import.meta.url).href;
  fs.writeFileSync(script, `import { installTree } from ${JSON.stringify(lib)};\nconst result = installTree(${JSON.stringify(prefix)}, { npm: ${JSON.stringify(npm)} });\nconsole.log(JSON.stringify(result));\n`);
  const run = () => new Promise((resolve) => {
    const child = spawn(process.execPath, [script], { stdio: ["ignore", "pipe", "pipe"] });
    let text = "";
    child.stdout.on("data", (chunk) => { text += chunk; });
    child.stderr.on("data", (chunk) => { text += chunk; });
    child.on("close", (code) => resolve({ code, text }));
  });
  const [a, b] = await Promise.all([run(), run()]);
  assert.equal(a.code, 0, a.text);
  assert.equal(b.code, 0, b.text);
  assert.equal(fs.readFileSync(path.join(top, "installs.txt"), "utf8").trim().split("\n").length, 1, "the second session reused the first install");
  assert.equal(verifyTree(modules, { fresh: true }).ok, true);
  assert.equal(fs.existsSync(`${prefix}.lock`), false);
  assert.equal(installTree.length >= 1, true);
});
