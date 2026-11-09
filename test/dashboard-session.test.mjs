import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { answerFromChat, finish, readMerged } from "../.claude/skills/uxp-assistant/scripts/lib/session.mjs";
import { recordImplementation, runWorkflow } from "../.claude/skills/uxp-assistant/scripts/lib/workflow.mjs";
import { SHOW, answers, fetchImpl, scaffoldImpl, writeShow } from "./fixtures/dashboard-session.mjs";

// NQ10: the non-browser half of dashboard-render.test.mjs. It runs on every machine, so a fixture
// the stricter rules reject fails here even where no Chrome is installed.
test("NQ10 the dashboard-render fixture reaches commands-finished without a browser", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "uxp-dashboard-session-"));
  try {
    const unknown = await runWorkflow({ out: path.join(root, "unknown"), kind: "empty", answers: answers("Export a hologram with app.fluxCapacitor()."), fetchImpl, scaffoldImpl });
    assert.equal(unknown.state, "unknown", unknown.say);
    const doneOut = path.join(root, "done");
    const ready = await runWorkflow({ out: doneOut, kind: "empty", answers: answers(SHOW), fetchImpl, scaffoldImpl });
    assert.equal(ready.state, "awaiting-agent-implementation", ready.say);
    writeShow(ready.project);
    const recorded = recordImplementation(doneOut, { goal: SHOW, files: ["src/Selection.tsx", "src/selection-read.mjs"] });
    assert.equal(recorded.state, "commands-finished", recorded.say);
    finish(doneOut, "Commands finished. The Adobe host was NOT TESTED.");
    assert.equal(readMerged(doneOut).outcome, "commands-finished");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("NQ10 the staged dashboard walk reaches the implementation handoff without a browser", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "uxp-walk-session-"));
  try {
    const out = path.join(root, "session");
    const base = { ...answers(SHOW) };
    for (const id of ["feasibility", "context-evidence", "runtime", "design", "validation"]) delete base[id];
    const options = { feasibility: "continue", "context-evidence": "keep-unverified", runtime: "native", design: "uxp-constraints", validation: "commands" };
    for (const [id, option] of Object.entries(options)) {
      const result = await runWorkflow({ out, kind: "empty", answers: base, fetchImpl, scaffoldImpl });
      assert.equal(result.blocked, id, result.say);
      answerFromChat(out, id, option);
    }
    const ready = await runWorkflow({ out, kind: "empty", answers: base, fetchImpl, scaffoldImpl });
    assert.equal(ready.state, "awaiting-agent-implementation", ready.say);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
