/**
 * Replace requiredPermissions by brace depth. A non-greedy regex stops at the
 * first nested `},` and leaves `network:` outside the object.
 */
export function narrowRequiredPermissions(source) {
  const text = String(source || "");
  const key = text.search(/requiredPermissions\s*:/);
  if (key < 0) return { ok: false, source: text, reason: "uxp.config.ts has no requiredPermissions." };
  const brace = text.indexOf("{", key);
  if (brace < 0) return { ok: false, source: text, reason: "requiredPermissions has no object." };
  let depth = 0;
  let quote = "";
  for (let i = brace; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) {
      if (ch === "\\") {
        i += 1;
        continue;
      }
      if (ch === quote) quote = "";
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      continue;
    }
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        const next = `${text.slice(0, key)}requiredPermissions: {}${text.slice(i + 1)}`;
        if (/\bnetwork\s*:/.test(next) && /requiredPermissions:\s*\{\}/.test(next)) {
          const after = next.slice(next.indexOf("requiredPermissions"));
          const tail = after.slice(0, after.indexOf("\n", after.indexOf("}") + 1) + 1);
          if (/network\s*:/.test(tail)) return { ok: false, source: text, reason: "The replacement still left network beside requiredPermissions." };
        }
        return { ok: true, source: next, reason: "" };
      }
    }
  }
  return { ok: false, source: text, reason: "requiredPermissions is not a balanced object." };
}
