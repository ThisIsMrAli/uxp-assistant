import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { auditProject, authoredFiles, changedSinceBaseline, parseHostTypes, snapshotSource } from "../.claude/skills/uxp-assistant/scripts/lib/audit.mjs";
import { buildLibrary } from "../.claude/skills/uxp-assistant/scripts/lib/library.mjs";
import { TYPES, fakeAdobe } from "./fixtures/fake-adobe.mjs";

const made = [];
function temp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "uxp-audit-"));
  made.push(dir);
  return dir;
}
process.on("exit", () => made.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));

const CONFIG = (permissions) => `export const id = "com.example.qrcodes";
const manifest = {
  id,
  manifestVersion: 5,
  host: [{ app: "premierepro", minVersion: "25.6.0" }],
  entrypoints: [{ type: "panel", id: "p" }],
  requiredPermissions: ${permissions},
};
`;

function project({ permissions = "{}", main = "", css = "" } = {}) {
  const dir = temp();
  fs.mkdirSync(path.join(dir, "src"), { recursive: true });
  fs.writeFileSync(path.join(dir, "uxp.config.ts"), CONFIG(permissions));
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ scripts: { build: "x", test: "y" } }));
  fs.writeFileSync(path.join(dir, "index.html"), "<div id=root></div>");
  fs.writeFileSync(path.join(dir, "src", "main.tsx"), "export const App = () => null;\n");
  fs.writeFileSync(path.join(dir, "src", "app.css"), "body { margin: 0; }\n.starter { transition: none; }\n");
  const baseline = snapshotSource(dir);
  if (main) fs.writeFileSync(path.join(dir, "src", "main.tsx"), main);
  if (css) fs.appendFileSync(path.join(dir, "src", "app.css"), css);
  return { dir, baseline };
}

const plan = { host: "ppro", permissions: [] };

async function library() {
  const dir = temp();
  await buildLibrary({ host: "ppro", dir, fetchImpl: fakeAdobe().fetchImpl, cache: false });
  return dir;
}

test("the host types give the top-level names and each class's members", () => {
  const types = parseHostTypes(TYPES);
  assert.deepEqual([...types.names].sort(), ["Marker", "Project", "Sequence"]);
  assert.deepEqual([...types.statics.get("Project")].sort(), ["getActiveProject", "open"]);
  assert.equal(types.statics.has("Sequence"), false, "an empty static type is not checked member by member");
});

test("a host API name that is not in the saved types is an error, a real one is not", async () => {
  const lib = await library();
  const { dir, baseline } = project({
    main: `import { premierepro } from "./globals";
const a = await premierepro.Project.getActiveProject();
const b = await premierepro.Projct.getActiveProject();
const c = await premierepro.Project.getCurrentProject();
const d = await premierepro.Project.zap(); // audit-ignore
const ppro = require("premierepro");
ppro.Nope.x();
`
  });
  const { findings, typesRead } = auditProject({ project: dir, plan, libDir: lib, baseline });
  assert.equal(typesRead, true);
  const api = findings.filter((item) => item.id === "api-unknown").map((item) => `${item.line}:${item.text.split(" is not")[0]}`);
  assert.deepEqual(api, ["3:premierepro.Projct", "4:premierepro.Project.getCurrentProject", "7:ppro.Nope"]);
  assert.match(findings.find((item) => item.text.includes("getCurrentProject")).text, /getActiveProject/);
});

