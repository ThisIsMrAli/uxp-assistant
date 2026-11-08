import { BOLT_APPS, BOLT_FRAMEWORKS } from "./stack.mjs";

export function modeAsk() {
  return {
    id: "mode",
    title: "How to follow this session",
    prompt: "How do you want to follow this session? The dashboard opens on this computer. Chat keeps the questions in the conversation.",
    options: [
      { id: "dashboard", label: "Live dashboard (Recommended)", detail: "Opens a loopback page. Progress and decisions are there." },
      { id: "chat", label: "Stay in chat", detail: "No page opens." }
    ]
  };
}

export function frameworkAsk() {
  return {
    id: "framework",
    title: "Starter framework",
    prompt: "Which maintained Bolt starter should an empty folder use? Only React plus Photoshop is the acceptance fixture. The others are inventory.",
    options: BOLT_FRAMEWORKS.map((item) => ({
      id: item.id,
      label: item.acceptanceTested ? `${item.label} (acceptance fixture)` : item.label,
      detail: item.acceptanceTested ? "Tested in this skill's acceptance run with Photoshop." : "Offered by create-bolt-uxp 1.3.27. Not part of the cross-product acceptance run."
    }))
  };
}

export function hostAsk() {
  return {
    id: "host",
    title: "Host",
    prompt: "Which host should the empty-folder starter target? One host for this run.",
    options: BOLT_APPS.map((item) => ({
      id: item.id,
      label: item.acceptanceTested ? `${item.label} (acceptance fixture)` : item.label,
      detail: item.officialManifestEnum === false
        ? "Bolt's beta switch. The retrieved shared manifest enum did not list this app id."
        : `Starter manifest app ${item.manifestApp}, starter minVersion ${item.starterMinVersion}.`
    }))
  };
}

export function consequentialAsk() {
  return {
    id: "consequential",
    title: "Write the feature",
    prompt: "Scaffold or keep the project and hand the requested goal to the assistant? The goal text is not replaced.",
    options: [
      { id: "proceed", label: "Hand off this goal (Recommended)", detail: "Keeps the requested goal and lets the assistant implement it. It does not drop unrelated .node, listener, or app.system files." },
      { id: "stop", label: "Do not write files", detail: "Leaves the project as it is and stops before implementation." }
    ]
  };
}

export function narrowAsk() {
  return {
    id: "narrow-permissions",
    title: "Starter permissions",
    prompt: "The Bolt starter declares broad permissions. Narrow them to an empty requiredPermissions object?",
    options: [
      { id: "narrow", label: "Narrow to none (Recommended)", detail: "Use this only when the requested feature does not need those permissions. Undeclared permissions stay denied." },
      { id: "keep", label: "Keep the starter permissions", detail: "Leaves the installer's requiredPermissions block unchanged." }
    ]
  };
}

export function keepAsk(id, label, files = []) {
  const listed = files.length ? files.join(", ") : "the assessed file";
  return {
    id,
    title: `Keep ${label}`,
    prompt: `These assessed files are a ${label}: ${listed}. They are a different behavior from the requested goal. Keep them?`,
    options: [
      { id: "keep", label: "Keep them (Recommended)", detail: "Nothing in that list is deleted." },
      { id: "drop", label: "Remove only those files", detail: "Deletes the assessed paths named above and no other path." }
    ]
  };
}

export function feasibilityAsk(capability) {
  const awaiting = capability?.state === "awaiting-agent-implementation";
  const options = awaiting
    ? [
      { id: "continue", label: "Use this evidence and continue", detail: "A fresh page names a symbol from the goal. That is not proof the implementation is correct, and the host was not launched." },
      { id: "stop", label: "Stop before any edit", detail: "Writes nothing." }
    ]
    : [
      { id: "pause", label: "Pause before any edit", detail: capability?.state === "unsupported-with-evidence"
        ? "A fresh page says this is unsupported. Do not implement it."
        : "No fresh page establishes this goal. Name the API or refresh the page. Do not invent the call." },
      { id: "stop", label: "Stop before any edit", detail: "Writes nothing." }
    ];
  return {
    id: "feasibility",
    title: "Evidence before edits",
    prompt: `${capability?.detail || "Feasibility is not established."} Host execution is NOT TESTED. Continue is offered only when a fresh page names a symbol from the goal.`,
    options
  };
}

