import { deriveId, deriveName, folderIsEmpty, statedRuntime, statedWidgets } from "./intent.mjs";

/**
 * What the sentence did not decide. Questions for these are asked before the confirm card.
 * A fact the sentence already states is not asked again.
 */

export { folderIsEmpty, statedRuntime, statedWidgets };

export function nameIsGeneric(name) {
  return /^(?:uxp plugin|plugin|panel|me plugin|extension|tool)$/i.test(String(name || "").trim());
}

/** The request does not say what the plugin does. */
export function goalIsThin(goal) {
  const text = String(goal || "").trim();
  if (!text) return true;
  return nameIsGeneric(deriveName(text));
}

/**
 * Up to two choices the goal leaves open. Each has a recommended first option.
 * A sentence that already picks the side does not get the question.
 */
export function featureQuestions(plan) {
  const text = `${plan.goal || ""} ${plan.name || ""}`;
  const questions = [];
  if (/\bqr\b|barcode/i.test(text) && !/\b(?:import|save|export|png)\b/i.test(plan.goal || "")) {
    questions.push({
      id: "feat-output",
      title: "What happens to the code",
      prompt: "What should the panel do with the QR code?",
      options: [
        { id: "both", label: "Save a PNG and import it (Recommended)", detail: "Writes a file, then brings it into the project." },
        { id: "save", label: "Save a PNG only", detail: "The user picks where the file goes." },
        { id: "import", label: "Import into the project", detail: "Places the image in the project without a separate export step." }
      ]
    });
  }
  if (/\blayer/i.test(text) && !/\bselected\b/i.test(text) && !(/\bevery\b|\ball layers\b/i.test(text))) {
    questions.push({
      id: "feat-scope",
      title: "Which layers",
      prompt: "Which layer names should the panel change?",
      options: [
        { id: "selected", label: "Selected layers (Recommended)", detail: "Only the layers the user has selected." },
        { id: "all", label: "Every layer", detail: "Every layer in the document." }
      ]
    });
  }
  return questions.slice(0, 2);
}

/** Questions still open after reading the sentence. The confirm card is not one of these. */
export function planningQuestions(plan) {
  const questions = [];
  if (goalIsThin(plan.goal)) {
    questions.push({
      id: "goal",
      title: "What it does",
      prompt: "What should the plugin do? One or two sentences: the job, and what the user sees in the panel.",
      input: "text",
      maxLength: 400,
      options: []
    });
  }
  if (nameIsGeneric(plan.name)) {
    questions.push({
      id: "name",
      title: "Plugin name",
      prompt: "What should the panel be called? A short name, such as QR Codes.",
      input: "text",
      maxLength: 40,
      options: []
    });
  }
  if (goalIsThin(plan.goal)) {
    questions.push({
      id: "description",
      title: "Description",
      prompt: "In one sentence, what does the panel show and what does the main button do?",
      input: "text",
      maxLength: 240,
      options: []
    });
  }
  if (!plan.runtime) {
    questions.push({
      id: "runtime",
      title: "Panel UI",
      prompt: "Native UXP draws the panel with the host's own HTML. A WebView loads a browser page inside the panel, which starts extra processes. Use it only when the UI cannot be built as UXP HTML.",
      options: [
        { id: "native", label: "Native UXP (Recommended)", detail: "Spectrum or plain HTML in the host. No WebView." },
        { id: "webview", label: "WebView", detail: "Last resort. A browser page inside the panel." }
      ]
    });
  }
  if (!plan.widgets) {
    questions.push({
      id: "widgets",
      title: "Controls",
      prompt: "Spectrum widgets match the Adobe app. Plain HTML is for a look Spectrum cannot do.",
      options: [
        { id: "spectrum", label: "Spectrum (Recommended)", detail: "sp-button, sp-textfield, and the host's other widgets." },
        { id: "html", label: "Plain HTML and CSS", detail: "No Spectrum widgets." }
      ]
    });
  }
  if (!plan.design) {
    questions.push({
      id: "design",
      title: "Look",
      prompt: "Should the panel look like the host, or do you have a look in mind?",
      options: [
        { id: "match", label: "Match the host (Recommended)", detail: "Host colors, compact type, no custom theme." },
        { id: "custom", label: "I have a look in mind", detail: "You describe colors, density, or a reference next." }
      ]
    });
    questions.push({
      id: "designNote",
      title: "The look",
      prompt: "Describe the look in a sentence: colors, density, or a reference.",
      input: "text",
      maxLength: 200,
      options: [],
      when: { design: "custom" }
    });
  }
  questions.push(...featureQuestions(plan));
  return questions;
}

