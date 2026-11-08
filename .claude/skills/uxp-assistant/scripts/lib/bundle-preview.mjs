import http from "node:http";
import { readZip } from "./archive.mjs";

/**
 * Serves the built acceptance bundle with a labelled shim.
 * The script bytes are the package member. This page is not a UXP UI claim
 * and not an Adobe host. cep-to-uxp CSS shims are not in this repository.
 * The color variables are the dark table from bolt-uxp src/api/themes.ts.
 * Bolt skips that table when the host name is Photoshop, so this page sets
 * them itself. They are not the host theme and not Spectrum components.
 */

const BOLT_DARK = {
  "--uxp-host-background-color": "#535353",
  "--uxp-host-text-color": "#ffffff",
  "--uxp-host-border-color": "#454545",
  "--uxp-host-link-text-color": "#4b9cf5",
  "--uxp-host-widget-hover-background-color": "#5b5b5b",
  "--uxp-host-widget-hover-text-color": "#ffffff",
  "--uxp-host-widget-hover-border-color": "#5b5b5b",
  "--uxp-host-text-color-secondary": "#e5e5e5",
  "--uxp-host-link-hover-text-color": "#ffffff",
  "--uxp-host-label-text-color": "#ffffff"
};

export function bundleEntries(ccxPath) {
  const entries = new Map();
  for (const member of readZip(ccxPath)) {
    if (!member.name.endsWith("/")) entries.set(member.name, member.data);
  }
  const script = [...entries.keys()].find((name) => name.startsWith("assets/") && name.endsWith(".js"));
  return { entries, script };
}

export function bundlePreviewHtml(scriptName) {
  const variables = Object.entries(BOLT_DARK).map(([key, value]) => `${key}: ${value};`).join(" ");
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Built panel bundle with a labelled shim</title>
  <style>
    :root { ${variables} }
    body { margin: 0; background: var(--uxp-host-background-color); color: var(--uxp-host-text-color); font-family: sans-serif; }
    .shim-banner { background: #3a2a12; color: #ffd59a; padding: 12px 16px; font-size: 14px; }
    #app { padding: 16px; }
  </style>
</head>
<body data-surface="built-bundle-shim" data-host-executed="false">
  <p class="shim-banner" id="shim-banner">Built panel bundle with a labelled UXP and Photoshop shim. Poster is mock host data, not a Photoshop document. CSS variables are Bolt's dark table, not Spectrum and not the host theme. This panel uses plain HTML, not Spectrum components. Adobe host: NOT TESTED. Not a UXP equivalence claim.</p>
  <p id="shim-error"></p>
  <div id="app"></div>
  <script>
    window.__shim = { hostExecuted: false, mockTitle: "Poster", blocked: [], surface: "built-bundle-shim" };
    window.addEventListener("error", (event) => {
      document.getElementById("shim-error").textContent = "Bundle error: " + (event.message || "unknown");
    });
    window.require = (name) => {
      if (name === "uxp") {
        return {
          host: { name: "Photoshop", version: "shim" },
          versions: { uxp: "shim" },
          entrypoints: { _pluginInfo: { id: "com.example.title", version: "0.0.0" }, setup() {} },
          pluginManager: { plugins: [] },
          shell: { openExternal() { window.__shim.blocked.push("uxp.shell.openExternal"); return Promise.resolve(); } }
        };
      }
      if (name === "photoshop") {
        return {
          app: { activeDocument: { title: "Poster" } },
          core: {
            suppressResizeGripper() { window.__shim.blocked.push("photoshop.core.suppressResizeGripper"); },
            executeAsModal() {
              window.__shim.blocked.push("photoshop.core.executeAsModal");
              return Promise.reject(new Error("Blocked: executeAsModal was not executed."));
            }
          },
          action: { batchPlay() { window.__shim.blocked.push("photoshop.action.batchPlay"); return Promise.resolve([]); } }
        };
      }
      if (name === "os") return { platform: () => "linux" };
      window.__shim.blocked.push(name);
      return {};
    };
  </script>
  <script src="/${scriptName}"></script>
</body>
</html>
`;
}

export function serveBundle(ccxPath) {
  const { entries, script } = bundleEntries(ccxPath);
  if (!script) throw new Error("The archive has no assets JavaScript member.");
  const html = bundlePreviewHtml(script);
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    if (url.pathname === "/") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(html);
      return;
    }
    const name = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
    const data = entries.get(name);
    if (!data) {
      res.writeHead(404);
      res.end("missing");
      return;
    }
    const type = name.endsWith(".js") ? "text/javascript; charset=utf-8" : "application/octet-stream";
    res.writeHead(200, { "content-type": type });
    res.end(data);
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve({
        url: `http://127.0.0.1:${address.port}/`,
        script,
        close: () => new Promise((done) => server.close(done))
      });
    });
  });
}
