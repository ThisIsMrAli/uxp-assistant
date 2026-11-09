import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { loadExtension } from "./lib/extension.mjs";
import { refreshSources } from "./lib/refresh.mjs";
import { readMerged, recordDocs, setStep } from "./lib/session.mjs";

export async function refreshSkill({ extensionPath, out, fetchImpl }) {
  const ext = await loadExtension(extensionPath);
  const session = readMerged(out);
  if (!session) throw new Error("No session. Run start.mjs first.");
  if (!session.mode) throw new Error("Set mode before fetching docs.");
  const pages = ext.sources ? await ext.sources(session) : [];
  const policy = ext.docs || {};
  const target = path.join(out, "docs");
  const cached = policy.everyInvocation === false ? readCachedSummary(target) : null;
  if (cached) {
    recordDocs(out, cached);
    await appendQuestionsAfterDocs(ext, out);
    return { ok: cached.ok, fresh: cached.fresh, stale: cached.stale, failed: cached.failed, network: false, cached: true };
  }
  if (session.steps.some((step) => step.id === "docs")) {
    setStep(out, "docs", "running", "Fetching sources.", { doing: "Fetching sources.", progress: { done: 0, total: Math.max(pages.length, 1) } });
  }
  const summary = await refreshSources(target, pages, {
    fetchImpl,
    pageTimeoutMs: policy.pageTimeoutMs || 8000,
    budgetMs: policy.budgetMs || 20000,
    onPage: async ({ page, done, total }) => {
      if (!session.steps.some((step) => step.id === "docs")) return;
      setStep(out, "docs", "running", `${page.id} ${page.freshness}`, {
        doing: `${page.id} is ${page.freshness} (${done} of ${total})`,
        progress: { done, total },
        log: `${page.id} ${page.freshness}`
      });
    }
  });
  recordDocs(out, summary);
  await appendQuestionsAfterDocs(ext, out);
  return { ok: summary.ok, fresh: summary.fresh, stale: summary.stale, failed: summary.failed, network: true };
}

async function appendQuestionsAfterDocs(ext, out) {
  if (!ext.questionsAfterDocs) return;
  const more = await ext.questionsAfterDocs(readMerged(out), out) || [];
  const file = path.join(out, "questions.json");
  const current = JSON.parse(fs.readFileSync(file, "utf8"));
  const ids = new Set(current.map((item) => item.id));
  const extra = more.filter((item) => item && !ids.has(item.id));
  if (extra.length) fs.writeFileSync(file, `${JSON.stringify([...current, ...extra], null, 2)}\n`);
}

function readCachedSummary(target) {
  const file = path.join(target, "summary.json");
  if (!fs.existsSync(file)) return null;
  try {
    const summary = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!summary || !Array.isArray(summary.pages) || !Array.isArray(summary.fresh) || !Array.isArray(summary.stale) || !Array.isArray(summary.failed)) return null;
    return summary;
  } catch {
    return null;
  }
}

const ranDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (ranDirectly) {
  const outFlag = process.argv.indexOf("--out");
  const extensionFlag = process.argv.indexOf("--extension");
  refreshSkill({
    extensionPath: extensionFlag >= 0 ? process.argv[extensionFlag + 1] : process.env.SKILL_EXTENSION,
    out: outFlag >= 0 ? process.argv[outFlag + 1] : process.env.SKILL_OUT
  }).then((result) => {
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (!result.ok) process.exitCode = 2;
  }).catch((error) => {
    process.stdout.write(`${JSON.stringify({ ok: false, error: error.message })}\n`);
    process.exitCode = 1;
  });
}
