import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { build } from "esbuild";
import type { GuideProvider } from "../src/core/index.ts";
import { createPithWebServer } from "../src/shells/web/server.ts";
import { testSandbox } from "./sandbox.ts";

const browserUnavailable = !process.env.PITH_PLAYWRIGHT_MODULE || !process.env.PITH_CHROME_PATH;
const reply = "受控向导回复\n\n| 项目 | 文件说明 | 运行行为 |\n| --- | --- | --- |\n| 性质 | 文档说明接口边界和数据流 | 实际执行队列和状态变化 |";
const choices = [
  "我回答检验卡 1 和 2，你据此诊断我对 falsy 边界与错误来源的把握",
  "生成第二讲《02-公开接口契约.md》：三个导出函数的输入/返回值/失败模式，落点精确到 path:line",
  "做一个 10 分钟微实验：在临时 .mjs 里跑 handleRequest({}) vs handleRequest() 与 enqueue(undefined)，对照本轮预测",
  "把入口校验前置到 enqueue 的方案写成最小改造清单（含 2 个测试意图），不写代码",
];
const closeServer = (server: Server) => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
const occurrences = (locator: any, text: string): Promise<number> => locator.evaluate((node: HTMLElement, needle: string) => (node.textContent ?? "").split(needle).length - 1, text);

async function assertTableScrolls(page: any, selector: string): Promise<void> {
  const table = page.locator(`${selector} .pith-guide-reply table`).first();
  const layout = await table.evaluate((element: HTMLElement) => {
    const container = element.closest<HTMLElement>(".pith-guide-content")!;
    element.scrollLeft = element.scrollWidth;
    return { width: element.clientWidth, contentWidth: element.scrollWidth, scrollLeft: element.scrollLeft, containerWidth: container.clientWidth,
      columns: Array.from(element.querySelectorAll("th"), cell => cell.getBoundingClientRect().width) };
  });
  assert.equal(layout.columns.length, 3);
  assert.ok(layout.columns.every((width: number) => width >= 100), JSON.stringify(layout));
  assert.ok(layout.width <= layout.containerWidth && layout.contentWidth > layout.width && layout.scrollLeft > 0, JSON.stringify(layout));
}

async function assertChoicesFit(page: any, selector: string): Promise<void> {
  const buttons = page.locator(`${selector} .pith-choice-btn`);
  await page.waitForFunction(({ container, count }: { container: string; count: number }) => document.querySelectorAll(`${container} .pith-choice-btn`).length === count, { container: selector, count: choices.length });
  assert.equal(await buttons.count(), choices.length);
  const layout = await buttons.evaluateAll((elements: HTMLElement[]) => elements.map((element, index) => {
    const rect = element.getBoundingClientRect(), next = elements[index + 1]?.getBoundingClientRect();
    return { text: element.textContent, height: rect.height, clientHeight: element.clientHeight, scrollHeight: element.scrollHeight,
      clientWidth: element.clientWidth, scrollWidth: element.scrollWidth, bottom: rect.bottom, nextTop: next?.top };
  }));
  for (const [index, item] of layout.entries()) {
    assert.match(item.text, new RegExp(choices[index]!.slice(0, 6)));
    assert.ok(item.height > 30, JSON.stringify(item));
    assert.ok(item.scrollHeight <= item.clientHeight + 1, JSON.stringify(item));
    assert.ok(item.scrollWidth <= item.clientWidth + 1, JSON.stringify(item));
    if (item.nextTop !== undefined) assert.ok(item.bottom <= item.nextTop, JSON.stringify(item));
  }
}

