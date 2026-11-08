# Agent notes

`session.json` is written by the CLI. `answers.jsonl` is written by the dashboard. A secret stays in the dashboard process. The CLI and the answer file store `requiresSecret` or `secretHeld`, never the value.

Ask before writing feature files and before removing a listener, a native addon, or `app.system`. Do not execute uploaded JSX. `window.uxpHost` is not the host DOM.

There is no model route in this skill. Platform folders are install paths. The assistant that invoked the skill writes the feature.

`node scripts/session.mjs next` is the source of the next command. `success` is true only after commands-finished, the done step is done, and `hostExecuted` is false.
