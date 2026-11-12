import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import { renderEpub } from "../src/plugins/stage-reader/epub.ts";
import { createPithWebServer } from "../src/shells/web/server.ts";
import { storedEpub } from "./wave12-epub-fixture.ts";
import { testSandbox } from "./sandbox.ts";

function fixture(): Uint8Array {
  const longText = Array.from({ length: 75 }, (_, i) => `<p>第 ${i + 1} 段 ${"阅读正文与分页测试。".repeat(18)}</p>`).join("");
  return storedEpub({
    "META-INF/container.xml": '<container><rootfile full-path="O/book.opf"/></container>',
    "O/book.opf": '<package><manifest><item id="a" href="a.xhtml"/><item id="b" href="b.xhtml"/></manifest><spine><itemref idref="a"/><itemref idref="b"/></spine></package>',
    "O/a.xhtml": `<html><head><style>.bjqs { background: #efaf43 } body.bjqs { color: #004080 } .light { background-color: #fff } .light p { color: #003000 } .nested { background: rgba(0,0,0,0.7); color: navy }</style></head><body class="bjqs"><h4 id="on-light">浅底标题</h4><div class="light"><p id="light-child">浅底深字</p></div><div class="nested"><p id="dark-nested">深底文字</p></div>${longText}</body></html>`,
    "O/b.xhtml": '<html><head><style>h4 {color:#5500af} .text1 {color:#004080} .text {color:#003000} .inherited {color:darkblue} .font-override {color:navy}</style></head><body><h4 id="purple">深紫标题</h4><p class="text1" id="blue">深蓝文字</p><p class="text" id="green">深绿文字</p><p id="inline" style="color: rgb(0, 0, 0)">内联颜色</p><p><font id="font" color="darkred">字体颜色</font></p><p><font id="font-cascade" class="font-override" color="darkred">级联颜色</font></p><div class="inherited"><p id="inherited">继承颜色</p></div><p id="hsl" style="color: hsl(240, 100%, 20%)">HSL 颜色</p></body></html>',
  });
}

test("EPUB chapter selectors and font colors survive sanitization", async () => {
  const rendered = await renderEpub(fixture());
  assert.match(rendered.html, /\.pith-epub-chapter-0\.bjqs, \.pith-epub-chapter-0 \.bjqs/);
  assert.match(rendered.html, /<font id="font" color="darkred">/);
});

