/**
 * Vue and Svelte single-file components hold script and template code that ships in the package.
 * This turns one component into plain module code the host checker can parse:
 * every <script> block, then each template expression inside one never-called function.
 * A template write or call is reviewed like the same code in a .ts file.
 */

const SCRIPT = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
const STYLE = /<style\b[^>]*>[\s\S]*?<\/style\s*>/gi;
export const TEMPLATE_FN = "__uxpTemplate__";

export function isComponent(rel) {
  return /\.(?:vue|svelte)$/i.test(String(rel || ""));
}

function scriptParts(body) {
  const scripts = [];
  let ts = false;
  for (const match of String(body || "").matchAll(SCRIPT)) {
    if (/\blang\s*=\s*["']ts["']/i.test(match[1]) || /\blang\s*=\s*["']typescript["']/i.test(match[1])) ts = true;
    scripts.push(match[2]);
  }
  return { scripts, ts };
}

function stripDeadVue(html) {
  let text = html;
  for (let guard = 0; guard < 50; guard += 1) {
    const open = text.match(/<([A-Za-z][\w-]*)\b[^>]*\sv-(?:if|show)\s*=\s*["']\s*(?:false|0|null|undefined)\s*["'][^>]*>/);
    if (!open) break;
    const tag = open[1];
    const start = open.index;
    let depth = 0;
    let end = text.length;
    const re = new RegExp(`<\\/?${tag}\\b[^>]*>`, "g");
    re.lastIndex = start;
    for (let match = re.exec(text); match; match = re.exec(text)) {
      if (match[0].startsWith("</")) depth -= 1;
      else if (!match[0].endsWith("/>")) depth += 1;
      if (depth === 0) {
        end = match.index + match[0].length;
        break;
      }
    }
    text = `${text.slice(0, start)} ${text.slice(end)}`;
  }
  return text;
}

function stripDeadSvelte(html) {
  return html.replace(/\{#if\s+(?:false|0|null|undefined)\s*\}[\s\S]*?\{\/if\}/g, " ");
}

function markup(body, svelte = false) {
  const html = String(body || "").replace(SCRIPT, " ").replace(STYLE, " ").replace(/<!--[\s\S]*?-->/g, " ");
  return svelte ? stripDeadSvelte(html) : stripDeadVue(html);
}

function decodeAttr(text) {
  return String(text || "").replace(/&quot;/g, "\"").replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

/** Vue: {{ expr }}, v-*, :prop and @event attribute values. */
export function vueExpressions(body) {
  const html = markup(body, false);
  const out = [];
  for (const match of html.matchAll(/\{\{([\s\S]*?)\}\}/g)) out.push({ kind: "expr", code: match[1], attr: "" });
  const attr = /\s((?:v-[\w-]+(?::[\w.\-[\]]+)?(?:\.[\w.]+)*)|(?::[\w.\-[\]]+)|(?:@[\w.\-:]+)|(?:#[\w-]+))\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  for (const match of html.matchAll(attr)) {
    const name = match[1];
    const value = decodeAttr(match[2] ?? match[3] ?? "");
    if (!value.trim()) continue;
    if (name.startsWith("#") || name.startsWith("v-slot")) continue;
    if (name === "v-for") {
      const split = value.match(/^\s*[\s\S]*?\s+(?:in|of)\s+([\s\S]+)$/);
      out.push({ kind: "expr", code: split ? split[1] : value, attr: "for" });
      continue;
    }
    if (name.startsWith("@") || name.startsWith("v-on")) {
      out.push({ kind: "handler", code: value, attr: "on" });
      continue;
    }
    const bare = name.replace(/^v-bind:/, "").replace(/^:/, "").replace(/^v-/, "");
    out.push({ kind: "expr", code: value, attr: bare });
  }
  return out;
}

function braceBlocks(text) {
  const blocks = [];
  let i = 0;
  while (i < text.length) {
    if (text[i] !== "{") {
      i += 1;
      continue;
    }
    let depth = 0;
    let quote = "";
    let j = i;
    for (; j < text.length; j += 1) {
      const ch = text[j];
      if (quote) {
        if (ch === "\\") {
          j += 1;
          continue;
        }
        if (ch === quote) quote = "";
        continue;
      }
      if (ch === "'" || ch === "\"" || ch === "`") {
        quote = ch;
        continue;
      }
      if (ch === "{") depth += 1;
      else if (ch === "}") {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    blocks.push({ code: text.slice(i + 1, j), before: text.slice(Math.max(0, i - 60), i) });
    i = j + 1;
  }
  return blocks;
}

/** Svelte: {expr}, {#if expr}, {:else if expr}, {#each expr as x}, {#await expr}, {@html expr}, on:x={...}, bind:x={...}. */
export function svelteExpressions(body) {
  const out = [];
  for (const item of braceBlocks(markup(body, true))) {
    const block = item.code.trim();
    const attrMatch = item.before.match(/([\w:|-]+)\s*=\s*$/);
    let attr = attrMatch ? attrMatch[1].replace(/^bind:/, "") : "";
    if (!block || /^\/(?:if|each|await|key)\b/.test(block) || /^:else\s*$/.test(block) || /^:(?:then|catch)\b/.test(block)) continue;
    let code = block;
    const each = block.match(/^#each\s+([\s\S]+?)\s+as\s+[\s\S]*$/);
    if (each) code = each[1];
    else if (/^#if\s+/.test(block)) {
      code = block.replace(/^#if\s+/, "");
      attr = "if";
    } else if (/^#(?:await|key)\s+/.test(block)) code = block.replace(/^#(?:await|key)\s+/, "");
    else if (/^:else\s+if\s+/.test(block)) {
      code = block.replace(/^:else\s+if\s+/, "");
      attr = "if";
    }
    if (attr.startsWith("on:")) {
      out.push({ kind: "handler", code, attr: "on" });
      continue;
    }
    else if (/^@(?:html|debug|const)\s+/.test(block)) code = block.replace(/^@(?:html|debug)\s+/, "").replace(/^@const\s+/, "const ");
    if (code.startsWith("const ")) out.push({ kind: "handler", code, attr });
    else out.push({ kind: "expr", code, attr });
  }
  return out;
}

/**
 * One parseable module for a component.
 * Template code is placed in a function that is never called, so a write there is never inside a modal.
 */
export function componentModule(rel, body) {
  const { scripts, ts } = scriptParts(body);
  const svelte = /\.svelte$/i.test(String(rel || ""));
  const expressions = svelte ? svelteExpressions(body) : vueExpressions(body);
  const lines = expressions.map((item) => (item.kind === "handler" ? `  (() => { ${item.code}\n  });` : `  void (${item.code}\n  );`));
  const template = lines.length ? `\nexport function ${TEMPLATE_FN}() {\n${lines.join("\n")}\n}\n` : "";
  return {
    script: scripts.join("\n;\n"),
    code: `${scripts.join("\n;\n")}\n${template}`,
    ts,
    expressions,
    filename: `${rel}.${ts ? "ts" : "js"}`
  };
}
