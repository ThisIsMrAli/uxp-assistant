import fs from "node:fs";
import path from "node:path";
import { namedPermissions, resolveRequestedPermissions } from "./permissions.mjs";
import { BOLT_APPS, BOLT_FRAMEWORKS, findApp } from "./stack.mjs";

/**
 * What the request already says. The skill reads the goal, so the developer is not asked
 * for the host, the name, the id, or the permissions they have just typed or implied.
 */

const HOST_WORDS = [
  { id: "ppro", pattern: /\bpremiere(?:\s+pro)?\b|\bppro\b/i },
  { id: "phxs", pattern: /\bphotoshop\b|\bphxs\b/i },
  { id: "idsn", pattern: /\bindesign\b|\bidsn\b/i },
  { id: "ame", pattern: /\bmedia\s+encoder\b/i },
  { id: "ilst", pattern: /\billustrator\b/i },
  { id: "aeft", pattern: /\bafter\s+effects\b/i }
];

/** The one host a request names, or "" when it names none or more than one. */
export function detectHost(goal) {
  const hits = HOST_WORDS.filter((item) => item.pattern.test(String(goal || ""))).map((item) => item.id);
  return hits.length === 1 ? hits[0] : "";
}

export function detectFramework(goal) {
  const text = String(goal || "");
  if (/\bsvelte\b/i.test(text)) return "svelte";
  if (/\bvue\b/i.test(text)) return "vue";
  return "react";
}

export function detectRuntime(goal) {
  return /\bweb\s?view\b/i.test(String(goal || "")) ? "webview" : "native";
}

const ACRONYMS = new Set(["qr", "pdf", "svg", "png", "jpg", "jpeg", "gif", "url", "uri", "ai", "ui", "ux", "xml", "csv", "json", "api", "srt", "vtt", "lut", "xmp", "rgb", "cmyk", "hdr", "psd", "mp4", "mov", "gpu", "ocr", "id", "seo", "css", "html", "pdf417", "ean", "upc"]);
const FILLER = new Set(["high", "quality", "good", "great", "best", "nice", "simple", "easy", "fast", "new", "custom", "beautiful", "awesome", "powerful", "professional", "really", "very", "some", "any", "my", "our", "all", "both", "every", "each", "a", "an", "the"]);
const VERBS = new Set(["create", "generate", "make", "build", "show", "list", "display", "export", "import", "write", "add", "convert", "find", "manage", "edit", "produce", "render", "copy", "upload", "download", "rename", "sort", "resize", "crop", "apply", "fix", "clean", "extract", "search", "sync", "translate", "batch", "automate", "insert", "place", "replace", "remove", "delete", "check", "preview", "open", "save", "set", "get", "read", "scan", "detect", "split", "merge", "trim", "cut", "mark", "label", "tag", "organize", "arrange", "align", "duplicate", "swap"]);
const CLAUSE = new Set(["with", "by", "using", "from", "for", "to", "that", "which", "so", "into", "via", "when", "where", "based", "in", "on", "at", "inside", "within", "across", "through", "between", "over", "and", "or", "then"]);

function isVerb(word) {
  const lower = word.toLowerCase();
  return VERBS.has(lower) || VERBS.has(lower.replace(/(?:es|s)$/, "")) || VERBS.has(lower.replace(/s$/, "")) || VERBS.has(lower.replace(/ing$/, "")) || VERBS.has(lower.replace(/ing$/, "e"));
}

