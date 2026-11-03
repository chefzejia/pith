import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { PithObsidianView } from "../src/shells/obsidian/plugin.ts";
import { PithGuideView, PithWorkspaceView } from "../src/shells/obsidian/index.ts";

function speechFixture(withSecondChapter: boolean) {
  const rect = (left: number, right: number) => ({ left, right, top: 0, bottom: 100 });
  const firstNode = { data: "。later", positions: [rect(10, 20), rect(1300, 1350)] };
  const secondNode = { data: "Visible", positions: [rect(400, 500)] };
  const block = (node: typeof firstNode) => ({ textContent: node.data, node, getClientRects: () => node.positions });
  const firstBlock = block(firstNode), secondBlock = block(secondNode);
  const chapter = (block: typeof firstBlock, left: number) => ({ getClientRects: () => [rect(left, left + 300)], querySelectorAll: () => [block] });
  const first = chapter(firstBlock, 0), second = chapter(secondBlock, 400);
  const chapters = withSecondChapter ? [first, second] : [first];
  const article = { querySelectorAll: (selector: string) => selector === ".pith-epub-chapter" ? chapters : [], contains: () => true };
  const reader = { getBoundingClientRect: () => rect(0, 1280) };
  const doc = {
    createTreeWalker: (item: { node: typeof firstNode }) => { let used = false; return { nextNode: () => { if (used) return null; used = true; return item.node; } }; },
    createRange: () => { let node = firstNode, start = 0; return { setStart(value: typeof firstNode, offset: number) { node = value; start = offset; }, setEnd() {}, getClientRects: () => [node.positions[node === firstNode && start > 0 ? 1 : 0]!] }; },
  };
  Object.assign(firstBlock, { ownerDocument: doc }); Object.assign(secondBlock, { ownerDocument: doc });
  return { article, reader, doc };
}

