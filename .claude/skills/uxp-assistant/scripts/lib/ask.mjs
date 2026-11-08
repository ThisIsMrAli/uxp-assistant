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

export function keepAsk(id, label) {
  return {
    id,
    title: `Keep ${label}`,
    prompt: `The project has a ${label}. It is a different behavior from the requested goal. Keep the file?`,
    options: [
      { id: "keep", label: "Keep it (Recommended)", detail: "The file stays. The recipe does not claim to replace this behavior." },
      { id: "drop", label: "Remove it", detail: "Deletes that file. This is a separate decision from implementing the rename." }
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
