import http from "node:http";

/**
 * Browser preview is a labelled simulation or a WebView document.
 * It does not call Photoshop or Premiere and it does not report host success.
 * Bolt's vite preview serves a bundle that still expects require("uxp") and an
 * external photoshop module. The Bolt WebView sample posts through window.uxpHost,
 * which this skill already classifies as a shim. Neither is used as a host pass.
 */

export function extractSuppliedUi(text) {
  const found = [];
  for (const match of String(text || "").matchAll(/<(h1|h2|button|p)\b[^>]*>([^<]{1,160})<\//gi)) {
    const value = match[2].replace(/\s+/g, " ").trim();
    if (value && !found.includes(value)) found.push(value);
    if (found.length >= 8) break;
  }
  return found;
}

export function previewDocument({ mode, goal, limits, supplied }) {
  const surface = mode === "webview" ? "webview-browser" : "native-simulation";
  const title = surface === "webview-browser" ? "WebView document preview" : "Native UXP simulation";
  const banner = surface === "webview-browser"
    ? "Browser rendering of a WebView document. The host bridge is unavailable. Adobe host: NOT TESTED."
    : mode === "hybrid"
      ? "Native UXP UI simulation. A native bridge was assessed and is not executed here. Adobe host: NOT TESTED."
      : "Native UXP UI simulation. APIs are mocked. Unsupported CSS is listed, not applied as a host result. Adobe host: NOT TESTED.";
  const limitsHtml = (limits || []).map((limit) => `<li>${escapeHtml(limit)}</li>`).join("")
    || "<li>No transition or text-transform sentence was found on the fresh known-issues text. None was invented.</li>";
  const suppliedItems = supplied || [];
  const suppliedHtml = suppliedItems.length
    ? suppliedItems.map((item) => `<li>${escapeHtml(item)}</li>`).join("")
    : "<li>No supplied panel text was recorded.</li>";
  const action = surface === "webview-browser"
    ? `<button id="bridge" type="button">Call uxpHost.postMessage</button>
       <p id="bridge-result" class="error"></p>`
    : `<button id="read" type="button">Read document (mock)</button>
       <p id="read-result" class="status"></p>
       <button id="mutate" type="button" disabled>Rename layer (blocked)</button>
       <p id="mutate-result" class="error"></p>`;
  const script = surface === "webview-browser"
    ? `document.getElementById("bridge").addEventListener("click", () => {
        const result = document.getElementById("bridge-result");
        try {
          if (!window.uxpHost || typeof window.uxpHost.postMessage !== "function") {
            result.textContent = "Blocked: window.uxpHost is unavailable. No host message was sent.";
            return;
          }
          result.textContent = "Blocked: a uxpHost bridge was present and this preview refused to use it.";
        } catch (error) {
          result.textContent = "Blocked: " + (error && error.message ? error.message : "the bridge call failed") + " No host message was sent.";
        }
      });
      window.__preview = { surface: "webview-browser", hostExecuted: false, suppliedSourceText: true };`
    : `document.getElementById("read").addEventListener("click", () => {
        document.getElementById("read-result").textContent = "Mock: the host app is not available. No document was read.";
      });
      document.getElementById("mutate").addEventListener("click", () => {
        document.getElementById("mutate-result").textContent = "Blocked: the native mutation was not executed.";
      });
      window.__preview = { surface: "native-simulation", hostExecuted: false, suppliedSourceText: true };`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(title)}</title>
  <style>
    body { font-family: sans-serif; margin: 24px; background: #10131a; color: #e9ecff; }
    .banner { background: #3a2a12; color: #ffd59a; padding: 12px; }
    .panel { margin-top: 16px; padding: 16px; border: 1px solid #2c3350; }
    button { margin-right: 8px; }
    button:disabled { opacity: 0.55; }
    .error { color: #ffb4b4; }
  </style>
</head>
<body data-surface="${surface}" data-host-executed="false">
  <p class="banner">${escapeHtml(banner)}</p>
  <h1>${escapeHtml(title)}</h1>
  <p id="goal">${escapeHtml(goal || "")}</p>
  <h2>Retrieved limits</h2>
  <ul id="limits">${limitsHtml}</ul>
  <h2>Supplied panel text</h2>
  <p id="supplied-note">Source text from the supplied or generated UI. This is not a host render.</p>
  <ul id="supplied">${suppliedHtml}</ul>
  <section class="panel">${action}</section>
  <script>${script}</script>
</body>
</html>
`;
}

export function servePreview(html) {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(html);
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({
        url: `http://127.0.0.1:${port}/`,
        close: () => new Promise((done) => server.close(() => done()))
      });
    });
  });
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[ch]));
}
