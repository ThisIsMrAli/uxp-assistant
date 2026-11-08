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
4. Answer the staged questions before editing. Feasibility comes first, and `continue` is offered only when a fresh page names a symbol from the goal. Then confirm the context, choose native UXP, WebView, or a hybrid bridge only when that choice was offered from fresh pages or an assessed bridge, choose a design source that is actually on disk, and choose command validation. `design-constraints.md` quotes the limits those pages contained. UI UX Pro Max is an example name to look for, not an installed or latest skill. A page beside the session lists copied source text and mocks. That is a source-text preview, not a UXP UI preview and not visual fidelity. A built-bundle page, when one is produced, loads the package script behind a labelled shim. Neither is Photoshop or Premiere.
5. Write the feature yourself in files that change after the handoff. Use the documented API in code, not only in a comment or a static sentence. Follow `design-constraints.md` and the chosen runtime. Add a test that imports that module and asserts on the call. Do not record a stock file, and do not use a test script that only exits 0. Leave the handoff `build` and `ccx` commands, and the local scripts they reach, unchanged. A changed command or a changed script body is not run until the `script-change` question is answered for those exact commands and file hashes. Shell wrappers, unresolved loaders, a second npm hop, dynamic imports, process or eval in a hashed file, and a graph past 40 files are refused instead of approved from a partial hash. Static local code imports from those scripts and from vite.config.ts and uxp.config.ts are hashed. JSON imports, including package.json, and package modules are outside that set. This is a restricted grammar, not a shell sandbox and not a complete executable closure. `approveScripts` on the result record is not that answer. A later edit invalidates the answer. Apply `selected-layer-rename` only when the contract names that fixture and the goal is still that rename.
6. Record `agent-result.json` with the same goal and the files you changed. The skill checks the diff against the handoff baseline, runs the handoff test, build, and ccx commands, and checks every new archive for the documented symbol the starter did not already contain. A matching word such as error, or a starter token such as useState, is not the feature. An archive digest is the file that was just written. Zip timestamps can change a later digest.
7. Finish only after those checks pass. The done line is: Commands finished. The Adobe host was NOT TESTED. That line records command evidence. It is not feature correctness, and source and behavior review is still pending.

## Limits

`npm test`, `npm run build`, a CCX file, and the dashboard do not execute Photoshop or Premiere. Host unavailable is NOT TESTED. Follow `host-verification.md` by hand. Do not claim a host pass. Do not claim the implementation is correct because a command exited 0 or a symbol appears in the package. Source and behavior review stays pending.

The command checker refuses a finite set of call shapes in a hashed file: `eval(`, `new Function(`, `vm.run`, and the named `child_process` helpers. `globalThis["eval"]` is not one of those shapes. A file approved with that spelling can run. A later edit of the file still changes the hash, and the command does not run. That list is not being grown into a token blacklist. The checker is not a sandbox.
