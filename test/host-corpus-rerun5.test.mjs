import assert from "node:assert/strict";
import { test } from "node:test";
import { hostCallFindings, renameFindings } from "../.claude/skills/uxp-assistant/scripts/lib/host-flow.mjs";
import { DOCS, OLD_CASES } from "./fixtures/host-corpus-54.mjs";
import { BROKEN_SYNTAX, DOCS_RERUN5, FRESH_CASES, GLOBALS } from "./fixtures/host-corpus-rerun5.mjs";

const OLD_GLOBALS = `export const uxp = require("uxp") as typeof import("uxp");
const hostName = uxp && uxp.host && uxp.host.name;
export const photoshop = (
  hostName === "photoshop" ? require("photoshop") : {}
) as typeof import("photoshop");
export const premierepro = (
  hostName === "premierepro" ? require("premierepro") : {}
) as typeof import("premierepro");
`;

function findings(entry, docs, globals) {
  const rel = /<(div|sp-)/.test(entry.body) ? "src/feature.tsx" : "src/feature.ts";
  const feature = [{ rel: "src/globals.ts", body: globals }, ...(entry.extra || []), { rel, body: entry.body }];
  return entry.kind === "rename" ? renameFindings(feature, docs) : hostCallFindings(feature, docs);
}

function score(list, docs, globals) {
  const tally = { tp: 0, fp: 0, fn: 0, tn: 0, mistakes: [] };
  for (const entry of list) {
    const found = findings(entry, docs, globals);
    const hit = found.length > 0;
    if (entry.expect === "fail" && hit) tally.tp += 1;
    else if (entry.expect === "fail") {
      tally.fn += 1;
      tally.mistakes.push(`${entry.id} passed silently`);
    } else if (hit) {
      tally.fp += 1;
      tally.mistakes.push(`${entry.id} was rejected: ${found.join(" | ")}`);
    } else tally.tn += 1;
    if (entry.includes) assert.ok(found.some((item) => item.includes(entry.includes)), `${entry.id}: ${found.join(" | ")}`);
  }
  return tally;
}

test("rerun5 corpus: Adobe's 89 fresh cases plus the old 54, precision and recall", () => {
  assert.equal(FRESH_CASES.length, 89);
  assert.equal(OLD_CASES.length, 54);
  const fresh = score(FRESH_CASES, DOCS_RERUN5, GLOBALS);
  const old = score(OLD_CASES, DOCS, OLD_GLOBALS);
  const combined = {
    tp: fresh.tp + old.tp,
    fp: fresh.fp + old.fp,
    fn: fresh.fn + old.fn,
    tn: fresh.tn + old.tn
  };
  const precision = combined.tp / (combined.tp + combined.fp);
  const recall = combined.tp / (combined.tp + combined.fn);
  console.log(`rerun5 fresh tp ${fresh.tp} fp ${fresh.fp} fn ${fresh.fn} tn ${fresh.tn} cases ${FRESH_CASES.length}`);
  console.log(`combined host corpus precision ${precision} recall ${recall} tp ${combined.tp} fp ${combined.fp} fn ${combined.fn} tn ${combined.tn} cases ${FRESH_CASES.length + OLD_CASES.length}`);
  assert.equal([...fresh.mistakes, ...old.mistakes].join("\n"), "");
  assert.equal(precision, 1);
  assert.equal(recall, 1);
});

test("NU7 the three harness-typo cases do not parse and are needs review, not a pass", () => {
  for (const entry of BROKEN_SYNTAX) {
    const found = findings(entry, DOCS_RERUN5, GLOBALS);
    assert.ok(found.some((item) => /parse needs review/.test(item)), `${entry.id}: ${found.join(" | ")}`);
  }
});

test("NU1 every stored or indirect host call has a needs-review or undocumented reason", () => {
  const reasons = {
    "B1 ": /stored in an object/, "B2 ": /stored in an object/, "B3 ": /stored in an object/, "B4 ": /closure return|stored/, "B5 ": /class field|stored/,
    "B6 ": /getter|stored/, "B7 ": /Proxy/, "B10 ": /globalThis or window\.require/, "B11 ": /globalThis or window\.require/, "B12 ": /eval/, "B13 ": /new Function/,
    "B14 ": /\[dynamic\] needs review/, "B15 ": /spread|stored/, "B17 ": /generator/, "B20 ": /WeakRef|stored/, "B23 ": /Object\.values/, "B24 ": /destructur|stored/,
    "B26 ": /for-of|stored/, "B27 ": /not a Layer member/, "B28 ": /Reflect/
  };
  for (const entry of FRESH_CASES.filter((item) => item.id.startsWith("B"))) {
    const found = findings(entry, DOCS_RERUN5, GLOBALS);
    assert.ok(found.length > 0, `${entry.id} passed silently`);
    const key = Object.keys(reasons).find((prefix) => entry.id.startsWith(prefix));
    if (key) assert.match(found.join(" | "), reasons[key], entry.id);
  }
});

test("NU2 every rename write through a stored host or outside the modal is rejected", () => {
  for (const entry of FRESH_CASES.filter((item) => /^R\d+ /.test(item.id))) {
    const found = findings(entry, DOCS_RERUN5, GLOBALS);
    assert.ok(found.length > 0, `${entry.id} passed silently`);
  }
});

test("NU3 forEach/map writes, a cross-module helper, and a Vue reactive item.name inside the modal pass", () => {
  for (const id of ["L19 ", "L21 ", "L25 ", "L26 ", "L44 "]) {
    const entry = FRESH_CASES.find((item) => item.id.startsWith(id));
    assert.deepEqual(findings(entry, DOCS_RERUN5, GLOBALS), [], entry.id);
  }
});

test("NU9 a method is matched against its owner page, so layer.rename fails and layer.duplicate passes", () => {
  const body = (call) => `import { photoshop } from "./globals";\nexport async function f(){ const layer = photoshop.app.activeDocument.activeLayers[0]; return photoshop.core.executeAsModal(async () => ${call}, { commandName: "x" }); }\n`;
  const run = (call) => hostCallFindings([{ rel: "src/globals.ts", body: GLOBALS }, { rel: "src/f.ts", body: body(call) }], DOCS_RERUN5);
  assert.match(run("layer.rename(\"x\")").join(" "), /not a Layer member/);
  assert.deepEqual(run("layer.duplicate()"), []);
  assert.match(run("photoshop.action.subscribeToEverything()").join(" "), /not a photoshopAction member/);
  assert.deepEqual(run("photoshop.action.batchPlay([], {})"), []);
});
