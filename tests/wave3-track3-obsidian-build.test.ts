import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { runInThisContext } from "node:vm";
import { NodeWorkspaceStorage } from "../src/shells/web/nodeStorage.ts";
import { createPithWebServer } from "../src/shells/web/server.ts";

const exec = promisify(execFile);

test("Obsidian production bundle loads and manages its controller", async t => {
  const buildRoot = await mkdtemp(join(tmpdir(), "pith-bundle-test-"));
  t.after(() => rm(buildRoot, { recursive: true, force: true }));
  for (const path of ["package.json", "manifest.json", "scripts", "src"]) await cp(resolve(path), join(buildRoot, path), { recursive: true });
  await symlink(resolve("node_modules"), join(buildRoot, "node_modules"), "dir");
  await exec(process.execPath, ["scripts/build-obsidian.mjs"], { cwd: buildRoot });
  const output = join(buildRoot, "dist/obsidian");
  const [main, manifest, styles] = await Promise.all(["main.js", "manifest.json", "styles.css"].map(name => readFile(join(output, name), "utf8")));
  assert.ok(main && manifest && styles);
  assert.deepEqual(JSON.parse(manifest), JSON.parse(await readFile("manifest.json", "utf8")));
  assert.equal(JSON.parse(manifest).id, "pith");
  for (const token of [".pith-teaching-block", ".pith-fixed-page", ".pith-left-drawer", ".pith-bottom-dock", "var(--background-secondary)", "var(--background-modifier-border)", "var(--text-accent)"]) assert.ok(styles.includes(token), token);
  assert.doesNotMatch(styles, /#f3ede1/i);

  const dir = await mkdtemp(join(tmpdir(), "pith-obsidian-build-"));
  const storage = new NodeWorkspaceStorage(dir);
  const adapter = {
    getFullPath: (path: string) => join(dir, path),
    exists: (path: string) => storage.exists(path),
    read: (path: string) => storage.readText(path),
    readBinary: async (path: string) => new Uint8Array(await storage.readBinary(path)).buffer,
    write: (path: string, data: string) => storage.writeText(path, data),
    writeBinary: (path: string, data: ArrayBuffer) => storage.writeBinary(path, new Uint8Array(data)),
    mkdir: (path: string) => storage.mkdir(path),
    list: async (path: string) => { const entries = await storage.list(path); return { files: entries.filter(entry => entry.type === "file").map(entry => entry.path), folders: entries.filter(entry => entry.type === "folder").map(entry => entry.path) }; },
  };
  const detached: string[] = [], registered: string[] = [], factories = new Map<string, (leaf: unknown) => unknown>();
  let state = "", revealed = false, collapsed = 0, saved: unknown = null;
  const leaf = { setViewState: async (value: { type: string }) => { state = value.type; } };
  let rightExpanded = false;
  const rightLeaf: { view?: unknown; detach(): void; setViewState(value: { type: string }): Promise<void> } = { detach() { this.view = undefined; rightExpanded = false; }, async setViewState(value) { this.view = factories.get(value.type)!(this); } };
  const workspace = { leftSplit: { collapse: () => { collapsed++; } }, rightSplit: { expand: () => { rightExpanded = true; }, collapse: () => { rightExpanded = false; } }, getRightLeaf: () => rightLeaf, getLeavesOfType: (type: string) => type === "pith-guide" && rightLeaf.view ? [rightLeaf] : [], getLeaf: () => leaf, revealLeaf: async () => { revealed = true; }, detachLeavesOfType: (type: string) => { detached.push(type); } };
  class Plugin {
    app = { vault: { adapter }, workspace };
    factory: ((leaf: unknown) => unknown) | null = null;
    command: (() => void) | null = null;
    registerView(type: string, factory: (leaf: unknown) => unknown) { registered.push(type); factories.set(type, factory); this.factory = factory; }
    addRibbonIcon() {}
    addCommand(value: { callback: () => void }) { this.command = value.callback; }
    async loadData() { return saved; }
    async saveData(value: unknown) { saved = value; }
  }
  class ItemView { contentEl = { children: [] as unknown[], replaceChildren(...children: unknown[]) { this.children = children; } }; }
  class Notice { constructor(message: string) { throw new Error(message); } }
  class FileSystemAdapter {}
  Object.setPrototypeOf(adapter, FileSystemAdapter.prototype);
  const host = { Plugin, ItemView, Notice, FileSystemAdapter };
  const nativeRequire = createRequire(join(output, "main.js"));
  const module = { exports: {} as unknown };
  const load = runInThisContext(`(function(require, module, exports) { ${main}\n})`) as (require: NodeRequire, module: { exports: unknown }, exports: unknown) => void;
  load(((name: string) => name === "obsidian" ? host : nativeRequire(name)) as NodeRequire, module, module.exports);
  const Entry = module.exports as new () => Plugin & { onload(): Promise<void>; onunload(): void; openView(): Promise<void>; setWorkspacePath(path: string): Promise<boolean>; controller: { host: { process: { constructor: { name: string } } }; runtime: { statuses(): { state: string }[] } } | null };
  const plugin = new Entry();
  try {
    await plugin.onload();
    assert.deepEqual(registered, ["pith-reader", "pith-guide"]);
    const guide = factories.get("pith-guide")!(leaf) as { getViewType(): string; mount(element: unknown, close?: () => void): void; onClose(): Promise<void>; contentEl: { children: unknown[] } };
    const guideElement = {};
    let guideClosed = false;
    guide.mount(guideElement, () => { guideClosed = true; });
    assert.equal(guide.getViewType(), "pith-guide");
    assert.deepEqual(guide.contentEl.children, [guideElement]);
    await guide.onClose(); assert.equal(guideClosed, true);
    const reader = factories.get("pith-reader")!(leaf) as { view: unknown; showNativeGuide(visible: boolean, view: unknown): Promise<void> };
    const readerView = { guideElement: () => guideElement, focusQuotedGuide() {} };
    reader.view = readerView;
    await reader.showNativeGuide(true, readerView);
    assert.equal(rightExpanded, true);
    assert.deepEqual((rightLeaf.view as { contentEl: { children: unknown[] } }).contentEl.children, [guideElement]);
    await reader.showNativeGuide(false, readerView);
    assert.equal(rightExpanded, false);
    assert.ok(plugin.factory);
    assert.ok(plugin.command);
    assert.equal(plugin.controller!.host.process.constructor.name, "NodeAgentProcessPort");
    assert.ok(plugin.controller!.runtime.statuses().some(status => status.state === "active"));
    await plugin.openView();
    assert.equal(state, "pith-reader");
    assert.equal(revealed, true);
    assert.equal(collapsed, 1);
    assert.equal(await storage.exists("Pith/ME.md"), true);
    assert.equal(await storage.exists("ME.md"), false);
    await assert.rejects(plugin.setWorkspacePath("../escape"), /Invalid workspace root/);
    assert.equal(saved, null);
    await storage.writeText("not-a-directory", "existing file");
    await assert.rejects(plugin.setWorkspacePath("not-a-directory/nested"));
    assert.equal(saved, null);
    assert.equal(await plugin.setWorkspacePath("custom/nested"), true);
    assert.deepEqual(saved, { workspacePath: "custom/nested" });
    const controller = plugin.controller!;
    plugin.onunload();
    assert.deepEqual(detached, ["pith-reader", "pith-guide"]);
    assert.equal(plugin.controller, null);
    assert.ok(controller.runtime.statuses().every(status => status.state !== "active"));
    const reloaded = new Entry();
    await reloaded.onload();
    assert.equal(await storage.exists("custom/nested/ME.md"), true);
    assert.equal(await storage.exists("Pith/ME.md"), true);
    reloaded.onunload();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("web stage styles and image policy support the same reader output", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pith-web-stage-"));
  const server = await createPithWebServer({ workspaceDir: dir });
  try {
    const address = server.address(); assert.ok(address && typeof address !== "string");
    const response = await fetch(`http://127.0.0.1:${address.port}/`);
    assert.match(response.headers.get("content-security-policy")!, /img-src 'self' data:/);
    const html = await response.text();
    for (const selector of [".pith-teaching-block", ".pith-fixed-page", ".pith-fixed-page img"]) assert.ok(html.includes(selector), selector);
    assert.doesNotMatch(html, /#f3ede1/i);
  } finally {
    await new Promise<void>((resolveClose, reject) => server.close(error => error ? reject(error) : resolveClose()));
    await rm(dir, { recursive: true, force: true });
  }
});
