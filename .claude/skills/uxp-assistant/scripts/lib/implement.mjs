import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const previewSource = fs.readFileSync(path.join(here, "rename-preview.mjs"), "utf8");

const HOST_TS = `import { photoshop } from "../globals";
import { previewRename, selectionDrift } from "./preview.mjs";

export type LayerSnap = { id: number; name: string };
export type ReadOk = { ok: true; documentId: number; layers: LayerSnap[] };
export type ReadErr = { ok: false; code: "no-host" | "no-document" | "no-selection" | "read-failed"; message: string };

function hostApp() {
  const app = (photoshop as { app?: { activeDocument?: { id: number; activeLayers?: LayerSnap[] } } }).app;
  if (!app) return null;
  return app;
}

/** Read the selection outside executeAsModal. A missing host is not a successful preview. */
export function readSelection(): ReadOk | ReadErr {
  const app = hostApp();
  if (!app) {
    return { ok: false, code: "no-host", message: "Photoshop is not available in this runtime. Nothing was read from a document." };
  }
  let doc: { id: number; activeLayers?: LayerSnap[] } | null = null;
  try {
    doc = app.activeDocument ?? null;
  } catch (error) {
    return { ok: false, code: "no-document", message: error instanceof Error ? error.message : "No open document." };
  }
  if (!doc) return { ok: false, code: "no-document", message: "No open document." };
  const layers = Array.isArray(doc.activeLayers) ? doc.activeLayers : [];
  if (!layers.length) return { ok: false, code: "no-selection", message: "No selected layer." };
  return {
    ok: true,
    documentId: doc.id,
    layers: layers.map((layer) => ({ id: layer.id, name: String(layer.name) }))
  };
}

export async function applyPreview(preview: { documentId: number; layers: LayerSnap[]; rows: { id: number; name: string; next: string }[] }) {
  const core = (photoshop as { core?: { executeAsModal?: Function } }).core;
  const app = hostApp();
  if (!app || typeof core?.executeAsModal !== "function") {
    return { ok: false, code: "no-host", message: "executeAsModal is not available. The rename was not applied." };
  }
  try {
    return await core.executeAsModal(async (executionContext: { hostControl: { suspendHistory: Function; resumeHistory: Function }; isCancelled?: boolean }) => {
      let doc: { id: number; activeLayers?: { id: number; name: string }[] } | null = null;
      try {
        doc = app.activeDocument ?? null;
      } catch (error) {
        return { ok: false, code: "no-document", message: error instanceof Error ? error.message : "No open document." };
      }
      if (!doc) return { ok: false, code: "no-document", message: "No open document." };
      const current = {
        documentId: doc.id,
        layers: (doc.activeLayers || []).map((layer) => ({ id: layer.id, name: String(layer.name) }))
      };
      const drift = selectionDrift({ documentId: preview.documentId, layers: preview.layers }, current);
      if (drift.changed) {
        return { ok: false, code: "selection-changed", message: "The document or selection changed after the preview. Apply was not run." };
      }
      let suspension: unknown = null;
      let commit = false;
      try {
        suspension = await executionContext.hostControl.suspendHistory({
          documentID: doc.id,
          name: "Rename selected layers"
        });
        if (executionContext.isCancelled) {
          return { ok: false, code: "cancelled", message: "Photoshop cancelled the rename." };
        }
        const byId = new Map((doc.activeLayers || []).map((layer) => [layer.id, layer]));
        for (const row of preview.rows) {
          const layer = byId.get(row.id);
          if (!layer) {
            return { ok: false, code: "selection-changed", message: "A previewed layer is no longer in the selection." };
          }
          layer.name = row.next;
        }
        commit = true;
        return { ok: true, code: "applied", message: "Renamed the previewed layer ids inside one history state." };
      } catch (error) {
        commit = false;
        const message = error instanceof Error ? error.message : String(error);
        const cancelled = /cancel/i.test(message);
        return { ok: false, code: cancelled ? "cancelled" : "failed", message };
      } finally {
        if (suspension) {
          try {
            await executionContext.hostControl.resumeHistory(suspension, commit);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (commit) return { ok: false, code: "resume-failed", message };
          }
        }
      }
    }, { commandName: "Rename selected layers" });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, code: /cancel/i.test(message) ? "cancelled" : "failed", message };
  }
}

export { previewRename };
`;

