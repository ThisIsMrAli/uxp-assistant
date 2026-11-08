import fs from "node:fs";
import path from "node:path";

export function buildContract({ intake, capability, projectPath, docs, kept, baseline, notes, runtime, design, preview, network }) {
  return {
    goal: intake.goal,
    state: capability.state,
    capability: capability.capability,
    fixture: capability.fixture,
    projectPath: projectPath || "",
    kind: intake.kind,
    framework: intake.framework || "",
    host: intake.host || "",
    os: intake.os,
    context: intake.context,
    name: intake.name,
    id: intake.id,
    docs: (docs || []).map((page) => ({
      id: page.id,
      url: page.url,
      freshness: page.freshness,
      revision: page.revision || ""
    })),
    evidence: capability.evidence || [],
    kept: kept || [],
    baseline: baseline || { files: {}, archives: [] },
    notes: notes || [],
    runtime: runtime || null,
    design: design || null,
    preview: preview || null,
    network: network || {
      origins: [],
      rejected: [],
      elevated: false,
      note: "No origins were classified. Network access was not elevated."
    },
    detail: capability.detail,
    unverified: [
      "The Adobe host was not executed.",
      "Command success is not feature correctness.",
      "Source and behavior review is still pending.",
      "A documented name in fresh pages is not semantic proof of the implementation."
    ],
    doNot: [
      "Do not replace the goal text.",
      "Do not apply the selected-layer rename fixture unless fixture is selected-layer-rename and the goal is still that rename.",
      "Do not invent a host API that is absent from the evidence.",
      "Do not treat a WebView shim or a browser preview as the host.",
      "A page that lists copied headings and buttons is a source-text preview plus mocks. It is not a UXP UI preview.",
      "Hashed files are the scripts and the local code imports of vite and uxp config. JSON, packages, and node builtins are outside that set. Process and eval in a hashed file are refused. That is not a sandbox.",
      "Do not mark tests, package, or the feature done without a real command result or real files.",
      "Do not claim the Adobe host executed.",
      "Do not write classified origins into requiredPermissions. Recording an origin does not grant network access."
    ],
    handoff: capability.state === "awaiting-agent-implementation"
      ? "The invoking assistant writes this goal in the project using design-constraints.md and the chosen runtime, then records agent-result.json with the files that changed. A stock file or a no-op test is not the feature. A browser preview is not the host. The skill keeps the real command exits and does not treat them as semantic proof."
      : capability.state === "unknown"
        ? "Pause. Name the host API or refresh the page that should document it, then continue. Do not invent the call, do not swap in the rename fixture, and do not mark the feature done."
        : capability.state === "docs-incomplete"
          ? "Refresh the pages that are failed or stale before writing feature code. A failed fetch is not fresh and is not a reason to implement from memory."
          : "Do not write feature code for this state."
  };
}

export function writeContractFiles(project, contract) {
  if (!project) return;
  fs.mkdirSync(project, { recursive: true });
  fs.writeFileSync(path.join(project, "implementation-contract.json"), `${JSON.stringify(contract, null, 2)}\n`);
  const lines = [
    "# Implementation handoff",
    "",
    `Goal: ${contract.goal}`,
    "",
    `State: ${contract.state}`,
    "",
    `Capability: ${contract.capability}`,
    "",
    `Fixture: ${contract.fixture || "none"}`,
    "",
    contract.detail,
    "",
    "## Evidence",
    "",
    ...(contract.evidence.length ? contract.evidence.map((item) => `- ${item.id}: ${item.quote}`) : ["- No fresh evidence."]),
    "",
    "## Docs",
    "",
    ...contract.docs.map((page) => `- ${page.id} ${page.freshness} ${page.url}`),
    "",
    "## Do not",
    "",
    ...contract.doNot.map((item) => `- ${item}`),
    "",
    contract.handoff,
    ""
  ];
  fs.writeFileSync(path.join(project, "IMPLEMENT.md"), lines.join("\n"));
}

export function goalWasReplaced(contract, filesText) {
  if (contract?.fixture === "selected-layer-rename") return false;
  if (/rename/i.test(contract?.goal || "")) return false;
  return /Rename selected layers|previewRename|function padNumber/.test(filesText);
}
