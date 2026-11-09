# skill-boilerplate

A self-contained session workflow: one start command, a mode question, a loopback dashboard, and later decisions answered on that dashboard or in chat.

It is derived from express-addon-review 0.4.0. The MIT notice in `LICENSE` is that project's notice. Express-only review, listing, and audit code is not in this folder. This folder does not import any other project, so it can be moved into its own repository as it is.

The repository <https://github.com/ThisIsMrAli/skill-boilerplate> is private. This tree does not push to it. The owner moves this folder there separately.

## Upgrading the boilerplate

Consumers vendor this folder so agent loaders see real files. They do not use an npm git dependency or a submodule, because this repository is private and those installs would fail for other people.

The consumer's `BOILERPLATE.lock` records `ThisIsMrAli/skill-boilerplate`, `sourceCommit`, and `contentHash`. `sourceCommit` stays null until a checkout sha is filled in. `contentHash` is SHA-256 over the sorted lines `type`, relative path, and SHA-256. File lines hash bytes. Symlink lines hash the target string and are not followed. `.git`, `node_modules`, and `.env` are omitted.

`node install-agents.mjs` writes root agent-install links such as `.cursor/skills/skill-boilerplate -> ../../.claude/skills/skill-boilerplate`. Consumers do not vendor those root directories. A consuming project has its own installer. The hash covers the remaining files, including the canonical skill under `.claude/`.

The consumer replaces this folder with its sync script. That script refuses `.git`, `node_modules`, `.env`, an absolute symlink, and a symlink that resolves outside the checkout. A relative target may contain `..` when the resolved path stays inside the checkout. It then rewrites the lock. A drift test fails if the vendored bytes change any other way. The only import is `api.mjs`.

## Public entry

Other projects import `api.mjs` and nothing else:

```javascript
import { start, session, dashboard, refresh } from "skill-boilerplate/api.mjs";
```

A skill supplies an extension. The shape is in `.claude/skills/skill-boilerplate/references/extension.md`.

## Commands

```bash
npm test
node .claude/skills/skill-boilerplate/scripts/start.mjs --extension examples/blank/extension.mjs --out /tmp/session
node .claude/skills/skill-boilerplate/scripts/session.mjs next --out /tmp/session
node .claude/skills/skill-boilerplate/scripts/dashboard.mjs start --out /tmp/session --no-open
node .claude/skills/skill-boilerplate/scripts/refresh.mjs --extension examples/blank/extension.mjs --out /tmp/session
node install-agents.mjs
```

`npm test` is the parity suite. It checks that mode is asked before any network call, that the dashboard URL returns in under three seconds, and that docs are labeled fresh, stale, or failed.

Node.js 18 or newer.
