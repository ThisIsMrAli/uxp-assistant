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

Do not stop after the plan. Continue until the session outcome is commands-finished, or until it pauses on unknown or docs-incomplete, or it is unsupported-with-evidence, not-yet-implemented, or failed. Say which state it is. The Adobe host was NOT TESTED unless you actually launched it.

## Workflow

1. Run `node scripts/session.mjs next` and do what it says.
2. Collect the goal, host, framework, OS, context, name, id, and permissions. An existing project still needs a host so the class pages are fetched. Do not replace the goal text.
3. Refresh the official pages for that request. A failed page stays stale or failed. It is never fresh, and it does not open an implementation handoff.
4. Read the implementation contract. `awaiting-agent-implementation` means a fresh page documents a symbol from the goal and you write that feature. If the first pages miss a camelCase API, the skill searches the official class pages for that host before it pauses. `unknown` pauses so you can name the API or refresh the page. It is not a permanent refusal and it is not "do not write feature code". `unsupported-with-evidence` means a fresh page says it is not supported. None of those states is success.
5. Write the feature yourself in files that change after the handoff. Mention the documented symbol. Add a test that imports the feature. Do not record a stock file, and do not use a test script that only exits 0. Apply `selected-layer-rename` only when the contract names that fixture and the goal is still that rename.
6. Record `agent-result.json` with the same goal and the files you changed. The skill checks the diff against the handoff baseline, runs the real test, build, and ccx commands, and checks that the archive contains text from those files. A matching word such as error is not the feature. An archive digest is the file that was just written. Zip timestamps can change a later digest.
7. Finish only after those checks pass. The done line is: Commands finished. The Adobe host was NOT TESTED. That line is not semantic proof.

## Limits

`npm test`, `npm run build`, a CCX file, and the dashboard do not execute Photoshop or Premiere. Host unavailable is NOT TESTED. Follow `host-verification.md` by hand. Do not claim a host pass. Do not claim the implementation is semantically verified because a string from the source appears in the package.
