import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const compatSource = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../assets/uxp-compat.js");

/**
 * Two small fixes to the create-bolt-uxp starter, so the assistant's code can be type checked.
 * Both are written before the baseline is taken, so neither counts as the assistant's code.
 */

const SPECTRUM_TYPES = `// Spectrum UXP elements (sp-button, sp-textfield, ...) and uxp-panel are custom elements.
// React's JSX types do not know them, so they are declared once here for every file.
import type { DetailedHTMLProps, HTMLAttributes } from "react";

type UxpElement = DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement> & { [attribute: string]: unknown };

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      [tag: \`sp-\${string}\`]: UxpElement;
      "uxp-panel": UxpElement;
    }
  }
}
`;

/**
 * - tsconfig.json: allow `import "./x.ts"` (the generated tests use it) and keep tsc from writing files.
 * - React only: src/spectrum.d.ts, so `<sp-button>` type checks.
 * Returns a line for each thing it did.
 */
export function prepareStarter(project, { framework, runtime = "native" } = {}) {
  const done = [];
  const tsconfig = path.join(project, "tsconfig.json");
  try {
    const config = JSON.parse(fs.readFileSync(tsconfig, "utf8"));
    const options = (config.compilerOptions ||= {});
    if (options.allowImportingTsExtensions !== true || options.noEmit !== true) {
      options.allowImportingTsExtensions = true;
      options.noEmit = true;
      fs.writeFileSync(tsconfig, `${JSON.stringify(config, null, 2)}\n`);
      done.push("tsconfig.json: allowed .ts imports (for tests) and turned emit off.");
    }
  } catch {
    // No tsconfig, or one with comments. The assistant's test then imports without the extension.
  }
  const dir = path.join(project, "src");
  const shim = path.join(dir, "spectrum.d.ts");
  if (framework === "react" && fs.existsSync(dir) && !fs.existsSync(shim) && fs.existsSync(tsconfig)) {
    fs.writeFileSync(shim, SPECTRUM_TYPES);
    done.push("src/spectrum.d.ts: types for <sp-*> and <uxp-panel> in React.");
  }
  done.push(...installCompat(project));
  done.push(...removeDemoLayout(project));
  done.push(...installPanelShell(project, { framework, runtime }));
  return done;
}

const HOST_RESET = `html, body, #app {
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  margin: 0;
  padding: 0;
  text-align: left;
  background-color: var(--uxp-host-background-color);
  color: var(--uxp-host-text-color);
}
body { display: block; min-width: 0; min-height: 0; }
#app { max-width: none; }
`;

/** The starter ships a Vite demo page: centered, huge type, its own buttons. That layout fights Spectrum. */
function removeDemoLayout(project) {
  const done = [];
  const replacements = [
    ["src/app.css", /place-items:\s*center|font-size:\s*3\.2em/],
    ["webview-ui/src/app.css", /place-items:\s*center|font-size:\s*3\.2em/]
  ];
  for (const [rel, demo] of replacements) {
    const file = path.join(project, rel);
    if (!fs.existsSync(file) || !demo.test(fs.readFileSync(file, "utf8"))) continue;
    fs.writeFileSync(file, HOST_RESET);
    done.push(`${rel}: removed the starter demo layout.`);
  }
  const scss = path.join(project, "src", "index.scss");
  if (fs.existsSync(scss) && /justify-content:\s*center/.test(fs.readFileSync(scss, "utf8"))) {
    const source = fs.readFileSync(scss, "utf8");
    const webview = source.match(/\.webview-ui\s*\{[^}]*\}/);
    fs.writeFileSync(scss, webview ? `${webview[0]}\n` : "/* Panel layout belongs in src/panel.css. */\n");
    done.push("src/index.scss: removed the centered starter layout.");
  }
  return done;
}

const PANEL_CSS = `html,
body,
#app {
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  margin: 0;
  padding: 0;
  text-align: left;
  background-color: var(--uxp-host-background-color);
  color: var(--uxp-host-text-color);
}

body {
  display: block;
  min-width: 0;
  min-height: 0;
}

#app {
  max-width: none;
}

.panel {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 12px;
}

.panel sp-divider,
.panel .field,
.panel .actions,
.panel .status {
  margin-top: 12px;
}

.panel .actions sp-button {
  margin-right: 8px;
}

.field sp-textfield,
.field sp-textarea,
.field sp-dropdown,
.field sp-picker {
  display: block;
  position: relative;
  width: 100%;
}

.webview-ui {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  border: none;
}
`;

const REACT_SHELL = `import { useState } from "react";

// Edit this screen. Do not pass value= to sp-textfield, sp-textarea, sp-picker, or sp-menu-item.

export const App = () => {
  const [text, setText] = useState("");
  const [status, setStatus] = useState("");

  return (
    <main className="panel">
      <sp-heading>Panel</sp-heading>
      <sp-body>Replace this screen with the plugin.</sp-body>
      <sp-divider></sp-divider>
      <div className="field">
        <sp-textfield
          placeholder="Type here"
          style={{ display: "block", position: "relative", width: "100%", height: "32px" }}
          onInput={(event) => setText((event.target as HTMLElement & { value?: string }).value || "")}
        >
          <sp-label slot="label">Text</sp-label>
        </sp-textfield>
      </div>
      <div className="actions">
        <sp-button
          variant="cta"
          onClick={() => setStatus(text.trim() ? \`Ready: \${text.trim()}\` : "Type something first.")}
        >
          Run
        </sp-button>
      </div>
      {status ? (
        <sp-body className="status" role="status">
          {status}
        </sp-body>
      ) : null}
    </main>
  );
};
`;

