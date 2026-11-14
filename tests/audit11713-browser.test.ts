import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { DefaultWorkspaceStore } from "../src/core/index.ts";
import { NodeWorkspaceStorage } from "../src/shells/web/nodeStorage.ts";
import { readMaterialReading } from "../src/workbench/readingState.ts";
import { createPithWebServer } from "../src/shells/web/server.ts";
import { auditRetryFixture } from "./audit11713-fixture.ts";
import { nativeWorkbenchFixture } from "./native-workbench-fixture.ts";
import { linkedEpub, storedEpub } from "./wave12-epub-fixture.ts";
import { testSandbox } from "./sandbox.ts";

const enabled = Boolean(process.env.PITH_PLAYWRIGHT_MODULE && process.env.PITH_CHROME_PATH);
async function screenshot(page: any, name: string) {
  if (!process.env.PITH_AUDIT_CAPTURE_DIR) return;
  await mkdir(process.env.PITH_AUDIT_CAPTURE_DIR, { recursive: true });
  await page.screenshot({ path: join(process.env.PITH_AUDIT_CAPTURE_DIR, name + ".png") });
}

test("audit retry UI retains prior results, one user message and working undo after reload and repeated retry", { skip: !enabled, timeout: 60000 }, async () => {
  const root = await testSandbox("audit11713-ui-retry-"), f = await auditRetryFixture(root, "failed,stopped,failed,completed"); let browser: any;
  try {
    const { chromium } = await import(process.env.PITH_PLAYWRIGHT_MODULE!);
    browser = await chromium.launchPersistentContext(join(root, "profile"), { executablePath: process.env.PITH_CHROME_PATH, headless: true, viewport: { width: 1200, height: 850 } });
    const page = await browser.newPage(); page.setDefaultTimeout(8000);
    const open = async () => { await page.goto(f.base); await page.locator(`[data-topic="${f.topic.id}"]`).click(); await page.locator('.pith-guide-toggle').click(); };
    await open(); await page.locator('.pith-guide textarea').fill("根据我的证据结题并记入观察"); await page.locator('[data-guide-send]').click();
    await page.locator('.pith-guide-failure').getByText(/23/).waitFor();
    const observations = await f.store.readProfile(); assert.equal(observations.observations.length, 2);
    const control = page.locator('.pith-guide-observation').filter({ hasText: "对照观察二" }); await control.getByRole('button', { name: '撤销' }).click(); await control.getByText('已撤销').waitFor();
    await page.locator('[data-guide-retry]').click(); await page.locator('[data-turn-status=running] [data-step-status=completed]').filter({ hasText: '记录笔记' }).waitFor();
    await page.locator('[data-guide-stop]').click(); await page.locator('.pith-guide-stopped').waitFor();
    await page.locator('[data-guide-retry]').click(); await page.locator('.pith-guide-failure').getByText(/23/).waitFor();
    await open();
    await page.locator('.pith-guide-process summary').getByText(/此前尝试/).first().waitFor();
    const retained = page.locator('.pith-guide-observation').filter({ hasText: "保留的观察一" }); await retained.getByRole('button', { name: '撤销' }).waitFor();
    await page.locator('[data-guide-retry]').click(); await page.getByText('受控协议重试完成，本次没有调用写工具。', { exact: false }).first().waitFor();
    await page.locator('[data-turn-status=completed]').waitFor(); await page.locator('[data-guide-send]').waitFor();
    assert.equal(await page.locator('.pith-guide-user').count(), 1);
    assert.equal(await page.locator('.pith-guide-process summary').filter({ hasText: '此前尝试 · 已生效结果（未重新执行）' }).count(), 1);
    assert.equal((await f.store.getTopic(f.topic.id))!.notes.length, 3);
    await screenshot(page, 'retry-after-success');
    const undone = page.waitForResponse((response: any) => response.url().endsWith('/api/observations/undo'));
    await retained.getByRole('button', { name: '撤销' }).click(); assert.equal((await undone).status(), 200); await retained.getByText('已撤销').waitFor();
    assert.equal((await f.store.readProfile()).observations.length, 0); assert.equal(f.storage.failures, 1); assert.equal(f.attempts(), 4);
  } finally { if (browser) await browser.close(); await f.close(); assert.ok(f.processes.every(process => process.closed)); await rm(root, { recursive: true, force: true }); }
});

