/**
 * Resolve a goal from fresh page text.
 * A documented symbol is a handoff, not a whitelist of two features.
 * No fresh evidence pauses resolution. It is not an unsupported API,
 * not a permanent refusal, and not success.
 */

const UNSUPPORTED = [
  {
    id: "css-animations",
    goal: /css\s+transitions?|css\s+animations?|animate the panel/i,
    evidence: /CSS transitions and animations are not supported/i
  },
  {
    id: "text-transform",
    goal: /text-transform/i,
    evidence: /text-transform\s+is not supported/i
  }
];

const STOP = new Set(["the", "a", "an", "in", "on", "to", "for", "of", "and", "or", "with", "each", "into", "from", "panel", "show", "read", "list", "display", "using", "use", "plugin", "feature", "please", "that", "this", "its", "not", "are", "was", "were", "goal"]);

function freshPages(pages) {
  return (pages || []).filter((page) => page.freshness === "fresh" && page.text);
}

function snippet(text, index, length) {
  const before = text.lastIndexOf(".", index);
  const after = text.indexOf(".", index + Math.max(length, 1));
  const start = before >= 0 && index - before < 180 ? before + 1 : Math.max(0, index - 24);
  const end = after > index && after - index < 180 ? after + 1 : Math.min(text.length, index + length + 40);
  let quote = text.slice(start, end).replace(/\s+/g, " ").trim();
  if (quote.length > 160) quote = `${quote.slice(0, 157).trim()}...`;
  return quote;
}

export function goalTerms(goal) {
  const text = String(goal || "");
  const identifiers = new Set();
  for (const match of text.matchAll(/\b[a-z]+[A-Z][A-Za-z0-9]*\b/g)) identifiers.add(match[0]);
  for (const match of text.matchAll(/\b[A-Za-z_][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_.]*\b/g)) identifiers.add(match[0]);
  for (const match of text.matchAll(/`([^`]+)`/g)) identifiers.add(match[1]);
  const words = text.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length >= 4 && !STOP.has(word));
  const phrases = [];
  for (let i = 0; i < words.length - 1; i += 1) phrases.push(`${words[i]} ${words[i + 1]}`);
  return { identifiers: [...identifiers], phrases };
}

function documented(goal, pages) {
  const terms = goalTerms(goal);
  const evidence = [];
  const seen = new Set();
  for (const page of freshPages(pages)) {
    const text = String(page.text);
    for (const token of [...terms.identifiers, ...terms.phrases]) {
      const needle = token.toLowerCase();
      const index = text.toLowerCase().indexOf(needle);
      if (index < 0) continue;
      const key = `${page.id}:${needle}`;
      if (seen.has(key)) continue;
      seen.add(key);
      evidence.push({
        id: page.id,
        url: page.url || "",
        quote: snippet(text, index, token.length),
        token
      });
    }
  }
  return evidence;
}

function unsupportedFromPage(goal, pages) {
  const terms = goalTerms(goal);
  for (const page of freshPages(pages)) {
    const text = String(page.text);
    for (const token of [...terms.identifiers, ...terms.phrases]) {
      const match = text.match(new RegExp(`${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s+is not supported`, "i"));
      if (!match) continue;
      return { page, quote: match[0] };
    }
  }
  return null;
}

export function resolveCapability({ goal, pages }) {
  const text = String(goal || "");
  for (const rule of UNSUPPORTED) {
    if (!rule.goal.test(text)) continue;
    const page = freshPages(pages).find((item) => rule.evidence.test(item.text || ""));
    if (!page) {
      return pause("This goal matches a limit that some UXP pages document, but that page is not fresh. A stale or missing page is not an unsupported verdict.");
    }
    const quote = (String(page.text).match(rule.evidence) || [rule.id])[0];
    return {
      state: "unsupported-with-evidence",
      capability: "unsupported-with-evidence",
      fixture: null,
      evidence: [{ id: page.id, url: page.url, quote }],
      detail: "A fresh official page says this is not supported. Nothing is generated, and that is not success."
    };
  }
  const generalLimit = unsupportedFromPage(text, pages);
  if (generalLimit) {
    return {
      state: "unsupported-with-evidence",
      capability: "unsupported-with-evidence",
      fixture: null,
      evidence: [{ id: generalLimit.page.id, url: generalLimit.page.url, quote: generalLimit.quote }],
      detail: "A fresh official page says this is not supported. Nothing is generated, and that is not success."
    };
  }

  const layer = freshPages(pages).find((page) => page.id === "photoshop.layer");
  const modal = freshPages(pages).find((page) => page.id === "photoshop.executeAsModal");
  const rename = /\brename\b/i.test(text) && /layer/i.test(text) && !/\b(?:do not|don't|without)\s+rename\b/i.test(text);
  if (rename && /Name of the layer/i.test(layer?.text || "") && /commandName|executeAsModal/i.test(modal?.text || "")) {
    return {
      state: "awaiting-agent-implementation",
      capability: "native-feasible",
      fixture: "selected-layer-rename",
      evidence: [
        { id: layer.id, url: layer.url, quote: "name is a read/write string. The retrieved Layer page describes it as Name of the layer." },
        { id: modal.id, url: modal.url, quote: "commandName is required. Edits belong inside executeAsModal." }
      ],
      detail: "Selected-layer rename is the acceptance fixture. The skill does not write it unless the invoking assistant applies that fixture. Other goals are not replaced with it."
    };
  }

  const evidence = documented(text, pages);
  if (evidence.length) {
    return {
      state: "awaiting-agent-implementation",
      capability: "native-feasible",
      fixture: null,
      evidence: evidence.slice(0, 6),
      detail: "A fresh page documents a symbol or phrase from this goal. The invoking assistant writes that feature. Naming a documented symbol is not proof the implementation is correct, and it is not the rename fixture."
    };
  }
  if (rename) return pause("The goal asks to rename layers, and the Layer or executeAsModal page is not fresh. Pause and refresh those pages. That is unknown, not unsupported, and not a finished rename.");
  return pause("No fresh page documents a symbol from this goal. Pause and name the host API, or refresh the page that should document it. This is not an unsupported verdict, not a permanent refusal, and not completion.");
}

function pause(detail) {
  return {
    state: "unknown",
    capability: "unknown",
    fixture: null,
    evidence: [],
    pause: true,
    detail
  };
}
