import { testToolkits } from "./guide-tools-fixture.ts";
import assert from "node:assert/strict";
import { mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import { DefaultWorkspaceStore } from "../src/core/index.ts";
import { parseCurriculumOutline } from "../src/plugins/stage-reader/pagination.ts";
import { createScopedTools } from "../src/plugins/guide-acp/tools.ts";
import { buildScenePrompt } from "../src/plugins/guide-acp/index.ts";
import { createPithWebServer } from "../src/shells/web/server.ts";
import { NodeWorkspaceStorage } from "../src/shells/web/nodeStorage.ts";
import { testSandbox } from "./sandbox.ts";

test("curriculum parses markdown formats and marks existing lesson files", () => {
  const items = parseCurriculumOutline(`# 课程\n- [01-intro.md] 入门：目标\n1. 02-flow.md 数据流\n- [运行时](03-runtime.md)\n- [相对](./04-relative.md)\n- [片段](05-fragment.md#section)\n- [空格](06 other.md)\n- [重复](03-runtime.md)\n- [escape](../outside.md)\n- [nested](./dir/outside.md)\n- [url](https://example.com/a.md)\n- [windows](C:\\outside.md)\n`, ["01-intro.md", "04-relative.md"]);
  assert.deepEqual(items, [
    { fileName: "01-intro.md", title: "入门：目标", status: "ready" },
    { fileName: "02-flow.md", title: "数据流", status: "planned" },
    { fileName: "03-runtime.md", title: "运行时", status: "planned" },
    { fileName: "04-relative.md", title: "相对", status: "ready" },
    { fileName: "05-fragment.md", title: "片段", status: "planned" },
    { fileName: "06 other.md", title: "空格", status: "planned" },
  ]);
});

test("guide is instructed to generate only the first lesson initially", () => {
  const topic = { id: "t", title: "课程", target: "学习", status: "exploring", materialIds: [], lessons: [], toolkits: [], notes: [], createdAt: "", updatedAt: "" } as const;
  const prompt = buildScenePrompt({ profileMarkdown: "", topic, materials: [], userMessage: "学习" });
  assert.match(prompt, /首轮仅写第一讲正文/); assert.match(prompt, /禁止一次写完全部章节/); assert.match(prompt, /\[01-xxx\.md\]/);
});

test("web generates the requested lesson after persistence and ignores stale results", { timeout: 60000, skip: !process.env.PITH_PLAYWRIGHT_MODULE || !process.env.PITH_CHROME_PATH }, async () => {
  const root = await testSandbox("task36-web-"), storage = new NodeWorkspaceStorage(root), store = new DefaultWorkspaceStore(storage);
  await store.ensureScaffold();
  const material = await store.importMaterial({ title: "课程", kind: "article", files: [] });
  const topic = await store.createTopic({ title: "课程", target: "学习课程", materialIds: [material.id], toolkits: [] });
  await store.writeLesson(topic.id, "00-课程大纲.md", "# 大纲\n- [01-intro.md] 第一讲\n- [数据流](./02-flow.md)\n- [运行时](03-runtime.md#section)\n- [04-error.md] 失败讲\n- [05-extra.md] 第五讲\n- [06-extra.md] 第六讲：深入理解异步数据流中的状态更新与并发边界");
  await store.writeLesson(topic.id, "01-intro.md", "# 第一讲\n## 概览\n阅读内容");
  const write = createScopedTools({ toolkits: testToolkits, topicId: topic.id, store, storage, onChoices: () => {} }).find(tool => tool.name === "pith_write_lesson")!;
  const received: string[] = []; let release: (() => void) | undefined; let started: (() => void) | undefined; let releaseMessage: (() => void) | undefined; let messageStarted: (() => void) | undefined; let releaseSix: (() => void) | undefined; let sixStarted: (() => void) | undefined;
  const waiting = new Promise<void>(resolve => { started = resolve; });
  const messageWaiting = new Promise<void>(resolve => { messageStarted = resolve; });
  const sixWaiting = new Promise<void>(resolve => { sixStarted = resolve; });
  const server = await createPithWebServer({ workspaceDir: root, guideProvider: { async run(input, options) {
    const text = input.text; received.push(text);
    if (text.includes("03-runtime.md")) { started!(); await new Promise<void>(resolve => { release = resolve; }); }
    if (text === "切章后的真实草稿") { messageStarted!(); await new Promise<void>(resolve => { releaseMessage = resolve; }); }
    if (text.includes("06-extra.md")) { sixStarted!(); await new Promise<void>(resolve => { releaseSix = resolve; }); }
    const name = text.match(/《(0[234]-[^》]+\.md)》/)?.[1];
    if (name && name !== "04-error.md") await write.execute({ fileName: name, markdown: `# ${name} 正文\n## 小节\n真实讲义` });
    options.onStep({ kind: "reply", markdown: "完成" }, 0); return { status: "completed" };
  } } });
  let browser: any;
  try {
    const address = server.address(); assert.ok(address && typeof address !== "string");
    const { chromium } = await import(process.env.PITH_PLAYWRIGHT_MODULE!); browser = await chromium.launch({ executablePath: process.env.PITH_CHROME_PATH, headless: true });
    const page = await browser.newPage({ viewport: { width: 1100, height: 800 } }); page.setDefaultTimeout(8000); await page.goto(`http://127.0.0.1:${address.port}`);
    await page.locator(`[data-topic="${topic.id}"]`).first().click(); await page.locator(".pith-nav-toggle").click();
    assert.equal(await page.locator('[data-planned-lesson="02-flow.md"]').count(), 1);
    const evidence = resolve(`${process.env.PITH_TEST_SCREENSHOT_DIR}/task-36`); await mkdir(evidence, { recursive: true }); await page.screenshot({ path: join(evidence, "web-curriculum.png") });
    await page.locator('[data-planned-lesson="02-flow.md"]').click(); await page.locator('.pith-article').getByText('02-flow.md 正文').waitFor();
    assert.match(received[0]!, /02-flow\.md.*数据流/); assert.equal((await store.getTopic(topic.id))!.lessons.some(lesson => lesson.name === "02-flow.md"), true);
    await page.locator(".pith-nav-toggle").click(); assert.equal(await page.locator('[data-file="02-flow.md"][aria-current="true"]').count(), 1); assert.equal(await page.locator('[data-toc-locator]').filter({ hasText: "小节" }).count(), 1); await page.screenshot({ path: join(evidence, "web-current-lesson.png") });
    await page.locator('[data-planned-lesson="03-runtime.md"]').click(); await waiting; await page.locator('.pith-article').getByText('向导正在结合课程大纲与源码为你撰写本讲讲义…').waitFor();
    await page.screenshot({ path: join(evidence, "web-loading.png") });
    let releaseGuide!: () => void, guideArrived!: () => void; const guideWaiting = new Promise<void>(resolve => { guideArrived = resolve; }); const guideGate = new Promise<void>(resolve => { releaseGuide = resolve; });
    await page.route('**/api/chat?topicId=*', async (route: any) => { if (route.request().method() === 'GET') { guideArrived(); await guideGate; } await route.continue(); }, { times: 1 });
    await page.locator('.pith-nav-toggle').click(); await page.locator('[data-file="01-intro.md"]').click(); await page.locator('.pith-article').getByText('阅读内容').waitFor(); await guideWaiting;
    const input = page.locator('.pith-guide textarea'); await input.fill('切章后的真实草稿'); await input.focus(); await input.evaluate((node: HTMLTextAreaElement) => { node.setSelectionRange(1, 4); (window as any).draftBefore = node; (window as any).contentBefore = document.querySelector('.pith-guide-content'); });
    releaseGuide(); await page.waitForFunction(() => document.querySelector('.pith-guide-content') !== (window as any).contentBefore); assert.equal(await input.evaluate((node: HTMLTextAreaElement) => node === (window as any).draftBefore), true);
    assert.equal(await input.inputValue(), '切章后的真实草稿'); assert.deepEqual(await input.evaluate((node: HTMLTextAreaElement) => [document.activeElement === node, node.selectionStart, node.selectionEnd]), [true, 1, 4]);
    release!(); await page.locator('[data-guide-stop]').waitFor({ state: 'detached' }); assert.equal(await page.locator('.pith-article h1').textContent(), '第一讲');
    await page.locator('.pith-nav-toggle').click(); await page.locator('[data-file="03-runtime.md"]').waitFor(); assert.equal(await page.locator('[data-planned-lesson="03-runtime.md"]').count(), 0); assert.equal(await input.inputValue(), '切章后的真实草稿');
    await page.locator('.pith-nav-toggle').click(); await page.locator('[data-guide-send]').click(); await messageWaiting; assert.equal(await input.inputValue(), ''); await input.fill('请求期间的新草稿'); releaseMessage!(); await page.locator('[data-guide-send]').waitFor(); assert.equal(await input.inputValue(), '请求期间的新草稿'); assert.ok(received.includes('切章后的真实草稿'));
    await page.locator('.pith-nav-toggle').click();
    await page.setViewportSize({ width: 390, height: 844 }); await page.screenshot({ path: join(evidence, 'fix-web-narrow-light.png') }); await page.emulateMedia({ colorScheme: 'dark' }); await page.screenshot({ path: join(evidence, 'fix-web-narrow-dark.png') });
    await page.setViewportSize({ width: 390, height: 650 }); await page.locator('[data-planned-lesson="06-extra.md"]').click(); await sixWaiting;
    const loading = page.locator('.pith-lesson-loading'); await loading.waitFor(); assert.equal(await page.locator('.pith-left-drawer').isHidden(), true); assert.equal(await page.locator('.pith-guide').isVisible(), true);
    const checkLoading = async () => {
      const result = await loading.evaluate((section: HTMLElement) => {
        const reader = section.closest('.pith-reader')!.getBoundingClientRect(), guide = document.querySelector('.pith-guide')!.getBoundingClientRect();
        return Array.from(section.querySelectorAll<HTMLElement>('h1,[role=status]')).map(node => {
          const range = document.createRange(); range.selectNodeContents(node);
          return Array.from(range.getClientRects()).filter(rect => rect.width && rect.height).map(rect => { const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2); return { visible: rect.top >= reader.top && rect.bottom <= reader.bottom && rect.bottom <= guide.top && rect.left >= 0 && rect.right <= innerWidth, hit: !!hit && (hit === node || node.contains(hit)) }; });
        });
      });
      assert.equal(result.length, 2); assert.ok(result.every((lines: any[]) => lines.length && lines.every(line => line.visible && line.hit)), JSON.stringify(result)); assert.ok(result[0].length >= 2);
    };
    for (const scheme of ['light', 'dark'] as const) { await page.emulateMedia({ colorScheme: scheme }); await checkLoading(); await page.screenshot({ path: join(evidence, `fix2-loading-${scheme}.png`) }); }
    await page.locator('.pith-guide textarea').click(); assert.equal(await page.locator('.pith-guide textarea').evaluate((node: HTMLElement) => document.activeElement === node), true);
    await page.locator('.pith-nav-toggle').click(); assert.equal(await page.locator('[data-file="01-intro.md"]').isVisible(), true); await page.locator('.pith-nav-toggle').click(); await checkLoading();
    releaseSix!(); await page.getByText('讲义未保存：06-extra.md').waitFor(); assert.equal(await page.locator('.pith-article h1').textContent(), '第一讲');
    await page.setViewportSize({ width: 1100, height: 800 });
    await page.locator('.pith-nav-toggle').click(); await page.locator('[data-planned-lesson="04-error.md"]').click(); await page.getByText('讲义未保存：04-error.md').waitFor(); assert.equal(await page.locator('.pith-article h1').textContent(), '第一讲');
  } finally { if (release) release(); if (releaseMessage) releaseMessage(); if (releaseSix) releaseSix(); if (browser) await browser.close(); await new Promise<void>((ok, fail) => server.close(error => error ? fail(error) : ok())); await rm(root, { recursive: true, force: true }); }
});
