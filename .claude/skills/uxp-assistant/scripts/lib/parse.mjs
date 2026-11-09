import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { skillRoot } from "./paths.mjs";

let parserModule;

/**
 * @babel/parser is loaded only from the pinned tooling beside the skill or from this skill's own source repo.
 * A package planted in a parent node_modules is not loaded.
 */
export function parserCandidates(root = skillRoot) {
  const resolved = path.resolve(root);
  const list = [path.join(resolved, "..", ".uxp-tooling", "node_modules", "@babel", "parser")];
  const repo = path.resolve(resolved, "../../..");
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(repo, "package.json"), "utf8"));
    if (pkg.name === "uxp-assistant") list.push(path.join(repo, "node_modules", "@babel", "parser"));
  } catch {
    // not the source repo
  }
  return list;
}

function loadParser() {
  if (parserModule) return parserModule;
  const require = createRequire(import.meta.url);
  for (const candidate of parserCandidates()) {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(candidate, "package.json"), "utf8"));
      if (pkg.name !== "@babel/parser") continue;
      parserModule = require(path.join(candidate, pkg.main || "lib/index.js"));
      return parserModule;
    } catch {
      // the next pinned place
    }
  }
  throw new Error("The host checker needs @babel/parser from the pinned create-bolt-uxp tooling beside the skill. It was not found there, and a parent node_modules is not used.");
}

function parseOnce(parser, text, plugins) {
  const ast = parser.parse(text, { sourceType: "module", plugins, errorRecovery: true });
  if (ast.errors && ast.errors.length) {
    const first = ast.errors[0];
    throw new Error(first?.message || "the file did not parse");
  }
  return ast;
}

export function parseSource(text, filename) {
  const parser = loadParser();
  const lower = String(filename || "").toLowerCase();
  const jsx = lower.endsWith(".tsx") || lower.endsWith(".jsx") || !lower || !/\.(?:ts|mts|cts|js|mjs|cjs)$/.test(lower);
  const plugins = ["typescript", ...(jsx ? ["jsx"] : [])];
  const source = String(text || "");
  try {
    return parseOnce(parser, source, plugins);
  } catch (error) {
    if (!/Adjacent JSX/.test(error instanceof Error ? error.message : "")) throw error;
    const wrapped = source.replace(/return\s+(<[\s\S]*?);/g, (full, jsxText) => {
      const opens = jsxText.match(/<(?!\/)[A-Za-z]/g) || [];
      if (opens.length < 2) return full;
      return `return (<>${jsxText}</>);`;
    });
    if (wrapped === source) throw error;
    return parseOnce(parser, wrapped, plugins);
  }
}

const SKIP_KEYS = new Set(["parent", "loc", "range", "leadingComments", "trailingComments", "innerComments", "extra", "_value", "_done", "_walked", "_hint", "_indexHint"]);

export function childNodes(node) {
  const out = [];
  for (const key of Object.keys(node)) {
    if (SKIP_KEYS.has(key)) continue;
    const value = node[key];
    if (Array.isArray(value)) {
      for (const child of value) if (child && typeof child.type === "string") out.push(child);
    } else if (value && typeof value.type === "string") out.push(value);
  }
  return out;
}

export function setParents(node, parent = null) {
  if (!node || typeof node !== "object" || !node.type) return;
  node.parent = parent;
  for (const child of childNodes(node)) setParents(child, node);
}


export function unwrapExpression(node) {
  let current = node;
  while (current && (current.type === "ParenthesizedExpression" || current.type === "TSAsExpression" || current.type === "TSTypeAssertion" || current.type === "TSSatisfiesExpression" || current.type === "TSNonNullExpression" || current.type === "TSInstantiationExpression")) {
    current = current.expression;
  }
  return current;
}

export function parseExpressionText(text, ts = true) {
  const parser = loadParser();
  return parser.parseExpression(String(text || ""), { plugins: ts ? ["typescript"] : [], errorRecovery: false });
}