test("Web shows one waiting guide turn with its message once and keeps a failure visible", { timeout: 60000, skip: browserUnavailable }, async () => {
  const dir = await testSandbox("pith-guide-turn-web-");
  await mkdir(join(dir, "workspace"));
  const received: string[] = [];
  let hold = false, failed = false, release: (() => void) | undefined, arrived: (() => void) | undefined;
  const provider: GuideProvider = { async run(input, options) {
    const text = input.text; received.push(text);
    if (hold) await new Promise<void>(resolve => { release = resolve; if (arrived) arrived(); });
    if (text.includes("触发故障") && !failed) { failed = true; throw new Error("受控向导故障"); }
    options.onStep({ kind: "reply", markdown: reply }, 0); options.onChoices(choices); return { status: "completed" };
  } };
  const server = await createPithWebServer({ workspaceDir: join(dir, "workspace"), guideProvider: provider });
  let browser: any;
  try {
    const address = server.address(); assert.ok(address && typeof address !== "string");
    const { chromium } = await import(process.env.PITH_PLAYWRIGHT_MODULE!);
    browser = await chromium.launch({ executablePath: process.env.PITH_CHROME_PATH, headless: true });
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 } }); page.setDefaultTimeout(8000);
    await page.goto(`http://127.0.0.1:${address.port}`);
    const held = (): Promise<void> => { hold = true; return new Promise<void>(resolve => { arrived = resolve; }); };
    const letGo = (): void => { const next = release; assert.ok(next, "a guide turn is waiting"); hold = false; release = undefined; next(); };
    const content = page.locator(".pith-guide-content"), pending = page.locator(".pith-guide-pending"), send = page.locator("[data-guide-send]"), error = page.locator("[data-guide-error]"), input = page.locator(".pith-guide textarea");
    const replies = (count: number) => page.waitForFunction((expected: number) => (document.querySelector(".pith-guide-content")?.textContent ?? "").split("受控向导回复").length - 1 === expected, count);

    let waiting = held();
    await page.locator('[name="title"]').fill("学习宿主边界"); await page.locator('[name="title"]').press("Enter");
    await waiting; await pending.waitFor();
    assert.match(await pending.textContent(), /向导正在回应/);
    assert.equal(await occurrences(content, "学习宿主边界"), 1);
    assert.equal(await page.locator("[data-guide-stop]").count(), 1);
    assert.equal(await page.locator(".pith-quick-actions").count(), 0);
    letGo(); await replies(1); await pending.waitFor({ state: "detached" });
    assert.equal(await pending.count(), 0);
    assert.equal(await occurrences(content, "学习宿主边界"), 1);
    await assertChoicesFit(page, ".pith-guide");
    await assertTableScrolls(page, ".pith-guide");
    await page.setViewportSize({ width: 390, height: 800 });
    await assertChoicesFit(page, ".pith-guide");
    await assertTableScrolls(page, ".pith-guide");
    await page.setViewportSize({ width: 1200, height: 800 });

    waiting = held();
    await input.fill("网页问题"); await send.click();
    await waiting; await pending.waitFor();
    assert.equal(await occurrences(content, "网页问题"), 1);
    assert.equal(await page.locator(".pith-choice-btn").count(), 0);
    assert.equal(await page.locator("[data-guide-stop]").count(), 1);
    assert.equal(await input.inputValue(), "");
    letGo(); await replies(2); await pending.waitFor({ state: "detached" });
    assert.equal(await pending.count(), 0);
    assert.equal(await occurrences(content, "网页问题"), 1);
    assert.equal(await send.isDisabled(), false);

    await input.fill("触发故障"); await send.click();
    await content.getByText("受控向导故障").waitFor();
    await pending.waitFor({ state: "detached" });
    assert.equal(await pending.count(), 0);
    await page.locator('[data-guide-tab="notes"]').click(); await page.locator('[data-guide-tab="chat"]').click();
    assert.match(await content.textContent(), /受控向导故障/);
    await page.locator("[data-guide-retry]").click(); await replies(3); await pending.waitFor({ state: "detached" });
    assert.equal(await occurrences(content, "触发故障"), 1); assert.equal(received.filter(item => item === "触发故障").length, 2);
    await input.fill("恢复提问"); await send.click(); await replies(4); await pending.waitFor({ state: "detached" });
    assert.equal(await error.textContent(), "");

    await page.locator('[data-guide-tab="notes"]').click();
    await input.fill("网页笔记"); await send.click();
    await page.waitForFunction(() => document.querySelector('[data-guide-tab="notes"]')?.textContent === "笔记 1");
    assert.equal(await pending.count(), 0);
    assert.equal(received.includes("网页笔记"), false);
    await page.locator('[data-guide-tab="chat"]').click();
    const previous = received.length;
    await page.locator(".pith-choice-btn").first().click();
    await page.waitForFunction((count: number) => (document.querySelector(".pith-guide-content")?.textContent ?? "").split("受控向导回复").length - 1 === count, 5);
    assert.equal(received[previous], choices[0]);
  } finally { if (browser) await browser.close(); if (release) release(); await closeServer(server); await rm(dir, { recursive: true, force: true }); }
});

