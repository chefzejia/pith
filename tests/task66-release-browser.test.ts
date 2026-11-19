import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { DefaultWorkspaceStore } from "../src/core/index.ts";
import { NodeWorkspaceStorage } from "../src/shells/web/nodeStorage.ts";
import { createPithWebServer } from "../src/shells/web/server.ts";
import { testSandbox } from "./sandbox.ts";
import { manyPagePdf } from "./task55-pdf-fixture.ts";

const browserOptions = { timeout: 90000, skip: !process.env.PITH_PLAYWRIGHT_MODULE || !process.env.PITH_CHROME_PATH };

async function closeServer(server: Awaited<ReturnType<typeof createPithWebServer>>): Promise<void> {
  await new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); });
}

test("late PDF interline stays in its original page slot through paging and resize", browserOptions, async t => {
  const root = await testSandbox("task66-pdf-");
  const store = new DefaultWorkspaceStore(new NodeWorkspaceStorage(root));
  const total = 89, sourcePage = 39;
  const material = await store.importMaterial({ title: "Controlled PDF", kind: "book", aids: ["interline"], files: [{ name: "book.pdf", mimeType: "application/pdf", bytes: manyPagePdf(total, true) }] });
  const topic = await store.createTopic({ title: "PDF citation", target: "Find the source", materialIds: [material.id], toolkits: [] });
  await store.writeLesson(topic.id, "lesson.md", "# Source\n\nbook.pdf#page=39");
  const ending = "End of the translation for source page 39.";
  const translation = Array.from({ length: 36 }, (_, i) => `Translation paragraph ${i + 1} for source page 39.\n`).join("") + ending;
  let release!: () => void;
  const ready = new Promise<void>(resolve => { release = resolve; });
  const server = await createPithWebServer({
    workspaceDir: root,
    guideProvider: { async run() { throw new Error("No guide turn expected"); } },
    interlineTranslator: async ({ segments }) => {
      await ready;
      return new Map(segments.map(({ locator }) => [locator, locator === "page:39" ? translation : `Translation for ${locator}`]));
    },
  });
  let browser: any;
  try {
    const { chromium } = await import(process.env.PITH_PLAYWRIGHT_MODULE!);
    browser = await chromium.launch({ executablePath: process.env.PITH_CHROME_PATH, headless: process.env.PITH_TASK66_HEADED !== "1" });
    const page = await browser.newPage({ viewport: { width: 480, height: 820 } });
    const address = server.address(); assert.ok(address && typeof address !== "string");
    await page.goto(`http://127.0.0.1:${address.port}`);
    await page.locator(`.pith-topic-card[data-topic="${topic.id}"]`).click();
    await page.getByRole("button", { name: "book.pdf#page=39" }).click();
    const fixed = page.locator('.pith-fixed-page[data-locator="page:39"]');
    await fixed.locator("img").evaluate((node: HTMLImageElement) => node.decode());
    const original = fixed.locator(".pith-pdf-text > span").first();
    const capture = async (step: string) => {
      const directory = process.env.PITH_TASK66_RELEASE_SCREENSHOTS;
      if (directory) await page.screenshot({ path: join(directory, `web-pdf-${step}.png`) });
    };
    const assertPage = async (number: number, step: string) => {
      const geometry = await page.locator(".pith-reader").evaluate((reader: HTMLElement) => {
        const viewport = reader.getBoundingClientRect();
        const counter = document.querySelector("[data-page-count]")!;
        const visible = Array.from(reader.querySelectorAll<HTMLElement>(".pith-fixed-page")).filter(figure => {
          const rect = figure.getBoundingClientRect();
          return rect.right > viewport.left + 1 && rect.left < viewport.right - 1;
        });
        return {
          width: reader.clientWidth, extent: reader.scrollWidth, left: reader.scrollLeft,
          counter: counter.textContent,
          pages: visible.map(figure => figure.dataset.locator),
          originals: visible.map(figure => figure.querySelector(".pith-pdf-text")?.textContent),
        };
      });
      t.diagnostic(`${step}: ${JSON.stringify(geometry)}`);
      assert.equal(geometry.extent, total * geometry.width, "each source PDF page must occupy exactly one horizontal screen");
      assert.equal(geometry.left, (number - 1) * geometry.width);
      assert.equal(geometry.counter, `${number} / ${total}`);
      assert.deepEqual(geometry.pages, [`page:${number}`]);
      assert.deepEqual(geometry.originals, [`Source page ${number}`]);
      assert.equal(await page.locator("[data-pages]").evaluate((pager: HTMLElement) => {
        const header = pager.parentElement!.getBoundingClientRect();
        return Array.from(pager.children).every(child => {
          const bounds = child.getBoundingClientRect();
          return bounds.top >= header.top && bounds.bottom <= header.bottom &&
            bounds.left >= header.left && bounds.right <= header.right;
        });
      }), true, "the counter and both page controls must fit inside the header");
    };
    const assertSelectable = async () => {
      const text = await original.evaluate((node: HTMLElement) => {
        const range = document.createRange(); range.selectNodeContents(node);
        const { left, right, top, bottom } = range.getBoundingClientRect();
        const y = (top + bottom) / 2;
        return {
          left, right, y, transparent: getComputedStyle(node).color === "rgba(0, 0, 0, 0)",
          hit: document.elementFromPoint(left + 1, y) === node,
          priorSelection: getSelection()?.toString(),
        };
      });
      assert.ok(text.hit && text.transparent && text.right - text.left > 15, JSON.stringify(text));
      if (text.priorSelection) await page.mouse.click((text.left + text.right) / 2, text.y);
      await page.mouse.move(text.left + 1, text.y);
      await page.mouse.down();
      await page.mouse.move(text.right - 1, text.y, { steps: 12 });
      await page.mouse.up();
      assert.equal(await page.evaluate(() => getSelection()?.toString()), "Source page 39", JSON.stringify(text));
    };
    const assertBelowOriginal = async () => {
      const geometry = await fixed.evaluate((slot: HTMLElement) => {
        const original = slot.querySelector("img")!.getBoundingClientRect();
        const subtitle = slot.querySelector(":scope > .pith-interline-subtitle")?.getBoundingClientRect();
        return { originalTop: original.top, originalBottom: original.bottom, subtitleTop: subtitle?.top, slotBottom: slot.getBoundingClientRect().bottom };
      });
      assert.ok(geometry.originalBottom > geometry.originalTop &&
        geometry.subtitleTop >= geometry.originalBottom && geometry.subtitleTop < geometry.slotBottom, JSON.stringify(geometry));
    };
    const scrollToEnd = async (width: string, input: "wheel" | "keyboard") => {
      const measure = await fixed.evaluate((slot: HTMLElement) => ({ excess: slot.scrollHeight - slot.clientHeight, top: slot.scrollTop }));
      assert.equal(measure.top, 0);
      assert.ok(measure.excess > 300, JSON.stringify(measure));
      const bounds = await fixed.boundingBox();
      assert.ok(bounds);
      if (input === "keyboard") {
        await fixed.focus();
        await page.keyboard.press("PageDown");
        await page.waitForFunction(() => document.querySelector('.pith-fixed-page[data-locator="page:39"]')!.scrollTop > 100);
        await page.keyboard.press("End");
      } else {
        await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
        await page.mouse.wheel(0, measure.excess * 2);
      }
      await page.waitForFunction((ending: string) => {
        const slot = document.querySelector('.pith-fixed-page[data-locator="page:39"]')!;
        const text = slot.querySelector(":scope > .pith-interline-subtitle")?.firstChild;
        if (!(text instanceof Text) || slot.scrollTop <= 300 || !text.data.endsWith(ending)) return false;
        const range = document.createRange();
        range.setStart(text, text.length - ending.length); range.setEnd(text, text.length);
        const bounds = range.getBoundingClientRect(), viewport = slot.getBoundingClientRect();
        return bounds.top >= viewport.top && bounds.bottom <= viewport.bottom && bounds.right <= viewport.right;
      }, ending);
      await page.locator(".pith-selection").waitFor({ state: "hidden" });
      t.diagnostic(`${width}: native ${input}, ${await fixed.evaluate((slot: HTMLElement) => slot.scrollTop)}px scrolled to the last line`);
      await assertPage(sourcePage, `${width} at translation end`);
      await capture(`${width}-translation-end`);
    };
    const pageButton = (direction: "previous" | "next") => page.locator(`[data-page="${direction}"]`);
    const turnAdjacent = async (width: string) => {
      await pageButton("next").click();
      await assertPage(40, `${width} next`);
      await pageButton("previous").click();
      await assertPage(39, `${width} back`);
      await pageButton("previous").click();
      await assertPage(38, `${width} previous`);
      await pageButton("next").click();
      await assertPage(39, `${width} return`);
    };
    await assertPage(sourcePage, "compact before translation");
    assert.equal(await page.locator(".pith-interline-subtitle").count(), 0);
    await capture("compact-before-translation");
    release();
    const subtitle = page.locator(".pith-interline-subtitle").getByText(translation, { exact: true });
    await subtitle.waitFor();
    await capture("compact-translation-arrived");
    await assertPage(sourcePage, "compact after translation");
    await assertBelowOriginal();
    await assertSelectable();
    await capture("compact-after-translation");
    await scrollToEnd("compact", "wheel");
    await turnAdjacent("compact");
    await scrollToEnd("compact-before-resize", "wheel");
    await page.setViewportSize({ width: 1180, height: 920 });
    await page.waitForFunction(() => {
      const reader = document.querySelector<HTMLElement>(".pith-reader")!;
      return reader.clientWidth > 900 && reader.scrollLeft === 38 * reader.clientWidth;
    });
    await assertPage(sourcePage, "wide resized during translation");
    assert.ok(await fixed.evaluate((slot: HTMLElement) => slot.scrollTop > 100));
    await turnAdjacent("wide");
    await assertBelowOriginal();
    await assertSelectable();
    await capture("wide-after-translation");
    const fontSize = (node: HTMLElement) => parseFloat(getComputedStyle(node).fontSize);
    const bilingualSize = await subtitle.evaluate(fontSize);
    await page.locator('[data-command="typography"]').click();
    assert.equal(await page.locator("[data-page-modes]").isHidden(), true);
    await page.locator('.pith-typography-popover [data-interline-mode="subtitle-primary"]').click();
    const primary = page.locator('.pith-interline-subtitle[data-interline-mode="subtitle-primary"]').getByText(translation, { exact: true });
    await primary.waitFor();
    assert.equal(await primary.evaluate((node: HTMLElement) => (node.parentElement as HTMLElement).dataset.locator), "page:39");
    assert.ok(await primary.evaluate(fontSize) > bilingualSize, "primary translation must stand out");
    await assertPage(sourcePage, "wide translation-primary");
    await assertBelowOriginal();
    await page.locator('[data-command="typography"]').click();
    await capture("wide-translation-primary");
    await scrollToEnd("wide", "keyboard");
    await page.locator('[data-command="typography"]').click();
    await page.locator('.pith-typography-popover [data-interline-mode="original"]').click();
    await subtitle.waitFor({ state: "detached" });
    await assertPage(sourcePage, "wide original mode");
    assert.equal(await fixed.evaluate((slot: HTMLElement) => slot.scrollTop), 0);
    await assertSelectable();
    await page.setViewportSize({ width: 480, height: 820 });
    await page.waitForFunction(() => {
      const reader = document.querySelector<HTMLElement>(".pith-reader")!;
      return reader.clientWidth < 500 && reader.scrollLeft === 38 * reader.clientWidth;
    });
    await assertPage(sourcePage, "compact resized back in original mode");
  } finally {
    release();
    await browser?.close();
    await closeServer(server);
    await rm(root, { recursive: true, force: true });
  }
});

