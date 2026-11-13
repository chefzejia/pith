import assert from "node:assert/strict";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import { DefaultAttentionEngine, DefaultWorkspaceStore, type AttentionCompassSnapshot, type UnreadableEntry } from "../src/core/index.ts";
import { PithObsidianController } from "../src/shells/obsidian/index.ts";
import { NodeWorkspaceStorage } from "../src/shells/web/nodeStorage.ts";
import { createPithWebServer } from "../src/shells/web/server.ts";
import { testSandbox } from "./sandbox.ts";

async function damagedWorkspace(root: string) {
  const storage = new NodeWorkspaceStorage(root), store = new DefaultWorkspaceStore(storage);
  const topic = (title: string, nextAction?: string) => store.createTopic({ title, target: title, materialIds: [], toolkits: [], nextAction });
  const good = await topic("正常探索", "阅读一页");
  const settled = await topic("已沉淀的课题");
  await store.updateTopic(settled.id, { status: "settled" });
  const notes = await topic("需要恢复的笔记");
  await store.appendTopicNote(notes.id, { kind: "note", author: "user", body: "保留的笔记" });
  const identity = await topic("目录身份");
  const material = await store.importMaterial({ title: "需要恢复的材料", kind: "article", files: [{ name: "original.md", bytes: new TextEncoder().encode("原始材料只读") }] });
  const longId = `material-${"long-path-".repeat(14)}identity`;
  const longMaterial = await store.importMaterial({ title: "材料目录身份", kind: "article", files: [] });
  const longPath = join(root, "materials", longId);
  await mkdir(longPath);
  const materialLedger = await readFile(join(root, "materials", longMaterial.id, "material.md"), "utf8");
  await writeFile(join(longPath, "material.md"), materialLedger.replace(`id: "${longMaterial.id}"`, `id: "${longId}"`));
  await rm(join(root, "materials", longMaterial.id), { recursive: true, force: true });
  const paths = [`topics/${notes.id}/topic.md`, `topics/${identity.id}/topic.md`, `materials/${material.id}/material.md`, `materials/${longId}/material.md`];
  const originals = await Promise.all(paths.map(path => readFile(join(root, path))));
  const damaged = [
    originals[0]!.toString().replace("\n\n<!-- pith-note:body -->", "\n<!-- pith-note:body -->"),
    originals[1]!.toString().replace(`id: "${identity.id}"`, 'id: "another-topic"'),
    originals[2]!.toString().replace('kind: "article"', 'kind: "invalid"'),
    originals[3]!.toString().replace(`id: "${longId}"`, 'id: "another-material"'),
  ];
  for (let i = 0; i < paths.length; i++) { assert.notEqual(damaged[i], originals[i]!.toString()); await writeFile(join(root, paths[i]!), damaged[i]!); }
  const expected: UnreadableEntry[] = [
    { kind: "topic", id: notes.id, path: paths[0]!, error: "Invalid note metadata" },
    { kind: "topic", id: identity.id, path: paths[1]!, error: "Topic id does not match path" },
    { kind: "material", id: material.id, path: paths[2]!, error: "Invalid material kind" },
    { kind: "material", id: longId, path: paths[3]!, error: "Material id does not match path" },
  ];
  const restore = async () => { for (let i = 0; i < paths.length; i++) await writeFile(join(root, paths[i]!), originals[i]!); };
  const assertUntouched = async () => {
    for (let i = 0; i < paths.length; i++) assert.equal((await readFile(join(root, paths[i]!))).toString(), damaged[i]);
    assert.equal(await readFile(join(root, "materials", material.id, "files/original.md"), "utf8"), "原始材料只读");
  };
  return { storage, store, expected, restore, assertUntouched, good, settled, notes, identity };
}
const sorted = <T extends { path: string }>(entries: readonly T[]): T[] => [...entries].sort((a, b) => a.path.localeCompare(b.path));

test("unreadable scans do not create a workspace", async () => {
  const root = await testSandbox("task44-empty-");
  try { assert.deepEqual(await new DefaultWorkspaceStore(new NodeWorkspaceStorage(root)).listUnreadable(), []); assert.deepEqual(await readdir(root), []); }
  finally { await rm(root, { recursive: true, force: true }); }
});

