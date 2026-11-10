import http from "node:http";

/**
 * GET a loopback URL without using HTTPS_PROXY.
 * Node's fetch follows the proxy env, so a health check to 127.0.0.1 would hang or fail.
 */
export function loopbackJson(url, { headers = {}, timeoutMs = 8000 } = {}) {
  const target = new URL(url);
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: "127.0.0.1",
      port: target.port,
      path: `${target.pathname}${target.search}`,
      method: "GET",
      headers,
      timeout: timeoutMs,
      agent: false
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let body = {};
        try {
          body = text ? JSON.parse(text) : {};
        } catch {
          body = {};
        }
        resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode || 0, body });
      });
    });
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("timeout"));
    });
    req.on("error", reject);
    req.end();
  });
}
