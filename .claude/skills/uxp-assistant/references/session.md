# Session

The order is fixed: start, ask where to follow (`mode`), start the dashboard when that was chosen, ask the extension's questions, fetch docs, apply, close. A session is not over until `node scripts/skill.mjs session done`. If you lose your place, `node scripts/skill.mjs session next` says what is next.

`questions.json` starts with `mode`. The extension's questions follow. Pass `prompt` and each option's `id` and `label` to AskQuestion unchanged when the mode is chat. The first option is the suggestion and already ends with `(Recommended)`.

Docs are fetched on every `node scripts/skill.mjs refresh` run. Each page is `fresh` only when that fetch succeeds. An older file kept after a failed fetch is `stale`. No file is `failed`. Do not call a stale or failed page fresh. A failed page still blocks whatever the skill says it blocks.

## What mode means

- **Live dashboard.** Every later question is published with `ask` and answered with `wait`.
- **Stay in chat.** AskQuestion, then `answer`.

If the dashboard cannot start, say why in one sentence and continue in chat.

## When to stop

Stop when the user chooses a stop option, or a command fails and the skill's references say to stop. Run `node scripts/skill.mjs dashboard stop`.

## Done

Run `node scripts/skill.mjs session done --summary "..."`, then `node scripts/skill.mjs dashboard stop`. Done means the session's questions were handled. It is not approval of the skill's domain.
