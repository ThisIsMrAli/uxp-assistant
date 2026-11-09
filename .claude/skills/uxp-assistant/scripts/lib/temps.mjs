import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** Chrome's private files and Bolt's fixed staging directory. Node's compile cache stays. */
const OWNED = /^(?:\.?com\.google\.Chrome.*|ccx)$/;

const inflight = new Map();

export function snapshotTemps(dir = os.tmpdir()) {
  try {
    return new Set(fs.readdirSync(dir));
  } catch {
    return new Set();
  }
}

/** Overlapping commands share the earliest snapshot and sweep once, after the last one. */
export function holdTemps(dir = os.tmpdir()) {
  const key = path.resolve(dir);
  const current = inflight.get(key);
  if (current) {
    current.count += 1;
    return current.before;
  }
  const before = snapshotTemps(dir);
  inflight.set(key, { count: 1, before });
  return before;
}

export function releaseTemps(dir = os.tmpdir()) {
  const key = path.resolve(dir);
  const current = inflight.get(key);
  if (!current) return [];
  current.count -= 1;
  if (current.count > 0) return [];
  inflight.delete(key);
  return sweepOwnedTemps(current.before, dir);
}

export function sweepOwnedTemps(before, dir = os.tmpdir()) {
  let names = [];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const removed = [];
  for (const name of names) {
    if (name === "node-compile-cache") continue;
    if (before?.has(name)) continue;
    if (!OWNED.test(name)) continue;
    fs.rmSync(path.join(dir, name), { recursive: true, force: true });
    removed.push(name);
  }
  return removed;
}