const PANEL_TSX = `import React, { useMemo, useState } from "react";
import { applyPreview, previewRename, readSelection } from "./host";
import "./panel.css";

type Row = { id: number; name: string; next: string };

export function LayerRenamePanel() {
  const [prefix, setPrefix] = useState("");
  const [suffix, setSuffix] = useState("");
  const [sequence, setSequence] = useState(true);
  const [start, setStart] = useState("1");
  const [pad, setPad] = useState("3");
  const [snapshot, setSnapshot] = useState<{ documentId: number; layers: { id: number; name: string }[] } | null>(null);
  const [status, setStatus] = useState("Read the selection to preview. This panel has not renamed anything.");
  const [tone, setTone] = useState("idle");
  const [busy, setBusy] = useState("");

  const preview = useMemo(() => {
    if (!snapshot) return null;
    return previewRename(snapshot.layers, { prefix, suffix, sequence, start, pad });
  }, [snapshot, prefix, suffix, sequence, start, pad]);

  const collisions = preview?.ok ? preview.collisions : [];
  const applyDisabled = Boolean(busy) || !preview?.ok;

  async function onRead() {
    setBusy("read");
    setTone("loading");
    setStatus("Reading the selected layers outside the modal.");
    const read = readSelection();
    setBusy("");
    if (!read.ok) {
      setSnapshot(null);
      setTone("error");
      setStatus(read.message);
      return;
    }
    setSnapshot({ documentId: read.documentId, layers: read.layers });
    setTone("ready");
    setStatus(\`Previewing \${read.layers.length} selected layer id\${read.layers.length === 1 ? "" : "s"} in document \${read.documentId}.\`);
  }

  async function onApply() {
    if (!snapshot || !preview?.ok) return;
    setBusy("apply");
    setTone("loading");
    setStatus("Applying inside executeAsModal.");
    const result = await applyPreview({ documentId: snapshot.documentId, layers: snapshot.layers, rows: preview.rows });
    setBusy("");
    if (!result.ok) {
      setTone("error");
      setStatus(result.message);
      return;
    }
    setTone("ready");
    setStatus(result.message);
    await onRead();
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Escape") {
      setStatus("Cleared the status. The preview is unchanged.");
      setTone(snapshot ? "ready" : "idle");
    }
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && !applyDisabled) {
      event.preventDefault();
      void onApply();
    }
  }

  return (
    <main className="rename" onKeyDown={onKeyDown}>
      <h1>Rename selected layers</h1>
      <p className="lede">Preview uses the current names. Apply renames only those layer ids, and only if the document and selection are still the same.</p>
      <div className="fields">
        <div className="field">
          <span id="prefix-label">Prefix</span>
          <input aria-labelledby="prefix-label" value={prefix} onChange={(event) => setPrefix(event.target.value)} />
        </div>
        <div className="field">
          <span id="suffix-label">Suffix</span>
          <input aria-labelledby="suffix-label" value={suffix} onChange={(event) => setSuffix(event.target.value)} />
        </div>
        <div className="field check">
          <input id="sequence" type="checkbox" checked={sequence} onChange={(event) => setSequence(event.target.checked)} />
          <span>Sequence</span>
        </div>
        <div className="field">
          <span id="start-label">Start</span>
          <input aria-labelledby="start-label" inputMode="numeric" value={start} disabled={!sequence} onChange={(event) => setStart(event.target.value)} />
        </div>
        <div className="field">
          <span id="pad-label">Padding</span>
          <input aria-labelledby="pad-label" inputMode="numeric" value={pad} disabled={!sequence} onChange={(event) => setPad(event.target.value)} />
        </div>
      </div>
      <div className="actions">
        <button type="button" onClick={() => void onRead()} disabled={Boolean(busy)}>{busy === "read" ? "Reading…" : "Read selection"}</button>
        <button type="button" onClick={() => void onApply()} disabled={applyDisabled}>{busy === "apply" ? "Applying…" : "Apply preview"}</button>
      </div>
      <p className={\`status \${tone}\`} role="status">{status}</p>
      {preview && !preview.ok ? <p className="status error">{preview.message}</p> : null}
      {collisions.length ? (
        <p className="status warn">Duplicate preview names are a warning. The retrieved Layer page does not say Photoshop rejects them, so Apply is not blocked for that reason.</p>
      ) : null}
      <ul className="rows">
        {(preview?.rows || []).map((row: Row) => (
          <li key={row.id}>
            <span className="id">#{row.id}</span>
            <span>{row.name}</span>
            <span className="arrow">→</span>
            <span>{row.next}</span>
          </li>
        ))}
      </ul>
      <p className="keys">Escape clears the status. Control or Command and Enter applies the preview.</p>
    </main>
  );
}
`;

