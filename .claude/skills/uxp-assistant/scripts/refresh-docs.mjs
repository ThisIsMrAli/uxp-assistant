#!/usr/bin/env node
import path from "node:path";
import { pathToFileURL } from "node:url";
import { liveDir } from "./lib/paths.mjs";
import { refreshPages } from "./lib/refresh.mjs";
import { pagesForRequest } from "./lib/registry.mjs";

const ranDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (ranDirectly) {
  const args = parse(process.argv.slice(2));
  const pages = pagesForRequest({ host: args.host || "phxs", goal: args.goal || "layer rename" });
  const target = args.out ? path.resolve(args.out) : liveDir;
  const summary = await refreshPages(target, pages);
  process.stdout.write(`${JSON.stringify({ ok: summary.ok, fresh: summary.fresh, stale: summary.stale, failed: summary.failed, out: target }, null, 2)}\n`);
  if (!summary.ok) process.exitCode = 1;
}

function parse(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (!key.startsWith("--")) continue;
    out[key.slice(2)] = argv[i + 1];
    i += 1;
  }
  return out;
}
