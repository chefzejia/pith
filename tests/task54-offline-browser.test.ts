import assert from "node:assert/strict";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { build } from "esbuild";
import { DefaultAttentionEngine, DefaultWorkspaceStore, type AgentProcessPort } from "../src/core/index.ts";
import { createPithWebServer } from "../src/shells/web/server.ts";
import { NodeWorkspaceStorage } from "../src/shells/web/nodeStorage.ts";
import { nativeWorkbenchFixture } from "./native-workbench-fixture.ts";
import { testSandbox } from "./sandbox.ts";

const unavailable = !process.env.PITH_PLAYWRIGHT_MODULE || !process.env.PITH_CHROME_PATH;

for (const host of ["web", "obsidian"] as const) test(`${host} keeps offline topic gates and drafts current while reading and notes remain available`, { skip: unavailable, timeout: 60000 }, async () => {
  const root = await testSandbox("task54-browser-"), workspace = join(root, "workspace"); await mkdir(workspace);
  const storage = new NodeWorkspaceStorage(workspace), store = new DefaultWorkspaceStore(storage);
  const material = await store.importMaterial({ title: "离线材料", kind: "article", aids: [], files: [{ name: "reading.md", mimeType: "text/markdown", bytes: new TextEncoder().encode("# 离线材料\n\n离线阅读仍然可以核对原文和记录笔记。") }] });
  const topic = await store.createTopic({ title: "课题可用性", target: "核对传播链", materialIds: [material.id], toolkits: [] });
  await store.writeLesson(topic.id, "00-课程大纲.md", "# 课程大纲\n- [01-第一讲.md] 第一讲\n- [02-第二讲.md] 第二讲");
  await store.writeLesson(topic.id, "01-第一讲.md", "# 已存讲义\n\n已有内容始终可读。");
  const seed = new DefaultAttentionEngine(store, storage, () => ({ async run(input, options) {
    if (input.text === "失败样本") return { status: "failed", error: "受控失败，供重试入口使用" };
    options.onStep({ kind: "reply", markdown: "可以继续核对已有讲义。" }, 0);
    options.onChoices(["总结沉淀", "继续提问"]); return { status: "completed" };
  } }));
  await seed.runTurn({ topicId: topic.id, text: "失败样本" });
  await seed.runTurn({ topicId: topic.id, text: "已有历史" });
  const conversationPath = `topics/${topic.id}/conversation.json`, before = await storage.readText(conversationPath);
  let prompts = 0;
  const processPort: AgentProcessPort = {
    findExecutable: async command => command === "dsh" ? "/controlled/dsh" : null,
    probeExecutable: async (_path, args) => args.includes("--help") ? "Agent Client Protocol ACP" : "dsh 1.0",
    async spawnStdio() {
      let listener: ((line: string) => void) | undefined;
      let topicSession = false;
      return {
        cwd: workspace,
        onLine(callback) { listener = callback; return () => { listener = undefined; }; },
        writeLine(line) {
          const request = JSON.parse(line); if (request.id === undefined) return;
          if (request.method === "session/new") topicSession = request.params.mcpServers.length > 0;
          if (request.method === "session/prompt" && topicSession) prompts++;
          const result = request.method === "initialize" ? { agentCapabilities: { mcpCapabilities: { http: true } } } : request.method === "session/new" ? { sessionId: "task54" } : request.method === "session/prompt" ? { text: "受控 ACP 已回应" } : {};
          listener?.(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }));
        },
        async close() {},
      };
    },
  };
  // No provider is injected into either host: their explicit offline selection is real.
  const server = host === "web" ? await createPithWebServer({ workspaceDir: workspace, processPort }) : undefined;
  let browser: any, page: any;
  try {
    const { chromium } = await import(process.env.PITH_PLAYWRIGHT_MODULE!);
    browser = await chromium.launchPersistentContext(join(root, "profile"), { executablePath: process.env.PITH_CHROME_PATH, headless: true, viewport: { width: 1280, height: 850 } });
    page = await browser.newPage(); page.setDefaultTimeout(8000);
    let posts = 0;
    page.on("request", (request: any) => { if (request.method() === "POST" && new URL(request.url()).pathname === "/api/chat") posts++; });
    if (server) { const address = server.address(); assert.ok(address && typeof address !== "string"); await page.goto(`http://127.0.0.1:${address.port}`); }
    else await nativeWorkbenchFixture(page, workspace, false, { agentProcess: true });
    await page.locator(`[data-topic="${topic.id}"]`).first().click(); await page.locator(".pith-guide-toggle").click();
    const input = page.locator(".pith-guide textarea"), send = page.locator("[data-guide-send]"), reason = page.locator("[data-guide-error]");
    const disabled = async () => {
      await page.locator(".pith-guide-content").getByText("可以继续核对已有讲义。").waitFor();
      assert.equal(await send.isDisabled(), true, "offline send"); assert.equal(await input.isDisabled(), true, "offline input"); assert.match(await reason.textContent(), /向导未连接/);
      for (const selector of ["[data-guide-choice]", "[data-guide-retry]", ".pith-quick-actions button", '[data-selection="ask"]', "[data-planned-lesson]"]) {
        assert.equal(await page.locator(selector).evaluateAll((buttons: HTMLButtonElement[]) => buttons.every(button => button.disabled)), true, selector);
      }
    };
    await disabled();
    assert.equal(await page.locator("[data-guide-choice]").count(), 2);
    assert.equal(await page.locator("[data-guide-retry]").count(), 1);
    assert.equal(await page.locator('[data-selection="ask"]').count(), 1);
    assert.equal(await page.locator('[data-planned-lesson]').count(), 1);
    await input.evaluate((node: HTMLTextAreaElement) => { node.disabled = false; node.value = "必须保留的草稿"; (window as any).task54Input = node; });
    await send.evaluate((node: HTMLButtonElement) => { node.disabled = false; node.click(); });
    await page.locator("[data-guide-choice]").first().evaluate((node: HTMLButtonElement) => { node.disabled = false; node.click(); });
    assert.equal(await input.inputValue(), "必须保留的草稿");
    assert.equal(posts, 0); assert.equal(await storage.readText(conversationPath), before);
    if (host === "obsidian") {
      const result = await page.evaluate(async () => {
        const view = (window as any).nativeTask52.view.view; let calls = 0, error = "";
        try { await view.guideTurn("规划或费曼追问", async () => { calls++; }); } catch (cause) { error = String(cause); }
        return { calls, error };
      });
      assert.equal(result.calls, 0); assert.match(result.error, /向导未连接/);
    }
    const select = async (agentId: "" | "dsh") => {
      if (host === "web") {
        await page.locator('[data-command="settings"],[data-home-settings]').click(); await page.locator("#simple-agent").selectOption(agentId);
        await page.locator("#simple-status").getByText("设置已保存", { exact: true }).waitFor();
        await page.locator("#close-drawer").click();
      } else await page.evaluate(async (agentId: string) => { const controller = (window as any).nativeTask52.controller; await controller.setAgentConfig({ ...controller.getAgentConfig(), agentId }); }, agentId);
    };
    await select("dsh");
    assert.equal(await input.isDisabled(), false); assert.equal(await send.isDisabled(), false); assert.equal(await reason.textContent(), "");
    assert.equal(await input.evaluate((node: HTMLTextAreaElement) => node === (window as any).task54Input), true);
    assert.equal(await input.inputValue(), "必须保留的草稿");
    await input.fill("在线草稿"); await select(""); await disabled(); assert.equal(await input.inputValue(), "在线草稿");
    await page.locator('[data-guide-tab="notes"]').click(); assert.equal(await input.isDisabled(), false);
    await input.fill("离线课题笔记"); await send.click(); await page.locator(".pith-guide-content").getByText("离线课题笔记").waitFor();
    if (host === "web" && process.env.PITH_TASK54_CAPTURE_DIR) await page.screenshot({ path: join(process.env.PITH_TASK54_CAPTURE_DIR, "web-offline-notes.png") });
    assert.equal((await store.getTopic(topic.id))?.notes.at(-1)?.body, "离线课题笔记");
    assert.equal(await storage.readText(conversationPath), before);
    await page.locator('[data-guide-tab="chat"]').click(); await disabled();
    await select("dsh");
    if (host === "web") {
      await input.fill("明确恢复发送"); await send.click(); await page.locator(".pith-guide-reply").getByText("受控 ACP 已回应").waitFor();
      assert.equal(prompts, 1); assert.equal(posts, 1);
    } else {
      const value = await page.evaluate(async () => { const view = (window as any).nativeTask52.view.view; return view.guideTurn("公共入口在线对照", async () => "callback ran"); });
      assert.equal(value, "callback ran");
    }
    await select(""); await disabled();
    await page.locator('[data-command="home"]').click();
    await page.locator(".pith-topic-more summary").first().click(); await page.locator(`[data-shelve="${topic.id}"]`).click();
    await page.locator(".pith-shelved summary").click(); await page.locator(`[data-restore="${topic.id}"]`).click();
    await page.locator(`[data-topic="${topic.id}"]`).first().click();
    await page.locator(".pith-guide").waitFor({ state: "visible" });
    await disabled();
    if (process.env.PITH_TASK54_CAPTURE_DIR) await page.screenshot({ path: join(process.env.PITH_TASK54_CAPTURE_DIR, `${host}-offline-reopened.png`) });
    await page.locator('[data-command="home"]').click();
    const intake = page.locator('.pith-intake-box [name="title"]'), submit = page.locator('[data-intake-open]');
    const checkIntake = async () => {
      await intake.fill("保留立项目标");
      assert.equal(await submit.isDisabled(), true, "offline intake");
      await intake.evaluate((node: HTMLInputElement) => { (window as any).task54Intake = node; });
      await select("dsh"); assert.equal(await submit.count(), 1, "settings preserve intake form"); assert.equal(await submit.isDisabled(), false, "online intake");
      await select(""); assert.equal(await submit.count(), 1, "settings preserve intake form"); assert.equal(await submit.isDisabled(), true, "offline intake after settings");
      assert.equal(await intake.inputValue(), "保留立项目标");
      assert.equal(await intake.evaluate((node: HTMLInputElement) => node === (window as any).task54Intake), true);
    };
    await checkIntake();
    await page.locator(`[data-material="${material.id}"]`).click();
    await page.locator('.pith-article h1').getByText("离线材料", { exact: true }).waitFor();
    await page.locator('[data-command="intake"]').click();
    await checkIntake();
  } finally {
    if (host === "obsidian" && page) await page.evaluate(async () => { const state = (window as any).nativeTask52; if (state) { await state.view.onClose(); state.controller.dispose(); } }).catch(() => {});
    if (browser) await browser.close();
    if (server) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await rm(root, { recursive: true, force: true });
  }
});

