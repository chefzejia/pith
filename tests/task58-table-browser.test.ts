import assert from "node:assert/strict";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { build } from "esbuild";
import { testSandbox } from "./sandbox.ts";

const unavailable = !process.env.PITH_PLAYWRIGHT_MODULE || !process.env.PITH_CHROME_PATH;
const path = "packages/boot/app-boot/tests/profile-plugins.spec.ts";
const chinese = "中文说明保留连续阅读能力，长路径与代码不能把相邻内容挤成逐字竖排。";

for (const surface of ["article", "guide"] as const) test(`${surface} tables keep real long citations, code and Chinese readable with local horizontal scrolling`, { skip: unavailable, timeout: 60000 }, async () => {
  const root = await testSandbox("task58-table-");
  let browser: any;
  try {
    const markdown = await readFile(new URL("./fixtures/task58/f1-minimal-lesson.md", import.meta.url), "utf8");
    const content = `${markdown}\n相邻正文正常换行。${chinese.repeat(3)}\n\n| 路径 | 代码 | 中文说明 |\n| --- | --- | --- |\n| \`${path}:121\` | \`const before = readProfilePlugins(location)\` | ${chinese.repeat(3)} |\n\n| 项 | 值 |\n| --- | --- |\n| 一 | 二 |`;
    const bundle = await build({ stdin: { contents: 'export { PithWorkbenchView } from "./src/workbench/view.ts"; export { renderMarkdown } from "./src/plugins/stage-reader/index.ts"; export { resolveResponsiveLayout } from "./src/plugins/stage-reader/pagination.ts";', resolveDir: process.cwd() }, bundle: true, write: false, platform: "browser", format: "iife", globalName: "TableTest" });
    const { chromium } = await import(process.env.PITH_PLAYWRIGHT_MODULE!);
    browser = await chromium.launchPersistentContext(join(root, "profile"), { executablePath: process.env.PITH_CHROME_PATH, headless: true });
    const page = await browser.newPage();
    await page.setContent('<style>html,body,#root{height:100%;margin:0}body{font:15px/1.6 system-ui,sans-serif;--font-interface:system-ui,sans-serif;--background-primary:white;--background-secondary:#f2f3f1;--background-modifier-border:#ccc;--text-normal:#222;--text-muted:#666}code{font-size:17px}</style><div id="root"></div>');
    await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
    await page.evaluate(async ({ content, path, surface }: { content: string; path: string; surface: string }) => {
      const api = (window as any).TableTest;
      const state: any = (window as any).tableTest = { opened: [] };
      const conversation = [{ id: "preserved", status: "completed", startedAt: new Date().toISOString(), user: { text: "保留表格排版回归，无模型请求" }, choices: [], steps: [{ kind: "reply", markdown: content }] }];
      state.view = new api.PithWorkbenchView(document.getElementById("root"), {
        openFile: async (file: string, source: unknown) => {
          state.opened.push({ file, source });
          state.view.render({ title: file, currentFile: file, files: [], sections: [], html: Array.from({ length: 150 }, (_, i) => `<pre data-locator="repo:pinned:${file}#L${i + 1}-L${i + 1}">source line ${i + 1}</pre>`).join("") });
        }, openToolkit() {}, selection() {},
        guideData: async () => ({ notes: [], conversation, actions: [], toolkits: [], observations: [] }),
      });
      document.querySelector(".pith-layout")!.append(state.view.guideElement());
      state.view.setGuideVisible(true);
      state.view.render({ title: "F1 原始表格", currentFile: "lesson.md", source: { kind: "lesson" }, files: [], sections: [], materialGroups: [{ id: "pinned-repo", title: "deepseek-harness", kind: "repo", files: [{ name: path, mimeType: "text/plain" }] }], html: surface === "article" ? api.renderMarkdown(content) : "<p>相邻舞台正文</p>" });
      await state.view.refreshGuide();
    }, { content, path, surface });
    let scrollingTables = 0;
    for (const [width, height] of [[1024, 800], [1440, 900], [700, 600], [390, 650]]) {
      await page.setViewportSize({ width, height });
      await page.waitForFunction(() => {
        const root = document.querySelector<HTMLElement>(".pith-view")!;
        return root.dataset.sheetMode === (window as any).TableTest.resolveResponsiveLayout({ width: root.clientWidth, height: root.clientHeight, guideOpen: false }).sheetMode;
      });
      const tables = page.locator(surface === "article" ? ".pith-article table" : ".pith-guide-reply table");
      assert.equal(await tables.count(), 3);
      for (let index = 0; index < 2; index++) {
        const table = tables.nth(index);
        const metrics = await table.evaluate((node: HTMLTableElement) => {
          const container = node.closest<HTMLElement>(".pith-article,.pith-guide-reply")!;
          let scroll: HTMLElement = node;
          while (scroll !== container && !/auto|scroll/.test(getComputedStyle(scroll).overflowX)) scroll = scroll.parentElement!;
          const code = node.querySelectorAll("tbody td code")[1]!;
          const range = document.createRange(); range.selectNodeContents(code);
          const codeLines = new Set(Array.from(range.getClientRects(), rect => Math.round(rect.top))).size;
          const chinese = node.rows[1]!.cells[2];
          const block = node.getBoundingClientRect(), bounds = container.getBoundingClientRect();
          const style = getComputedStyle(container);
          const escapedText: string[] = [];
          for (const cell of node.querySelectorAll("th,td")) {
            const bounds = cell.getBoundingClientRect(), walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT); let text: Node | null;
            while ((text = walker.nextNode())) { const range = document.createRange(); range.selectNodeContents(text); if (Array.from(range.getClientRects()).some(rect => rect.width && (rect.left < bounds.left - 1 || rect.right > bounds.right + 1))) escapedText.push(text.textContent ?? ""); }
          }
          return { scrollable: scroll.scrollWidth > scroll.clientWidth + 2, local: scroll !== container, codeLines, escapedText, cellWidths: Array.from(node.rows[1]!.cells, cell => cell.getBoundingClientRect().width), chineseWidth: chinese?.getBoundingClientRect().width, tableLeft: block.left, frameWidth: scroll.getBoundingClientRect().width, available: bounds.width - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight), rowHeight: node.rows[1]!.getBoundingClientRect().height };
        });
        assert.equal(metrics.codeLines, 1, `${surface} ${width}: inline code collapsed: ${JSON.stringify(metrics)}`);
        assert.deepEqual(metrics.escapedText, [], `${surface} ${width}: text overlaps adjacent columns`);
        assert.ok(metrics.local, `${surface} ${width}: table needs its own horizontal scroller: ${JSON.stringify(metrics)}`);
        assert.ok(metrics.frameWidth <= metrics.available + 1, `${surface} ${width}: table pushes adjacent content outside the column`);
        if (index === 1) assert.ok(metrics.chineseWidth > 100, `${surface} ${width}: Chinese column collapsed`);
        if (!metrics.scrollable) continue;
        scrollingTables++;
        await table.evaluate((node: HTMLElement) => { let scroll = node; while (!/auto|scroll/.test(getComputedStyle(scroll).overflowX)) scroll = scroll.parentElement!; scroll.focus(); scroll.scrollLeft = 0; });
        await page.keyboard.press("ArrowRight");
        await page.waitForFunction((node: HTMLElement) => { let scroll = node; while (!/auto|scroll/.test(getComputedStyle(scroll).overflowX)) scroll = scroll.parentElement!; return scroll.scrollLeft > 0; }, await table.elementHandle(), { timeout: 3000 }).catch(async () => {
          assert.fail(`${surface} ${width} table ${index}: keyboard scroll failed ${JSON.stringify(await table.evaluate((node: HTMLElement) => ({ focused: document.activeElement?.outerHTML.slice(0, 150), parent: node.parentElement?.outerHTML.slice(0, 150), scrollLeft: node.parentElement?.scrollLeft, scrollWidth: node.parentElement?.scrollWidth, clientWidth: node.parentElement?.clientWidth })))}`);
        });
        assert.ok(await table.evaluate((node: HTMLTableElement) => { let scroll: HTMLElement = node; while (!/auto|scroll/.test(getComputedStyle(scroll).overflowX)) scroll = scroll.parentElement!; scroll.scrollLeft = scroll.scrollWidth; const last = node.rows[1]!.cells[node.rows[1]!.cells.length - 1]!.getBoundingClientRect(), bounds = scroll.getBoundingClientRect(); return scroll.scrollLeft > 0 && last.right <= bounds.right + 1 && last.right > bounds.left; }), "scrolling exposes the final column");
      }
      assert.ok(await tables.last().evaluate((node: HTMLElement) => node.getBoundingClientRect().width < 200), "short tables retain intrinsic width");
    }
    assert.ok(scrollingTables >= 3, "narrow columns actually overflow and exercise horizontal scrolling");
    if (surface === "article") {
      await page.setViewportSize({ width: 1024, height: 800 });
      await page.locator('[data-citation-line="131"]').first().click();
      await page.waitForFunction(() => { const target = document.querySelector('[data-locator$="#L131-L131"]')!.getBoundingClientRect(), reader = document.querySelector(".pith-reader")!.getBoundingClientRect(); return target.top >= reader.top && target.bottom <= reader.bottom; });
      assert.deepEqual(await page.evaluate(() => (window as any).tableTest.opened), [{ file: path, source: { kind: "material", materialId: "pinned-repo" } }]);
    }
  } finally { if (browser) await browser.close(); await rm(root, { recursive: true, force: true }); }
});
