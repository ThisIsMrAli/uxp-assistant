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
