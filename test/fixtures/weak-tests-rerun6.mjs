// Adobe's rerun6 weak-test cases (fresh/weak6.mjs), copied unchanged. Labels are Adobe's.
const H = `import test from "node:test";\nimport assert from "node:assert/strict";\nimport { listLayers, renameSelected } from "../src/layers.ts";\nconst fx = { app: { activeDocument: { activeLayers: [{ id: 2 }], layers: [{ id: 1, name: "Top", layers: [] }, { id: 2, name: "Bottom", layers: [] }] } } };\n`;
const W = "[{ id: 1, name: \"Top\", depth: 0, selected: false }, { id: 2, name: \"Bottom\", depth: 0, selected: true }]";
export const WEAK6_CASES = [
 ["W1 dead branch", "reject", `test("x", () => { if (false) assert.deepEqual(listLayers(fx), ${W}); });`],
 ["W2 test.skip", "reject", `test.skip("x", () => { assert.deepEqual(listLayers(fx), ${W}); });`],
 ["W3 skip option", "reject", `test("x", { skip: true }, () => { assert.deepEqual(listLayers(fx), ${W}); });`],
 ["W4 never-called helper", "reject", `function never(){ assert.deepEqual(listLayers(fx), ${W}); }\ntest("x", () => { assert.ok(true); });`],
 ["W5 try/catch swallow", "reject", `test("x", () => { try { assert.deepEqual(listLayers(fx), [{ id: 9, name: "Nope" }]); } catch {} });`],
 ["W6 match on String()", "reject", `test("x", () => { assert.match(String(listLayers(fx)), /object/); });`],
 ["W7 ?? fallback hides empty", "reject", `test("x", () => { assert.equal(listLayers(fx)[0]?.name ?? "Top", "Top"); });`],
 ["W8 || expected fallback", "reject", `const E = ${W};\ntest("x", () => { assert.deepEqual(listLayers({ app: { activeDocument: null } }).length ? listLayers(fx) : E, E); });`],
 ["W9 structuredClone of own output", "reject", `test("x", () => { const want = structuredClone(listLayers(fx)); assert.deepEqual(listLayers(fx), want); });`],
 ["W10 JSON round-trip of own output", "reject", `test("x", () => { const want = JSON.parse(JSON.stringify(listLayers(fx))); assert.deepEqual(listLayers(fx), want); });`],
 ["W11 test.todo", "reject", `test.todo("x", () => { assert.deepEqual(listLayers(fx), ${W}); });`],
 ["W12 assertion after early return", "reject", `test("x", () => { return; assert.deepEqual(listLayers(fx), ${W}); });`],
 ["W13 String length compare", "reject", `test("x", () => { assert.equal(JSON.stringify(listLayers(fx)).length, 97); });`],
 ["W14 describe.skip", "reject", `import { describe, it } from "node:test";\ndescribe.skip("s", () => { it("x", () => { assert.deepEqual(listLayers(fx), ${W}); }); });`],
 ["S1 table-driven loop", "pass", `const cases = [[fx, ${W}]];\ntest("x", () => { for (const [input, want] of cases) assert.deepEqual(listLayers(input), want); });`],
 ["S2 helper with expected param", "pass", `function check(input: any, want: any){ assert.deepEqual(listLayers(input), want); }\ntest("x", () => { check(fx, ${W}); });`],
 ["S3 async rename equal", "pass", `test("x", async () => { const ps = { app: { activeDocument: { activeLayers: [{ id: 2, name: "Old" }] } }, core: { executeAsModal: async (f: any) => f() } }; assert.equal(await renameSelected(ps, "New"), "New"); });`],
 ["S4 t.assert.deepStrictEqual", "pass", `test("x", (t) => { t.assert.deepStrictEqual(listLayers(fx), ${W}); });`],
 ["S5 map/join derived string", "pass", `test("x", () => { assert.equal(listLayers(fx).map((r) => r.name).join(","), "Top,Bottom"); });`],
 ["S6 namespace import", "pass", `import * as L from "../src/layers.ts";\ntest("x", () => { assert.deepEqual(L.listLayers(fx), ${W}); });`],
 ["S7 describe/it", "pass", `import { describe, it } from "node:test";\ndescribe("layers", () => { it("lists", () => { assert.deepEqual(listLayers(fx), ${W}); }); });`],
 ["S8 partialDeepStrictEqual on row", "pass", `test("x", () => { assert.partialDeepStrictEqual(listLayers(fx)[1], { name: "Bottom", selected: true }); });`],
 ["S9 destructured result", "pass", `test("x", () => { const [first] = listLayers(fx); assert.equal(first.name, "Top"); });`],
 ["S10 expected in local const object", "pass", `const WANT = ${W};\ntest("x", () => { assert.deepStrictEqual(listLayers(fx), WANT); });`],
];
export const WEAK6_HEADER = H;
