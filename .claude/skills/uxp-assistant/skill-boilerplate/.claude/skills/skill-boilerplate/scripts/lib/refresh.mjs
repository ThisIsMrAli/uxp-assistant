import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/**
 * Fetch every source on this invocation.
 * A page is fresh only when this fetch succeeds.
 * A failed fetch that keeps an older file is stale. A failed fetch with no file is failed.
 * Stale is never labeled fresh.
 */
export async function refreshSources(target, pages, {
  fetchImpl = globalThis.fetch,
  now = () => new Date().toISOString(),
  pageTimeoutMs = 8000,
  budgetMs = 20000,
  onPage
} = {}) {
  fs.mkdirSync(target, { recursive: true });
  const retrievedAt = now();
  const deadline = Date.now() + budgetMs;
  let finished = 0;
  const written = await Promise.all(pages.map(async (page) => {
    const remaining = deadline - Date.now();
    const result = remaining <= 0
      ? pageResult(page, false, "Overall docs budget elapsed.", target)
      : await fetchOne(page, { fetchImpl, timeoutMs: Math.max(1, Math.min(pageTimeoutMs, remaining)), target });
    finished += 1;
    if (onPage) await onPage({ page: result, done: finished, total: pages.length });
    return result;
  }));
  const summary = {
    retrievedAt,
    perIdSuccessRequired: true,
    anySuccessIsEnough: false,
    parallel: true,
    pageTimeoutMs,
    budgetMs,
    ok: written.every((page) => page.freshness === "fresh"),
    fresh: written.filter((page) => page.freshness === "fresh").map((page) => page.id),
    stale: written.filter((page) => page.freshness === "stale").map((page) => page.id),
    failed: written.filter((page) => page.freshness === "failed").map((page) => page.id),
    pages: written
  };
  fs.writeFileSync(path.join(target, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
  return summary;
}

async function fetchOne(page, { fetchImpl, timeoutMs, target }) {
  const dest = path.join(target, `${page.id}.txt`);
  const hadPrevious = fs.existsSync(dest);
  let timer;
  try {
    const response = await Promise.race([
      fetchImpl(page.url, { headers: { accept: "text/html, text/plain", "user-agent": "skill-boilerplate" }, signal: AbortSignal.timeout(timeoutMs) }),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Timed out after ${timeoutMs}ms`)), timeoutMs + 50);
      })
    ]);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const raw = await response.text();
    const text = page.url.endsWith(".md") || page.url.endsWith(".txt") ? raw : stripTags(raw);
    if (!text.trim()) throw new Error("Empty page.");
    fs.writeFileSync(dest, text);
    return {
      id: page.id,
      url: page.url,
      ok: true,
      revision: crypto.createHash("sha256").update(text).digest("hex"),
      freshness: "fresh",
      previousKept: false
    };
  } catch (error) {
    return pageResult(page, hadPrevious, error.message || String(error), target);
  } finally {
    clearTimeout(timer);
  }
}

function pageResult(page, hadPrevious, error, target) {
  const dest = path.join(target, `${page.id}.txt`);
  return {
    id: page.id,
    url: page.url,
    ok: false,
    revision: hadPrevious ? crypto.createHash("sha256").update(fs.readFileSync(dest)).digest("hex") : "",
    freshness: hadPrevious ? "stale" : "failed",
    previousKept: hadPrevious,
    error
  };
}

function stripTags(html) {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
