import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { htmlToText } from "./html-text.mjs";
import { mergeDocFacts } from "./registry.mjs";

/**
 * Each page id is fresh only when this fetch succeeds.
 * A failed fetch leaves the previous text file in place and marks that id
 * stale (old text kept) or failed (nothing on disk). One success does not
 * make another id fresh.
 */
export async function refreshPages(target, pages, { fetchImpl = globalThis.fetch, now = () => new Date().toISOString() } = {}) {
  fs.mkdirSync(target, { recursive: true });
  const retrievedAt = now();
  const written = [];
  for (const page of pages) {
    const dest = path.join(target, `${page.id}.txt`);
    const hadPrevious = fs.existsSync(dest);
    let ok = false;
    let error = "";
    let revision = "";
    try {
      const response = await fetchImpl(page.url, { headers: { accept: "text/html", "user-agent": "uxp-assistant" } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const raw = await response.text();
      const text = page.url.endsWith(".md") ? raw : htmlToText(raw);
      if (!text.trim()) throw new Error("Empty page.");
      revision = crypto.createHash("sha256").update(text).digest("hex");
      fs.writeFileSync(dest, text);
      ok = true;
    } catch (caught) {
      error = caught.message || String(caught);
    }
    const previousRevision = hadPrevious && !ok ? hashFile(dest) : "";
    written.push({
      id: page.id,
      url: page.url,
      scope: page.scope || "shared",
      ok,
      revision: ok ? revision : previousRevision,
      retrievedAt,
      freshness: ok ? "fresh" : hadPrevious ? "stale" : "failed",
      previousKept: !ok && hadPrevious,
      ...(error ? { error } : {})
    });
  }
  const facts = mergeDocFacts(written.map((page) => ({ ...page, text: page.ok ? fs.readFileSync(path.join(target, `${page.id}.txt`), "utf8") : "" })));
  const summary = {
    retrievedAt,
    perIdSuccessRequired: true,
    anySuccessIsEnough: false,
    ok: written.every((page) => page.freshness === "fresh"),
    fresh: written.filter((page) => page.freshness === "fresh").map((page) => page.id),
    stale: written.filter((page) => page.freshness === "stale").map((page) => page.id),
    failed: written.filter((page) => page.freshness === "failed").map((page) => page.id),
    pages: written,
    facts
  };
  fs.writeFileSync(path.join(target, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
  return summary;
}

export function readPageText(target, id) {
  try {
    return fs.readFileSync(path.join(target, `${id}.txt`), "utf8");
  } catch {
    return "";
  }
}

function hashFile(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}
