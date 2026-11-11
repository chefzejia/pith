import assert from "node:assert/strict";
import { mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import { build } from "esbuild";
import { DefaultWorkspaceStore } from "../src/core/index.ts";
import { cleanMaterialTitle, inspectEpubPackage, inspectMaterialCover } from "../src/plugins/stage-reader/epub.ts";
import { NodeWorkspaceStorage } from "../src/shells/web/nodeStorage.ts";
import { createPithWebServer } from "../src/shells/web/server.ts";
import { testSandbox } from "./sandbox.ts";
import { coverPng, coveredEpub, storedZip } from "./task29-fixture.ts";

test("short IDs handle collisions, mixed scripts and old UUIDs", async () => {
  const root = await testSandbox("task29-ids-");
  try {
    const store = new DefaultWorkspaceStore(new NodeWorkspaceStorage(root));
    const first = await store.createTopic({ title: "数学101" }), second = await store.createTopic({ title: "数学101" });
    assert.match(first.id, /^topic-\d{8}-[a-z0-9]{7}$/); assert.equal(second.id, `${first.id}-2`); assert.doesNotMatch(first.id, /-101$/);
    const mixed = await store.importMaterial({ title: "第1章 ABC", kind: "book", files: [] }); assert.match(mixed.id, /^material-\d{8}-[a-z0-9]{7}$/);
    const english = await store.createTopic({ title: "Learning Design" }); assert.match(english.id, /^topic-\d{8}-learning-design$/);
    const dirty = await store.createTopic({ title: "数学101 = Maths (z-library.sk, 1lib.sk, z-lib.sk)" }); assert.equal(dirty.id, `${first.id}-3`);
    const legacy = await store.createTopic({ id: "topic-8bdc0803-1234-4567-aaaa-0123456789ab", title: "旧课题" }); assert.equal((await store.getTopic(legacy.id))?.title, "旧课题");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("EPUB titles and raster covers use actual package bytes", async () => {
  assert.equal(cleanMaterialTitle("女人的性爱动机 = Why Women Have Sex (z-library.sk, 1lib.sk, z-lib.sk).epub"), "女人的性爱动机");
  const metadata = await inspectEpubPackage(coveredEpub()); assert.equal(metadata.title, "真实书名"); assert.equal(metadata.author, "测试作者"); assert.match(metadata.coverDataUrl!, /^data:image\/png;base64,/);
  assert.match((await inspectMaterialCover("image.png", coverPng))!, /^data:image\/png;base64,/);
  const cbz = storedZip({ "10.png": "not image", "2.png": coverPng }); assert.match((await inspectMaterialCover("book.cbz", cbz))!, /^data:image\/png;base64,/);
  assert.equal(await inspectMaterialCover("image.png", new Uint8Array([1, 2, 3])), undefined);
});

test("Web import and Obsidian board render a real cover in light and dark", { timeout: 90000, skip: !process.env.PITH_PLAYWRIGHT_MODULE || !process.env.PITH_CHROME_PATH }, async () => {
  const root = await testSandbox("task29-browser-"); const workspace = join(root, "workspace"); await mkdir(workspace);
  const store = new DefaultWorkspaceStore(new NodeWorkspaceStorage(workspace));
  const done = await store.createTopic({ title: "已完成的探索" }); await store.updateTopic(done.id, { status: "settled" });
  const server = await createPithWebServer({ workspaceDir: workspace }); let browser: any;
  try {
    const address = server.address(); assert.ok(address && typeof address !== "string"); const base = `http://127.0.0.1:${address.port}`;
    const { chromium } = await import(process.env.PITH_PLAYWRIGHT_MODULE!);
    browser = await chromium.launchPersistentContext(join(root, "profile"), { executablePath: process.env.PITH_CHROME_PATH, headless: true, viewport: { width: 1100, height: 850 } });
    const page = await browser.newPage(); page.setDefaultTimeout(15000); await page.goto(base);
    const book = Buffer.from(coveredEpub());
    const filename = "女人的性爱动机 = Why Women Have Sex (z-library.sk, 1lib.sk, z-lib.sk).epub";
    await page.locator("#material-files").setInputFiles({ name: filename, mimeType: "application/epub+zip", buffer: book });
    await page.locator(".pith-reader").waitFor(); await page.locator('[data-command="home"]').click();
    const card = page.locator(".pith-topic-card").filter({ hasText: "真实书名" }); await card.waitFor();
    assert.equal(await card.locator("strong").textContent(), "真实书名");
    await page.waitForFunction(() => { const image = document.querySelector('.pith-card-cover') as HTMLImageElement | null; return !!image && image.naturalWidth > 0; });
    assert.match(await card.textContent(), /暂无笔记/); assert.equal(await card.locator(".pith-card-suggestion").evaluate((node: HTMLElement) => getComputedStyle(node).borderTopStyle), "dashed");
    assert.equal(await page.locator(".pith-settled-row").count(), 1);
    const snapshot = await (await fetch(base + "/api/state")).json() as any;
    assert.equal(snapshot.compass.exploring.length, 1); assert.equal(snapshot.materials[0].files[0].name, filename); assert.match(snapshot.compass.exploring[0].id, /^topic-\d{8}-[a-z0-9]{7}$/);
    const evidence = resolve(".tmp/evidence/task-29"); await mkdir(evidence, { recursive: true }); await page.screenshot({ path: join(evidence, "web-light.png") });
    await page.emulateMedia({ colorScheme: "dark" }); await page.screenshot({ path: join(evidence, "web-dark.png") }); await page.emulateMedia({ colorScheme: "light" });
    await page.setViewportSize({ width: 390, height: 844 }); await page.screenshot({ path: join(evidence, "web-narrow.png") });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.equal(await page.locator(".pith-view-header").count(), 1);
    const bundle = await build({ entryPoints: ["src/shells/obsidian/index.ts"], bundle: true, write: false, platform: "browser", format: "iife", globalName: "NativePith", external: ["node:*", "obsidian"] });
    const native = await browser.newPage(); await native.setViewportSize({ width: 1100, height: 850 });
    await native.setContent('<style>html,body,#root{height:100%;margin:0}body{--background-primary:#202421;--background-secondary:#2c322d;--background-modifier-border:#535d54;--background-modifier-hover:#3c463e;--text-normal:#eef1e9;--text-muted:#bac2b8;--font-interface:Arial;color:var(--text-normal);background:var(--background-primary)}</style><div id="root"></div>');
    await native.evaluate(() => document.body.classList.add("theme-dark"));
    await native.evaluate(() => { (window as any).require = (id: string) => id === "obsidian" ? { ItemView: class { contentEl = document.getElementById("root"); }, Plugin: class {}, Notice: class {} } : id === "node:util" ? { promisify: (fn: unknown) => fn } : id === "node:net" ? { BlockList: class { addSubnet() {} } } : {}; });
    await native.exposeFunction("boardSnapshot", async () => (await (await fetch(base + "/api/state")).json()));
    await native.addScriptTag({ content: bundle.outputFiles[0]!.text });
    await native.evaluate(async () => { const snapshot = await (window as any).boardSnapshot(); const controller = { guideVisibility: new Map(), openCompass: async () => snapshot.compass, openBoardMaterials: async () => snapshot.boardMaterials }; const view = new (window as any).NativePith.PithWorkspaceView({}, controller, {}); await view.onOpen(); });
    await native.waitForFunction(() => { const image = document.querySelector('.pith-card-cover') as HTMLImageElement | null; return !!image && image.naturalWidth > 0; });
    assert.equal(await native.locator(".pith-settled-row").count(), 1); await native.screenshot({ path: join(evidence, "obsidian-dark.png") });
  } finally { if (browser) await browser.close(); await new Promise<void>((ok, fail) => server.close(error => error ? fail(error) : ok())); await rm(root, { recursive: true, force: true }); }
});
