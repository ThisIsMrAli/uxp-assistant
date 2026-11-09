---
name: uxp-assistant
description: >-
  Plan and hand off a UXP feature for an empty folder or an existing project.
  The session, dashboard, and questions are the skill boilerplate. This skill
  adds the UXP links, the permission rules, and the implementation handoff.
license: MIT
compatibility: Requires Node.js 20 or newer. The dashboard needs a browser on the same computer and falls back to chat when it cannot start.
---

# UXP Assistant

Plan one UXP feature and hand it to the invoking assistant. Change a project only for what this page says to change.

The skill root is the directory that contains this file. Run `node scripts/skill.mjs` from there. That file is the only door into the skill boilerplate. Sessions are written outside the skill. The Adobe host was NOT TESTED unless you actually launched it.

## The one rule: do not stop

A session ends at `node scripts/skill.mjs session done`. Until then you are in the middle of a task.

- Every command prints a `next` line. Do what it says.
- Never end your turn with a message while the session is open. A message with no command after it ends your turn.
- Between `ask` and `wait`, write nothing to the user. The question is already on the dashboard.
- Before each file you change for the handoff, report it: `node scripts/skill.mjs session step --id decide --status running --doing "Editing main.tsx (2 of 5)" --progress 2/5`.
- If you lose your place, or the user types "continue", run `node scripts/skill.mjs session next`.

Do not read every reference up front. Read the one for the step you are on.

## Where a session can happen

The user picks once.

- **Dashboard.** A page on this computer. You publish a decision with `skill.mjs session ask` and run `skill.mjs session wait` until they click. You do not also call AskQuestion for it.
- **Chat.** Nothing opens. You call AskQuestion for each decision and record the click with `skill.mjs session answer`.

If you run on another machine than the user's (a cloud agent, SSH, a container), skip the question. Start with `--remote`, or run `node scripts/skill.mjs session mode --set chat`, and continue in chat. The user's browser cannot reach this computer's `127.0.0.1`.

If the user types an answer in chat while the dashboard is waiting, record it with `answer` and stop waiting.

## Workflow

1. **Start.** This creates the session and prints the mode question. It does not fetch docs.

```bash
node scripts/skill.mjs start --empty /absolute/path/to/parent --out /absolute/path/to/session
```

   An existing project uses `--project /absolute/path/to/plugin` instead of `--empty`. The empty-folder scaffold is created inside the `--empty` folder. It is not created under the session.

   Install with the line in `skill.json`, exactly:

```bash
npx skills add <owner>/uxp-assistant --skill uxp-assistant -a cursor
```

   That copy includes the boilerplate inside the skill, so `start` can load it. If `create-bolt-uxp` is not already installed, `domain` installs `create-bolt-uxp@1.3.27` beside the skill before it scaffolds. The new project still needs its own `npm install`. From this repo, `node scripts/skill.mjs install --into <folder>` copies the same skill and links `node_modules`. Then run `node scripts/skill.mjs` from the copied skill.

2. **Ask where to follow.** On the user's computer, call AskQuestion with `mode`. Pass `prompt` and each option's `id` and `label` through unchanged.

   - `dashboard`: `node scripts/skill.mjs session mode --set dashboard`, then `node scripts/skill.mjs dashboard start`. It prints `{ ok, url }` within seconds, before any docs fetch. Say the link once, in one line, and carry on in the same turn. If `ok` is false, say the reason in one sentence, run `session mode --set chat`, and continue in chat.
   - `chat`: `node scripts/skill.mjs session mode --set chat`.

3. **Intake and later decisions.** Ask the objects in `questions.json` one at a time. Dashboard: `session ask`, then `session wait`. While `status` is `pending`, run `wait` again. Chat: AskQuestion, then `session answer`. If `wait` prints `server-down`, run `dashboard start` once. If that fails, `mode --set chat` and ask the same question with AskQuestion. That is the only dashboard path that uses chat.

   The goal text is kept as typed. The Bolt starter's `requiredPermissions` is not approval. `narrow` writes the least set: `{}` for a native panel that requested no permission, and the documented local WebView keys (`allow` `"yes"`, `domains` `[]`, `allowLocalRendering` `"yes"`, `enableMessageBridge` `"no"`) when the runtime loads `plugin:/` content and does not communicate. A goal that needs `postMessage` gets `enableMessageBridge` `"localOnly"` instead. `keep` leaves an existing project's manifest unchanged. Any other permission answer pauses and writes nothing. A `network` key and `enableMessageBridge` `"localOnly"` are grants. An unknown permission name is not added. When the bridge is `"no"`, the host shell still creates and appends the webview and does not call `postMessage` or `document.theme.onUpdated`.

   Every choice has a `(Recommended)` option. Permissions are choices. There is no OS question. An existing project does not ask the empty-folder name, id, framework, or context questions. Those come from the project.