test("a settled topic stays readable without offering new Feynman practice", browserOptions, async () => {
  const root = await testSandbox("task66-settled-ui-");
  const store = new DefaultWorkspaceStore(new NodeWorkspaceStorage(root));
  const topic = await store.createTopic({ title: "Settled for review", target: "Explain the source", materialIds: [], toolkits: ["feynman"] });
  await store.writeLesson(topic.id, "lesson.md", "# Readable lesson\n\nPreserve this original passage for review.");
  await store.appendTopicNote(topic.id, { kind: "practice", author: "user", body: "Earlier practice" });
  await store.updateTopic(topic.id, { status: "settled" });
  const server = await createPithWebServer({
    workspaceDir: root,
    guideProvider: { async run() { throw new Error("No guide turn expected"); } },
    promptService: { async prompt() { throw new Error("No new practice expected"); } },
  });
  let browser: any;
  try {
    const { chromium } = await import(process.env.PITH_PLAYWRIGHT_MODULE!);
    browser = await chromium.launch({ executablePath: process.env.PITH_CHROME_PATH, headless: process.env.PITH_TASK66_HEADED !== "1" });
    const page = await browser.newPage({ viewport: { width: 1180, height: 840 } });
    const address = server.address(); assert.ok(address && typeof address !== "string");
    await page.goto(`http://127.0.0.1:${address.port}`);
    await page.locator(`.pith-settled-row[data-topic="${topic.id}"]`).click();
    await page.locator(".pith-article").getByRole("heading", { name: "Readable lesson" }).waitFor();
    await page.locator(".pith-guide-toggle").click();
    const composer = page.locator(".pith-guide textarea");
    await composer.waitFor();
    assert.equal(await composer.isDisabled(), true);
    assert.equal(await page.locator("#open-toolkit").isHidden(), true);
    await page.getByText("Preserve this original passage for review.").click();
    assert.equal(await page.locator(".pith-inline-toolkit").count(), 0);
    await page.locator('[data-guide-tab="notes"]').click();
    await page.locator(".pith-guide-content").getByText("Earlier practice").waitFor();
    const directory = process.env.PITH_TASK66_RELEASE_SCREENSHOTS;
    if (directory) await page.screenshot({ path: join(directory, "web-settled-review.png") });
    assert.deepEqual((await store.getTopic(topic.id))!.notes.map(note => note.body), ["Earlier practice"]);
  } finally {
    await browser?.close();
    await closeServer(server);
    await rm(root, { recursive: true, force: true });
  }
});