test("Obsidian runs intake, chat and lessons as one visible guide turn at a time and captures notes without one", { timeout: 60000, skip: browserUnavailable }, async () => {
  const dir = await testSandbox("pith-guide-turn-native-");
  const origin = createServer((_request, response) => { response.writeHead(200, { "content-type": "text/html; charset=utf-8" }); response.end("<!doctype html><title>host</title>"); });
  await new Promise<void>(resolve => origin.listen(0, "127.0.0.1", resolve));
  let browser: any;
  try {
    const address = origin.address(); assert.ok(address && typeof address !== "string");
    const bundle = await build({ entryPoints: ["src/shells/obsidian/index.ts"], bundle: true, write: false, platform: "browser", format: "iife", globalName: "NativePith", external: ["node:*", "obsidian"] });
    const { chromium } = await import(process.env.PITH_PLAYWRIGHT_MODULE!);
    browser = await chromium.launchPersistentContext(join(dir, "profile"), { executablePath: process.env.PITH_CHROME_PATH, headless: true, viewport: { width: 1200, height: 800 } });
    const page = await browser.newPage(); page.setDefaultTimeout(8000);
    await page.goto(`http://127.0.0.1:${address.port}`);
    await page.setContent('<style>html,body{height:100%;margin:0}#root{height:100%;width:70%}#side{position:absolute;right:0;top:0;width:30%;height:100%}body{--background-primary:#fff;--background-secondary:#f1f3ef;--background-modifier-border:#ccd5cd;--background-modifier-hover:#e1e9e2;--text-normal:#222;--text-muted:#666;--font-interface:Arial}</style><div id="root"></div><div id="side"></div>');
    await page.evaluate(() => {
      (window as any).turn = { received: [], notices: [], hold: false, release: null, arrived: null, waiting: null };
      (window as any).require = (id: string) => id === "obsidian" ? { ItemView: class { contentEl: HTMLElement | null; constructor(leaf: any) { this.contentEl = leaf?.container || document.getElementById("root"); } }, Plugin: class {}, Notice: class { constructor(message: string) { (window as any).turn.notices.push(message); } } } : id === "node:util" ? { promisify: (fn: unknown) => fn } : id === "node:net" ? { BlockList: class { addSubnet() {} } } : {};
    });
    await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
    await page.evaluate(async ({ guideReply, guideChoices }: { guideReply: string; guideChoices: string[] }) => {
      const state: any = (window as any).turn, native: any = (window as any).NativePith;
      const data = new Map<string, Uint8Array>(), folders = new Set<string>(), encoder = new TextEncoder(), decoder = new TextDecoder();
      const storage = {
        exists: async (path: string) => data.has(path) || folders.has(path),
        readText: async (path: string) => { if (!data.has(path)) throw new Error("missing " + path); return decoder.decode(data.get(path)); },
        readBinary: async (path: string) => { const value = data.get(path); if (!value) throw new Error("missing " + path); return value; },
        writeText: async (path: string, text: string) => { data.set(path, encoder.encode(text)); },
        createText: async (path: string, text: string) => { if (data.has(path)) throw new Error("exists"); data.set(path, encoder.encode(text)); },
        writeBinary: async (path: string, bytes: Uint8Array) => { data.set(path, bytes); },
        createBinary: async (path: string, bytes: Uint8Array) => { if (data.has(path)) throw new Error("exists"); data.set(path, bytes); },
        processText: async (path: string, update: (text: string) => string) => { const result = update(decoder.decode(data.get(path))); data.set(path, encoder.encode(result)); return result; },
        mkdir: async (path: string) => { folders.add(path); },
        list: async (path: string) => [...folders, ...data.keys()].filter(item => item.startsWith(path + "/") && !item.slice(path.length + 1).includes("/")).map(item => ({ path: item, type: folders.has(item) ? "folder" : "file" })),
      };
      const host = { id: "obsidian", storage };
      let controller: any;
      const provider = { async run({ scope, text }: any, options: any) {
        const topicId = scope.topicId; state.received.push(text);
        if (state.hold) await new Promise<void>(resolve => { state.release = resolve; if (state.arrived) state.arrived(); });
        if (text.includes("触发故障")) throw new Error("受控向导故障");
        if (text.includes("生成《00-课程大纲.md》")) {
          const material = await controller.store.importMaterial({ title: "课程", kind: "article", files: [] });
          await controller.store.updateTopic(topicId, { materialId: material.id });
          await controller.store.writeGeneratedFile(material.id, "00-课程大纲.md", "# 课程大纲\n- [01-第一讲.md] 第一讲\n- [02-第二讲.md] 第二讲\n- [03-第三讲.md] 第三讲");
          await controller.store.writeGeneratedFile(material.id, "01-第一讲.md", "# 第一讲\n\n第一讲正文。");
        }
        const lesson = /《(0[23]-[^》]+\.md)》/.exec(text);
        if (lesson) { const topic = await controller.store.getTopic(topicId); await controller.store.writeGeneratedFile(topic.materialId, lesson[1], `# ${lesson[1]}\n\n${lesson[1]} 的正文。`); }
        options.onStep({ kind: "reply", markdown: guideReply }, 0); options.onChoices(guideChoices); return { status: "completed" };
      } };
      controller = new native.PithObsidianController(host, undefined, provider); await controller.initialize();
      const leaf: any = { container: document.getElementById("side"), detach() {}, async setViewState() { this.view = new native.PithGuideView(this); } };
      const workspace = { rightSplit: { expand() {}, collapse() {} }, getRightLeaf: () => leaf, getLeavesOfType: () => leaf.view ? [leaf] : [], revealLeaf: async () => {} };
      state.controller = controller; state.workspaceView = new native.PithWorkspaceView({}, controller, host, workspace);
      await state.workspaceView.onOpen();
    }, { guideReply: reply, guideChoices: choices });
    const hold = (): Promise<void> => page.evaluate(() => { const state = (window as any).turn; state.hold = true; state.waiting = new Promise<void>(resolve => { state.arrived = resolve; }); });
    const arrived = (): Promise<void> => page.evaluate(() => (window as any).turn.waiting);
    const letGo = (): Promise<void> => page.evaluate(() => { const state = (window as any).turn, next = state.release; if (!next) throw new Error("no guide turn is waiting"); state.hold = false; state.release = null; next(); });
    const refresh = (): Promise<void> => page.evaluate(() => (window as any).turn.workspaceView.view.refreshGuide());
    const ledger = (): Promise<{ received: number; entries: number; notes: [string, string][] }> => page.evaluate(async () => { const state = (window as any).turn, topic = (await state.controller.store.listTopics())[0]; return { received: state.received.length, entries: (await state.controller.engine.getConversation(topic.id)).length, notes: topic.notes.map((note: any) => [note.kind, note.body]) }; });
    const content = page.locator("#side .pith-guide-content"), pending = page.locator("#side .pith-guide-pending"), send = page.locator("#side [data-guide-send]"), error = page.locator("#side [data-guide-error]"), input = page.locator("#side textarea"), article = page.locator(".pith-article");
    const replies = (count: number) => page.waitForFunction((expected: number) => (document.querySelector("#side .pith-guide-content")?.textContent ?? "").split("受控向导回复").length - 1 === expected, count);

    await hold();
    await page.locator('[name="title"]').fill("学习宿主边界"); await page.locator("[data-intake-open]").click();
    await arrived(); await pending.waitFor();
    assert.match(await pending.textContent(), /向导正在回应/);
    assert.equal(await occurrences(content, "学习宿主边界"), 1);
    assert.equal(await page.locator("#side [data-guide-stop]").count(), 1);
    await refresh();
    assert.equal(await occurrences(content, "学习宿主边界"), 1, "a refresh during the turn shows the stored message once");
    assert.equal(await pending.count(), 1);
    assert.equal(await page.locator("#side [data-guide-stop]").count(), 1);
    await letGo(); await replies(1);
    await article.getByText("课程大纲").first().waitFor();
    assert.equal(await pending.count(), 0);
    await page.addStyleTag({ content: "button { height: 30px; }" });
    await assertChoicesFit(page, "#side .pith-guide");
    await assertTableScrolls(page, "#side .pith-guide");
    await page.locator("#side").evaluate((element: HTMLElement) => { element.style.width = "220px"; });
    await assertChoicesFit(page, "#side .pith-guide");
    await assertTableScrolls(page, "#side .pith-guide");
    await page.locator("#side").evaluate((element: HTMLElement) => { element.style.width = "30%"; });
    await page.waitForFunction(() => !(document.querySelector("#side [data-guide-send]") as HTMLButtonElement).disabled);

    await input.fill("触发故障"); await send.click();
    await content.getByText("受控向导故障").waitFor();
    assert.equal(await input.inputValue(), "");
    assert.equal(await pending.count(), 0);
    await refresh();
    assert.match(await content.textContent(), /受控向导故障/);
    await input.fill("恢复提问"); await send.click(); await replies(2);
    assert.equal(await error.textContent(), "");

    const before = await ledger();
    await page.locator('#side [data-guide-tab="notes"]').click();
    await input.fill("我自己的笔记"); await send.click();
    await page.waitForFunction(() => document.querySelector('#side [data-guide-tab="notes"]')?.textContent === "笔记 1");
    const after = await ledger();
    assert.equal(after.received, before.received, "saving a note starts no guide turn");
    assert.equal(after.entries, before.entries, "a note is not a conversation entry");
    assert.deepEqual(after.notes, [["note", "我自己的笔记"]]);
    assert.equal(await pending.count(), 0);

    await hold();
    await page.locator(".pith-nav-toggle").click(); await page.locator('[data-planned-lesson="02-第二讲.md"]').click();
    await arrived(); await pending.waitFor();
    await article.getByText("向导正在结合课程大纲与源码为你撰写本讲讲义…").waitFor();
    const inFlight = (await ledger()).received;
    await page.locator(".pith-nav-toggle").click(); await page.locator('[data-planned-lesson="03-第三讲.md"]').click();
    await page.locator(".pith-toast-tip", { hasText: "向导正在回应上一条消息" }).waitFor();
    assert.equal((await ledger()).received, inFlight, "a second lesson does not start while a turn is running");
    assert.equal(await article.getByText("向导正在结合课程大纲与源码为你撰写本讲讲义…").count(), 1);
    await letGo();
    await article.getByText("02-第二讲.md 的正文。").waitFor();
    await pending.waitFor({ state: "detached" });
    assert.deepEqual(await page.evaluate(() => (window as any).turn.notices), []);
  } finally { if (browser) await browser.close(); await closeServer(origin); await rm(dir, { recursive: true, force: true }); }
});
