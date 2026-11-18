import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { build } from "esbuild";

// Observed native button defaults, also exercised by the material-card regression.
const nativeButtons = `button{display:inline-flex;align-items:center;justify-content:center;height:30px;line-height:19.5px;white-space:nowrap}`;
const base = `html,body,#root{height:100%;margin:0}body{--background-primary:#fff;--background-secondary:#f6f6f7;--background-modifier-border:#e4e4e7;--background-modifier-hover:#ececef;--text-normal:#18181b;--text-muted:#71717a;--text-accent:#4e6a56;--font-interface:system-ui,sans-serif;font:15px/1.6 var(--font-interface)}button,input,textarea{font:inherit;color:inherit}`;
const titles = [
  "第一讲：很长的中文章节标题，检查已生成与待生成讲义都能在抽屉的点击边界内完整换行显示",
  "Second lesson: asynchronous lifecycle, cancellation, recovery and shared state across multiple hosts",
  "ThirdLessonContinuousEnglishTitleWithoutSpacesForCheckingWrappingAndTheFullPendingBadgeInsideTheDrawer",
];
const curriculum = titles.flatMap((title, index) => (["ready", "planned"] as const).map(status => ({ fileName: `${index}-${status}.md`, title, status })));
const extraFile = "附加讲义：很长的文件名称也需要完整换行.md";
const materialFile = "材料原文.md";
const captureDirectory = process.env.PITH_DRAWER_CAPTURE_DIR;

