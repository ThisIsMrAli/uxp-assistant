---
name: uxp-assistant
description: >-
  Builds a UXP plugin for an Adobe app (Premiere Pro, Photoshop, InDesign,
  Media Encoder, Illustrator, After Effects) from one sentence, or adds a feature
  to an existing plugin. It saves Adobe's current UXP and host API docs on this
  computer, reads the app, name, framework, and permissions from the request,
  asks only what the sentence left open, then one confirm card, then scaffolds, writes, builds, packages, and checks the
  plugin against the saved docs. Then the developer tries it in the Adobe app and
  sends bugs as words and screenshots; it fixes them and asks again until they say
  there are none. It runs to the end without stopping. Use when
  the user says UXP Assistant, or asks for a UXP plugin, a Premiere Pro,
  Photoshop, or InDesign panel or plugin, an Adobe UXP feature, or a .ccx.
license: MIT
compatibility: Requires Node.js 20 or newer (22.18 or newer to run the generated TypeScript tests) and the network once for Adobe's docs and the pinned scaffold tool. The dashboard needs a browser on the same computer and falls back to chat when it cannot start. The Adobe app is never launched.
---

# UXP Assistant

Turn one request into a built UXP plugin. The skill saves the docs, plans, scaffolds, checks, and packages. You write the plugin.

The skill root is the directory that contains this file. Run `node scripts/skill.mjs` from there. Sessions are written outside the skill and outside the plugin, in `~/.uxp-assistant/sessions/`. Every `next` line already carries `--out`.

## The one rule: do not stop

A session ends at `session done`. Until then you are in the middle of a task.

- Every command prints a `next` line. Do what it says.
- Never end your turn with a message while the session is open. A message with no command after it ends your turn.
- Ask the developer only what `next` tells you to ask: the mode, the plan card, then after `check` the try card. Nothing else, ever. Not the name, the app, the framework, the permissions, or whether to proceed. If something is unclear, take the simplest reading, say so in the summary, and keep going.
- Between `ask` and `wait` (dashboard mode), write nothing to the user.
- Long commands (`docs`, `build`, `check`) take up to a minute. Wait for them. Do not report on them.
- If you lose your place, or the user types "continue", run `node scripts/skill.mjs session next`.

## Start

```bash
node scripts/skill.mjs start --goal "<the developer's request, word for word>" --empty "<the workspace folder>"
```

Use `--project "<folder>"` instead of `--empty` when the developer already has a plugin. Pass the folder the developer is working in, not the skill's folder. It reads the Adobe app, the name, the id, the framework, and the permissions from the request, so you pass nothing else. It prints the plan and a `next` line.

- Add `--mode chat` when the developer already said no dashboard, or when you are not on their computer.
- Add `--yes` when the developer said not to ask, or when nobody is there to answer (a background or cloud run). It picks chat, assumes native UXP, Spectrum, and a host-matching look, answers the plan card with "Build it", skips the try step, and goes straight to the docs. It still asks for the Adobe app when the request names none. Say those were assumptions.

## The flow

Each command's `next` line names the command that follows it. Do what it says.

| Step | What it does | Questions |
| --- | --- | --- |
| mode | Dashboard (a page on this computer) or chat | one |
| planning | Only what the sentence did not say: the goal and name when they are missing, native UXP or WebView, Spectrum or plain HTML, the look, and at most two choices the goal leaves open | those |
| plan | One card: app, name, description, UI, controls, look, permissions, folder. Build it, change something, or stop | one (a text answer only if they change something) |
| docs | `docs` saves every page Adobe lists for the app, plus the host's TypeScript types, in about ten seconds | none |
| build | `build` creates the project, narrows its permissions, installs, builds the empty starter, writes `BRIEF.md` | none |
| implement | You write the plugin from `BRIEF.md` | none |
| check | `check` builds, packages the `.ccx`, type checks your files, runs the tests, and reads your code against the saved docs | none |
| try | `feedback` shows how to load it. The developer uses it in the Adobe app and sends what is wrong (words, screenshots), or says there are no more bugs. You fix and ask again | one card, repeated until they say no more bugs |
| done | `session done --summary "..."` | none |

If the request names no Adobe app, the host question comes first. Native UXP is the recommended UI. WebView is last resort. If the developer picks "Change something", the plan command reads their words (app, name, framework, permissions, folder) and the next steps use them.

An empty folder is the project. Files are written in that folder, not in a subfolder named after the plugin. A folder that already has files gets a subfolder.

## Writing the plugin

`BRIEF.md` in the session folder is your task. Read it first. It lists the plan, the saved pages worth reading for this goal, and the limits Adobe documents.

