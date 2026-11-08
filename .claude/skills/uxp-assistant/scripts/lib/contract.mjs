import fs from "node:fs";
import path from "node:path";

export function buildContract({ intake, capability, projectPath, docs, kept }) {
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
    detail: capability.detail,
    doNot: [
      "Do not replace the goal text.",
      "Do not apply the selected-layer rename fixture unless fixture is selected-layer-rename and the goal is still that rename.",
      "Do not invent a host API that is absent from the evidence.",
      "Do not treat a WebView shim or a browser preview as the host.",
      "Do not mark tests, package, or the feature done without a real command result or real files.",
      "Do not claim the Adobe host executed."
    ],
    handoff: capability.state === "awaiting-agent-implementation"
      ? "The invoking assistant writes the feature in this project, then records agent-result.json. The skill runs the project's test, build, and ccx scripts and keeps their exit codes."
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
  if (contract.fixture === "selected-layer-rename") return false;
  if (!/rename/i.test(contract.goal) && /Rename selected layers/.test(filesText)) return true;
  return false;
}
