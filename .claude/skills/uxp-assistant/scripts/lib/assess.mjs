/**
 * Classify by what the code does, after comments are removed.
 * A token such as "JSX" or "layer" in a comment is not a verdict.
 * window.uxpHost is a WebView bridge shim. It is not the Photoshop DOM.
 */

const COMMENT = /\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm;

export function stripComments(text) {
  return String(text || "").replace(COMMENT, "");
}

function finding(partial) {
  return {
    class: partial.class,
    behavior: partial.behavior,
    file: partial.file,
    askBeforeDrop: Boolean(partial.askBeforeDrop),
    recipe: partial.recipe || null,
    detail: partial.detail
  };
}

export function assessSource(file, text) {
  const code = stripComments(text);
  const found = [];
  if (/\blayer\.name\s*=/.test(code) || /\.activeLayer\.name\s*=/.test(code)) {
    found.push(finding({
      class: "native-feasible",
      behavior: "assign-layer-name",
      file,
      recipe: "selected-layer-rename",
      detail: "Assigning Layer.name is the same behavior as the Photoshop DOM property. The JSX file is not executed. The native call still belongs inside executeAsModal."
    }));
  }
  if (/\.evalScript\s*\(/.test(code) || /\bevalExtendscript\s*\(/.test(code)) {
    found.push(finding({
      class: "external-bridge-required",
      behavior: "cep-eval-script",
      file,
      askBeforeDrop: true,
      detail: "evalScript is a CEP bridge call. UXP does not run that call. A static script string can still be classified on its own."
    }));
  }
  if (/uxpHost\s*\.\s*postMessage/.test(code) || /window\.uxpHost/.test(code)) {
    found.push(finding({
      class: "shim",
      behavior: "webview-uxp-host",
      file,
      detail: "window.uxpHost.postMessage is a WebView bridge. A missing uxpHost rejects the call. It does not execute JSX and it is not the host DOM."
    }));
  }
  if (/require\(\s*['"][^'"]+\.node['"]\s*\)/.test(code)) {
    found.push(finding({
      class: "external-bridge-required",
      behavior: "native-addon",
      file,
      askBeforeDrop: true,
      detail: "A .node addon is a separate native binary. It is not rewritten into the layer-name recipe and it is not dropped without a decision."
    }));
  }
  if (/\bapp\.system\s*\(/.test(code)) {
    found.push(finding({
      class: "external-bridge-required",
      behavior: "host-system-call",
      file,
      askBeforeDrop: true,
      detail: "app.system is a host process call. It is a different behavior from assigning Layer.name."
    }));
  }
  if (/\.addEventListener\s*\(/.test(code) && /CSInterface|csInterface|__adobe_cep__/.test(code)) {
    found.push(finding({
      class: "external-bridge-required",
      behavior: "cep-listener",
      file,
      askBeforeDrop: true,
      detail: "A CEP event listener is not the layer rename. It stays until you choose to remove it."
    }));
  }
  if (/<webview\b/i.test(code) || /HTMLWebViewElement/.test(code)) {
    found.push(finding({
      class: "webview",
      behavior: "webview-element",
      file,
      detail: "A WebView element is not a native UXP document and not a Photoshop DOM call."
    }));
  }
  return found;
}

export function assessTree(files) {
  const behaviors = [];
  for (const file of files) behaviors.push(...assessSource(file.path, file.text));
  return behaviors;
}

export function assessGoal({ goal = "", host, framework }) {
  const text = String(goal);
  const layerRename = /rename/i.test(text) && /layer/i.test(text);
  if (layerRename && (host === "phxs" || host === "PS")) {
    return {
      class: "native-feasible",
      behavior: "assign-layer-name",
      recipe: "selected-layer-rename",
      framework: framework || null,
      detail: "The goal asks to rename selected layers. Layer.name is a documented read/write property. Preview reads stay outside the modal. The write goes through executeAsModal and history suspension. This recipe is the acceptance fixture, not the only thing the skill can plan."
    };
  }
  if (/importFiles|import files/i.test(text)) {
    return {
      class: "unknown",
      behavior: "premiere-import-files",
      recipe: null,
      detail: "importFiles is a different call from a Photoshop layer rename. Absence of that method from the ten shared CSS and manifest pages does not make it unsupported. Fetch the Premiere reference before a verdict, and do not invent the call."
    };
  }
  if (!text.trim()) {
    return { class: "unknown", behavior: "empty-goal", recipe: null, detail: "The goal is empty." };
  }
  return {
    class: "unknown",
    behavior: "unmapped-goal",
    recipe: null,
    detail: "No recipe matches this goal. The skill will not invent a host API for it. Say what the official page shows, or leave it unknown."
  };
}

export function summarize(behaviors, goal) {
  const classes = [...new Set([goal?.class, ...behaviors.map((item) => item.class)].filter(Boolean))];
  return {
    classes,
    askBeforeDrop: behaviors.filter((item) => item.askBeforeDrop),
    recipe: goal?.recipe || behaviors.find((item) => item.recipe)?.recipe || null,
    consequential: Boolean(goal?.recipe || behaviors.some((item) => item.recipe))
  };
}
