import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { build } from "esbuild";
import { DefaultWorkspaceStore, type EffectRecord } from "../src/core/index.ts";
import { NodeWorkspaceStorage } from "../src/shells/web/nodeStorage.ts";
import { testSandbox } from "./sandbox.ts";

const browserUnavailable = !process.env.PITH_PLAYWRIGHT_MODULE || !process.env.PITH_CHROME_PATH;
const highlightParagraph = "第一段选区原文：只有确认前置条件，因果链才成立。";
const feynmanParagraph = "第二段费曼原文：只有温度不变时，气体才满足反比关系。";

async function waitFor<T>(read: () => Promise<T>, accept: (value: T) => boolean, message: string): Promise<T> {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const value = await read();
    if (accept(value)) return value;
    await new Promise<void>(resolve => setTimeout(resolve, 15));
  }
  throw new Error(`Timed out: ${message}`);
}

test("Obsidian real PithWorkspaceView + PithObsidianView omits feynman-coach and persists nextAction on note, highlight, and feynman practice", { timeout: 60000, skip: browserUnavailable }, async () => {
  const dir = await testSandbox("m69-browser-");
  const workspaceDir = join(dir, "workspace");
  await mkdir(workspaceDir, { recursive: true });
  const storage = new NodeWorkspaceStorage(workspaceDir);
  const store = new DefaultWorkspaceStore(storage);
  await store.ensureScaffold();
  await storage.mkdir("_cache");
  await storage.writeText("_cache/web-settings.json", JSON.stringify({
    preset: "all",
    plugins: {},
    agentId: "dsh",
    agentConfigured: true,
    model: "",
    effort: "",
  }, null, 2));
  const topic = await store.createTopic({
    title: "费曼与下一步",
    target: "验证真实原生工作台触发后台下一步",
    materialIds: [],
    toolkits: ["feynman"],
  });
  await store.writeLesson(topic.id, "01-intro.md", `# 导读\n\n${highlightParagraph}\n\n${feynmanParagraph}\n`);

  const acpPrompts: { prompt: string; reply: string }[] = [];
  const origin = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end("<!doctype html><title>host</title>");
  });
  await new Promise<void>(resolve => origin.listen(0, "127.0.0.1", resolve));

  let browser: any;
  try {
    const address = origin.address();
    assert.ok(address && typeof address !== "string");
    const bundle = await build({
      entryPoints: ["src/shells/obsidian/index.ts"],
      bundle: true,
      write: false,
      platform: "browser",
      format: "iife",
      globalName: "NativePith",
      external: ["node:*", "obsidian"],
    });
    const { chromium } = await import(process.env.PITH_PLAYWRIGHT_MODULE!);
    browser = await chromium.launchPersistentContext(join(dir, "profile"), {
      executablePath: process.env.PITH_CHROME_PATH,
      headless: true,
      viewport: { width: 1200, height: 800 },
    });
    const page = await browser.newPage();
    page.setDefaultTimeout(8000);

    await page.exposeFunction("nativeStorage", async (method: string, args: any[]) => {
      if (method === "readBinary") return Array.from(await storage.readBinary(args[0]));
      if (method === "createBinary" || method === "writeBinary") return storage[method](args[0], new Uint8Array(args[1]));
      if (method === "list") return storage.list(args[0]);
      if (method === "exists") return storage.exists(args[0]);
      if (method === "readText") return storage.readText(args[0]);
      if (method === "createText" || method === "writeText") return storage[method](args[0], args[1]);
      if (method === "mkdir") return storage.mkdir(args[0]);
      if (method === "copy") return storage.copy(args[0], args[1]);
      throw new Error(`Unexpected storage method: ${method}`);
    });
    await page.exposeFunction("recordAcpPrompt", (prompt: string, reply: string) => {
      acpPrompts.push({ prompt, reply });
    });

    await page.goto(`http://127.0.0.1:${address.port}`);
    await page.setContent('<style>html,body{height:100%;margin:0}#root{height:100%;width:100%}#side{position:fixed;right:0;top:0;width:30%;height:100%;overflow:auto;background:var(--background-primary);border-left:1px solid var(--background-modifier-border)}body{--background-primary:#fcfbf8;--background-secondary:#f1f0ea;--background-modifier-border:#d5d8cf;--background-modifier-hover:#e4e9df;--text-normal:#283129;--text-muted:#70796e;--text-accent:#42664b;--font-interface:system-ui}button,input,textarea{font:inherit}</style><div id="root"></div><div id="side" hidden></div>');
    await page.evaluate(() => {
      (window as any).m69Notices = [];
      (window as any).require = (id: string) => id === "obsidian"
        ? {
            ItemView: class { contentEl: HTMLElement; constructor(leaf: any) { this.contentEl = leaf.contentEl ?? document.getElementById("root"); } },
            Plugin: class {},
            Notice: class { constructor(message: string) { (window as any).m69Notices.push(message); } },
          }
        : id === "node:util"
          ? { promisify: (fn: unknown) => fn }
          : id === "node:net"
            ? { BlockList: class { addSubnet() {} } }
            : {};
    });
    await page.addScriptTag({ content: bundle.outputFiles[0]!.text });

    await page.evaluate(async ({ feynmanQuote }: { feynmanQuote: string }) => {
      const w = window as any;
      const native = w.NativePith;
      const call = (method: string) => (...args: unknown[]) => w.nativeStorage(method, args);
      const storageApi: any = {};
      for (const method of ["exists", "readText", "writeText", "createText", "list", "mkdir", "copy"]) storageApi[method] = call(method);
      storageApi.readBinary = async (path: string) => new Uint8Array(await call("readBinary")(path));
      for (const method of ["createBinary", "writeBinary"]) storageApi[method] = (path: string, value: Uint8Array) => call(method)(path, Array.from(value));
      storageApi.processText = async (path: string, update: (current: string) => string) => {
        const text = update(await storageApi.readText(path));
        await storageApi.writeText(path, text);
        return text;
      };

      let spawnCount = 0;
      let nextActionCount = 0;
      const processPort = {
        findExecutable: async (command: string) => (command === "dsh" ? "/sandbox/dsh" : null),
        probeExecutable: async (_path: string, args: readonly string[]) => (args.includes("--help") ? "Agent Client Protocol (ACP)" : "dsh 1.0.0"),
        async spawnStdio() {
          const spawnIndex = ++spawnCount;
          const listeners = new Set<(line: string) => void>();
          return {
            cwd: "/sandbox",
            onLine(listener: (line: string) => void) {
              listeners.add(listener);
              return () => listeners.delete(listener);
            },
            writeLine(line: string) {
              const message = JSON.parse(line) as { id?: number; method: string; params?: { prompt?: { text: string }[] } };
              if (message.id === undefined) return;
              const emit = (result: unknown) => {
                const payload = JSON.stringify({ jsonrpc: "2.0", id: message.id, result });
                setTimeout(() => { for (const listener of [...listeners]) listener(payload); }, 5);
              };
              if (message.method === "initialize") {
                emit({ agentCapabilities: { mcpCapabilities: { http: true } } });
                return;
              }
              if (message.method === "session/new") {
                emit({ sessionId: `browser-sess-${spawnIndex}` });
                return;
              }
              if (message.method === "session/prompt") {
                const text = message.params?.prompt?.[0]?.text ?? "";
                let reply = "";
                if (text.startsWith("从原文抽取可独立核对的要点")) {
                  reply = JSON.stringify({ points: [{ id: "p1", claim: "恒温前提", sourceQuote: feynmanQuote }] });
                } else if (text.startsWith("对照原文和预先确定的要点")) {
                  const data = JSON.parse(text.slice(text.lastIndexOf("\n") + 1)) as { produced: string };
                  reply = JSON.stringify({ items: [{ id: "p1", status: "covered", quote: data.produced }] });
                } else if (text.startsWith("请根据以下课题数据给出一个 15 分钟内可完成的具体下一步行动")) {
                  nextActionCount++;
                  reply = `Action #${nextActionCount}: 复核并巩固笔记与复述要点`;
                }
                void w.recordAcpPrompt(text, reply);
                emit({ text: reply, stopReason: "end_turn" });
                return;
              }
              emit({});
            },
            async close() {},
          };
        },
      };

      const host = { id: "obsidian", storage: storageApi, process: processPort };
      const controller = new native.PithObsidianController(host);
      await controller.initialize();

      const root = document.getElementById("root")!;
      const side = document.getElementById("side")!;
      const leaf: any = {
        contentEl: side,
        detach() {
          void leaf.view?.onClose?.();
          leaf.view = undefined;
          side.replaceChildren();
          side.hidden = true;
          root.style.width = "100%";
        },
        async setViewState() {
          leaf.view = new native.PithGuideView(this);
        },
      };
      const workspace = {
        rightSplit: {
          collapsed: true,
          expand() { this.collapsed = false; side.hidden = false; root.style.width = "70%"; },
          collapse() { this.collapsed = true; side.hidden = true; root.style.width = "100%"; },
        },
        getRightLeaf: () => leaf,
        getLeavesOfType: (type: string) => (type === "pith-guide" && leaf.view ? [leaf] : []),
        revealLeaf: async () => {},
      };
      const workspaceView = new native.PithWorkspaceView({}, controller, host, workspace);
      w.m69 = { controller, workspaceView };
      await workspaceView.onOpen();
    }, { feynmanQuote: feynmanParagraph });

    // Open topic in real PithWorkspaceView + real PithObsidianView
    await page.locator(`[data-topic="${topic.id}"]`).first().click();
    await page.locator(".pith-article").getByText(highlightParagraph).waitFor();
    await page.locator(".pith-article").getByText(feynmanParagraph).waitFor();
    assert.equal(await page.locator(".pith-view").count(), 1);

    // Open Guide sidebar and assert feynman-coach / 费曼深水区追问 is absent from UI and quick actions
    await page.locator(".pith-guide-toggle").click();
    await page.locator("#side .pith-guide").waitFor();
    await page.locator("#side .pith-quick-actions").waitFor();
    const quickTexts = await page.locator("#side .pith-quick-actions button").allTextContents();
    assert.deepEqual(quickTexts, ["导读这一节", "下一讲 / 考考我"]);
    assert.equal((await page.locator("#side").textContent())?.includes("费曼深水区追问"), false);
    assert.equal(await page.locator('[data-guide-prompt*="feynman-coach"]').count(), 0);

    // Open toolkit menu and verify feynman-coach is absent there as well, then close via Escape
    await page.locator("#open-toolkit").click();
    await page.locator(".pith-toolkit-panel .pith-toolkit-group").first().waitFor();
    const toolkitLabels = await page.locator(".pith-toolkit-panel [data-toolkit-choose]").allTextContents() as string[];
    assert.equal(toolkitLabels.some((label: string) => label.includes("追问") || label.includes("feynman-coach")), false);
    await page.keyboard.press("Escape");

    // 1. Trigger prepare-next-action by saving a user note via DOM interaction
    await page.locator('#side [data-guide-tab="notes"]').click();
    const noteBody = "用户浏览器笔记：记录前提条件与反例";
    await page.locator("#side textarea").fill(noteBody);
    await page.locator("#side [data-guide-send]").click();
    await page.locator('#side [data-guide-tab="notes"]').getByText("笔记 1").waitFor();

    const afterNote = await waitFor(
      () => store.getTopic(topic.id),
      item => item?.nextAction === "Action #1: 复核并巩固笔记与复述要点",
      "nextAction persisted after saving user note",
    );
    assert.equal(afterNote?.notes.length, 1);
    assert.match(await readFile(join(workspaceDir, "topics", topic.id, "topic.md"), "utf8"), /Action #1: 复核并巩固笔记与复述要点/);

    // 2. Trigger prepare-next-action by highlighting a prose selection via DOM interaction
    await page.locator('.pith-article p[data-prose="true"]').filter({ hasText: highlightParagraph }).evaluate((node: HTMLElement) => {
      const range = document.createRange();
      range.selectNodeContents(node);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      node.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    });
    await page.locator('.pith-selection [data-selection="highlight"]').click();
    await page.locator(".pith-article mark[data-pith-note]").first().waitFor();
    await page.locator('#side [data-guide-tab="notes"]').getByText("笔记 2").waitFor();

    const afterHighlight = await waitFor(
      () => store.getTopic(topic.id),
      item => item?.nextAction === "Action #2: 复核并巩固笔记与复述要点",
      "nextAction persisted after prose highlight",
    );
    assert.equal(afterHighlight?.notes.length, 2);
    assert.match(await readFile(join(workspaceDir, "topics", topic.id, "topic.md"), "utf8"), /Action #2: 复核并巩固笔记与复述要点/);

    // 3. Trigger prepare-next-action by saving a Feynman recall practice via DOM interaction
    await page.locator('.pith-article p[data-prose="true"]').filter({ hasText: feynmanParagraph }).click();
    await page.locator(".pith-inline-toolkit").getByText("要点已准备，请用自己的话复述。").waitFor();
    const recallText = "只有温度保持不变，气体压强才随体积缩小而升高。";
    await page.locator(".pith-inline-toolkit [data-toolkit-produced]").fill(recallText);
    await page.locator(".pith-inline-toolkit [data-toolkit-submit]").click();
    await page.locator(".pith-inline-toolkit").getByText("本次复述已保存。").waitFor();
    await page.locator('#side [data-guide-tab="notes"]').getByText("笔记 3").waitFor();

    const afterPractice = await waitFor(
      () => store.getTopic(topic.id),
      item => item?.nextAction === "Action #3: 复核并巩固笔记与复述要点",
      "nextAction persisted after Feynman practice",
    );
    assert.equal(afterPractice?.notes.length, 3);
    assert.equal(afterPractice?.notes[2]?.kind, "practice");
    assert.match(await readFile(join(workspaceDir, "topics", topic.id, "topic.md"), "utf8"), /Action #3: 复核并巩固笔记与复述要点/);

    const effects = JSON.parse(await readFile(join(workspaceDir, "_cache/effects.json"), "utf8")) as EffectRecord[];
    assert.equal(effects.at(-1)?.status, "completed");

    const nextActionPrompts = acpPrompts.filter(entry => entry.prompt.includes("15 分钟内可完成的具体下一步行动"));
    assert.equal(nextActionPrompts.length, 3);
    assert.match(nextActionPrompts[0]!.prompt, new RegExp(noteBody));
    assert.match(nextActionPrompts[1]!.prompt, /第一段选区原文/);
    assert.match(nextActionPrompts[2]!.prompt, new RegExp(recallText));

    if (process.env.PITH_M69_SCREENSHOTS) {
      await mkdir(process.env.PITH_M69_SCREENSHOTS, { recursive: true });
      await page.screenshot({ path: join(process.env.PITH_M69_SCREENSHOTS, "obsidian-feynman-next-action.png") });
    }

    assert.deepEqual(await page.evaluate(() => (window as any).m69Notices), []);
    await page.evaluate(() => (window as any).m69.controller.dispose());
  } finally {
    if (browser) await browser.close();
    await new Promise<void>((resolve, reject) => origin.close(error => error ? reject(error) : resolve()));
    await rm(dir, { recursive: true, force: true });
  }
});
