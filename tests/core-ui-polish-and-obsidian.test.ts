import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createContext, runInContext, runInNewContext } from "node:vm";
import { PithObsidianController, PithWorkspaceView, createObsidianHostPort } from "../src/shells/obsidian/index.ts";
import { PithObsidianView, obsidianStyles, speechChapterRoot } from "../src/shells/obsidian/plugin.ts";
import { NodeWorkspaceStorage } from "../src/shells/web/nodeStorage.ts";
import { createPithWebServer } from "../src/shells/web/server.ts";

test("web serves the real WOFF2 with an explicit font policy and reader styling", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pith-font-"));
  const server = await createPithWebServer({ workspaceDir: dir });
  try {
    const address = server.address(); assert.ok(address && typeof address !== "string");
    const base = `http://127.0.0.1:${address.port}`;
    const page = await fetch(base); const html = await page.text();
    assert.match(page.headers.get("content-security-policy")!, /font-src 'self'/);
    const font = await fetch(`${base}/fonts/lxgw-wenkai.woff2`);
    assert.equal(font.headers.get("content-type"), "font/woff2");
    const bytes = new Uint8Array(await font.arrayBuffer());
    assert.equal(Buffer.from(bytes.subarray(0, 4)).toString(), "wOF2");
    assert.ok(bytes.length > 1_000_000);
    for (const css of [html, obsidianStyles]) {
      assert.match(css, /Garden LXGW WenKai/);
      assert.match(css, /line-height:1\.95/);
      assert.match(css, /rgba\(235,\s*204,\s*102,\s*\.38\)/);
      assert.match(css, /#c59b38/);
      assert.match(css, /#9bbfa2/);
    }
    assert.match(obsidianStyles, /data:font\/woff2;base64,d09GMg/);
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); await rm(dir, { recursive: true, force: true }); }
});

test("Obsidian empty topic accepts an import and rejects replacement", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pith-obsidian-import-"));
  const storage = new NodeWorkspaceStorage(dir);
  const adapter = {
    exists: (path: string) => storage.exists(path), read: (path: string) => storage.readText(path),
    readBinary: async (path: string) => new Uint8Array(await storage.readBinary(path)).buffer,
    write: (path: string, value: string) => storage.writeText(path, value),
    writeBinary: (path: string, value: ArrayBuffer) => storage.writeBinary(path, new Uint8Array(value)),
    mkdir: (path: string) => storage.mkdir(path),
    list: async (path: string) => { const entries = await storage.list(path); return { files: entries.filter(entry => entry.type === "file").map(entry => entry.path), folders: entries.filter(entry => entry.type === "folder").map(entry => entry.path) }; },
  };
  const controller = new PithObsidianController(createObsidianHostPort(adapter));
  try {
    await controller.initialize();
    const topic = await controller.store.createTopic({ title: "阅读", nextAction: "阅读一节" });
    assert.equal((await controller.openCompass()).focusRecommendation!.topicId, topic.id);
    assert.equal((await controller.openTopic(topic.id))!.materialId, undefined);
    const input = { title: "source.md", kind: "article" as const, files: [{ name: "source.md", bytes: new TextEncoder().encode("# 标题\n\n正文。") }] };
    const material = await controller.importMaterial(input, topic.id);
    assert.equal((await controller.openTopic(topic.id))!.materialId, material.id);
    const rendered = await controller.renderMaterialFile(material.id, "source.md");
    assert.match(rendered.html, /正文/);
    await assert.rejects(controller.importMaterial(input, topic.id), /已有材料/);
    assert.equal((await controller.openTopic(topic.id))!.materialId, material.id);
    assert.equal((await controller.openCompass()).exploring.length, 1);
  } finally { controller.dispose(); await rm(dir, { recursive: true, force: true }); }
});

