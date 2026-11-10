import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Deterministic checks for a machine that has this tree.
 * No model call, no git checkout, and no Adobe host.
 * The default set does not open a browser. A browser result here is this machine only.
 */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = new Set(process.argv.slice(2));
const files = ["test/guards.test.mjs", "test/authoring.test.mjs", "test/stages.test.mjs", "test/approval-graph.test.mjs", "test/skill-standalone.test.mjs", "test/runtime-parity.test.mjs", "test/dashboard-walk.test.mjs", "test/realuse-bugs.test.mjs", "test/follow-next.test.mjs", "test/rerun-fixes.test.mjs", "test/rerun2.test.mjs", "test/rerun3.test.mjs", "test/host-corpus.test.mjs", "test/rerun4.test.mjs", "test/host-corpus-rerun5.test.mjs", "test/rerun5.test.mjs", "test/rerun6.test.mjs", "test/rerun7.test.mjs", "test/dashboard-session.test.mjs", "test/tooling-manifest.test.mjs"];
if (args.has("--acceptance")) files.push("test/acceptance.test.mjs");
if (args.has("--stacks")) {
  console.log("--stacks installs Vue, Svelte, and the WebView document and runs their package scripts. It is not a browser and not a host pass.");
  files.push("test/stacks.test.mjs");
}
if (args.has("--preview")) files.push("test/preview.test.mjs");
if (args.has("--dashboard")) files.push("test/dashboard-render.test.mjs");

console.log("UXP Assistant box runner");
console.log("No model call. No git checkout. Photoshop and Premiere are not launched.");
console.log("A browser result from --preview or --dashboard is this machine only. It is not another machine's result and not a host pass.");
if (args.has("--acceptance")) {
  console.log("--acceptance runs setup, build, and package on this machine. It needs network for docs and npm install. It is not a browser and not a host pass.");
}
if (!args.has("--preview") && !args.has("--dashboard")) {
  console.log("Browser checks are not in the default set. Pass --preview or --dashboard on this machine to run them here.");
}

const result = spawnSync(process.execPath, ["--import", "./test/preload.mjs", "--test", ...files], { cwd: root, stdio: "inherit" });
process.exit(result.status === null ? 1 : result.status);
