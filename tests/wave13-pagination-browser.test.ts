import { createTestTopic } from "./topic-fixture.ts";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { testSandbox } from "./sandbox.ts";
import { renderEpub } from "../src/plugins/stage-reader/epub.ts";
import { renderCbz } from "../src/plugins/stage-reader/fixedPage.ts";
import { createPithWebServer } from "../src/shells/web/server.ts";
import { linkedEpub } from "./wave12-epub-fixture.ts";

test("wide pagination centers each screen without visible scrollbars in both shells", { timeout: 60000, skip: !process.env.PITH_PLAYWRIGHT_MODULE || !process.env.PITH_CHROME_PATH }, async () => {
  const { chromium } = await import(process.env.PITH_PLAYWRIGHT_MODULE!);
  const dir = await testSandbox("pith-wide-page-");
  let browser: any, server: Awaited<ReturnType<typeof createPithWebServer>> | undefined;
  try {
    await mkdir(join(dir, "workspace")); server = await createPithWebServer({ workspaceDir: join(dir, "workspace") });
    const address = server.address(); assert.ok(address && typeof address !== "string"); const base = `http://127.0.0.1:${address.port}`;
    const post = async (path: string, body: unknown) => { const r = await fetch(base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); assert.ok(r.ok); return r.json(); };
    const topic = await createTestTopic(join(dir, "workspace"), { title: "Wide" }); await post("/api/materials", { topicId: topic.id, title: "Wide", kind: "book", files: [{ name: "wide.epub", data: Buffer.from(linkedEpub()).toString("base64") }] });
    const bundle = await build({ entryPoints: ["src/shells/obsidian/plugin.ts"], bundle: true, write: false, platform: "browser", format: "iife", globalName: "PithView" });
    browser = await chromium.launchPersistentContext(join(dir, "profile"), { executablePath: process.env.PITH_CHROME_PATH, headless: true, viewport: { width: 2200, height: 900 } });
    const page = await browser.newPage();
    for (const shell of ["web", "obsidian"] as const) {
      if (shell === "web") { await page.goto(base); await page.locator(`[data-topic="${topic.id}"]`).first().click(); }
      else { await page.goto("about:blank"); await page.setContent('<style>html,body,#root{height:100%;margin:0}</style><div id="root"></div>'); await page.addScriptTag({ content: bundle.outputFiles[0]!.text }); await page.evaluate(() => { const view = new (window as any).PithView.PithObsidianView(document.getElementById("root"), { openFile() {}, selection() {}, openToolkit() {} }); view.render({ html: '<p data-locator="start">Start</p>', format: "epub", currentFile: "book.epub", files: [], sections: [], title: "Wide" }); }); }
      const reader = page.locator(shell === "web" ? ".pith-reader" : ".pith-reader"), article = page.locator(shell === "web" ? ".pith-article" : ".pith-article");
      await article.evaluate((node: HTMLElement) => { node.innerHTML = Array.from({ length: 600 }, (_, i) => `<p data-locator="p:${i}">${`Line ${i} reading words and text. `.repeat(12)}</p>`).join(""); });
      const menu = page.locator(shell === "web" ? `[data-command="typography"]` : '[data-command="typography"]');
      await menu.click();
      for (const [mode, columns, max] of [["single", 1, 820], ["double", 2, 680], ["triple", 3, 580]] as const) {
        await page.locator(`[data-mode="${mode}"]`).click();
        const metrics = await reader.evaluate((node: HTMLElement) => { const body = node.firstElementChild as HTMLElement, style = getComputedStyle(body), pseudo = getComputedStyle(node, "::after"), viewport = getComputedStyle(node); return { width: node.clientWidth, scroll: node.scrollWidth, column: parseFloat(style.columnWidth), gap: parseFloat(style.columnGap), inset: parseFloat(style.paddingLeft), overflow: viewport.overflowX, scrollbar: viewport.scrollbarWidth, position: pseudo.position, pseudoWidth: pseudo.width }; });
        assert.equal(metrics.overflow, "hidden"); assert.equal(metrics.scrollbar, "none"); assert.equal(metrics.position, "absolute"); assert.equal(metrics.pseudoWidth, "1px"); assert.ok(metrics.scroll > metrics.width * 3); assert.ok(metrics.column <= max + .1); assert.ok(Math.abs(columns * (metrics.column + metrics.gap) - metrics.width) < .2); assert.ok(Math.abs(metrics.gap - 2 * metrics.inset) < .1);
        for (const index of [0, 1, 2]) {
          await reader.evaluate((node: HTMLElement, n: number) => { node.scrollLeft = n * node.clientWidth; }, index);
          const value = await reader.evaluate((node: HTMLElement) => { const bounds = node.getBoundingClientRect(), range = document.createRange(), walker = document.createTreeWalker(node.firstElementChild!, NodeFilter.SHOW_TEXT); let current: Node | null, first = Infinity; while ((current = walker.nextNode())) { range.selectNodeContents(current); for (const rect of range.getClientRects()) if (rect.width > 0 && rect.left >= bounds.left - .5 && rect.left < bounds.right - .5 && rect.top >= bounds.top - .5 && rect.bottom <= bounds.bottom + .5) first = Math.min(first, rect.left - bounds.left); } return { left: node.scrollLeft, width: node.clientWidth, first }; }); assert.ok(Math.abs(value.left - index * value.width) <= 1); assert.ok(Math.abs(value.first - metrics.inset) < 2, JSON.stringify({ shell, mode, index, value, metrics }));
        }
      }
    }
  } finally { if (browser) await browser.close(); if (server) await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve())); await rm(dir, { recursive: true, force: true }); }
});

