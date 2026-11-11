import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PithObsidianView } from "../src/shells/obsidian/plugin.ts";
import { PithGuideView, PithWorkspaceView } from "../src/shells/obsidian/index.ts";
import { readerPageIndex } from "../src/plugins/stage-reader/pagination.ts";


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
  const reader = { clientWidth: 1280, scrollWidth: 5072, scrollLeft: 3792, scrollTo(value: { left: number }) { this.scrollLeft = Math.min(this.scrollWidth - this.clientWidth, value.left); } };
  const counter = { textContent: "" };
  Object.assign(view, { paged: true, reader, root: { querySelector: () => counter } });
  (view as unknown as { updatePageCount(): void }).updatePageCount();
  assert.equal(counter.textContent, "4 / 4");
  assert.equal(readerPageIndex(reader as HTMLElement), 3);
  reader.scrollWidth = 1280 * 30; reader.scrollLeft = 1280 * 14 - .25;
  (view as unknown as { updatePageCount(): void }).updatePageCount();
  assert.equal(counter.textContent, "15 / 30");
  assert.equal(readerPageIndex(reader as HTMLElement), 14);
  reader.scrollLeft = 1280 * 2 + 640 - 1;
  (view as unknown as { updatePageCount(): void }).updatePageCount();
  assert.equal(counter.textContent, "3 / 30");
  reader.scrollWidth = 1281; reader.scrollLeft = 0;
  (view as unknown as { updatePageCount(): void }).updatePageCount();
  assert.equal(counter.textContent, "1 / 2");
  view.paged = false;
  view.turnPage(1);
  assert.equal(reader.scrollLeft, 0);
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
  const input = { files: [{ name: "comic.CBZ", type: "application/zip", arrayBuffer: async () => new Uint8Array([1, 2]).buffer }], onchange: () => {}, click() {} };
  const status = { textContent: "" }, selected = { replaceChildren() {}, append() {} }, buttons = [{ disabled: false }, { disabled: false }], fileButton = {};
  const form = { elements: { namedItem: () => ({ value: "" }) }, onsubmit: (_event: unknown) => {}, querySelector: (s: string) => s === 'input[type="file"]' ? input : s === ".pith-home-status" ? status : s === "[data-intake-selected]" ? selected : fileButton, querySelectorAll: () => buttons };
  const root = { classList: { add() {} }, innerHTML: "", querySelector: (s: string) => s === ".pith-intake-box" ? form : null, querySelectorAll: () => [] };
  const workspace = Object.create(PithWorkspaceView.prototype) as Record<string, unknown>;
  Object.assign(workspace, { generation: 0, homeRequest: 0, view: null, contentEl: root, controller: { openCompass: async () => ({ exploring: [], settled: [] }), openBoardMaterials: async () => [], importMaterial: async (value: { kind: string; files: { name: string }[] }) => { finish(value); return { id: "m" }; }, store: { createTopic: async () => ({ id: "t" }) } }, openTopic: async () => {} });
  await (workspace.onOpen as () => Promise<void>)();
  const originalDocument = globalThis.document;
  Object.assign(globalThis, { document: { createElement: () => ({ append() {}, setAttribute() {} }), createTextNode: (text: string) => text } });
  try { input.onchange(); form.onsubmit({ preventDefault() {} }); const value = await imported;
  assert.equal(value.kind, "book"); assert.equal(value.files[0]!.name, "comic.CBZ");
  } finally { Object.assign(globalThis, { document: originalDocument }); }
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
  {
    const source = (await Promise.all(["../src/workbench/view.ts", "../src/workbench/view/toolbar.ts"].map(path => readFile(new URL(path, import.meta.url), "utf8")))).join("\n");
    assert.doesNotMatch(source, /从此句朗读|caretRangeFromPoint|data-(?:action|selection)="speak"/);
    for (const action of ["highlight", "note", "ask", "copy"]) assert.match(source, new RegExp(`data-(?:action|selection)="${action}"`));
  }
});
