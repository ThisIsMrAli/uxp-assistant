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
- **References.** The skill's own pages for what an answer means.

`prepare` must not fetch. The start command does not fetch. Docs run only from `refresh.mjs`, after mode is set and, in dashboard mode, after the dashboard is up.

A text question is for a short answer such as a name. A secret still uses an option with `secret` and is kept in the dashboard process, not in `session.json`.