test("shared View gates offline callbacks even when disabled controls are forced and keeps stop and notes", { skip: unavailable, timeout: 30000 }, async () => {
  const root = await testSandbox("task54-view-"), { chromium } = await import(process.env.PITH_PLAYWRIGHT_MODULE!);
  let browser: any;
  try {
    const bundle = await build({ entryPoints: ["src/workbench/view.ts"], bundle: true, write: false, platform: "browser", format: "iife", globalName: "Task54UI" });
    browser = await chromium.launchPersistentContext(join(root, "profile"), { executablePath: process.env.PITH_CHROME_PATH, headless: true });
    const page = await browser.newPage(); page.setDefaultTimeout(5000);
    await page.setContent('<div id="root" style="height:100vh"></div>'); await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
    // View actions are the host boundary; the renderer, event handlers and turn lifecycle are real.
    await page.evaluate(async () => {
      const w = window as any, calls = { send: 0, note: 0, retry: 0, lesson: 0, common: 0, stop: 0 };
      const data = { notes: [], toolkits: [], actions: [{ label: "总结沉淀", prompt: "总结沉淀" }], conversation: [
        { id: "failed", status: "failed", user: { text: "失败问题" }, startedAt: "2026-11-16T00:00:00Z", endedAt: "2026-11-16T00:00:01Z", steps: [], choices: [], error: "受控失败" },
        { id: "choices", status: "completed", user: { text: "历史问题" }, startedAt: "2026-11-16T00:00:02Z", endedAt: "2026-11-16T00:00:03Z", steps: [], choices: ["总结沉淀", "继续提问"] },
      ] };
      const view = w.Task54UI.mountPithWorkbench(document.getElementById("root"), {
        guideAvailable: false, openFile() {}, openToolkit() {}, selection() {}, guideData: async () => data,
        sendGuide: async (_text: string, _anchor: unknown, note: boolean) => { if (note) calls.note++; else calls.send++; },
        retryGuide: async () => { calls.retry++; }, generateLesson: async () => { calls.lesson++; },
        stopGuide: async () => { calls.stop++; w.task54.finish("stopped"); },
      });
      view.setGuideAvailable(false);
      const prematureCompose = Boolean(view.guideElement().querySelector('.pith-guide-compose'));
      view.render({ title: "共享可用性", html: "<p>保留原文和已有记录</p>", currentFile: "saved.md", files: [{ name: "saved.md" }], sections: [], curriculum: [{ fileName: "saved.md", title: "已有讲义", status: "ready" }, { fileName: "next.md", title: "待生成讲义", status: "planned" }] });
      view.setGuideVisible(true); await view.refreshGuide();
      w.task54 = { view, data, calls, prematureCompose, anchor: { source: { kind: "lesson" }, file: "saved.md", locator: "text:offset:0", quote: "保留原文" } };
    });
    const input = page.locator('.pith-guide textarea'), send = page.locator('[data-guide-send]');
    const force = (selector: string) => page.locator(selector).first().evaluate((node: HTMLButtonElement) => { node.disabled = false; node.click(); });
    assert.equal(await page.evaluate(() => (window as any).task54.prematureCompose), false, "availability must not render guide before its first data refresh");
    assert.equal(await input.isDisabled(), true); assert.equal(await send.isDisabled(), true);
    assert.match(await page.locator('[data-guide-error]').textContent(), /向导未连接/);
    for (const selector of ['[data-guide-choice]', '[data-guide-retry]', '[data-selection="ask"]', '[data-planned-lesson]']) {
      assert.ok(await page.locator(selector).count(), `missing ${selector}`);
      assert.equal(await page.locator(selector).evaluateAll((nodes: HTMLButtonElement[]) => nodes.every(node => node.disabled)), true, selector);
    }
    await input.evaluate((node: HTMLTextAreaElement) => { node.disabled = false; node.value = "保留草稿"; });
    await force('[data-guide-send]'); assert.equal(await input.inputValue(), "保留草稿", "forced offline send preserves draft");
    await force('[data-guide-choice]'); assert.equal(await input.inputValue(), "保留草稿", "forced offline choice preserves draft");
    await force('[data-guide-retry]'); await force('[data-planned-lesson]');
    await page.evaluate(() => { const s = (window as any).task54; s.view.quoteSelection(s.anchor, "chat"); });
    assert.equal(await page.locator('.pith-guide-compose blockquote').textContent(), "", "offline quoted question");
    const offline = await page.evaluate(async () => {
      const s = (window as any).task54; let error = "";
      try { await s.view.guideTurn("公共追问", async () => { s.calls.common++; }); } catch (cause) { error = String(cause); }
      return { calls: s.calls, error };
    });
    assert.deepEqual(offline.calls, { send: 0, note: 0, retry: 0, lesson: 0, common: 0, stop: 0 }); assert.match(offline.error, /向导未连接/);
    await page.evaluate(async () => { const s = (window as any).task54; s.data.conversation[1].choices = []; await s.view.refreshGuide(); });
    const quick = page.locator('.pith-quick-actions button');
    assert.equal(await quick.count(), 1); assert.equal(await quick.isDisabled(), true, "offline quick action");
    await force('.pith-quick-actions button'); assert.equal(await input.inputValue(), "保留草稿");
    await page.evaluate(() => { const s = (window as any).task54; s.view.setGuideAvailable(true); });
    assert.equal(await input.isDisabled(), false); assert.equal(await send.isDisabled(), false); assert.equal(await quick.isDisabled(), false);
    assert.equal(await page.locator('[data-guide-error]').textContent(), "");
    await input.fill("设置切换时保留草稿");
    await page.evaluate(() => (window as any).task54.view.setGuideAvailable(false));
    assert.equal(await send.isDisabled(), true, "idle compose becomes offline"); assert.equal(await input.isDisabled(), true);
    assert.equal(await input.inputValue(), "设置切换时保留草稿");
    await page.evaluate(() => (window as any).task54.view.setGuideAvailable(true));
    await quick.click(); assert.equal(await input.inputValue(), "总结沉淀"); await send.click();
    await page.waitForFunction(() => (window as any).task54.calls.send === 1 && !document.querySelector('[data-guide-stop]'));
    await page.locator('[data-guide-retry]').click();
    await page.waitForFunction(() => (window as any).task54.calls.retry === 1 && !document.querySelector('[data-guide-stop]'));
    await page.evaluate(() => {
      const s = (window as any).task54;
      s.running = s.view.guideTurn("在途问题", () => new Promise(resolve => { s.finish = resolve; }));
      s.view.setGuideAvailable(false);
    });
    assert.equal(await page.locator('[data-guide-stop]').isEnabled(), true); await page.locator('[data-guide-stop]').click();
    assert.equal(await page.evaluate(() => (window as any).task54.running), "stopped");
    assert.equal(await send.isDisabled(), true, "reused compose offline send"); assert.equal(await input.isDisabled(), true, "reused compose offline input");
    await page.evaluate(() => { const s = (window as any).task54; s.view.quoteSelection(s.anchor, "notes"); });
    assert.equal(await input.isDisabled(), false); assert.match(await page.locator('.pith-guide-compose blockquote').textContent(), /保留原文/);
    await input.fill("离线笔记"); await send.click();
    await page.waitForFunction(() => (window as any).task54.calls.note === 1);
    assert.deepEqual(await page.evaluate(() => (window as any).task54.calls), { send: 1, note: 1, retry: 1, lesson: 0, common: 0, stop: 1 });
  } finally {
    if (browser) { await Promise.all(browser.pages().map((page: any) => page.evaluate(() => (window as any).task54?.view.dispose()).catch(() => {}))); await browser.close(); }
    await rm(root, { recursive: true, force: true });
  }
});
