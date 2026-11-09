import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const canonical = path.join(repo, ".claude/skills/skill-boilerplate");
const skillName = "skill-boilerplate";
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

function linkSkill(parent) {
  const dest = path.join(parent, skillName);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  try {
    if (fs.lstatSync(dest).isSymbolicLink()) fs.unlinkSync(dest);
    else throw new Error(`${dest} already exists and is not a symlink.`);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  fs.symlinkSync(path.relative(path.dirname(dest), canonical), dest);
}

if (!fs.existsSync(path.join(canonical, "SKILL.md"))) {
  process.stderr.write(`Canonical skill is missing: ${canonical}\n`);
  process.exit(1);
}
for (const agent of projectAgents) linkSkill(path.join(repo, agent));
process.stdout.write(`Linked ${skillName} into ${projectAgents.length} project agent folders.\n`);
