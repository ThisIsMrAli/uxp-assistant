// Adobe's rerun5 fresh corpus (89 cases), with the expected label for each case.
// L42, L43, and L45 had a typo in the harness (activeLayers[0 const … / activeLayers[0 await …) and
// passed only because a parse failure used to pass. They are kept here in corrected form. The broken
// forms are separate NU7 cases in BROKEN_SYNTAX, where a parse failure must be needs review.
export const GLOBALS = `export const uxp = require("uxp") as typeof import("uxp");
const hostName = uxp && uxp.host && uxp.host.name;
export const photoshop = (hostName === "photoshop" ? require("photoshop") : {}) as typeof import("photoshop");
export const premierepro = (hostName === "premierepro" ? require("premierepro") : {}) as typeof import("premierepro");
`;
const G = 'import { photoshop, premierepro, uxp } from "./globals";\n';
const C = (id, expect, body, extra) => ({ id, kind: "call", expect, body: G + body, extra });
const R = (id, expect, body, extra) => ({ id, kind: "rename", expect, body: G + body, extra });

export const FRESH_CASES = [
 // ---- call bypasses (must be rejected) ----
 C("B1 object-field alias","fail",`export function f(){ const h = { a: photoshop.action }; return h.a.subscribeToEverything(); }`),
 C("B2 array alias","fail",`export function f(){ const arr = [photoshop.action]; return arr[0].subscribeToEverything(); }`),
 C("B3 Map alias","fail",`export function f(){ const m = new Map([["a", photoshop.action]]); return m.get("a").subscribeToEverything(); }`),
 C("B4 closure return","fail",`const getAct = () => photoshop.action;\nexport function f(){ return getAct().subscribeToEverything(); }`),
 C("B5 class field","fail",`class H { act = photoshop.action; go(){ return this.act.subscribeToEverything(); } }\nexport const f = () => new H().go();`),
 C("B6 getter","fail",`const o = { get act(){ return photoshop.action; } };\nexport function f(){ return o.act.subscribeToEverything(); }`),
 C("B7 Proxy","fail",`export function f(){ const p = new Proxy(photoshop.action, {}); return p.subscribeToEverything(); }`),
 C("B8 dynamic import","fail",`export async function f(){ const ps = await import("photoshop"); return ps.action.subscribeToEverything(); }`),
 C("B9 require direct","fail",`export function f(){ const ps = require("photoshop"); return ps.action.subscribeToEverything(); }`),
 C("B10 globalThis.require","fail",`export function f(){ return (globalThis as any).require("photoshop").action.subscribeToEverything(); }`),
 C("B11 window.require","fail",`export function f(){ return (window as any).require("photoshop").action.subscribeToEverything(); }`),
 C("B12 eval","fail",`export function f(){ return eval("require('photoshop').action.subscribeToEverything()"); }`),
 C("B13 new Function","fail",`export function f(){ return new Function("ps", "return ps.action.subscribeToEverything()")(photoshop); }`),
 C("B14 key built in another module","fail",`import { K } from "./k";\nexport function f(){ return (photoshop.action as any)[K](); }`, [{ rel: "src/k.ts", body: 'export const K = "subscribeTo" + "Everything";\n' }]),
 C("B15 object spread","fail",`export function f(){ const a = { ...photoshop.action }; return a.subscribeToEverything(); }`),
 C("B16 rest args","fail",`function call(...xs: any[]){ return xs[0].subscribeToEverything(); }\nexport const f = () => call(photoshop.action);`),
 C("B17 generator","fail",`function* g(){ yield photoshop.action; }\nexport function f(){ return (g().next().value as any).subscribeToEverything(); }`),
 C("B18 promise then","fail",`export function f(){ return Promise.resolve(photoshop.action).then((a: any) => a.subscribeToEverything()); }`),
 C("B19 alias optional computed","fail",`export function f(){ const a: any = photoshop.action; return a?.["subscribeToEverything"]?.(); }`),
 C("B20 WeakRef","fail",`export function f(){ return (new WeakRef(photoshop.action).deref() as any).subscribeToEverything(); }`),
 C("B21 callback through helper","fail",`function withAct(cb: (a: any) => any){ return cb(photoshop.action); }\nexport const f = () => withAct((a) => a.subscribeToEverything());`),
 C("B22 premiere then chain","fail",`export function f(){ return premierepro.Project.getActiveProject().then((p) => p.getActiveSequenceNow()); }`),
 C("B23 Object.values","fail",`export function f(){ return (Object.values({ x: photoshop.action })[0] as any).subscribeToEverything(); }`),
 C("B24 array destructure","fail",`export function f(){ const [a] = [photoshop.action]; return (a as any).subscribeToEverything(); }`),
 C("B25 conditional alias","fail",`export function f(flag: boolean){ const a: any = flag ? photoshop.action : photoshop.app; return a.subscribeToEverything(); }`),
 C("B26 for-of over hosts","fail",`export function f(){ for (const a of [photoshop.action] as any[]) a.subscribeToEverything(); }`),
 C("B27 common-word hallucination","fail",`export function f(name: string){ return (photoshop.app.activeDocument.activeLayers[0] as any).rename(name); }`),
 C("B28 Reflect.get literal","fail",`export function f(){ return Reflect.get(photoshop.action, "subscribeToEverything")(); }`),
 // ---- rename bypasses (must be rejected) ----
 R("R1 object alias write","fail",`export function f(name: string){ const layer = photoshop.app.activeDocument.activeLayers[0]; const o = { l: layer }; o.l.name = name; }`),
 R("R2 array literal write","fail",`export function f(name: string){ const layer = photoshop.app.activeDocument.activeLayers[0]; [layer][0].name = name; }`),
 R("R3 Map write","fail",`export function f(name: string){ const layer = photoshop.app.activeDocument.activeLayers[0]; new Map([["l", layer]]).get("l")!.name = name; }`),
 R("R4 forEach outside modal","fail",`export function f(name: string){ photoshop.app.activeDocument.activeLayers.forEach((l) => { l.name = name; }); }`),
 R("R5 Object.assign patch var","fail",`export function f(name: string){ const layer = photoshop.app.activeDocument.activeLayers[0]; const patch = { name }; Object.assign(layer, patch); }`),
 R("R6 Proxy write","fail",`export function f(name: string){ const layer = photoshop.app.activeDocument.activeLayers[0]; (new Proxy(layer, {}) as any).name = name; }`),
 R("R7 promise then outside","fail",`export function f(name: string){ const layer = photoshop.app.activeDocument.activeLayers[0]; return Promise.resolve(layer).then((l) => { l.name = name; }); }`),
 R("R8 queueMicrotask inside modal","fail",`export function f(name: string){ const layer = photoshop.app.activeDocument.activeLayers[0]; return photoshop.core.executeAsModal(async () => { queueMicrotask(() => { layer.name = name; }); }, { commandName: "r" }); }`),
 R("R9 apply-helper outside modal","fail",`function run(fn: () => void){ fn(); }\nexport function f(name: string){ const layer = photoshop.app.activeDocument.activeLayers[0]; run(() => { layer.name = name; }); }`),
 R("R10 for-of outside modal","fail",`export function f(name: string){ for (const l of photoshop.app.activeDocument.activeLayers) l.name = name; }`),
 R("R11 Reflect.defineProperty","fail",`export function f(name: string){ const layer = photoshop.app.activeDocument.activeLayers[0]; Reflect.defineProperty(layer, "name", { value: name }); }`),
 R("R12 Object.assign JSON","fail",`export function f(){ const layer = photoshop.app.activeDocument.activeLayers[0]; Object.assign(layer, JSON.parse('{"name":"x"}')); }`),
 R("R13 logical assign","fail",`export function f(name: string){ const layer = photoshop.app.activeDocument.activeLayers[0]; layer.name ||= name; }`),
 R("R14 class method write","fail",`class Renamer { constructor(private l: any){} go(n: string){ this.l.name = n; } }\nexport function f(name: string){ new Renamer(photoshop.app.activeDocument.activeLayers[0]).go(name); }`),
 R("R15 destructured local fake modal","fail",`export function f(name: string){ const layer = photoshop.app.activeDocument.activeLayers[0]; const { executeAsModal } = { executeAsModal: (fn: any, _o?: any) => fn() }; return executeAsModal(() => { layer.name = name; }, { commandName: "r" }); }`),
 R("R16 setInterval inside modal","fail",`export function f(name: string){ const layer = photoshop.app.activeDocument.activeLayers[0]; return photoshop.core.executeAsModal(async () => { setInterval(() => { layer.name = name; }, 10); }, { commandName: "r" }); }`),
 // ---- legitimate (must pass) ----
 C("L1 batchPlay in modal","pass",`export async function f(name: string){ return photoshop.core.executeAsModal(async () => { await photoshop.action.batchPlay([{ _obj: "set", _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }], to: { _obj: "layer", name } }], {}); }, { commandName: "Rename" }); }`),
 C("L2 premiere sequence count","pass",`export async function f(){ const project = await premierepro.Project.getActiveProject(); const seq = await project.getActiveSequence(); return seq.getVideoTrackCount(); }`),
 C("L3 React effect add/remove listener","pass",`import { useEffect, useState } from "react";\nexport function useSel(){ const [n, setN] = useState(0); useEffect(() => { const h = () => setN((x) => x + 1); photoshop.action.addNotificationListener(["select"], h); return () => { photoshop.action.removeNotificationListener(["select"], h); }; }, []); return n; }`),
 C("L4 Vue setup ref","pass",`import { ref, onMounted } from "vue";\nexport default { setup(){ const title = ref(""); onMounted(() => { title.value = photoshop.app.activeDocument?.title ?? ""; }); return { title }; } };`),
 C("L5 Svelte store","pass",`import { writable } from "svelte/store";\nexport const title = writable("");\nexport function refresh(){ title.set(photoshop.app.activeDocument?.title ?? ""); }`),
 C("L6 premiere promise chain","pass",`export function f(){ return premierepro.Project.getActiveProject().then((p) => p.getActiveSequence()); }`),
 C("L7 map over layers","pass",`export function f(){ return photoshop.app.activeDocument.layers.map((l) => ({ id: l.id, name: l.name })); }`),
 C("L8 local class same method name","pass",`class Store { subscribeToEverything(){ return 1; } }\nexport function f(){ return new Store().subscribeToEverything(); }`),
 C("L9 string/array natives on host data","pass",`export function f(){ const t = photoshop.app.activeDocument.title.toUpperCase().trim(); return [t].includes("A") ? t.slice(0, 3) : t.padEnd(4); }`),
 C("L10 JSON Math Date console","pass",`export function f(){ console.log(JSON.stringify({ a: Math.max(1, 2), d: new Date().toISOString() })); return Number.parseInt("3", 10); }`),
 C("L11 local UI helper object","pass",`const ui = { setStatus(s: string){ return s; } };\nexport function f(){ return ui.setStatus(String(photoshop.app.documents.length)); }`),
 C("L12 React setState naming","pass",`import { useState } from "react";\nexport function useN(){ const [name, setName] = useState(""); const go = () => setName(photoshop.app.activeDocument?.title ?? ""); return { name, go }; }`),
 C("L13 optional chain reads","pass",`export function f(){ return photoshop.app.activeDocument?.activeLayers?.[0]?.name ?? ""; }`),
 C("L14 premiere getTrackItems constants","pass",`export async function f(){ const p = await premierepro.Project.getActiveProject(); const s = await p.getActiveSequence(); const t = await s.getVideoTrack(0); return t.getTrackItems(premierepro.Constants.TrackItemType.CLIP, false); }`),
 C("L15 Promise.all over layers","pass",`export async function f(){ const ls = photoshop.app.activeDocument.layers; return Promise.all(ls.map(async (l) => l.name)); }`),
 C("L16 documents find","pass",`export function f(id: number){ return photoshop.app.documents.find((d) => d.id === id)?.title; }`),
 C("L17 showAlert","pass",`export async function f(){ await photoshop.app.showAlert("Done"); }`),
 C("L18 suspendHistory in modal","pass",`export async function f(name: string){ const doc = photoshop.app.activeDocument; return photoshop.core.executeAsModal(async (ctx) => { const id = await ctx.hostControl.suspendHistory({ documentID: doc.id, name: "Rename" }); doc.activeLayers[0].name = name; await ctx.hostControl.resumeHistory(id); }, { commandName: "Rename" }); }`),
 R("L19 for-of inside modal","pass",`export async function f(name: string){ const doc = photoshop.app.activeDocument; return photoshop.core.executeAsModal(async () => { for (const l of doc.activeLayers) l.name = name; }, { commandName: "Rename" }); }`),
 R("L20 import {core,app} from photoshop","pass",`import { core, app } from "photoshop";\nexport async function f(name: string){ await core.executeAsModal(async () => { app.activeDocument.activeLayers[0].name = name; }, { commandName: "Rename" }); }`),
 R("L21 cross-module helper inside modal","pass",`import { setName } from "./set";\nexport async function f(name: string){ const layer = photoshop.app.activeDocument.activeLayers[0]; await photoshop.core.executeAsModal(async () => { setName(layer, name); }, { commandName: "Rename" }); }`, [{ rel: "src/set.ts", body: "export function setName(l: any, n: string){ l.name = n; }\n" }]),
 R("L22 map rows any","pass",`export function f(){ return photoshop.app.activeDocument.layers.map((l) => { const r = {} as any; r.name = l.name; return r; }); }`),
 R("L23 suspendHistory rename","pass",`export async function f(name: string){ const doc = photoshop.app.activeDocument; return photoshop.core.executeAsModal(async (ctx) => { const id = await ctx.hostControl.suspendHistory({ documentID: doc.id, name: "Rename" }); doc.activeLayers[0].name = name; await ctx.hostControl.resumeHistory(id); }, { commandName: "Rename" }); }`),
 R("L24 React form state name","pass",`import { useState } from "react";\nexport function useForm(){ const [form, setForm] = useState({ name: "" }); const onInput = (e: any) => { const next = { ...form }; next.name = e.target.value; setForm(next); }; return { form, onInput }; }`),
 R("L25 forEach inside modal","pass",`export async function f(name: string){ const doc = photoshop.app.activeDocument; await photoshop.core.executeAsModal(async () => { doc.activeLayers.forEach((l, i) => { l.name = name + i; }); }, { commandName: "Rename" }); }`),
 R("L26 Vue reactive item name","pass",`import { reactive } from "vue";\nexport const state = reactive({ items: [] as { name: string }[] });\nexport function load(){ state.items = photoshop.app.activeDocument.layers.map((l) => ({ name: "" })); state.items.forEach((it, i) => { it.name = photoshop.app.activeDocument.layers[i].name; }); }`),
 R("L27 core alias awaited modal","pass",`const { core } = photoshop;\nexport async function f(name: string){ const layer = photoshop.app.activeDocument.activeLayers[0]; await core.executeAsModal(async () => { layer.name = name; }, { commandName: "Rename" }); }`),,
 C("L28 Bolt notify helper","pass",`export const notify = async (message: string) => { await photoshop.app.showAlert(message); };`),
 C("L29 Bolt uxp info reads","pass",`export const id = uxp.entrypoints._pluginInfo.id;\nexport const host = uxp.host.name;`),
 C("L30 batchPlay get descriptor","pass",`export async function title(){ const r = await photoshop.action.batchPlay([{ _obj: "get", _target: [{ _ref: "document", _enum: "ordinal", _value: "targetEnum" }] }], { synchronousExecution: false }); return r[0].title; }`),
 C("L31 modal batchPlay hide loop","pass",`export async function hideAll(){ const doc = photoshop.app.activeDocument; await photoshop.core.executeAsModal(async () => { for (const l of doc.layers) { await photoshop.action.batchPlay([{ _obj: "hide", null: [{ _ref: "layer", _id: l.id }] }], {}); } }, { commandName: "Hide" }); }`),
 C("L32 premiere project name","pass",`export async function f(){ const project = await premierepro.Project.getActiveProject(); return project.name; }`),
 C("L33 premiere track loop","pass",`export async function f(){ const p = await premierepro.Project.getActiveProject(); const s = await p.getActiveSequence(); const n = await s.getVideoTrackCount(); const out = []; for (let i = 0; i < n; i++) { const t = await s.getVideoTrack(i); out.push(await t.getTrackItems(premierepro.Constants.TrackItemType.CLIP, false)); } return out; }`),
 C("L34 React handler with status","pass",`import { useState } from "react";\nexport function Panel(){ const [status, setStatus] = useState(""); const go = async () => { try { await photoshop.app.showAlert("hi"); setStatus("ok"); } catch (e) { setStatus(String(e)); } }; return <div><sp-button onClick={go}>Go</sp-button><sp-body>{status}</sp-body></div>; }`),
 C("L35 class wrapper reads","pass",`class Doc { ps = photoshop; title(){ return this.ps.app.activeDocument?.title; } }\nexport const t = () => new Doc().title();`),
 C("L36 filter visible layers","pass",`export function f(){ return photoshop.app.activeDocument.layers.filter((l) => l.visible).length; }`),
 C("L37 local async generator","pass",`async function* names(){ yield "a"; yield "b"; }\nexport async function f(){ const out: string[] = []; for await (const n of names()) out.push(n.toUpperCase()); return out; }`),
 C("L38 local emitter","pass",`const listeners: Record<string, Function[]> = {};\nconst emitter = { on(e: string, f: Function){ (listeners[e] ||= []).push(f); }, emit(e: string){ (listeners[e] || []).forEach((f) => f()); } };\nexport function f(){ emitter.on("x", () => 1); emitter.emit("x"); }`),
 C("L39 modal then/catch chain","pass",`export function f(setStatus: (s: string) => void){ return photoshop.core.executeAsModal(async () => {}, { commandName: "Noop" }).then(() => setStatus("ok")).catch((e) => setStatus(String(e))); }`),
 C("L40 listener cleanup via helper","pass",`function off(h: any){ photoshop.action.removeNotificationListener(["select"], h); }\nexport function f(h: any){ photoshop.action.addNotificationListener(["select"], h); return () => off(h); }`),
 R("L41 rename via batchPlay in modal","pass",`export async function f(name: string){ await photoshop.core.executeAsModal(async () => { await photoshop.action.batchPlay([{ _obj: "set", _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }], to: { _obj: "layer", name } }], {}); }, { commandName: "Rename" }); }`),
 R("L42 inner async fn passed with options","pass",`export async function f(name: string){ const layer = photoshop.app.activeDocument.activeLayers[0]; const job = async () => { layer.name = name; return layer.name; }; return await photoshop.core.executeAsModal(job, { commandName: "Rename" }); }`),
 R("L43 try/finally in modal","pass",`export async function f(name: string){ const layer = photoshop.app.activeDocument.activeLayers[0]; await photoshop.core.executeAsModal(async () => { try { layer.name = name; } finally { console.log("done"); } }, { commandName: "Rename" }); }`),
 R("L44 map index write in modal","pass",`export async function f(name: string){ const doc = photoshop.app.activeDocument; await photoshop.core.executeAsModal(async () => { doc.activeLayers.map((l, i) => { l.name = name + i; return l; }); }, { commandName: "Rename" }); }`),
 R("L45 rename then read outside","pass",`export async function f(name: string){ const layer = photoshop.app.activeDocument.activeLayers[0]; await photoshop.core.executeAsModal(async () => { layer.name = name; }, { commandName: "Rename" }); return { id: layer.id, name: layer.name }; }`),

].filter(Boolean);

