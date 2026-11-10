import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { buildLibrary, findInLibrary, hostKey, htmlToMarkdown, parseConfig } from "../.claude/skills/uxp-assistant/scripts/lib/library.mjs";
import { CONFIG, fakeAdobe } from "./fixtures/fake-adobe.mjs";

const made = [];
function temp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "uxp-lib-"));
  made.push(dir);
  return dir;
}
process.on("exit", () => made.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));

test("the page list is read in order, with its folders and without bookkeeping keys", () => {
  const pages = parseConfig(CONFIG);
  assert.equal(pages.length, 7);
  assert.equal(pages[0].path, "/premiere-pro/uxp/introduction/");
  assert.equal(pages.some((page) => /pathPrefix|pages/.test(page.group)), false);
  assert.equal(hostKey("premierepro"), "ppro");
  assert.equal(hostKey("nope"), "");
});

test("an Adobe page becomes markdown: headings, lists, code, div tables, and no menu or footer", () => {
  const html = "<html><head><title>X — UXP</title></head><body><nav>menu</nav><main><h1>Project</h1><p>Text <code>name</code>.</p><ul><li>one</li><li>two</li></ul><pre>const a = 1;</pre><pre>data-variant=info</pre><div class=\"table\"><div><div>Name</div><div>Type</div></div><div><div>name</div><div>string</div></div></div></main><footer>foot</footer></body></html>";
  const md = htmlToMarkdown(html);
  assert.match(md, /^# Project/);
  assert.match(md, /- one\n- two/);
  assert.match(md, /```\nconst a = 1;\n```/);
  assert.match(md, /\| Name \| Type \|/);
  assert.match(md, /\| name \| string \|/);
  assert.equal(md.includes("menu"), false);
  assert.equal(md.includes("foot"), false);
  assert.equal(md.includes("data-variant"), false);
});

test("a build saves every listed page, the types, an index, and the limits, and counts what it got", async () => {
  const dir = temp();
  const { fetchImpl } = fakeAdobe({ fail: ["/plugins/gone/"] });
  const summary = await buildLibrary({ host: "ppro", dir, fetchImpl, cache: false });
  assert.equal(summary.ok, true);
  assert.equal(summary.fresh.length, 6);
  assert.deepEqual(summary.failed, ["plugins/gone"]);
  // The listing page with no text is neither fresh nor failed.
  assert.equal(summary.pages.find((page) => page.id === "uxp-api/reference-js/modules").freshness, "empty");
  for (const file of ["INDEX.md", "LIMITS.md", "library.json", "config.md", "api/premierepro.d.ts", "pages/ppro-reference/classes/project.md", "pages/uxp-api/known-issues.md"]) {
    assert.equal(fs.existsSync(path.join(dir, file)), true, file);
  }
  assert.match(fs.readFileSync(path.join(dir, "LIMITS.md"), "utf8"), /transitions and animations are not supported/);
  assert.match(fs.readFileSync(path.join(dir, "LIMITS.md"), "utf8"), /Only '2d' context/);
  assert.match(fs.readFileSync(path.join(dir, "INDEX.md"), "utf8"), /premierepro\.d\.ts/);
});

test("a page that fails keeps its older copy and says stale; the page list failing keeps the whole library", async () => {
  const dir = temp();
  const home = temp();
  process.env.SKILL_TEST_HOME = home;
  try {
    await buildLibrary({ host: "ppro", dir, fetchImpl: fakeAdobe().fetchImpl });
    const second = await buildLibrary({ host: "ppro", dir, fetchImpl: fakeAdobe({ fail: ["/project/"] }).fetchImpl });
    assert.deepEqual(second.stale, ["ppro-reference/classes/project"]);
    assert.equal(second.fresh.includes("ppro-reference/classes/project"), false);
    assert.equal(second.ok, true);

    const fresh = temp();
    const offline = await buildLibrary({ host: "ppro", dir: fresh, fetchImpl: fakeAdobe({ offline: true }).fetchImpl });
    assert.equal(offline.ok, true, "the cache from the earlier build fills an offline run");
    assert.equal(offline.fresh.length, 0);
    assert.ok(offline.stale.length >= 6);
    assert.equal(fs.existsSync(path.join(fresh, "pages/ppro-reference/classes/project.md")), true);

    const nothing = temp();
    process.env.SKILL_TEST_HOME = temp();
    const empty = await buildLibrary({ host: "ppro", dir: nothing, fetchImpl: fakeAdobe({ offline: true }).fetchImpl });
    assert.equal(empty.ok, false);
    assert.match(empty.error, /page list/);
  } finally {
    delete process.env.SKILL_TEST_HOME;
  }
});

test("search ranks a page's name and headings first and matches whole words, not letters inside words", async () => {
  const dir = temp();
  await buildLibrary({ host: "ppro", dir, fetchImpl: fakeAdobe().fetchImpl, cache: false });
  const hits = findInLibrary(dir, "project importFiles");
  assert.ok(hits.results.length > 0);
  assert.match(hits.results[0].file, /project/);
  assert.ok(hits.results[0].lines.length > 0);
  assert.equal(hits.results[0].lines.some((line) => line.startsWith("title:")), false);

  const canvas = findInLibrary(dir, "canvas 2d");
  assert.match(canvas.results[0].file, /canvas/);
  // "qr" is not inside "requiredPermissions" for a search.
  const none = findInLibrary(dir, "qr");
  assert.equal(none.results.length, 0);
  assert.deepEqual(findInLibrary(dir, "the a of").results, []);
});

test("the lines shown for a hit are the ones that match most words, with the member they belong to", async () => {
  const dir = temp();
  await buildLibrary({ host: "ppro", dir, fetchImpl: fakeAdobe().fetchImpl, cache: false });
  const file = path.join(dir, "pages/ppro-reference/classes/project.md");
  fs.writeFileSync(file, "# Project\n\n| guid | Guid | R | The id. |\n| name | string | R | The project name. |\n\n### importFiles\n\nImport files in root bin of the project\n\nReturns: Promise<boolean>\n\n### pauseGrowing\n\nPauses monitoring of media files in the project.\n");
  const hit = findInLibrary(dir, "import media file project").results.find((item) => item.file.endsWith("classes/project.md"));
  assert.ok(hit);
  assert.ok(hit.lines.some((line) => line.startsWith("importFiles: Import files in root bin")), hit.lines.join(" | "));
  assert.ok(hit.lines.length <= 3);
});

test("a camelCase word in the query names a member and ranks the page that documents it first", async () => {
  const dir = temp();
  await buildLibrary({ host: "ppro", dir, fetchImpl: fakeAdobe().fetchImpl, cache: false });
  fs.mkdirSync(path.join(dir, "pages/uxp-api/storage"), { recursive: true });
  fs.writeFileSync(path.join(dir, "pages/uxp-api/storage/provider.md"), "# localFileSystem\n\n## getFileForSaving(name)\n\nShows a save dialog.\n");
  fs.writeFileSync(path.join(dir, "pages/uxp-api/storage/stream.md"), "# WritableStream\n\n## write(chunk)\n\nWrite write write binary binary data to the stream. Write it again: write.\n");
  const hit = findInLibrary(dir, "getFileForSaving write binary");
  assert.match(hit.results[0].file, /storage\/provider\.md$/);
});

