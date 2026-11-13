import assert from "node:assert/strict";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { build } from "esbuild";
import { createPithWebServer } from "../src/shells/web/server.ts";
import { testSandbox } from "./sandbox.ts";
import { createTestTopic } from "./topic-fixture.ts";
import { manyPagePdf } from "./task55-pdf-fixture.ts";

test("PDF page and annotation survive consecutive resizes in both workbench hosts", { timeout: 90000, skip: !process.env.PITH_PLAYWRIGHT_MODULE || !process.env.PITH_CHROME_PATH }, async () => {
  const { chromium } = await import(process.env.PITH_PLAYWRIGHT_MODULE!);
  const dir = await testSandbox("task55-resize-"), profile = join(dir, "profile");
  let browser: any, server: Awaited<ReturnType<typeof createPithWebServer>> | undefined;
  try {
    await mkdir(join(dir, "workspace"));
    server = await createPithWebServer({ workspaceDir: join(dir, "workspace") });
    const address = server.address(); assert.ok(address && typeof address !== "string");
    const base = `http://127.0.0.1:${address.port}`;
    const topic = await createTestTopic(join(dir, "workspace"), { title: "PDF resize" });
    const post = async (path: string, data: unknown) => { const response = await fetch(base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data) }); assert.ok(response.ok, await response.clone().text()); return response.json() as Promise<any>; };
    const material = await post("/api/materials", { topicId: topic.id, title: "PDF", kind: "book", files: [{ name: "book.pdf", mimeType: "application/pdf", data: Buffer.from(manyPagePdf(3)).toString("base64") }] });
    await post("/api/notes", { topicId: topic.id, kind: "highlight", body: "Long book", anchor: { source: { kind: "material", materialId: material.id }, file: "book.pdf", locator: "page:3", quote: "Long book" } });
    const bundle = await build({ entryPoints: ["src/shells/obsidian/plugin.ts", "src/plugins/stage-reader/index.ts"], bundle: true, write: false, platform: "browser", format: "iife", outdir: "resize-fixture", globalName: "ResizeFixture" });
    console.error(`task55-resize profile=${profile}`);
    browser = await chromium.launchPersistentContext(profile, { executablePath: process.env.PITH_CHROME_PATH, headless: true, viewport: { width: 650, height: 800 }, timeout: 20000 });
    const page = await browser.newPage(); page.setDefaultTimeout(8000);
    for (const host of ["web", "native"] as const) {
      await page.setViewportSize({ width: 650, height: 800 });
      if (host === "web") {
        await page.goto(base); await page.locator(`[data-topic="${topic.id}"]`).first().click();
        await page.locator('.pith-pdf-page').first().waitFor();
      } else {
        await page.goto("about:blank"); await page.setContent('<style>html,body,#root{height:100%;margin:0}</style><div id="root"></div>');
        await page.addScriptTag({ content: bundle.outputFiles.find(item => item.path.endsWith('/plugin.js'))!.text });
        await page.evaluate(() => { (window as any).ResizeView = (window as any).ResizeFixture; });
        await page.addScriptTag({ content: bundle.outputFiles.find(item => item.path.endsWith('/index.js'))!.text });
        await page.evaluate(async (data: number[]) => { const reader = (window as any).ResizeFixture, View = (window as any).ResizeView.PithObsidianView; const rendered = await reader.renderFile({ name: 'book.pdf', mimeType: 'application/pdf', bytes: data.length, sha256: '' }, new Uint8Array(data)); const source = { kind: 'material', materialId: 'fixture' }; const note = { id: 'pdf-note', kind: 'highlight', body: 'Long book', anchor: { source, file: 'book.pdf', locator: 'page:3', quote: 'Long book' } }; const view = new View(document.getElementById('root'), { openFile() {}, selection() {}, openToolkit() {}, guideData: async () => ({ notes: [note], toolkits: [], conversation: [], actions: [] }) }); view.render({ ...rendered, currentFile: 'book.pdf', source, files: [], title: 'PDF' }); await view.refreshGuide(); }, Array.from(manyPagePdf(3)));
      }
      await page.locator('[data-page="next"]').click(); await page.locator('[data-page="next"]').click();
      await page.waitForFunction(() => document.querySelector('[data-page-count]')?.textContent?.trim() === '3 / 3');
      const verify = async (label: string) => {
        const result = await page.evaluate(() => { const reader = document.querySelector<HTMLElement>('.pith-reader')!, rect = reader.getBoundingClientRect(), pages = Array.from(document.querySelectorAll<HTMLElement>('.pith-fixed-page')).map(page => { const r = page.getBoundingClientRect(); return { locator: page.dataset.locator, width: Math.max(0, Math.min(r.right, rect.right) - Math.max(r.left, rect.left)) }; }); const visible = pages.reduce((best, item) => item.width > best.width ? item : best); const mark = document.querySelector<HTMLElement>('.pith-pdf-text[data-locator="page:3"] mark[data-pith-note]'), m = mark?.getBoundingClientRect(); return { counter: document.querySelector('[data-page-count]')?.textContent?.trim(), visible: visible.locator, markVisible: Boolean(m && m.right > rect.left && m.left < rect.right && m.bottom > rect.top && m.top < rect.bottom), left: reader.scrollLeft, width: reader.clientWidth, pages }; });
        assert.deepEqual([result.counter, result.visible, result.markVisible], ['3 / 3', 'page:3', true], `${host} ${label}: ${JSON.stringify(result)}`);
      };
      await verify('before');
      for (const [width, height] of [[1100, 850], [650, 800], [700, 800], [1100, 850], [650, 800]] as const) {
        await page.setViewportSize({ width, height });
        await page.waitForFunction(() => { const reader = document.querySelector<HTMLElement>('.pith-reader'), article = document.querySelector<HTMLElement>('.pith-article'); return Boolean(reader && article && reader.clientWidth > 0 && reader.clientHeight > 0 && parseFloat(article.style.width) === reader.clientWidth && parseFloat(article.style.height) === reader.clientHeight); });
        await verify(`${width}x${height}`);
      }
      if (process.env.PITH_RESIZE_EVIDENCE) await page.screenshot({ path: join(process.env.PITH_RESIZE_EVIDENCE, `${host}-resize.png`) });
    }
  } finally {
    if (browser) await browser.close();
    if (server) await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve()));
    await rm(dir, { recursive: true, force: true });
  }
});
