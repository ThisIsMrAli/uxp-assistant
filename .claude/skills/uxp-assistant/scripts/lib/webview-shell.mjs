/**
 * Local WebView host shell when enableMessageBridge is "no".
 * Creates and appends the element. Does not call postMessage and does not
 * read document.theme. The document stylesheet is the theme fallback.
 * A requested bridge is a separate contract and is not created here.
 */
import fs from "node:fs";
import path from "node:path";

export function mountLocalWebviews(document, { pages = ["main"], pluginId = "", mode = "package", port = "" } = {}) {
  const created = [];
  for (let i = 0; i < pages.length; i += 1) {
    const page = pages[i];
    const webview = document.createElement("webview");
    webview.className = "webview-ui";
    webview.id = `webview-${i}`;
    webview.uxpAllowInspector = "true";
    webview.src = mode === "dev"
      ? `http://127.0.0.1:${port}/?page=${page}`
      : `plugin:/webview-ui/${page}.html`;
    const parent = i === 0
      ? document.getElementById("app")
      : [...document.getElementsByTagName("uxp-panel")].find((item) => item.getAttribute("panelid") === `${pluginId}.${page}`) || null;
    if (!parent) continue;
    parent.appendChild(webview);
    created.push(webview);
  }
  return { created };
}

export function localWebviewHostSource() {
  return `import { config } from "../uxp.config";
import { uxp } from "./globals";

// The document stylesheet is the theme fallback. This file does not message the webview.
export const webviewInitHost = (params: {
  multi: boolean | string[];
}): Promise<never[]> => {
  const multi = params ? params.multi : false;
  const id = uxp.entrypoints._pluginInfo.id;
  return new Promise((resolve) => {
    let pages = ["main"];
    if (multi === true || Array.isArray(multi)) {
      pages = config.manifest.entrypoints.map((point) => point.id.split(".").pop()!);
    }
    pages.forEach((page, i) => {
      const webview = document.createElement("webview");
      webview.className = "webview-ui";
      webview.id = \`webview-\${i}\`;
      (webview as HTMLElement & { uxpAllowInspector?: string; src?: string }).uxpAllowInspector = "true";
      const origin =
        import.meta.env.VITE_BOLT_MODE === "dev"
          ? \`http://127.0.0.1:\${import.meta.env.VITE_BOLT_WEBVIEW_PORT}/?page=\${page}\`
          : \`plugin:/webview-ui/\${page}.html\`;
      (webview as HTMLElement & { src?: string }).src = origin;
      const parent = i === 0
        ? document.getElementById("app")
        : Array.from(document.getElementsByTagName("uxp-panel")).find((item) => item.getAttribute("panelid") === \`\${id}.\${page}\`) || null;
      if (!parent) return;
      parent.appendChild(webview);
    });
    resolve([]);
  });
};
`;
}

/** Drop the bridge color-scheme listener. Leave the rest of the theme module. */
export function stripThemeBridge(source) {
  const text = String(source || "");
  const start = text.indexOf("export const polyfillUXPVars");
  if (start < 0) return text;
  const brace = text.indexOf("{", start);
  if (brace < 0) return text;
  let depth = 0;
  for (let i = brace; i < text.length; i += 1) {
    if (text[i] === "{") depth += 1;
    else if (text[i] === "}") {
      depth -= 1;
      if (depth === 0) {
        const end = text[i + 1] === ";" ? i + 2 : i + 1;
        return `${text.slice(0, start)}export const polyfillUXPVars = () => {\n  return;\n};${text.slice(end)}`;
      }
    }
  }
  return text;
}

export function writeLocalWebviewHost(project) {
  const host = path.join(project, "src", "webview-setup-host.ts");
  const themes = path.join(project, "src", "api", "themes.ts");
  if (!fs.existsSync(host)) return { wrote: false, reason: "No webview-setup-host.ts." };
  fs.writeFileSync(host, localWebviewHostSource());
  if (fs.existsSync(themes)) fs.writeFileSync(themes, stripThemeBridge(fs.readFileSync(themes, "utf8")));
  return { wrote: true, host: "src/webview-setup-host.ts" };
}
