/** A small stand-in for developer.adobe.com and the Premiere types file, for tests that must not touch the network. */

export const CONFIG = `- pathPrefix:

  - /premiere-pro/uxp/

- pages:

  - [Introduction](/premiere-pro/uxp/introduction/)

  - [Manifest](/premiere-pro/uxp/plugins/concepts/manifest/)

  - [Known Issues](/premiere-pro/uxp/uxp-api/known-issues/)

  - [HTMLCanvasElement](/premiere-pro/uxp/uxp-api/reference-js/global-members/html-elements/html-canvas-element/)

  - [Project](/premiere-pro/uxp/ppro-reference/classes/project/)

  - [Modules](/premiere-pro/uxp/uxp-api/reference-js/modules/)

  - [Gone](/premiere-pro/uxp/plugins/gone/)
`;

const page = (title, body) => `<html><head><title>${title} — UXP</title></head><body><nav>menu</nav><main><h1>${title}</h1>${body}</main><footer>foot</footer></body></html>`;

export const PAGES = {
  "/premiere-pro/uxp/introduction/": page("Introduction", "<p>Premiere Pro UXP plugins run inside the app.</p>"),
  "/premiere-pro/uxp/plugins/concepts/manifest/": page("Manifest", "<p>requiredPermissions defaults to an empty object. localFileSystem can be request or fullAccess.</p><pre>{ \"manifestVersion\": 5 }</pre>"),
  "/premiere-pro/uxp/uxp-api/known-issues/": page("Known Issues", "<p>The following issues are known.</p><h2>CSS</h2><ul><li>CSS transitions and animations are not supported.</li><li><code>text-transform</code> is not supported,</li></ul><h2>HTML Elements</h2><ul><li>&lt;input type=\"file\" /&gt; is not supported. Use the file picker.</li></ul>"),
  "/premiere-pro/uxp/uxp-api/reference-js/global-members/html-elements/html-canvas-element/": page("HTMLCanvasElement", "<pre>data-variant=info</pre><p>UXP HTMLCanvasElement supports only basic shapes for now.</p><p>Note: Only '2d' context is supported.</p>"),
  "/premiere-pro/uxp/ppro-reference/classes/project/": page("Project", "<p>The project class. importFiles brings files into the project.</p><div class=\"table\"><div class=\"row\"><div>Name</div><div>Type</div></div><div class=\"row\"><div>name</div><div>string</div></div></div>"),
  "/premiere-pro/uxp/uxp-api/reference-js/modules/": "<html><head><title>Modules</title></head><body><main></main></body></html>"
};

export const TYPES = `export declare type premierepro = {
  Project: ProjectStatic;
  Sequence: SequenceStatic;
  Marker: Marker;
};

export declare type ProjectStatic = {
  getActiveProject(): Promise<Project>;
  open(path: string): Promise<Project>;
};

export declare type Project = {
  name: string;
  importFiles(paths: string[]): Promise<boolean>;
};

export declare type SequenceStatic = {};

export declare type Sequence = {
  name: string;
};

export declare type Marker = {
  start: number;
};
`;

/**
 * options.fail: URL fragments that answer 500. options.offline: every URL fails.
 * Returns the fetch function and a log of the URLs it was asked for.
 */
export function fakeAdobe(options = {}) {
  const calls = [];
  const fail = options.fail || [];
  const fetchImpl = async (url) => {
    const text = String(url);
    calls.push(text);
    if (options.offline) throw new Error("offline");
    if (fail.some((fragment) => text.includes(fragment))) return { ok: false, status: 500, async text() { return ""; } };
    if (text.endsWith("/premiere-pro/uxp/config.md")) return { ok: true, status: 200, async text() { return CONFIG; } };
    if (text.endsWith("premierepro.d.ts")) return { ok: true, status: 200, async text() { return TYPES; } };
    const path = text.replace("https://developer.adobe.com", "");
    if (PAGES[path]) return { ok: true, status: 200, async text() { return PAGES[path]; } };
    return { ok: false, status: 404, async text() { return ""; } };
  };
  return { fetchImpl, calls };
}