for (const host of ["Web", "Obsidian"]) test(`audit ${host} EPUB resumes visible text and long paragraphs after reopen, file switch and resize`, { skip: !enabled, timeout: 60000 }, async () => {
  const root = await testSandbox("audit11713-epub-"), workspace = join(root, "workspace"); await mkdir(workspace);
  const storage = new NodeWorkspaceStorage(workspace), store = new DefaultWorkspaceStore(storage); await store.ensureScaffold();
  const long = storedEpub({ "META-INF/container.xml": '<container><rootfile full-path="O/book.opf"/></container>', "O/book.opf": '<package><manifest><item id="chapter" href="chapter.xhtml"/></manifest><spine><itemref idref="chapter"/></spine></package>', "O/chapter.xhtml": `<html><body><h1>Long paragraph</h1><p>${Array.from({ length: 1600 }, (_, index) => `Word${index} explains a causal condition. `).join("")}</p></body></html>` });
  const material = await store.importMaterial({ title: `EPUB resume ${host}`, kind: "book", files: [{ name: "normal.epub", bytes: linkedEpub() }, { name: "long.epub", bytes: long }], aids: [] });
  const bundle = await build({ entryPoints: ["src/plugins/stage-reader/pagination.ts"], bundle: true, write: false, platform: "browser", format: "iife", globalName: "Reading" });
  let server: Awaited<ReturnType<typeof createPithWebServer>> | undefined, browser: any, page: any;
  try {
    const { chromium } = await import(process.env.PITH_PLAYWRIGHT_MODULE!);
    if (host === "Web") server = await createPithWebServer({ workspaceDir: workspace });
    const open = async () => {
      browser = await chromium.launchPersistentContext(join(root, "profile"), { executablePath: process.env.PITH_CHROME_PATH, headless: true, viewport: { width: 1000, height: 700 } });
      page = await browser.newPage(); page.setDefaultTimeout(8000);
      await page.addInitScript(bundle.outputFiles[0]!.text + ";window.Reading=Reading;");
      if (host === "Web") { const address = server!.address(); assert.ok(address && typeof address !== "string"); await page.goto(`http://127.0.0.1:${address.port}`); }
      else await nativeWorkbenchFixture(page, workspace);
      await page.locator(`[data-material="${material.id}"]`).click(); await page.locator('.pith-epub-chapter').first().waitFor(); await page.locator('.pith-guide [data-guide-tab=notes]').waitFor({ state: 'attached' });
      await page.waitForFunction(() => { const reader = document.querySelector<HTMLElement>('.pith-reader')!, article = document.querySelector<HTMLElement>('.pith-article')!; return parseFloat(article.style.width) === reader.clientWidth && parseFloat(article.style.height) === reader.clientHeight; });
    };
    const snapshot = () => page.evaluate(() => { const reader = document.querySelector<HTMLElement>('.pith-reader')!, article = document.querySelector<HTMLElement>('.pith-article')!, position = (window as any).Reading.captureReaderPosition(reader, article); return { counter: document.querySelector('[data-page-count]')!.textContent, locator: position?.locator, offset: position?.textOffset }; });
    const save = async (file: string, locator: string, offset: number) => {
      const expected = `${locator};offset:${offset}`, deadline = Date.now() + 8000;
      let actual: string | undefined;
      do { const materialNow = (await store.getMaterial(material.id))!; actual = materialNow.files.find(entry => entry.name === file)!.locator; const reading = readMaterialReading(materialNow); if (actual === expected && reading?.file === file && reading.locator === expected) return; await delay(25); } while (Date.now() < deadline);
      assert.fail(`durable ${host} position for ${file}: ${actual}, expected ${expected}`);
    };
    const next = () => page.locator('[data-page="next"]').click();
    const file = async (name: string) => { await page.locator('.pith-nav-toggle').click(); await page.locator(`[data-file="${name}"]`).click(); await page.locator('.pith-epub-chapter h1').getByText(name === 'long.epub' ? 'Long paragraph' : 'One', { exact: true }).waitFor({ state: 'attached' }); };
    await open(); await next(); await next();
    const normal = await snapshot(); assert.match(normal.counter, /^3 \/ /); assert.notEqual(normal.locator, 'text:section:0;block:0'); await save('normal.epub', normal.locator, normal.offset);
    await browser.close(); await open(); const reopened = await snapshot(); assert.deepEqual(reopened, normal, JSON.stringify({ saved: (await store.getMaterial(material.id))!.files[0], reopened, normal }));
    if (host === 'Web') await screenshot(page, 'epub-reopened');
    await file('long.epub'); await next(); await next(); const paragraph = await snapshot(); assert.match(paragraph.counter, /^3 \/ /); assert.match(paragraph.locator, /block:1$/); assert.ok(paragraph.offset > 0); await save('long.epub', paragraph.locator, paragraph.offset);
    await file('normal.epub'); assert.deepEqual(await snapshot(), normal); await file('long.epub'); assert.deepEqual(await snapshot(), paragraph); await save('long.epub', paragraph.locator, paragraph.offset);
    await browser.close(); await open(); assert.deepEqual(await snapshot(), paragraph);
    for (const width of [720, 1200, 850, 1000]) {
      await page.setViewportSize({ width, height: 700 });
      await page.waitForFunction(({ locator, offset }: any) => { const reader = document.querySelector<HTMLElement>('.pith-reader')!, article = document.querySelector<HTMLElement>('.pith-article')!; if (parseFloat(article.style.width) !== reader.clientWidth) return false; const block = (window as any).Reading.resolveReaderLocator(article, locator), walker = document.createTreeWalker(block, 4); let n: any, left = offset; while ((n = walker.nextNode())) { if (left < n.length) { const range = document.createRange(); range.setStart(n, left); range.setEnd(n, left + 1); const viewport = reader.getBoundingClientRect(); return Array.from(range.getClientRects()).some(rect => rect.width > 0 && rect.right > viewport.left && rect.left < viewport.right && rect.bottom > viewport.top && rect.top < viewport.bottom); } left -= n.length; } return false; }, paragraph).catch(async (error: Error) => { throw new Error(`${error.message} ${JSON.stringify({ host, width, current: await snapshot(), paragraph })}`); });
    }
    const resized = await snapshot(); await save('long.epub', resized.locator, resized.offset);
    if (host === 'Web') await screenshot(page, 'epub-long-resize');
    await browser.close(); await open(); assert.deepEqual(await snapshot(), resized);
  } finally { if (browser) await browser.close(); if (server) await new Promise<void>((resolve, reject) => { server!.close(error => error ? reject(error) : resolve()); server!.closeAllConnections(); }); await rm(root, { recursive: true, force: true }); }
});
