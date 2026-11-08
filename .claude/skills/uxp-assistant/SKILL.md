---
name: uxp-assistant
description: >-
  Plan and hand off a UXP feature for an empty folder or an existing project.
  Fetch official Adobe docs, resolve what those pages support, and leave an
  implementation contract for the invoking assistant. Record real test, build,
  and package exits. A browser preview is not a host pass.
license: MIT
---

The invoking assistant implements the requested goal. This skill does not embed a model route, and a missing recipe is not a finished feature.

Do not stop after the plan. Continue until the session outcome is commands-finished or an explicit unknown, unsupported-with-evidence, not-yet-implemented, or failed state. Then say which state it is, and that the Adobe host was NOT TESTED.

## Workflow

1. Run `node scripts/session.mjs next` and do what it says.
2. Collect the goal, host, framework, OS, context, name, id, and permissions. Do not replace the goal text.
3. Refresh the official pages for that request. A failed page stays stale or failed. It is never fresh.
4. Read the implementation contract. `awaiting-agent-implementation` means you write the feature in the project. `unknown` means the pages do not establish it. `unsupported-with-evidence` means a fresh page says it is not supported. None of those states is success.
5. Write the feature yourself in the project. Apply `selected-layer-rename` only when the contract names that fixture and the goal is still that rename.
6. Record `agent-result.json` with the same goal and the files you wrote. The skill runs the project's `test`, `build`, and `ccx` scripts and keeps their exit codes.
7. Finish only after those commands succeed. The done line is: Commands finished. The Adobe host was NOT TESTED.

## Limits

`npm test`, `npm run build`, a CCX file, and the dashboard do not execute Photoshop or Premiere. Host unavailable is NOT TESTED. Follow `host-verification.md` by hand. Do not claim a host pass.
