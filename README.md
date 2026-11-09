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

`BOILERPLATE.lock` records `ThisIsMrAli/skill-boilerplate`, `sourceCommit`, and `contentHash`. `sourceCommit` is null until a checkout sha is filled in. `contentHash` is SHA-256 over sorted lines of `type`, relative path, and SHA-256. A file hashes its bytes. A symlink hashes its target string and is not followed. `.git`, `node_modules`, and `.env` are omitted.

Replace the folder from a local checkout:

```bash
node scripts/sync-boilerplate.mjs /path/to/skill-boilerplate-checkout --commit <sha>
```

The script refuses `.git`, `node_modules`, `.env`, an absolute symlink, a symlink target containing `..`, and a symlink that resolves outside the checkout. It then rewrites the lock. Omit `--commit` only when the sha is still unknown. `test/boilerplate-lock.test.mjs` fails if the vendored folder drifts from `contentHash`. Edit the boilerplate in its own repository and sync it back. UXP Assistant imports `skill-boilerplate/api.mjs` and nothing else from that folder.
