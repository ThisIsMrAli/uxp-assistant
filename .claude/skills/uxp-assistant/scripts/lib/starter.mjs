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
  return done;
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
