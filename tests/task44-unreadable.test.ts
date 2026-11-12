import assert from "node:assert/strict";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import { build } from "esbuild";
import { DefaultAttentionEngine, DefaultWorkspaceStore, type AttentionCompassSnapshot, type UnreadableEntry } from "../src/core/index.ts";
import { PithObsidianController } from "../src/shells/obsidian/index.ts";
import { NodeWorkspaceStorage } from "../src/shells/web/nodeStorage.ts";
import { createPithWebServer } from "../src/shells/web/server.ts";
import { testSandbox } from "./sandbox.ts";

async function damagedWorkspace(root: string) {
  const storage = new NodeWorkspaceStorage(root), store = new DefaultWorkspaceStore(storage);
  await store.createTopic({ id: "topic-good", title: "正常探索", nextAction: "阅读一页" });
  await store.createTopic({ id: "topic-settled", title: "已沉淀的课题" });
  await store.updateTopic("topic-settled", { status: "settled" });
  await store.createTopic({ id: "topic-notes", title: "需要恢复的笔记" });
  await store.appendNote("topic-notes", { kind: "note", body: "保留的笔记" });
  await store.createTopic({ id: "topic-identity", title: "目录身份" });
  await store.importMaterial({ id: "material-kind", title: "需要恢复的材料", kind: "article", files: [{ name: "original.md", bytes: new TextEncoder().encode("原始材料只读") }] });
  const longId = `material-${"long-path-".repeat(14)}identity`;
  await store.importMaterial({ id: longId, title: "材料目录身份", kind: "article", files: [] });
  const paths = ["topics/topic-notes/topic.md", "topics/topic-identity/topic.md", "materials/material-kind/material.md", `materials/${longId}/material.md`];
  const originals = await Promise.all(paths.map(path => readFile(join(root, path))));
  const damaged = [
    originals[0]!.toString().replace("\n\n<!-- pith-note:body -->", "\n<!-- pith-note:body -->"),
    originals[1]!.toString().replace('id: "topic-identity"', 'id: "another-topic"'),
    originals[2]!.toString().replace('kind: "article"', 'kind: "invalid"'),
    originals[3]!.toString().replace(`id: "${longId}"`, 'id: "another-material"'),
  ];
  for (let i = 0; i < paths.length; i++) { assert.notEqual(damaged[i], originals[i]!.toString()); await writeFile(join(root, paths[i]!), damaged[i]!); }
  const expected: UnreadableEntry[] = [
    { kind: "topic", id: "topic-notes", path: paths[0]!, error: "Invalid note metadata" },
    { kind: "topic", id: "topic-identity", path: paths[1]!, error: "Topic id does not match path" },
    { kind: "material", id: "material-kind", path: paths[2]!, error: "Invalid material kind" },
    { kind: "material", id: longId, path: paths[3]!, error: "Material id does not match path" },
  ];
  const restore = async () => { for (let i = 0; i < paths.length; i++) await writeFile(join(root, paths[i]!), originals[i]!); };
  const assertUntouched = async () => {
    for (let i = 0; i < paths.length; i++) assert.equal((await readFile(join(root, paths[i]!))).toString(), damaged[i]);
    assert.equal(await readFile(join(root, "materials/material-kind/files/original.md"), "utf8"), "原始材料只读");
  };
  return { storage, store, expected, restore, assertUntouched };
}
const sorted = <T extends { path: string }>(entries: readonly T[]): T[] => [...entries].sort((a, b) => a.path.localeCompare(b.path));

test("unreadable scans do not create a workspace", async () => {
  const root = await testSandbox("task44-empty-");
  try { assert.deepEqual(await new DefaultWorkspaceStore(new NodeWorkspaceStorage(root)).listUnreadable(), []); assert.deepEqual(await readdir(root), []); }
  finally { await rm(root, { recursive: true, force: true }); }
});

