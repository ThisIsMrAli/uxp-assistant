import assert from "node:assert/strict";
import { test } from "node:test";
import { designQuery, designSection, interactionQuery } from "../.claude/skills/uxp-assistant/scripts/lib/design.mjs";
import { spectrumGuide } from "../.claude/skills/uxp-assistant/scripts/lib/planning.mjs";

const NATIVE = {
  goal: "create a premiere plugin that lists markers and exports them",
  runtime: "native",
  widgets: "spectrum"
};

const WEB = {
  goal: "create a premiere plugin in a webview that shows a shot list",
  runtime: "webview",
  widgets: "spectrum"
};

test("the search query is the product, not one sample feature", () => {
  assert.match(designQuery(NATIVE.goal), /Markers/);
  assert.equal(interactionQuery(NATIVE.goal), "list selection empty state");
  assert.equal(interactionQuery("a panel that previews an image"), "visible label reserve space");
  assert.equal(interactionQuery("a panel that renames the selection"), "visible label inline error");
});

test("a native panel keeps the interaction rules and throws away the palette", () => {
  const canned = (file, args) => {
    assert.equal(file, "search.py");
    if (args.includes("--design-system")) {
      return "### Pattern\n- **Name:** Dense Tool\n### Style\n- **Name:** Minimal\n| Primary | `#EC4899` |\n";
    }
    return "### Result 1\n- **Issue:** Input Labels\n- **Do:** Show the label above the field\n- **Don't:** Use a placeholder as the only label\n";
  };
  const text = designSection(NATIVE, { script: "search.py", run: canned }).join("\n");
  assert.match(text, /Dense Tool/);
  assert.match(text, /Show the label above the field/);
  assert.match(text, /Spectrum widgets section/);
  assert.match(text, /position: relative/);
  assert.equal(text.includes("EC4899"), false);
  assert.match(text, /Do not copy the search colors/);
});

test("a WebView page may use normal CSS, and the host shell stays UXP", () => {
  const text = designSection(WEB, {
    script: "search.py",
    run: () => ""
  }).join("\n");
  assert.match(text, /inside the WebView/);
  assert.match(text, /grid and gap/);
  assert.match(text, /host shell/);
  assert.match(text, /host color/);
});

test("a Spectrum panel is told the host widgets, and plain HTML is not", () => {
  const native = spectrumGuide({ widgets: "spectrum", runtime: "native" }).join("\n");
  assert.match(native, /sp-slider/);
  assert.match(native, /sp-banner/);
  assert.match(native, /sp-card/);
  assert.match(native, /sp-table/);
  assert.match(native, /sp-toast/);
  assert.match(native, /0\.37\.0/);
  assert.match(native, /does not open an SWC page/);
  assert.match(native, /not the whole of either catalog/);
  const page = spectrumGuide({ widgets: "spectrum", runtime: "webview" }).join("\n");
  assert.match(page, /does not get these tags/);
  assert.deepEqual(spectrumGuide({ widgets: "html", runtime: "native" }), []);
});

test("a missing design skill still requires the panel rules", () => {
  const text = designSection(NATIVE, { script: "" }).join("\n");
  assert.match(text, /not installed/);
  assert.match(text, /Spectrum widgets section/);
  assert.equal(text.includes("search.py"), false);
});
