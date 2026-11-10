import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { removeProfile } from "../.claude/skills/uxp-assistant/scripts/lib/chrome.mjs";
import { effectiveHostFloor, floorsFromText, WEBVIEW_FLOOR_NOT_USED } from "../.claude/skills/uxp-assistant/scripts/lib/floors.mjs";
import { LEAST_LOCAL_WEBVIEW, namedPermissions, narrowRequiredPermissions, permissionCapabilities, permissionChoice, resolveRequestedPermissions, starterPermissionsAreBroad } from "../.claude/skills/uxp-assistant/scripts/lib/permissions.mjs";
import { mountLocalWebviews, stripThemeBridge } from "../.claude/skills/uxp-assistant/scripts/lib/webview-shell.mjs";
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
  const absent = narrowRequiredPermissions(source, { requested: ["clipboard"] });
  assert.equal(absent.ok, true);
  assert.match(absent.source, /requiredPermissions: \{\}/);
  const starter = `export const manifest = {\n  requiredPermissions: {\n    localFileSystem: "fullAccess",\n    launchProcess: { schemes: ["https", "file"], extensions: [".psd"] },\n    network: { domains: [\`ws://localhost:8080\`] },\n    clipboard: "readAndWrite",\n    webview: { allow: "yes", domains: "all", enableMessageBridge: "localAndRemote" },\n    ipc: { enablePluginCommunication: true },\n    allowCodeGenerationFromStrings: true,\n  },\n  featureFlags: { enableAlerts: true },\n};\n`;
  const web = narrowRequiredPermissions(starter, { runtime: "webview", requested: ["clipboard"] });
  assert.equal(web.ok, true);
  assert.match(web.source, /allow: "yes"/);
  assert.match(web.source, /domains: \[\]/);
  assert.match(web.source, /allowLocalRendering: "yes"/);
  assert.match(web.source, /enableMessageBridge: "no"/);
  assert.match(web.source, /clipboard: "readAndWrite"/);
  assert.doesNotMatch(web.source, /localFileSystem|launchProcess|localAndRemote|domains: "all"|allowCodeGenerationFromStrings|enablePluginCommunication/);
  const plain = narrowRequiredPermissions(starter, { runtime: "webview" });
  assert.equal(starterPermissionsAreBroad(plain.source), false);
  assert.doesNotMatch(plain.source, /clipboard/);
  const nativeKept = narrowRequiredPermissions(starter, { requested: ["clipboard"] });
  assert.match(nativeKept.source, /clipboard: "readAndWrite"/);
  assert.doesNotMatch(nativeKept.source, /localFileSystem|launchProcess|webview:/);
  const unknown = narrowRequiredPermissions(starter, { requested: ["not-a-permission", "localOnly"] });
  assert.doesNotMatch(unknown.source, /not-a-permission|localOnly/);
  assert.match(unknown.source, /requiredPermissions: \{\}/);
  const networkOnly = `export const manifest = { requiredPermissions: { network: { domains: ["https://example.com"] } } };\n`;
  assert.deepEqual(permissionCapabilities(networkOnly), ["network"]);
  assert.equal(starterPermissionsAreBroad(networkOnly), true);
  const localOnly = `webview: { allow: "yes", domains: [], allowLocalRendering: "yes", enableMessageBridge: "localOnly" }`;
  assert.ok(permissionCapabilities(localOnly).includes("enableMessageBridge:localOnly"));
  assert.equal(permissionChoice("keep"), "keep");
  assert.equal(permissionChoice("narrow"), "narrow");
  assert.equal(permissionChoice("yes"), "");
  assert.equal(permissionChoice("KEEP"), "");
  assert.deepEqual(namedPermissions("Show the document name and the selected layer name"), []);
  assert.deepEqual(namedPermissions("Import files into the active Premiere project with importFiles."), []);
  assert.deepEqual(namedPermissions("Copy the layer name to the clipboard and upload to https://example.com"), ["network", "clipboard"]);
  assert.deepEqual(namedPermissions("Read a local file and save a folder on disk"), ["localFileSystem"]);
  assert.deepEqual(resolveRequestedPermissions("auto", "Fetch the selection from the network"), ["network"]);
  assert.deepEqual(resolveRequestedPermissions("none", "Read a local file"), []);
  assert.deepEqual(resolveRequestedPermissions("auto", "Show the document title"), []);
  assert.deepEqual(resolveRequestedPermissions(["clipboard", "not-a-permission"], "Show the document title"), ["clipboard"]);
  const calls = [];
  const element = () => {
    const node = { className: "", id: "", src: "", uxpAllowInspector: "", appendChild(child) { calls.push(["append", child.id]); return child; } };
    return node;
  };
  const document = {
    createElement(tag) { calls.push(["create", tag]); return element(); },
    getElementById() { return element(); },
    getElementsByTagName() { return []; }
  };
  const mounted = mountLocalWebviews(document, { pages: ["main"], pluginId: "com.example.webview", mode: "package" });
  assert.deepEqual(calls.filter((item) => item[0] === "create"), [["create", "webview"]]);
  assert.equal(mounted.created.length, 1);
  assert.equal(mounted.created[0].src, "plugin:/webview-ui/main.html");
  assert.equal(JSON.stringify(mounted).includes("postMessage"), false);
  const stripped = stripThemeBridge("export const polyfillUXPVars = () => {\n  document.theme.onUpdated.addListener(() => {});\n};\n");
  assert.doesNotMatch(stripped, /theme\.onUpdated/);
  assert.match(stripped, /return;/);
  assert.deepEqual(LEAST_LOCAL_WEBVIEW.enableMessageBridge, "no");
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
