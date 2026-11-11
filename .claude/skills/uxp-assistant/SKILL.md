---
name: uxp-assistant
description: >-
  Builds a UXP plugin for an Adobe app (Premiere Pro, Photoshop, InDesign,
  Media Encoder, Illustrator, After Effects) from one sentence, or adds a feature
  to an existing plugin. It saves Adobe's current UXP and host API docs on this
  computer, reads the app, name, framework, and permissions from the request,
  asks on the dashboard for anything the sentence did not say, then one confirm card the person must accept, then scaffolds, writes, builds, packages, and checks the
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
- Ask every question `next` names, including the planning questions and the confirm card. In dashboard mode you publish the card and wait. You never answer it. You never pick the Adobe app, the name, native or WebView, Spectrum, or Build it. A sentence in chat is not a click on the dashboard: the person still confirms the spec. `--yes` is only when nobody is there, and it cannot invent a plugin from an empty request.
- Between `ask` and `wait` (dashboard mode), write nothing to the user.
- Long commands (`docs`, `build`, `check`) take up to a minute. Wait for them. Do not report on them.
- If you lose your place, or the user types "continue", run `node scripts/skill.mjs session next`.

## Start

```bash
node scripts/skill.mjs start --goal "<the developer's request, word for word>" --empty "<the workspace folder>"
```

Use `--project "<folder>"` instead of `--empty` when the developer already has a plugin. Pass the folder they are working in, not the skill's folder. Pass `--goal ""` when they only invoked the skill and did not describe a plugin. Do not pass the skill name, a file path, or an Adobe app they did not name. Do not pass `--host`, `--name`, or `--runtime` unless their sentence said so. The command prints the first question and a `next` line.

- Add `--mode chat` when the developer already said no dashboard, or when you are not on their computer.
- Add `--yes` when the developer said not to ask, or when nobody is there to answer (a background or cloud run). It picks chat, assumes native UXP, Spectrum, and a host-matching look, answers the plan card with "Build it", skips the try step, and goes straight to the docs. It still asks for the Adobe app when the request names none. Say those were assumptions.

## The flow

Each command's `next` line names the command that follows it. Do what it says.

| Step | What it does | Questions |
| --- | --- | --- |
| mode | Dashboard (a page on this computer) or chat | one |
| planning | What the sentence did not say. No sentence at all asks for the job, the name, and the screen, then the Adobe app, native or WebView, Spectrum or plain HTML, and the look | those, one at a time, on the dashboard |
| plan | The spec, read back. Build it, change something, or stop. A full sentence in chat still stops here until they confirm | one (a text answer only if they change something) |
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
- Read Design and Panel UI in `BRIEF.md` before writing the screen. Design is a ui-ux-pro-max search for this goal, for every plugin. Use its interaction rules: a visible label, the error under that field, one primary action, and room for the result. Do not copy its colors, fonts, landing-page sections, or animation. A native panel expresses those rules with the Spectrum widgets section in `BRIEF.md`: the host tag for the job, including sliders, progress, radios, menus, and action buttons, not only a text field and a button. Run `find` on the tag before using it. A WebView page may use normal CSS for the same rules, and the host shell around that page stays a UXP document. Use the host colors. A canvas needs an explicit width and height in pixels.
- Report progress while you edit, so a dashboard user sees it: `node scripts/skill.mjs session step --id implement --status running --doing "Writing the encoder" --progress 2/6 --out <session>` (`2/6` is step 2 of your own six; pick any total).

## Check, fix, repeat

`node scripts/skill.mjs check` prints `docs`, then `errors` and `warnings`, each with a fix line, and `next`. `docs` says when the Premiere types file was saved. Fix every error, run it again, and repeat until `ok` is true. It refuses to pass while `src/` is the starter. It also fails on Premiere document bugs the saved pages do not spell out: an import of Node `fs` or `qrcode/lib/server.js`, `height: auto` on a canvas, a `value` or `selected` prop on `sp-textfield`, `sp-textarea`, `sp-picker`, or `sp-menu-item`, CSS grid, `gap`, or `inset` in the host document, and a plain `<button>`. The WebView page may use grid and gap.

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
