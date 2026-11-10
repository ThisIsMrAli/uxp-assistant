import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { deriveName } from "./intent.mjs";

/**
 * ui-ux-pro-max, adapted for a UXP panel.
 * The search runs for every goal. Its palette, type, and motion are not the panel.
 */

const CANDIDATES = () =>
  [
    process.env.UI_UX_PRO_MAX,
    path.join(os.homedir(), ".agents/skills/ui-ux-pro-max/scripts/search.py"),
    path.join(os.homedir(), ".cursor/skills/ui-ux-pro-max/scripts/search.py"),
    path.join(os.homedir(), ".claude/skills/ui-ux-pro-max/scripts/search.py")
  ].filter(Boolean);

export function findDesignScript() {
  return CANDIDATES().find((file) => fs.existsSync(file)) || "";
}

/** A short product phrase. The goal's private details stay out of the query. */
export function designQuery(goal) {
  const name = deriveName(goal);
  const base = name === "UXP Plugin" ? "utility" : name;
  return `${base} utility panel dense`.replace(/\s+/g, " ").trim().slice(0, 80);
}

/** The interaction this goal actually has, not a sample feature. */
export function interactionQuery(goal) {
  const text = String(goal || "");
  if (/\blist|table|rows|markers|layers\b/i.test(text)) return "list selection empty state";
  if (/\bdialog|modal|confirm\b/i.test(text)) return "dialog focus error summary";
  if (/\bpreview|image|canvas|thumbnail|photo\b/i.test(text)) return "visible label reserve space";
  return "visible label inline error";
}

function runPython(script, args) {
  const python = process.platform === "win32" ? "python" : "python3";
  const result = spawnSync(python, [script, ...args], { encoding: "utf8", timeout: 20000 });
  return result.status === 0 ? String(result.stdout || "") : "";
}

function clean(line) {
  return String(line || "")
    .replace(/#[0-9A-Fa-f]{3,8}\b/g, "the host color")
    .replace(/\s+/g, " ")
    .trim();
}

function named(text, heading) {
  const chunk = String(text || "").split(new RegExp(`### ${heading}`))[1] || "";
  return clean((chunk.match(/\*\*Name:\*\*\s*(.+)/) || [])[1] || "");
}

function uxHits(text) {
  const hits = [];
  for (const block of String(text || "").split(/### Result /).slice(1, 4)) {
    const issue = clean((block.match(/\*\*Issue:\*\*\s*(.+)/) || [])[1] || "");
    const Do = clean((block.match(/\*\*Do:\*\*\s*(.+)/) || [])[1] || "");
    const dont = clean((block.match(/\*\*Don't:\*\*\s*(.+)/) || [])[1] || "");
    if (issue && Do) hits.push(`- ${issue}: ${Do}${dont ? ` Avoid: ${dont}` : ""}`);
  }
  return hits;
}

function surfaceRules(plan) {
  if (plan.runtime === "webview") {
    return [
      "- The page inside the WebView may use normal CSS, including grid and gap. Apply the interaction rules there: a visible label above each field, the error under that field, one primary button, and a result with an explicit width and height.",
      "- The page uses the host color variables. It does not use the search palette, a downloaded font, or a landing-page layout.",
      "- The host shell around the page is a UXP document. It uses Spectrum when the plan says Spectrum. It does not use grid, gap, or a plain button. Remote fetch runs on the host."
    ];
  }
  if (plan.widgets === "html") {
    return [
      "- The plan asked for plain HTML. Use UXP HTML, not Spectrum. The interaction rules still apply: a label above each field, the error under it, and one primary button.",
      "- Host color variables, flex, and margins. No grid, gap, inset, transitions, or the search palette.",
      "- A canvas or image gets the same pixel width and height on the element and in its style."
    ];
  }
  return [
    "- Express the interaction rules with Spectrum, for this plugin and every other: `sp-heading`, `sp-body`, `sp-divider`, `sp-label` on its own line, `sp-textfield` or `sp-textarea`, `sp-dropdown` or `sp-picker`, and `sp-button`.",
    "- One `variant=\"cta\"`. The other actions are `secondary`. Do not pass `value` or `selected` as a React prop. Read `onInput` and use `setAttribute`.",
    "- `sp-textarea`, `sp-dropdown`, and `sp-picker` paint outside their layout box. Put each in a wrapper with an explicit pixel height, and set `display: block`, `position: relative`, `width: 100%`, and `height` on the element itself.",
    "- Host color variables, flex, and margins. No grid, gap, inset, transitions, or the search palette.",
    "- A preview, list, or image keeps a fixed box. A canvas uses the same pixel width and height on the element and in its style, inside a well with `overflow: hidden`."
  ];
}

export function designSection(plan, options = {}) {
  const script = options.script === undefined ? findDesignScript() : options.script;
  const run = options.run || runPython;
  const query = designQuery(plan.goal);
  const interaction = interactionQuery(plan.goal);
  const lines = [
    "## Design",
    "This section is ui-ux-pro-max, searched for this goal. Use the interaction rules on every plugin. Do not copy the search colors, fonts, motion, or marketing sections."
  ];
  if (!script) {
    lines.push("ui-ux-pro-max is not installed on this computer, so no search ran. Follow Panel UI. Do not invent a brand palette.");
  } else {
    const system = run(script, [query, "--design-system", "--density", "8", "--variance", "3", "-f", "markdown"]);
    const ux = run(script, [interaction, "--domain", "ux", "-n", "3"]);
    const pattern = named(system, "Pattern");
    const style = named(system, "Style");
    const hits = uxHits(ux);
    const marketing = /hero|landing|pricing|testimonial|cta|feature/i.test(pattern);
    lines.push(
      marketing
        ? `- \`${query}\` --design-system --density 8 --variance 3. The search returned a marketing layout (${pattern || "a landing page"}). Ignore it. This is a dense tool panel inside an Adobe app.${style ? ` Keep the density of ${style}.` : ""}`
        : `- \`${query}\` --design-system --density 8 --variance 3${pattern || style ? `: ${[pattern && `pattern ${pattern}`, style && `style ${style}`].filter(Boolean).join(", ")}.` : ". The search returned no pattern. Follow Panel UI."}`
    );
    lines.push(`- \`${interaction}\` --domain ux`);
    if (hits.length) lines.push(...hits);
    else lines.push("- The interaction search returned nothing. Use a visible label, the error under the field, and one primary action.");
    lines.push(`If this screen needs one more rule (a list, a dialog, or an empty state), run \`${script}\` with \`--domain ux\` and a short query. Do not write a design-system file into the project.`);
  }
  lines.push(...surfaceRules(plan));
  lines.push("");
  return lines;
}
