import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
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
    assert.match(html, /Garden LXGW WenKai/);
    const script = await (await fetch(`${base}/app.js`)).text();
    for (const css of [script, obsidianStyles]) {
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
    getFullPath: (path: string) => join(dir, path),
    exists: (path: string) => storage.exists(path), read: (path: string) => storage.readText(path),
    readBinary: async (path: string) => new Uint8Array(await storage.readBinary(path)).buffer,
    write: (path: string, value: string) => storage.writeText(path, value),
    writeBinary: (path: string, value: ArrayBuffer) => storage.writeBinary(path, new Uint8Array(value)),
    mkdir: (path: string) => storage.mkdir(path),
    list: async (path: string) => { const entries = await storage.list(path); return { files: entries.filter(entry => entry.type === "file").map(entry => entry.path), folders: entries.filter(entry => entry.type === "folder").map(entry => entry.path) }; },
  };
  const controller = new PithObsidianController(createObsidianHostPort(adapter, "Pith", undefined, adapter));
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

test("Obsidian speech queues only the visible EPUB chapter", async () => {
  const rect = (left: number, right: number) => ({ left, right, top: 0, bottom: 700 });
  const makeChapter = (left: number, texts: string[]) => {
    const chapter = { getClientRects: () => [rect(left, left + 800)], querySelectorAll: () => [] as object[] };
    const blocks = texts.map(text => ({ textContent: text, ownerDocument: { createTreeWalker: () => { let done = false; return { nextNode: () => { if (done) return null; done = true; return { data: text, length: text.length, parentElement: null }; } }; } }, getAttribute: () => "true", closest: (selector: string) => selector === ".pith-epub-chapter" ? chapter : null, querySelector: () => null }));
    chapter.querySelectorAll = () => blocks;
    return { chapter, blocks };
  };
  const first = makeChapter(-800, ["A sentence."]), second = makeChapter(0, ["B first.", "B second."]);
  const article = { querySelectorAll: (selector: string) => selector === ".pith-epub-chapter" ? [first.chapter, second.chapter] : [], contains: (value: unknown) => value === first.chapter || value === second.chapter, querySelectorAllMarks: () => [] };
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
      doc: { createRange: () => ({ selectNodeContents() {}, setStart() {}, setEnd() {}, surroundContents() {}, toString: () => "" }), createTreeWalker: () => ({ nextNode: () => null }), createElement: (tag: string) => tag === "audio" ? audio : { dataset: {} } },
      dock: { classList: { add() {} }, querySelector: () => null },
      assetControls: { hidden: true }, mediaDeck: { hidden: true, querySelector: () => null },
      actions: { synthesizeSpeech: async (text: string) => { spoken.push(text); return { bytes: new Uint8Array([1]), mimeType: "audio/wav" }; } },
      clearSpeechMark() {}, stopSpeech() {}, finishSpeech() { finished(); },
    });
    (view.startSpeech as (selected: boolean) => void)(selection);
    await done;
    return spoken;
  };
  assert.deepEqual(await run(false), ["B first.", "B second."]);
});

