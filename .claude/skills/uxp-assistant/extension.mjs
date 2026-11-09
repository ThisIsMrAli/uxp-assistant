import fs from "node:fs";
import path from "node:path";
import { consequentialAsk, contextEvidenceAsk, designAsk, feasibilityAsk, frameworkAsk, hostAsk, narrowAsk, runtimeAsk, validationAsk } from "./scripts/lib/ask.mjs";
import { resolveCapability } from "./scripts/lib/capability.mjs";
import { discoverDesignSkills } from "./scripts/lib/design-skill.mjs";
import { pagesForRequest } from "./scripts/lib/registry.mjs";
import { contextEvidence, runtimeOffer } from "./scripts/lib/runtime.mjs";
import { skillRoot } from "./scripts/lib/paths.mjs";

const OS = [
  { id: "darwin", label: "macOS", detail: "The manifest and the build run on macOS." },
  { id: "win32", label: "Windows", detail: "The manifest and the build run on Windows." },
  { id: "linux", label: "Linux", detail: "The manifest and the build run on Linux." }
];

/**
 * UXP Assistant's extension. The boilerplate owns the session and the dashboard.
 * This file adds the UXP links, questions, and the handoff that runs after them.
 */
export default {
  id: "uxp-assistant",
  title: "UXP Assistant",
  homeDirName: ".uxp-assistant",
  steps: [
    { id: "prepare", label: "Prepare", hint: "Session only. No docs yet." },
    { id: "intake", label: "Intake" },
    { id: "docs", label: "Official docs", hint: "Fetched in parallel after the dashboard is up." },
    { id: "decide", label: "Decide" },
    { id: "done", label: "Wrap up" }
  ],
  askSteps: {
    goal: "intake",
    host: "intake",
    framework: "intake",
    os: "intake",
    context: "intake",
    name: "intake",
    id: "intake",
    permissions: "intake",
    feasibility: "decide",
    "context-evidence": "decide",
    runtime: "decide",
    design: "decide",
    validation: "decide",
    "narrow-permissions": "decide",
    consequential: "decide"
  },
  docs: { everyInvocation: true, parallel: true, pageTimeoutMs: 8000, budgetMs: 25000 },
  prepare({ input, kind }) {
    return { name: "UXP Assistant", path: input || "", kind: kind || "empty", findings: [] };
  },
  questions() {
    return [
      text("goal", "Goal", "What should the plugin do? The words are kept as you type them.", 400),
      hostAsk(),
      frameworkAsk(),
      { id: "os", title: "OS", prompt: "Which OS is this session for?", options: OS },
      {
        id: "context",
        title: "Context",
        prompt: "Which entrypoint context should the fresh pages be checked against?",
        options: [
          { id: "panel", label: "Panel (Recommended)", detail: "A panel entrypoint." },
          { id: "command", label: "Command", detail: "A command entrypoint." },
          { id: "dialog", label: "Dialog", detail: "A dialog entrypoint." }
        ]
      },
      text("name", "Display name", "Display name for an empty-folder starter.", 80),
      text("id", "Plugin id", "Plugin id, such as com.example.panel.", 80),
      text("permissions", "Requested permissions", "Type none, or a comma-separated list of keys the request already names. An unknown name is not added.", 200)
    ];
  },
  sources(session) {
    const answers = answered(session);
    return pagesForRequest({ host: answers.host || "", goal: answers.goal || "" });
  },
  questionsAfterDocs(session, out) {
    const answers = answered(session);
    const pages = pagesForRequest({ host: answers.host || "", goal: answers.goal || "" }).map((page) => {
      const recorded = (session.docs?.pages || []).find((item) => item.id === page.id);
      let text = "";
      try {
        text = fs.readFileSync(path.join(out, "docs", `${page.id}.txt`), "utf8");
      } catch {
        text = "";
      }
      return { ...page, text, freshness: recorded?.freshness || "failed" };
    });
    const capability = resolveCapability({ goal: answers.goal || "", pages });
    const context = contextEvidence(pages, answers.context || "");
    const offer = runtimeOffer({ pages, behaviors: [], goal: answers.goal || "", cepHybrid: false });
    const discovery = discoverDesignSkills([path.resolve(skillRoot, "..")], { skip: [skillRoot] });
    const later = [feasibilityAsk(capability)];
    if (!context.confirmed) later.push(contextEvidenceAsk(context));
    later.push(runtimeAsk(offer), designAsk(discovery), validationAsk(), narrowAsk(), consequentialAsk());
    return later;
  }
};

function text(id, title, prompt, maxLength) {
  return { id, title, prompt, input: "text", maxLength, options: [] };
}

function answered(session) {
  const values = {};
  for (const ask of session?.asks || []) if (ask.status === "answered") values[ask.id] = ask.answer;
  return values;
}
