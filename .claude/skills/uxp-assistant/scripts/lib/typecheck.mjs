import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

/**
 * `vite build` does not read types, so a plugin can build with a wrong property name or a bad argument.
 * This runs the project's own TypeScript and reports the errors in the files the assistant wrote.
 * The starter has errors of its own. They are not reported, because the assistant did not write them.
 */

const MAX_SHOWN = 12;

/** One error is a `file(line,col): error TSxxxx: message` line, then indented detail lines. */
export function parseTsc(output) {
  const errors = [];
  let current = null;
  for (const raw of String(output || "").split(/\r?\n/)) {
    const match = /^(.+?)\((\d+),(\d+)\):\s+error\s+(TS\d+):\s+(.*)$/.exec(raw);
    if (match) {
      current = { file: match[1].replaceAll("\\", "/"), line: Number(match[2]), column: Number(match[3]), code: match[4], message: match[5].trim() };
      errors.push(current);
    } else if (current && /^\s+\S/.test(raw)) {
      current.detail = `${current.detail ? `${current.detail} ` : ""}${raw.trim()}`.slice(0, 400);
    } else {
      current = null;
    }
  }
  return errors;
}

export function hasTypescript(project) {
  return fs.existsSync(path.join(project, "tsconfig.json")) && Boolean(tscBin(project));
}

function tscBin(project) {
  const names = process.platform === "win32" ? ["tsc.cmd", "tsc"] : ["tsc"];
  for (const name of names) {
    const file = path.join(project, "node_modules", ".bin", name);
    if (fs.existsSync(file)) return file;
  }
  return "";
}

/**
 * Run tsc in the project. Returns findings for the files in `authored` (paths relative to the project).
 * `runImpl(command, args, options)` is for tests.
 */
export function typecheck(project, authored, { runImpl = spawnSync } = {}) {
  if (!hasTypescript(project)) return { ran: false, findings: [], total: 0 };
  const result = runImpl(tscBin(project), ["--noEmit", "--pretty", "false"], { cwd: project, encoding: "utf8", timeout: 4 * 60 * 1000, shell: process.platform === "win32" });
  const output = `${result.stdout || ""}\n${result.stderr || ""}`;
  const mine = new Set(authored.map((file) => file.replaceAll("\\", "/")));
  const errors = parseTsc(output).filter((error) => mine.has(error.file.replace(/^\.\//, "")));
  const findings = errors.slice(0, MAX_SHOWN).map((error) => ({
    severity: "error",
    id: "type-error",
    file: error.file,
    line: error.line,
    text: `${error.code}: ${error.message}${error.detail ? ` (${error.detail})` : ""}`.slice(0, 520),
    fix: fixFor(error)
  }));
  if (errors.length > MAX_SHOWN) {
    findings.push({ severity: "error", id: "type-error-more", file: errors[MAX_SHOWN].file, text: `${errors.length - MAX_SHOWN} more type errors in the files you wrote.`, fix: "Fix the ones above first, then run check again to see the rest." });
  }
  return { ran: true, findings, total: errors.length };
}

const NODE_MODULE = /typeof import\("(?:node:)?(?:fs|path|zlib|os|crypto|util|buffer|stream|url|events|child_process|assert|timers|readline|http|https|net)"\)/;

function fixFor(error) {
  if (NODE_MODULE.test(error.message)) return "That is a Node module. The scaffold's @types/node is older than the Node that runs the tests, so a newer function has no type. Use another function, or call it through a cast, for example `(zlib as any).name`. The host's own docs do not cover it.";
  if (error.code === "TS2339" || error.code === "TS2551") return "The property is not on that type. Search the types file (`find`) for the real name, or fix the variable's type.";
  if (error.code === "TS2304" || error.code === "TS2552") return "The name is not defined or imported. Import it, or find the real name in the docs.";
  if (error.code === "TS2307") return "The module path is wrong or the package is not installed. Fix the path, or run `npm install <package>` in the project.";
  if (error.code === "TS7016") return "The package has no types. Add `declare module \"<name>\";` in a .d.ts file under src/, or install its @types package.";
  if (error.code === "TS5097") return "Add `allowImportingTsExtensions` to tsconfig.json, or drop the .ts from the import.";
  return "Change the code so it matches the type the compiler names, then run check again.";
}
