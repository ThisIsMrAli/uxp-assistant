/**
 * Least requiredPermissions for a generated package.
 *
 * The manifest page (fetched 8 Nov 2026) says requiredPermissions defaults to {}
 * and that fullAccess is the least restrictive filesystem grant. clipboard,
 * launchProcess, and webview default to no access. WebviewPermission requires
 * allow ("yes" to enable webviews) and domains (a list or "all").
 * enableMessageBridge defaults to "no".
 *
 * The HTMLWebViewElement page says allow "yes" is mandatory, domains "all" is
 * not recommended, and local plugin:/ content needs allowLocalRendering "yes".
 * Its local example uses domains: []. enableMessageBridge "no" does not allow
 * plugin/webview communication. "localOnly" and "localAndRemote" are for that
 * communication. This writer does not invent a third syntax.
 *
 * A requested key is copied from the starter only when that key is already
 * there. The starter webview object is not copied; the local block above
 * replaces it when the runtime is webview.
 */

export const LEAST_LOCAL_WEBVIEW = {
  allow: "yes",
  domains: [],
  allowLocalRendering: "yes",
  enableMessageBridge: "no"
};

const CAPABILITY_KEYS = ["localFileSystem", "launchProcess", "clipboard", "network", "allowCodeGenerationFromStrings", "ipc"];

/** Names the manifest actually declares. enableMessageBridge "no" and domains: [] are not capabilities. */
export function permissionCapabilities(source) {
  const text = String(source || "");
  const present = [];
  for (const name of CAPABILITY_KEYS) {
    if (new RegExp(`\\b${name}\\s*:`).test(text)) present.push(name);
  }
  if (/\benablePluginCommunication\s*:/.test(text) && !present.includes("ipc")) present.push("ipc");
  const bridge = text.match(/enableMessageBridge\s*:\s*"(localOnly|localAndRemote|no)"/);
  if (bridge && bridge[1] !== "no") present.push(`enableMessageBridge:${bridge[1]}`);
  if (/domains\s*:\s*"all"|domains\s*:\s*\[\s*"all"\s*\]/.test(text)) present.push("domains:all");
  return present;
}

export function starterPermissionsAreBroad(source) {
  return permissionCapabilities(source).length > 0;
}

export const PERMISSION_CHOICES = ["keep", "narrow"];

export function permissionChoice(value) {
  return PERMISSION_CHOICES.includes(value) ? value : "";
}

export function narrowRequiredPermissions(source, options = {}) {
  const text = String(source || "");
  const runtime = options.runtime === "webview" ? "webview" : "native";
  const requested = new Set((options.requested || []).map((item) => String(item)));
  const key = text.search(/requiredPermissions\s*:/);
  if (key < 0) return { ok: false, source: text, reason: "uxp.config.ts has no requiredPermissions.", runtime, permissions: null };
  const brace = text.indexOf("{", key);
  if (brace < 0) return { ok: false, source: text, reason: "requiredPermissions has no object.", runtime, permissions: null };
  const end = objectEnd(text, brace);
  if (end < 0) return { ok: false, source: text, reason: "requiredPermissions is not a balanced object.", runtime, permissions: null };
  const kept = topLevelEntries(text, brace, end).filter((entry) => requested.has(entry.name) && entry.name !== "webview");
  const lines = [];
  const bridge = options.bridge === "localOnly" ? "localOnly" : "no";
  if (runtime === "webview") {
    lines.push(`webview: {
      allow: "yes",
      domains: [],
      allowLocalRendering: "yes",
      enableMessageBridge: "${bridge}",
    }`);
  }
  for (const entry of kept) lines.push(entry.text);
  const body = lines.length ? `{\n    ${lines.join(",\n    ")},\n  }` : "{}";
  const next = `${text.slice(0, key)}requiredPermissions: ${body}${text.slice(end + 1)}`;
  const permissions = runtime === "webview"
    ? { webview: { ...LEAST_LOCAL_WEBVIEW, enableMessageBridge: bridge }, ...Object.fromEntries(kept.map((entry) => [entry.name, entry.text])) }
    : Object.fromEntries(kept.map((entry) => [entry.name, entry.text]));
  return { ok: true, source: next, reason: "", runtime, permissions, kept: kept.map((entry) => entry.name) };
}

function objectEnd(text, brace) {
  let depth = 0;
  let quote = "";
  for (let i = brace; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) {
      if (ch === "\\") {
        i += 1;
        continue;
      }
      if (ch === quote) quote = "";
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      continue;
    }
    if (ch === "/" && text[i + 1] === "/") {
      const nl = text.indexOf("\n", i);
      i = nl < 0 ? text.length : nl;
      continue;
    }
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function topLevelEntries(text, brace, end) {
  const entries = [];
  let i = brace + 1;
  while (i < end) {
    while (i < end && /[\s,]/.test(text[i])) i += 1;
    if (i >= end) break;
    if (text.startsWith("//", i)) {
      const nl = text.indexOf("\n", i);
      i = nl < 0 ? end : nl + 1;
      continue;
    }
    if (text.startsWith("/*", i)) {
      const close = text.indexOf("*/", i);
      i = close < 0 ? end : close + 2;
      continue;
    }
    const name = text.slice(i).match(/^[A-Za-z_][A-Za-z0-9_]*/);
    if (!name) break;
    let j = i + name[0].length;
    while (j < end && /\s/.test(text[j])) j += 1;
    if (text[j] !== ":") break;
    j += 1;
    const valueEnd = skipValue(text, j, end);
    if (valueEnd < 0) break;
    entries.push({ name: name[0], text: text.slice(i, valueEnd).trim().replace(/,$/, "") });
    i = valueEnd;
  }
  return entries;
}

function skipValue(text, start, end) {
  let i = start;
  while (i < end && /\s/.test(text[i])) i += 1;
  if (i >= end) return -1;
  const ch = text[i];
  if (ch === "{" || ch === "[") {
    const close = ch === "{" ? "}" : "]";
    let depth = 0;
    let quote = "";
    for (; i < end; i += 1) {
      const cur = text[i];
      if (quote) {
        if (cur === "\\") {
          i += 1;
          continue;
        }
        if (cur === quote) quote = "";
        continue;
      }
      if (cur === '"' || cur === "'" || cur === "`") {
        quote = cur;
        continue;
      }
      if (cur === "/" && text[i + 1] === "/") {
        const nl = text.indexOf("\n", i);
        i = nl < 0 ? end : nl;
        continue;
      }
      if (cur === ch) depth += 1;
      else if (cur === close) {
        depth -= 1;
        if (depth === 0) return i + 1;
      }
    }
    return -1;
  }
  if (ch === '"' || ch === "'" || ch === "`") {
    for (i += 1; i < end; i += 1) {
      if (text[i] === "\\") {
        i += 1;
        continue;
      }
      if (text[i] === ch) return i + 1;
    }
    return -1;
  }
  while (i < end && text[i] !== "," && text[i] !== "\n" && text[i] !== "}") i += 1;
  return i;
}
