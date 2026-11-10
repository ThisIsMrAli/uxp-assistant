import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const skills = [
  { name: "uxp-assistant", target: path.join(repo, ".claude/skills/uxp-assistant") }
];

const projectAgents = [
  ".cursor/skills",
  ".agents/skills",
  ".windsurf/skills",
  ".codex/skills",
  ".gemini/skills",
  ".continue/skills",
  ".opencode/skills",
  ".qoder/skills",
  ".codebuddy/skills",
  ".factory/skills",
  ".kilocode/skills",
  ".trae/skills",
  ".antigravity/skills",
  ".kiro/skills",
  ".roo/skills",
  ".warp/skills",
  ".augment/skills",
  ".github/skills",
  ".amazonq/skills",
  ".kimi-code/skills",
  ".zcode/skills"
];

const globalAgents = [
  ".claude/skills",
  ".cursor/skills",
  ".agents/skills",
  ".codex/skills",
  ".gemini/skills",
  ".windsurf/skills",
  ".continue/skills",
  ".factory/skills",
  ".kiro/skills",
  ".kimi-code/skills",
  ".zcode/skills"
];

function linkSkill(parent, skillName, target, useRelative) {
  const dest = path.join(parent, skillName);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  let current = null;
  try {
    current = fs.lstatSync(dest);
  } catch {
    current = null;
  }
  if (current?.isSymbolicLink()) fs.unlinkSync(dest);
  else if (current) throw new Error(`${dest} already exists and is not a symlink.`);
  fs.symlinkSync(useRelative ? path.relative(path.dirname(dest), target) : target, dest);
}

for (const skill of skills) {
  if (!fs.existsSync(path.join(skill.target, "SKILL.md"))) {
    process.stderr.write(`Canonical skill is missing: ${skill.target}\n`);
    process.exit(1);
  }
  for (const agent of projectAgents) linkSkill(path.join(repo, agent), skill.name, skill.target, true);
  if (process.argv.includes("--global")) {
    for (const agent of globalAgents) linkSkill(path.join(os.homedir(), agent), skill.name, skill.target, false);
  }
}

process.stdout.write(`Linked ${skills.map((skill) => skill.name).join(" and ")} into ${projectAgents.length} project agent folders.\n`);
