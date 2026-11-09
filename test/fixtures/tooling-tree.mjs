import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const repoModules = path.join(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.."), "node_modules");

/**
 * A copy of the repo's verified node_modules made of hard links (a byte copy when links are not
 * possible), with each .bin symlink recreated relative to the copy. Tests replace a file by
 * unlinking it first, so the repo's own tree is never changed.
 */
export function linkTree(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const source = path.join(from, entry.name);
    const target = path.join(to, entry.name);
    if (entry.isSymbolicLink()) fs.symlinkSync(fs.readlinkSync(source), target);
    else if (entry.isDirectory()) linkTree(source, target);
    else {
      try {
        fs.linkSync(source, target);
      } catch {
        fs.copyFileSync(source, target);
      }
    }
  }
}

/** Replace a file's bytes without touching the hard-linked original. */
export function replaceFile(file, text) {
  fs.unlinkSync(file);
  fs.writeFileSync(file, text);
}

/** A stand-in for `npm ci --prefix <dir>`: links the repo tree into <dir>/node_modules after an optional delay. */
export function fakeCiScript(dir, { delayMs = 0, marker = "" } = {}) {
  const script = path.join(dir, `fake-ci-${delayMs}.mjs`);
  const fixture = fileURLToPath(import.meta.url);
  fs.writeFileSync(script, `import fs from "node:fs";
import path from "node:path";
import { linkTree, repoModules } from ${JSON.stringify(fixture)};
const args = process.argv.slice(2);
const prefix = args[args.indexOf("--prefix") + 1];
if (${JSON.stringify(marker)}) fs.appendFileSync(${JSON.stringify(marker)}, process.pid + "\\n");
Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ${delayMs});
linkTree(repoModules, path.join(prefix, "node_modules"));
`);
  const runner = path.join(dir, `fake-npm-${delayMs}.sh`);
  fs.writeFileSync(runner, `#!/bin/sh\n"${process.execPath}" "${script}" "$@"\n`);
  fs.chmodSync(runner, 0o755);
  return runner;
}
