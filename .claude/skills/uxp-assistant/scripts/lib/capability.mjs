/**
 * Resolve a goal from fresh page text. A missing recipe is not a verdict.
 * Unsupported requires a quote on a fresh page. Absence stays unknown.
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

function fresh(pages, id) {
  const page = (pages || []).find((item) => item.id === id && item.freshness === "fresh" && item.text);
  return page ? String(page.text) : "";
}

export function resolveCapability({ goal, pages }) {
  const text = String(goal || "");
  for (const rule of UNSUPPORTED) {
    if (!rule.goal.test(text)) continue;
    const page = (pages || []).find((item) => item.freshness === "fresh" && rule.evidence.test(item.text || ""));
    if (!page) {
      return {
        state: "unknown",
        capability: "unknown",
        fixture: null,
        evidence: [],
        detail: "This goal matches a limit that some UXP pages document, but that page is not fresh. A stale or missing page is not an unsupported verdict."
      };
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

  const layer = fresh(pages, "photoshop.layer");
  const document = fresh(pages, "photoshop.document");
  const modal = fresh(pages, "photoshop.executeAsModal");
  const rename = /\brename\b/i.test(text) && /layer/i.test(text) && !/\b(?:do not|don't|without)\s+rename\b/i.test(text);
  if (rename) {
    if (/Name of the layer/i.test(layer) && /commandName|executeAsModal/i.test(modal)) {
      return {
        state: "awaiting-agent-implementation",
        capability: "native-feasible",
        fixture: "selected-layer-rename",
        evidence: [
          { id: "photoshop.layer", url: "https://developer.adobe.com/photoshop/uxp/2022/ps-reference/classes/layer", quote: "name is a read/write string. Minimum version on the retrieved page is 22.5." },
          { id: "photoshop.executeAsModal", url: "https://developer.adobe.com/photoshop/uxp/2022/ps-reference/media/executeasmodal", quote: "commandName is required. The retrieved page places that option at 23.0. Edits belong inside executeAsModal." }
        ],
        detail: "Selected-layer rename is the acceptance fixture. The skill does not write it unless the invoking assistant applies that fixture. Other goals are not replaced with it."
      };
    }
    return {
      state: "unknown",
      capability: "unknown",
      fixture: null,
      evidence: [],
      detail: "The goal asks to rename layers, and the Layer or executeAsModal page is not fresh. That is unknown, not unsupported, and not a finished rename."
    };
  }

  const showLayers = /layer/i.test(text) && /\b(id|name|show|list|read)\b/i.test(text);
  if (showLayers && /activeLayers/i.test(document) && /name/i.test(layer)) {
    return {
      state: "awaiting-agent-implementation",
      capability: "native-feasible",
      fixture: null,
      evidence: [
        { id: "photoshop.document", url: "https://developer.adobe.com/photoshop/uxp/2022/ps-reference/classes/document", quote: "activeLayers is the selected layers. The retrieved page lists minimum version 22.5 and a parenthetical (26.9)." },
        { id: "photoshop.layer", url: "https://developer.adobe.com/photoshop/uxp/2022/ps-reference/classes/layer", quote: "id and name are readable. This goal does not assign name." }
      ],
      detail: "The goal is a read of the selection. It is not the rename fixture. The read stays outside executeAsModal."
    };
  }

  return {
    state: "unknown",
    capability: "unknown",
    fixture: null,
    evidence: [],
    detail: "No fresh page establishes this goal. Lack of a canned recipe is not an unsupported API and is not completion."
  };
}
