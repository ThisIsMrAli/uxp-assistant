# Try it: bugs from the developer

UXP does not run in a browser, and nothing here can open Premiere Pro, Photoshop, or InDesign. The developer can. The try step turns what they see into fixes.

## The loop

1. `check` says ok. `session next` says run `node scripts/skill.mjs feedback`.
2. `feedback` publishes round 1. The card says how to load the build (UXP Developer Tool, Add Plugin, the `dist/manifest.json`, Load; or the `.ccx`), has a box for words, takes up to six screenshots, and offers two choices:
   - **Something is wrong, or I want a change.** Needs words or a screenshot.
   - **No more bugs, finish.** Ends the loop and the session.
3. You `wait`. The answer carries `text` and `images` (absolute paths under the session's `shots/`). The report is filed as note `fb<round>`, with its screenshots, in the dashboard's Notes tab.
4. Read it, fix it, `check`, mark the notes fixed, and run `feedback --changed "<what you changed>"`. Round 2 shows what changed and what is fixed, and asks the developer to reload and try again.
5. Repeat until they choose "No more bugs". That choice closes every `fb` note as confirmed by them.

`session next` always knows where you are: after a bug report it prints the steps above with the words and screenshot paths; after you ask again it says wait.

## Doing the fix well

- A screenshot is evidence. Read it for the exact wrong text, the layout, the error message. A pasted error message is the fastest fix: search the code for it.
- Quote their words back in the `--changed` line so they see you read them: "Save now writes the file; the QR export is 4x sharper."
- Change only what the report names. Do not restyle, rename, or remove to make a problem go away. A wrong note is `skipped` (`session note --id x --status skipped`), and you say why in `--changed`.
- A report can be a request ("also let me pick the size"). Do it. It is a change like any other.
- If the report is unclear, do not guess and do not ask in chat: put the question in `--changed`. The card returns with it.
- Behaviour you cannot check without the app (a panel size, a host dialog, a premiere timeline): say so in `--changed` and what you changed to make it more likely right. Never say it works.
- Run `check` before every round. A fix that breaks the build never reaches the developer.

## Chat mode

Call AskQuestion with the two options. If they pick the first, ask in chat what is wrong and to paste a screenshot, and wait for the reply. This is the one place you end your turn: their reply is the input. You cannot copy a pasted image, so write what each screenshot shows into the text:

```bash
node scripts/skill.mjs session answer --id feedback --value bugs --text "<their words and what each screenshot shows>"
```

`--image <file>` (repeatable) copies a file you do have. `--value good` ends the loop.

## No one to ask

`start --yes` skips the try step. In a background or cloud run, `node scripts/skill.mjs feedback --skip` does too. The summary then says the plugin was built and packaged and not run in the Adobe app.

## The upload

Screenshots are sent from the dashboard page to the local server. The page scales a large image to 1800 px on its long edge and sends JPEG when it must. The server accepts at most 6 images of 5 MB each, checks the first bytes (PNG, JPEG, or WebP; a name or declared type is not trusted), and writes them as `shots/fb-<nonce>-<n>.<ext>`. Only a question that takes screenshots may send a body over 64 KB. See [dashboard.md](dashboard.md).
