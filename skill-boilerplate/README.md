# skill-boilerplate

A self-contained session workflow: one start command, a mode question, a loopback dashboard, and later decisions answered on that dashboard or in chat.

It is derived from express-addon-review 0.4.0. The MIT notice in `LICENSE` is that project's notice. Express-only review, listing, and audit code is not in this folder. This folder does not import any other project, so it can be moved into its own repository as it is.

The repository <https://github.com/ThisIsMrAli/skill-boilerplate> is private. This tree does not push to it. The owner moves this folder there separately.

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
