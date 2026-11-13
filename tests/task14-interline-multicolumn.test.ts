import { createTestTopic } from "./topic-fixture.ts";
import assert from "node:assert/strict";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { build } from "esbuild";
import { interlineToolkit } from "../src/plugins/toolkit-interline/index.ts";
import { renderEpub } from "../src/plugins/stage-reader/epub.ts";
import { InterlineSession, type InterlineUnitInput } from "../src/plugins/toolkit-interline/index.ts";
import { NodeWorkspaceStorage } from "../src/shells/web/nodeStorage.ts";
import { createPithWebServer } from "../src/shells/web/server.ts";
import { testSandbox } from "./sandbox.ts";
import { storedEpub } from "./wave12-epub-fixture.ts";

function book(): Uint8Array {
  const chapter = (name: string, count: number) => `<html><body><h1>${name}</h1>${Array.from({ length: count }, (_, i) => `<p>${name} paragraph ${i + 1}. Careful reading gives each idea enough room to develop.</p>`).join("")}</body></html>`;
  return storedEpub({
    "META-INF/container.xml": '<container><rootfiles><rootfile full-path="book.opf"/></rootfiles></container>',
    "book.opf": '<package><metadata><title>Three chapters</title></metadata><manifest><item id="one" href="one.xhtml"/><item id="two" href="two.xhtml"/><item id="three" href="three.xhtml"/></manifest><spine><itemref idref="one"/><itemref idref="two"/><itemref idref="three"/></spine></package>',
    "one.xhtml": chapter("First chapter", 5), "two.xhtml": chapter("Second chapter", 4), "three.xhtml": chapter("Third chapter", 24),
  });
}