test("Web page buttons advance with fractional zoom and an audio deck", { timeout: 30000, skip: !process.env.PITH_PLAYWRIGHT_MODULE || !process.env.PITH_CHROME_PATH }, async () => {
  const { chromium } = await import(process.env.PITH_PLAYWRIGHT_MODULE!);
  const dir = await testSandbox("pith-web-page-turn-");
  let browser: Awaited<ReturnType<typeof chromium.launchPersistentContext>> | undefined;
  let server: Awaited<ReturnType<typeof createPithWebServer>> | undefined;
  try {
    await mkdir(join(dir, "workspace"));
    server = await createPithWebServer({ workspaceDir: join(dir, "workspace") });
    const address = server.address(); assert.ok(address && typeof address !== "string");
    const base = `http://127.0.0.1:${address.port}`;
    const post = async (path: string, body: unknown) => { const response = await fetch(base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); assert.ok(response.ok); return response.json(); };
    const topic = await createTestTopic(join(dir, "workspace"), { title: "Pagination" });
    const wav = Buffer.from("UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=", "base64");
    await post("/api/materials", { topicId: topic.id, title: "Pagination", kind: "book", files: [{ name: "pages.epub", data: Buffer.from(linkedEpub()).toString("base64") }, { name: "sound.wav", mimeType: "audio/wav", data: wav.toString("base64") }] });
    browser = await chromium.launchPersistentContext(join(dir, "profile"), { executablePath: process.env.PITH_CHROME_PATH, headless: true, viewport: { width: 1801, height: 900 } });
    const page = await browser.newPage();
    await page.goto(base); await page.locator(`[data-topic="${topic.id}"]`).first().click();
    await page.locator(".pith-media-deck").waitFor({ state: "visible" });
    await page.evaluate(() => {
      document.body.style.zoom = "0.8";
      const article = document.querySelector(".pith-article")!;
      for (let i = 0; i < 450; i++) { const p = document.createElement("p"); p.dataset.locator = `p:${i}`; p.textContent = `第${i}段：` + "阅读内容与分页位置。".repeat(25); article.append(p); }
    });
    await page.locator(`[data-command="typography"]`).click(); await page.locator('[data-size="17"]').click();
    const reader = page.locator(".pith-reader"), counter = page.locator("[data-page-count]");
    await reader.evaluate((node: HTMLElement) => new Promise<void>(resolve => { node.addEventListener("scroll", () => resolve(), { once: true }); node.scrollLeft = node.clientWidth * 14; }));
    const initial = await reader.evaluate((node: HTMLElement) => ({ left: node.scrollLeft, width: node.clientWidth }));
    assert.equal(Number((await counter.textContent())!.split("/")[0]), 15, JSON.stringify(initial));
    for (const [button, expected] of [["previous", 14], ["next", 15], ["next", 16], ["next", 17]] as const) {
      const before = await reader.evaluate((node: HTMLElement) => node.scrollLeft);
      await Promise.all([reader.evaluate((node: HTMLElement) => new Promise<void>(resolve => node.addEventListener("scroll", () => resolve(), { once: true }))), page.locator(`[data-page="${button}"]`).click()]);
      const after = await reader.evaluate((node: HTMLElement) => node.scrollLeft);
      assert.equal(Number((await counter.textContent())!.split("/")[0]), expected);
      assert.ok(button === "next" ? after > before : after < before);
    }
  } finally { if (browser) await browser.close(); if (server) await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve())); await rm(dir, { recursive: true, force: true }); }
});

