import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { runFeedback } from "../.claude/skills/uxp-assistant/scripts/lib/feedback.mjs";
import { projectPath, resolvePlan, runBuild, runCheck, runDocs, writeBrief } from "../.claude/skills/uxp-assistant/scripts/lib/flow.mjs";
import { makePlan } from "../.claude/skills/uxp-assistant/scripts/lib/intent.mjs";
import { nextAction } from "../.claude/skills/uxp-assistant/scripts/runtime/lib/next.mjs";
import { finish, readMerged } from "../.claude/skills/uxp-assistant/scripts/runtime/lib/session.mjs";
import { session, start } from "../.claude/skills/uxp-assistant/scripts/runtime/api.mjs";
import { fakeAdobe } from "./fixtures/fake-adobe.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const extensionPath = path.join(root, ".claude/skills/uxp-assistant/extension.mjs");
const bins = { sessionBin: "node scripts/skill.mjs session", dashboardBin: "node scripts/skill.mjs dashboard" };
const QR = "create a plugin that create high quality qr codes in premiere";

const made = [];
function temp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "uxp-flow-"));
  made.push(dir);
  return dir;
}
process.on("exit", () => made.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));

async function begin(goal = QR, extra = {}) {
  const out = path.join(temp(), "session");
  const work = temp();
  const ctx = { extensionPath, out, ...bins };
  await start({ ...ctx, input: work, kind: "empty", extra: { goal, ...extra } });
  await session(["mode", "--set", "chat", "--out", out], ctx);
  return { out, work, ctx };
}

async function answer(ctx, id, value) {
  await session(["ask", "--id", id, "--out", ctx.out], ctx);
  await session(["answer", "--id", id, "--value", value, "--out", ctx.out], ctx);
}

/** Answer the planning questions with the recommended option, then the confirm card. */
async function confirm(ctx, choice = "build") {
  for (let i = 0; i < 10; i += 1) {
    const action = nextAction(ctx.out);
    if (action.action !== "ask" && action.action !== "ask-in-chat") return action;
    if (action.ask === "plan") {
      await answer(ctx, "plan", choice);
      return nextAction(ctx.out);
    }
    const questions = JSON.parse(fs.readFileSync(path.join(ctx.out, "questions.json"), "utf8"));
    const question = questions.find((item) => item.id === action.ask);
    const value = question?.input === "text" ? "A useful panel." : question.options[0].id;
    await answer(ctx, action.ask, value);
  }
  throw new Error("the confirm card never arrived");
}

/** A stand-in for create-bolt-uxp: the files the starter writes that the flow reads. */
async function scaffoldImpl(parent, plan) {
  const dir = plan.inPlace ? parent : path.join(parent, path.basename(projectPath(plan)));
  fs.mkdirSync(path.join(dir, "src"), { recursive: true });
  fs.writeFileSync(path.join(dir, "uxp.config.ts"), `export const id = "${plan.id}";\nconst manifest = {\n  manifestVersion: 5,\n  requiredPermissions: {\n    localFileSystem: "fullAccess",\n    network: { domains: ["ws://localhost:8080"] },\n    clipboard: "readAndWrite",\n    webview: { allow: "yes", domains: "all" },\n  },\n};\n`);
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ scripts: { build: "vite build", ccx: "vite build" } }));
  fs.writeFileSync(path.join(dir, "index.html"), "<div id=root></div>");
  fs.writeFileSync(path.join(dir, "src", "main.tsx"), "export const App = () => null;\n");
  return { folder: dir };
}
const installImpl = () => ({ status: 0, stdout: "", stderr: "" });

/** Build and ccx succeed; ccx writes the file the packager looks for. */
function runner(project) {
  return (command, args, options) => {
    if (args.includes("ccx")) {
      fs.mkdirSync(path.join(options.cwd, "ccx"), { recursive: true });
      fs.writeFileSync(path.join(options.cwd, "ccx", "x.ccx"), "zip");
    }
    if (args.includes("build")) {
      fs.mkdirSync(path.join(options.cwd, "dist"), { recursive: true });
      fs.writeFileSync(path.join(options.cwd, "dist", "manifest.json"), JSON.stringify({ id: "x", main: "index.html", entrypoints: [{ type: "panel", id: "p" }] }));
      fs.writeFileSync(path.join(options.cwd, "dist", "index.html"), "x");
    }
    void project;
    return { status: 0, stdout: "ok", stderr: "" };
  };
}

