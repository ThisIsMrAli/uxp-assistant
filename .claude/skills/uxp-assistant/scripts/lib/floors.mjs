/**
 * Version floors come from retrieved page text plus the maintained starter's
 * own manifest. Missing text stays unknown. The CEP WebView floor of 26.0.0
 * is not an input.
 */

export const BOLT_STARTER = {
  repository: "https://github.com/hyperbrew/bolt-uxp",
  commit: "bcc092f1b16c72cddbd2b88f106c33f09c089bcb",
  package: "create-bolt-uxp",
  version: "1.3.27",
  license: "MIT",
  copyright: "Copyright (c) Hyper Brew LLC",
  photoshopMinVersion: "24.2.0",
  manifestVersion: 6,
  where: "uxp.config.ts host app PS minVersion, manifestVersion 6"
};

export const WEBVIEW_FLOOR_NOT_USED = {
  source: "cep-to-uxp scripts/lib/hosts.mjs PHXS.minVersion",
  value: "26.0.0",
  why: "That floor is documented there as the local WebView (plugin:/) generation, not as the native DOM API floor."
};

function parseVersion(value) {
  const match = String(value || "").match(/^(\d+)\.(\d+)(?:\.(\d+))?$/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3] || 0)];
}

export function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (!a || !b) return null;
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1;
  }
  return 0;
}

function near(text, token) {
  const index = text.toLowerCase().indexOf(token.toLowerCase());
  if (index < 0) return "";
  return text.slice(index, index + 220);
}

export function floorsFromText(pages) {
  const textOf = (id) => String(pages.find((page) => page.id === id && page.ok)?.text || "");
  const layer = textOf("photoshop.layer");
  const document = textOf("photoshop.document");
  const modal = textOf("photoshop.executeAsModal");
  const changelog = textOf("photoshop.changelog");
  const manifest = textOf("manifest");
  const active = near(document, "activeLayers");
  const activeVersion = active.match(/(\d+\.\d+)/);
  const activeNote = active.match(/\((\d+\.\d+)\)/);
  const layerName = near(layer, "name");
  const nameVersion = /name of the layer/i.test(layer) ? (layerName.match(/(\d+\.\d+)/) || layer.match(/Name of the layer[\s\S]{0,40}?(\d+\.\d+)/i)) : null;
  const nameLine = layer.match(/name[^\n]{0,80}?(\d+\.\d+)[^\n]{0,80}Name of the layer/i);
  const modalVersion = modal.match(/commandName[^\n]{0,80}?(\d+\.\d+)/i) || modal.match(/(\d+\.\d+)[^\n]{0,40}progress bar/i);
  const historyVersion = modal.match(/suspendHistory[\s\S]{0,80}?(\d+\.\d+)/i);
  const manifestHostFloor = /minVersion[^\n]{0,80}?(\d+\.\d+\.\d+)/.exec(manifest);
  const manifestSchema = /manifest version\s+`?(\d+)`?/i.exec(manifest);
  const changelogWrite = /set Document\s*`?activeLayers`?|activeLayers` by providing an array/i.test(changelog);
  return {
    layerName: nameLine?.[1] || (nameVersion ? nameVersion[1] : null),
    activeLayers: activeVersion ? activeVersion[1] : null,
    activeLayersParenthetical: activeNote ? activeNote[1] : null,
    activeLayersWriteByArrayInChangelog: changelog ? changelogWrite : null,
    executeAsModalCommand: modalVersion ? modalVersion[1] : null,
    suspendHistory: historyVersion ? historyVersion[1] : null,
    manifestStatesNumericHostFloor: Boolean(manifestHostFloor),
    manifestSchemaVersion: manifestSchema ? manifestSchema[1] : null,
    apiVersionMentioned: /apiVersion/i.test(manifest)
  };
}

/**
 * Keep the starter floor when it is newer than the proven API floor.
 * Do not fill an unknown with 23.0, 24.2.0, or 26.0.0.
 */
export function effectiveHostFloor(parsed, starterMin = BOLT_STARTER.photoshopMinVersion) {
  const proven = [parsed.executeAsModalCommand, parsed.suspendHistory, parsed.layerName, parsed.activeLayers].filter(Boolean);
  const api = proven.reduce((highest, value) => {
    if (!highest) return value;
    const order = compareVersions(value, highest);
    return order === 1 ? value : highest;
  }, null);
  if (!api) {
    return {
      minVersion: starterMin || null,
      apiFloor: null,
      starterMin: starterMin || null,
      reason: starterMin
        ? "The retrieved pages did not prove an API floor. The starter minVersion is left as the installer wrote it."
        : "No API floor and no starter floor."
    };
  }
  const order = compareVersions(starterMin, api);
  if (order === null) {
    return { minVersion: api, apiFloor: api, starterMin: starterMin || null, reason: "The starter minVersion could not be compared. The proven API floor is recorded and the manifest is not rewritten from the WebView floor." };
  }
  if (order >= 0) {
    return {
      minVersion: starterMin,
      apiFloor: api,
      starterMin,
      reason: `The maintained starter minVersion ${starterMin} is newer than or equal to the proven API floor ${api}. It is not lowered, and it is not raised to the WebView floor ${WEBVIEW_FLOOR_NOT_USED.value}.`
    };
  }
  return {
    minVersion: api,
    apiFloor: api,
    starterMin,
    reason: `The proven API floor ${api} is newer than the starter minVersion ${starterMin}. The higher proven floor is the one to declare. This is not the WebView floor.`
  };
}
