import fs from "node:fs";
import { snapshotTemps, sweepOwnedTemps } from "../.claude/skills/uxp-assistant/scripts/lib/temps.mjs";

const tempsBefore = snapshotTemps();

const original = fs.mkdtempSync;
const created = new Set();
fs.mkdtempSync = function patchedTemp(prefix, options) {
  const dir = original.call(fs, prefix, options);
  created.add(dir);
  return dir;
};

process.on("exit", () => {
  sweepOwnedTemps(tempsBefore);
  for (const dir of created) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // The test already removed it.
    }
  }
});