test("the plan is read from the request and written to the session, so no later step asks for it again", async () => {
  const { out, work } = await begin();
  const plan = JSON.parse(fs.readFileSync(path.join(out, "plan.json"), "utf8"));
  assert.equal(plan.host, "ppro");
  assert.equal(plan.name, "QR Codes");
  assert.equal(projectPath(plan), work, "an empty folder is the project");
  const questions = JSON.parse(fs.readFileSync(path.join(out, "questions.json"), "utf8")).map((item) => item.id);
  assert.deepEqual(questions, ["mode", "runtime", "widgets", "design", "designNote", "feat-output", "plan", "tweak"]);
  const card = JSON.parse(fs.readFileSync(path.join(out, "questions.json"), "utf8")).find((item) => item.id === "plan");
  assert.match(card.prompt, /Premiere Pro panel "QR Codes"/);
  assert.deepEqual(card.options.map((item) => item.id), ["build", "change", "stop"]);
  assert.equal(card.options.find((item) => item.id === "stop").ends, true);
});

test("a request that names no Adobe app gets one host question first, then the plan", async () => {
  const { out, ctx } = await begin("create a plugin that shows the document title");
  const questions = JSON.parse(fs.readFileSync(path.join(out, "questions.json"), "utf8")).map((item) => item.id);
  assert.equal(questions[0], "mode");
  assert.ok(questions.includes("host"));
  assert.ok(questions.includes("runtime"));
  assert.equal(nextAction(out).ask, "host");
  await answer(ctx, "host", "phxs");
  assert.equal(nextAction(out).ask, "runtime");
  assert.equal(resolvePlan(out).host, "phxs");
});

test("next walks mode, plan, docs, build, implement, check, finish with no other question", async () => {
  const { out, ctx } = await begin();
  const seen = [];
  const step = () => {
    const action = nextAction(out);
    seen.push(action.action);
    return action;
  };
  assert.equal(step().action, "ask");
  const after = await confirm(ctx);
  assert.equal(after.action, "docs");
  seen.push("docs");
  assert.equal(step().action, "docs");
  assert.match(nextAction(out).command, /skill\.mjs docs --out /);
  await runDocs(out, { fetchImpl: fakeAdobe().fetchImpl });
  assert.equal(step().action, "build");
  await runBuild(out, { scaffoldImpl, installImpl });
  const implement = step();
  assert.equal(implement.action, "implement");
  assert.match(implement.say, /BRIEF\.md/);
  assert.equal(readMerged(out).steps.find((item) => item.id === "implement").status, "running");
  assert.deepEqual(seen, ["ask", "docs", "docs", "build", "implement"]);
});

test("choosing Change something asks one text question, and the words change the plan", async () => {
  const { out, ctx } = await begin();
  await confirm(ctx, "change");
  assert.equal(nextAction(out).ask, "tweak");
  await answer(ctx, "tweak", "use Photoshop, name it Fast QR, use Vue and needs network");
  const plan = resolvePlan(out);
  assert.equal(plan.host, "phxs");
  assert.equal(plan.name, "Fast QR");
  assert.equal(plan.id, "com.example.fastqr");
  assert.equal(plan.framework, "vue");
  assert.deepEqual(plan.permissions, ["network"]);
  assert.equal(nextAction(out).action, "docs");
  assert.equal(resolvePlan(out).name, "Fast QR", "reading the plan twice does not apply the words twice");
});

test("choosing Stop ends the session without docs, and done accepts it", async () => {
  const { out, ctx } = await begin();
  await confirm(ctx, "stop");
  const action = nextAction(out);
  assert.equal(action.action, "stop");
  assert.match(action.command, /done --stopped/);
  assert.throws(() => finish(out, "x"), /docs were never saved/);
  finish(out, "Stopped.", { stopped: true });
  assert.equal(nextAction(out).action, "finished");
});

