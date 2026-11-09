import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Node 21 and newer treat a positional `node --test` argument as a file or glob.
// A bare directory name is loaded as a module and fails with "Cannot find module".
// Pass each test file path instead. That works on every supported Node version.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readmeTest = path.join("test", "readme-npm-test.mjs");

function npmBin() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function suiteFiles() {
  return readdirSync(path.join(root, "test"))
    .filter((name) => name.endsWith(".test.mjs") && path.join("test", name) !== readmeTest)
    .sort()
    .map((name) => path.join("test", name));
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit" });
  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status === null ? 1 : result.status);
}

function runSuite() {
  const files = suiteFiles();
  if (files.length === 0) {
    console.error("no test files");
    process.exit(1);
  }
  console.error(`test files: ${files.join(" ")}`);
  run(process.execPath, ["--test", ...files]);
  console.error("UXP_BOILERPLATE_TESTS");
  run(npmBin(), ["test", "--prefix", "skill-boilerplate"]);
}

if (process.env.UXP_README_NPM_TEST === "1") {
  runSuite();
} else {
  run(process.execPath, ["--test", readmeTest]);
}
