import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { pagesForRequest } from "../../.claude/skills/uxp-assistant/scripts/lib/registry.mjs";

// Shared by dashboard-render.test.mjs (browser) and dashboard-session.test.mjs (no browser),
// so the fixture the browser test renders is checked on every run, with or without Chrome.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const SHOW = "Show each selected layer id and name in the panel.";
const catalog = pagesForRequest({ host: "phxs", goal: "layer" });
const byUrl = new Map(catalog.map((page) => [page.url, page.id]));
const REAL = (id) => fs.readFileSync(path.join(repoRoot, "test/fixtures/real-docs", `${id}.txt`), "utf8");

export function answers(goal) {
  return {
    mode: "dashboard",
    framework: "react",
    host: "phxs",
    os: "linux",
    context: "panel",
    name: "Selection Panel",
    id: "com.example.selection",
    consequential: "proceed",
    "narrow-permissions": "narrow",
    feasibility: "continue",
    runtime: "native",
    design: "uxp-constraints",
    validation: "commands",
    "context-evidence": "keep-unverified",
    goal
  };
}

export async function fetchImpl(url) {
  const id = byUrl.get(url);
  const text = id === "photoshop.layer"
    ? "name string R W 22.5 Name of the layer.\n"
    : id === "photoshop.document"
      ? "activeLayers\n\nLayers\n\nR W\n\n22.5\n\nThe selected layers in the document. (26.9)\n"
      : id === "photoshop.executeAsModal"
        ? "commandName string required 23.0 shown above the progress bar.\n"
        : id === "photoshop.app" || id === "photoshop.core"
          ? REAL(id)
          : `shared ${id || "page"}\n`;
  return { ok: true, async text() { return text; } };
}

export async function scaffoldImpl(parent) {
  const folder = path.join(parent, "plugin");
  fs.mkdirSync(path.join(folder, "src"), { recursive: true });
  const mod = pathToFileURL(path.join(repoRoot, ".claude/skills/uxp-assistant/scripts/lib/archive.mjs")).href;
  fs.writeFileSync(path.join(folder, "pack.mjs"), `import fs from "node:fs";
import { writeStoredZip } from ${JSON.stringify(mod)};
const entries = ["src/Selection.tsx", "src/selection-read.mjs"].filter((name) => fs.existsSync(name)).map((name) => ({ name, data: fs.readFileSync(name) }));
writeStoredZip("out.ccx", entries);
`);
  fs.writeFileSync(path.join(folder, "package.json"), `${JSON.stringify({
    name: "plugin",
    scripts: {
      test: "node --test",
      build: "node -e \"process.exit(0)\"",
      ccx: "node pack.mjs"
    }
  }, null, 2)}\n`);
  fs.writeFileSync(path.join(folder, "uxp.config.ts"), "export const manifest = { requiredPermissions: {} };\n");
  fs.writeFileSync(path.join(folder, "src", "main.tsx"), "export const App = () => null;\n");
  return { folder, installer: "test-double" };
}

export function writeShow(project) {
  fs.mkdirSync(path.join(project, "test"), { recursive: true });
  fs.writeFileSync(path.join(project, "src", "Selection.tsx"), "import { readSelection } from \"./selection-read.mjs\"; export function SelectionPanel(){ const [phase, setPhase] = useState(\"idle\"); return <section><h1>Selected layer ids</h1><p>{phase}</p><button type=\"button\" disabled={phase === \"reading\"} onClick={() => { setPhase(\"reading\"); try { setPhase(readSelection(null).status); } catch (e) { setPhase(String(e)); } }}>Read selection</button></section>; }\n");
  fs.writeFileSync(path.join(project, "src", "selection-read.mjs"), "export function readSelection(app){ const layers = app?.activeDocument?.activeLayers || []; return { status: layers.length ? \"Read outside executeAsModal.\" : \"No selected layer.\" }; }\n");
  fs.writeFileSync(path.join(project, "test", "selection.test.mjs"), "import assert from \"node:assert/strict\"; import { test } from \"node:test\"; import { readSelection } from \"../src/selection-read.mjs\"; test(\"selected layers\", () => { assert.equal(readSelection({ activeDocument: { activeLayers: [{ id: 3, name: \"Sky\" }] } }).status, \"Read outside executeAsModal.\"); }); test(\"no selection\", () => { assert.equal(readSelection({ activeDocument: { activeLayers: [] } }).status, \"No selected layer.\"); });\n");
}
