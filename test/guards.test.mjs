import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { removeProfile } from "../.claude/skills/uxp-assistant/scripts/lib/chrome.mjs";
import { effectiveHostFloor, floorsFromText, WEBVIEW_FLOOR_NOT_USED } from "../.claude/skills/uxp-assistant/scripts/lib/floors.mjs";
import { narrowRequiredPermissions } from "../.claude/skills/uxp-assistant/scripts/lib/permissions.mjs";
import { installerEntry } from "../.claude/skills/uxp-assistant/scripts/lib/scaffold.mjs";
import { resolveCapability } from "../.claude/skills/uxp-assistant/scripts/lib/capability.mjs";
import { previewRename, findCollisions } from "../.claude/skills/uxp-assistant/scripts/lib/rename-preview.mjs";
import { refreshPages } from "../.claude/skills/uxp-assistant/scripts/lib/refresh.mjs";
import { checkStale } from "../.claude/skills/uxp-assistant/scripts/lib/tool.mjs";
import { connect } from "../.claude/skills/uxp-assistant/scripts/lib/ws.mjs";

test("floors do not invent the WebView floor or apiVersion", () => {
  const parsed = floorsFromText([
    { id: "photoshop.layer", ok: true, text: "name string R W 22.5 Name of the layer.\n" },
    { id: "photoshop.document", ok: true, text: "activeLayers Layers R W 22.5 The selected layers in the document. (26.9)\n" },
    { id: "photoshop.executeAsModal", ok: true, text: "commandName string required 23.0 shown above the progress bar.\nsuspendHistory 23.0\n" },
    { id: "photoshop.changelog", ok: true, text: "set Document activeLayers by providing an array of Layer objects.\n" },
    { id: "manifest", ok: true, text: "Current UXP hosts use manifest version 5.\nminVersion is required.\n" }
  ]);
  assert.equal(parsed.activeLayers, "22.5");
  assert.equal(parsed.activeLayersParenthetical, "26.9");
  assert.equal(parsed.apiVersionMentioned, false);
  assert.equal(parsed.manifestStatesNumericHostFloor, false);
  const floor = effectiveHostFloor(parsed, "24.2.0");
  assert.equal(floor.minVersion, "24.2.0");
  assert.equal(floor.apiFloor, "23.0");
  assert.notEqual(floor.minVersion, WEBVIEW_FLOOR_NOT_USED.value);
  const unknown = effectiveHostFloor({
    executeAsModalCommand: null,
    suspendHistory: null,
    layerName: null,
    activeLayers: null
  }, null);
  assert.equal(unknown.minVersion, null);
});

test("commandName 23.0 is read across lines and a nested permission object stays valid", () => {
  const parsed = floorsFromText([
    { id: "photoshop.executeAsModal", ok: true, text: "commandName\n\nstring\n\nrequired\n\n23.0\n\nThis description is shown above the progress bar.\n" },
    { id: "photoshop.layer", ok: true, text: "Name\n\nname\n\nstring\n\nR W\n\n22.5\n\nName of the layer.\n" }
  ]);
  assert.equal(parsed.executeAsModalCommand, "23.0");
  assert.equal(parsed.layerName, "22.5");
  const source = `export const manifest = {\n  requiredPermissions: {\n    localFileSystem: "fullAccess",\n    launchProcess: {\n      schemes: ["https"],\n    },\n    network: {\n      domains: ["all"],\n    },\n  },\n  featureFlags: { enableAlerts: true },\n};\n`;
  const narrowed = narrowRequiredPermissions(source);
  assert.equal(narrowed.ok, true);
  assert.match(narrowed.source, /requiredPermissions: \{\}/);
  assert.doesNotMatch(narrowed.source, /network:/);
  assert.match(narrowed.source, /featureFlags/);
  const previous = process.cwd();
  process.chdir(os.tmpdir());
  try {
    assert.equal(fs.existsSync(installerEntry()), true);
  } finally {
    process.chdir(previous);
  }
});

test("a failed refresh keeps old text and is not fresh", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "uxp-docs-"));
  fs.writeFileSync(path.join(dir, "manifest.txt"), "previous manifest text\n");
  const summary = await refreshPages(dir, [
    { id: "manifest", url: "https://example.test/manifest" },
    { id: "css-styles", url: "https://example.test/css" }
  ], {
    fetchImpl: async (url) => {
      if (String(url).includes("css")) return { ok: true, async text() { return "<p>fresh css</p>"; } };
      throw new Error("network down");
    }
  });
  assert.equal(summary.ok, false);
  assert.equal(summary.anySuccessIsEnough, false);
  assert.equal(summary.pages.find((page) => page.id === "manifest").freshness, "stale");
  assert.equal(fs.readFileSync(path.join(dir, "manifest.txt"), "utf8"), "previous manifest text\n");
  assert.equal(summary.pages.find((page) => page.id === "css-styles").freshness, "fresh");
});

test("stale check lists every newer file and ignores an equal mtime", () => {
  const listed = checkStale(
    [
      { rel: "src/a.js", mtimeMs: 70_000 },
      { rel: "src/b.js", mtimeMs: 70_061 }
    ],
    [{ rel: "plugin.ccx", mtimeMs: 10_000 }]
  );
  assert.deepEqual(listed[0].files, ["src/b.js"]);
  const tie = checkStale([{ rel: "src/a.js", mtimeMs: 10_000 }], [{ rel: "plugin.ccx", mtimeMs: 10_000 }]);
  assert.equal(tie.length, 0);
});

test("chrome cleanup reports a profile that is still there", () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "uxp-profile-"));
  let calls = 0;
  const result = removeProfile(profile, () => {
    calls += 1;
    const error = new Error("busy");
    error.code = "ENOTEMPTY";
    throw error;
  });
  assert.equal(result.status, "left-in-place");
  assert.equal(result.attempts, 2);
  assert.equal(calls, 2);
  fs.rmSync(profile, { recursive: true, force: true });
});

test("the loopback socket rejects a public host", async () => {
  assert.throws(() => connect("ws://example.com/devtools"), /loopback/);
});

test("a split known-issues quote is unsupported only when that page is fresh", () => {
  const page = {
    id: "known-issues",
    url: "https://developer.adobe.com/uxp/uxp-api/known-issues",
    freshness: "fresh",
    text: "text-transform\n is not supported,\n\nCSS transitions and animations are not supported.\n"
  };
  const unsupported = resolveCapability({ goal: "Animate the panel with a CSS transition", pages: [page] });
  assert.equal(unsupported.state, "unsupported-with-evidence");
  const stale = resolveCapability({ goal: "Animate the panel with a CSS transition", pages: [{ ...page, freshness: "stale" }] });
  assert.equal(stale.state, "unknown");
});

test("rename preview warns on a duplicate and does not invent a host ban", () => {
  const preview = previewRename(
    [{ id: 1, name: "A" }, { id: 2, name: "B" }],
    { prefix: "Shot ", sequence: true, start: 1, pad: 2, suffix: "" }
  );
  assert.equal(preview.ok, true);
  assert.equal(preview.rows[0].next, "Shot 01A");
  assert.equal(preview.policy, "collision-warning-not-host-rule");
  const collisions = findCollisions([
    { id: 1, name: "A", next: "Same" },
    { id: 2, name: "B", next: "Same" }
  ]);
  assert.equal(collisions.length, 1);
});
