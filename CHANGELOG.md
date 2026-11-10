# Changelog

## 0.2.0

- **A "Try it" step after `check`, with screenshots.** UXP does not run in a browser, so the developer loads the plugin in the Adobe app and sends what is wrong on the dashboard: typed words and up to six screenshots (drop, paste, or choose). Each report becomes a tracked note with its images. The assistant reads them, fixes the code, runs `check`, and the card comes back with what changed. It repeats until the developer chooses "No more bugs". Only they can end the loop.
- **A secure upload.** Only the try card takes images. The server checks the token, the `Host` and `Origin`, reads the first bytes to accept PNG, JPEG, or WebP only, caps six images of 5 MB, writes them itself as `shots/fb-<nonce>-<n>.<ext>`, and returns 413 for any other body over 64 KB. The page scales a large screenshot down before it sends.
- **Chat mode has the same loop.** The developer replies in chat; `session answer --id feedback --value bugs --text "..."` records it, with `--image` for a file the agent has.
- **`session note`.** Records a problem with an optional screenshot (`--shot`) and closes it (`--id x --status fixed`).
- **`start --yes` skips the try step**, and `feedback --skip` does the same for a background or cloud run, so unattended runs still end at `done` and say the plugin was not run in the Adobe app.
- `references/feedback.md` (the loop, how to fix well) and `references/human-checks.md` (what still needs a person).

## 0.1.0

- One sentence in, a built plugin out: the app, name, id, framework, and permissions are read from the request; one plan card; Adobe's docs saved for the app (every page Adobe lists, the host types, an index, the limits); the project scaffolded with create-bolt-uxp 1.3.27; the plugin written by the assistant; `check` builds, packages, type checks, runs the tests, and reads the code against the saved docs.
- A session that does not stop: every command prints a `next` line, `session next` recomputes it, and the dashboard shows whether the agent is working, waiting, or quiet.
