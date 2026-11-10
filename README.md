# UXP Assistant

Say what you want in one sentence, for example "create a plugin that creates high quality QR codes in Premiere". UXP Assistant builds it.

It does this without stopping to quiz you:

1. It reads the request and fills in the Adobe app, the plugin name and id, the framework, and the permissions.
2. It shows one plan card. You press Build, Change something, or Stop.
3. It saves Adobe's current docs for that app: every page on Adobe's list, the host API types, a search index, and a list of known limits.
4. It scaffolds with create-bolt-uxp 1.3.27 and narrows the permissions to what the plan needs.
5. The assistant writes the plugin, reading the saved pages as it goes.
6. `check` builds and packages it, type checks the files the assistant wrote, then reads the code against Adobe's saved pages. It reports wrong API names, missing permissions, and features Adobe lists as unsupported, each with a fix. The assistant fixes them and runs `check` again until it is clean.
7. You try it. UXP does not run in a browser and nothing here can open Premiere Pro, Photoshop, or InDesign, so you load the plugin yourself (the card says how) and use it. If something is wrong, you type what you saw and add screenshots on the dashboard (drop, paste, or choose files; up to six). The assistant reads them, fixes the code, runs `check`, and asks you to try again. This repeats until you press "No more bugs".

The result is a built plugin and a `.ccx` file. If you skipped step 7 (`--yes`, or nobody was there), it was not run in the Adobe app, and the summary says so.

## What it will not do

It does not open an Adobe app, so it cannot see your panel. A clean `check` means the plugin built, packaged, passed its own tests, and matched Adobe's saved pages. It does not mean the plugin works in the app: that is what step 7 is for. [`references/human-checks.md`](.claude/skills/uxp-assistant/references/human-checks.md) lists what still needs a person. It does not submit to the marketplace, and it does not guess a limit that Adobe's docs do not state.

## Run

Node 20 or newer.

```bash
npm test
```

In an agent, say the sentence. The skill's own steps are in [`.claude/skills/uxp-assistant/SKILL.md`](.claude/skills/uxp-assistant/SKILL.md). To drive it by hand:

```bash
npm run skill -- start --goal "create a plugin that creates high quality QR codes in Premiere" --mode chat
npm run skill -- docs   --out <session folder>
npm run skill -- find   --out <session folder> canvas image
npm run skill -- build  --out <session folder>
npm run skill -- check  --out <session folder>
npm run skill -- feedback --out <session folder>      # the try card; answer it on the dashboard or in chat
```

`npm test` runs every `test/*.test.mjs` file with a fake Adobe site and a fake installer, so it needs no network. It also starts the dashboard server in-process and posts screenshots to it. It does not launch Photoshop or Premiere. A build and a CCX file do not either. When the host is not launched, the result is NOT TESTED.

## Install

From this folder:

```bash
node install-agents.mjs --global
```

That links the skill into the agent folders on this machine, including Claude, Cursor, Codex, Gemini, and Windsurf. Use `node install-agents.mjs` without `--global` to link it only inside this project. The canonical skill is [`.claude/skills/uxp-assistant/SKILL.md`](.claude/skills/uxp-assistant/SKILL.md). The other agent directories are symlinks to that folder.

`npx skills add` copies the skill directory on its own.

The GitHub repository is private. The remote install fails with `Authentication failed` unless you are logged in as someone who can read it (`gh auth login`, or `GH_TOKEN` / `GITHUB_TOKEN` with access to the repo). It does not make the repository public.

```bash
# From a checkout of this private repository. This does not need GitHub auth.
npx skills add . --skill uxp-assistant

# Remote install from main. This is the form that works today, after GitHub authentication.
npx skills add ThisIsMrAli/uxp-assistant --skill uxp-assistant
```

`node install-agents.mjs --global` from this folder is the other path that does not talk to GitHub.

## Dependency advisories

`npm ci` reports 7 moderate advisories, all through create-bolt-uxp 1.3.27, then meta-bolt, then archiver 7.0.1. The only upgrade `npm audit fix` offers is installer version 0.2.5, and npm marks that as a semver-major change. That downgrade removes the installer this skill pins, so it is not applied. There is no patched glob 10, minimatch 9, archiver 7.0, archiver-utils 5, or zip-stream 6 release. Jumping glob 10 to 14, or minimatch 9 to 11, is a different API and is not a safe override for the installer.

| Package | Advisory | Why it is not exploitable here |
| --- | --- | --- |
| glob 10.5.0 | [GHSA-3g3m-2fjr-6pw4](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4), AbortSignal cancellation bypass | The skill calls `createBoltUXP` with a folder name, an id, and a display name. It does not pass an AbortSignal or a glob pattern. |
| minimatch 9.0.9 | [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249), glob-parts denial of service | Nothing in this process feeds an attacker-controlled pattern to minimatch. The installer copies its own template. |
| archiver-utils, archiver, zip-stream, meta-bolt, create-bolt-uxp | Flagged because they depend on the two packages above | These run as a local scaffold in the folder the user named. This is not a service that archives or expands untrusted uploads. |
