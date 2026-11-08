/**
 * Copied from cep-to-uxp b2fa98eb28e935dcdfc08cb30d7f66e7bd86f40a
 * `.claude/skills/cep-to-uxp/scripts/lib/docs.mjs` (`extractDocFacts`, `mergeDocFacts`).
 * MIT License. Copyright (c) 2026 cep-to-uxp contributors.
 * hosts.mjs is not copied. Its WebView floor is not a native floor.
 */

const LIMIT_MARKERS = [
  ["text-transform", /text-transform is not supported/i],
  ["font-shorthand", /font shorthand CSS rule is not supported/i],
  ["css-animations", /CSS transitions and animations are not supported/i],
  ["unitless-size", /unitless values in\s+width and height/i],
  ["select-value", /setAttribute\("value"/],
  ["css-grid", /CSS Grid Layout is not available/i],
  ["drag-and-drop", /Drag and Drop is not currently supported/i],
  ["lists", /does not support ordered lists|does not, by default, support lists/i],
  ["aria", /aria\*/]
];

const KNOWN_APP_IDS = ["PS", "ID", "premierepro", "ame", "mediaencoder", "AI", "AE"];

export function extractDocFacts(text) {
  const apps = new Set();
  const source = String(text);
  for (const match of source.matchAll(/"app"\s*:\s*"([A-Za-z0-9]+)"/g)) apps.add(match[1]);
  for (const id of KNOWN_APP_IDS) {
    if (source.includes(`"${id}"`) || source.includes(`\`${id}\``)) apps.add(id);
  }
  const limits = LIMIT_MARKERS.filter(([, pattern]) => pattern.test(source)).map(([id]) => id);
  return {
    apps: [...apps].sort(),
    webview: /allowLocalRendering|HTMLWebViewElement|plugin:\//.test(source),
    spectrum: /Spectrum Web Components|enableSWCSupport/.test(source),
    commands: /type"\s*:\s*"command"|Commands are/.test(source),
    limits
  };
}

export function mergeDocFacts(pages) {
  const apps = new Set();
  const limits = new Set();
  const flags = { webview: false, spectrum: false, commands: false };
  for (const page of pages) {
    if (!page.ok) continue;
    for (const app of page.facts?.apps || []) apps.add(app);
    for (const limit of page.facts?.limits || []) limits.add(limit);
    for (const key of Object.keys(flags)) flags[key] = flags[key] || Boolean(page.facts?.[key]);
  }
  return { apps: [...apps].sort(), limits: [...limits].sort(), ...flags };
}