const PANEL_CSS = `.rename { display: flex; flex-direction: column; padding: 12px; }
.rename h1 { margin: 0 0 8px; font-size: 16px; }
.rename .lede, .rename .keys { margin: 0 0 8px; }
.rename .field { margin: 0 8px 8px 0; }
.rename .fields { display: flex; flex-wrap: wrap; }
.rename input { display: block; min-width: 88px; margin-top: 4px; }
.rename .actions button { margin: 0 8px 8px 0; }
.rename .status { margin: 0 0 8px; }
.rename .status.error, .rename .status.warn { color: inherit; }
.rename .rows { list-style: none; margin: 0; padding: 0; }
.rename .rows li { display: flex; margin: 0 0 4px; }
.rename .rows span { margin-right: 8px; }
`;

const MAIN_TSX = `import React from "react";
import { LayerRenamePanel } from "./layer-rename/Panel";

export const App = () => {
  return <LayerRenamePanel />;
};
`;

export function implementLayerRename(projectDir, { narrowPermissions = false } = {}) {
  const root = path.resolve(projectDir);
  const dest = path.join(root, "src", "layer-rename");
  fs.mkdirSync(dest, { recursive: true });
  fs.writeFileSync(path.join(dest, "preview.mjs"), previewSource);
  fs.writeFileSync(path.join(dest, "host.ts"), HOST_TS);
  fs.writeFileSync(path.join(dest, "Panel.tsx"), PANEL_TSX);
  fs.writeFileSync(path.join(dest, "panel.css"), PANEL_CSS);
  const main = path.join(root, "src", "main.tsx");
  if (fs.existsSync(main)) fs.writeFileSync(main, MAIN_TSX);
  else fs.writeFileSync(path.join(root, "src", "App.tsx"), `${PANEL_TSX}\nexport default function App(){ return <LayerRenamePanel />; }\n`);
  let permissions = "unchanged";
  const config = path.join(root, "uxp.config.ts");
  if (narrowPermissions && fs.existsSync(config)) {
    const source = fs.readFileSync(config, "utf8");
    const next = source.replace(/requiredPermissions:\s*\{[\s\S]*?\n\s*\},/m, "requiredPermissions: {},");
    if (next === source) permissions = "pattern-not-found";
    else {
      fs.writeFileSync(config, next);
      permissions = "narrowed-empty";
    }
  }
  return {
    recipe: "selected-layer-rename",
    files: ["src/layer-rename/preview.mjs", "src/layer-rename/host.ts", "src/layer-rename/Panel.tsx", "src/layer-rename/panel.css"],
    permissions
  };
}

const DROP_MAP = {
  "bridge/listen.js": "cep-listener",
  "native/filter-loader.js": "native-addon",
  "system/call.js": "host-system-call"
};

export function implementIntoExisting(projectDir, drops = []) {
  const root = path.resolve(projectDir);
  const dest = path.join(root, "src", "layer-rename");
  fs.mkdirSync(dest, { recursive: true });
  fs.writeFileSync(path.join(dest, "preview.mjs"), previewSource);
  fs.writeFileSync(path.join(dest, "host.ts"), HOST_TS);
  fs.writeFileSync(path.join(dest, "Panel.tsx"), PANEL_TSX);
  fs.writeFileSync(path.join(dest, "panel.css"), PANEL_CSS);
  const app = path.join(root, "src", "App.tsx");
  if (fs.existsSync(app)) {
    const source = fs.readFileSync(app, "utf8");
    if (!source.includes("LayerRenamePanel")) {
      const imported = `import { LayerRenamePanel } from "./layer-rename/Panel";\n${source}`;
      const next = imported.includes("{/* uxp-assistant-panel */}")
        ? imported.replace("{/* uxp-assistant-panel */}", "<LayerRenamePanel />")
        : imported;
      fs.writeFileSync(app, next);
    }
  }
  const kept = [];
  const dropped = [];
  const dropSet = new Set(drops);
  for (const relative of ["jsx/rename.jsx", "bridge/listen.js", "native/filter-loader.js", "system/call.js", "shim/webview.js"]) {
    const full = path.join(root, relative);
    if (!fs.existsSync(full)) continue;
    const behavior = DROP_MAP[relative];
    if (behavior && dropSet.has(behavior)) {
      fs.rmSync(full, { force: true });
      dropped.push(relative);
    } else kept.push(relative);
  }
  return { recipe: "selected-layer-rename", files: ["src/layer-rename/Panel.tsx"], kept, dropped };
}
