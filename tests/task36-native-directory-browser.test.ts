import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";

test("directory content fits host-sized buttons and all entries remain clickable", { timeout: 30000, skip: !process.env.PITH_PLAYWRIGHT_MODULE || !process.env.PITH_CHROME_PATH }, async () => {
  const bundle = await build({ entryPoints: ["src/shells/obsidian/plugin.ts"], bundle: true, write: false, platform: "browser", format: "iife", globalName: "PithView" });
  const { chromium } = await import(process.env.PITH_PLAYWRIGHT_MODULE!);
  const browser = await chromium.launch({ executablePath: process.env.PITH_CHROME_PATH, headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 450 } });
    await page.setContent(`<style>html,body,#root{height:100%;margin:0}button{height:30px;line-height:19.5px;white-space:nowrap}body{--background-primary:#fff;--background-secondary:#f1f3ef;--background-modifier-border:#cbd5cc;--background-modifier-hover:#e1e9e2;--text-normal:#222;--text-muted:#666;--font-interface:Arial}</style><div id="root"></div>`);
    await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
    await page.evaluate(() => {
      const state = (window as any).directoryTest = { clicks: [] as string[] };
      const view = new (window as any).PithView.PithObsidianView(document.getElementById("root"), { openFile: (file: string) => state.clicks.push(file), generateLesson: (file: string) => state.clicks.push(file), selection() {} });
      view.render({ title: "课程", currentFile: "01.md", files: [{ name: "01.md" }, { name: "这是非常长的材料文件名称用于检查窄屏中完整内容和换行的布局.md" }], sections: [], html: "<p>正文</p>", curriculum: [
        { fileName: "01.md", title: "第一讲：很长的已生成课程标题，用来检查标题换行后仍然完整地包含在自身按钮中", status: "ready" },
        { fileName: "02.md", title: "第二讲：跨语言运行时中的组件生命周期与状态同步，以及复杂异步任务和多端用户交互的完整设计", status: "planned" },
        { fileName: "03.md", title: "第三讲：复杂系统中的并发操作、数据一致性以及异常恢复和阅读位置的保持", status: "planned" },
        { fileName: "04.md", title: "第四讲：异步任务的取消和重试", status: "planned" },
      ] });
    });
    await page.locator(".pith-nav-toggle").click();
    const geometry = await page.locator(".pith-left-drawer").evaluate((drawer: HTMLElement) => {
      const children = (Array.from(drawer.children) as HTMLElement[]).filter(node => node.textContent?.trim());
      return children.map(node => {
        const box = node.getBoundingClientRect(), range = document.createRange(); range.selectNodeContents(node); const text = range.getBoundingClientRect();
        const badge = node.querySelector<HTMLElement>(".pith-lesson-badge"), title = node.querySelector<HTMLElement>(".pith-lesson span:first-child");
        return { label: node.textContent, top: box.top, bottom: box.bottom, left: box.left, right: box.right, textTop: text.top, textBottom: text.bottom, textLeft: text.left, textRight: text.right, scrollHeight: node.scrollHeight, height: node.clientHeight, badgeFits: !badge || !title || title.getBoundingClientRect().right <= badge.getBoundingClientRect().left };
      });
    });
    for (const [index, item] of geometry.entries()) {
      assert.ok(item.textTop >= item.top - 1 && item.textBottom <= item.bottom + 1 && item.textLeft >= item.left - 1 && item.textRight <= item.right + 1 && item.scrollHeight <= item.height + 1 && item.badgeFits, JSON.stringify(item));
      if (index) assert.ok(item.top >= geometry[index - 1]!.bottom - 1, JSON.stringify(geometry));
    }
    assert.ok(geometry.find((item: any) => item.label?.startsWith("第二讲"))!.bottom - geometry.find((item: any) => item.label?.startsWith("第二讲"))!.top > 40);
    for (const [selector, expected] of [['[data-file="01.md"]', '01.md'], ['[data-planned-lesson="02.md"]', '02.md'], ['[data-planned-lesson="03.md"]', '03.md'], ['[data-file$=".md"]:not(.pith-lesson)', '这是非常长的材料文件名称用于检查窄屏中完整内容和换行的布局.md']] as const) {
      const button = page.locator(selector); await button.scrollIntoViewIfNeeded(); await button.click();
      assert.equal(await page.evaluate(() => (window as any).directoryTest.clicks.at(-1)), expected);
      await page.locator('.pith-nav-toggle').click();
    }
  } finally { await browser.close(); }
});