test("web dock selects a mounted toolkit and keeps the optional add control", async () => {
    const html = await readFile(new URL("../src/shells/web/server.ts", import.meta.url), "utf8");
    const source = html.match(/const renderTrainingWithControls=renderTraining;renderTraining=function\(\)\{[^\n]+/);
    assert.ok(source);
    const run = (mounted: string[]) => {
      const button = { textContent: "", title: "", classList: { toggle(_name: string, _value: boolean) {} }, setAttribute(_name: string, _value: string) {} };
      const read = { textContent: "" };
      const context = { renderTraining: () => {}, state: { dojos: ["shadowing", "feynman"] }, topic: { toolkits: mounted }, toolkit: "shadowing", speechActive: false, $: (selector: string) => selector === "#open-dojo" ? button : read };
      runInNewContext(`${source[0]}\nrenderTraining();`, context);
      return { button, read, toolkit: context.toolkit };
    };
    const empty = run([]); assert.equal(empty.button.textContent, "+"); assert.equal(empty.read.textContent, "🎧 听读本章");
    const feynman = run(["dojo-feynman"]); assert.equal(feynman.button.textContent, "费曼复述"); assert.equal(feynman.toolkit, "feynman");
});

test("chapter selection follows the viewport or selection and leaves ordinary documents whole", () => {
  const rect = (left: number, top: number, right: number, bottom: number) => ({ left, top, right, bottom });
  const first = { getClientRects: () => [rect(-800, 0, -1, 700)] };
  const second = { getClientRects: () => [rect(0, 0, 800, 700)] };
  const article = { querySelectorAll: () => [first, second], contains: (node: unknown) => node === first || node === second };
  const reader = { getBoundingClientRect: () => rect(0, 0, 800, 700) };
  const selected = { closest: () => first };
  assert.equal(speechChapterRoot(article as unknown as HTMLElement, reader as HTMLElement, null, true), second);
  assert.equal(speechChapterRoot(article as unknown as HTMLElement, reader as HTMLElement, selected as unknown as Element, true), first);
  const plain = { querySelectorAll: () => [] };
  assert.equal(speechChapterRoot(plain as unknown as HTMLElement, reader as HTMLElement, null, false), plain);
  second.getClientRects = () => [rect(0, 800, 800, 1500)];
  assert.equal(speechChapterRoot(article as unknown as HTMLElement, reader as HTMLElement, null, false), null);
});

test("Obsidian speech queues only the visible or selected EPUB chapter", async () => {
  const rect = (left: number, right: number) => ({ left, right, top: 0, bottom: 700 });
  const makeChapter = (left: number, texts: string[]) => {
    const chapter = { getClientRects: () => [rect(left, left + 800)], querySelectorAll: () => [] as object[] };
    const blocks = texts.map(text => ({ textContent: text, getAttribute: () => "true", closest: (selector: string) => selector === ".pith-epub-chapter" ? chapter : null, querySelector: () => null }));
    chapter.querySelectorAll = () => blocks;
    return { chapter, blocks };
  };
  const first = makeChapter(-800, ["A sentence."]), second = makeChapter(0, ["B first.", "B second."]);
  const article = { querySelectorAll: () => [first.chapter, second.chapter], contains: (value: unknown) => value === first.chapter || value === second.chapter, querySelectorAllMarks: () => [] };
  const reader = { getBoundingClientRect: () => rect(0, 800) };
  const run = async (selection: boolean): Promise<string[]> => {
    const spoken: string[] = []; let finished!: () => void;
    const done = new Promise<void>(resolve => { finished = resolve; });
    const view = Object.create(PithObsidianView.prototype) as Record<string, unknown>;
    const target = second.blocks[1]!;
    const element = { closest: (selector: string) => selector === "[data-prose]" ? target : null };
    const audio = { paused: false, onended: () => {}, onerror: () => {}, play() { this.onended(); return Promise.resolve(); }, pause() {}, removeAttribute() {}, load() {} };
    Object.assign(view, {
      article, reader, pageMode: "double", generation: 0, dojoActive: false, speaking: false,
      selectionRange: { startContainer: { nodeType: 3, parentElement: element }, startOffset: 0 },
      doc: { createRange: () => ({ selectNodeContents() {}, setEnd() {}, toString: () => "" }), createTreeWalker: () => ({ nextNode: () => null }), createElement: () => audio },
      dock: { classList: { add() {} }, querySelector: () => null },
      actions: { synthesizeSpeech: async (text: string) => { spoken.push(text); return { bytes: new Uint8Array([1]), mimeType: "audio/wav" }; } },
      clearSpeechMark() {}, stopSpeech() { if (view.speaking) finished(); },
    });
    (view.startSpeech as (selected: boolean) => void)(selection);
    await done;
    return spoken;
  };
  assert.deepEqual(await run(false), ["B first.", "B second."]);
  assert.deepEqual(await run(true), ["B second."]);
});

test("web navigation clears quoted state and cue clicks never mount shadowing", async () => {
  const source = await readFile(new URL("../src/shells/web/server.ts", import.meta.url), "utf8");
  const script = source.split("<script>")[1]!.split("</script>")[0]!.replace("refresh().then(home).catch(notify);", "");
  const handlers: Record<string, ((event: unknown) => unknown)[]> = {};
  const elements = new Map<string, Record<string, unknown>>();
  const element = (selector: string): Record<string, unknown> => {
    if (!elements.has(selector)) elements.set(selector, { style: {}, dataset: {}, hidden: false, innerHTML: "", value: "", disabled: false, classList: { toggle() {} }, setAttribute() {}, addEventListener() {}, focus() {}, prepend() {}, before() {}, insertAdjacentHTML() {}, append() {}, querySelectorAll: () => [] });
    return elements.get(selector)!;
  };
  const document = {
    querySelector: (selector: string) => elements.has(selector) ? elements.get(selector) : ["#training", "#article", ".reader"].includes(selector) ? null : element(selector),
    querySelectorAll: () => [],
    createElement: () => ({ ...element("template"), dataset: {}, classList: { toggle() {} } }),
    addEventListener: (name: string, fn: (event: unknown) => unknown) => { (handlers[name] ||= []).push(fn); },
  };
  const context = createContext({ document, window: { addEventListener() {} }, console, Intl, AbortController, URL, setTimeout, clearTimeout, FormData, calls: [] as unknown[] });
  runInContext(script, context);
  runInContext(`state={compass:{exploring:[{id:'a',toolkits:[],notes:[]},{id:'b',toolkits:[],notes:[]}],settled:[]},materials:[],plugins:[],dojos:['shadowing','feynman']};topic=state.compass.exploring[0];file='a.md';pending={file:'a.md',quote:'A'};selection=pending;selectionRange={};refresh=async()=>{};api=async(path,data)=>{calls.push({path,data});return []}`, context);
  const handler = handlers.click!.find(fn => String(fn).includes("t.dataset.open")); assert.ok(handler);
  const click = (button: Record<string, unknown>) => ({ target: { closest: (selector: string) => selector === "button" ? button : null } });
  await handler(click({ dataset: { open: "b" } }));
  assert.equal(runInContext("pending", context), null);
  assert.equal(runInContext("selectionRange", context), null);
  element("#message").value = "B message";
  await handler(click({ id: "send", dataset: {} }));
  const calls = runInContext("calls", context) as { path: string; data: { topicId?: string; anchor?: unknown } }[];
  const sent = calls.find(call => call.path === "/api/chat" && call.data); assert.ok(sent);
  assert.equal(sent.data.topicId, "b"); assert.equal(sent.data.anchor, undefined);

  let releaseChat!: () => void, releaseFile!: () => void, releaseOldFile!: () => void, chatStarted!: () => void, fileStarted!: () => void, oldFileStarted!: () => void;
  const chatGate = new Promise<void>(resolve => { releaseChat = resolve; });
  const fileGate = new Promise<void>(resolve => { releaseFile = resolve; });
  const oldFileGate = new Promise<void>(resolve => { releaseOldFile = resolve; });
  const chatWaiting = new Promise<void>(resolve => { chatStarted = resolve; });
  const fileWaiting = new Promise<void>(resolve => { fileStarted = resolve; });
  const oldFileWaiting = new Promise<void>(resolve => { oldFileStarted = resolve; });
  Object.assign(context, { chatGate, fileGate, oldFileGate, chatStarted, fileStarted, oldFileStarted });
  runInContext(`state.compass.exploring=[{id:'a',title:'A',materialId:'ma',toolkits:[],notes:[]},{id:'b',title:'B',materialId:'mb',toolkits:[],notes:[]}];state.materials=[{id:'ma',files:[{name:'same.md'}]},{id:'mb',files:[{name:'same.md'}]}];topic=state.compass.exploring[0];file='same.md';api=async(path,data)=>{calls.push({path,data});if(path.includes('/api/chat?topicId=b')){chatStarted();await chatGate;return []}if(path.includes('/api/materials/file?id=mb')){fileStarted();await fileGate;return {html:'B document',sections:[]}}if(path.includes('/api/materials/file?id=ma')){oldFileStarted();await oldFileGate;return {html:'A document',sections:[]}}return []}`, context);
  const navigating = handler(click({ dataset: { open: "b" } }));
  await chatWaiting;
  assert.equal(runInContext("topic.id", context), "a");
  runInContext("selection={file:'same.md',locator:'text:offset:0',quote:'A while loading'};selectionRange={}", context);
  const quoting = handler(click({ dataset: { action: "ask" } }));
  await oldFileWaiting;
  assert.equal(runInContext("pending.quote", context), "A while loading");
  releaseChat(); await fileWaiting;
  assert.equal(runInContext("topic.id", context), "a");
  releaseFile(); await navigating;
  assert.equal(runInContext("topic.id", context), "b");
  assert.equal(runInContext("pending", context), null);
  assert.equal(runInContext("selectionRange", context), null);
  assert.match(String(element("#main").innerHTML), /B document/);
  releaseOldFile(); await quoting;
  assert.match(String(element("#main").innerHTML), /B document/);
  runInContext("calls.length=0", context);
  element("#message").value = "B after loading";
  await handler(click({ id: "send", dataset: {} }));
  const afterLoad = (runInContext("calls", context) as { path: string; data?: { anchor?: unknown } }[]).find(call => call.path === "/api/chat" && call.data);
  assert.ok(afterLoad); assert.equal(afterLoad.data!.anchor, undefined);

  runInContext(`topic.materialId='m';state.materials=[{id:'m',files:[{name:'a.md'},{name:'b.md'}]}];file='a.md';pending={file:'a.md',quote:'A'};selection=pending;selectionRange={};api=async()=>({html:'',sections:[{title:'Deep heading',level:4,locator:'deep'}]})`, context);
  await handler(click({ dataset: { file: "b.md" } }));
  assert.equal(runInContext("pending", context), null);
  assert.equal(runInContext("selectionRange", context), null);
  assert.match(String(element("#navigation").innerHTML), /Deep heading/);
  runInContext("pending={file:'b.md',quote:'B'};selection=pending;selectionRange={}", context);
  await handler(click({ id: "home", dataset: {} }));
  assert.equal(runInContext("pending", context), null);
  assert.equal(runInContext("selectionRange", context), null);

  const cueHandler = handlers.click!.find(fn => String(fn).includes("const cue=e.target.closest('.pith-cue')")); assert.ok(cueHandler);
  runInContext("topic={id:'b',toolkits:['feynman']};trainingOpen=false;calls.length=0;transformTraining=async()=>{calls.push('transform')}", context);
  const cue = { textContent: "00:01 spoken", dataset: { locator: "time:1" }, querySelector: () => ({ textContent: "00:01" }) };
  const cueEvent = { target: { closest: (selector: string) => selector === ".pith-cue" ? cue : null } };
  await cueHandler(cueEvent);
  assert.equal(runInContext("trainingOpen", context), false);
  assert.equal(runInContext("calls.length", context), 0);
  runInContext("topic.toolkits=['shadowing']", context);
  await cueHandler(cueEvent);
  assert.equal(runInContext("trainingOpen", context), true);
  assert.deepEqual(Array.from(runInContext("calls", context) as string[]), ["transform"]);

  const trainingHandler = handlers.click!.find(fn => String(fn).includes("t.dataset.chooseDojo")); assert.ok(trainingHandler);
  runInContext("topic={id:'b',toolkits:[]};trainingOpen=false;trainingChoosing=false;calls.length=0;renderTraining=()=>{};api=async(path,data)=>{calls.push({path,data})};openTopic=async(id)=>{calls.push({opened:id})}", context);
  await trainingHandler(click({ id: "open-dojo", dataset: {} }));
  assert.equal(runInContext("trainingChoosing", context), true);
  assert.equal(runInContext("calls.length", context), 0);
  await trainingHandler(click({ dataset: { chooseDojo: "feynman" }, disabled: false }));
  const choice = runInContext("calls[0]", context) as { path: string; data: { toolkits: string[] } };
  assert.equal(choice.path, "/api/topics/b/toolkits");
  assert.deepEqual(Array.from(choice.data.toolkits), ["feynman"]);

  const makeChapter = (left: number, texts: string[]) => {
    const chapter = { getClientRects: () => [{ left, right: left + 800, top: 0, bottom: 700 }], querySelectorAll: () => [] as object[] };
    const blocks = texts.map(text => ({ textContent: text, dataset: { prose: "true" }, closest: (selector: string) => selector === ".pith-epub-chapter" ? chapter : null, querySelector: () => null }));
    chapter.querySelectorAll = () => blocks;
    return { chapter, blocks };
  };
  const first = makeChapter(-800, ["A."]), second = makeChapter(0, ["B first.", "B second."]);
  const article = { querySelectorAll: () => [first.chapter, second.chapter], contains: (value: unknown) => value === first.chapter || value === second.chapter };
  elements.set("#article", article);
  elements.set(".reader", { getBoundingClientRect: () => ({ left: 0, right: 800, top: 0, bottom: 700 }) });
  Object.assign(document, { createTreeWalker: () => ({ nextNode: () => null }), createRange: () => ({ selectNodeContents() {}, setEnd() {}, toString: () => "" }) });
  const audio = { onended: () => {}, onerror: () => {}, playbackRate: 1, play() { this.onended(); return Promise.resolve(); } };
  let finish!: () => void;
  Object.assign(context, { Node: { ELEMENT_NODE: 1 }, NodeFilter: { SHOW_TEXT: 4 }, Audio: function () { return audio; }, URL: { createObjectURL: () => "blob:test", revokeObjectURL() {} }, finish: () => finish() });
  runInContext("stopSpeech=()=>{if(speechActive){speechActive=false;finish()}};renderTraining=()=>{};speechGeneration=0;pageMode='double';speechRate=1;fetch=async(path,options)=>{calls.push(JSON.parse(options.body).text);return {ok:true,blob:async()=>({})}}", context);
  const speak = async (selected: boolean): Promise<string[]> => {
    runInContext("calls.length=0;speechActive=false", context);
    const done = new Promise<void>(resolve => { finish = resolve; });
    if (selected) {
      const block = second.blocks[1]!;
      Object.assign(context, { testRange: { startContainer: { nodeType: 3, parentElement: { closest: (selector: string) => selector === "[data-prose]" ? block : null } }, startOffset: 0 } });
      runInContext("selectionRange=testRange", context);
    }
    runInContext(`startSpeech(${selected})`, context);
    await done;
    return Array.from(runInContext("calls", context) as string[]);
  };
  assert.deepEqual(await speak(false), ["B first.", "B second."]);
  assert.deepEqual(await speak(true), ["B second."]);
});

test("Obsidian tool chooser and cue require explicit or existing toolkit", async () => {
  type FakeView = { dojos: unknown[]; mountedToolkits: string[]; dojoId: string; dojo: { hidden: boolean; innerHTML: string; append: (item: unknown) => void }; doc: { createElement: () => { dataset: Record<string, string>; textContent: string } }; actions: { mountDojo: (id: string) => Promise<void>; openDojo: () => void }; root: { contains: () => boolean }; article: { contains: () => boolean }; disposed: boolean; setDojoActive: () => void; renderDojo: () => void; refreshGuide: () => Promise<void>; openDojo: PithObsidianView["openDojo"]; click: (event: unknown) => Promise<void> };
  const view = Object.create(PithObsidianView.prototype) as FakeView;
  const added: { dataset: Record<string, string>; textContent: string }[] = [];
  const mounted: string[] = [];
  Object.assign(view, { mountedToolkits: [], dojoId: "", disposed: false, dojo: { hidden: true, innerHTML: "", append: (item: { dataset: Record<string, string>; textContent: string }) => added.push(item) }, doc: { createElement: () => ({ dataset: {}, textContent: "" }) }, actions: { mountDojo: async (id: string) => { mounted.push(id); }, openDojo: () => { throw new Error("cue opened an unmounted toolkit"); } }, root: { contains: () => true }, article: { contains: () => true }, setDojoActive() {}, renderDojo() {}, refreshGuide: async () => {} });
  const descriptors = [{ id: "shadowing", label: "影子跟读" }, { id: "feynman", label: "费曼复述" }] as unknown as Parameters<PithObsidianView["openDojo"]>[0];
  view.openDojo(descriptors);
  assert.equal(mounted.length, 0);
  assert.deepEqual(added.map(item => item.dataset.dojoChoose), ["shadowing", "feynman"]);
  const choice = { dataset: { dojoChoose: "feynman" }, disabled: false };
  await view.click({ target: { closest: (selector: string) => selector === "button" ? choice : null } });
  assert.deepEqual(mounted, ["feynman"]);
  view.mountedToolkits = ["feynman"];
  await view.click({ target: { closest: (selector: string) => selector === ".pith-cue" ? {} : null } });
  assert.deepEqual(mounted, ["feynman"]);
});

test("Obsidian home failure retains reader and stale toolkit mount cannot update another view", async () => {
  type FakeWorkspace = { controller: unknown; view: unknown; generation: number; homeRequest: number; contentEl: object; onOpen: () => Promise<void>; openTopic: (id: string) => Promise<void> };
  const workspace = Object.create(PithWorkspaceView.prototype) as FakeWorkspace;
  const original = {};
  let releases = 0;
  Object.assign(workspace, { generation: 2, homeRequest: 0, view: original, controller: { openCompass: async () => { throw new Error("offline"); }, releaseView: () => { releases++; } } });
  await assert.rejects(workspace.onOpen(), /offline/);
  assert.equal(workspace.view, original); assert.equal(workspace.generation, 2); assert.equal(releases, 0);

  let resolveLookup!: (value: unknown) => void;
  const lookup = new Promise(resolve => { resolveLookup = resolve; });
  const actions: { mountDojo?: (id: string) => Promise<void> }[] = [];
  const toolkitWrites: string[][] = [];
  let updates = 0;
  const topics = { a: { id: "a", title: "A", materialId: "m", toolkits: [] }, b: { id: "b", title: "B", materialId: "m", toolkits: [] } };
  const controller = {
    openTopic: async (id: "a" | "b") => topics[id],
    store: { getMaterial: async () => ({ id: "m", files: [{ name: "x.md" }] }), getTopic: () => lookup, updateTopic: async () => { updates++; return topics.a; } },
    runtime: { getService: () => undefined },
    createView: (_root: unknown, action: { mountDojo?: (id: string) => Promise<void> }) => { actions.push(action); const writes: string[] = []; toolkitWrites.push(writes); return { setToolkits: (ids: readonly string[]) => { writes.push(...ids); }, render() {}, refreshGuide: async () => {} }; },
    releaseView() {}, renderMaterialFile: async () => ({ html: "", sections: [] }),
  };
  Object.assign(workspace, { generation: 0, view: null, controller, contentEl: {} });
  await workspace.openTopic("a");
  const pendingMount = actions[0]!.mountDojo!("feynman");
  await workspace.openTopic("b");
  resolveLookup(topics.a);
  await assert.rejects(pendingMount, /课题已切换/);
  assert.equal(updates, 0); assert.deepEqual(toolkitWrites[1], []);
});

test("Obsidian guide refresh synchronizes mounted toolkits and ignores older responses", async () => {
  const view = Object.create(PithObsidianView.prototype) as Record<string, unknown>;
  const button = { textContent: "", title: "", classList: { toggle() {} }, setAttribute() {} };
  let resolveOld!: (value: unknown) => void;
  const old = new Promise(resolve => { resolveOld = resolve; });
  let requests = 0;
  const snapshot = (toolkits: string[]) => ({ notes: [], conversation: [], actions: [], toolkits });
  Object.assign(view, { disposed: false, guideGeneration: 0, mountedToolkits: [], dojoId: "", dock: { querySelector: () => button }, actions: { guideData: () => ++requests === 1 ? old : Promise.resolve(snapshot(["feynman"])) }, renderGuide() {}, markExisting() {} });
  const refresh = view.refreshGuide as () => Promise<void>;
  const first = refresh.call(view);
  await refresh.call(view);
  assert.equal(button.textContent, "费曼复述");
  assert.deepEqual(view.mountedToolkits, ["feynman"]);
  resolveOld(snapshot([])); await first;
  assert.equal(button.textContent, "费曼复述");
  assert.deepEqual(view.mountedToolkits, ["feynman"]);
});

test("Obsidian guide snapshot and already-mounted action update the originating view", async () => {
  type Workspace = { controller: unknown; view: unknown; generation: number; homeRequest: number; contentEl: object; openTopic: (id: string) => Promise<void> };
  const workspace = Object.create(PithWorkspaceView.prototype) as Workspace;
  const current = { id: "a", title: "A", materialId: "m", toolkits: ["feynman"], notes: [] };
  let actions!: { guideData: () => Promise<{ toolkits: readonly string[] }>; mountDojo: (id: string) => Promise<void> };
  const writes: string[][] = [];
  let updates = 0;
  const controller = {
    openTopic: async () => ({ ...current, toolkits: [] }),
    store: { getMaterial: async () => ({ id: "m", files: [{ name: "x.md" }] }), getTopic: async () => current, updateTopic: async () => { updates++; return current; } },
    runtime: { getService: () => undefined }, engine: { getConversation: async () => [] },
    createView: (_root: unknown, value: typeof actions) => { actions = value; return { setToolkits: (ids: readonly string[]) => { writes.push([...ids]); }, render() {}, refreshGuide: async () => {} }; },
    releaseView() {}, renderMaterialFile: async () => ({ html: "", sections: [] }),
  };
  Object.assign(workspace, { generation: 0, homeRequest: 0, view: null, contentEl: {}, controller });
  await workspace.openTopic("a");
  assert.deepEqual((await actions.guideData()).toolkits, ["feynman"]);
  await actions.mountDojo("feynman");
  assert.equal(updates, 0);
  assert.deepEqual(writes, [[], ["feynman"]]);
});