test("docs saves the pages, records them on the session, and a skipped docs step lets done through", async () => {
  const { out } = await begin();
  const result = await runDocs(out, { fetchImpl: fakeAdobe().fetchImpl });
  assert.equal(result.ok, true);
  assert.deepEqual(result.pages, { fresh: 6, stale: 0, failed: 1 }, "five pages and the types file");
  assert.equal(readMerged(out).steps.find((item) => item.id === "docs").status, "done");
  assert.equal(readMerged(out).docs.fresh.length, 6);

  const second = await begin();
  const kept = await runDocs(second.out, { fetchImpl: fakeAdobe({ offline: true }).fetchImpl });
  assert.equal(kept.ok, true, "offline, the copy saved a moment ago fills in");
  assert.deepEqual(kept.pages, { fresh: 0, stale: 6, failed: 2 });
  assert.match(kept.warning, /stale/);

  const third = await begin();
  const home = process.env.SKILL_TEST_HOME;
  process.env.SKILL_TEST_HOME = temp();
  const offline = await runDocs(third.out, { fetchImpl: fakeAdobe({ offline: true }).fetchImpl });
  process.env.SKILL_TEST_HOME = home;
  assert.equal(offline.ok, false);
  assert.match(offline.next, /--skip/);
  assert.equal(readMerged(third.out).steps.find((item) => item.id === "docs").status, "pending");
  const skipped = await runDocs(third.out, { skip: true });
  assert.equal(skipped.skipped, true);
  assert.equal(readMerged(third.out).steps.find((item) => item.id === "docs").status, "skipped");
  await answer(third.ctx, "plan", "build");
  finish(third.out, "Done without docs.");
});