const broken = (id) => {
  const entry = FRESH_CASES.find((item) => item.id.startsWith(`${id} `));
  return { ...entry, id: `${entry.id} (harness typo)`, expect: "fail", body: entry.body.replace("activeLayers[0]; ", "activeLayers[0 ") };
};

export const BROKEN_SYNTAX = [broken("L42"), broken("L43"), broken("L45")];

const page = (owner, text) => `${owner} ${owner} ${text}`;

// Synthetic API pages written for this corpus, in the shape of the fetched Adobe reference pages:
// one line per page, owner name twice, a property table (name Type R [W] version), and versioned methods.
// Members the cases call must be on the owner page. layer.rename and action.subscribeToEverything are not.
export const DOCS_RERUN5 = [
  page("photoshopAction", "The action module of the photoshop namespace runs action descriptors and listens for host events in the running application. Methods batchPlay 23.0 Promise<ActionDescriptor[]> addNotificationListener 23.0 Promise<void> removeNotificationListener 23.0 Promise<void> validateReference 23.0 Promise<void>"),
  page("photoshopCore", "The core module of the photoshop namespace runs modal work and history control while the application waits for the plugin to finish. Methods executeAsModal 23.0 Promise<any> showAlert 23.0 Promise<void> suspendHistory 23.0 Promise<number> resumeHistory 23.0 Promise<void>"),
  page("Photoshop", "The app object is the root of the Photoshop document object model and gives the open documents and the active document of the application. Properties activeDocument Document R W 23.0 documents Documents R 23.0 Methods showAlert 23.0 Promise<void> open 23.0 Promise<Document>"),
  page("Document", "Represents a single Photoshop document that is open in the application, with its layers, size, title, and selection in the current session. Properties activeLayers Layers R 23.0 layers Layers R 23.0 title string R 23.0 id number R 23.0 width number R 23.0 height number R 23.0 Methods duplicate 23.0 Promise<Document> save 23.0 Promise<void>"),
  page("Layer", "Represents a single layer in a Photoshop document, such as a pixel layer, a text layer, or a group that holds other layers in the stack. Properties name string R W 23.0 id number R 23.0 visible boolean R W 23.0 opacity number R W 23.0 kind string R 23.0 parent Layer R 23.0 Methods duplicate 23.0 Promise<Layer> delete 23.0 void moveAbove 23.0 void"),
  page("ExecutionContext", "The execution context is passed to the executeAsModal callback and gives cancellation state and history control for the modal scope in the host. Properties hostControl HostControl R 23.0 isCancelled boolean R 23.0 Methods reportProgress 23.0 void"),
  page("HostControl", "Host control is part of the execution context and suspends and resumes history states for the document while the modal work runs in the host. Methods suspendHistory 23.0 Promise<number> resumeHistory 23.0 Promise<void>"),
  page("Project", "A Premiere project holds sequences, bins, and media, and the active project is the one the user has open in the editor at this moment. getActiveProject Returns: Promise<Project> Methods getActiveProject 25.0 Promise<Project> getActiveSequence 25.0 Promise<Sequence> Properties name string R 25.0 Returns: Promise<Sequence>"),
  page("Sequence", "A Premiere sequence is a timeline of video and audio tracks with clips that the user edits and plays back in the program monitor. Methods getVideoTrackCount 25.0 Promise<number> getVideoTrack 25.0 Promise<VideoTrack> getAudioTrackCount 25.0 Promise<number> getVideoTrack Returns: Promise<VideoTrack>"),
  page("VideoTrack", "A video track in a Premiere sequence holds the track items for clips, transitions, and other media that are placed on that track of the timeline. Methods getTrackItems 25.0 Promise<TrackItem[]> getIndex 25.0 number Properties name string R 25.0"),
  page("Constants", "Constants are the enumerations the Premiere API uses for track item types, media types, and similar choices that methods accept as arguments here. Properties TrackItemType object R 25.0 CLIP number R 25.0 EMPTY number R 25.0"),
  page("uxp", "The uxp module gives the host, the plugin entrypoints, storage, dialogs, and versions to the plugin while it runs inside a UXP host app. Properties host Host R 6.0 entrypoints Entrypoints R 6.0 versions object R 6.0 storage object R 6.0 Methods setup 6.0 void"),
  page("Host", "The host object names the application that runs the plugin and gives its version and UI locale for that running session of the application. Properties name string R 6.0 version string R 6.0 uiLocale string R 6.0"),
  page("Entrypoints", "Entrypoints declare the panels and commands of a plugin and give access to its manifest data and setup callbacks in the host. Properties _pluginInfo object R 6.0 Methods setup 6.0 void getPanel 6.0 object")
].join("\n");
