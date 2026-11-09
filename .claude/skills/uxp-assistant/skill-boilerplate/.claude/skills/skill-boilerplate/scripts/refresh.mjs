import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { loadExtension } from "./lib/extension.mjs";
import { resolveOut, sessionBin } from "./lib/paths.mjs";
import { refreshSources } from "./lib/refresh.mjs";
import { readMerged, recordDocs, setStep } from "./lib/session.mjs";

export async function refreshSkill({ extensionPath, out, fetchImpl }) {
  const folder = resolveOut(out);
  const session = readMerged(folder);
  if (!session) throw new Error("No session. Run start.mjs first.");
  const ext = await loadExtension(extensionPath || session.extensionPath || process.env.SKILL_EXTENSION);
  if (!session.mode) throw new Error("Set mode before fetching docs.");
  const pages = ext.sources ? await ext.sources(session) : [];
  const policy = ext.docs || {};
  const target = path.join(folder, "docs");
  const impl = fetchImpl || fixtureFetch();
  const cached = policy.everyInvocation === false ? readCachedSummary(target) : null;
  if (cached) {
    recordDocs(folder, cached);
    await appendQuestionsAfterDocs(ext, folder);
    return documented(folder, { ok: cached.ok, fresh: cached.fresh, stale: cached.stale, failed: cached.failed, network: false, cached: true });
  }
  if (session.steps.some((step) => step.id === "docs")) {
    setStep(folder, "docs", "running", "Fetching sources.", { doing: "Fetching sources.", progress: { done: 0, total: Math.max(pages.length, 1) } });
  }
  const summary = await refreshSources(target, pages, {
    ...(impl ? { fetchImpl: impl } : {}),
    pageTimeoutMs: policy.pageTimeoutMs || 8000,
    budgetMs: policy.budgetMs || 20000,
    onPage: async ({ page, done, total }) => {
      if (!session.steps.some((step) => step.id === "docs")) return;
      setStep(folder, "docs", "running", `${page.id} ${page.freshness}`, {
        doing: `${page.id} is ${page.freshness} (${done} of ${total})`,
        progress: { done, total },
        log: `${page.id} ${page.freshness}`
      });
    }
  });
  recordDocs(folder, summary);
  await appendQuestionsAfterDocs(ext, folder);
  return documented(folder, { ok: summary.ok, fresh: summary.fresh, stale: summary.stale, failed: summary.failed, network: true });
}

function documented(folder, result) {
  const fresh = (result.fresh || []).length;
  const stale = (result.stale || []).length;
  const failed = (result.failed || []).length;
  const counts = `fresh ${fresh}, stale ${stale}, failed ${failed}`;
  const next = stale || failed || result.ok === false
    ? `Docs are not done (${counts}). Failed: ${(result.failed || []).join(", ") || "none"}. Stale: ${(result.stale || []).join(", ") || "none"}. The docs step is not done. Run ${sessionBin()} next --out ${folder}.`
    : `Docs recorded (${counts}). The docs step is done. Run ${sessionBin()} next --out ${folder}.`;
  return { ...result, out: folder, next };
}

export function refreshExitCode(result) {
  if (!result) return 1;
  if (Array.isArray(result.failed) || Array.isArray(result.fresh)) return 0;
  return result.ok === false ? 2 : 0;
}

function fixtureFetch() {
  const body = process.env.SKILL_DOC_FIXTURE;
  if (!body) return undefined;
  return async (url) => ({ ok: true, status: 200, text: async () => `${body}\n${url}` });
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
    extensionPath: extensionFlag >= 0 ? process.argv[extensionFlag + 1] : "",
    out: outFlag >= 0 ? process.argv[outFlag + 1] : process.env.SKILL_OUT
  }).then((result) => {
    process.stdout.write(`${JSON.stringify(result)}\n`);
    process.exit(refreshExitCode(result));
  }).catch((error) => {
    process.stdout.write(`${JSON.stringify({ ok: false, error: error.message })}\n`);
    process.exit(1);
  });
}
