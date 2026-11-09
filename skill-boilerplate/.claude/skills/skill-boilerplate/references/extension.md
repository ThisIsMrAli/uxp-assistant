# Extension

A skill is one module. The boilerplate loads it. The skill does not import the boilerplate's `scripts/` or `assets/` files. It imports `api.mjs` only.

```javascript
export default {
  id: "example",
  title: "Example",
  homeDirName: ".example-skill",
  steps: [
    { id: "prepare", label: "Prepare" },
    { id: "docs", label: "Docs" },
    { id: "decide", label: "Decide" },
    { id: "done", label: "Wrap up" }
  ],
  askSteps: { "my-choice": "decide" },
  docs: { everyInvocation: true, parallel: true, pageTimeoutMs: 8000, budgetMs: 20000 },
  prepare({ input, kind }) {
    return { name: "Example", path: input, findings: [] };
  },
  questions() {
    return [{
      id: "my-choice",
      title: "Next step",
      prompt: "Continue?",
      options: [
        { id: "yes", label: "Yes (Recommended)", detail: "Continues." },
        { id: "stop", label: "Stop", detail: "Stops." }
      ]
    }];
  },
  sources(session) {
    return [{ id: "guide", url: "https://example.com/guide" }];
  }
};
```

The skill adds only these:

- **Doc links.** `sources(session)` returns `{ id, url }`. The boilerplate fetches them. It does not know the skill's sites.
- **Rules.** A `references/custom-rules.md` in the skill. The boilerplate does not read it. The skill's own instructions do.
- **Steps.** `steps`, including `done`. `askSteps` maps a question id to a step id.
- **Questions.** `questions()` returns the decisions after `mode`. `mode` is added by the boilerplate. A question may set `input: "text"` and `maxLength` when the answer is not one of a fixed list.
- **Questions after docs.** `questionsAfterDocs(session, out)` runs after a refresh. `session` is the merged session, including `docs`. `out` is the session folder. Page text is in `out/docs/<id>.txt`. Return more questions. The boilerplate appends ids that are not already in `questions.json`. Omit the hook when the skill has no later questions.
- **References.** The skill's own pages for what an answer means.

`prepare` must not fetch. The start command does not fetch. Docs run only from `refresh.mjs`, after mode is set and, in dashboard mode, after the dashboard is up.

`docs.everyInvocation` is read. `true` fetches on every refresh. `false` reuses `docs/summary.json` when that file is already there and does not fetch. A missing summary is fetched either way. Leave it `true` when a later session must not treat an old download as fresh.

The dashboard shows Findings, Notes, Details, and Captures only when the session has them. `prepare().findings` fills Findings. Notes or an audit fill Notes. A listing fills Details. Panel shots fill Captures. An extension that leaves those empty shows the workflow, the decision, and the activity log.

A text question is for a short answer such as a name. A secret still uses an option with `secret` and is kept in the dashboard process, not in `session.json`.
