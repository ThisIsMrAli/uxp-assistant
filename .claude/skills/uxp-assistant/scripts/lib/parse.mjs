import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { skillRoot } from "./paths.mjs";
import { ensureInstaller } from "./scaffold.mjs";
import { verifyTree } from "./tooling.mjs";

let parserModule;

/**
 * @babel/parser is loaded only from the pinned tooling beside the skill or from this skill's own source repo.
 * A package planted in a parent node_modules is not loaded.
 */
export function parserCandidates(root = skillRoot) {
  const resolved = path.resolve(root);
  const modules = [path.join(resolved, "..", ".uxp-tooling", "node_modules")];
  const repo = path.resolve(resolved, "../../..");
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(repo, "package.json"), "utf8"));
    if (pkg.name === "uxp-assistant") modules.push(path.join(repo, "node_modules"));
  } catch {
    // not the source repo
  }
  const list = [];
  // NQ11: only a tree that matches the shipped lock and digests is used.
  for (const dir of modules.filter((item) => fs.existsSync(item) && verifyTree(item).ok)) {
    list.push(path.join(dir, "@babel", "parser"));
    list.push(path.join(dir, "create-bolt-uxp", "node_modules", "@babel", "parser"));
    list.push(path.join(dir, "bolt-uxp", "node_modules", "@babel", "parser"));
    list.push(path.join(dir, "@vue", "compiler-sfc", "node_modules", "@babel", "parser"));
  }
  return list;
}

function tryLoad() {
  const require = createRequire(import.meta.url);
  for (const candidate of parserCandidates()) {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(candidate, "package.json"), "utf8"));
      if (pkg.name !== "@babel/parser" || !/^7\./.test(String(pkg.version || ""))) continue;
      return require(path.join(candidate, pkg.main || "lib/index.js"));
    } catch {
      // the next pinned place
    }
  }
  return null;
}

/**
 * @babel/parser comes with the pinned create-bolt-uxp tooling. An existing-project session may not
 * have installed that tooling yet, so the checker installs the pinned tooling beside the skill once
 * rather than loading a parser from a parent folder.
 */
function loadParser() {
  if (parserModule) return parserModule;
  parserModule = tryLoad();
  if (parserModule) return parserModule;
  if (!process.env.UXP_ASSISTANT_NO_TOOLING_INSTALL) {
    try {
      ensureInstaller();
    } catch {
      // reported below
    }
    parserModule = tryLoad();
    if (parserModule) return parserModule;
  }
  throw new Error("The host checker needs @babel/parser from the pinned create-bolt-uxp@1.3.27 tooling beside the skill. It was not found there and could not be installed, and a parent node_modules is not used.");
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
  const plugins = ["typescript", "decorators-legacy", ...(jsx ? ["jsx"] : [])];
  const source = String(text || "");
  try {
    return parseOnce(parser, source, plugins);
  } catch (error) {
    if (/decorator/i.test(error instanceof Error ? error.message : "")) {
      // TC39 decorators (`export @d class`, accessor members) need the standard plugin, not the legacy one.
      try {
        return parseOnce(parser, source, ["typescript", ["decorators", { decoratorsBeforeExport: false, allowCallParenthesized: true }], ...(jsx ? ["jsx"] : [])]);
      } catch {
        throw error;
      }
    }
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
