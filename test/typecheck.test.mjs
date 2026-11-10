import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { prepareStarter } from "../.claude/skills/uxp-assistant/scripts/lib/starter.mjs";
import { hasTypescript, parseTsc, typecheck } from "../.claude/skills/uxp-assistant/scripts/lib/typecheck.mjs";

const made = [];
function temp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "uxp-types-"));
  made.push(dir);
  return dir;
}
process.on("exit", () => made.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));

const OUTPUT = `src/api/themes.ts(81,27): error TS7053: Element implicitly has an 'any' type because expression of type 'number' can't be used to index type 'X'.
  No index signature with a parameter of type 'number' was found on type 'X'.
src/main.tsx(12,9): error TS2339: Property 'zap' does not exist on type 'Project'.
src/lib/qr.test.ts(3,22): error TS5097: An import path can only end with a '.ts' extension when 'allowImportingTsExtensions' is enabled.
src/lib/qr.ts(40,1): error TS2304: Cannot find name 'Buffer'.
Found 4 errors in 4 files.
`;

function withTsc(extra = {}) {
  const dir = temp();
  fs.writeFileSync(path.join(dir, "tsconfig.json"), JSON.stringify({ compilerOptions: { jsx: "react-jsx" }, ...extra }));
  fs.mkdirSync(path.join(dir, "node_modules", ".bin"), { recursive: true });
  fs.writeFileSync(path.join(dir, "node_modules", ".bin", "tsc"), "#!/bin/sh\n");
  fs.mkdirSync(path.join(dir, "src"), { recursive: true });
  return dir;
}

test("compiler output becomes one record per error, with the indented lines as its detail", () => {
  const errors = parseTsc(OUTPUT);
  assert.equal(errors.length, 4);
  assert.deepEqual(errors[1], { file: "src/main.tsx", line: 12, column: 9, code: "TS2339", message: "Property 'zap' does not exist on type 'Project'." });
  assert.match(errors[0].detail, /No index signature/);
  assert.deepEqual(parseTsc(""), []);
});

test("only errors in the files the assistant wrote are reported, each with a fix", () => {
  const project = withTsc();
  const calls = [];
  const runImpl = (command, args, options) => {
    calls.push({ command, args, cwd: options.cwd });
    return { status: 2, stdout: OUTPUT, stderr: "" };
  };
  const result = typecheck(project, ["src/main.tsx", "src/lib/qr.test.ts", "src/lib/qr.ts"], { runImpl });
  assert.equal(result.ran, true);
  assert.equal(result.total, 3, "the starter's themes.ts error is not counted");
  assert.deepEqual(result.findings.map((item) => `${item.file}:${item.line}`), ["src/main.tsx:12", "src/lib/qr.test.ts:3", "src/lib/qr.ts:40"]);
  assert.ok(result.findings.every((item) => item.severity === "error" && item.id === "type-error" && item.fix));
  assert.match(result.findings[0].fix, /find/);
  assert.match(result.findings[1].fix, /allowImportingTsExtensions/);
  assert.deepEqual(calls[0].args, ["--noEmit", "--pretty", "false"]);
  assert.equal(calls[0].cwd, project);
});

test("a long list is cut with a count, and a clean run has no findings", () => {
  const project = withTsc();
  const many = Array.from({ length: 20 }, (_, index) => `src/a.ts(${index + 1},1): error TS2322: Type 'x' is not assignable to type 'y'.`).join("\n");
  const cut = typecheck(project, ["src/a.ts"], { runImpl: () => ({ status: 2, stdout: many, stderr: "" }) });
  assert.equal(cut.total, 20);
  assert.equal(cut.findings.length, 13);
  assert.match(cut.findings.at(-1).text, /8 more type errors/);
  const clean = typecheck(project, ["src/a.ts"], { runImpl: () => ({ status: 0, stdout: "", stderr: "" }) });
  assert.deepEqual(clean, { ran: true, findings: [], total: 0 });
});

test("a project with no tsconfig or no compiler is not type checked", () => {
  const dir = temp();
  assert.equal(hasTypescript(dir), false);
  assert.deepEqual(typecheck(dir, ["src/a.ts"], { runImpl: () => { throw new Error("must not run"); } }), { ran: false, findings: [], total: 0 });
  fs.writeFileSync(path.join(dir, "tsconfig.json"), "{}");
  assert.equal(hasTypescript(dir), false, "tsconfig without node_modules/.bin/tsc");
});

test("the starter gets .ts imports and, for React, the Spectrum element types, once", () => {
  const dir = withTsc({ compilerOptions: { composite: true, strict: true } });
  const first = prepareStarter(dir, { framework: "react" });
  assert.equal(first.length, 2);
  const config = JSON.parse(fs.readFileSync(path.join(dir, "tsconfig.json"), "utf8"));
  assert.equal(config.compilerOptions.allowImportingTsExtensions, true);
  assert.equal(config.compilerOptions.noEmit, true);
  assert.equal(config.compilerOptions.composite, true, "other options are kept");
  const shim = fs.readFileSync(path.join(dir, "src", "spectrum.d.ts"), "utf8");
  assert.match(shim, /\[tag: `sp-\$\{string\}`\]/);
  assert.match(shim, /"uxp-panel"/);
  assert.deepEqual(prepareStarter(dir, { framework: "react" }), [], "a second run changes nothing");
});

test("a Vue or Svelte starter gets no JSX types, and a tsconfig with comments is left alone", () => {
  const vue = withTsc();
  prepareStarter(vue, { framework: "vue" });
  assert.equal(fs.existsSync(path.join(vue, "src", "spectrum.d.ts")), false);
  const commented = withTsc();
  fs.writeFileSync(path.join(commented, "tsconfig.json"), "{ // comment\n \"compilerOptions\": {} }");
  assert.deepEqual(prepareStarter(commented, { framework: "svelte" }), []);
  assert.match(fs.readFileSync(path.join(commented, "tsconfig.json"), "utf8"), /\/\/ comment/);
});

test("a Node function that the scaffold's older Node types lack is told apart from a host API", () => {
  const project = withTsc();
  const output = "src/lib/qr.test.ts(5,20): error TS2339: Property 'crc32' does not exist on type 'typeof import(\"zlib\")'.\n";
  const result = typecheck(project, ["src/lib/qr.test.ts"], { runImpl: () => ({ status: 2, stdout: output, stderr: "" }) });
  assert.match(result.findings[0].fix, /Node module/);
  assert.match(result.findings[0].fix, /as any/);
});