test("Obsidian page buttons advance one screen with fractional zoom and an audio deck", { timeout: 30000, skip: !process.env.PITH_PLAYWRIGHT_MODULE || !process.env.PITH_CHROME_PATH }, async () => {
  const { chromium } = await import(process.env.PITH_PLAYWRIGHT_MODULE!);
  const dir = await testSandbox("pith-page-turn-");
  let browser: Awaited<ReturnType<typeof chromium.launchPersistentContext>> | undefined;
  try {
    const bundle = await build({ entryPoints: ["src/shells/obsidian/plugin.ts"], bundle: true, write: false, platform: "browser", format: "iife", globalName: "PithView" });
    browser = await chromium.launchPersistentContext(join(dir, "profile"), { executablePath: process.env.PITH_CHROME_PATH, headless: true, viewport: { width: 1801, height: 900 } });
    const page = await browser.newPage();
    await page.setContent('<style>html,body,#root{height:100%;margin:0}body{zoom:0.8}</style><div id="root"></div>');
    await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
    await page.evaluate(() => {
      const html = Array.from({ length: 450 }, (_, i) => `<p data-locator="p:${i}">第${i}段：${"阅读内容与分页位置。".repeat(25)}</p>`).join("");
      const view = new (window as any).PithView.PithObsidianView(document.getElementById("root"), { openFile() {}, selection() {}, openToolkit() {}, loadAudio: async () => new Uint8Array([82, 73, 70, 70]) });
      view.render({ html, format: "epub", currentFile: "book.epub", files: [{ name: "sound.wav", mimeType: "audio/wav" }], sections: [], title: "Book" });
    });
    const reader = page.locator(".pith-reader"), counter = page.locator("[data-page-count]");
    await page.locator(".pith-media-deck").waitFor({ state: "visible" });
    await reader.evaluate((node: HTMLElement) => new Promise<void>(resolve => { node.addEventListener("scroll", () => resolve(), { once: true }); node.scrollLeft = node.clientWidth * 14; }));
    const initial = await reader.evaluate((node: HTMLElement) => ({ left: node.scrollLeft, width: node.clientWidth }));
    assert.equal(Number((await counter.textContent())!.split("/")[0]), 15, JSON.stringify(initial));
    for (const [button, expected] of [["previous", 14], ["next", 15], ["next", 16], ["next", 17]] as const) {
      const before = await reader.evaluate((node: HTMLElement) => ({ left: node.scrollLeft, width: node.clientWidth }));
      await Promise.all([reader.evaluate((node: HTMLElement) => new Promise<void>(resolve => node.addEventListener("scroll", () => resolve(), { once: true }))), page.locator(`[data-page="${button}"]`).click()]);
      const after = await reader.evaluate((node: HTMLElement) => ({ left: node.scrollLeft, width: node.clientWidth }));
      assert.equal(Number((await counter.textContent())!.split("/")[0]), expected, `${button}: ${JSON.stringify({ before, after })}`);
      assert.ok(button === "next" ? after.left > before.left : after.left < before.left, `${button}: ${JSON.stringify({ before, after })}`);
    }
  } finally { if (browser) await browser.close(); await rm(dir, { recursive: true, force: true }); }
});

test("reflow keeps a visible character in a long unspaced Chinese paragraph", { timeout: 30000, skip: !process.env.PITH_PLAYWRIGHT_MODULE || !process.env.PITH_CHROME_PATH }, async () => {
  const { chromium } = await import(process.env.PITH_PLAYWRIGHT_MODULE!);
  const dir = await testSandbox("pith-chinese-position-");
  let browser: Awaited<ReturnType<typeof chromium.launchPersistentContext>> | undefined;
  try {
    const bundle = await build({ entryPoints: ["src/plugins/stage-reader/pagination.ts"], bundle: true, write: false, platform: "browser", format: "iife", globalName: "Pagination" });
    browser = await chromium.launchPersistentContext(join(dir, "profile"), { executablePath: process.env.PITH_CHROME_PATH, headless: true, viewport: { width: 1000, height: 500 } });
    const page = await browser.newPage();
    await page.setContent('<style>#reader{width:800px;height:300px;overflow:auto}#article{font:20px/1.5 sans-serif}p{margin:0}</style><div id="reader"><div id="article"><p data-locator="chapter">' + "深度阅读需要保持当前可见位置".repeat(600) + '</p></div></div>');
    await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
    const result = await page.evaluate(() => {
      const reader = document.querySelector<HTMLElement>("#reader")!, article = document.querySelector<HTMLElement>("#article")!;
      const api = (window as any).Pagination;
      api.applyPaginationStyles(reader, article, "single");
      reader.scrollLeft = reader.clientWidth * 3;
      const node = article.querySelector("p")!.firstChild as Text;
      const box = reader.getBoundingClientRect(), range = document.createRange();
      let visibleOffset = -1;
      for (let i = 0; i < node.length; i++) {
        range.setStart(node, i); range.setEnd(node, i + 1);
        const r = range.getBoundingClientRect();
        if (r.right > box.left && r.left < box.right && r.bottom > box.top && r.top < box.bottom) { visibleOffset = i; break; }
      }
      const captured = api.captureReaderPosition(reader, article);
      api.applyPaginationStyles(reader, article, "double");
      api.restoreReaderPosition(reader, article, captured);
      range.setStart(node, visibleOffset); range.setEnd(node, visibleOffset + 1);
      const r = range.getBoundingClientRect(), after = reader.getBoundingClientRect();
      return { visibleOffset, capturedOffset: captured?.offset, visibleAfter: r.right > after.left && r.left < after.right && r.bottom > after.top && r.top < after.bottom };
    });
    assert.ok(result.visibleOffset > 0, "fixture must start on a later page");
    assert.equal(result.capturedOffset, result.visibleOffset);
    assert.equal(result.visibleAfter, true);
  } finally { if (browser) await browser.close(); await rm(dir, { recursive: true, force: true }); }
});

