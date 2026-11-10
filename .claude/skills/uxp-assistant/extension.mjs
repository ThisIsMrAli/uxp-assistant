import { planSummary } from "./scripts/lib/flow.mjs";
import { makePlan } from "./scripts/lib/intent.mjs";
import { planningQuestions } from "./scripts/lib/planning.mjs";
import { BOLT_APPS } from "./scripts/lib/stack.mjs";

/**
 * UXP Assistant's extension. scripts/runtime owns the session and the dashboard.
 * This file says what the steps are, what runs in each, and the one card the developer sees.
 *
 * mode -> the questions the request did not answer -> the spec card, which the person must confirm
 * then docs, build, implement, check run without asking anything.
 * After check the developer tries the plugin in the Adobe app and sends bugs (words and screenshots) until there are none.
 */
export default {
  id: "uxp-assistant",
  title: "UXP Assistant",
  homeDirName: ".uxp-assistant",
  steps: [
    { id: "prepare", label: "Prepare", hint: "Reads your request. No network." },
    { id: "planning", label: "Planning", hint: "The questions the request did not answer." },
    { id: "plan", label: "Plan", hint: "Confirm the spec, then the build starts." },
    {
      id: "docs",
      label: "Adobe docs",
      hint: "Every page Adobe lists for your app, saved on this computer.",
      command: "node scripts/skill.mjs docs",
      say: "Save Adobe's current docs for the plan's app. It takes about ten seconds and needs no question."
    },
    {
      id: "build",
      label: "Project",
      hint: "Creates the project and narrows its permissions.",
      command: "node scripts/skill.mjs build",
      say: "Create the project. The first run installs the pinned scaffold tool, about twenty seconds."
    },
    {
      id: "implement",
      label: "Write the plugin",
      hint: "The assistant writes the code from the brief.",
      say: "Read {out}/BRIEF.md, then write the whole plugin in {project}/src. Use `node scripts/skill.mjs find <words>` before every host API call. Do not ask the developer anything. When the code is written, run `{check}`."
    },
    {
      id: "check",
      label: "Build and check",
      hint: "Builds, packages, and reads the code against the saved docs.",
      command: "node scripts/skill.mjs check",
      say: "Build, package, and check the plugin. Fix every error it lists, then run it again until it says ok."
    },
    {
      id: "try",
      label: "Try it",
      hint: "You load it in the Adobe app and send what is wrong, with words and screenshots. The assistant fixes it and asks again until you say no more bugs.",
      command: "node scripts/skill.mjs feedback",
      say: "Publish the try card for the developer. Then wait for the answer. If no person is there (a background or cloud run), run it with --skip."
    },
    { id: "done", label: "Wrap up" }
  ],
  askSteps: {
    host: "planning",
    goal: "planning",
    name: "planning",
    description: "planning",
    runtime: "planning",
    widgets: "planning",
    design: "planning",
    designNote: "planning",
    "feat-output": "planning",
    "feat-scope": "planning",
    blocked: "planning",
    blockedGoal: "planning",
    plan: "plan",
    tweak: "plan",
    feedback: "try"
  },
  prepare({ input, kind, project, goal, host, framework, name, id, runtime }) {
    const plan = makePlan({ goal, kind, input, project, flags: { host, framework, name, id, runtime } });
    return {
      name: plan.name,
      path: kind === "existing" ? project || input || "" : input || "",
      kind,
      plan,
      findings: [],
      files: { "plan.json": plan }
    };
  },
  questions(prepared) {
    const plan = prepared.plan;
    const questions = [];
    if (!plan.host) {
      questions.push({
        id: "host",
        title: "Which Adobe app?",
        kicker: "The app",
        prompt: "Which Adobe app opens this panel? The request did not name one. Nothing is assumed.",
        options: BOLT_APPS.map((app, index) => ({ id: app.id, label: `${app.label.replace(/\s*\(Beta\)$/, "")}${index === 0 ? " (Recommended)" : ""}`, detail: app.beta ? "Beta in the scaffold tool." : "" }))
      });
    }
    questions.push(...planningQuestions(plan));
    questions.push({
      id: "plan",
      title: "Confirm the spec",
      kicker: "Before anything is created",
      prompt: planSummary(plan),
      options: [
        { id: "build", label: "Build it (Recommended)", detail: "Saves the docs, builds the plugin, then asks you to try it in the Adobe app." },
        { id: "change", label: "Change something", detail: "Say what to change: name, Adobe app, framework, permissions, or folder." },
        { id: "stop", label: "Stop", detail: "Ends the session. Nothing is created.", ends: true }
      ]
    });
    questions.push({
      id: "tweak",
      title: "What to change",
      prompt: "What should be different? Plain words are fine, for example: use Photoshop, name it Fast QR, use Vue, needs network, put it in /Users/me/plugins.",
      input: "text",
      maxLength: 300,
      options: [],
      when: { plan: "change" }
    });
    return questions;
  }
};
