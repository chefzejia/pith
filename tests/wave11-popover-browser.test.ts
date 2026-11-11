import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

test("Obsidian reader popovers stay below the actual header and leave its controls clickable", { skip: !process.env.PITH_PLAYWRIGHT_MODULE || !process.env.PITH_CHROME_PATH }, async () => {
  const { chromium } = await import(process.env.PITH_PLAYWRIGHT_MODULE!);
  const bundle = await build({ entryPoints: ["src/shells/obsidian/plugin.ts"], bundle: true, write: false, platform: "browser", format: "iife", globalName: "PithView" });
  const profile = await mkdtemp(join(tmpdir(), "pith-popover-browser-"));
  let browser: Awaited<ReturnType<typeof chromium.launchPersistentContext>> | undefined;
  try {
    browser = await chromium.launchPersistentContext(profile, { executablePath: process.env.PITH_CHROME_PATH, headless: true, viewport: { width: 1000, height: 800 }, args: ["--no-first-run", "--no-default-browser-check"] });
    const page = await browser.newPage();
    for (const [width, padded, format] of [[390, true, "markdown"], [390, false, "markdown"], [390, true, "epub"], [900, false, "epub"]] as const) {
      await page.setViewportSize({ width, height: 800 });
      await page.setContent(`<style>html,body{margin:0;height:100%}#root{height:100%;width:${width}px}${padded ? ".pith-view-header{height:auto!important;padding-block:6px!important}" : ""}</style><div id="root"></div>`);
      await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
      await page.evaluate((format: "markdown" | "epub") => {
        const pith = (window as unknown as { PithView: { PithObsidianView: new (root: HTMLElement, actions: object) => { render(document: object): void; setToolkits(ids: string[]): void; openDojo(dojos: object[]): void } } }).PithView;
        let view: InstanceType<typeof pith.PithObsidianView>;
        const dojos = [{ id: "feynman", label: "费曼复述", stages: ["listen-decompose"], transformCue: (text: string) => text }];
        view = new pith.PithObsidianView(document.getElementById("root")!, { openFile() {}, selection() {}, openDojo() { view.openDojo(dojos); }, toggleToolkit: async () => {} });
        view.render({ title: "测试文章", html: "<p>正文</p>", currentFile: format === "epub" ? "book.epub" : "article.md", format, files: [], sections: [] });
        view.setToolkits(["feynman"]);
      }, format);
      await page.waitForFunction(() => document.querySelector(".pith-view")!.getAttribute("data-hit-target") !== null);
      if (padded) assert.ok((await page.locator(".pith-view-header").boundingBox())!.height >= 56);
      for (const [button, panel] of [["[data-command=typography]", ".pith-typography-popover"], ["#open-dojo", ".pith-dojo-panel"]] as const) {
        await page.locator(button).click();
        const header = await page.locator(".pith-view-header").boundingBox(), popup = await page.locator(panel).boundingBox();
        assert.ok(header && popup, `${width}/${panel} visible`);
        assert.ok(popup.y >= header.y + header.height - 0.5, `${width}/${panel} overlaps header by ${header.y + header.height - popup.y}px`);
        assert.ok(popup.x >= 0 && popup.x + popup.width <= width + 1, `${width}/${panel} stays inside the reading pane`);
        const unobstructed = await page.locator(".pith-view-header button:visible").evaluateAll((buttons: HTMLButtonElement[]) => buttons.every(button => { const rect = button.getBoundingClientRect(); const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2); return hit === button || button.contains(hit); }));
        assert.equal(unobstructed, true, `${width}/${panel} blocks a header button`);
        if (padded) {
          await page.locator(panel).evaluate((node: HTMLElement) => { node.style.setProperty("top", "44px", "important"); node.style.setProperty("margin-top", "0", "important"); });
          const old = await page.locator(panel).boundingBox(); assert.ok(old && old.y < header.y + header.height - 10, `${panel}: old fixed offset reproduces overlap`);
          await page.locator(panel).evaluate((node: HTMLElement) => { node.style.removeProperty("top"); node.style.removeProperty("margin-top"); });
        }
        await page.locator(button).click();
        assert.equal(await page.locator(panel).isHidden(), true);
      }
      const menu = page.locator(".pith-dojo-panel"), reader = await page.locator(".pith-reader").boundingBox();
      assert.ok(reader);
      await page.locator("#open-dojo").click(); assert.equal(await menu.isVisible(), true, `${width}: tool menu reopens`);
      await page.keyboard.press("Escape"); assert.equal(await menu.isHidden(), true, `${width}: Escape closes the tool menu`);
      await page.locator("#open-dojo").click(); assert.equal(await menu.isVisible(), true, `${width}: tool menu reopens after Escape`);
      await page.mouse.click(reader.x + 10, reader.y + reader.height - 10); assert.equal(await menu.isHidden(), true, `${width}: a press outside closes the tool menu`);
    }
  } finally {
    if (browser) await browser.close();
    await rm(profile, { recursive: true, force: true });
  }
});