test("continuous resizes keep the original visible Chinese character in both shells", { timeout: 30000, skip: !process.env.PITH_PLAYWRIGHT_MODULE || !process.env.PITH_CHROME_PATH }, async () => {
  const { chromium } = await import(process.env.PITH_PLAYWRIGHT_MODULE!);
  const dir = await testSandbox("pith-chinese-resize-");
  let browser: Awaited<ReturnType<typeof chromium.launchPersistentContext>> | undefined;
  let server: Awaited<ReturnType<typeof createPithWebServer>> | undefined;
  try {
    const bundle = await build({ entryPoints: ["src/shells/obsidian/plugin.ts"], bundle: true, write: false, platform: "browser", format: "iife", globalName: "PithView" });
    await mkdir(join(dir, "workspace"));
    server = await createPithWebServer({ workspaceDir: join(dir, "workspace") });
    const address = server.address(); assert.ok(address && typeof address !== "string"); const base = `http://127.0.0.1:${address.port}`;
    const post = async (path: string, body: unknown) => { const response = await fetch(base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); assert.ok(response.ok); return response.json(); };
    const material = await post("/api/materials", { title: "Chinese resize", kind: "book", files: [{ name: "pages.epub", data: Buffer.from(linkedEpub()).toString("base64") }] });
    const topic = await createTestTopic(join(dir, "workspace"), { title: "Chinese resize", materialIds: [material.id] });
    browser = await chromium.launchPersistentContext(join(dir, "profile"), { executablePath: process.env.PITH_CHROME_PATH, headless: true, viewport: { width: 1600, height: 900 } });
    const page = await browser.newPage();
    for (const shell of ["web", "obsidian"] as const) {
      await page.setViewportSize({ width: 1600, height: 900 });
      if (shell === "web") { await page.goto(base); await page.locator(`[data-topic="${topic.id}"]`).first().click(); }
      else {
        await page.goto("about:blank"); await page.setContent('<style>html,body,#root{height:100%;margin:0}</style><div id="root"></div>');
        await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
        await page.evaluate(() => { const view = new (window as any).PithView.PithObsidianView(document.getElementById("root"), { openFile() {}, selection() {}, openToolkit() {} }); view.render({ html: '<p data-locator="chapter">' + "深度阅读需要保持当前可见位置".repeat(1500) + '</p>', format: "epub", currentFile: "book.epub", files: [], sections: [], title: "Book" }); });
      }
      const reader = page.locator(shell === "web" ? ".pith-reader" : ".pith-reader");
      if (shell === "web") {
        await page.locator('.pith-epub-chapter-0').waitFor();
        await page.locator(".pith-article").evaluate((article: HTMLElement) => { article.innerHTML = '<p data-locator="chapter">' + "深度阅读需要保持当前可见位置".repeat(1500) + '</p>'; });
        await page.locator(`[data-command="typography"]`).click(); await page.locator('[data-size="17"]').click();
      }
      await reader.evaluate((node: HTMLElement) => new Promise<void>(resolve => { node.addEventListener("scroll", () => resolve(), { once: true }); node.scrollLeft = node.clientWidth * 4; }));
      await reader.evaluate((node: HTMLElement) => { const text = node.querySelector('[data-locator="chapter"]')!.firstChild as Text, range = document.createRange(), box = node.getBoundingClientRect(); for (let i = 0; i < text.length; i++) { range.setStart(text, i); range.setEnd(text, i + 1); const rect = range.getBoundingClientRect(); if (rect.right > box.left && rect.left < box.right && rect.bottom > box.top && rect.top < box.bottom) { (window as any).resizeAnchor = { text, offset: i }; return; } } throw new Error("No visible character"); });
      for (const [width, height] of [[1450, 840], [1300, 780], [1200, 740], [1100, 700]] as const) {
        await page.setViewportSize({ width, height });
        await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
        const result = await reader.evaluate((node: HTMLElement) => { const { text, offset } = (window as any).resizeAnchor, range = document.createRange(); range.setStart(text, offset); range.setEnd(text, offset + 1); const box = node.getBoundingClientRect(), rects = Array.from(range.getClientRects()).map(rect => ({ left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height })); return { offset, left: node.scrollLeft, width: node.clientWidth, box: { left: box.left, right: box.right, top: box.top, bottom: box.bottom }, rects, visible: rects.some(rect => rect.width > 0 && rect.height > 0 && rect.right > box.left && rect.left < box.right && rect.bottom > box.top && rect.top < box.bottom) }; });
        assert.equal(result.visible, true, `${shell}: ${width}x${height} ${JSON.stringify(result)}`);
      }
      await Promise.all([reader.evaluate((node: HTMLElement) => new Promise<void>(resolve => node.addEventListener("scroll", () => resolve(), { once: true }))), page.locator('[data-page="next"]').click()]);
      await reader.evaluate((node: HTMLElement) => { const text = node.querySelector('[data-locator="chapter"]')!.firstChild as Text, range = document.createRange(), box = node.getBoundingClientRect(); for (let i = 0; i < text.length; i++) { range.setStart(text, i); range.setEnd(text, i + 1); const rect = range.getBoundingClientRect(); if (rect.right > box.left && rect.left < box.right && rect.bottom > box.top && rect.top < box.bottom) { (window as any).resizeAnchor = { text, offset: i }; return; } } throw new Error("No visible character after page turn"); });
      await page.setViewportSize({ width: 1500, height: 850 });
      await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      const visibleAfterTurn = await reader.evaluate((node: HTMLElement) => { const { text, offset } = (window as any).resizeAnchor, range = document.createRange(); range.setStart(text, offset); range.setEnd(text, offset + 1); const box = node.getBoundingClientRect(); return Array.from(range.getClientRects()).some(rect => rect.width > 0 && rect.height > 0 && rect.right > box.left && rect.left < box.right && rect.bottom > box.top && rect.top < box.bottom); });
      assert.equal(visibleAfterTurn, true, `${shell}: resize after next page`);
    }
  } finally { if (browser) await browser.close(); if (server) await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve())); await rm(dir, { recursive: true, force: true }); }
});