/** Writes planning answers onto the plan. Safe to call on every read. */
export function applyPlanning(plan, answers) {
  const next = { ...plan, features: { ...(plan.features || {}) } };
  if (typeof answers.goal === "string" && answers.goal.trim()) {
    next.goal = answers.goal.trim();
    if (!answers.name && nameIsGeneric(next.name)) {
      next.name = deriveName(next.goal);
      next.id = deriveId(next.name);
    }
  }
  if (typeof answers.name === "string" && answers.name.trim()) {
    next.name = answers.name.trim().slice(0, 40);
    if (!answers.id) next.id = deriveId(next.name);
  }
  if (typeof answers.description === "string" && answers.description.trim()) next.description = answers.description.trim().slice(0, 240);
  else if (!next.description && !goalIsThin(next.goal)) next.description = next.goal;
  if (answers.runtime === "webview" || answers.runtime === "native") next.runtime = answers.runtime;
  if (answers.widgets === "spectrum" || answers.widgets === "html") next.widgets = answers.widgets;
  if (answers.design === "match") next.design = "Match the host";
  else if (answers.design === "custom" && typeof answers.designNote === "string" && answers.designNote.trim()) next.design = answers.designNote.trim().slice(0, 200);
  for (const [id, value] of Object.entries(answers)) {
    if (id.startsWith("feat-") && value) next.features[id] = value;
  }
  if (typeof answers.blockedGoal === "string" && answers.blockedGoal.trim() && !hardBlocks({ ...next, goal: answers.blockedGoal }).length) {
    next.goal = answers.blockedGoal.trim();
  }
  return next;
}

/** Goals UXP cannot do, with no workaround. Empty when the goal is buildable. */
export function hardBlocks(plan) {
  const text = `${plan.goal || ""} ${plan.description || ""}`;
  const hits = [];
  if (/\bwebgl\b|\bthree\.?js\b/i.test(text)) hits.push("UXP canvas supports only the 2d context. WebGL and Three.js are not available.");
  if (/\bextendscript\b|\bevalscript\b|\bjsxbin\b|\.jsx\b/i.test(text)) hits.push("UXP cannot run ExtendScript, evalScript, or JSX.");
  return hits;
}

export function blockedQuestion(hits) {
  return {
    id: "blocked",
    title: "Not supported",
    prompt: `${hits.join(" ")}\n\nChange the goal, or stop. The plugin will not be scaffolded while this stays in the goal.`,
    options: [
      { id: "change", label: "Change the goal", detail: "Describe a version UXP can do." },
      { id: "stop", label: "Stop", detail: "Ends the session. Nothing is created.", ends: true }
    ]
  };
}

export function blockedGoalQuestion() {
  return {
    id: "blockedGoal",
    title: "New goal",
    prompt: "What should the plugin do instead? Leave out WebGL, ExtendScript, and JSX.",
    input: "text",
    maxLength: 400,
    options: []
  };
}

