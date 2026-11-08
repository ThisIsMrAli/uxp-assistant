import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/**
 * Discover design skills that are actually on disk.
 * UI UX Pro Max is a name to look for. Absence is not a version claim.
 * This module does not call a model.
 */

const EXAMPLE = ["ui-ux-pro-max", "ui ux pro max"];

export function discoverDesignSkills(roots = [], { skip = [] } = {}) {
  const skills = [];
  const unsuitable = [];
  const searched = [];
  const skipped = skip.map((item) => path.resolve(item));
  for (const root of roots) {
    if (!root || !fs.existsSync(root)) {
      searched.push({ root: root || "", status: "missing" });
      continue;
    }
    searched.push({ root, status: "read" });
    walk(root, 0, (file) => {
      if (skipped.some((prefix) => file === prefix || file.startsWith(`${prefix}${path.sep}`))) return;
      const text = fs.readFileSync(file, "utf8");
      const name = frontName(text) || path.basename(path.dirname(file));
      const record = {
        id: slug(name),
        name,
        path: file,
        sha256: crypto.createHash("sha256").update(text).digest("hex")
      };
      const reason = unsuitableReason(text);
      if (reason) unsuitable.push({ ...record, reason });
      else skills.push(record);
    });
  }
  const proMax = [...skills, ...unsuitable].find((item) => EXAMPLE.some((name) => item.name.toLowerCase().includes(name) || item.id.includes("ui-ux-pro-max")));
  return {
    searched,
    skills,
    unsuitable,
    example: {
      name: "UI UX Pro Max",
      found: Boolean(proMax),
      path: proMax?.path || "",
      note: proMax
        ? "The example name was found at the path above. This is not a claim that it is the latest version."
        : "UI UX Pro Max was not in the searched directories. The name is an example, not an installed skill, and this result says nothing about a latest version."
    }
  };
}

export function writeDesignConstraints({ runtime, discovery, limits, contextNote }) {
  const lines = [
    "# Design constraints",
    "",
    "Source and behavior review is still pending. The Adobe host was NOT TESTED.",
    "",
    `Runtime choice: ${runtime}`,
    "",
    contextNote || "Context evidence is recorded on the contract.",
    "",
    "## Retrieved UXP limits",
    ""
  ];
  if (limits?.length) {
    for (const limit of limits) {
      const quote = typeof limit === "string" ? limit : limit.quote;
      const page = limit.page ? ` (${limit.page})` : "";
      lines.push(`- Fresh page text${page}: ${quote}`);
    }
  } else {
    lines.push("- The fresh pages did not contain the transition or text-transform sentences this checker looks for. Those sentences were not invented.");
  }
  lines.push("", "## How the choice uses those limits", "");
  if (runtime === "webview") {
    lines.push("The WebView element can host a separate web document. The limits above apply to the UXP panel around it. This checker did not find a sentence that exempts the embedded document, so none is claimed. window.uxpHost remains a bridge shim.");
  } else if (runtime === "hybrid") {
    lines.push("A native bridge was assessed. The limits above still apply to the UXP panel. The bridge was not executed, and choosing hybrid does not add an API the pages did not document.");
  } else {
    lines.push("Native UXP panel DOM and CSS are the surface. Use the retrieved limits above in that panel. Do not treat a browser simulation as the host.");
  }
  lines.push("", "## Design skill discovery", "", discovery?.example?.note || "No design-skill search was recorded.");
  if (discovery?.skills?.length) {
    lines.push("", "Suitable skills on disk:");
    for (const skill of discovery.skills) lines.push(`- ${skill.name} (${skill.path}), sha256 ${skill.sha256}`);
  } else {
    lines.push("", "No suitable design skill was found in the searched directories. The implementation uses these retrieved UXP constraints.");
  }
  return `${lines.join("\n")}\n`;
}

function walk(dir, depth, visit) {
  if (depth > 4) return;
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === ".git") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, depth + 1, visit);
    else if (entry.name === "SKILL.md") visit(full);
  }
}

function frontName(text) {
  const match = String(text).match(/^---\n[\s\S]*?^name:\s*["']?([^"'\n]+)["']?/m);
  return match ? match[1].trim() : "";
}

function unsuitableReason(text) {
  const body = String(text);
  if (!/design|user interface|\bUI\b|\bUX\b|layout|visual/i.test(body)) return "The file does not describe a design or UI skill.";
  if (/auxiliary model|call Claude|call GPT|use Gemini/i.test(body)) return "The skill tells the reader to call another model.";
  return "";
}

function slug(name) {
  return String(name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "design-skill";
}
