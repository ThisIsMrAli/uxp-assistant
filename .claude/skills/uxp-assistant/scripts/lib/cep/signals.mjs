/**
 * `collectProcessCalls` and `processNeedsHybrid` are copied from cep-to-uxp
 * b2fa98eb28e935dcdfc08cb30d7f66e7bd86f40a `.claude/skills/cep-to-uxp/scripts/lib/scan.mjs`.
 * MIT License. Copyright (c) 2026 cep-to-uxp contributors.
 * `assessCepSources` is new. It calls those functions and `classifyDomain`.
 * It does not build a hybrid addon and it does not copy the WebView floor.
 */
import { classifyDomain, extractOrigins } from "./domains.mjs";

const OPENER_NAMES = new Set(["explorer.exe", "explorer", "open", "xdg-open"]);

export function collectProcessCalls(text) {
  const calls = [];
  const pattern = /cep\.process\.([A-Za-z]+)\s*\(\s*(?:(['"])([\s\S]*?)\2)?/g;
  for (const match of text.matchAll(pattern)) {
    const arg = match[3] || "";
    const base = arg.split(/[\\/]/).pop().toLowerCase();
    calls.push({
      method: match[1],
      arg,
      opener: match[1] === "createProcess" && OPENER_NAMES.has(base)
    });
  }
  return calls;
}

export function processNeedsHybrid(calls) {
  return calls.some((call) => !call.opener);
}

export function assessCepSources(files = []) {
  const notes = [];
  const origins = [];
  const rejected = [];
  let hybrid = false;
  for (const file of files) {
    const text = String(file.text || "");
    if (!text) continue;
    const calls = collectProcessCalls(text);
    if (processNeedsHybrid(calls)) {
      hybrid = true;
      notes.push(`${file.path || "source"} uses cep.process for more than opening a folder. Choosing hybrid does not build that addon and does not add the missing API.`);
    }
    for (const origin of extractOrigins(text, { markup: /\.(html|svg)$/i.test(file.path || "") })) {
      const verdict = classifyDomain(origin);
      if (verdict.ok) origins.push(origin);
      else rejected.push({ origin, reason: verdict.reason, file: file.path || "" });
    }
    if (/window\.uxpHost\b/.test(text)) {
      notes.push(`${file.path || "source"} mentions window.uxpHost. That is a bridge shim, not the host DOM.`);
    }
  }
  return {
    hybrid,
    origins: [...new Set(origins)].sort(),
    rejected,
    notes
  };
}
