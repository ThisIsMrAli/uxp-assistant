# Run this tree on the machine that has it

This folder is the skill source. It does not include `.git`, `node_modules`, or a secret. The manifest beside the archive names the source commit. A browser result on this machine is not a result from another machine, and it is not Photoshop or Premiere.

## Setup

From the extracted directory:

```
npm ci
```

`npm ci` is the package install. It uses the lockfile and reaches the package registry. Do not publish the package.

## Tests

```
node box/run.mjs
```

That runs the fixture checks, including the command-approval graph. It does not call a model, does not checkout git, and does not launch an Adobe app.

Real setup, build, and package, still without a browser:

```
node box/run.mjs --acceptance
```

That command installs the maintained Bolt starter, fetches the official docs, and builds the package on this machine. It needs network access. It is not a browser render and not a host pass. The byte and revision manifest beside the archive stays the source binding.

On this same machine, optional browser checks:

```
node box/run.mjs --dashboard
node box/run.mjs --preview
```

Those use a local Chrome, Edge, or Chromium. They are this machine's render. They are not a host pass.

## Dashboard

```
node .claude/skills/uxp-assistant/scripts/dashboard.mjs start --out <session-dir>
node .claude/skills/uxp-assistant/scripts/dashboard.mjs stop --out <session-dir>
```

The session directory is the one `assist` wrote. Stop the dashboard when you are done so the loopback process is not left running.

## Build and package

Inside a generated plugin, use the `build` and `ccx` scripts that the handoff recorded. A changed script body is not run until the session `script-change` question is answered for those exact commands and file hashes.

## Cleanup

Stop the dashboard with the command above. Remove the extracted directory when the check is finished. Do not start Photoshop or Premiere from these commands. Host execution stays NOT TESTED unless you launch the app yourself.