test("build narrows the starter's broad permissions to the request and writes the brief, the baseline, and the project path", async () => {
  const { out, work } = await begin();
  await assert.rejects(runBuild(out, { scaffoldImpl, installImpl }), /docs are not saved/);
  await runDocs(out, { fetchImpl: fakeAdobe().fetchImpl });
  const built = await runBuild(out, { scaffoldImpl, installImpl });
  assert.equal(built.ok, true);
  assert.equal(built.project, work);
  const config = fs.readFileSync(path.join(built.project, "uxp.config.ts"), "utf8");
  assert.match(config, /requiredPermissions: \{\}/);
  assert.equal(/fullAccess|clipboard|webview/.test(config), false);
  const brief = fs.readFileSync(built.brief, "utf8");
  assert.match(brief, /^# Brief: QR Codes \(Premiere Pro\)/);
  assert.match(brief, /create a plugin that create high quality qr codes in premiere/);
  assert.match(brief, /premierepro\.d\.ts/);
  assert.match(brief, /Do not stop to ask the developer/);
  assert.match(brief, /not run in the Adobe app/);
  assert.equal(fs.existsSync(path.join(out, "baseline.json")), true);
  assert.equal(readMerged(out).addon.path, built.project);
  // Running build again keeps the project and does not fail.
  const again = await runBuild(out, { scaffoldImpl: async () => { throw new Error("must not scaffold twice"); }, installImpl });
  assert.equal(again.ok, true);
});

test("a request that names the clipboard keeps the clipboard key and nothing else", async () => {
  const { out } = await begin("a premiere plugin that copies the sequence name to the clipboard");
  await runDocs(out, { fetchImpl: fakeAdobe().fetchImpl });
  const built = await runBuild(out, { scaffoldImpl, installImpl });
  const config = fs.readFileSync(path.join(built.project, "uxp.config.ts"), "utf8");
  assert.match(config, /clipboard: "readAndWrite"/);
  assert.equal(/fullAccess|network|webview/.test(config), false);
});

test("check refuses the starter, lists errors with fixes, then passes once the code is right", async () => {
  const { out, ctx } = await begin();
  await confirm(ctx);
  await runDocs(out, { fetchImpl: fakeAdobe().fetchImpl });
  const built = await runBuild(out, { scaffoldImpl, installImpl });
  const pack = runner(built.project);

  const untouched = await runCheck(out, { runner: pack });
  assert.equal(untouched.ok, false);
  assert.equal(untouched.stage, "implement");
  assert.match(untouched.next, /Write the plugin/);

  fs.writeFileSync(path.join(built.project, "src", "main.tsx"), `import { premierepro } from "./globals";\nexport const run = () => premierepro.Projct.getActiveProject();\nexport const get = () => fetch("https://example.com");\n`);
  const bad = await runCheck(out, { runner: pack });
  assert.equal(bad.ok, false);
  assert.equal(bad.stage, "check");
  assert.equal(bad.errors.length, 2);
  assert.ok(bad.errors.every((line) => /Fix:/.test(line)));
  assert.match(bad.next, /Fix the 2 problems/);
  const notes = readMerged(out).notes.filter((note) => note.status === "open");
  assert.equal(notes.length >= 2, true, "each error is a dashboard finding");

  fs.writeFileSync(path.join(built.project, "src", "main.tsx"), `import { premierepro } from "./globals";\nexport const run = () => premierepro.Project.getActiveProject();\n`);
  const good = await runCheck(out, { runner: pack });
  assert.equal(good.ok, true, JSON.stringify(good.errors));
  assert.match(good.docs, /Premiere types saved/);
  assert.equal(good.hostExecuted, false);
  assert.match(good.note, /not run in the Adobe app/);
  assert.match(good.load, /UXP Developer Tool/);
  assert.equal(good.artifacts.length, 1);
  const open = readMerged(out).notes.filter((note) => note.status === "open");
  assert.deepEqual(open.map((note) => note.severity), ["low"], "the fixed errors close; only the no-tests warning stays open");
  assert.equal(nextAction(out).action, "try", "a clean build leads to the developer trying it, not straight to done");
  assert.match(fs.readFileSync(path.join(out, "load.txt"), "utf8"), /UXP Developer Tool/);
  await runFeedback(out, { skip: true });
  assert.equal(nextAction(out).action, "finish");
  finish(out, "Built the QR plugin. Not run in Premiere.");
  assert.equal(nextAction(out).action, "finished");
});

test("a failed build is reported with the compiler output and keeps check from passing", async () => {
  const { out } = await begin();
  await runDocs(out, { fetchImpl: fakeAdobe().fetchImpl });
  const built = await runBuild(out, { scaffoldImpl, installImpl });
  fs.writeFileSync(path.join(built.project, "src", "main.tsx"), "export const x = 1;\n");
  const failing = (command, args) => (args.includes("build") ? { status: 1, stdout: "", stderr: "error TS1005: oops" } : { status: 0, stdout: "", stderr: "" });
  const result = await runCheck(out, { runner: failing });
  assert.equal(result.ok, false);
  assert.match(result.errors[0], /build-failed/);
  assert.match(result.errors[0], /oops/);
});

test("the brief points at pages that match the goal and not a page that only shares letters", async () => {
  const { out } = await begin();
  await runDocs(out, { fetchImpl: fakeAdobe().fetchImpl });
  const built = await runBuild(out, { scaffoldImpl, installImpl });
  const brief = fs.readFileSync(writeBrief(out, resolvePlan(out), built.project), "utf8");
  assert.match(brief, /drawing and writing an image/);
  assert.match(brief, /html-canvas-element\.md/);
  assert.match(brief, /use flex/);
  assert.match(brief, /## Design/);
  assert.match(brief, /Do not copy the search colors/);
  assert.match(brief, /no `toDataURL` or `toBlob`/);
});

test("check runs the project's TypeScript and reports errors in the files the assistant wrote, not the starter's", async () => {
  const { out } = await begin();
  await runDocs(out, { fetchImpl: fakeAdobe().fetchImpl });
  const built = await runBuild(out, { scaffoldImpl, installImpl });
  assert.ok(built.steps.some((line) => /spectrum\.d\.ts/.test(line)) === false, "the fake starter has no tsconfig, so nothing is added");
  fs.writeFileSync(path.join(built.project, "tsconfig.json"), "{}");
  fs.mkdirSync(path.join(built.project, "node_modules", ".bin"), { recursive: true });
  fs.writeFileSync(path.join(built.project, "node_modules", ".bin", "tsc"), "");
  fs.writeFileSync(path.join(built.project, "src", "main.tsx"), `import { premierepro } from "./globals";\nexport const run = () => premierepro.Project.getActiveProject();\n`);
  const output = "src/api/themes.ts(1,1): error TS2322: starter\nsrc/main.tsx(2,9): error TS2339: Property 'zap' does not exist on type 'Project'.\n";
  const bad = await runCheck(out, { runner: runner(built.project), typecheckImpl: () => ({ status: 2, stdout: output, stderr: "" }) });
  assert.equal(bad.ok, false);
  assert.equal(bad.types, "1 error in your files");
  assert.equal(bad.errors.length, 1);
  assert.match(bad.errors[0], /src\/main\.tsx:2 \[type-error\] TS2339/);
  const good = await runCheck(out, { runner: runner(built.project), typecheckImpl: () => ({ status: 0, stdout: "", stderr: "" }) });
  assert.equal(good.ok, true);
  assert.equal(good.types, "clean (the files you wrote)");
});

test("the brief gives paths inside the docs folder, lists what the starter provides, and puts the goal's limits first", async () => {
  const { out } = await begin();
  await runDocs(out, { fetchImpl: fakeAdobe().fetchImpl });
  const built = await runBuild(out, { scaffoldImpl, installImpl });
  const brief = fs.readFileSync(built.brief, "utf8");
  assert.match(brief, /every path below that does not start with \/ is inside this folder/);
  assert.match(brief, /^- api\/premierepro\.d\.ts \(/m);
  assert.match(brief, /^- LIMITS\.md /m);
  assert.match(brief, /## What the starter already gives you/);
  assert.match(brief, /`uxp\.storage` .* typed\. Call them directly/);
  assert.match(brief, /const app = require\("premierepro"\)/);
  assert.match(brief, /no `toDataURL` or `toBlob`/);
  assert.match(brief, /## Packages/);
  assert.match(brief, /qrcode/);
  assert.match(brief, /In panel code, import without the extension/);
  assert.match(brief, /type checks the files you wrote/);
  assert.match(brief, /try card|session next/);
  assert.match(brief, /No more bugs/);
  assert.doesNotMatch(brief, /`check` says ok, then run `node scripts\/skill\.mjs session done/);
  assert.match(brief, /## Look up when you need it/);
  assert.match(brief, /pages\/plugins\/concepts\/manifest\.md/);
  assert.match(brief, /^- pages\/introduction\.md \(overview\)$/m);
  assert.equal((brief.match(/concepts\/manifest\.md/g) || []).length, 1, "a page is listed once");
  assert.equal(brief.includes(path.join(out, "docs", "pages")), false, "no long absolute paths under the docs folder");
});

test("a wrong host API is reported once, not again as a type error on the same line", async () => {
  const { out } = await begin();
  await runDocs(out, { fetchImpl: fakeAdobe().fetchImpl });
  const built = await runBuild(out, { scaffoldImpl, installImpl });
  fs.writeFileSync(path.join(built.project, "tsconfig.json"), "{}");
  fs.mkdirSync(path.join(built.project, "node_modules", ".bin"), { recursive: true });
  fs.writeFileSync(path.join(built.project, "node_modules", ".bin", "tsc"), "");
  fs.writeFileSync(path.join(built.project, "src", "main.tsx"), `import { premierepro } from "./globals";\nexport const run = () => premierepro.Project.getActveProject();\nconst n: number = "x";\n`);
  const output = "src/main.tsx(2,41): error TS2551: Property 'getActveProject' does not exist.\nsrc/main.tsx(3,7): error TS2322: Type 'string' is not assignable to type 'number'.\n";
  const result = await runCheck(out, { runner: runner(built.project), typecheckImpl: () => ({ status: 2, stdout: output, stderr: "" }) });
  assert.deepEqual(result.errors.map((line) => line.match(/\[([a-z-]+)\]/)[1]), ["api-unknown", "type-error"]);
  assert.match(result.errors[1], /main\.tsx:3 /);
});

test("a folder that already has files keeps a named subfolder", () => {
  const dir = temp();
  fs.writeFileSync(path.join(dir, "notes.txt"), "keep");
  const plan = makePlan({ goal: QR, kind: "empty", input: dir });
  assert.equal(plan.inPlace, false);
  assert.equal(projectPath(plan), path.join(dir, "qr-codes"));
});

test("a thin request asks for the goal, the name, and a description before the confirm card", async () => {
  const { out } = await begin("make me a plugin");
  const ids = JSON.parse(fs.readFileSync(path.join(out, "questions.json"), "utf8")).map((item) => item.id);
  assert.ok(ids.indexOf("goal") < ids.indexOf("plan"));
  assert.ok(ids.includes("name"));
  assert.ok(ids.includes("description"));
  assert.ok(ids.includes("runtime"));
  assert.equal(nextAction(out).ask, "host");
});

test("a goal UXP cannot do stops the scaffold and asks to change it or stop", async () => {
  const { out } = await begin("a premiere panel that renders a webgl scene");
  await runDocs(out, { fetchImpl: fakeAdobe().fetchImpl });
  const blocked = await runBuild(out, { scaffoldImpl, installImpl });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.ask.id, "blocked");
  assert.match(blocked.ask.prompt, /WebGL/);
  assert.equal(fs.existsSync(path.join(projectPath(resolvePlan(out)), "uxp.config.ts")), false);
});
