# Session

The order is fixed: `start`, ask where to follow (`mode`), start the dashboard when that was chosen, the plan card, then `docs`, `build`, the plugin, `check`, the try loop (`feedback`), and `session done`. A session is not over until `node scripts/skill.mjs session done`. If you lose your place, `node scripts/skill.mjs session next` says what is next.

`questions.json` starts with `mode`. Then, only when needed, `host` (the request named no Adobe app), then `plan`, then `tweak` (only after "Change something"). `ask --id <id>` prints the question; pass its `prompt` and each option's `id` and `label` to AskQuestion unchanged when the mode is chat. The first option is the suggestion and ends with `(Recommended)`.

## What mode means

- **Live dashboard.** Every question is published with `ask` and answered with `wait`.
- **Stay in chat.** AskQuestion, then `answer`.

If the dashboard cannot start, say why in one sentence and continue in chat.

## Files in a session folder

- `plan.json`: the plan. `start` writes it from the request; the `host` answer, the `tweak` words, and flags on `docs`, `build`, or `check` update it.
- `docs/`: Adobe's pages as markdown (`pages/`), the host's TypeScript types (`api/`), `INDEX.md`, `LIMITS.md`. A copy is also cached in `~/.uxp-assistant/library/<app>/`, used for any page that fails to download, which then counts as stale.
- `BRIEF.md`: the assistant's task, written by `build`.
- `baseline.json`: the starter's source, so `check` knows which lines the assistant wrote.
- `session.json` (written by commands) and `answers.jsonl` (written by the dashboard): never edit either.

## The try step

After `check` is clean, `feedback` publishes the try card ([feedback.md](feedback.md)). The step is `waiting` while the card is open, `running` while you fix a report, and `done` only when the developer chooses "No more bugs". `--yes` and `feedback --skip` mark it `skipped`. `questions.json` does not list this card: `feedback` builds it for the round, so it is never asked before the plugin is built.

A card option can carry `repeat` (this answer opens another round, so the step stays open) and `then` (what to do next). `session next` prints `then` plus the developer's words and screenshot paths until you ask again.

Notes are the dashboard's list of what is wrong: `fb<round>` for each report, `a-<hash>` for what `check` found. Open notes show in the Notes tab; "No more bugs" closes the `fb` notes.

## When to stop

Only when the developer chooses Stop on the plan card. `next` then prints the `done --stopped` command. Otherwise a session runs to `done`.

## Done

Run `node scripts/skill.mjs session done --summary "..."`, then `node scripts/skill.mjs dashboard stop`. `done` is refused until the docs step is done or was skipped with `docs --skip`.
