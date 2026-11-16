#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const site = path.join(root, "site");
const dist = path.join(root, "site-dist");

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });
fs.copyFileSync(path.join(site, "page.html"), path.join(dist, "index.html"));
fs.copyFileSync(path.join(site, "blank.html"), path.join(dist, "404.html"));
for (const asset of ["site.css", "site.js", "demo.webp"]) {
  fs.copyFileSync(path.join(site, asset), path.join(dist, asset));
}
fs.writeFileSync(path.join(dist, ".nojekyll"), "");
