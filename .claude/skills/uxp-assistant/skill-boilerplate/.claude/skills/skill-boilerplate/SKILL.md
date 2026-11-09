---
name: skill-boilerplate
description: >-
  Runs a session on a loopback dashboard or in chat. The first command creates
  the session and asks where to follow it. Later decisions are buttons on the
  dashboard. A skill adds its own links, rules, steps, and questions.
license: MIT
compatibility: Requires Node.js 18 or newer. The dashboard needs a browser on the same computer and falls back to chat when it cannot start.
---

# Session

Run one session. Change a project only for what the skill's own references say to change.

The skill root is the directory that contains this file. Sessions are written outside the skill, in `~/.skill-boilerplate/<slug>/` unless the extension names another home directory. `--out` overrides that.

## The one rule: do not stop

A session ends at `session.mjs done`. Until then you are in the middle of a task.

- Every command prints a `next` line. Do what it says.
- Never end your turn with a message while the session is open. A message with no command after it ends your turn.
- Between `ask` and `wait`, write nothing to the user. The question is already on the dashboard.
- Before each file you change, report it: `node scripts/session.mjs step --id decide --status running --doing "Editing the file (2 of 5)" --progress 2/5`.
- If you lose your place, or the user types "continue", run `node scripts/session.mjs next`.

Do not read every reference up front. Read the one for the step you are on.

## Where a session can happen

The user picks once.

- **Dashboard.** A page on this computer. You publish a decision with `session.mjs ask` and run `session.mjs wait` until they click. You do not also call AskQuestion for it.
- **Chat.** Nothing opens. You call AskQuestion for each decision and record the click with `session.mjs answer`.

If you run on another machine than the user's (a cloud agent, SSH, a container), skip the question, run `node scripts/session.mjs mode --set chat`, and continue in chat. The user's browser cannot reach this computer's `127.0.0.1`.

If the user types an answer in chat while the dashboard is waiting, record it with `answer` and stop waiting.

## Workflow

1. **Start.** One command creates the session and prints the mode question. It does not fetch docs.

```bash
node scripts/start.mjs --extension /absolute/path/to/extension.mjs --out /absolute/path/to/session
```

2. **Ask where to follow.** On the user's computer, call AskQuestion with the `mode` object. Title is `Next step`. Pass `prompt` and each option's `id` and `label` through unchanged.

   - `dashboard`: `node scripts/session.mjs mode --set dashboard`, then `node scripts/dashboard.mjs start`. It prints `{ ok, url }` within seconds, before any docs fetch. Say the link once, in one line, and carry on in the same turn. If `ok` is false, say the reason in one sentence, run `session.mjs mode --set chat`, and continue in chat.
   - `chat`: `node scripts/session.mjs mode --set chat`.

3. **Decide.** Ask the later objects in `questions.json` one at a time. Dashboard: `session.mjs ask`, then `session.mjs wait`. `wait` returns in 25 seconds. While `status` is `pending`, run it again. Chat: AskQuestion, then `session.mjs answer`. If `wait` prints `server-down`, run `dashboard.mjs start` once. If that fails, `mode --set chat` and ask the same question with AskQuestion.

4. **Docs.** `node scripts/refresh.mjs --out <session>` fetches the extension's sources in parallel. Each page is fresh, stale, or failed. Stale is not fresh. The docs step finishes as done and the detail carries the fresh, stale, and failed counts. The dashboard shows the step, a timer, and the per-page line while this runs. Do not start this before the dashboard when the mode is dashboard. Pass `--out` on every command.

5. **Apply.** Do what the extension's references say for the answers. Run a real command before recording tests, package, or the host. Do not mark those done from the next line.

6. **Close.** `node scripts/session.mjs done --summary "..."`, then `node scripts/dashboard.mjs stop`.

## Read next

- [references/extension.md](references/extension.md) for what a skill adds
- [references/dashboard.md](references/dashboard.md) for the commands and the wait contract
- [references/session.md](references/session.md) for what mode means and when to stop
