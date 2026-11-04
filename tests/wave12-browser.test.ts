import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { renderEpub } from "../src/plugins/stage-reader/epub.ts";
import { createPithWebServer } from "../src/shells/web/server.ts";
import { linkedEpub } from "./wave12-epub-fixture.ts";

test("Web keeps EPUB host-named IDs separate from host controls", { skip: !process.env.PITH_PLAYWRIGHT_MODULE || !process.env.PITH_CHROME_PATH }, async () => {
  const { chromium } = await import(process.env.PITH_PLAYWRIGHT_MODULE!);
  const dir = await mkdtemp(join(tmpdir(), "pith-wave12-host-ids-"));
  let browser: Awaited<ReturnType<typeof chromium.launchPersistentContext>> | undefined;
  let server: Awaited<ReturnType<typeof createPithWebServer>> | undefined;
  try {
    await mkdir(join(dir, "workspace"));
    server = await createPithWebServer({ workspaceDir: join(dir, "workspace") });
    const address = server.address(); assert.ok(address && typeof address !== "string");
    const base = `http://127.0.0.1:${address.port}`;
    const post = async (path: string, body: unknown) => { const response = await fetch(base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); assert.ok(response.ok); return response.json(); };
    const topic = await post("/api/topics", { title: "Host IDs" });
    await post("/api/materials", { topicId: topic.id, title: "Host IDs", kind: "book", files: [{ name: "ids.epub", data: Buffer.from(linkedEpub(true)).toString("base64") }] });
    browser = await chromium.launchPersistentContext(join(dir, "profile"), { executablePath: process.env.PITH_CHROME_PATH, headless: true, viewport: { width: 900, height: 700 }, args: ["--no-first-run", "--no-default-browser-check"] });
    const page = await browser.newPage();
    await page.goto(base); await page.locator(`[data-open="${topic.id}"]`).first().click();
    const chapter = page.locator(".pith-epub-chapter-0");
    for (const id of ["training", "article", "message", "preview", "toast", "settings", "toggle-navigation", "import-material", "detect-agents", "transcribe-audio", "toggle-side"]) {
      assert.equal(await chapter.locator(`p[id="${id}"]`).textContent(), `Book target ${id}`);
      assert.ok(await chapter.locator(`p[id="${id}"]`).evaluate((node: HTMLElement) => node.getBoundingClientRect().height) > 0, id);
    }
    assert.equal(await page.locator(".reader-wrap > #training #read-aloud").count(), 0);
    assert.equal(await page.locator("#reader-tools #read-aloud").count(), 1);
    const click = async (name: string, chapterIndex: number, id: string, text: string) => {
      await page.locator(".pith-epub-chapter a").filter({ hasText: name }).first().click();
      const target = page.locator(`.pith-epub-chapter-${chapterIndex} p[id="${id}"]`);
      assert.equal(await target.textContent(), text);
      assert.equal(await target.evaluate((node: HTMLElement) => { const a = node.getBoundingClientRect(), r = node.closest(".reader")!.getBoundingClientRect(); return a.left < r.right && a.right > r.left && a.top < r.bottom && a.bottom > r.top; }), true, name);
    };
    await click("Training target", 0, "training", "Book target training");
    await click("Settings link", 0, "article", "Book target article");
    await click("Import ancestor link", 0, "message", "Book target message");
    await click("Cross host target", 1, "training", "Second training target");
    await click("Host target back", 0, "training", "Book target training");
    assert.equal(await page.locator("#drawer").isHidden(), true);
    await page.locator("header button#home").click();
    await page.locator("header button#settings").click();
    assert.equal(await page.locator("#drawer #simple-mode").count(), 1);
    await page.locator("#drawer #close-drawer").click();
    await page.locator(`[data-open="${topic.id}"]`).first().click();
    assert.equal(await chapter.locator('p[id="training"]').textContent(), "Book target training");
  } finally {
    if (browser) await browser.close();
    if (server) await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve()));
    await rm(dir, { recursive: true, force: true });
  }
});

