/**
 * Runtime choices come from fresh pages and assessed files.
 * extractDocFacts is the cep-to-uxp page reading. A missing fact removes the choice.
 */
import { extractDocFacts } from "./cep/docs-facts.mjs";

const QUOTES = [
  ["css-animations", /CSS transitions and animations are not supported\.?/i],
  ["text-transform", /text-transform is not supported\.?/i],
  ["font-shorthand", /font shorthand CSS rule is not supported\.?/i],
  ["css-grid", /CSS Grid Layout is not available\.?/i],
  ["drag-and-drop", /Drag and Drop is not currently supported\.?/i]
];

export function retrievedLimits(pages = []) {
  const found = [];
  for (const page of pages) {
    if (page.freshness !== "fresh" || !page.text) continue;
    const facts = extractDocFacts(page.text);
    for (const [id, pattern] of QUOTES) {
      if (!facts.limits.includes(id)) continue;
      const match = String(page.text).match(pattern);
      if (!match) continue;
      const quote = match[0].replace(/\s+/g, " ").trim();
      if (!found.some((item) => item.quote === quote)) found.push({ id, quote, page: page.id });
    }
  }
  return found;
}

export function contextEvidence(pages, context) {
  const entry = (pages || []).find((page) => page.id === "entrypoints" && page.freshness === "fresh" && page.text);
  const word = String(context || "").trim();
  if (!entry) {
    return { confirmed: false, reason: "The entrypoints page is not fresh, so this context is not confirmed." };
  }
  if (word && new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(entry.text)) {
    return { confirmed: true, reason: `The fresh entrypoints page contains "${word}". That is not a host pass.` };
  }
  return {
    confirmed: false,
    reason: `The fresh entrypoints page did not contain "${word || "the requested context"}" as a word this checker could match. Keeping it is unverified.`
  };
}

const SPECTRUM_SENTENCES = [
  /You don't need to include any special libraries[^.]*\./,
  /they are immediately available in the global context\.?/,
  /they are not built atop Web Components\.?/,
  /Once imported, UXP will assume you intend to use the SWC variation\.?/,
  /Since: UXP v4\.1/
];

/** Quotes only sentences present on fresh Spectrum pages. A missing sentence is not invented. */
export function spectrumGuidance(pages = []) {
  const quotes = [];
  const tags = [];
  for (const page of pages) {
    if (page.freshness !== "fresh" || !page.text) continue;
    const text = String(page.text).replace(/\s+/g, " ");
    for (const pattern of SPECTRUM_SENTENCES) {
      const match = text.match(pattern);
      if (!match) continue;
      const quote = match[0].trim();
      if (!quotes.some((item) => item.quote === quote)) quotes.push({ quote, page: page.id });
    }
    const tag = String(page.id).match(/^spectrum-(sp-[a-z]+)$/)?.[1];
    if (tag && /Since: UXP v4\.1/.test(text) && !tags.includes(tag)) tags.push(tag);
  }
  return { quotes, tags };
}

export function runtimeOffer({ pages = [], behaviors = [], goal = "", cepHybrid = false } = {}) {
  const fresh = (id) => pages.find((page) => page.id === id && page.freshness === "fresh" && page.text);
  const entry = fresh("entrypoints");
  const manifest = fresh("manifest");
  const web = fresh("webview");
  const webFacts = web ? extractDocFacts(web.text) : null;
  const choices = [];
  const gaps = [];
  if (entry || manifest) {
    choices.push({
      id: "native",
      label: "Native UXP panel",
      detail: "A fresh entrypoints or manifest page is the native panel surface. Retrieved CSS limits still apply. This choice does not launch the Adobe host."
    });
  } else {
    gaps.push("Native UXP was not offered because the entrypoints and manifest pages are not fresh. Refresh them before editing.");
  }
  if (web && webFacts?.webview) {
    choices.push({
      id: "webview",
      label: "UXP WebView element",
      detail: "extractDocFacts found HTMLWebViewElement, allowLocalRendering, or plugin:/ on the fresh WebView page. The embedded document is not the Photoshop or Premiere DOM. window.uxpHost is a bridge shim and does not add a missing host API."
    });
  } else if (web) {
    gaps.push("WebView was not offered. The page was fresh, and extractDocFacts did not find HTMLWebViewElement, allowLocalRendering, or plugin:/. The alternative is the native panel when that surface is fresh.");
  } else {
    gaps.push("WebView was not offered because its page is not fresh. Refresh that page before choosing it. A native panel remains the alternative when the entrypoints or manifest page is fresh.");
  }
  const bridge = cepHybrid
    || behaviors.some((item) => item.behavior === "native-addon" || item.behavior === "host-system-call")
    || /hybrid|\.node|app\.system/i.test(goal);
  if (bridge) {
    choices.push({
      id: "hybrid",
      label: "Assess a native bridge",
      detail: "A .node addon, app.system call, or non-opener cep.process was assessed, or the goal names one. This choice does not create that API, does not execute it, and does not drop the assessed files."
    });
  } else {
    gaps.push("Hybrid was not offered. No native bridge was assessed, and these fresh pages do not establish a hybrid API.");
  }
  if (/webview|postmessage/i.test(goal)) {
    const index = choices.findIndex((item) => item.id === "webview");
    if (index > 0) choices.unshift(choices.splice(index, 1)[0]);
  }
  return { choices, gaps, limits: retrievedLimits(pages) };
}
