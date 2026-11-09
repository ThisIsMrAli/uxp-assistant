import assert from "node:assert/strict";
import { test } from "node:test";
import { hostCallFindings, renameFindings } from "../.claude/skills/uxp-assistant/scripts/lib/host-flow.mjs";
import { DOCS, OLD_CASES, hostReexport } from "./fixtures/host-corpus-54.mjs";



const GLOBALS = `export const uxp = require("uxp") as typeof import("uxp");
const hostName = uxp && uxp.host && uxp.host.name;
export const photoshop = (
  hostName === "photoshop" ? require("photoshop") : {}
) as typeof import("photoshop");
export const premierepro = (
  hostName === "premierepro" ? require("premierepro") : {}
) as typeof import("premierepro");
`;

const globals = { rel: "src/globals.ts", body: GLOBALS };

function files(body, extra = []) {
  return [globals, ...extra, { rel: "src/feature.ts", body }];
}

function caught(kind, body, extra = []) {
  const feature = files(body, extra);
  const found = kind === "rename" ? renameFindings(feature, DOCS) : hostCallFindings(feature, DOCS);
  return found;
}

const cases = OLD_CASES;

test("host call and rename corpus reports precision and recall", () => {
  let tp = 0;
  let fp = 0;
  let fn = 0;
  let tn = 0;
  const mistakes = [];
  for (const entry of cases) {
    const found = caught(entry.kind, entry.body, entry.extra);
    const hit = found.length > 0;
    if (entry.expect === "fail" && hit) tp += 1;
    else if (entry.expect === "fail") {
      fn += 1;
      mistakes.push(`${entry.id} was not caught`);
    } else if (hit) {
      fp += 1;
      mistakes.push(`${entry.id} was rejected: ${found.join(" | ")}`);
    } else tn += 1;
    if (entry.includes) assert.ok(found.some((item) => item.includes(entry.includes)), `${entry.id}: ${found.join(" | ")}`);
    if (entry.excludes) assert.equal(found.some((item) => item.includes(entry.excludes)), false, `${entry.id}: ${found.join(" | ")}`);
  }
  const precision = tp / (tp + fp);
  const recall = tp / (tp + fn);
  console.log(`host corpus precision ${precision} recall ${recall} tp ${tp} fp ${fp} fn ${fn} tn ${tn} cases ${cases.length}`);
  assert.equal(mistakes.join("\n"), "");
  assert.equal(precision, 1);
  assert.equal(recall, 1);
  assert.ok(tp > 0);
  assert.ok(tn > 0);
});