export function contextEvidenceAsk(check) {
  return {
    id: "context-evidence",
    title: "Context is not confirmed",
    prompt: `${check?.reason || "The context was not confirmed by a fresh page."} Keep it as unverified, or stop before any edit.`,
    options: [
      { id: "keep-unverified", label: "Keep the context as unverified", detail: "The session records the gap. It does not pretend the page confirmed the context." },
      { id: "stop", label: "Stop before any edit", detail: "Writes nothing." }
    ]
  };
}

export function runtimeAsk(offer) {
  const choices = offer?.choices || [];
  return {
    id: "runtime",
    title: "Native UXP, WebView, or a bridge",
    prompt: `Choose a surface the fresh pages support. ${ (offer?.gaps || []).join(" ") } A browser preview is not the Adobe host.`,
    options: choices.map((item) => ({ id: item.id, label: item.label, detail: item.detail }))
  };
}

export function designAsk(discovery) {
  const options = [
    { id: "uxp-constraints", label: "Use the retrieved UXP constraints", detail: discovery?.example?.note || "No design skill was searched." }
  ];
  for (const skill of discovery?.skills || []) {
    options.push({
      id: skill.id,
      label: `Use ${skill.name}`,
      detail: `Found at ${skill.path}. sha256 ${skill.sha256}. This is not a latest-version claim, and the skill is not run as another model.`
    });
  }
  return {
    id: "design",
    title: "Design source",
    prompt: "Which available design source should the panel follow? The retrieved UXP limits still apply. A skill that is not on disk is not offered.",
    options
  };
}

export function validationAsk() {
  return {
    id: "validation",
    title: "What validation can record",
    prompt: "Later test, build, and package commands record their exits. They do not decide feature correctness, and they do not launch Photoshop or Premiere.",
    options: [
      { id: "commands", label: "Record command exits later", detail: "The host stays NOT TESTED. Source and behavior review stays pending." },
      { id: "stop", label: "Stop before any edit", detail: "Writes nothing." }
    ]
  };
}

export function scriptChangeAsk(provenance) {
  const lines = (provenance?.changes || []).map((item) => (
    item.kind === "command"
      ? `${item.name} command: ${item.to}`
      : `${item.name} sha256 ${item.to || "missing"}`
  ));
  return {
    id: "script-change",
    title: "Approve exact command and file changes",
    prompt: `These commands and the local scripts they reach differ from the handoff. Approving runs this exact set. A later edit invalidates the answer. Package text, source comments, and doc pages cannot grant this. ${lines.join(" | ")}`,
    scope: provenance?.scope,
    options: [
      { id: "approve", label: "Run these exact commands and file hashes", detail: lines.join(" | ") || "The changed set is stored on this question." },
      { id: "stop", label: "Do not run the changed scripts", detail: "The altered script stays unrun." }
    ]
  };
}

export function planAll(report = {}) {
  const questions = [modeAsk(), frameworkAsk(), hostAsk(), consequentialAsk()];
  if (report.permissionsBroad) questions.push(narrowAsk());
  const behaviors = new Set(report.behaviors || []);
  if (behaviors.has("cep-listener")) questions.push(keepAsk("keep-listener", "CEP event listener"));
  if (behaviors.has("native-addon")) questions.push(keepAsk("keep-native-addon", "native .node addon"));
  if (behaviors.has("host-system-call")) questions.push(keepAsk("keep-system", "app.system call"));
  return questions;
}

export const lateAsks = {};