test("opening a synthetic EPUB supports keyboard paging and dark cascade contrast", { timeout: 60000, skip: !process.env.PITH_PLAYWRIGHT_MODULE || !process.env.PITH_CHROME_PATH }, async () => {
  const dir = await testSandbox("pith-task27-reader-");
  await mkdir(join(dir, "workspace"));
  const server = await createPithWebServer({ workspaceDir: join(dir, "workspace") });
  let browser: any;
  try {
    const address = server.address(); assert.ok(address && typeof address !== "string"); const base = `http://127.0.0.1:${address.port}`;
    const post = async (path: string, data: unknown) => { const response = await fetch(base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data) }); assert.ok(response.ok); return response.json(); };
    const topic = await post("/api/topics", { title: "合成 EPUB 对比测试" });
    await post("/api/materials", { topicId: topic.id, title: "合成 EPUB", kind: "book", files: [{ name: "fixture.epub", data: Buffer.from(fixture()).toString("base64") }] });
    const { chromium } = await import(process.env.PITH_PLAYWRIGHT_MODULE!);
    browser = await chromium.launchPersistentContext(join(dir, "profile"), { executablePath: process.env.PITH_CHROME_PATH, headless: true, viewport: { width: 1000, height: 800 } });
    const page = await browser.newPage();
    await page.goto(base);
    await page.addStyleTag({ content: 'body.theme-dark{--background-primary:#1e1e1e;--background-secondary:#292929;--text-normal:#eee;--text-muted:#bbb} body.theme-light{--background-primary:#fff;--text-normal:#222}' });
    await page.evaluate(() => document.body.classList.add("theme-dark"));
    await page.locator(`[data-topic="${topic.id}"]`).first().click();
    await page.locator("#purple").waitFor({ state: "attached" });
    const counter = page.locator("[data-page-count]");
    assert.match(await counter.textContent(), /^1 \/ (?:[2-9]|[1-9]\d+)$/);
    assert.equal(await page.evaluate(() => document.activeElement?.classList.contains("pith-reader")), true);
    await page.keyboard.press("ArrowRight");
    assert.match(await counter.textContent(), /^2 \/ /);
    await page.keyboard.press("ArrowLeft"); assert.match(await counter.textContent(), /^1 \/ /);
    await page.evaluate(() => { const field = document.createElement("textarea"); field.id = "outside-input"; document.body.append(field); field.focus(); });
    await page.keyboard.press("ArrowRight"); assert.match(await counter.textContent(), /^1 \/ /);
    await page.evaluate(() => { document.getElementById("outside-input")!.remove(); });
    await page.keyboard.press("ArrowRight"); assert.match(await counter.textContent(), /^2 \/ /);
    await page.keyboard.press("ArrowLeft"); assert.match(await counter.textContent(), /^1 \/ /);
    const contrast = await page.evaluate(() => {
      const parse = (value: string) => value.match(/[\d.]+/g)!.map(Number);
      const composite = (front: number[], back: number[]) => front.slice(0, 3).map((v, i) => v * (front[3] ?? 1) + back[i]! * (1 - (front[3] ?? 1)));
      const lum = (c: number[]) => c.map(x => { const v = x / 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }).reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i]!, 0);
      const ids = ["on-light", "light-child", "dark-nested", "purple", "blue", "green", "inline", "font", "font-cascade", "inherited", "hsl"];
      return Object.fromEntries(ids.map(id => {
        const element = document.getElementById(id)!; const layers: number[][] = [];
        for (let node: Element | null = element; node; node = node.parentElement) layers.push(parse(getComputedStyle(node).backgroundColor));
        let bg = [255, 255, 255]; for (const layer of layers.reverse()) bg = composite(layer, bg);
        const fg = composite(parse(getComputedStyle(element).color), bg), x = lum(fg), y = lum(bg);
        return [id, { ratio: (Math.max(x, y) + .05) / (Math.min(x, y) + .05), fg, bg }];
      }));
    });
    for (const [id, value] of Object.entries(contrast) as [string, { ratio: number }][]) assert.ok(value.ratio >= 4.5, `${id}: ${JSON.stringify(value)}`);
    assert.equal(await page.locator('.pith-epub-chapter-0').evaluate((el: Element) => getComputedStyle(el).backgroundColor), "rgb(239, 175, 67)");
    const evidence = resolve(`${process.env.PITH_TEST_SCREENSHOT_DIR}/task-27`); await mkdir(evidence, { recursive: true });
    await page.screenshot({ path: join(evidence, "web-dark.png") });
    await page.locator("#purple").scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(evidence, "web-dark-text.png") });
    await page.evaluate(() => { document.body.classList.replace("theme-dark", "theme-light"); });
    await page.waitForFunction(() => getComputedStyle(document.getElementById("purple")!).color === "rgb(85, 0, 175)");
    assert.equal(await page.locator("#font").evaluate((el: Element) => getComputedStyle(el).color), "rgb(139, 0, 0)");
    assert.equal(await page.locator("#font-cascade").evaluate((el: Element) => getComputedStyle(el).color), "rgb(0, 0, 128)");
    await page.screenshot({ path: join(evidence, "web-light.png") });
    await page.addStyleTag({ content: '@media(prefers-color-scheme:dark){body:not(.theme-light){--background-primary:#1e1e1e;--text-normal:#eee}}' });
    await page.evaluate(() => document.body.classList.remove("theme-light"));
    await page.emulateMedia({ colorScheme: "dark" });
    await page.waitForFunction(() => getComputedStyle(document.getElementById("purple")!).color !== "rgb(85, 0, 175)");
    await page.emulateMedia({ colorScheme: "light" });
    await page.waitForFunction(() => getComputedStyle(document.getElementById("purple")!).color === "rgb(85, 0, 175)");
  } finally { if (browser) await browser.close(); await new Promise<void>((resolveClose, reject) => server.close(error => error ? reject(error) : resolveClose())); await rm(dir, { recursive: true, force: true }); }
});

test("Obsidian shared workbench adapts synthetic EPUB colors", { timeout: 30000, skip: !process.env.PITH_PLAYWRIGHT_MODULE || !process.env.PITH_CHROME_PATH }, async () => {
  const dir = await testSandbox("pith-task27-native-"); let browser: any;
  try {
    const documentView = await renderEpub(fixture());
    const bundle = await build({ entryPoints: ["src/shells/obsidian/plugin.ts"], bundle: true, write: false, platform: "browser", format: "iife", globalName: "PithView" });
    const { chromium } = await import(process.env.PITH_PLAYWRIGHT_MODULE!);
    browser = await chromium.launchPersistentContext(join(dir, "profile"), { executablePath: process.env.PITH_CHROME_PATH, headless: true, viewport: { width: 1000, height: 800 } });
    const page = await browser.newPage();
    await page.setContent('<style>html,body,#root{height:100%;margin:0}body{--background-primary:#1e1e1e;--background-secondary:#292929;--text-normal:#eee;--text-muted:#bbb}</style><body class="theme-dark"><div id="root"></div></body>');
    await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
    await page.evaluate((html: string) => { const view = new (window as any).PithView.PithObsidianView(document.getElementById("root"), { openFile() {}, selection() {}, openToolkit() {} }); view.render({ html, title: "合成 EPUB", currentFile: "test.epub", format: "epub", files: [], sections: [] }); }, documentView.html);
    assert.equal(await page.evaluate(() => document.activeElement?.classList.contains("pith-reader")), true);
    await page.keyboard.press("ArrowRight"); assert.match(await page.locator("[data-page-count]").textContent(), /^2 \/ /);
    const color = await page.locator("#purple").evaluate((el: Element) => getComputedStyle(el).color);
    assert.notEqual(color, "rgb(85, 0, 175)");
    await page.locator("#purple").scrollIntoViewIfNeeded();
    const evidence = resolve(`${process.env.PITH_TEST_SCREENSHOT_DIR}/task-27`); await mkdir(evidence, { recursive: true });
    await page.screenshot({ path: join(evidence, "obsidian-workbench-dark.png") });
  } finally { if (browser) await browser.close(); await rm(dir, { recursive: true, force: true }); }
});
