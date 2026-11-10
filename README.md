# UXP Assistant

UXP Assistant is a docs-grounded development skill for an empty folder or an existing UXP project. It fetches official pages, writes an implementation contract, and records the exits of the project's test, build, and package scripts.

The invoking assistant writes the feature. A missing recipe is not an unsupported API and it is not a finished feature. Selected-layer rename is one acceptance fixture. It is not substituted for another goal.

## Run

Node 20 or newer.

```bash
npm test
npm run assist -- start --empty /path/to/parent --answers answers.json --out /tmp/uxp-session
node .claude/skills/uxp-assistant/scripts/session.mjs next --out /tmp/uxp-session
```

`npm test` checks the skill by passing each `test/*.test.mjs` path to `node --test`. It does not launch Photoshop or Premiere. A build and a CCX file do not either. When the host is not launched, the result is NOT TESTED.

`npm test` includes unit checks and `test/acceptance.test.mjs`. The acceptance file scaffolds with create-bolt-uxp 1.3.27, installs that project, and packages one documented non-rename goal. It does not launch Photoshop or Premiere. A rebuilt CCX may not match a previous digest byte for byte because zip timestamps differ.

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
