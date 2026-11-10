import assert from "node:assert/strict";
import { test } from "node:test";
import { parseTweak } from "../.claude/skills/uxp-assistant/scripts/lib/flow.mjs";
import { deriveId, deriveName, detectFramework, detectHost, makePlan, namedPermissions } from "../.claude/skills/uxp-assistant/scripts/lib/intent.mjs";

const QR = "create a plugin that create high quality qr codes in premiere";

test("the QR request is fully read: app, name, id, stack, and no extra permission", () => {
  const plan = makePlan({ goal: QR, kind: "empty", input: "/tmp/work" });
  assert.equal(plan.host, "ppro");
  assert.equal(plan.name, "QR Codes");
  assert.equal(plan.id, "com.example.qrcodes");
  assert.equal(plan.framework, "react");
  assert.equal(plan.runtime, "", "native is asked, not assumed from silence");
  assert.equal(makePlan({ goal: QR, kind: "empty", input: "/tmp/uxp-empty-folder-that-is-not-there" }).inPlace, true);
  assert.deepEqual(plan.permissions, []);
  assert.equal(plan.goal, QR);
});

test("the Adobe app is read only when exactly one is named", () => {
  assert.equal(detectHost("rename layers in Photoshop"), "phxs");
  assert.equal(detectHost("a Premiere Pro panel"), "ppro");
  assert.equal(detectHost("export text frames from InDesign"), "idsn");
  assert.equal(detectHost("a panel for both photoshop and premiere"), "");
  assert.equal(detectHost("show the document title"), "");
});

test("names are short and readable, whatever the sentence", () => {
  const cases = new Map([
    ["Create a Photoshop panel that renames selected layers with a prefix and numbering", "Selected Layers"],
    ["I want a plugin to generate SRT subtitles from the active sequence in Premiere Pro", "SRT Subtitles"],
    ["Create a QR code generator for Premiere Pro", "QR Code Generator"],
    ["Show the document title", "Document Title"],
    ["make me a photoshop plugin that lists all the layers in my document and lets me add a prefix to the selected layer names", "Layers"],
    ["give me a premiere panel that lists markers and exports them to csv", "Markers"],
    ["i want a plugin for indesign that finds and replaces text across pages", "Text"],
    ["make me an indesign plugin", "UXP Plugin"],
    ["create a premiere panel in a webview that shows a shot list of the active sequence markers", "Shot List"],
    ["create a native premiere plugin that creates high quality qr codes, saves a png, and imports it into the project", "QR Codes"]
  ]);
  for (const [goal, name] of cases) assert.equal(deriveName(goal), name, goal);
  assert.equal(deriveName(""), "UXP Plugin");
  assert.equal(deriveId("Fast QR!"), "com.example.fastqr");
});

test("a permission is kept only when the request names it", () => {
  assert.deepEqual(namedPermissions("copy the layer name to the clipboard"), ["clipboard"]);
  assert.deepEqual(namedPermissions("upload the frame to https://example.com/api"), ["network"]);
  assert.deepEqual(namedPermissions("save a file to a folder on disk"), ["localFileSystem"]);
  assert.deepEqual(namedPermissions("make qr codes"), []);
});

test("the framework defaults to React, and runtime is set only when the sentence says so", () => {
  assert.equal(detectFramework("a vue panel"), "vue");
  assert.equal(detectFramework("a svelte panel"), "svelte");
  assert.equal(detectFramework("a panel"), "react");
  assert.equal(makePlan({ goal: "a panel in a webview in photoshop" }).runtime, "webview");
  assert.equal(makePlan({ goal: "a native premiere panel" }).runtime, "native");
  assert.equal(makePlan({ goal: "a premiere panel" }).runtime, "");
  assert.equal(makePlan({ goal: "a premiere panel with spectrum" }).widgets, "spectrum");
  assert.equal(makePlan({ goal: "a premiere panel with plain html" }).widgets, "html");
});

test("flags from the assistant win over the request", () => {
  const plan = makePlan({ goal: QR, flags: { host: "phxs", name: "Fast QR", id: "com.acme.fastqr", framework: "vue" } });
  assert.equal(plan.host, "phxs");
  assert.equal(plan.name, "Fast QR");
  assert.equal(plan.id, "com.acme.fastqr");
  assert.equal(plan.framework, "vue");
});

test("a change typed on the plan card is read into plan fields", () => {
  const plan = makePlan({ goal: QR });
  assert.deepEqual(parseTweak("use Photoshop", plan), { host: "phxs" });
  assert.equal(parseTweak("name it Fast QR", plan).name, "Fast QR");
  assert.equal(parseTweak("call it \"Pretty Codes\" and use Vue", plan).name, "Pretty Codes");
  assert.equal(parseTweak("call it \"Pretty Codes\" and use Vue", plan).framework, "vue");
  assert.equal(parseTweak("needs network", plan).permissions, "network");
  assert.equal(parseTweak("no extra permissions", plan).permissions, "none");
  assert.equal(parseTweak("id com.acme.qr", plan).id, "com.acme.qr");
  assert.equal(parseTweak("put it in /Users/me/plugins", plan).folder, "/Users/me/plugins");
  assert.deepEqual(parseTweak("whatever", plan), {});
});
