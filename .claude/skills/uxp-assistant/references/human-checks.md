# Still needs a person

`check` builds, packages, type checks, runs the plugin's own tests, and reads the code against Adobe's saved docs. It never opens the Adobe app. A clean `check` is not a working plugin.

The try step puts the plugin in front of the developer. These are the things only they can judge or do, and they are not guessed here:

- Whether the panel does what the request meant, inside the Adobe app, on a real project.
- Behaviour that needs the host: the active project or document, selection, undo, a long operation, the host's own dialogs.
- Panel size and layout at the dock sizes they use, in light and dark host themes.
- A real file picker, clipboard, network call, or webview, with the permission prompt a user sees.
- Another host version than the one installed here. Read `docs/LIMITS.md` for what Adobe lists as unsupported, and `manifest.json` `host.minVersion`.
- Another operating system, if the plugin is shared.
- The marketplace listing, screenshots, and the publisher account. Ask; do not invent them.
- Signing or distributing the `.ccx`.

Do not write "works" in the summary for any of these. Write what was built, what `check` showed, whether the developer tried it and said there were no more bugs, and what was not covered.
