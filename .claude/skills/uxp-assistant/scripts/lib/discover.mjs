import fs from "node:fs";
import path from "node:path";
import { goalTerms } from "./capability.mjs";

/**
 * When the pages already fetched do not name a camelCase API, look through
 * the official AdobeDocs class pages for that host. This is not a whitelist
 * of features. A miss stays unknown and pauses. It does not invent the call.
 */
const TREES = {
  phxs: {
    repo: "AdobeDocs/uxp-photoshop",
    prefix: "src/pages/ps-reference/",
    site: "https://developer.adobe.com/photoshop/uxp/2022/ps-reference/"
  },
  PS: {
    repo: "AdobeDocs/uxp-photoshop",
    prefix: "src/pages/ps-reference/",
    site: "https://developer.adobe.com/photoshop/uxp/2022/ps-reference/"
  },
  ppro: {
    repo: "AdobeDocs/uxp-premiere-pro",
    prefix: "src/pages/ppro-reference/",
    site: "https://developer.adobe.com/premiere-pro/uxp/ppro-reference/"
  },
  premierepro: {
    repo: "AdobeDocs/uxp-premiere-pro",
    prefix: "src/pages/ppro-reference/",
    site: "https://developer.adobe.com/premiere-pro/uxp/ppro-reference/"
  }
};

export async function discoverOfficialPages({ host, goal, fetchImpl = globalThis.fetch, docsDir }) {
  const tree = TREES[host];
  const tokens = goalTerms(goal).identifiers.filter((token) => /[A-Z]/.test(token) && token.length >= 4);
  if (!tree || !tokens.length) return [];
  let listing;
  try {
    listing = await readJson(fetchImpl, `https://api.github.com/repos/${tree.repo}/git/trees/main?recursive=1`);
  } catch {
    return [];
  }
  const files = (listing?.tree || [])
    .filter((item) => item.type === "blob" && item.path.startsWith(tree.prefix) && item.path.endsWith(".md") && !item.path.endsWith("/index.md"))
    .map((item) => item.path);
  const found = [];
  for (let i = 0; i < files.length && !found.length; i += 6) {
    const batch = files.slice(i, i + 6);
    const pages = await Promise.all(batch.map(async (file) => {
      const rawUrl = `https://raw.githubusercontent.com/${tree.repo}/main/${file}`;
      try {
        const text = await readText(fetchImpl, rawUrl);
        const hit = tokens.find((token) => new RegExp(`\\b${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(text));
        if (!hit) return null;
        const relative = file.slice(tree.prefix.length).replace(/\.md$/, "");
        const id = `discovered.${relative.replace(/[/.]/g, ".")}`;
        const url = `${tree.site}${relative}/`;
        if (docsDir) {
          fs.mkdirSync(docsDir, { recursive: true });
          fs.writeFileSync(path.join(docsDir, `${id}.txt`), text);
        }
        return {
          id,
          url,
          scope: "discovered",
          ok: true,
          freshness: "fresh",
          text,
          token: hit,
          source: rawUrl
        };
      } catch {
        return null;
      }
    }));
    found.push(...pages.filter(Boolean));
  }
  return found;
}

async function readText(fetchImpl, url) {
  const response = await fetchImpl(url, { headers: { accept: "text/plain", "user-agent": "uxp-assistant" } });
  if (!response?.ok) throw new Error(`HTTP ${response?.status || "no response"}`);
  const text = await response.text();
  if (!text.trim()) throw new Error("Empty page.");
  return text;
}

async function readJson(fetchImpl, url) {
  const text = await readText(fetchImpl, url);
  return JSON.parse(text);
}
