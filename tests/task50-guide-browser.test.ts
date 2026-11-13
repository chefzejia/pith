import assert from "node:assert/strict";
import { createServer } from "node:http";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { build } from "esbuild";
import { testSandbox } from "./sandbox.ts";

const unavailable = !process.env.PITH_PLAYWRIGHT_MODULE || !process.env.PITH_CHROME_PATH;

test("shared guide renders turn states, protects scroll and sends only deliberate input", { timeout: 60000, skip: unavailable }, async () => {
  const dir = await testSandbox("task50-guide-"), server = createServer((_req, res) => { res.writeHead(200, { "content-type": "text/html" }); res.end("<!doctype html><div id=root></div>"); });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  let browser: any;
  try {
    const address = server.address(); assert.ok(address && typeof address !== "string");
    const bundle = await build({ entryPoints: ["src/workbench/view.ts"], bundle: true, write: false, platform: "browser", format: "iife", globalName: "PithTest" });
    const reader = await build({ entryPoints: ["src/plugins/stage-reader/index.ts"], bundle: true, write: false, platform: "browser", format: "iife", globalName: "PithReader" });
    const { chromium } = await import(process.env.PITH_PLAYWRIGHT_MODULE!);
    browser = await chromium.launchPersistentContext(join(dir, "profile"), { executablePath: process.env.PITH_CHROME_PATH, headless: true, viewport: { width: 900, height: 650 } });
    await browser.grantPermissions(["clipboard-read", "clipboard-write"], { origin: `http://127.0.0.1:${address.port}` });
    const page = await browser.newPage(); await page.goto(`http://127.0.0.1:${address.port}`);
    await page.setContent('<style>html,body,#root{height:100%;margin:0}body{--background-primary:white;--background-secondary:#f2f3f1;--background-modifier-border:#ccc;--background-modifier-hover:#e3e7e3;--text-normal:#222;--text-muted:#666}</style><div id="root"></div>');
    await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
    await page.addScriptTag({ content: reader.outputFiles[0]!.text });
    const list = await page.evaluate(() => {
      const stage: any = (window as any).PithReader, article = document.createElement("article");
      article.innerHTML = stage.renderMarkdown("- Parent\n    - Child\n- Next"); document.body.append(article);
      const items = Array.from(article.querySelectorAll("li"));
      const texts = items.map(item => stage.proseTextNodes(item).map((node: Text) => node.data).join(""));
      const target = stage.visibleToolkitTarget(article, article, "lesson.md"); article.remove();
      return { texts, target };
    });
    assert.deepEqual(list.texts, ["Parent", "Child", "Next"]);
    assert.equal(list.target.quote, "Parent");
    await page.evaluate(async () => {
      const state: any = (window as any).task50 = { sent: [], opened: [], observations: ["obs-1"], conversation: [], notes: [{ id: "note-1", kind: "note", body: "笔记", anchor: { file: "lesson.md", locator: "text:line:1", quote: "原文位置" } }] };
      state.view = new (window as any).PithTest.PithWorkbenchView(document.getElementById("root"), {
        openFile: async (file: string) => state.opened.push(file), openToolkit() {}, selection() {},
        guideData: async () => ({ notes: state.notes, conversation: state.conversation, actions: [], toolkits: [], observations: state.observations }),
        sendGuide: async (text: string) => { state.sent.push(text); }, undoObservation: async (id: string) => { state.observations = state.observations.filter((item: string) => item !== id); },
      });
      document.querySelector(".pith-layout")!.append(state.view.guideElement()); state.view.setGuideVisible(true); state.view.render({ title: "讲义", currentFile: "lesson.md", files: [], sections: [], html: '<p data-locator="text:line:1" data-prose="true">原文位置</p>' }); await state.view.refreshGuide();
    });
    await page.evaluate(() => {
      const state = (window as any).task50;
      state.conversation = [{ id: "turn", status: "completed", startedAt: new Date().toISOString(), user: { text: "请走读并写讲义" }, choices: [], steps: [
        { kind: "reply", markdown: "先读取材料。" },
        { kind: "tool", name: "pith_read_material", callId: "read", inputPreview: "{}", status: "completed", effects: [] },
        { kind: "reply", markdown: "" },
        { kind: "tool", name: "pith_write_lesson", callId: "write", inputPreview: "{}", status: "completed", effects: [] },
        { kind: "reply", markdown: " \n\t " },
        { kind: "tool", name: "pith_read_lesson", callId: "check", inputPreview: "{}", status: "completed", effects: [] },
        { kind: "reply", markdown: "  讲义已完成。\n" },
      ] }];
      state.view.updateGuideTurn(state.conversation[0]);
    });
    assert.equal(await page.locator(".pith-guide-process").count(), 3);
    assert.equal(await page.locator(".pith-guide-reply").count(), 2);
    assert.deepEqual(await page.locator("[data-guide-copy]").evaluateAll((nodes: Element[]) => nodes.map(node => node.getAttribute("data-guide-copy-index"))), ["0", "6"]);
    await page.locator('[data-guide-copy-index="6"]').click();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), "  讲义已完成。\n");
    await page.evaluate(() => {
      const state = (window as any).task50;
      const tool = (callId: string, status: string, effects: unknown[] = []) => ({ kind: "tool", name: "pith_settle_topic", callId, inputPreview: "{}", status, summary: status === "failed" ? "结题部分写入失败" : "", effects });
      state.conversation = [{ id: "turn", status: "completed", startedAt: new Date().toISOString(), user: { text: "请结题" }, choices: [], steps: [
        tool("failed", "failed", [{ kind: "observation", observationId: "obs-1", text: "熟悉依赖注入" }]),
        tool("retry", "completed"), { kind: "reply", markdown: "已重试。" },
        tool("separate-failure", "failed"), { kind: "reply", markdown: "再试一次。" }, tool("separate-success", "completed"),
      ] }];
      state.view.updateGuideTurn(state.conversation[0]);
    });
    const summaries = page.locator(".pith-guide-process > summary");
    assert.deepEqual(await summaries.allTextContents(), ["含失败 · 2 个工具步骤 · 失败 1 次", "含失败 · 1 个工具步骤 · 失败 1 次", "已完成 · 1 个工具步骤"]);
    assert.equal(await page.locator(".pith-guide-process[open]").count(), 0);
    assert.equal(await page.locator('[data-guide-undo="obs-1"]').isVisible(), true);
    if (process.env.PITH_SUMMARY_SCREENSHOT) await page.screenshot({ path: process.env.PITH_SUMMARY_SCREENSHOT });
    await summaries.first().click();
    assert.match(await page.locator('.pith-guide-step[data-step-status="failed"]').first().textContent(), /结题部分写入失败.*失败/);
    await page.evaluate(() => {
      const state = (window as any).task50;
      state.conversation = [{ id: "turn", status: "running", startedAt: new Date().toISOString(), user: { text: "继续" }, choices: [], steps: [
        { kind: "tool", name: "pith_settle_topic", callId: "f", inputPreview: "{}", status: "failed", effects: [] },
        { kind: "tool", name: "pith_settle_topic", callId: "r", inputPreview: "{}", status: "running", effects: [] },
      ] }];
      state.view.updateGuideTurn(state.conversation[0]);
    });
    assert.equal(await summaries.first().textContent(), "进行中 · 2 个工具步骤 · 失败 1 次");
    await page.evaluate(() => { const state = (window as any).task50; state.conversation[0].status = "stopped"; state.view.updateGuideTurn(state.conversation[0]); });
    assert.equal(await summaries.first().textContent(), "未完成 · 2 个工具步骤 · 失败 1 次");
    await page.evaluate(() => { const state = (window as any).task50; state.conversation[0].steps = [{ kind: "thought", text: "思考" }]; state.view.updateGuideTurn(state.conversation[0]); });
    assert.equal(await summaries.first().textContent(), "过程 · 思考");
    const publish = (status: string, extra = "") => page.evaluate(({ status, extra }: { status: string; extra: string }) => {
      const state = (window as any).task50;
      state.conversation = [{ id: "turn", status, startedAt: new Date(Date.now() - 5000).toISOString(), user: { text: "我的问题" }, choices: [], ...(status === "failed" ? { error: "实际故障" } : {}), steps: [
        { kind: "thought", text: "思考内容" },
        { kind: "tool", name: "pith_settle_topic", callId: "1", inputPreview: "{}", status: status === "running" ? "running" : "completed", effects: [{ kind: "lesson", fileName: "01.md" }, { kind: "note", noteId: "note-1" }, { kind: "observation", observationId: "obs-1", text: "熟悉依赖注入" }] },
        { kind: "reply", markdown: `# 标题\n- [安全](https://example.com)\n- [危险](javascript:alert)\n\n${extra}` },
      ] }];
      state.view.updateGuideTurn(state.conversation[0]);
    }, { status, extra });
    await publish("running");
    assert.match(await page.locator('[role="status"]').last().textContent(), /结题.*已用/);
    assert.equal(await page.locator(".pith-guide-process").evaluate((el: HTMLDetailsElement) => el.open), true);
    assert.equal(await page.locator(".pith-guide-thought").evaluate((el: HTMLDetailsElement) => el.open), false);
    assert.equal(await page.locator(".pith-guide-reply a").count(), 1);
    assert.equal(await page.locator(".pith-guide-reply a").getAttribute("href"), "https://example.com");
    await publish("completed");
    assert.equal(await page.locator(".pith-guide-process").evaluate((el: HTMLDetailsElement) => el.open), false);
    assert.equal(await page.locator(".pith-guide-process > summary").getAttribute("aria-expanded"), "false");
    assert.equal(await page.locator(".pith-guide-observation").isVisible(), true);
    await page.locator("[data-guide-copy]").click();
    assert.match(await page.evaluate(() => navigator.clipboard.readText()), /^# 标题\n- \[安全\]/);
    await page.locator(".pith-guide-process > summary").click();
    await page.waitForFunction(() => document.querySelector(".pith-guide-process > summary")?.getAttribute("aria-expanded") === "true");
    await page.evaluate(() => { const mark = document.querySelector<HTMLElement>('mark[data-pith-note="note-1"]')!; mark.scrollIntoView = () => { (window as any).task50.jumped = true; }; });
    await page.locator('[data-note-id="note-1"]').click();
    assert.equal(await page.evaluate(() => (window as any).task50.jumped), true);
    await page.locator('[data-guide-lesson="01.md"]').click();
    assert.deepEqual(await page.evaluate(() => (window as any).task50.opened), ["01.md"]);
    await page.locator('[data-guide-undo="obs-1"]').click();
    await page.locator(".pith-guide-observation").getByText("已撤销").waitFor();
    await publish("failed"); assert.match(await page.locator(".pith-guide-failure").textContent(), /实际故障/); assert.equal(await page.locator(".pith-guide-process").evaluate((el: HTMLDetailsElement) => el.open), true);
    await publish("stopped"); assert.match(await page.locator(".pith-guide-stopped").textContent(), /已停止/);
    await publish("running", "long text ".repeat(800));
    const content = page.locator(".pith-guide-content"); await content.evaluate((node: HTMLElement) => { node.scrollTop = 20; node.dispatchEvent(new Event("scroll")); });
    await publish("running", "long text ".repeat(900));
    assert.ok(await content.evaluate((node: HTMLElement) => node.scrollTop) < 100);
    assert.equal(await page.locator("[data-guide-bottom]").isVisible(), true);
    const input = page.locator(".pith-guide textarea"); await input.fill("组字");
    await input.evaluate((node: HTMLTextAreaElement) => { (window as any).compositionInput = node; node.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true })); });
    await publish("running", "long text ".repeat(901));
    assert.equal(await input.evaluate((node: HTMLTextAreaElement) => node === (window as any).compositionInput && document.activeElement === node && node.value === "组字"), true);
    await input.dispatchEvent("keydown", { key: "Enter", isComposing: true });
    assert.deepEqual(await page.evaluate(() => (window as any).task50.sent), []);
  } finally { if (browser) await browser.close(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); await rm(dir, { recursive: true, force: true }); }
});
