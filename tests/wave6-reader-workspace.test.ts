import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createContext, runInContext } from "node:vm";
import { PithObsidianController, PithWorkspaceView, createObsidianHostPort, validateWorkspacePath } from "../src/shells/obsidian/index.ts";
import { PithObsidianView, obsidianStyles } from "../src/shells/obsidian/plugin.ts";
import { NodeWorkspaceStorage } from "../src/shells/web/nodeStorage.ts";

test("Obsidian initializes under its own directory and rejects escaping roots", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pith-wave6-"));
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
    for (const path of ["Pith/ME.md", "Pith/topics", "Pith/materials", "Pith/_cache"]) assert.equal(await storage.exists(path), true, path);
    for (const path of ["ME.md", "topics", "materials", "_cache"]) assert.equal(await storage.exists(path), false, path);
    for (const value of ["", ".", "..", "/absolute", "../escape", "Pith/../escape", "Pith//x", "C:/outside", "Pith\\escape", "Pith/"]) assert.throws(() => validateWorkspacePath(value), /Invalid workspace root/, value);
    const nested = new PithObsidianController(createObsidianHostPort(adapter, "custom/nested", undefined, adapter));
    try { await nested.initialize(); assert.equal(await storage.exists("custom/nested/ME.md"), true); } finally { nested.dispose(); }
    await assert.rejects(createObsidianHostPort(adapter).storage.writeText("../escape", "bad"), /Invalid workspace path/);
    await mkdir(join(dir, "outside"));
    await symlink(join(dir, "outside"), join(dir, "link"));
    const linked = new PithObsidianController(createObsidianHostPort(adapter, "link/nested", undefined, adapter));
    try { await assert.rejects(linked.initialize(), /Symbolic links are not allowed/); } finally { linked.dispose(); }
  } finally { controller.dispose(); await rm(dir, { recursive: true, force: true }); }
});

test("selection opens the guide and records the user's topic preference", () => {
  const view = Object.create(PithObsidianView.prototype) as Record<string, unknown>;
  const recorded: boolean[] = [];
  Object.assign(view, { actions: { guideVisibilityChanged: (visible: boolean) => recorded.push(visible) }, guide: { querySelector: () => null }, setGuideVisible: (visible: boolean) => recorded.push(visible), renderGuide() {} });
  (view.quoteSelection as (anchor: object, tab: string) => void)({ file: "chapter", locator: "text:offset:0", quote: "text" }, "chat");
  assert.deepEqual(recorded, [true, true]);
  assert.doesNotMatch(obsidianStyles, /\.pith-dock-zone\{position:absolute/);
  assert.match(obsidianStyles, /\.pith-view-header\{height:44px/);
});

test("guide visibility is retained independently per topic and across chapters", async () => {
  const workspace = Object.create(PithWorkspaceView.prototype) as Record<string, unknown>;
  const states: boolean[] = [];
  const callbacks: { guideVisibilityChanged: (visible: boolean) => void; openFile: (name: string) => Promise<void> }[] = [];
  const controller = {
    openTopic: async (id: string) => ({ id, title: id, materialId: "m", toolkits: [] }),
    store: { getMaterial: async () => ({ id: "m", files: [{ name: "a.md" }, { name: "b.md" }] }) },
    runtime: { getService: () => undefined },
    createView: (_root: unknown, actions: typeof callbacks[number]) => { callbacks.push(actions); return { setGuideVisible: (visible: boolean) => states.push(visible), setToolkits() {}, render() {}, refreshGuide: async () => {} }; },
    renderMaterialFile: async () => ({ html: "", sections: [] }), releaseView() {},
  };
  Object.assign(workspace, { controller, generation: 0, view: null, contentEl: {}, guideByTopic: new Map() });
  const open = workspace.openTopic as (id: string) => Promise<void>;
  await open.call(workspace, "a");
  callbacks[0]!.guideVisibilityChanged(true);
  await callbacks[0]!.openFile("b.md");
  await open.call(workspace, "b");
  await open.call(workspace, "a");
  assert.deepEqual(states, [false, false, true]);
  let collapsed = 0;
  Object.assign(workspace, { workspace: { leftSplit: { collapse: () => { collapsed++; } } }, homeRequest: 0, controller: { openCompass: async () => { throw new Error("offline"); } } });
  await assert.rejects((workspace.onOpen as () => Promise<void>).call(workspace), /offline/);
  assert.equal(collapsed, 1);
});

test("web remembers guide state by topic and keeps reader controls above content", async () => {
  const source = await readFile(new URL("../src/shells/web/server.ts", import.meta.url), "utf8");
  const state = source.match(/^const guideByTopic=new Map\(\);.*$/m);
  const handler = source.match(/^document\.addEventListener\('click',e=>\{const button=e\.target\.closest\('button'\);if\(!button\|\|!topic\)return;if\(button\.id==='toggle-side'.*$/m);
  assert.ok(state && handler);
  const handlers: ((event: unknown) => void)[] = [];
  const context = createContext({ document: { addEventListener: (_name: string, fn: (event: unknown) => void) => handlers.push(fn) } });
  runInContext(`let topic=null,sideVisible=true;let openTopic=async id=>{topic={id}};${state[0]}\n${handler[0]}`, context);
  await runInContext("openTopic('a')", context);
  assert.equal(runInContext("sideVisible", context), false);
  runInContext("sideVisible=true", context);
  handlers[0]!({ target: { closest: () => ({ id: "toggle-side", dataset: {} }) } });
  await runInContext("openTopic('b')", context);
  assert.equal(runInContext("sideVisible", context), false);
  await runInContext("openTopic('a')", context);
  assert.equal(runInContext("sideVisible", context), true);
  assert.match(source, /\.pith-dock-zone\{position:static;display:block/);
  assert.match(source, /\.reader-chrome\{height:44px/);
  assert.match(source, /\.pith-typography-popover/);
});
