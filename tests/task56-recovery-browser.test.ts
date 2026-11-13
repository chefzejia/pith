import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { DefaultWorkspaceStore, type GuideTurn } from "../src/core/index.ts";
import { NodeWorkspaceStorage } from "../src/shells/web/nodeStorage.ts";
import { createPithWebServer } from "../src/shells/web/server.ts";
import { testSandbox } from "./sandbox.ts";

test("reopened host shows interrupted tools and retry replaces the same user message", { timeout: 30000, skip: !process.env.PITH_PLAYWRIGHT_MODULE || !process.env.PITH_CHROME_PATH }, async () => {
  const root = await testSandbox("task56-browser-"), storage = new NodeWorkspaceStorage(root), store = new DefaultWorkspaceStore(storage);
  let server: Awaited<ReturnType<typeof createPithWebServer>> | undefined, browser: any;
  try {
    await store.ensureScaffold(); const topic = await store.createTopic({ title: "中断恢复", target: "验证工具结果和回合重试", materialIds: [], toolkits: [] });
    await store.writeLesson(topic.id, "01-恢复验证.md", "# 中断后的恢复\n\n已有写入保留，结果未确认的工具可以核对后重试。\n");
    const prior: GuideTurn = { id: "interrupted", status: "running", startedAt: "2026-11-13T00:00:00Z", user: { text: "读取材料并保存学习记录" }, choices: [], steps: [
      { kind: "reply", markdown: "已保存的学习记录会保留。" },
      { kind: "tool", callId: "saved", name: "pith_save_note", status: "completed", inputPreview: "{}", effects: [] },
      { kind: "tool", callId: "lost", name: "读取材料", status: "running", inputPreview: "{}", effects: [] },
    ] };
    await storage.writeText(`topics/${topic.id}/conversation.json`, JSON.stringify([prior]));
    let prompts = 0;
    server = await createPithWebServer({ workspaceDir: root, guideProvider: { async run(input, options) { prompts++; assert.equal(input.text, prior.user.text); options.onStep({ kind: "reply", markdown: "重新请求完成，学习记录已核对。" }, 0); return { status: "completed" }; } } });
    const address = server.address(); assert.ok(address && typeof address !== "string"); const base = `http://127.0.0.1:${address.port}`;
    const { chromium } = await import(process.env.PITH_PLAYWRIGHT_MODULE!);
    browser = await chromium.launchPersistentContext(join(root, "profile"), { executablePath: process.env.PITH_CHROME_PATH, headless: true, viewport: { width: 1400, height: 900 } });
    const page = await browser.newPage(); page.setDefaultTimeout(5000);
    const errors: string[] = []; page.on("pageerror", (error: Error) => errors.push(error.message));
    await page.goto(base); await page.locator(`[data-topic="${topic.id}"]`).first().click();
    if (!await page.locator(".pith-guide textarea").isVisible()) await page.locator(".pith-guide-toggle").click();
    await page.locator(".pith-guide-stopped").waitFor();
    assert.equal(await page.locator('[data-step-status="running"]').count(), 0);
    assert.match(await page.locator('[data-step-status="failed"]').textContent(), /进程中断/);
    if (process.env.PITH_TASK56_SCREENSHOT) await page.screenshot({ path: process.env.PITH_TASK56_SCREENSHOT });
    await page.locator('[data-guide-retry="interrupted"]').click();
    await page.getByText("重新请求完成，学习记录已核对。", { exact: true }).waitFor();
    const turns = await (await fetch(`${base}/api/chat?topicId=${topic.id}`)).json() as GuideTurn[];
    assert.equal(turns.length, 1); assert.equal(turns[0]!.id, prior.id); assert.equal(turns[0]!.status, "completed"); assert.equal(prompts, 1);
    assert.deepEqual(errors, []);
  } finally {
    if (browser) await browser.close();
    if (server) await new Promise<void>((resolve, reject) => { server!.close(error => error ? reject(error) : resolve()); server!.closeAllConnections(); });
    await rm(root, { recursive: true, force: true });
  }
});