test("lesson titles and badge text fit both navigation branches and host button boundaries", { timeout: 60000, skip: !process.env.PITH_PLAYWRIGHT_MODULE || !process.env.PITH_CHROME_PATH }, async t => {
  const bundle = await build({ entryPoints: ["src/shells/obsidian/plugin.ts"], bundle: true, write: false, platform: "browser", format: "iife", globalName: "PithView" });
  const { chromium } = await import(process.env.PITH_PLAYWRIGHT_MODULE!);
  const browser = await chromium.launch({ executablePath: process.env.PITH_CHROME_PATH, headless: true });
  try {
    if (captureDirectory) await mkdir(captureDirectory, { recursive: true });
    for (const grouped of [true, false]) for (const native of [false, true]) for (const width of [320, 390, 1200]) {
      const scenario = `${grouped ? "grouped" : "curriculum"}-${native ? "native-rules" : "web"}-${width}`;
      await t.test(scenario, async () => {
        const page = await browser.newPage({ viewport: { width, height: 1000 } });
        try {
          await page.setContent(`<style>${base}${native ? nativeButtons : ""}</style><div id="root"></div>`);
          await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
          await page.evaluate(({ grouped, curriculum, extraFile, materialFile }: { grouped: boolean; curriculum: { fileName: string; title: string; status: "ready" | "planned" }[]; extraFile: string; materialFile: string }) => {
            const state = (window as any).directoryTest = { generated: [] as unknown[], opened: [] as unknown[] };
            const view = new (window as any).PithView.PithObsidianView(document.getElementById("root"), {
              openFile: (file: string, source: unknown) => state.opened.push({ file, source }),
              generateLesson: async (file: string, title: string) => { state.generated.push({ file, title }); },
              selection() {},
            });
            view.render({ title: "目录布局自检", currentFile: "0-ready.md", source: { kind: "lesson" }, files: [...curriculum.filter(item => item.status === "ready").map(item => ({ name: item.fileName })), { name: extraFile }], sections: [], html: "<h1>讲义正文</h1><p>共享工作台的正式目录渲染；生成回调为受控边界，不调用 Agent。</p>", curriculum,
              ...(grouped ? { materialGroups: [{ id: "material-fixture", title: "参考材料", files: [{ name: materialFile }] }] } : {}),
            });
          }, { grouped, curriculum, extraFile, materialFile });
          await page.locator(".pith-nav-toggle").click();
          const drawer = page.locator(".pith-left-drawer");
          const geometry = await drawer.evaluate((drawer: HTMLElement) => {
            const rect = (box: DOMRect) => ({ left: box.left, right: box.right, top: box.top, bottom: box.bottom });
            const textRects = (node: Node) => {
              const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT), boxes = [];
              while (walker.nextNode()) {
                const range = document.createRange(); range.selectNodeContents(walker.currentNode);
                boxes.push(...Array.from(range.getClientRects(), rect));
              }
              return boxes;
            };
            return { drawer: rect(drawer.getBoundingClientRect()), scrollWidth: drawer.scrollWidth, clientWidth: drawer.clientWidth,
              lessons: Array.from(drawer.querySelectorAll<HTMLElement>(".pith-lesson"), button => {
                const title = button.querySelector<HTMLElement>(".pith-lesson-title"), badge = button.querySelector<HTMLElement>(".pith-lesson-badge");
                return { label: button.textContent, button: rect(button.getBoundingClientRect()), text: textRects(button), title: title ? { box: rect(title.getBoundingClientRect()), text: textRects(title), label: title.textContent } : null, badge: badge ? { box: rect(badge.getBoundingClientRect()), text: textRects(badge), label: badge.textContent } : null };
              }),
            };
          });
          if (captureDirectory) await writeFile(join(captureDirectory, `${scenario}.json`), JSON.stringify(geometry, null, 2));
          const expectedLessons = [...curriculum, ...(grouped ? [{ title: extraFile, status: "ready" as const }] : [])];
          assert.equal(geometry.lessons.length, expectedLessons.length);
          const contains = (outer: { left: number; right: number; top: number; bottom: number }, inner: typeof outer) => inner.left >= outer.left - 1 && inner.right <= outer.right + 1 && inner.top >= outer.top - 1 && inner.bottom <= outer.bottom + 1;
          for (const lesson of geometry.lessons) for (const text of lesson.text) {
            const detail = `${scenario} ${JSON.stringify(lesson)}`;
            assert.ok(contains(lesson.button, text), `text outside button: ${detail}`);
            assert.ok(text.left >= geometry.drawer.left - 1 && text.right <= geometry.drawer.right + 1, `text outside drawer: ${detail}`);
          }
          for (const [index, lesson] of geometry.lessons.entries()) {
            const detail = `${scenario} ${JSON.stringify(lesson)}`;
            assert.ok(lesson.title, `missing lesson title node: ${detail}`);
            assert.equal(lesson.title.label, expectedLessons[index]!.title);
            assert.ok(lesson.title.text.length > 1, `long title must wrap: ${detail}`);
            if (expectedLessons[index]!.status === "planned") {
              assert.ok(lesson.badge, `missing pending badge: ${detail}`);
              assert.equal(lesson.badge.label, "待生成");
              assert.ok(lesson.badge.text.length > 0, detail);
              assert.ok(contains(lesson.button, lesson.badge.box), `badge outside button: ${detail}`);
              for (const text of lesson.badge.text) assert.ok(contains(lesson.badge.box, text), `badge text outside badge: ${detail}`);
              assert.ok(lesson.title.box.right <= lesson.badge.box.left, `title and badge overlap: ${detail}`);
            } else assert.equal(lesson.badge, null, detail);
            if (index) assert.ok(lesson.button.top >= geometry.lessons[index - 1]!.button.bottom, `lesson rows overlap: ${detail}`);
          }
          assert.ok(geometry.scrollWidth <= geometry.clientWidth + 1, `drawer overflows horizontally: ${scenario} ${JSON.stringify(geometry)}`);
          assert.equal(await page.locator('[data-file="0-ready.md"]').getAttribute("aria-current"), "true");
          if (captureDirectory && grouped && ((!native && (width === 390 || width === 1200)) || (native && width === 320))) await page.screenshot({ path: join(captureDirectory, `${scenario}.png`) });
          assert.equal(await drawer.locator("[data-planned-lesson]").count(), curriculum.filter(item => item.status === "planned").length);
          for (const item of curriculum) {
            const selector = item.status === "planned" ? `[data-planned-lesson="${item.fileName}"]` : `[data-file="${item.fileName}"]`;
            await drawer.locator(selector).click();
            assert.equal(await drawer.isHidden(), true);
            const actual = await page.evaluate((status: string) => (window as any).directoryTest[status === "planned" ? "generated" : "opened"].at(-1), item.status);
            assert.deepEqual(actual, item.status === "planned" ? { file: item.fileName, title: item.title } : { file: item.fileName, source: grouped ? { kind: "lesson" } : undefined });
            await page.locator(".pith-nav-toggle").click();
          }
          await drawer.locator(`[data-file="${extraFile}"]`).click();
          assert.equal(await page.evaluate(() => (window as any).directoryTest.opened.at(-1).file), extraFile);
          if (grouped) {
            await page.locator(".pith-nav-toggle").click();
            await drawer.locator(`[data-material-id="material-fixture"]`).click();
            assert.deepEqual(await page.evaluate(() => (window as any).directoryTest.opened.at(-1)), { file: materialFile, source: { kind: "material", materialId: "material-fixture" } });
          }
        } finally { await page.close(); }
      });
    }
  } finally { await browser.close(); }
});
