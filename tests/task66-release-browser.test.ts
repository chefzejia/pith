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

test("late PDF interline leaves the on-canvas original readable at citation page 76", browserOptions, async () => {
  const root = await testSandbox("task66-pdf-");
  const store = new DefaultWorkspaceStore(new NodeWorkspaceStorage(root));
  const material = await store.importMaterial({ title: "Controlled PDF", kind: "book", aids: ["interline"], files: [{ name: "book.pdf", mimeType: "application/pdf", bytes: manyPagePdf(76) }] });
  const topic = await store.createTopic({ title: "PDF citation", target: "Find the source", materialIds: [material.id], toolkits: [] });
  await store.writeLesson(topic.id, "lesson.md", "# Source\n\nbook.pdf#page=76");
  const translation = "这是第 76 页的译文。原文和译文在页面上分开显示。";
  let release!: () => void;
  const ready = new Promise<void>(resolve => { release = resolve; });
  const server = await createPithWebServer({
    workspaceDir: root,
    guideProvider: { async run() { throw new Error("No guide turn expected"); } },
    interlineTranslator: async ({ segments }) => {
      await ready;
      return new Map(segments.map(({ locator }) => [locator, locator === "page:76" ? translation : "邻页译文"]));
    },
  });
  let browser: any;
  try {
    const { chromium } = await import(process.env.PITH_PLAYWRIGHT_MODULE!);
    browser = await chromium.launch({ executablePath: process.env.PITH_CHROME_PATH, headless: process.env.PITH_TASK66_HEADED !== "1" });
    const page = await browser.newPage({ viewport: { width: 1180, height: 920 } });
    const address = server.address(); assert.ok(address && typeof address !== "string");
    await page.goto(`http://127.0.0.1:${address.port}`);
    await page.locator(`.pith-topic-card[data-topic="${topic.id}"]`).click();
    await page.getByRole("button", { name: "book.pdf#page=76" }).click();
    const fixed = page.locator('.pith-fixed-page[data-locator="page:76"]');
    const image = fixed.locator("img");
    await image.evaluate((node: HTMLImageElement) => node.decode());
    await page.locator("[data-page-count]").getByText("76 / 76", { exact: true }).waitFor();
    await page.locator('[data-command="typography"]').click();
    await page.locator('[data-mode="double"]').click();
    await page.locator('[data-command="typography"]').click();
    const original = fixed.locator(".pith-pdf-text > span").first();
    const before = await original.boundingBox();
    assert.ok(before && before.width > 0 && before.height > 0);
    const capture = async (step: string) => {
      const directory = process.env.PITH_TASK66_RELEASE_SCREENSHOTS;
      if (directory) await page.screenshot({ path: join(directory, `web-pdf-${step}.png`) });
    };
    assert.equal(await page.locator(".pith-interline-subtitle").count(), 0);
    await capture("before-translation");
    release();
    const subtitle = page.locator(".pith-interline-subtitle").getByText(translation, { exact: true });
    await subtitle.waitFor();
    await capture("after-translation");
    const geometry = await subtitle.evaluate((element: HTMLElement) => {
      const figure = document.querySelector('.pith-fixed-page[data-locator="page:76"]')!;
      const page = figure.querySelector("img")!.getBoundingClientRect();
      const reader = document.querySelector(".pith-reader")!.getBoundingClientRect();
      const layer = figure.querySelector<HTMLElement>(".pith-pdf-text")!;
      const source = layer.firstElementChild!;
      const range = document.createRange(); range.selectNodeContents(source);
      const text = range.getBoundingClientRect();
      const intersects = (a: DOMRect, b: DOMRect) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
      const overlap = Array.from(element.getClientRects()).some(rect => intersects(page, rect));
      const selected = getSelection()!; selected.removeAllRanges(); selected.addRange(range);
      const hit = document.elementFromPoint(text.x + text.width / 2, text.y + text.height / 2);
      return { overlap, originalVisible: intersects(page, reader), selectable: getComputedStyle(layer).userSelect === "text" && layer.contains(hit) && selected.toString() === "Long book", color: getComputedStyle(source).color, width: text.width };
    });
    assert.equal(geometry.overlap, false, JSON.stringify(geometry));
    assert.ok(geometry.originalVisible && geometry.selectable && geometry.width > 0, JSON.stringify(geometry));
    assert.equal(geometry.color, "rgba(0, 0, 0, 0)");
    const fontSize = (node: HTMLElement) => parseFloat(getComputedStyle(node).fontSize);
    const bilingualSize = await subtitle.evaluate(fontSize);
    await page.locator('[data-command="typography"]').click();
    await page.locator('.pith-typography-popover [data-interline-mode="subtitle-primary"]').click();
    const primary = page.locator('.pith-interline-subtitle[data-interline-mode="subtitle-primary"]').getByText(translation, { exact: true });
    await primary.waitFor();
    assert.equal(await primary.evaluate((node: HTMLElement) => node.closest(".pith-pdf-page") === null), true);
    assert.ok(await primary.evaluate(fontSize) > bilingualSize, "primary translation must stand out");
    await capture("translation-primary");
    await page.locator('.pith-typography-popover [data-interline-mode="original"]').click();
    await subtitle.waitFor({ state: "detached" });
    assert.equal(await original.textContent(), "Long book");
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