test("Obsidian tool chooser and cue require explicit or existing toolkit", async () => {
  type FakeView = { dojos: unknown[]; mountedToolkits: string[]; dojoId: string; dojo: { hidden: boolean; innerHTML: string; append: (item: unknown) => void }; doc: { createElement: () => { dataset: Record<string, string>; textContent: string } }; actions: { mountDojo: (id: string) => Promise<void>; openDojo: () => void }; root: { contains: () => boolean }; article: { contains: () => boolean }; disposed: boolean; setDojoActive: () => void; renderDojo: () => void; refreshGuide: () => Promise<void>; openDojo: PithObsidianView["openDojo"]; click: (event: unknown) => Promise<void> };
  const view = Object.create(PithObsidianView.prototype) as FakeView;
  const added: { dataset: Record<string, string>; textContent: string }[] = [];
  const mounted: string[] = [];
  Object.assign(view, { mountedToolkits: [], dojoId: "", disposed: false, voice: { cancel() {} }, dojo: { hidden: true, innerHTML: "", append: (item: { dataset: Record<string, string>; textContent: string }) => added.push(item) }, doc: { createElement: () => ({ dataset: {}, textContent: "" }) }, actions: { mountDojo: async (id: string) => { mounted.push(id); }, openDojo: () => { throw new Error("cue opened an unmounted toolkit"); } }, root: { contains: () => true }, article: { contains: () => true, querySelectorAll: () => [] }, reader: { getBoundingClientRect: () => ({}) }, setDojoActive() {}, renderDojo() {}, tip() {}, refreshGuide: async () => {} });
  const descriptors = [{ id: "shadowing", label: "影子跟读" }, { id: "feynman", label: "费曼复述" }] as unknown as Parameters<PithObsidianView["openDojo"]>[0];
  view.openDojo(descriptors);
  assert.equal(mounted.length, 0);
  assert.equal(added.length, 0);
  view.mountedToolkits = ["shadowing", "feynman"];
  view.openDojo(descriptors);
  assert.deepEqual(added.map(item => item.dataset.dojoChoose), ["shadowing", "feynman"]);
  const choice = { dataset: { dojoChoose: "feynman" }, disabled: false };
  await view.click({ target: { closest: (selector: string) => selector === "button" ? choice : null } });
  assert.deepEqual(mounted, []); assert.equal(view.dojoId, "feynman");
  view.mountedToolkits = [];
  await view.click({ target: { closest: (selector: string) => selector === ".pith-cue" ? {} : null } });
  assert.deepEqual(mounted, []);
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
    createView: (_root: unknown, action: { mountDojo?: (id: string) => Promise<void> }) => { actions.push(action); const writes: string[] = []; toolkitWrites.push(writes); return { setGuideVisible() {}, setToolkits: (ids: readonly string[]) => { writes.push(...ids); }, render() {}, refreshGuide: async () => {} }; },
    releaseView() {}, renderMaterialFile: async () => ({ html: "", sections: [] }),
  };
  Object.assign(workspace, { generation: 0, view: null, controller, contentEl: {}, guideByTopic: new Map() });
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
  Object.assign(view, { disposed: false, guideGeneration: 0, mountedToolkits: [], dojos: [], dojoId: "", dock: { querySelector: () => button }, actions: { guideData: () => ++requests === 1 ? old : Promise.resolve(snapshot(["feynman"])) }, renderGuide() {}, markExisting() {} });
  const refresh = view.refreshGuide as () => Promise<void>;
  const first = refresh.call(view);
  await refresh.call(view);
  assert.equal(button.textContent, "🛠 费曼复述");
  assert.deepEqual(view.mountedToolkits, ["feynman"]);
  resolveOld(snapshot([])); await first;
  assert.equal(button.textContent, "🛠 费曼复述");
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
    openCompass: async () => ({}),
    store: { getMaterial: async () => ({ id: "m", files: [{ name: "x.md" }] }), getTopic: async () => current, updateTopic: async () => { updates++; return current; } },
    runtime: { getService: () => undefined }, engine: { getConversation: async () => [] },
    createView: (_root: unknown, value: typeof actions) => { actions = value; return { setGuideVisible() {}, setToolkits: (ids: readonly string[]) => { writes.push([...ids]); }, render() {}, refreshGuide: async () => {} }; },
    releaseView() {}, renderMaterialFile: async () => ({ html: "", sections: [] }),
  };
  Object.assign(workspace, { generation: 0, homeRequest: 0, view: null, contentEl: {}, controller, guideByTopic: new Map() });
  await workspace.openTopic("a");
  assert.deepEqual((await actions.guideData()).toolkits, ["feynman"]);
  await actions.mountDojo("feynman");
  assert.equal(updates, 0);
  assert.deepEqual(writes, [[], ["feynman"]]);
});