/** Limit, then the way to build it. These are the fixes, not a dump of every known issue. */
export function buildWays(plan) {
  const text = `${plan.goal || ""} ${plan.description || ""} ${plan.name || ""}`;
  const lines = [
    "- Layout: use flex. CSS grid, gap, transitions, animations, and text-transform do not paint. Set font-size, font-family, and font-weight on their own.",
    "- Dialogs: an absolutely positioned layer inside the panel. Do not mount Radix Dialog, Popper, or react-remove-scroll.",
    "- Chrome that must not pick up the host button skin: `<div role=\"button\">`, not `<button>`."
  ];
  if (plan.widgets !== "html") {
    lines.push("- Spectrum: do not pass `value` as a React prop on `sp-textfield`, `sp-picker`, or `sp-menu-item`. Set it with `setAttribute`. Give `sp-dropdown` a width.");
  }
  if (/\bqr\b|png|jpe?g|image|canvas|draw|svg/i.test(text)) {
    lines.push("- Images: the canvas has no `toDataURL` or `toBlob`. Encode the bytes (or use a pure JS package) and write them with `uxp.storage.localFileSystem`.");
  }
  if (plan.runtime === "webview") {
    lines.push("- WebView: `fetch` from the page is blocked. Do the request on the host, and put the origin in `network.domains`.");
  } else {
    lines.push("- `src/uxp-guard.js` is imported first and also loaded as `uxp-compat.js`. It supplies TextEncoder, TextDecoder, observers, `localStorage` on `plugin:/`, unitless SVG sizes, and `currentColor`. UXP has none of these. Do not remove it.");
  }
  return lines;
}

const FEATURE_LABELS = {
  "feat-output": { both: "Save a PNG and import it into the project.", save: "Save a PNG only.", import: "Import the image into the project." },
  "feat-scope": { selected: "Change selected layers only.", all: "Change every layer." }
};

/**
 * How to lay out the panel. These are UXP rules learned from real panels, not a copied design system.
 * A native document cannot use the starter's demo CSS. A WebView page is a browser, but it still sits in the host.
 */
export function panelGuide(plan) {
  const shared = [
    "- One main action uses the strongest button. Other actions are secondary. Every field has a visible label. An error sits under that field, and a status line says what just happened.",
    "- The result (preview, list, or image) is a square or a block with an explicit width and height. `height: auto` on a canvas collapses to a thin line. Set the canvas width and height to the same pixel size. `check` fails on that.",
    "- Use the host colors (`--uxp-host-background-color`, `--uxp-host-text-color`, `--uxp-host-border-color`). Do not invent a separate brand palette. An image that must stay white, such as a code or a photo, sits on a white well only.",
    "- No emoji icons. Do not remove focus outlines."
  ];
  if (plan.runtime === "webview") {
    return [
      ...shared,
      "- The WebView page is a browser, so grid, gap, and normal CSS are fine there. Keep the layout dense: the result first, then the fields, then the button. At a wide size, put the fields beside the result.",
      "- The host shell around the page stays UXP. `check` fails if that shell uses grid, gap, a plain `<button>`, or a `value` prop on a Spectrum field. Remote `fetch` still runs on the host."
    ];
  }
  return [
    ...shared,
    "- Native UI is the host's Spectrum widgets: `sp-heading`, `sp-body`, `sp-divider`, `sp-textfield` or `sp-textarea`, and `sp-button`. One `variant=\"cta\"`. The rest are `secondary`. A plain `<button>` fails `check`, because Premiere skins it.",
    "- Do not pass `value` or `selected` as a prop on `sp-textfield`, `sp-textarea`, `sp-picker`, or `sp-menu-item`. Premiere's are getters, and React throws. Read `onInput` and use `setAttribute`. `check` fails on the prop.",
    "- The scaffold already removed the centered demo CSS and left a Spectrum screen. Do not bring `app.css` back. Lay the panel out with flex. No CSS grid, `gap`, or `inset`. `check` fails on those in the host document.",
    "- `sp-textarea` and `sp-dropdown` paint outside the layout box, so a stylesheet height does not keep them in the column. Put each one in its own wrapper with an explicit pixel height, and set `display`, `position: relative`, `width`, and `height` on the element itself. A label sits on its own line above the control. The preview well is a fixed square after the fields, with `overflow: hidden`.",
    "- Set `minimumSize` and `preferredFloatingSize` in `uxp.config.ts` so the layout has room."
  ];
}

export function featureLines(plan) {
  const lines = [];
  for (const [id, value] of Object.entries(plan.features || {})) {
    const label = FEATURE_LABELS[id]?.[value];
    if (label) lines.push(`- ${label}`);
  }
  return lines;
}
