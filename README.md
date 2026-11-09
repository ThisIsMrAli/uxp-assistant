# UXP Assistant

UXP Assistant is a docs-grounded development skill for an empty folder or an existing UXP project. It fetches official pages, writes an implementation contract, and records the exits of the project's test, build, and package scripts.

The invoking assistant writes the feature. A missing recipe is not an unsupported API and it is not a finished feature. Selected-layer rename is one acceptance fixture. It is not substituted for another goal.

## Run

Node 18 or newer.

```bash
npm test
npm run assist -- start --empty /path/to/parent --answers answers.json --out /tmp/uxp-session
node .claude/skills/uxp-assistant/scripts/session.mjs next --out /tmp/uxp-session
```

`npm test` checks the skill. It does not launch Photoshop or Premiere. A build and a CCX file do not either. When the host is not launched, the result is NOT TESTED.

`npm test` includes unit checks and `test/acceptance.test.mjs`. The acceptance file scaffolds with create-bolt-uxp 1.3.27, installs that project, and packages one documented non-rename goal. It does not launch Photoshop or Premiere. A rebuilt CCX may not match a previous digest byte for byte because zip timestamps differ. The retained archive and its digest are in `evidence/`.

## Upgrading the boilerplate

`skill-boilerplate/` is vendored so agent skill loaders see real files. The skill-boilerplate repository is private, so this project does not use an npm git dependency or a submodule. Those would fail for other people.

`BOILERPLATE.lock` records `ThisIsMrAli/skill-boilerplate`, `sourceCommit`, and `contentHash`. `sourceCommit` stays `43184ceda8b5dfae081aad22735fc171c2b1dc22`, on the unmerged draft branch `cursor/import-skill-boilerplate-87ea`. The vendored tree now differs from that commit. Its content hash is `2852824b4e33726302de0137a759651cc27fa82120f57752bc6983df1de6025a`. Update `sourceCommit` when that tree is synced back to the boilerplate repository. `contentHash` is SHA-256 over the vendored subset: sorted lines of `type`, relative path, and SHA-256. A file hashes its bytes. A symlink hashes its target string and is not followed. `.git`, `node_modules`, and `.env` are omitted.

The vendored subset also omits the root agent-install directories named in `install-agents.mjs` (`.cursor`, `.agents`, and the other agent folders). The real boilerplate repo commits those as relative links such as `.cursor/skills/skill-boilerplate -> ../../.claude/skills/skill-boilerplate`. UXP Assistant has its own installer, so those links are not part of the pin. The canonical skill files under `.claude/` stay. The hash covers exactly that subset, which is the committed `skill-boilerplate/` tree.

Replace the folder from a local checkout:

```bash
node scripts/sync-boilerplate.mjs /path/to/skill-boilerplate-checkout --commit <sha>
```

The script refuses `.git`, `node_modules`, `.env`, an absolute symlink, and a symlink that resolves outside the checkout. A relative target may contain `..` when the resolved path stays inside the checkout. It then rewrites the lock. Omit `--commit` only when the sha is still unknown. `test/boilerplate-lock.test.mjs` fails if the vendored folder drifts from `contentHash`. Edit the boilerplate in its own repository and sync it back. UXP Assistant imports `skill-boilerplate/api.mjs` and nothing else from that folder.

## Dependency advisories

`npm ci` reports 7 moderate advisories, all through create-bolt-uxp 1.3.27, then meta-bolt, then archiver 7.0.1. The only upgrade `npm audit fix` offers is installer version 0.2.5, and npm marks that as a semver-major change. That downgrade removes the installer this skill pins, so it is not applied. There is no patched glob 10, minimatch 9, archiver 7.0, archiver-utils 5, or zip-stream 6 release. Jumping glob 10 to 14, or minimatch 9 to 11, is a different API and is not a safe override for the installer.

| Package | Advisory | Why it is not exploitable here |
| --- | --- | --- |
| glob 10.5.0 | [GHSA-3g3m-2fjr-6pw4](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4), AbortSignal cancellation bypass | The skill calls `createBoltUXP` with a folder name, an id, and a display name. It does not pass an AbortSignal or a glob pattern. |
| minimatch 9.0.9 | [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249), glob-parts denial of service | Nothing in this process feeds an attacker-controlled pattern to minimatch. The installer copies its own template. |
| archiver-utils, archiver, zip-stream, meta-bolt, create-bolt-uxp | Flagged because they depend on the two packages above | These run as a local scaffold in the folder the user named. This is not a service that archives or expands untrusted uploads. |
