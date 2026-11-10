import fs from "node:fs";
import path from "node:path";

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
export function prepareStarter(project, { framework } = {}) {
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
  return done;
}
