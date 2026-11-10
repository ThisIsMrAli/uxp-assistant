import fs from "node:fs";
import path from "node:path";
import { planAll } from "./lib/ask.mjs";
import { loadExtension } from "./lib/extension.mjs";
import { rememberOut } from "./lib/paths.mjs";
import { setMode, startSession } from "./lib/session.mjs";
import { pathToFileURL } from "node:url";

/**
 * Create the session and ask mode. This does not fetch docs.
 */
export async function startSkill({ extensionPath, out, input = "", kind = "empty", remote = false, extra = {} }) {
  const ext = await loadExtension(extensionPath);
  if (process.env.SKILL_HOME_NAME == null && ext.homeDirName) process.env.SKILL_HOME_NAME = ext.homeDirName;
  const prepared = ext.prepare ? await ext.prepare({ input, kind, ...extra }) : {};
  const answersFile = path.join(out, "answers.jsonl");
  const sessionFile = path.join(out, "session.json");
  if (fs.existsSync(sessionFile) && fs.existsSync(answersFile) && fs.readFileSync(answersFile, "utf8").trim()) {
    rememberOut(out);
    return {
      ok: true,
      out,
      kept: true,
      network: false,
      next: `Session already has answers. They were kept. Run session next --out ${out}.`
    };
  }
  const asked = ext.questions ? await ext.questions(prepared) : [];
  const questions = planAll(asked || []);
  fs.mkdirSync(out, { recursive: true });
  for (const [name, body] of Object.entries(prepared.files || {})) {
    fs.writeFileSync(path.join(out, path.basename(name)), typeof body === "string" ? body : `${JSON.stringify(body, null, 2)}\n`);
  }
  const report = {
    addon: prepared.name || ext.title || ext.id,
    addonPath: prepared.path || input || "",
    projectPath: prepared.path || input || "",
    findings: prepared.findings || [],
    skipped: prepared.skipped || [],
    docsSha: "",
    fetchedAt: "",
    steps: ext.steps,
    askSteps: ext.askSteps || {},
    extensionPath: extensionPath ? path.resolve(extensionPath) : ""
  };
  fs.writeFileSync(path.join(out, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(path.join(out, "questions.json"), `${JSON.stringify(questions, null, 2)}\n`);
  fs.writeFileSync(path.join(out, "report.md"), `# ${report.addon}\n\nSession started. Docs have not been fetched.\n`);
  startSession(out, report);
  rememberOut(out);
  if (remote) {
    setMode(out, "chat");
    return {
      ok: true,
      out,
      mode: "chat",
      remote: true,
      network: false,
      next: `This agent is not on the user's computer. Mode is chat. Run session next --out ${out} and do what it says. Do not open the dashboard. Do not end your turn.`
    };
  }
  return {
    ok: true,
    out,
    asked: "mode",
    network: false,
    questions: questions.map((item) => item.id),
    next: `Ask the mode question with AskQuestion, then run session mode --set dashboard|chat --out ${out}. Do not fetch docs before the dashboard is up. Do not end your turn.`
  };
}

const ranDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (ranDirectly) {
  const args = parse(process.argv.slice(2));
  startSkill({
    extensionPath: args.extension || process.env.SKILL_EXTENSION,
    out: args.out,
    input: args.input || "",
    kind: args.kind || "empty",
    remote: Boolean(args.remote),
    extra: args
  }).then((result) => {
    process.stdout.write(`${JSON.stringify(result)}\n`);
  }).catch((error) => {
    process.stdout.write(`${JSON.stringify({ ok: false, error: error.message })}\n`);
    process.exitCode = 1;
  });
}

function parse(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) parsed[key] = true;
    else {
      parsed[key] = value;
      i += 1;
    }
  }
  return parsed;
}
