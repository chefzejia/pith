import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { applyPaginationStyles, computePagination } from "../src/plugins/stage-reader/pagination.ts";
import { obsidianStyles } from "../src/shells/obsidian/plugin.ts";

test("real browser keeps delayed figure, caption and following text in separate flow", { skip: !process.env.PITH_PLAYWRIGHT_MODULE || !process.env.PITH_CHROME_PATH }, async () => {
  const { chromium } = await import(process.env.PITH_PLAYWRIGHT_MODULE!);
  const profile = await mkdtemp(join(tmpdir(), "pith-figure-browser-"));
  let browser: Awaited<ReturnType<typeof chromium.launchPersistentContext>> | undefined;
  try {
    browser = await chromium.launchPersistentContext(profile, { executablePath: process.env.PITH_CHROME_PATH, headless: true, viewport: { width: 1500, height: 800 }, args: ["--no-first-run", "--no-default-browser-check"] });
    const web = await readFile(new URL("../src/shells/web/server.ts", import.meta.url), "utf8");
    const webStyles = web.match(/<style>([\s\S]*?)<\/style>/)?.[1];
    assert.ok(webStyles);
    for (const shell of ["web", "obsidian"] as const) {
      for (const mode of ["single", "double"] as const) {
        const page = await browser.newPage();
        let release!: () => void;
        const gate = new Promise<void>(resolve => { release = resolve; });
        await page.route("https://pith.invalid/tall.svg", async (route: { fulfill(options: unknown): Promise<void> }) => { await gate; await route.fulfill({ status: 200, contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="2400"><rect width="800" height="2400" fill="teal"/></svg>' }); });
        const readerClass = shell === "web" ? "reader paged" : "pith-reader pith-paged";
        const article = shell === "web" ? 'id="article"' : 'class="pith-article"';
        const width = mode === "single" ? 656 : 1332;
        await page.setContent(`<style>${shell === "web" ? webStyles : obsidianStyles}\nbody{margin:0}.fixture{width:${width}px;height:634px}.fixture .reader,.fixture .pith-reader{width:100%;height:100%}figure{margin:20px 40px;padding:8px;border:2px solid}figcaption{max-width:180px}</style><div class="${shell === "web" ? "fixture" : "fixture pith-view"}"><div class="${readerClass}"><article ${article}><figure><img src="https://pith.invalid/tall.svg"><figcaption>TEST IMAGE CAPTION with a second line for measurement</figcaption></figure><p>TEXT AFTER IMAGE</p></article></div></div>`, { waitUntil: "domcontentloaded" });
        await page.evaluate(`window.computePagination=${computePagination.toString()};window.applyPaginationStyles=${applyPaginationStyles.toString()};window.repaginate=()=>window.applyPaginationStyles(document.querySelector('.${shell === "web" ? "reader" : "pith-reader"}'),document.querySelector('${shell === "web" ? "#article" : ".pith-article"}'),'${mode}',window.repaginate);window.repaginate()`);
        assert.equal(await page.locator("img").evaluate((image: HTMLImageElement) => image.complete), false);
        release();
        await page.locator("img").evaluate((image: HTMLImageElement) => image.decode());
        const rects = await page.evaluate(() => {
          const rect = (selector: string) => { const r = document.querySelector(selector)!.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; };
          return { image: rect("img"), figure: rect("figure"), caption: rect("figcaption"), next: rect("p"), reader: rect(".reader, .pith-reader") };
        });
        assert.ok(rects.image.height > 20, `${shell}/${mode}: image rendered`);
        assert.ok(rects.caption.left >= rects.figure.left - 1 && rects.caption.right <= rects.figure.right + 1, `${shell}/${mode}: caption stays in figure column`);
        assert.ok(rects.caption.top >= rects.image.bottom - 1 && rects.caption.bottom <= rects.reader.bottom + 1, `${shell}/${mode}: caption follows image within page`);
        assert.ok(rects.figure.bottom <= rects.reader.bottom + 1, `${shell}/${mode}: figure fits page`);
        const overlaps = rects.next.left < rects.caption.right && rects.next.right > rects.caption.left && rects.next.top < rects.caption.bottom && rects.next.bottom > rects.caption.top;
        assert.equal(overlaps, false, `${shell}/${mode}: caption and following paragraph do not overlap`);
        await page.close();
      }
    }
  } finally {
    if (browser) await browser.close();
    await rm(profile, { recursive: true, force: true });
  }
});