test("Web and Obsidian paginate one, two and three columns at reader width", { timeout: 30000, skip: !process.env.PITH_PLAYWRIGHT_MODULE || !process.env.PITH_CHROME_PATH }, async () => {
  const { chromium } = await import(process.env.PITH_PLAYWRIGHT_MODULE!);
  const dir = await testSandbox("pith-wave13-columns-");
  let browser: Awaited<ReturnType<typeof chromium.launchPersistentContext>> | undefined;
  let server: Awaited<ReturnType<typeof createPithWebServer>> | undefined;
  try {
    const bytes = linkedEpub(), rendered = await renderEpub(bytes);
    const bundle = await build({ entryPoints: ["src/shells/obsidian/plugin.ts"], bundle: true, write: false, platform: "browser", format: "iife", globalName: "PithView" });
    await mkdir(join(dir, "workspace"));
    server = await createPithWebServer({ workspaceDir: join(dir, "workspace") });
    const address = server.address(); assert.ok(address && typeof address !== "string"); const base = `http://127.0.0.1:${address.port}`;
    const post = async (path: string, body: unknown) => { const result = await fetch(base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); assert.ok(result.ok); return result.json(); };
    const wav = Buffer.from("UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=", "base64");
    const material = await post("/api/materials", { title: "Pagination", kind: "book", files: [{ name: "pages.epub", data: Buffer.from(bytes).toString("base64") }, { name: "sound.wav", mimeType: "audio/wav", data: wav.toString("base64") }] });
    const topic = await createTestTopic(join(dir, "workspace"), { title: "Pagination", materialIds: [material.id] });
    browser = await chromium.launchPersistentContext(join(dir, "profile"), { executablePath: process.env.PITH_CHROME_PATH, headless: true, viewport: { width: 1500, height: 700 }, args: ["--no-first-run", "--no-default-browser-check"] });
    const page = await browser.newPage();
    page.setDefaultTimeout(5000);
    for (const shell of ["web", "obsidian"] as const) {
      if (shell === "web") { await page.goto(base); await page.locator(`[data-topic="${topic.id}"]`).first().click(); }
      else {
        await page.goto("about:blank"); await page.setContent('<style>html,body,#root{height:100%;margin:0}</style><div id="root"></div>');
        await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
        await page.evaluate((doc: unknown) => { const ctor = (window as any).PithView.PithObsidianView; const view = new ctor(document.getElementById("root"), { openFile() {}, selection() {}, openToolkit() {}, loadAudio: async () => new Uint8Array([82, 73, 70, 70]) }); view.render({ ...(doc as object), currentFile: "pages.epub", files: [{ name: "sound.wav", mimeType: "audio/wav" }], title: "Pagination" }); }, rendered);
      }
      const reader = page.locator(shell === "web" ? ".pith-reader" : ".pith-reader");
      const article = page.locator(shell === "web" ? ".pith-reader > .pith-article" : ".pith-article");
      await page.locator('.pith-epub-chapter-0').waitFor();
      const toggle = page.locator(shell === "web" ? `[data-command="typography"]` : '[data-command="typography"]');
      const widthFor = async (columns: number) => article.evaluate((node: HTMLElement, columns: number) => { const viewport = node.parentElement!; return Math.abs(parseFloat(node.style.columnWidth) * columns + parseFloat(node.style.columnGap) * columns - viewport.clientWidth) < 2; }, columns);
      assert.equal(await widthFor(1), true);
      await page.locator(".pith-epub-chapter-0 a").filter({ hasText: "Same" }).first().click();
      const target = page.locator(".pith-epub-chapter-0 #shared");
      const visible = () => target.evaluate((node: HTMLElement) => { const a = node.getBoundingClientRect(), b = node.closest('.reader,.pith-reader')!.getBoundingClientRect(); return a.right > b.left && a.left < b.right && a.bottom > b.top && a.top < b.bottom; });
      assert.equal(await visible(), true);
      await toggle.click();
      const remember = () => article.evaluate((root: HTMLElement) => { const doc = root.ownerDocument, box = root.parentElement!.getBoundingClientRect(), walker = doc.createTreeWalker(root, 4), range = doc.createRange(); let node: Node | null; while ((node = walker.nextNode())) { const text = node as Text, block = text.parentElement?.closest("[data-locator]"); if (!block) continue; let offset = 0; for (const character of text.data) { range.setStart(text, offset); range.setEnd(text, offset + character.length); const r = range.getBoundingClientRect(); if (/\S/u.test(character) && r.right > box.left && r.left < box.right && r.bottom > box.top && r.top < box.bottom) { (window as any).pithPosition = { text, offset, locator: block.getAttribute("data-locator") }; return; } offset += character.length; } } throw new Error("No visible locator"); });
      const rememberedVisible = () => article.evaluate((root: HTMLElement) => { const position = (window as any).pithPosition, range = root.ownerDocument.createRange(); range.setStart(position.text, position.offset); range.setEnd(position.text, position.offset + 1); const a = range.getBoundingClientRect(), b = root.parentElement!.getBoundingClientRect(); return position.text.parentElement.closest("[data-locator]").getAttribute("data-locator") === position.locator && a.right > b.left && a.left < b.right && a.bottom > b.top && a.top < b.bottom; });
      for (const [mode, columns] of [["double", 2], ["triple", 3], ["single", 1]] as const) {
        await remember(); await page.locator(`[data-mode="${mode}"]`).click(); assert.equal(await widthFor(columns), true); assert.equal(await rememberedVisible(), true, `${shell}: ${mode}`);
      }
      await remember(); await page.locator('[data-size="20"]').click(); assert.equal(await rememberedVisible(), true, `${shell}: font change`);
      if (shell === "web") {
        await remember(); await page.locator(".pith-guide-toggle").click();
        await page.waitForFunction(() => { const position = (window as any).pithPosition, r = document.createRange(); r.setStart(position.text, position.offset); r.setEnd(position.text, position.offset + 1); const a = r.getBoundingClientRect(), b = document.querySelector(".pith-reader")!.getBoundingClientRect(); return a.right > b.left && a.left < b.right && a.bottom > b.top && a.top < b.bottom; });
        assert.equal(await rememberedVisible(), true, `${shell}: guide toggle`);
      }
      await remember(); await page.setViewportSize({ width: 1300, height: 610 });
      await page.waitForFunction(() => { const position = (window as any).pithPosition, r = document.createRange(); r.setStart(position.text, position.offset); r.setEnd(position.text, position.offset + 1); const a = r.getBoundingClientRect(), b = document.querySelector(".reader,.pith-reader")!.getBoundingClientRect(); return a.right > b.left && a.left < b.right && a.bottom > b.top && a.top < b.bottom; });
      assert.equal(await rememberedVisible(), true, `${shell}: viewport resize`);
      await page.setViewportSize({ width: 1500, height: 700 });
      let releaseImage!: () => void, imageRequested!: () => void;
      const imageGate = new Promise<void>(resolve => { releaseImage = resolve; });
      const imageRequest = new Promise<void>(resolve => { imageRequested = resolve; });
      await page.route("**/delayed.svg", async (route: any) => { imageRequested(); await imageGate; await route.fulfill({ status: 200, contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1400"><rect width="800" height="1400" fill="teal"/></svg>' }); });
      await article.evaluate((root: HTMLElement, url: string) => { const image = document.createElement("img"); image.src = url; root.firstElementChild!.prepend(image); }, `${base}/delayed.svg`);
      await imageRequest;
      if (!(await page.locator('[data-size="17"]').isVisible())) await toggle.click();
      await page.locator('[data-size="17"]').click();
      await remember(); releaseImage();
      await article.locator("img").first().evaluate((image: HTMLImageElement) => image.decode());
      await page.waitForFunction(() => { const position = (window as any).pithPosition, r = document.createRange(); r.setStart(position.text, position.offset); r.setEnd(position.text, position.offset + 1); const a = r.getBoundingClientRect(), b = document.querySelector(".reader,.pith-reader")!.getBoundingClientRect(); return a.right > b.left && a.left < b.right && a.bottom > b.top && a.top < b.bottom; });
      assert.equal(await rememberedVisible(), true, `${shell}: delayed image`);
      await page.unroute("**/delayed.svg");
      const deck = page.locator(".pith-media-deck");
      await deck.waitFor({ state: "visible" });
      await remember(); await deck.locator('[data-media="close"]').click();
      await deck.waitFor({ state: "hidden" });
      await page.waitForFunction(() => { const reader = document.querySelector<HTMLElement>(".reader,.pith-reader")!, body = reader.firstElementChild as HTMLElement; return parseFloat(body.style.height) === reader.clientHeight; });
      await page.waitForFunction(() => { const position = (window as any).pithPosition, r = document.createRange(); r.setStart(position.text, position.offset); r.setEnd(position.text, position.offset + 1); const a = r.getBoundingClientRect(), b = document.querySelector(".reader,.pith-reader")!.getBoundingClientRect(); return a.right > b.left && a.left < b.right && a.bottom > b.top && a.top < b.bottom; });
      assert.equal(await rememberedVisible(), true, `${shell}: audio deck closed`);
      await remember(); await page.locator(shell === "web" ? `[data-command="read"]` : '[data-command="read"]').click();
      await deck.waitFor({ state: "visible" });
      await page.waitForFunction(() => { const reader = document.querySelector<HTMLElement>(".reader,.pith-reader")!, body = reader.firstElementChild as HTMLElement; return parseFloat(body.style.height) === reader.clientHeight; });
      await page.waitForFunction(() => { const position = (window as any).pithPosition, r = document.createRange(); r.setStart(position.text, position.offset); r.setEnd(position.text, position.offset + 1); const a = r.getBoundingClientRect(), b = document.querySelector(".reader,.pith-reader")!.getBoundingClientRect(); return a.right > b.left && a.left < b.right && a.bottom > b.top && a.top < b.bottom; });
      assert.equal(await rememberedVisible(), true, `${shell}: audio deck reopened`);
      assert.ok((await reader.evaluate((node: HTMLElement) => node.scrollWidth - node.clientWidth)) > 0);
      const lastPage = await reader.evaluate((node: HTMLElement) => {
        const width = node.clientWidth;
        const total = Math.ceil(node.scrollWidth / width) + 1;
        node.style.setProperty("--pith-page-scroll-extent", `${total * width - 80}px`);
        node.scrollLeft = node.scrollWidth;
        node.dispatchEvent(new Event("scroll"));
        return { width, total: Math.ceil(node.scrollWidth / width), max: node.scrollWidth - width };
      });
      assert.notEqual(lastPage.max % lastPage.width, 0, `${shell}: final page is truncated`);
      assert.equal(await page.locator("[data-page-count]").textContent(), `${lastPage.total} / ${lastPage.total}`);
      await page.locator('[data-page="previous"]').click();
      await page.waitForFunction(({ selector, left }: { selector: string; left: number }) => Math.abs(document.querySelector<HTMLElement>(selector)!.scrollLeft - left) < 1, { selector: shell === "web" ? ".pith-reader" : ".pith-reader", left: (lastPage.total - 2) * lastPage.width });
      await page.waitForFunction((count: string) => document.querySelector("[data-page-count]")!.textContent === count, `${lastPage.total - 1} / ${lastPage.total}`);
      assert.equal(await page.locator("[data-page-count]").textContent(), `${lastPage.total - 1} / ${lastPage.total}`);
    }
  } finally {
    if (browser) await browser.close();
    if (server) await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve()));
    await rm(dir, { recursive: true, force: true });
  }
});

test("CBZ image page remains visible across repagination in both renderers", { timeout: 30000, skip: !process.env.PITH_PLAYWRIGHT_MODULE || !process.env.PITH_CHROME_PATH }, async () => {
  const { chromium } = await import(process.env.PITH_PLAYWRIGHT_MODULE!);
  const dir = await testSandbox("wave13-cbz-");
  let browser: Awaited<ReturnType<typeof chromium.launchPersistentContext>> | undefined;
  let server: Awaited<ReturnType<typeof createPithWebServer>> | undefined;
  try {
    const locals: Buffer[] = [], entries: Buffer[] = []; let offset = 0;
    for (let n = 1; n <= 8; n++) {
      const name = Buffer.from(`${n}.svg`), data = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="600" height="1000"><rect width="600" height="1000" fill="teal"/></svg>`), local = Buffer.alloc(30), entry = Buffer.alloc(46);
      local.writeUInt32LE(0x04034b50); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(name.length, 26);
      entry.writeUInt32LE(0x02014b50); entry.writeUInt32LE(data.length, 20); entry.writeUInt32LE(data.length, 24); entry.writeUInt16LE(name.length, 28); entry.writeUInt32LE(offset, 42);
      locals.push(local, name, data); entries.push(entry, name); offset += local.length + name.length + data.length;
    }
    const directory = Buffer.concat(entries), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(8, 8); end.writeUInt16LE(8, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
    const cbz = Buffer.concat([...locals, directory, end]);
    const rendered = await renderCbz({ name: "images.cbz", mimeType: "application/vnd.comicbook+zip" } as any, cbz);
    const bundle = await build({ entryPoints: ["src/shells/obsidian/plugin.ts"], bundle: true, write: false, platform: "browser", format: "iife", globalName: "PithView" });
    await mkdir(join(dir, "workspace")); server = await createPithWebServer({ workspaceDir: join(dir, "workspace") });
    const address = server.address(); assert.ok(address && typeof address !== "string"); const base = `http://127.0.0.1:${address.port}`;
    const post = async (path: string, body: unknown) => { const response = await fetch(base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); assert.ok(response.ok); return response.json(); };
    const topic = await createTestTopic(join(dir, "workspace"), { title: "Images" });
    await post("/api/materials", { topicId: topic.id, title: "Images", kind: "book", files: [{ name: "images.cbz", data: cbz.toString("base64") }] });
    browser = await chromium.launchPersistentContext(join(dir, "profile"), { executablePath: process.env.PITH_CHROME_PATH, headless: true, viewport: { width: 1500, height: 700 } });
    const page = await browser.newPage();
    for (const shell of ["web", "obsidian"] as const) {
      if (shell === "web") { await page.goto(base); await page.locator(`[data-topic="${topic.id}"]`).first().click(); }
      else { await page.goto("about:blank"); await page.setContent('<style>html,body,#root{height:100%;margin:0}</style><div id="root"></div>'); await page.addScriptTag({ content: bundle.outputFiles[0]!.text }); await page.evaluate((doc: unknown) => { const view = new (window as any).PithView.PithObsidianView(document.getElementById("root"), { openFile() {}, selection() {}, openToolkit() {} }); view.render({ ...(doc as object), currentFile: "images.cbz", files: [], title: "Images" }); }, rendered); }
      const image = page.locator('[data-locator="page:4"] img'); await image.evaluate((node: HTMLImageElement) => node.decode());
      await image.evaluate((node: HTMLElement) => { const reader = node.closest<HTMLElement>(".reader,.pith-reader")!; const x = reader.scrollLeft + node.getBoundingClientRect().left - reader.getBoundingClientRect().left; reader.scrollLeft = Math.floor(x / reader.clientWidth) * reader.clientWidth; });
      const visible = () => image.evaluate((node: HTMLElement) => { const a = node.getBoundingClientRect(), b = node.closest(".reader,.pith-reader")!.getBoundingClientRect(); return a.right > b.left && a.left < b.right && a.bottom > b.top && a.top < b.bottom; });
      assert.equal(await visible(), true, `${shell}: initial`);
      await page.locator(shell === "web" ? `[data-command="typography"]` : '[data-command="typography"]').click();
      for (const mode of ["double", "triple"]) {
        await image.evaluate((node: HTMLElement) => { const reader = node.closest<HTMLElement>(".reader,.pith-reader")!; const x = reader.scrollLeft + node.getBoundingClientRect().left - reader.getBoundingClientRect().left; reader.scrollLeft = Math.floor(x / reader.clientWidth) * reader.clientWidth; });
        await page.locator(`[data-mode="${mode}"]`).click(); assert.equal(await visible(), true, `${shell}: ${mode}`);
        await page.locator('[data-mode="single"]').click();
      }
    }
  } finally { if (browser) await browser.close(); if (server) await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve())); await rm(dir, { recursive: true, force: true }); }
});

test("Obsidian restores text position after annotation refresh merges its node", { timeout: 30000, skip: !process.env.PITH_PLAYWRIGHT_MODULE || !process.env.PITH_CHROME_PATH }, async () => {
  const { chromium } = await import(process.env.PITH_PLAYWRIGHT_MODULE!);
  const dir = await testSandbox("wave13-note-position-");
  let browser: Awaited<ReturnType<typeof chromium.launchPersistentContext>> | undefined;
  try {
    const bundle = await build({ entryPoints: ["src/shells/obsidian/plugin.ts"], bundle: true, write: false, platform: "browser", format: "iife", globalName: "PithView" });
    browser = await chromium.launchPersistentContext(join(dir, "profile"), { executablePath: process.env.PITH_CHROME_PATH, headless: true, viewport: { width: 1400, height: 700 } });
    const page = await browser.newPage();
    await page.setContent('<style>html,body,#root{height:100%;margin:0}</style><div id="root"></div>');
    await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
    await page.evaluate(async () => {
      const quote = "targetword ".repeat(1500);
      const note = { id: "note", anchor: { file: "book.epub", locator: "text:offset:7", quote } };
      let notes = [note];
      const view = new (window as any).PithView.PithObsidianView(document.getElementById("root"), { openFile() {}, selection() {}, openToolkit() {}, guideData: async () => ({ notes, toolkits: [], conversation: [], actions: [] }) });
      (window as any).view = view; (window as any).clearNotes = () => { notes = []; };
      view.render({ title: "Notes", currentFile: "book.epub", files: [], format: "epub", sections: [], html: `<p data-locator="block:1">before ${quote} after</p>` });
      await view.refreshGuide();
      const reader = document.querySelector<HTMLElement>(".pith-reader")!;
      reader.scrollLeft = reader.clientWidth * 3; reader.dispatchEvent(new Event("scroll"));
      const position = view.readerPosition;
      if (!position || !position.node.parentElement.closest("mark")) throw new Error("Expected captured marked text");
      (window as any).capturedPosition = position;
      const range = document.createRange(); range.selectNodeContents(document.querySelector('[data-locator="block:1"]')!); range.setEnd(position.node, position.offset);
      (window as any).characterOffset = range.toString().length;
      await (window as any).clearNotes(); await view.refreshGuide();
      if (document.querySelector(".pith-article")!.contains(position.node)) throw new Error("Annotation node was not merged");
      view.article.style.fontSize = "36px";
    });
    await page.setViewportSize({ width: 850, height: 700 });
    await page.evaluate(() => { const view = (window as any).view; view.applyPageMode((window as any).capturedPosition); });
    const visible = await page.evaluate(() => {
      const block = document.querySelector('[data-locator="block:1"]')!, text = block.firstChild as Text, offset = (window as any).characterOffset;
      const range = document.createRange(); range.setStart(text, offset); range.setEnd(text, offset + 1);
      const a = range.getBoundingClientRect(), b = document.querySelector(".pith-reader")!.getBoundingClientRect();
      return a.right > b.left && a.left < b.right && a.bottom > b.top && a.top < b.bottom;
    });
    assert.equal(visible, true);
  } finally { if (browser) await browser.close(); await rm(dir, { recursive: true, force: true }); }
});