const VUE_SHELL = `<script setup lang="ts">
import { ref } from "vue";

const text = ref("");
const status = ref("");

function onInput(event: Event) {
  text.value = (event.target as HTMLElement & { value?: string }).value || "";
}

function run() {
  status.value = text.value.trim() ? \`Ready: \${text.value.trim()}\` : "Type something first.";
}
</script>

<template>
  <main class="panel">
    <sp-heading>Panel</sp-heading>
    <sp-body>Replace this screen with the plugin.</sp-body>
    <sp-divider></sp-divider>
    <sp-textfield placeholder="Type here" style="display: block; position: relative; width: 100%; height: 32px" @input="onInput">
      <sp-label slot="label">Text</sp-label>
    </sp-textfield>
    <div class="actions">
      <sp-button variant="cta" @click="run">Run</sp-button>
    </div>
    <sp-body v-if="status" class="status" role="status">{{ status }}</sp-body>
  </main>
</template>
`;

const SVELTE_SHELL = `<script lang="ts">
  let text = "";
  let status = "";

  function onInput(event: Event) {
    text = (event.target as HTMLElement & { value?: string }).value || "";
  }

  function run() {
    status = text.trim() ? \`Ready: \${text.trim()}\` : "Type something first.";
  }
</script>

<main class="panel">
  <sp-heading>Panel</sp-heading>
  <sp-body>Replace this screen with the plugin.</sp-body>
  <sp-divider></sp-divider>
  <sp-textfield placeholder="Type here" style="display: block; position: relative; width: 100%; height: 32px" on:input={onInput}>
    <sp-label slot="label">Text</sp-label>
  </sp-textfield>
  <div class="actions">
    <sp-button variant="cta" on:click={run}>Run</sp-button>
  </div>
  {#if status}
    <sp-body class="status" role="status">{status}</sp-body>
  {/if}
</main>
`;

const ENTRY_FILES = ["src/index-react.tsx", "src/index-vue.ts", "src/index-svelte.ts", "src/index.tsx", "src/main.ts"];

/** Bolt's first screen is a centered demo. Replace it with a host Spectrum panel, once. */
function installPanelShell(project, { framework, runtime }) {
  const done = [...retargetEntries(project), ...enlargePanel(project)];
  if (runtime === "webview") return done;
  const rel = framework === "vue" ? "src/main.vue" : framework === "svelte" ? "src/main.svelte" : "src/main.tsx";
  const file = path.join(project, rel);
  if (!fs.existsSync(file)) return done;
  const source = fs.readFileSync(file, "utf8");
  if (!isBoltStarter(source)) return done;
  const shell = framework === "vue" ? VUE_SHELL : framework === "svelte" ? SVELTE_SHELL : REACT_SHELL;
  fs.writeFileSync(file, shell);
  done.push(`${rel}: Spectrum shell with one heading, one labeled field, one cta button, and a status line.`);
  done.push(...ensurePanelCss(project));
  return done;
}

function isBoltStarter(text) {
  if (/<sp-heading\b|<sp-button\b/.test(text)) return false;
  return /BOLT_SAMPLECODE|VITE_BOLT_WEBVIEW_UI|bolt-uxp\.png|count is /.test(text);
}

function retargetEntries(project) {
  const done = [];
  let changed = false;
  for (const rel of ENTRY_FILES) {
    const file = path.join(project, rel);
    if (!fs.existsSync(file)) continue;
    const next = retargetEntry(fs.readFileSync(file, "utf8"));
    if (!next) continue;
    fs.writeFileSync(file, next);
    changed = true;
    done.push(`${rel}: loads panel.css instead of the starter demo CSS.`);
  }
  if (changed) done.push(...ensurePanelCss(project));
  return done;
}

