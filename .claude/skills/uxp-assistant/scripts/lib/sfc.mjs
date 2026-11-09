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

const NEVER = () => false;
const LITERAL_FALSE = (code) => /^\s*(?:false|0|null|undefined)\s*$/.test(String(code));

/** An element the panel never shows: a constant-false v-if or v-show, a hidden attribute, or display:none / visibility:hidden. */
function hiddenTag(tagText, deadCondition, hidden) {
  for (const match of tagText.matchAll(/\sv-(?:if|show)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) if (deadCondition(match[1] ?? match[2] ?? "")) return true;
  if (!hidden) return false;
  if (/\shidden(?:\s|=|\/?>)/.test(tagText) && !/\s:hidden\s*=/.test(tagText)) {
    const value = tagText.match(/\shidden\s*=\s*(?:"([^"]*)"|'([^']*)'|\{([^}]*)\})/);
    if (!value || /^\s*(?:true|hidden|)\s*$/.test(value[1] ?? value[2] ?? value[3] ?? "")) return true;
  }
  const style = tagText.match(/\sstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/);
  if (style && /(?:display\s*:\s*none|visibility\s*:\s*hidden)/i.test(style[1] ?? style[2] ?? "")) return true;
  return false;
}

function stripDeadVue(html, deadCondition = LITERAL_FALSE, hidden = false) {
  let text = html;
  let from = 0;
  for (let guard = 0; guard < 200; guard += 1) {
    const opener = /<([A-Za-z][\w-]*)\b(?:[^>"']|"[^"]*"|'[^']*')*>/g;
    opener.lastIndex = from;
    let open = null;
    for (let match = opener.exec(text); match; match = opener.exec(text)) {
      if (hiddenTag(match[0], deadCondition, hidden)) {
        open = match;
        break;
      }
    }
    if (!open) break;
    const tag = open[1];
    const start = open.index;
    from = start;
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

/** Removes {#if cond}…{/if} blocks whose condition is constant false, with nested blocks matched, then hidden elements. */
function stripDeadSvelte(html, deadCondition = LITERAL_FALSE, hidden = false) {
  let text = html;
  for (let guard = 0; guard < 100; guard += 1) {
    const re = /\{#if\s+([^}]*)\}/g;
    let found = null;
    for (let match = re.exec(text); match; match = re.exec(text)) {
      if (deadCondition(match[1])) {
        found = match;
        break;
      }
    }
    if (!found) break;
    const tokens = /\{#if\b[^}]*\}|\{\/if\}|\{:else(?:\s+if\b[^}]*)?\}/g;
    tokens.lastIndex = found.index + found[0].length;
    let depth = 1;
    let elseAt = -1;
    let elseToken = "";
    let close = -1;
    let closeEnd = text.length;
    for (let token = tokens.exec(text); token; token = tokens.exec(text)) {
      if (token[0].startsWith("{#if")) depth += 1;
      else if (token[0] === "{/if}") {
        depth -= 1;
        if (depth === 0) {
          close = token.index;
          closeEnd = token.index + token[0].length;
          break;
        }
      } else if (depth === 1 && elseAt < 0) {
        elseAt = token.index;
        elseToken = token[0];
      }
    }
    if (close < 0) close = text.length;
    let kept = "";
    if (elseAt >= 0) {
      const branch = text.slice(elseAt + elseToken.length, close);
      const cond = elseToken.match(/^\{:else\s+if\s+([^}]*)\}$/);
      kept = cond ? `{#if ${cond[1]}}${branch}{/if}` : branch;
    }
    // The dead branch is removed. An {:else} branch is kept: it is what renders.
    text = `${text.slice(0, found.index)} ${kept}${text.slice(closeEnd)}`;
  }
  return stripDeadVue(text, deadCondition, hidden);
}

function markup(body, svelte = false, deadCondition = NEVER, hidden = false) {
  const html = String(body || "").replace(SCRIPT, " ").replace(STYLE, " ").replace(/<!--[\s\S]*?-->/g, " ");
  return svelte ? stripDeadSvelte(html, deadCondition, hidden) : stripDeadVue(html, deadCondition, hidden);
}

function decodeAttr(text) {
  return String(text || "").replace(/&quot;/g, "\"").replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

/** Vue: {{ expr }}, v-*, :prop and @event attribute values. */
export function vueExpressions(body, deadCondition, hidden = false) {
  const html = markup(body, false, deadCondition, hidden);
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
export function svelteExpressions(body, deadCondition, hidden = false) {
  const out = [];
  for (const item of braceBlocks(markup(body, true, deadCondition, hidden))) {
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
export function componentModule(rel, body, options = {}) {
  const { scripts, ts } = scriptParts(body);
  const svelte = /\.svelte$/i.test(String(rel || ""));
  // The host checker reads every template expression (a v-show or hidden element still evaluates).
  // The UI-state rule passes deadCondition and hidden so a branch the panel never shows does not count.
  const dead = options.deadCondition || NEVER;
  const hidden = Boolean(options.hidden);
  const expressions = svelte ? svelteExpressions(body, dead, hidden) : vueExpressions(body, dead, hidden);
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