test("disk corruption and identity mismatches remain read-only and recover in engine and both shell snapshots", async () => {
  const root = await testSandbox("task44-disk-");
  const fixture = await damagedWorkspace(root);
  const native = new PithObsidianController({ id: "obsidian", storage: fixture.storage });
  const server = await createPithWebServer({ workspaceDir: root });
  try {
    const address = server.address(); assert.ok(address && typeof address !== "string");
    const webSnapshot = async (): Promise<AttentionCompassSnapshot> => { const response = await fetch(`http://127.0.0.1:${address.port}/api/state`); assert.equal(response.status, 200); return (await response.json() as { compass: AttentionCompassSnapshot }).compass; };
    await native.initialize();
    assert.deepEqual(sorted(await fixture.store.listUnreadable()), sorted(fixture.expected));
    assert.deepEqual((await fixture.store.listTopics()).map(t => t.id).sort(), ["topic-good", "topic-settled"]);
    assert.deepEqual(await fixture.store.listMaterials(), []);
    await assert.rejects(fixture.store.getTopic("topic-notes"), /Invalid note metadata/);
    await assert.rejects(fixture.store.getTopic("topic-identity"), /Topic id does not match path/);
    for (const snapshot of [await new DefaultAttentionEngine(fixture.store, fixture.storage).compass(), await native.openCompass(), await webSnapshot()]) {
      assert.deepEqual(sorted(snapshot.unreadable), sorted(fixture.expected));
      assert.deepEqual(snapshot.exploring.map(t => t.id), ["topic-good"]);
      assert.deepEqual(snapshot.settled.map(t => t.id), ["topic-settled"]);
      assert.equal(snapshot.focusRecommendation!.topicId, "topic-good");
    }
    await fixture.assertUntouched();
    await fixture.restore();
    for (const snapshot of [await native.openCompass(), await webSnapshot()]) {
      assert.deepEqual(snapshot.unreadable, []);
      assert.deepEqual(snapshot.exploring.map(t => t.id).sort(), ["topic-good", "topic-identity", "topic-notes"]);
      assert.deepEqual(snapshot.settled.map(t => t.id), ["topic-settled"]);
      assert.equal(snapshot.exploring.find(t => t.id === "topic-notes")!.notes[0]!.body, "保留的笔记");
    }
    assert.equal((await fixture.store.listMaterials()).length, 2);
  } finally { native.dispose(); await new Promise<void>((ok, fail) => server.close(error => error ? fail(error) : ok())); await rm(root, { recursive: true, force: true }); }
});