test("a permission the code needs but the manifest lacks is an error; one it declares but never uses is a warning", () => {
  const { dir, baseline } = project({
    permissions: `{ clipboard: "readAndWrite", localFileSystem: "request" }`,
    main: `const r = await fetch("https://example.com");\nconst f = await fs.getFileForSaving("a.png");\n`
  });
  const { findings } = auditProject({ project: dir, plan, baseline });
  const missing = findings.filter((item) => item.id === "permission-missing");
  assert.deepEqual(missing.map((item) => item.text.match(/no (\w+)\./)[1]), ["network"]);
  assert.equal(missing[0].severity, "error");
  const unused = findings.filter((item) => item.id === "permission-unused");
  assert.deepEqual(unused.map((item) => item.text.match(/declares (\w+)/)[1]), ["clipboard"]);
  assert.equal(unused[0].severity, "warn");
  const picker = project({ permissions: `{ localFileSystem: "request" }`, main: `await fs.createEntryWithUrl("plugin-temp:/a.png");\n` });
  const folderUse = auditProject({ project: picker.dir, plan, baseline: picker.baseline }).findings.find((item) => item.id === "permission-unused");
  assert.match(folderUse.fix, /plugin-temp:\//, "writing to the plugin's own folders needs no permission, and the fix says so");
});

test("a permission the request names is not reported as unused", () => {
  const { dir, baseline } = project({ permissions: `{ network: { domains: ["https://example.com"] } }`, main: "export const x = 1;\n" });
  const { findings } = auditProject({ project: dir, plan: { host: "ppro", permissions: ["network"] }, baseline });
  assert.equal(findings.some((item) => item.id === "permission-unused"), false);
});

test("a limit is reported only on the lines the assistant wrote, and only when Adobe's saved pages state it", async () => {
  const lib = await library();
  const { dir, baseline } = project({
    css: ".mine { transition: all 1s; text-transform: uppercase; }\n",
    main: `export const App = () => <label for="x"><input type="file" /></label>;\nconst g = canvas.getContext("webgl");\n`
  });
  const { findings } = auditProject({ project: dir, plan, libDir: lib, baseline });
  const ids = findings.map((item) => `${item.id}@${item.file}:${item.line}`);
  assert.ok(ids.includes("limit-transitions@src/app.css:3"));
  assert.ok(ids.includes("limit-text-transform@src/app.css:3"));
  assert.ok(ids.includes("limit-input-file@src/main.tsx:1"));
  assert.equal(ids.some((id) => id.startsWith("limit-transitions@src/app.css:2")), false, "the starter's own line is not blamed");
  // The fake known-issues page has no label-for sentence, so that rule does not run. Webgl is on the canvas page.
  assert.equal(ids.some((id) => id.startsWith("limit-label-for")), false);
  assert.ok(ids.includes("limit-webgl@src/main.tsx:2"));
});

test("a changed or new file is the assistant's; an untouched starter file is not", () => {
  const { dir, baseline } = project({ main: "export const App = () => 1;\n" });
  fs.writeFileSync(path.join(dir, "src", "qr.ts"), "export const q = 1;\n");
  const authored = authoredFiles(dir, baseline).map((item) => item.file).sort();
  assert.deepEqual(authored, ["src/main.tsx", "src/qr.ts"]);
  const { changed } = changedSinceBaseline(dir, baseline);
  assert.deepEqual(changed.sort(), ["src/main.tsx", "src/qr.ts"]);
  assert.deepEqual(changedSinceBaseline(project().dir, snapshotSource(project().dir)).changed, []);
});

test("a built manifest with no entrypoint, or a missing main file, is an error", () => {
  const { dir, baseline } = project({ main: "export const x = 1;\n" });
  fs.mkdirSync(path.join(dir, "dist"), { recursive: true });
  fs.writeFileSync(path.join(dir, "dist", "manifest.json"), JSON.stringify({ id: "a", main: "index.html", entrypoints: [] }));
  const ids = auditProject({ project: dir, plan, baseline }).findings.map((item) => item.id);
  assert.ok(ids.includes("manifest-entrypoints"));
  assert.ok(ids.includes("manifest-main"));
});

test("a bundle that calls require$$ is the blank-panel crash", () => {
  const { dir, baseline } = project({ main: "export const x = 1;\n" });
  fs.mkdirSync(path.join(dir, "dist", "assets"), { recursive: true });
  fs.writeFileSync(path.join(dir, "dist", "assets", "index.js"), "})(require$$1);\n");
  const hit = auditProject({ project: dir, plan, baseline }).findings.find((item) => item.id === "bundle-require");
  assert.ok(hit);
  assert.match(hit.text, /require\$\$1 is not defined/);
});

test("a native panel whose first script is not uxp-compat.js fails the check", () => {
  const { dir, baseline } = project({ main: "export const x = 1;\n" });
  fs.writeFileSync(path.join(dir, "index.html"), "<script type=\"module\" src=\"/src/main.tsx\"></script>\n");
  fs.writeFileSync(path.join(dir, "vite.config.ts"), "export default { build: { sourcemap: false } };\n");
  const ids = auditProject({ project: dir, plan, baseline }).findings.map((item) => item.id);
  assert.ok(ids.includes("compat-script"));
  assert.ok(ids.includes("modulepreload"));
});

test("a WebView host is still a UXP document, so it needs the same guard", () => {
  const { dir, baseline } = project({ main: "export const x = 1;\n" });
  fs.writeFileSync(path.join(dir, "index.html"), "<script type=\"module\" src=\"/src/main.tsx\"></script>\n");
  const ids = auditProject({ project: dir, plan: { host: "ppro", runtime: "webview", permissions: [] }, baseline }).findings.map((item) => item.id);
  assert.ok(ids.includes("compat-script"));
  assert.ok(ids.includes("compat-text-encoder"));
});

test("no test script is a warning, not an error", () => {
  const { dir, baseline } = project({ main: "export const x = 1;\n" });
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ scripts: { build: "x" } }));
  const warn = auditProject({ project: dir, plan, baseline }).findings.find((item) => item.id === "no-tests");
  assert.equal(warn.severity, "warn");
});
