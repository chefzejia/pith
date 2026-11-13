import assert from "node:assert/strict";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { build } from "esbuild";
import { createPithWebServer } from "../src/shells/web/server.ts";
import { testSandbox } from "./sandbox.ts";
import { createTestTopic } from "./topic-fixture.ts";
import { pdfFixture } from "./task55-pdf-fixture.ts";

test("PDF pages render in both hosts and notes return to the correct page", { timeout: 90000, skip: !process.env.PITH_PLAYWRIGHT_MODULE || !process.env.PITH_CHROME_PATH }, async () => {
  process.env.DEBUG = [process.env.DEBUG, "pw:browser"].filter(Boolean).join(",");
  const { chromium } = await import(process.env.PITH_PLAYWRIGHT_MODULE!);
  const dir = await testSandbox("task55-pdf-"), profile = join(dir, "chrome-profile");
  let browser: any, server: Awaited<ReturnType<typeof createPithWebServer>> | undefined;
  try {
    await mkdir(join(dir, "workspace"));
    server = await createPithWebServer({ workspaceDir: join(dir, "workspace") });
    const address = server.address(); assert.ok(address && typeof address !== "string");
    const base = `http://127.0.0.1:${address.port}`, topic = await createTestTopic(join(dir, "workspace"), { title: "PDF pages" });
    const response = await fetch(`${base}/api/materials`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ topicId: topic.id, title: "PDF", kind: "book", files: [{ name: "book.pdf", mimeType: "application/pdf", data: Buffer.from(pdfFixture()).toString("base64") }, { name: "other.txt", mimeType: "text/plain", data: Buffer.from("Another document").toString("base64") }] }) });
    assert.ok(response.ok); const material = await response.json() as { id: string };
    console.error(`task55 browser profile=${profile}`);
    browser = await chromium.launchPersistentContext(profile, { executablePath: process.env.PITH_CHROME_PATH, headless: true, timeout: 20000 });
    const page = await browser.newPage();
    page.on("requestfailed", (request: any) => console.error(`task55 request failed ${request.url()} ${request.failure()?.errorText}`));
    console.error(`task55 server status=${(await fetch(base)).status} url=${base}`);
    await page.setViewportSize({ width: 1120, height: 800 }); await page.goto(base, { waitUntil: "commit", timeout: 30000 }); await page.locator(`[data-topic="${topic.id}"]`).first().click({ timeout: 60000 });
    await page.locator('.pith-pdf-page').first().waitFor();
    assert.equal(await page.locator('.pith-pdf-page').count(), 2);
    const dimensions = await page.locator('.pith-pdf-page img').first().boundingBox(); assert.ok(dimensions && dimensions.width > 250 && dimensions.height > 250, JSON.stringify(dimensions));
    for (const [index, color] of [[0, "red"], [1, "blue"]] as const) {
      const actual = await page.locator('.pith-pdf-page img').nth(index).evaluate(async (image: HTMLImageElement) => { await image.decode(); const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight; const context = canvas.getContext('2d')!; context.drawImage(image, 0, 0); return Array.from(context.getImageData(Math.round(canvas.width * .2), Math.round(canvas.height * .8), 1, 1).data); });
      assert.ok(color === "red" ? actual[0]! > actual[2]! + 70 : actual[2]! > actual[0]! + 70, JSON.stringify(actual));
    }
    assert.deepEqual(await page.locator('.pith-pdf-text').evaluateAll((nodes: Element[]) => nodes.map(node => node.getAttribute('data-locator'))), ['page:1', 'page:2']);
    await page.locator('.pith-pdf-text').nth(1).locator('span').first().evaluate((span: Element) => { const range = document.createRange(); range.selectNodeContents(span); const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range); span.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); });
    await page.locator('[data-selection="highlight"]').click();
    await page.waitForFunction(() => document.querySelector('.pith-pdf-text[data-locator="page:2"] mark[data-pith-note]'));
    assert.equal(await page.locator('.pith-pdf-text[data-locator="page:1"] mark').count(), 0);
    const state: any = await (await fetch(`${base}/api/state`)).json();
    const note = state.compass.exploring.find((item: any) => item.id === topic.id).notes[0]; assert.equal(note.anchor.locator, 'page:2');
    await page.locator('[data-command="home"]').click(); await page.locator(`[data-topic="${topic.id}"]`).first().click();
    await page.waitForFunction(() => document.querySelector('.pith-pdf-text[data-locator="page:2"] mark[data-pith-note]'));
    await page.locator('.pith-nav-toggle').click(); await page.locator('[data-file="other.txt"]').click();
    await page.locator('.pith-article').getByText('Another document').waitFor();
    if (!await page.locator('.pith-guide').isVisible()) await page.locator('.pith-guide-toggle').click();
    await page.locator('[data-guide-tab="notes"]').click(); await page.locator(`[data-note-id="${note.id}"]`).click();
    await page.waitForFunction(() => { const mark = document.querySelector('.pith-pdf-text[data-locator="page:2"] mark[data-pith-note]'); if (!mark) return false; const bounds = mark.closest('.pith-fixed-page')!.getBoundingClientRect(), viewport = document.querySelector('.pith-reader')!.getBoundingClientRect(); return bounds.left >= viewport.left - 1 && bounds.right <= viewport.right + 1; }, null, { timeout: 5000 });
    if (process.env.PITH_TASK55_SCREENSHOT) await page.screenshot({ path: process.env.PITH_TASK55_SCREENSHOT });
    const bundle = await build({ entryPoints: ['src/shells/obsidian/plugin.ts', 'src/plugins/stage-reader/index.ts'], bundle: true, write: false, platform: 'browser', format: 'iife', outdir: 'task55', globalName: 'Task55' });
    const readerBundle = bundle.outputFiles.find(item => item.path.endsWith('/index.js'))!, viewBundle = bundle.outputFiles.find(item => item.path.endsWith('/plugin.js'))!;
    await page.goto('about:blank'); await page.setContent('<style>html,body,#root{height:100%;margin:0}</style><div id="root"></div>');
    await page.addScriptTag({ content: viewBundle.text }); await page.evaluate(() => { (window as any).Task55View = (window as any).Task55; }); await page.addScriptTag({ content: readerBundle.text });
    const rendered = await page.evaluate(async ({ data, materialId }: { data: number[]; materialId: string }) => { const reader = (window as any).Task55, View = (window as any).Task55View.PithObsidianView, document = await reader.renderFile({ name: 'book.pdf', mimeType: 'application/pdf', bytes: data.length, sha256: '' }, new Uint8Array(data)); const note = { id: 'page-two', kind: 'highlight', body: 'Repeated phrase', anchor: { source: { kind: 'material', materialId }, file: 'book.pdf', locator: 'page:2', quote: 'Repeated phrase' } }; const view = new View(window.document.getElementById('root'), { openFile() {}, selection() {}, openToolkit() {}, guideData: async () => ({ notes: [note], toolkits: [], conversation: [], actions: [] }) }); view.render({ ...document, currentFile: 'book.pdf', source: { kind: 'material', materialId }, files: [], title: 'PDF' }); await view.refreshGuide(); return { sections: document.sections.map((section: any) => section.locator), pages: document.pages.length }; }, { data: Array.from(pdfFixture()), materialId: material.id });
    assert.deepEqual(rendered.sections, ['page:1', 'page:2']); assert.equal(rendered.pages, 2);
    assert.equal(await page.locator('.pith-pdf-text[data-locator="page:1"] mark').count(), 0); assert.equal(await page.locator('.pith-pdf-text[data-locator="page:2"] mark').count(), 1);
    if (process.env.PITH_TASK55_NATIVE_SCREENSHOT) await page.screenshot({ path: process.env.PITH_TASK55_NATIVE_SCREENSHOT });
  } finally {
    if (browser) await browser.close();
    if (server) await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve()));
    await rm(dir, { recursive: true, force: true });
  }
});