test("real browser navigates chapter-scoped EPUB links and injected tool entry in both shells", { skip: !process.env.PITH_PLAYWRIGHT_MODULE || !process.env.PITH_CHROME_PATH }, async () => {
  const { chromium } = await import(process.env.PITH_PLAYWRIGHT_MODULE!);
  const dir = await mkdtemp(join(tmpdir(), "pith-wave12-browser-"));
  let browser: Awaited<ReturnType<typeof chromium.launchPersistentContext>> | undefined;
  let server: Awaited<ReturnType<typeof createPithWebServer>> | undefined;
  try {
    const book = linkedEpub(), documentView = await renderEpub(book);
    const bundle = await build({ entryPoints: ["src/shells/obsidian/plugin.ts"], bundle: true, write: false, platform: "browser", format: "iife", globalName: "PithView" });
    const pagination = await build({ entryPoints: ["src/plugins/stage-reader/pagination.ts"], bundle: true, write: false, platform: "browser", format: "iife", globalName: "PithPagination" });
    await mkdir(join(dir, "workspace")); server = await createPithWebServer({ workspaceDir: join(dir, "workspace") });
    const address = server.address(); assert.ok(address && typeof address !== "string"); const base = `http://127.0.0.1:${address.port}`;
    const post = async (path: string, body: unknown) => { const response = await fetch(base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); assert.ok(response.ok, `${path}: ${response.status}`); return response.json(); };
    const topic = await post("/api/topics", { title: "链接书" });
    await post("/api/materials", { topicId: topic.id, title: "链接书", kind: "book", files: [{ name: "links.epub", data: Buffer.from(book).toString("base64") }] });
    browser = await chromium.launchPersistentContext(join(dir, "profile"), { executablePath: process.env.PITH_CHROME_PATH, headless: true, viewport: { width: 900, height: 700 }, args: ["--no-first-run", "--no-default-browser-check"] });
    const page = await browser.newPage(); let external = 0;
    await page.setContent('<article id="isolation"><section class="pith-epub-chapter" data-epub-chapter="0"><section class="pith-epub-chapter" data-epub-chapter="1" id="forged"></section></section></article>');
    await page.addScriptTag({ content: pagination.outputFiles[0]!.text });
    assert.equal(await page.evaluate(() => (window as unknown as { PithPagination: { resolveEpubTarget(root: HTMLElement, target: string): HTMLElement | null } }).PithPagination.resolveEpubTarget(document.getElementById("isolation")!, JSON.stringify({ chapter: 1, fragment: "forged" }))), null);
    await page.route("**/*", (route: { request(): { url(): string }; continue(): Promise<void>; abort(): Promise<void> }) => { const url = route.request().url(); if (url.startsWith(base) || url.startsWith("data:") || url.startsWith("about:")) return route.continue(); external++; return route.abort(); });
    const assertTarget = async (chapter: number, text: string, readerSelector: string) => {
      const target = page.locator(`.pith-epub-chapter-${chapter} #shared`); assert.equal(await target.textContent(), text);
      const visible = await target.evaluate((node: HTMLElement, readerSelector: string) => { const r = document.querySelector(readerSelector)!.getBoundingClientRect(), t = node.getBoundingClientRect(); return t.left < r.right && t.right > r.left && t.top < r.bottom && t.bottom > r.top; }, readerSelector);
      assert.equal(visible, true, `${text} is visible in the reading viewport`);
    };
    for (const shell of ["web", "obsidian"] as const) {
      if (shell === "web") {
        await page.goto(base); await page.locator(`[data-open="${topic.id}"]`).first().click();
        assert.equal(await page.locator("#open-dojo").isHidden(), true);
      } else {
        await page.setContent('<style>html,body,#root{height:100%;margin:0}</style><div id="root"></div>'); await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
        await page.evaluate((doc: unknown) => {
          const pith = (window as unknown as { PithView: { PithObsidianView: new (root: HTMLElement, actions: object) => { render(doc: object): void; setToolkits(ids: string[]): void; openDojo(dojos: object[]): void } } }).PithView;
          let view: InstanceType<typeof pith.PithObsidianView>;
          const dojos = ["feynman", "shadowing"].map(id => ({ id, label: id, stages: ["listen-decompose"], transformCue: (text: string) => text }));
          view = new pith.PithObsidianView(document.getElementById("root")!, { openFile() {}, selection() {}, openDojo() { view.openDojo(dojos); } });
          view.render({ ...(doc as object), currentFile: "links.epub", files: [], title: "链接书" });
          (window as unknown as { testView: typeof view }).testView = view;
        }, documentView);
        assert.equal(await page.locator("#open-dojo").isHidden(), true);
      }
      const reader = shell === "web" ? ".reader" : ".pith-reader";
      const link = (name: string) => page.locator(".pith-epub-chapter a").filter({ hasText: name }).first();
      await link("Same").click(); await assertTarget(0, "One target", reader);
      await link("Cross").click(); await assertTarget(1, "Two target", reader);
      await link("Back").click(); await assertTarget(0, "One target", reader);
      const assertSvg = async (chapter: number, fragment: string) => {
        const target = page.locator(`.pith-epub-chapter-${chapter} [data-epub-fragment="${fragment}"]`);
        assert.equal(await target.count(), 1);
        const visible = await target.evaluate((node: Element, selector: string) => { const r = document.querySelector(selector)!.getBoundingClientRect(), t = node.getBoundingClientRect(); return t.left < r.right && t.right > r.left && t.top < r.bottom && t.bottom > r.top; }, reader);
        assert.equal(visible, true, `${chapter}:${fragment} is visible`);
      };
      await link("SVG Same").click(); await assertSvg(0, "svg-root");
      await link("SVG Cross").click(); await assertSvg(1, "svg-root");
      await link("SVG Inner Same").click(); await assertSvg(1, "svg-inner");
      await link("SVG Back").click(); await assertSvg(0, "svg-root");
      await link("SVG Inner Cross").click(); await assertSvg(1, "svg-inner");
      await link("Colon Same").click(); await assertSvg(0, "svg:inner");
      await link("Colon Cross").click(); await assertSvg(1, "svg:inner");
      await link("Colon Back").click(); await assertSvg(0, "svg:inner");
      await link("Unicode Cross").click(); await assertSvg(1, "漢字");
      await link("Unicode Same").click(); await assertSvg(1, "漢字");
      await link("Percent Cross").click(); await assertSvg(1, "rate%done");
      const navButton = shell === "web" ? "#toggle-navigation" : ".pith-nav-toggle";
      await page.locator(navButton).click();
      await page.locator("[data-toc-locator]").filter({ hasText: "Two" }).click();
      await assertTarget(1, "Two target", reader);
      await page.locator(navButton).click();
      await page.locator("[data-toc-locator]").filter({ hasText: "One" }).click();
      await assertTarget(0, "One target", reader);
      await link("Chapter").click();
      const chapterVisible = await page.locator(".pith-epub-chapter-1 h1").evaluate((node: HTMLElement, selector: string) => { const r = document.querySelector(selector)!.getBoundingClientRect(), t = node.getBoundingClientRect(); return t.left < r.right && t.right > r.left; }, reader);
      assert.equal(chapterVisible, true);
      for (const name of ["Missing", "Blocked", "Escape", "External", "Danger", "Forged ID"]) {
        const item = link(name); assert.equal(await item.getAttribute("href"), null); await item.click();
        const notice = shell === "web" ? ".pith-toast-tip" : ".pith-toast-tip";
        assert.match((await page.locator(notice).textContent()) || "", /无法定位书内目标/);
      }
      if (shell === "web") {
        await post(`/api/topics/${topic.id}/toolkits`, { toolkits: ["feynman", "shadowing"] });
        await page.locator("#home").click(); await page.locator(`[data-open="${topic.id}"]`).first().click();
      } else await page.evaluate(() => (window as unknown as { testView: { setToolkits(ids: string[]): void } }).testView.setToolkits(["feynman", "shadowing"]));
      await page.locator("#open-dojo").click();
      const chooser = shell === "web" ? "[data-choose-dojo]" : "[data-dojo-choose]";
      assert.equal(await page.locator(chooser).count(), 2);
      await page.locator(chooser).first().click();
      assert.equal(await page.locator("#dojo-toolkit, [data-dojo-tool]").count(), 0);
    }
    assert.equal(external, 0);
  } finally {
    if (browser) await browser.close();
    if (server) await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve()));
    await rm(dir, { recursive: true, force: true });
  }
});
