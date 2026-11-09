import { extractDocFacts, mergeDocFacts as mergeCepFacts } from "./cep/docs-facts.mjs";

/**
 * Shared UXP pages. The ids and URLs match cep-to-uxp scripts/lib/docs.mjs
 * DOC_PAGES at b2fa98eb28e935dcdfc08cb30d7f66e7bd86f40a (ten pages), plus five Spectrum UXP pages.
 * A host class page is not on this list. Its absence is not a support verdict.
 */
export const SHARED_PAGES = [
  { id: "manifest", url: "https://developer.adobe.com/uxp/guides/explanation/concepts/manifest/" },
  { id: "webview", url: "https://developer.adobe.com/uxp/uxp-api/reference-js/global-members/html-elements/html-web-view-element" },
  { id: "interfaces", url: "https://developer.adobe.com/uxp/guides/explanation/fundamentals/user-interfaces/" },
  { id: "entrypoints", url: "https://developer.adobe.com/uxp/guides/explanation/concepts/panels-and-commands/" },
  { id: "migration", url: "https://developer.adobe.com/uxp/migration-center/" },
  { id: "known-issues", url: "https://developer.adobe.com/uxp/uxp-api/known-issues" },
  { id: "unsupported-elements", url: "https://developer.adobe.com/uxp/uxp-api/reference-html/general/unsupported-elements" },
  { id: "unsupported-attributes", url: "https://developer.adobe.com/uxp/uxp-api/reference-html/general/unsupported-attributes" },
  { id: "css-styles", url: "https://developer.adobe.com/uxp/uxp-api/reference-css/styles/" },
  { id: "css-styling", url: "https://developer.adobe.com/uxp/guides/how-to/recipes/css-styling/" },
  { id: "spectrum-widgets", url: "https://developer.adobe.com/uxp/uxp-api/reference-spectrum/spectrum-uxp-widgets/" },
  { id: "spectrum-faq", url: "https://developer.adobe.com/uxp/uxp-api/reference-spectrum/faqs/" },
  { id: "spectrum-sp-heading", url: "https://developer.adobe.com/uxp/uxp-api/reference-spectrum/spectrum-uxp-widgets/typography/sp-heading" },
  { id: "spectrum-sp-body", url: "https://developer.adobe.com/uxp/uxp-api/reference-spectrum/spectrum-uxp-widgets/typography/sp-body" },
  { id: "spectrum-sp-button", url: "https://developer.adobe.com/uxp/uxp-api/reference-spectrum/spectrum-uxp-widgets/user-interface/sp-button" }
];

/**
 * Fetched only when a goal or an existing call needs that host class.
 * These URLs were retrieved on 8 Nov 2026 and are re-fetched on each docs step.
 */
export const HOST_PAGES = {
  "photoshop.document": "https://developer.adobe.com/photoshop/uxp/2022/ps-reference/classes/document",
  "photoshop.layer": "https://developer.adobe.com/photoshop/uxp/2022/ps-reference/classes/layer",
  "photoshop.executeAsModal": "https://developer.adobe.com/photoshop/uxp/2022/ps-reference/media/executeasmodal",
  "photoshop.changelog": "https://developer.adobe.com/photoshop/uxp/2022/ps-reference/changelog/",
  "premiere.reference": "https://developer.adobe.com/premiere-pro/uxp/ppro_reference/",
  "premiere.introduction": "https://developer.adobe.com/premiere-pro/uxp/introduction/"
};

export function pagesForRequest({ host, goal = "", behaviors = [] } = {}) {
  const pages = SHARED_PAGES.map((page) => ({ ...page, scope: "shared" }));
  const text = `${goal} ${behaviors.join(" ")}`.toLowerCase();
  const photoshop = host === "phxs" || host === "PS" || /photoshop|\blayer\b|document title|document\.title|activeLayers|executeAsModal/.test(text);
  const premiere = host === "ppro" || host === "premierepro" || /premiere|importfiles/.test(text);
  if (photoshop) {
    for (const id of ["photoshop.document", "photoshop.layer", "photoshop.executeAsModal", "photoshop.changelog"]) {
      pages.push({ id, url: HOST_PAGES[id], scope: "host" });
    }
  }
  if (premiere) {
    pages.push({ id: "premiere.introduction", url: HOST_PAGES["premiere.introduction"], scope: "host" });
    pages.push({ id: "premiere.reference", url: HOST_PAGES["premiere.reference"], scope: "host" });
  }
  return pages;
}

export function mergeDocFacts(pages) {
  const merged = mergeCepFacts((pages || []).map((page) => ({
    ok: page.ok !== false && page.freshness !== "failed",
    facts: page.facts || extractDocFacts(page.text || "")
  })));
  return {
    limits: merged.limits,
    manifestApps: merged.apps,
    apps: merged.apps,
    webview: merged.webview,
    spectrum: merged.spectrum,
    commands: merged.commands
  };
}