- Every host API name comes from the docs. Before you call one, run `node scripts/skill.mjs find <words>` and read the hit. The Premiere types file is `docs/api/premierepro.d.ts`; grep it. `check` fails on a name that is not in it, and on a TypeScript error in a file you wrote.
- `docs/` holds every page Adobe lists for the app, as markdown. `docs/INDEX.md` lists them. `docs/LIMITS.md` is what UXP cannot do. A limit that is not there is not a limit; do not invent one.
- Keep the starter's files. Write the plugin under `src/`. Put logic that needs no host (math, parsing, encoding) in its own module with a test, so it is checked without the app.
- Declare the narrowest `requiredPermissions` the code needs, in `uxp.config.ts`. `check` fails when the code uses a picker, the network, or the clipboard without it.
- Follow the Panel UI section in `BRIEF.md`. Native panels use the host's Spectrum widgets (`sp-heading`, `sp-body`, `sp-divider`, `sp-textfield` or `sp-textarea`, `sp-button`). Do not keep the starter's demo CSS: it centers the page and paints its own buttons. A canvas needs an explicit width and height in pixels. `height: auto` collapses it to a line. A WebView page may use normal CSS, still with one main button, a visible label, the error under the field, and a square preview. Use the host colors. Do not copy in a separate design system.
- Report progress while you edit, so a dashboard user sees it: `node scripts/skill.mjs session step --id implement --status running --doing "Writing the encoder" --progress 2/6 --out <session>` (`2/6` is step 2 of your own six; pick any total).

## Check, fix, repeat

`node scripts/skill.mjs check` prints `errors` and `warnings`, each with a fix line, and `next`. Fix every error, run it again, and repeat until `ok` is true. It refuses to pass while `src/` is the starter.

## Try, report, fix, repeat

Nothing here can open the Adobe app, so the developer does. After `check` is ok, `next` says to run `node scripts/skill.mjs feedback`. It publishes one card: how to load the build, a box for words and screenshots, and two choices, "Something is wrong, or I want a change" and "No more bugs, finish". Wait for it like any other question.

When the answer is the first choice, `wait` prints their `text` and the file path of each screenshot in `images`. Then:

1. Read the words and open every screenshot (you can view images). Say to yourself what is wrong and what they expected.
2. The report is already note `fb1`. For more than one problem, add a note each: `node scripts/skill.mjs session note --id fb1-1 --text "..."`.
3. Fix the code. Change only what the report names. Never remove a feature to make a problem go away. A request for a change or a new feature is handled the same way.
4. Run `check` until it says ok, mark each fixed note with `session note --id <id> --status fixed`, and ask again: `node scripts/skill.mjs feedback --changed "<one line: what you changed>"`.

The card comes back with what changed. The loop ends only when the developer chooses "No more bugs". You never decide that. If their words already name what is wrong and what they expected, fix that. Put a question in `--changed` only when you cannot tell the expected result from the words or the screenshot; do not guess and do not ask in chat. In chat mode the answer arrives as their reply: record it with `session answer --id feedback --value bugs --text "<their words and what each screenshot shows>"` (`--image <file>` copies a file you have). If no person is there, `feedback --skip`. Details: [references/feedback.md](references/feedback.md).

## Finish

Run `node scripts/skill.mjs session done --summary "..."`. Then, if the dashboard is up, `node scripts/skill.mjs dashboard stop`. Your last message says what was built, where, and how to load it (`check` prints the load line). Say whether they tried it: after "No more bugs" say they loaded it and chose that (this process still did not launch the Adobe app); with `--yes` or `--skip` say it was built and packaged but not run in the Adobe app, because nothing here can open the app. Do not claim host behavior you did not see. Name anything you could not verify. [references/human-checks.md](references/human-checks.md) lists what still needs a person.

## Other commands

- `node scripts/skill.mjs find <words> [--host ppro]` searches the saved docs.
- `node scripts/skill.mjs docs --skip` only after two failed `docs` runs. Say so in the summary.
- `node scripts/skill.mjs build --name "X" --id com.acme.x --host phxs --framework vue` overrides the plan before the project exists.
- `node scripts/skill.mjs session show` lists steps and answers.
- `node scripts/skill.mjs session note --text "<what is wrong>" [--id x] [--screen "<where>"] [--shot <image>]` records a problem. `--id x --status open|fixed|skipped` closes it.

References, only when you need them: [references/feedback.md](references/feedback.md), [references/dashboard.md](references/dashboard.md), [references/session.md](references/session.md), [references/human-checks.md](references/human-checks.md).
