/**
 * Pure preview for the selected-layer rename acceptance fixture.
 * No Photoshop process is involved. Duplicate names are warnings.
 * The retrieved Layer page documents `name` as a string and does not say
 * the host rejects duplicates. This module does not invent that rule.
 */

export function padNumber(value, width) {
  const text = String(value);
  const size = Number(width) || 0;
  if (size <= text.length) return text;
  return text.padStart(size, "0");
}

export function previewRename(layers, options = {}) {
  const list = Array.isArray(layers) ? layers : [];
  const prefix = String(options.prefix ?? "");
  const suffix = String(options.suffix ?? "");
  const sequence = Boolean(options.sequence);
  const start = options.start === undefined || options.start === "" ? 1 : Number(options.start);
  const pad = options.pad === undefined || options.pad === "" ? 0 : Number(options.pad);
  if (!list.length) {
    return { ok: false, code: "no-selection", message: "No selected layer.", rows: [], collisions: [] };
  }
  if (!prefix && !suffix && !sequence) {
    return { ok: false, code: "empty", message: "Add a prefix, a suffix, or a sequence.", rows: [], collisions: [] };
  }
  if (sequence && (!Number.isInteger(start) || start < 0)) {
    return { ok: false, code: "bad-sequence", message: "Sequence start must be a whole number from 0 up.", rows: [], collisions: [] };
  }
  if (sequence && (!Number.isInteger(pad) || pad < 0 || pad > 12)) {
    return { ok: false, code: "bad-padding", message: "Padding must be a whole number from 0 to 12.", rows: [], collisions: [] };
  }
  const rows = list.map((layer, index) => {
    const serial = sequence ? padNumber(start + index, pad) : "";
    const next = `${prefix}${serial}${layer.name}${suffix}`;
    return { id: layer.id, name: layer.name, next };
  });
  const collisions = findCollisions(rows, options.otherNames || []);
  return {
    ok: true,
    code: "ready",
    message: collisions.length
      ? "Some preview names collide. Photoshop is not treated as forbidding duplicate layer names, so Apply stays available."
      : "Preview matches the current selection.",
    rows,
    collisions,
    order: "{prefix}{sequence}{current name}{suffix}",
    policy: "collision-warning-not-host-rule"
  };
}

export function findCollisions(rows, otherNames = []) {
  const collisions = [];
  const seen = new Map();
  for (const row of rows) {
    if (seen.has(row.next)) collisions.push({ name: row.next, ids: [seen.get(row.next), row.id], with: "preview" });
    else seen.set(row.next, row.id);
  }
  const others = new Set(otherNames.map((name) => String(name)));
  for (const row of rows) {
    if (others.has(row.next)) collisions.push({ name: row.next, ids: [row.id], with: "existing-layer" });
  }
  return collisions;
}

/** Apply may rename only the ids that were in the preview, and only if that set is still the selection. */
export function selectionDrift(preview, current) {
  if (!preview || !current) return { changed: true, reason: "missing-snapshot" };
  if (preview.documentId !== current.documentId) return { changed: true, reason: "document" };
  const left = [...(preview.layers || preview.rows || [])].map((layer) => `${layer.id}:${layer.name}`).sort();
  const right = [...(current.layers || [])].map((layer) => `${layer.id}:${layer.name}`).sort();
  if (left.join("|") !== right.join("|")) return { changed: true, reason: "selection" };
  return { changed: false, reason: "" };
}