4. **Docs.** `node scripts/skill.mjs refresh --out <session>` fetches the official pages for the answered host and goal, in parallel, with a per-page timeout and an overall budget. Each page is fresh, stale, or failed. Stale is not fresh. The docs step finishes as done, and its detail is the fresh, stale, and failed counts. A failed or stale page does not open an implementation handoff. The dashboard shows the step, a timer, and each page's label while this runs. Do this only after the dashboard is up when the mode is dashboard. Pass `--out` on this command. The current manifest page is https://developer.adobe.com/uxp/guides/explanation/concepts/manifest/ and says current UXP hosts use manifest version 5. Premiere's introduction is https://developer.adobe.com/premiere-pro/uxp/introduction/ and says Premiere (version 25.6). Generated manifests use version 5, `uniqueIds` false, and Premiere `minVersion` `25.6.0`. Photoshop keeps starter `minVersion` `24.2.0`. The visible title is the display name, not Bolt UXP.

5. **Domain handoff.** `node scripts/skill.mjs domain --out <session>` runs the handoff in `<session>/domain` so it does not overwrite the dashboard session, and it does not move the session pointer. The scaffold is created in the `--empty` folder. Running it again does not delete a project that is already there. It keeps the no-write gates, the provenance checker, the permission narrowing, and the package checks. Follow `design-constraints.md`. When that file names Spectrum UXP tags from fresh widget pages, use those tags and do not import Spectrum Web Components. A browser approximation is not part of the package. This skill does not replace an arbitrary goal with a canned panel. A `script-change` answer is bound to the question by its nonce. The dashboard stores the scope with that answer.

   Write the feature yourself. Use the documented API in code. Add a test that imports that module and asserts on the call. Do not record a stock file. Leave the handoff `build` and `ccx` commands unchanged. A changed command or a changed script body is not run until `script-change` is answered for those exact commands and file hashes. The command checker refuses `eval(`, `new Function(`, `vm.run`, and the named `child_process` helpers in a hashed file. `globalThis["eval"]` is not one of those shapes. That list is not a sandbox.

6. **Record.** Add a `"test"` script. The Bolt starter does not ship one. Run `npm install` in the project before test, build, or package. A WebView project also needs `npm install` inside `webview-ui`. A WebView `npm run build` that exits 0 and writes no output is a failure. Then write `<session>/agent-result.json` in this one format:

```json
{ "goal": "the same goal text", "files": [{ "path": "src/main.tsx", "sha256": "<64 hex characters>" }] }
```

   `path` is relative to the project. `sha256` is the file's bytes. Then run `node scripts/skill.mjs record --out <session>`. That is the only record command. It checks the goal and the hashes, then runs the validator: the test, the build, and the package. Their exits are recorded by that command. If it prints `script-change`, the approval is on the dashboard. Answer it there, then run the same record command again. When the commands finish, the next line is: Commands finished. The Adobe host was NOT TESTED. That line is command evidence. It is not feature correctness, and source and behavior review is still pending. Do not run `assist.mjs record`.

Every command prints a `next` line. Do that line next. Do not mark tests, package, or the host done because a next line mentioned them.

## Read next

- [references/coverage.md](references/coverage.md) for the permission floor and what was not tested
- The skill boilerplate's `references/dashboard.md` and `references/session.md` for the wait contract

## Limits

`npm test`, `npm run build`, a CCX file, and the dashboard do not execute Photoshop or Premiere. Host unavailable is NOT TESTED. Do not claim a host pass. Do not claim the implementation is correct because a command exited 0.