for (const shell of ["obsidian", "web"] as const) for (const withSecondChapter of [false, true]) test(`${shell}: visible characters ${withSecondChapter ? "in a later chapter are read" : "exclude punctuation before offscreen text"}`, async () => {
  const { article, reader, doc } = speechFixture(withSecondChapter);
  const messages: string[] = [], calls: string[] = [];
  if (shell === "obsidian") {
    const view = Object.create(PithObsidianView.prototype) as Record<string, unknown>;
    Object.assign(view, { article, reader, doc, paged: true, generation: 0, dojoActive: false, actions: { synthesizeSpeech: (text: string) => { calls.push(text); return new Promise(() => {}); } }, stopSpeech() {}, tip: (message: string) => messages.push(message), assetControls: {}, mediaDeck: { querySelector: () => null }, dock: { classList: { add() {} } } });
    (view.startSpeech as () => void)();
  } else {
    const source = await readFile(new URL("../src/shells/web/server.ts", import.meta.url), "utf8");
    const helpers = source.match(/^function (?:speechChapterRoot|visibleProse|speechPageChapter)\([^\n]+/gm); const speech = source.match(/function startSpeech\(\)\{[\s\S]*?\n\}/); assert.ok(helpers && speech);
    const context = { article, reader, document: doc, Intl, AbortController, $: (selector: string) => selector === "#article" ? article : reader, isPagedBook: () => true, notify: (message: string) => messages.push(message), stopSpeech() {}, renderTraining() {}, speechGeneration: 0, speechActive: false, speechAbort: null, fetch: (_url: string, init: { body: string }) => { calls.push(JSON.parse(init.body).text); return new Promise(() => {}); } };
    runInNewContext(`${helpers.join("\n")}\n${speech[0]}\nstartSpeech()`, context);
  }
  if (withSecondChapter) { assert.deepEqual(calls, ["Visible"]); assert.deepEqual(messages, []); }
  else { assert.deepEqual(calls, []); assert.deepEqual(messages, ["当前页面没有可朗读的正文段落"]); }
});

test("closing a guide while its leaf is being created removes only that leaf", async () => {
  let finish!: () => void, detached = 0, otherDetached = 0;
  const ready = new Promise<void>(resolve => { finish = resolve; });
  const guideView = Object.create(PithGuideView.prototype);
  const leaf: { view?: unknown; setViewState(): Promise<void>; detach(): void } = { async setViewState() { await ready; this.view = guideView; }, detach() { detached++; } };
  const other = { detach() { otherDetached++; } };
  const workspace = Object.create(PithWorkspaceView.prototype) as Record<string, unknown>;
  const view = {};
  Object.assign(workspace, { guideRequest: 0, view, workspace: { rightSplit: { collapse() { other.detach(); }, expand() {} }, getRightLeaf: () => leaf, getLeavesOfType: () => [], revealLeaf: async () => {} } });
  const show = workspace.showNativeGuide as (visible: boolean, view: unknown) => Promise<void>;
  const opening = show.call(workspace, true, view);
  await show.call(workspace, false, view);
  finish(); await opening;
  assert.equal(detached, 1); assert.equal(otherDetached, 0);
});

test("reopening while guide creation is pending shares the leaf and honors the latest request", async () => {
  let finish!: () => void, detached = 0, created = 0, mounted = 0, revealed = 0;
  const ready = new Promise<void>(resolve => { finish = resolve; });
  const guideView = Object.assign(Object.create(PithGuideView.prototype), { mount() { mounted++; } });
  const leaf: { view?: unknown; setViewState(): Promise<void>; detach(): void } = { async setViewState() { await ready; this.view = guideView; }, detach() { detached++; } };
  const workspace = Object.create(PithWorkspaceView.prototype) as Record<string, unknown>;
  const view = { guideElement: () => ({}), focusQuotedGuide() {} };
  Object.assign(workspace, { guideRequest: 0, view, workspace: { rightSplit: { collapse() {}, expand() {} }, getRightLeaf: () => { created++; return leaf; }, getLeavesOfType: () => leaf.view ? [leaf] : [], revealLeaf: async () => { revealed++; } } });
  const show = workspace.showNativeGuide as (visible: boolean, view: unknown) => Promise<void>;
  const first = show.call(workspace, true, view);
  await show.call(workspace, false, view);
  const latest = show.call(workspace, true, view);
  finish(); await Promise.all([first, latest]);
  assert.equal(created, 1); assert.equal(detached, 0); assert.equal(mounted, 1); assert.equal(revealed, 1);
});

test("a replaced non-Pith leaf is never detached when an outdated opening completes", async () => {
  let finish!: () => void, detached = 0;
  const ready = new Promise<void>(resolve => { finish = resolve; });
  const leaf = { view: {} as unknown, async setViewState() { await ready; }, detach() { detached++; } };
  const workspace = Object.create(PithWorkspaceView.prototype) as Record<string, unknown>;
  const view = {};
  Object.assign(workspace, { guideRequest: 0, view, workspace: { rightSplit: { collapse() {}, expand() {} }, getRightLeaf: () => leaf, getLeavesOfType: () => [], revealLeaf: async () => {} } });
  const show = workspace.showNativeGuide as (visible: boolean, view: unknown) => Promise<void>;
  const opening = show.call(workspace, true, view); await show.call(workspace, false, view);
  finish(); await opening;
  assert.equal(detached, 0);
});

test("failed guide creation after close detaches its Pith leaf and retains the original error", async () => {
  let finish!: () => void, detached = 0;
  const ready = new Promise<void>(resolve => { finish = resolve; });
  const leaf: { view?: unknown; setViewState(): Promise<void>; detach(): void } = { async setViewState() { await ready; this.view = Object.create(PithGuideView.prototype); throw new Error("creation failed"); }, detach() { detached++; } };
  const workspace = Object.create(PithWorkspaceView.prototype) as Record<string, unknown>;
  const view = {};
  Object.assign(workspace, { guideRequest: 0, view, workspace: { rightSplit: { collapse() {}, expand() {} }, getRightLeaf: () => leaf, getLeavesOfType: () => [], revealLeaf: async () => {} } });
  const show = workspace.showNativeGuide as (visible: boolean, view: unknown) => Promise<void>;
  const opening = show.call(workspace, true, view); await show.call(workspace, false, view);
  finish(); await assert.rejects(opening, /creation failed/);
  assert.equal(detached, 1);
});

test("book page turns are horizontal and articles keep native scrolling", () => {
  const view = Object.create(PithObsidianView.prototype) as { paged: boolean; turnPage(direction: number): void };
  const reader = { clientWidth: 1280, scrollWidth: 5072, scrollLeft: 3792, scrollTo(value: { left: number }) { this.scrollLeft = Math.min(3792, value.left); } };
  const counter = { textContent: "" };
  Object.assign(view, { paged: true, reader, root: { querySelector: () => counter } });
  (view as unknown as { updatePageCount(): void }).updatePageCount();
  assert.equal(counter.textContent, "4 / 4");
  view.turnPage(-1); assert.equal(reader.scrollLeft, 2560);
  view.turnPage(1); assert.equal(reader.scrollLeft, 3792);
  reader.scrollWidth = 1281; reader.scrollLeft = 0;
  (view as unknown as { updatePageCount(): void }).updatePageCount();
  assert.equal(counter.textContent, "1 / 2");
  view.paged = false;
  view.turnPage(1);
  assert.equal(reader.scrollLeft, 0);
});

test("web page count and previous page handle a truncated final page", async () => {
  const source = await readFile(new URL("../src/shells/web/server.ts", import.meta.url), "utf8");
  const functions = source.match(/^function (?:pageIndex|updatePageCount|turnPage)\([^\n]+/gm); assert.ok(functions);
  const reader = { clientWidth: 1280, scrollWidth: 5072, scrollLeft: 3792, scrollTo(value: { left: number }) { this.scrollLeft = Math.min(3792, value.left); } };
  const counter = { textContent: "" };
  const context = { reader, counter, $: (selector: string) => selector === ".reader" ? reader : counter, isPagedBook: () => true };
  runInNewContext(`${functions.join("\n")}\nupdatePageCount();turnPage(-1);`, context);
  assert.equal(counter.textContent, "4 / 4"); assert.equal(reader.scrollLeft, 2560);
  reader.scrollWidth = 1281; reader.scrollLeft = 0;
  runInNewContext(`${functions.join("\n")}\nupdatePageCount();`, context);
  assert.equal(counter.textContent, "1 / 2");
});

test("prose visibility accounts for all fragments and excludes touching edges", async () => {
  const source = await readFile(new URL("../src/shells/web/server.ts", import.meta.url), "utf8");
  const helper = source.match(/^function visibleProse\([^\n]+/m); assert.ok(helper);
  const reader = { getBoundingClientRect: () => ({ left: 0, right: 1280, top: 0, bottom: 700 }) };
  let rects = [{ left: 1280, right: 2000, top: 0, bottom: 700 }];
  const block = { ownerDocument: { createTreeWalker: () => { let used = false; return { nextNode: () => { if (used) return null; used = true; return { data: "text" }; } }; }, createRange: () => ({ setStart() {}, setEnd() {}, getClientRects: () => rects }) } };
  const context = { reader, block };
  assert.equal(runInNewContext(`${helper[0]};visibleProse(block,reader)`, context), false);
  rects = [{ left: -500, right: 0, top: 0, bottom: 700 }, { left: 10, right: 50, top: 10, bottom: 30 }];
  assert.equal(runInNewContext(`${helper[0]};visibleProse(block,reader)`, context), true);
});

test("book speech refuses a page whose only prose is on a later page in both shells", async () => {
  const rect = (left: number, right: number) => ({ left, right, top: 0, bottom: 700 });
  const block = { textContent: "Later text.", ownerDocument: { createTreeWalker: () => { let used = false; return { nextNode: () => { if (used) return null; used = true; return { data: "Later text." }; } }; }, createRange: () => ({ setStart() {}, setEnd() {}, getClientRects: () => [rect(1280, 2000)] }) } };
  const chapter = { getClientRects: () => [rect(0, 1280), rect(1280, 2560)], querySelectorAll: () => [block] };
  const article = { querySelectorAll: (selector: string) => selector === ".pith-epub-chapter" ? [chapter] : [] };
  const reader = { getBoundingClientRect: () => rect(0, 1280) };
  const messages: string[] = []; let calls = 0;
  const view = Object.create(PithObsidianView.prototype) as Record<string, unknown>;
  Object.assign(view, { article, reader, paged: true, actions: { synthesizeSpeech: () => { calls++; } }, stopSpeech() {}, tip: (message: string) => messages.push(message) });
  (view.startSpeech as () => void)();
  assert.equal(calls, 0); assert.deepEqual(messages, ["当前页面没有可朗读的正文段落"]);
  const source = await readFile(new URL("../src/shells/web/server.ts", import.meta.url), "utf8");
  const chapterFn = source.match(/^function speechChapterRoot\([^\n]+/m); const speechFn = source.match(/function startSpeech\(\)\{[\s\S]*?\n\}/); assert.ok(chapterFn && speechFn);
  const helper = source.match(/^function (?:visibleProse|speechPageChapter)\([^\n]+/gm);
  const context = { article, reader, Intl, AbortController, $: (selector: string) => selector === "#article" ? article : reader, isPagedBook: () => true, notify: (message: string) => messages.push(message), stopSpeech() {}, fetch: () => { calls++; } };
  runInNewContext(`${chapterFn[0]}\n${helper ? helper.join("\n") : ""}\n${speechFn[0]}\nstartSpeech()`, context);
  assert.equal(calls, 0); assert.equal(messages[1], "当前页面没有可朗读的正文段落");
});

test("hiding a guide only detaches Pith leaves and never collapses other sidebars", async () => {
  let collapsed = 0, detached = 0;
  const guide = { detach() { detached++; } };
  const workspace = Object.create(PithWorkspaceView.prototype) as Record<string, unknown>;
  let leaves: unknown[] = [];
  Object.assign(workspace, { guideRequest: 0, workspace: { rightSplit: { collapse() { collapsed++; }, expand() {} }, getRightLeaf() {}, getLeavesOfType: () => leaves } });
  await (workspace.showNativeGuide as (visible: boolean, view: unknown) => Promise<void>)(false, {});
  leaves = [guide]; await (workspace.showNativeGuide as (visible: boolean, view: unknown) => Promise<void>)(false, {});
  assert.equal(collapsed, 0); assert.equal(detached, 1);
});

test("Obsidian import accepts CBZ and sends it as a book", async () => {
  let finish!: (input: { kind: string; files: { name: string }[] }) => void;
  const imported = new Promise<{ kind: string; files: { name: string }[] }>(resolve => { finish = resolve; });
  const input = { files: [{ name: "comic.CBZ", type: "application/zip", arrayBuffer: async () => new Uint8Array([1, 2]).buffer }], value: "", onchange: () => {}, click() {} };
  const form = {}, status = {}, button = {};
  const root = { ownerDocument: {}, classList: { add() {} }, innerHTML: "", querySelector: (s: string) => s === 'input[type="file"]' ? input : s === "form" ? form : s === ".pith-home-status" ? status : button, querySelectorAll: () => [] };
  const workspace = Object.create(PithWorkspaceView.prototype) as Record<string, unknown>;
  Object.assign(workspace, { generation: 0, homeRequest: 0, view: null, contentEl: root, controller: { openCompass: async () => ({ exploring: [], settled: [] }), importMaterial: async (value: { kind: string; files: { name: string }[] }) => { finish(value); return { id: "m" }; }, store: { createTopic: async () => ({ id: "t" }) } }, openTopic: async () => {} });
  await (workspace.onOpen as () => Promise<void>)();
  assert.match(root.innerHTML, /accept="[^"]*\.cbz/);
  input.onchange(); const value = await imported;
  assert.equal(value.kind, "book"); assert.equal(value.files[0]!.name, "comic.CBZ");
});

test("single and double book modes both paginate, with narrow double falling back", () => {
  const view = Object.create(PithObsidianView.prototype) as Record<string, unknown>;
  const styles = () => ({ setProperty() {}, removeProperty() {} });
  const body = { style: styles() as Record<string, unknown>, ownerDocument: { defaultView: null }, querySelectorAll: () => [] };
  const classes = new Map<string, boolean>();
  const reader = { clientWidth: 1000, clientHeight: 700, scrollWidth: 2200, scrollLeft: 0, style: styles(), classList: { toggle: (key: string, value: boolean) => classes.set(key, value) } };
  const modes = { hidden: true }, pages = { hidden: true }, double = { disabled: false }, count = { textContent: "" };
  const root = { clientWidth: 1000, clientHeight: 700, dataset: {}, querySelector: (selector: string) => ({ '[data-mode="double"]': double, "[data-pages]": pages, "[data-page-modes]": modes, "[data-page-count]": count } as Record<string, unknown>)[selector] };
  Object.assign(view, { root, reader, article: body, win: { matchMedia: () => ({ matches: false }) }, paged: true, pageMode: "single" });
  (view.applyPageMode as () => void)();
  assert.equal(classes.get("pith-paged"), true);
  assert.equal(body.style.columnWidth, "904px");
  assert.equal(count.textContent, "1 / 3");
  assert.equal(pages.hidden, false);
  view.pageMode = "double";
  (view.applyPageMode as () => void)();
  assert.equal(body.style.columnWidth, "404px");
  root.clientWidth = 600; reader.clientWidth = 600;
  (view.applyPageMode as () => void)();
  assert.equal(double.disabled, true);
  assert.equal(body.style.columnWidth, "540px");
  view.paged = false;
  (view.applyPageMode as () => void)();
  assert.equal(classes.get("pith-paged"), false);
  assert.equal(pages.hidden, true);
  assert.equal(modes.hidden, true);
});

test("empty prose never requests speech and reports the empty page", () => {
  const messages: string[] = []; let calls = 0;
  const view = Object.create(PithObsidianView.prototype) as Record<string, unknown>;
  Object.assign(view, {
    article: { querySelectorAll: () => [] }, reader: {}, paged: true,
    actions: { synthesizeSpeech: () => { calls++; } }, stopSpeech() {}, tip: (message: string) => messages.push(message),
  });
  (view.startSpeech as () => void)();
  assert.equal(calls, 0);
  assert.deepEqual(messages, ["当前页面没有可朗读的正文段落"]);
});

test("Obsidian maps a TTS connection failure to the configuration guidance", async () => {
  let synthesize: ((text: string, signal: AbortSignal) => Promise<unknown>) | undefined;
  const workspace = Object.create(PithWorkspaceView.prototype) as Record<string, unknown>;
  const controller = {
    openTopic: async () => ({ id: "topic", title: "Book", materialId: "material", toolkits: [] }),
    store: { getMaterial: async () => ({ id: "material", files: [{ name: "book.epub" }] }) },
    runtime: { getService: (id: string) => id === "speech.tts" ? { synthesizeSpeech: async () => { throw new Error("connect ECONNREFUSED 127.0.0.1:8880"); } } : undefined },
    createView: (_root: unknown, actions: { synthesizeSpeech: typeof synthesize }) => { synthesize = actions.synthesizeSpeech; return { setGuideVisible() {}, setToolkits() {}, render() {}, refreshGuide: async () => {} }; },
    renderMaterialFile: async () => ({ html: "", sections: [], format: "epub" }),
    releaseView() {},
  };
  Object.assign(workspace, { controller, generation: 0, view: null, contentEl: {}, guideByTopic: new Map() });
  await (workspace.openTopic as (id: string) => Promise<void>)("topic");
  assert.ok(synthesize);
  await assert.rejects(synthesize("sentence", new AbortController().signal), error => {
    assert.ok(error instanceof Error);
    assert.equal(error.message, "未连接可用的语音服务，请先启动本地语音服务或在设置中配置云端 TTS");
    assert.doesNotMatch(error.message, /ECONNREFUSED/);
    return true;
  });
});

test("both shells remove single-click speech and expose the four selection actions", async () => {
  for (const path of ["../src/shells/obsidian/plugin.ts", "../src/shells/web/server.ts"]) {
    const source = await readFile(new URL(path, import.meta.url), "utf8");
    assert.doesNotMatch(source, /从此句朗读|caretRangeFromPoint|data-(?:action|selection)="speak"/);
    for (const action of ["highlight", "note", "ask", "copy"]) assert.match(source, new RegExp(`data-(?:action|selection)="${action}"`));
  }
});

test("web format decision only pages books", async () => {
  const source = await readFile(new URL("../src/shells/web/server.ts", import.meta.url), "utf8");
  const fn = source.match(/^function isPagedBook\(\).*$/m);
  assert.ok(fn);
  for (const format of ["epub", "pdf", "cbz"]) assert.equal(runInNewContext(`let readerFormat=${JSON.stringify(format)};${fn[0]};isPagedBook()`), true);
  for (const format of ["markdown", "image", ""]) assert.equal(runInNewContext(`let readerFormat=${JSON.stringify(format)};${fn[0]};isPagedBook()`), false);
  assert.match(source, /if\(!isPagedBook\(\)\|\|!e\.target\.closest\('\.reader'\)/);
  assert.match(source, /未连接可用的语音服务，请先启动本地语音服务或在设置中配置云端 TTS/);
});