test("Web and Obsidian board mounts show read-only errors, wrap paths and hide them after disk restoration", { timeout: 90000, skip: !process.env.PITH_PLAYWRIGHT_MODULE || !process.env.PITH_CHROME_PATH }, async () => {
  const root = await testSandbox("task44-browser-"); const workspace = join(root, "workspace"); await mkdir(workspace);
  const fixture = await damagedWorkspace(workspace);
  const controller = new PithObsidianController({ id: "obsidian", storage: fixture.storage }); await controller.initialize();
  const server = await createPithWebServer({ workspaceDir: workspace }); let browser: any;
  try {
    const address = server.address(); assert.ok(address && typeof address !== "string"); const base = `http://127.0.0.1:${address.port}`;
    const { chromium } = await import(process.env.PITH_PLAYWRIGHT_MODULE!);
    browser = await chromium.launchPersistentContext(join(root, "profile"), { executablePath: process.env.PITH_CHROME_PATH, headless: true, viewport: { width: 1100, height: 950 } });
    const web = await browser.newPage(); web.setDefaultTimeout(10000); await web.goto(base);
    const bundle = await build({ entryPoints: ["src/shells/obsidian/index.ts"], bundle: true, write: false, platform: "browser", format: "iife", globalName: "NativePith", external: ["node:*", "obsidian"] });
    const native = await browser.newPage(); native.setDefaultTimeout(10000);
    await native.setContent('<style>html,body,#root{height:100%;margin:0}body{--background-primary:#fff;--background-secondary:#f6f6f7;--background-modifier-border:#ddd;--text-normal:#252525;--text-muted:#626262;--font-interface:Arial;color:var(--text-normal);background:var(--background-primary)}</style><div id="root"></div>');
    await native.evaluate(() => { (window as any).require = (id: string) => id === "obsidian" ? { ItemView: class { contentEl = document.getElementById("root"); }, Plugin: class {}, Notice: class {} } : id === "node:util" ? { promisify: (fn: unknown) => fn } : id === "node:net" ? { BlockList: class { addSubnet() {} } } : {}; });
    // Obsidian's window boundary forwards to the real disk-backed controller; no native app is launched.
    await native.exposeFunction("nativeCompass", () => controller.openCompass());
    await native.exposeFunction("nativeMaterials", () => controller.openBoardMaterials());
    await native.addScriptTag({ content: bundle.outputFiles[0]!.text });
    await native.evaluate(async () => { const w = window as any; w.nativeBoard = new w.NativePith.PithWorkspaceView({}, { guideVisibility: new Map(), openCompass: w.nativeCompass, openBoardMaterials: w.nativeMaterials }, {}); await w.nativeBoard.onOpen(); });
    const evidence = resolve(".tmp/evidence/task-44"); await mkdir(evidence, { recursive: true });
    for (const [name, page] of [["web", web], ["obsidian-boundary", native]] as const) {
      await page.getByRole("heading", { name: "无法读取（4）", exact: true }).waitFor();
      const section = page.locator('.pith-unreadable');
      assert.equal(await section.locator("li").count(), 4);
      for (const entry of fixture.expected) { assert.ok((await section.textContent()).includes(entry.path!)); assert.ok((await section.textContent()).includes(entry.error)); }
      assert.equal(await section.locator("button,a,input,textarea,select").count(), 0);
      assert.equal(await page.locator('.pith-topic-card').count(), 1); assert.equal(await page.locator('.pith-settled-row').count(), 1);
      await section.scrollIntoViewIfNeeded(); await page.screenshot({ path: join(evidence, `${name}-errors.png`) });
      if (name === "web") { await page.emulateMedia({ colorScheme: "dark" }); await page.screenshot({ path: join(evidence, "web-dark.png") }); await page.emulateMedia({ colorScheme: "light" }); }
      await page.setViewportSize({ width: 390, height: 844 }); await section.scrollIntoViewIfNeeded();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      assert.equal(await section.evaluate((node: HTMLElement) => node.scrollWidth <= node.clientWidth), true);
      await page.screenshot({ path: join(evidence, `${name}-narrow.png`) });
      await page.setViewportSize({ width: 1100, height: 950 });
    }
    await fixture.assertUntouched(); await fixture.restore();
    await web.reload(); await web.locator('.pith-topic-card').filter({ hasText: "需要恢复的笔记" }).waitFor();
    await native.evaluate(async () => (window as any).nativeBoard.onOpen());
    for (const [name, page] of [["web", web], ["obsidian-boundary", native]] as const) {
      assert.equal(await page.locator('.pith-unreadable').count(), 0); assert.equal(await page.getByRole("heading", { name: /无法读取/ }).count(), 0);
      assert.equal(await page.locator('.pith-topic-card').count(), 3); assert.equal(await page.locator('.pith-settled-row').count(), 1);
      await page.screenshot({ path: join(evidence, `${name}-restored.png`) });
    }
    // Error text is rendered as text even when a storage error contains markup.
    await native.evaluate(async () => { const w = window as any; const snapshot = await w.nativeCompass(); snapshot.unreadable = [{ kind: "topic", id: "unsafe", path: 'topics/<img>/topic.md', error: '<img src=x onerror="window.injected=true">' }]; const view = new w.NativePith.PithWorkspaceView({}, { guideVisibility: new Map(), openCompass: async () => snapshot, openBoardMaterials: w.nativeMaterials }, {}); await view.onOpen(); });
    assert.equal(await native.locator('.pith-unreadable img').count(), 0);
    assert.ok((await native.locator('.pith-unreadable').textContent()).includes('<img src=x'));
  } finally { if (browser) await browser.close(); controller.dispose(); await new Promise<void>((ok, fail) => server.close(error => error ? fail(error) : ok())); await rm(root, { recursive: true, force: true }); }
});