for (const host of ["web", "obsidian"] as const) for (const startMode of ["triple", "single", "resize"] as const) test(`${host} renders every visible chapter when bilingual starts in ${startMode}`, { timeout: 60000, skip: !process.env.PITH_PLAYWRIGHT_MODULE || !process.env.PITH_CHROME_PATH }, async () => {
  const { chromium } = await import(process.env.PITH_PLAYWRIGHT_MODULE!);
  const dir = await testSandbox(`pith-interline-spread-${host}-`), calls: number[] = [];
  let neighborPrepared!: () => void; const neighbor = new Promise<void>(resolve => { neighborPrepared = resolve; });
  const translator = async (input: Parameters<ConstructorParameters<typeof InterlineSession>[2]>[0]) => { calls.push(input.unitIndex); if (input.unitIndex === 1) neighborPrepared(); return new Map(input.segments.map(segment => [segment.locator, `译文第${input.unitIndex + 1}章`])); };
  let browser: Awaited<ReturnType<typeof chromium.launchPersistentContext>> | undefined;
  let server: Awaited<ReturnType<typeof createPithWebServer>> | undefined;
  try {
    await mkdir(join(dir, "workspace"));
    const bytes = book();
    browser = await chromium.launchPersistentContext(join(dir, "profile"), { executablePath: process.env.PITH_CHROME_PATH, headless: true, viewport: { width: 1500, height: 900 } });
    const page = await browser.newPage();
    if (host === "web") {
      server = await createPithWebServer({ workspaceDir: join(dir, "workspace"), guideProvider: { async run() { return { status: "completed" }; } }, interlineTranslator: translator });
      const address = server.address(); assert.ok(address && typeof address !== "string"); const base = `http://127.0.0.1:${address.port}`;
      const post = async (path: string, data: unknown) => { const response = await fetch(base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data) }); if (!response.ok) throw new Error(await response.text()); return response.json(); };
      const topic = await createTestTopic(join(dir, "workspace"), { title: "Three chapters" });
      await post("/api/materials", { topicId: topic.id, title: "Three chapters", kind: "book", files: [{ name: "book.epub", data: Buffer.from(bytes).toString("base64") }] });

      await post("/api/materials/aids", { materialId: (await (await fetch(base + "/api/state")).json()).materials[0].id, aids: [] });
      await page.goto(base); await page.locator(`[data-topic="${topic.id}"]`).first().click();
      if (startMode !== "single") { await page.locator('[data-command="typography"]').click(); await page.locator('.pith-typography-popover [data-mode="triple"]').click(); }
      if (startMode === "resize") { await page.setViewportSize({ width: 600, height: 900 }); await page.waitForFunction(() => (document.querySelector('.pith-typography-popover [data-mode="triple"]') as HTMLButtonElement).disabled); }
      if (await page.locator(".pith-typography-popover").isHidden()) await page.locator('[data-command="typography"]').click(); await page.locator('.pith-typography-popover [data-interline-mode="bilingual"]').click();
    } else {
      const bundle = await build({ entryPoints: ["src/shells/obsidian/plugin.ts"], bundle: true, write: false, platform: "browser", format: "iife", globalName: "PithView" });
      const rendered = await renderEpub(bytes), storage = new NodeWorkspaceStorage(join(dir, "workspace")); let session: InterlineSession | undefined;
      await page.exposeFunction("prepareSpread", async (units: InterlineUnitInput[], index: number, mode: "bilingual") => { session ??= new InterlineSession(interlineToolkit, storage, translator, "material", "book.epub", units); return session.render(index, mode); });
      await page.setContent('<style>html,body,#root{height:100%;margin:0}</style><div id="root"></div>'); await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
      await page.evaluate((documentData: unknown) => { const toolkit = { id: "interline", label: "行间双语", category: "language", stages: [], quickActions: [] }; let view: any; view = new (window as any).PithView.PithObsidianView(document.getElementById("root"), { setMaterialAids: async () => {}, openFile() {}, selection() {}, openToolkit() { view.openToolkit([toolkit]); }, prepareInterline: (...args: unknown[]) => (window as any).prepareSpread(...args) });  view.render({ ...(documentData as object), source: { kind: "material", materialId: "material" }, materialAids: [], currentFile: "book.epub", files: [], title: "Three chapters" }); }, rendered);
      if (startMode !== "single") { await page.locator('[data-command="typography"]').click(); await page.locator('.pith-typography-popover [data-mode="triple"]').click(); }
      if (startMode === "resize") { await page.setViewportSize({ width: 600, height: 900 }); await page.waitForFunction(() => (document.querySelector('.pith-typography-popover [data-mode="triple"]') as HTMLButtonElement).disabled); }
      if (await page.locator(".pith-typography-popover").isHidden()) await page.locator('[data-command="typography"]').click(); await page.locator('.pith-typography-popover [data-interline-mode="bilingual"]').click();
    }
    const article = ".pith-article", reader = ".pith-reader";
    const first = page.locator(`${article} > .pith-epub-chapter`).nth(0), second = page.locator(`${article} > .pith-epub-chapter`).nth(1);
    await first.locator(".pith-interline-subtitle").first().waitFor();
    await neighbor;
    if (startMode !== "triple") {
      const initiallyVisible = await second.evaluate((chapter: HTMLElement, selector: string) => { const viewport = document.querySelector(selector)!.getBoundingClientRect(); return Array.from(chapter.getClientRects()).some(rect => rect.left < viewport.right && rect.right > viewport.left && rect.top < viewport.bottom && rect.bottom > viewport.top); }, reader);
      assert.equal(initiallyVisible, false, "second chapter starts outside the single-column viewport");
      if (startMode === "single") { if (await page.locator(".pith-typography-popover").isHidden()) await page.locator('[data-command="typography"]').click(); await page.locator('.pith-typography-popover [data-mode="triple"]').click(); }
      else { await page.setViewportSize({ width: 1500, height: 900 }); await page.waitForFunction(() => !(document.querySelector('.pith-typography-popover [data-mode="triple"]') as HTMLButtonElement).disabled); }
    }
    const visible = await second.evaluate((chapter: HTMLElement, selector: string) => { const viewport = document.querySelector(selector)!.getBoundingClientRect(); return Array.from(chapter.getClientRects()).some(rect => rect.left < viewport.right && rect.right > viewport.left && rect.top < viewport.bottom && rect.bottom > viewport.top); }, reader);
    assert.equal(visible, true, "second chapter must actually intersect the current spread");
    await second.locator(".pith-interline-subtitle").first().waitFor({ timeout: 5000 });
    assert.match((await second.locator(".pith-interline-subtitle").first().textContent())!, /译文第2章/);
    assert.deepEqual(calls.slice(0, 2), [0, 1]);
    await page.locator('[data-page="next"]').click(); await page.waitForFunction((selector: string) => (document.querySelector(selector) as HTMLElement).scrollLeft > 0, reader);
    const thirdVisible = await page.locator(`${article} > .pith-epub-chapter`).nth(2).evaluate((chapter: HTMLElement, selector: string) => { const viewport = document.querySelector(selector)!.getBoundingClientRect(); return Array.from(chapter.getClientRects()).some(rect => rect.left < viewport.right && rect.right > viewport.left && rect.top < viewport.bottom && rect.bottom > viewport.top); }, reader);
    assert.equal(thirdVisible, true, "third chapter must be visible after turning the page");
    await page.locator(`${article} > .pith-epub-chapter`).nth(2).locator('.pith-interline-subtitle').first().waitFor({ timeout: 5000 });
    await page.locator('[data-page="previous"]').click(); await page.waitForFunction((selector: string) => (document.querySelector(selector) as HTMLElement).scrollLeft === 0, reader);
    assert.match((await second.locator(".pith-interline-subtitle").first().textContent())!, /译文第2章/);
    assert.equal(calls.filter(index => index === 1).length, 1);
  } finally { if (browser) await browser.close(); if (server) await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve())); await rm(dir, { recursive: true, force: true }); }
});
