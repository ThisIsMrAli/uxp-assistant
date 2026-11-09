/** Example extension. A skill copies this shape and fills in its own links, rules, steps, and questions. */
export default {
  id: "blank",
  title: "Blank skill",
  homeDirName: ".skill-boilerplate",
  steps: [
    { id: "prepare", label: "Prepare", hint: "No network." },
    { id: "docs", label: "Docs", hint: "Fetched after the dashboard is up." },
    { id: "decide", label: "Decide" },
    { id: "done", label: "Wrap up" }
  ],
  askSteps: { sample: "decide", goal: "decide" },
  docs: { everyInvocation: true, parallel: true, pageTimeoutMs: 8000, budgetMs: 20000 },
  prepare() {
    return { name: "Blank", path: "", findings: [] };
  },
  questions() {
    return [
      {
        id: "goal",
        title: "Goal",
        prompt: "What should this session do?",
        input: "text",
        maxLength: 200,
        options: []
      },
      {
        id: "sample",
        title: "Continue",
        prompt: "Continue this session?",
        options: [
          { id: "yes", label: "Yes (Recommended)", detail: "Continues." },
          { id: "stop", label: "Stop", detail: "Stops before any write." }
        ]
      }
    ];
  },
  sources() {
    return [{ id: "example", url: "https://example.com/" }];
  }
};