/** A short display name from the request: "create high quality qr codes" becomes "QR Codes". */
export function deriveName(goal) {
  let text = String(goal || "").replace(/\s+/g, " ").trim().replace(/[.!?]+$/g, "");
  for (const host of HOST_WORDS) {
    const word = host.pattern.source.replace(/\\b/g, "");
    text = text.replace(new RegExp(`\\b(?:(?:in|for|inside|within|on|from|with|using|into)\\s+)?(?:both\\s+)?(?:adobe\\s+)?(?:${word})\\b`, "gi"), " ");
  }
  text = text.replace(/\s+/g, " ").trim();
  let purpose = false;
  const lead = /^(?:please\s+)?(?:can you\s+|could you\s+|i\s+(?:want|need|would like)\s+(?:you\s+)?(?:to\s+)?)?(?:(?:create|build|make|write|develop|design|give|get)\s+(?:me\s+|us\s+)?)?(?:(?:an?|the|my|new)\s+)*(?:(?:uxp|adobe|new)\s+)*(?:plugin|plug-in|panel|extension|tool|add-?on|app)\b\s*(that|which|to|for|called|named|:|-)?\s*/i;
  const matched = text.match(lead);
  if (matched) {
    text = text.slice(matched[0].length);
    purpose = /^(?:that|which|to|for)$/i.test(matched[1] || "") ;
  }
  text = text.replace(/^(?:to|that|which|for)\s+/i, () => { purpose = true; return ""; });
  let words = text.split(/[^A-Za-z0-9+#]+/).filter(Boolean);
  // "finds and replaces text": the verbs and the "and" between them are not part of the name.
  for (let first = true; words.length > 1; first = false) {
    const word = words[0].toLowerCase();
    const strip = VERBS.has(word) || /^(?:and|or|then)$/.test(word) || (purpose && (isVerb(word) || (first && /^[a-z]+s$/i.test(word))));
    if (!strip) break;
    words.shift();
  }
  while (words.length > 1 && FILLER.has(words[0].toLowerCase())) words.shift();
  const cutAt = words.findIndex((word, index) => index > 0 && CLAUSE.has(word.toLowerCase()));
  const phrase = cutAt > 0 ? words.slice(0, cutAt) : words;
  const kept = phrase.filter((word) => !FILLER.has(word.toLowerCase()));
  const chosen = (kept.length ? kept : phrase).slice(0, 4);
  const trimmed = chosen.filter((word, index) => !(index === chosen.length - 1 && /^(?:a|an|the|of|to|in|on|for|and|or|with|that|which)$/i.test(word)));
  words = trimmed;
  if (!words.length) return "UXP Plugin";
  const title = words.map((word) => {
    const lower = word.toLowerCase();
    if (ACRONYMS.has(lower)) return lower.toUpperCase();
    return lower.charAt(0).toUpperCase() + lower.slice(1);
  }).join(" ");
  return title.length > 40 ? title.slice(0, 40).trim() : title;
}

export function slugify(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "uxp-plugin";
}

/** com.example.qrcodes from "QR Codes". The developer can change it; the plan card shows it. */
export function deriveId(name) {
  const part = String(name || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  return `com.example.${part || "plugin"}`;
}

export function hostLabel(host) {
  return findApp(host)?.label.replace(/\s*\(Beta\)$/i, "") || host || "unknown host";
}

/**
 * The plan for a request. `flags` are what the assistant passed on the command line and win over
 * what the request implies. Nothing here is asked: it is shown once on the plan card.
 */
export function makePlan({ goal, kind = "empty", input = "", project = "", flags = {} } = {}) {
  const text = String(goal || "").trim();
  const facts = kind === "existing" && project ? projectFacts(project) : null;
  const host = normalizeHost(flags.host) || detectHost(text) || (facts?.host || "");
  const framework = facts?.framework || (BOLT_FRAMEWORKS.some((item) => item.id === flags.framework) ? flags.framework : detectFramework(text));
  const name = String(flags.name || facts?.name || deriveName(text)).trim();
  const id = String(flags.id || facts?.id || deriveId(name)).trim();
  const runtime = flags.runtime === "webview" || flags.runtime === "native" ? flags.runtime : detectRuntime(text);
  const permissions = resolveRequestedPermissions("auto", text);
  return {
    goal: text,
    kind,
    input,
    project,
    host,
    hostDetected: Boolean(host) && !flags.host,
    framework,
    name,
    id,
    runtime,
    permissions,
    context: "panel"
  };
}

function normalizeHost(value) {
  if (!value || value === true) return "";
  return findApp(String(value))?.id || "";
}

/** The plan with the answers the developer gave on the card. */
export function applyAnswers(plan, answers = {}) {
  const next = { ...plan };
  const host = normalizeHost(answers.host);
  if (host) next.host = host;
  if (BOLT_FRAMEWORKS.some((item) => item.id === answers.framework)) next.framework = answers.framework;
  if (typeof answers.name === "string" && answers.name.trim()) next.name = answers.name.trim().slice(0, 80);
  if (typeof answers.id === "string" && answers.id.trim()) next.id = answers.id.trim().slice(0, 80);
  if (answers.runtime === "webview" || answers.runtime === "native") next.runtime = answers.runtime;
  if (typeof answers.permissions === "string" && answers.permissions) next.permissions = resolveRequestedPermissions(answers.permissions, plan.goal);
  return next;
}

export function projectFacts(project) {
  const config = path.join(project, "uxp.config.ts");
  let id = "";
  let name = "";
  let host = "";
  let framework = "react";
  if (fs.existsSync(config)) {
    const text = fs.readFileSync(config, "utf8");
    id = (text.match(/export const id = "([^"]+)"/) || [])[1] || "";
    name = (text.match(/const name = "([^"]+)"/) || [])[1] || "";
    const apps = [...text.matchAll(/app:\s*"([A-Za-z]+)"/g)].map((item) => item[1]);
    host = BOLT_APPS.find((item) => apps.includes(item.manifestApp))?.id || "";
  }
  if (fs.existsSync(path.join(project, "src", "main.vue"))) framework = "vue";
  else if (fs.existsSync(path.join(project, "src", "main.svelte"))) framework = "svelte";
  const pkg = path.join(project, "package.json");
  if (!name && fs.existsSync(pkg)) {
    try {
      name = JSON.parse(fs.readFileSync(pkg, "utf8")).name || "";
    } catch {
      name = "";
    }
  }
  return { id, name: name || path.basename(project), framework, host, context: "panel" };
}

export { namedPermissions };