test("missing referenced material is reported without changing the topic and clears on restoration", async () => {
  const root = await testSandbox("task44-reference-");
  try {
    const store = new DefaultWorkspaceStore(new NodeWorkspaceStorage(root));
    const material = await store.importMaterial({ title: "Restored", kind: "article", files: [] });
    const topic = await store.createTopic({ title: "Missing material", target: "Understand material", materialIds: [material.id], toolkits: [] });
    await store.createTopic({ title: "No material", target: "Understand", materialIds: [], toolkits: [] });
    const materialPath = join(root, "materials", material.id, "material.md"), materialBytes = await readFile(materialPath);
    await rm(materialPath);
    const relativePath = `topics/${topic.id}/topic.md`, path = join(root, relativePath), before = await readFile(path);
    assert.deepEqual(await store.listUnreadable(), [{ kind: "topic", id: topic.id, path: relativePath, error: `Referenced material not found: ${material.id}` }]);
    assert.deepEqual(await readFile(path), before);
    await writeFile(materialPath, materialBytes);
    assert.deepEqual(await store.listUnreadable(), []);
    assert.deepEqual(await readFile(path), before);
  } finally { await rm(root, { recursive: true, force: true }); }
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
    assert.deepEqual((await fixture.store.listTopics()).map(t => t.id).sort(), [fixture.good.id, fixture.settled.id].sort());
    assert.deepEqual(await fixture.store.listMaterials(), []);
    await assert.rejects(fixture.store.getTopic(fixture.notes.id), /Invalid note metadata/);
    await assert.rejects(fixture.store.getTopic(fixture.identity.id), /Topic id does not match path/);
    for (const snapshot of [await new DefaultAttentionEngine(fixture.store, fixture.storage).compass(), await native.openCompass(), await webSnapshot()]) {
      assert.deepEqual(sorted(snapshot.unreadable), sorted(fixture.expected));
      assert.deepEqual(snapshot.exploring.map(t => t.id), [fixture.good.id]);
      assert.deepEqual(snapshot.settled.map(t => t.id), [fixture.settled.id]);
      assert.equal(snapshot.focusRecommendation!.topicId, fixture.good.id);
    }
    await fixture.assertUntouched();
    await fixture.restore();
    for (const snapshot of [await native.openCompass(), await webSnapshot()]) {
      assert.deepEqual(snapshot.unreadable, []);
      assert.deepEqual(snapshot.exploring.map(t => t.id).sort(), [fixture.good.id, fixture.identity.id, fixture.notes.id].sort());
      assert.deepEqual(snapshot.settled.map(t => t.id), [fixture.settled.id]);
      assert.equal(snapshot.exploring.find(t => t.id === fixture.notes.id)!.notes[0]!.body, "保留的笔记");
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
    const native = await browser.newPage(); native.setDefaultTimeout(10000);
    await (await import("./native-workbench-fixture.ts")).nativeWorkbenchFixture(native, workspace);
    await native.evaluate(() => { const w = window as any; w.nativeBoard = w.nativeTask52.view; w.nativeCompass = () => w.nativeTask52.controller.openCompass(); });
    const evidence = resolve(`${process.env.PITH_TEST_SCREENSHOT_DIR}/task-44`); await mkdir(evidence, { recursive: true });
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
    await native.evaluate(async () => { const w = window as any; const snapshot = await w.nativeCompass(); snapshot.unreadable = [{ kind: "topic", id: "unsafe", path: 'topics/<img>/topic.md', error: '<img src=x onerror="window.injected=true">' }]; w.nativeTask52.controller.openCompass = async () => snapshot; await w.nativeBoard.onOpen(); });
    assert.equal(await native.locator('.pith-unreadable img').count(), 0);
    assert.ok((await native.locator('.pith-unreadable').textContent()).includes('<img src=x'));
  } finally { if (browser) await browser.close(); controller.dispose(); await new Promise<void>((ok, fail) => server.close(error => error ? fail(error) : ok())); await rm(root, { recursive: true, force: true }); }
});