function retargetEntry(source) {
  if (!/["']\.\/app\.css["']|["']\.\/index\.scss["']/.test(source)) return "";
  let next = source.replace(/^[ \t]*import\s+["']\.\/app\.css["'];?[ \t]*\r?\n/gm, "");
  next = next.replace(/^[ \t]*import\s+["']\.\/index\.scss["'];?[ \t]*\r?\n/gm, "");
  if (!next.includes("./panel.css")) {
    next = next.includes("uxp-guard")
      ? next.replace(/(import\s+["']\.\/uxp-guard\.js["'];?\r?\n)/, `$1import "./panel.css";\n`)
      : `import "./panel.css";\n${next}`;
  }
  return next === source ? "" : next;
}

function ensurePanelCss(project) {
  const file = path.join(project, "src", "panel.css");
  if (fs.existsSync(file)) return [];
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, PANEL_CSS);
  return ["src/panel.css: host colors and flex. No grid, gap, or transitions."];
}

function enlargePanel(project) {
  const file = path.join(project, "uxp.config.ts");
  if (!fs.existsSync(file)) return [];
  const before = fs.readFileSync(file, "utf8");
  let text = before;
  text = text.replace(/minimumSize:\s*\{\s*width:\s*230,\s*height:\s*200\s*\}/, "minimumSize: { width: 260, height: 360 }");
  text = text.replace(/preferredDockedSize:\s*\{\s*width:\s*230,\s*height:\s*300\s*\}/, "preferredDockedSize: { width: 320, height: 480 }");
  text = text.replace(/preferredFloatingSize:\s*\{\s*width:\s*450,\s*height:\s*400\s*\}/, "preferredFloatingSize: { width: 640, height: 420 }");
  if (text === before) return [];
  fs.writeFileSync(file, text);
  return ["uxp.config.ts: minimum size is 260×360 so the panel can show the field and the result."];
}

/** Copy the UXP document guards and load them before the bundle. Vite must not inject modulepreload. */
function installCompat(project) {
  const done = [];
  const script = fs.readFileSync(compatSource, "utf8");
  const dest = path.join(project, "public", "uxp-compat.js");
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (!fs.existsSync(dest) || fs.readFileSync(dest, "utf8") !== script) {
    fs.writeFileSync(dest, script);
    done.push("public/uxp-compat.js: observers, localStorage, TextEncoder, and the other UXP document guards.");
  }
  const guard = path.join(project, "src", "uxp-guard.js");
  if (!fs.existsSync(guard) || fs.readFileSync(guard, "utf8") !== script) {
    fs.writeFileSync(guard, script);
    done.push("src/uxp-guard.js: the same guards, imported by the bundle so TextEncoder exists before any package.");
  }
  for (const rel of ["src/index-react.tsx", "src/index-vue.ts", "src/index-svelte.ts", "src/index.tsx", "src/main.ts"]) {
    const entry = path.join(project, rel);
    if (!fs.existsSync(entry)) continue;
    const source = fs.readFileSync(entry, "utf8");
    if (source.includes("uxp-guard")) continue;
    fs.writeFileSync(entry, `import "./uxp-guard.js";\n${source}`);
    done.push(`${rel}: imports the UXP guard first.`);
  }
  const htmlPath = path.join(project, "index.html");
  if (fs.existsSync(htmlPath)) {
    const html = fs.readFileSync(htmlPath, "utf8");
    if (!html.includes("uxp-compat.js")) {
      const next = html.replace(/<script\b/, "<script src=\"./uxp-compat.js\"></script>\n    <script");
      if (next !== html) {
        fs.writeFileSync(htmlPath, next);
        done.push("index.html: uxp-compat.js is the first script.");
      }
    }
  }
  const vitePath = path.join(project, "vite.config.ts");
  if (fs.existsSync(vitePath)) {
    let vite = fs.readFileSync(vitePath, "utf8");
    if (!/modulePreload\s*:/.test(vite) && /build\s*:\s*\{/.test(vite)) {
      vite = vite.replace(/build\s*:\s*\{/, "build: {\n    modulePreload: false,");
      fs.writeFileSync(vitePath, vite);
      done.push("vite.config.ts: modulePreload is false.");
    } else if (/modulePreload\s*:\s*true/.test(vite)) {
      fs.writeFileSync(vitePath, vite.replace(/modulePreload\s*:\s*true/, "modulePreload: false"));
      done.push("vite.config.ts: modulePreload is false.");
    }
  }
  return done;
}

/**
 * React's production helper reads ownerDocument and then calls createElement on it.
 * When that document is missing, the panel goes blank. Patch the bundle when the helper is there.
 */
export function patchReactBundles(project) {
  const dist = path.join(project, "dist");
  const guardPath = path.join(project, "src", "uxp-guard.js");
  const guard = fs.existsSync(guardPath) ? fs.readFileSync(guardPath, "utf8") : "";
  const patched = [];
  for (const file of jsFiles(dist)) {
    if (guard && !fs.readFileSync(file, "utf8").includes("function Encoder")) {
      const before = fs.readFileSync(file, "utf8");
      fs.writeFileSync(file, `${guard}\n${before}`);
      patched.push(path.relative(project, file));
    }
    const source = fs.readFileSync(file, "utf8");
    if (source.includes('typeof d.createElement==="function"?d:document')) continue;
    const match = source.match(/function ([A-Za-z0-9_$]+)\(t\)\{return t\.nodeType===9\?t:t\.ownerDocument\}/);
    if (!match) continue;
    const to = `function ${match[1]}(t){var d=t&&t.nodeType===9?t:t&&t.ownerDocument;return d&&typeof d.createElement==="function"?d:document}`;
    fs.writeFileSync(file, source.replace(match[0], to));
    patched.push(path.relative(project, file));
  }
  return patched;
}

function jsFiles(dir) {
  const found = [];
  if (!fs.existsSync(dir)) return found;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...jsFiles(full));
    else if (entry.name.endsWith(".js")) found.push(full);
  }
  return found;
}
