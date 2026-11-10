import assert from "node:assert/strict";
import { mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import { DefaultWorkspaceStore } from "../src/core/index.ts";
import { parseCurriculumOutline } from "../src/plugins/stage-reader/pagination.ts";
import { createGuideWorkspaceTools } from "../src/plugins/guide-acp/tools.ts";
import { buildScenePrompt } from "../src/plugins/guide-acp/index.ts";
import { createPithWebServer } from "../src/shells/web/server.ts";
import { NodeWorkspaceStorage } from "../src/shells/web/nodeStorage.ts";
import { testSandbox } from "./sandbox.ts";

test("curriculum parses markdown formats and marks existing lesson files", () => {
  const items = parseCurriculumOutline(`# 课程\n- [01-intro.md] 入门：目标\n1. 02-flow.md 数据流\n- [运行时](03-runtime.md)\n- [重复](03-runtime.md)\n- [escape](../outside.md)\n`, ["01-intro.md"]);
  assert.deepEqual(items, [
    { fileName: "01-intro.md", title: "入门：目标", status: "ready" },
    { fileName: "02-flow.md", title: "数据流", status: "planned" },
    { fileName: "03-runtime.md", title: "运行时", status: "planned" },
  ]);
});

test("guide is instructed to generate only the first lesson initially", () => {
  const topic = { id: "t", title: "课程", target: "", status: "exploring", toolkits: [], notes: [], createdAt: "", updatedAt: "" } as const;
  const prompt = buildScenePrompt({ profileMarkdown: "", topic, userMessage: "学习" });
  assert.match(prompt, /首轮仅写第一讲正文/); assert.match(prompt, /禁止一次写完全部章节/); assert.match(prompt, /\[01-xxx\.md\]/);
});

test("web generates the requested lesson after persistence and ignores stale results", { timeout: 60000, skip: !process.env.PITH_PLAYWRIGHT_MODULE || !process.env.PITH_CHROME_PATH }, async () => {
  const root = await testSandbox("task36-web-"), storage = new NodeWorkspaceStorage(root), store = new DefaultWorkspaceStore(storage);
  await store.ensureScaffold();
  const material = await store.importMaterial({ title: "课程", kind: "article", files: [] });
  const topic = await store.createTopic({ title: "课程", materialId: material.id });
  await store.writeGeneratedFile(material.id, "00-课程大纲.md", "# 大纲\n- [01-intro.md] 第一讲\n- [02-flow.md] 数据流\n- [03-runtime.md] 运行时\n- [04-error.md] 失败讲");
  await store.writeGeneratedFile(material.id, "01-intro.md", "# 第一讲\n## 概览\n阅读内容");
  const write = createGuideWorkspaceTools(store, undefined, storage).find(tool => tool.name === "pith_write_lesson")!;
  const received: string[] = []; let release: (() => void) | undefined; let started: (() => void) | undefined;
  const waiting = new Promise<void>(resolve => { started = resolve; });
  const server = await createPithWebServer({ workspaceDir: root, guideProvider: { async reply(input) {
    const text = input.conversation.at(-1)!.text; received.push(text);
    if (text.includes("03-runtime.md")) { started!(); await new Promise<void>(resolve => { release = resolve; }); }
    const name = text.match(/《(0[234]-[^》]+\.md)》/)?.[1];
    if (name && name !== "04-error.md") await write.execute({ topicId: topic.id, fileName: name, markdown: `# ${name} 正文\n## 小节\n真实讲义` });
    return "完成";
  } } });
  let browser: any;
  try {
    const address = server.address(); assert.ok(address && typeof address !== "string");
    const { chromium } = await import(process.env.PITH_PLAYWRIGHT_MODULE!); browser = await chromium.launch({ executablePath: process.env.PITH_CHROME_PATH, headless: true });
    const page = await browser.newPage({ viewport: { width: 1100, height: 800 } }); page.setDefaultTimeout(8000); await page.goto(`http://127.0.0.1:${address.port}`);
    await page.locator(`[data-topic="${topic.id}"]`).first().click(); await page.locator(".pith-nav-toggle").click();
    assert.equal(await page.locator('[data-planned-lesson="02-flow.md"]').count(), 1);
    const evidence = resolve(".tmp/evidence/task-36"); await mkdir(evidence, { recursive: true }); await page.screenshot({ path: join(evidence, "web-curriculum.png") });
    await page.locator('[data-planned-lesson="02-flow.md"]').click(); await page.locator('.pith-article').getByText('02-flow.md 正文').waitFor();
    assert.match(received[0]!, /02-flow\.md.*数据流/); assert.equal((await store.getMaterial(material.id))!.files.some(file => file.name === "02-flow.md"), true);
    await page.locator(".pith-nav-toggle").click(); assert.equal(await page.locator('[data-file="02-flow.md"][aria-current="true"]').count(), 1); assert.equal(await page.locator('[data-toc-locator]').count(), 1); await page.screenshot({ path: join(evidence, "web-current-lesson.png") });
    await page.locator('[data-planned-lesson="03-runtime.md"]').click(); await waiting; await page.locator('.pith-article').getByText('向导正在结合课程大纲与源码为你撰写本讲讲义…').waitFor();
    await page.screenshot({ path: join(evidence, "web-loading.png") });
    await page.locator('.pith-nav-toggle').click(); await page.locator('[data-file="01-intro.md"]').click(); await page.locator('.pith-article').getByText('阅读内容').waitFor();
    const completed = page.waitForResponse((response: any) => response.url().endsWith('/api/chat') && response.request().method() === 'POST' && response.request().postData()?.includes('03-runtime.md'));
    release!(); await completed; await page.waitForLoadState('networkidle'); assert.equal(await page.locator('.pith-article h1').textContent(), '第一讲');
    await page.locator('.pith-nav-toggle').click(); await page.locator('[data-planned-lesson="04-error.md"]').click(); await page.getByText('讲义未保存：04-error.md').waitFor(); assert.equal(await page.locator('.pith-article h1').textContent(), '第一讲');
  } finally { if (release) release(); if (browser) await browser.close(); await new Promise<void>((ok, fail) => server.close(error => error ? fail(error) : ok())); await rm(root, { recursive: true, force: true }); }
});
