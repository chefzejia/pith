import assert from "node:assert/strict";
import test from "node:test";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { testSandbox } from "./sandbox.ts";
import { paragraphHash } from "../src/plugins/toolkit-feynman/index.ts";
import { DefaultWorkspaceStore } from "../src/core/index.ts";
import { NodeWorkspaceStorage } from "../src/shells/web/nodeStorage.ts";
import { createPithWebServer } from "../src/shells/web/server.ts";

const source = "只有温度不变时，气体才满足此关系。体积缩小使压强升高。样本应保持密闭。";
const points = [{ id: "p1", claim: "恒温前提", sourceQuote: "只有温度不变时，气体才满足此关系。" }, { id: "p2", claim: "体积影响压强", sourceQuote: "体积缩小使压强升高。" }, { id: "p3", claim: "密闭", sourceQuote: "样本应保持密闭。" }];
const enabled = Boolean(process.env.PITH_PLAYWRIGHT_MODULE && process.env.PITH_CHROME_PATH);
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(ok => { resolve = ok; });
  return { promise, resolve };
}
test("Feynman real rendered flow verifies references, reuses standards, saves attempt and never starts a topic turn", { skip: !enabled, timeout: 40000 }, async () => {
  const root = await testSandbox("task53-rendered-"); let browser: any;
  const store = new DefaultWorkspaceStore(new NodeWorkspaceStorage(root));
  const material = await store.importMaterial({ title: "气体", kind: "article", files: [{ name: "source.md", bytes: new TextEncoder().encode(`# 条件核对\n\n${source}`) }] });
  const topic = await store.createTopic({ title: "解释条件", target: "解释条件", materialIds: [material.id], toolkits: ["feynman"] });
  const legacy = await store.appendTopicNote(topic.id, { kind: "practice", author: "user", body: "旧版复述", result: { toolkit: "feynman", points: points.map(point => ({ ...point, status: "covered", quote: "旧版复述" })) } });
  const events: string[] = [], turns: any[] = [];
  // Only the external prompt/guide responses are controlled; production UI, reference validation, cache, Engine and Store run unchanged.
  const server = await createPithWebServer({ workspaceDir: root, promptService: { async prompt(prompt) {
    if (prompt.includes("原文：")) { events.push("extract"); return JSON.stringify({ points: [...points, { id: "forged", claim: "不存在", sourceQuote: "外部内容" }] }); }
    events.push("compare"); const data = JSON.parse(prompt.slice(prompt.lastIndexOf("\n") + 1));
    assert.deepEqual(Object.keys(data), ["source", "points", "produced"]);
    assert.deepEqual(data.points, points);
    const quote = "必须恒温";
    return JSON.stringify({ items: [
      data.produced.includes(quote) ? { id: "p1", status: "covered", quote } : { id: "p1", status: "missing", quote: "" },
      { id: "p2", status: "contradicted", quote: "体积越小压强越低" },
      { id: "p3", status: "covered", quote: "本次复述不存在的内容" },
    ] });
  } }, guideProvider: { async run(input) { turns.push(input); return { status: "completed" }; } } });
  try {
    const address = server.address(); assert.ok(address && typeof address !== "string");
    const { chromium } = await import(process.env.PITH_PLAYWRIGHT_MODULE!);
    browser = await chromium.launchPersistentContext(join(root, "profile"), { executablePath: process.env.PITH_CHROME_PATH, headless: true, viewport: { width: 1240, height: 960 } });
    const page = await browser.newPage(); await page.goto(`http://127.0.0.1:${address.port}`); await page.locator(`[data-topic="${topic.id}"]`).first().click();
    await page.locator('[data-prose="true"]').filter({ hasText: source }).click(); await page.locator("#open-toolkit").click(); await page.locator('[data-toolkit-choose="feynman"]').click();
    await page.getByText("要点已准备，请用自己的话复述。").waitFor(); assert.deepEqual(events, ["extract"]);
    const produced = "体积越小压强越低"; await page.locator("[data-toolkit-produced]").fill(produced); await page.locator("[data-toolkit-submit]").click();
    await page.getByText("本次复述已保存。").waitFor();
    assert.deepEqual(events, ["extract", "compare"]); assert.deepEqual(turns, []);
    const ledger = await fetch(`http://127.0.0.1:${address.port}/api/chat?topicId=${topic.id}`);
    assert.deepEqual(await ledger.json(), []);
    const results = page.locator(".pith-inline-toolkit .pith-recall-results");
    assert.deepEqual(await results.locator("section").evaluateAll((nodes: HTMLElement[]) => nodes.map(node => node.dataset.recallStatus)), ["missing", "contradicted", "unverified"]);
    assert.match(await results.textContent(), /未能核对/); assert.doesNotMatch(await results.textContent(), /不存在的内容|分数|覆盖率|总评/);
    const notes = (await store.getTopic(topic.id))!.notes;
    assert.equal(notes.length, 2);
    assert.equal(notes[0]!.id, legacy.id); assert.equal(notes[0]!.result?.passage, undefined);
    assert.equal(notes[1]!.body, produced); assert.equal(notes[1]!.author, "user"); assert.equal(notes[1]!.kind, "practice"); assert.equal(notes[1]!.result?.passage, paragraphHash(source), "practice result must store the passage hash");
    assert.doesNotMatch(await results.textContent(), /上次/);
    // Same point IDs from a different paragraph must not supply the baseline.
    await store.appendTopicNote(topic.id, { kind: "practice", author: "user", body: "另一段复述", result: { toolkit: "feynman", passage: paragraphHash("另一段"), points: points.map(point => ({ ...point, status: "covered", quote: "另一段复述" })) } });
    assert.equal(await page.locator(".pith-toolkit-source").isVisible(), true);
    await page.getByRole("button", { name: "再复述一次" }).click();
    assert.equal(await results.count(), 0, "repeat must dismiss the previous results");
    assert.equal(await page.locator(".pith-toolkit-source").isHidden(), true, "repeat must hide the source");
    assert.equal(await page.locator("[data-toolkit-produced]").inputValue(), "");
    const submit = async (text: string) => {
      await page.locator("[data-toolkit-produced]").fill(text); await page.locator("[data-toolkit-submit]").click();
      await page.getByText("本次复述已保存。").waitFor();
    };
    await submit("必须恒温。" + produced);
    assert.match(await results.locator("section").nth(0).textContent(), /上次：未提及/);
    assert.equal(await results.getByText(/^上次：/).count(), 1);
    if (process.env.PITH_TASK53_SCREENSHOTS) await page.screenshot({ path: join(process.env.PITH_TASK53_SCREENSHOTS, "contrast-web.png") });
    const open = async () => { await page.locator("#open-toolkit").click(); await page.locator('[data-toolkit-choose="feynman"]').click(); };
    await page.locator("[data-toolkit-close]").click(); await open(); await submit(produced);
    assert.match(await results.locator("section").nth(0).textContent(), /上次：已说到/);
    await page.reload(); await page.locator(`[data-topic="${topic.id}"]`).first().click(); await open(); await submit("必须恒温。" + produced);
    assert.match(await results.locator("section").nth(0).textContent(), /上次：未提及/);
    assert.deepEqual(turns, []);
    assert.equal(events.filter(event => event === "extract").length, 1);
  } finally { if (browser) await browser.close(); await new Promise<void>(ok => { server.close(() => ok()); server.closeAllConnections(); }); await rm(root, { recursive: true, force: true }); }
});

test("Feynman failures save independent attempts, preserve draft and retry comparison without a guide turn", { skip: !enabled, timeout: 40000 }, async () => {
  const root = await testSandbox("task53-retry-"); let browser: any; let mode = "extract-fail", guides = 0;
  const store = new DefaultWorkspaceStore(new NodeWorkspaceStorage(root));
  const topic = await store.createTopic({ title: "重试", target: "解释条件", materialIds: [], toolkits: ["feynman"] }); await store.writeLesson(topic.id, "source.md", source);
  const server = await createPithWebServer({ workspaceDir: root, promptService: { async prompt(prompt) {
    if (mode === "extract-fail") throw new Error("controlled extraction failure");
    if (prompt.includes("原文：")) return JSON.stringify({ points });
    if (mode === "compare-fail") throw new Error("controlled comparison failure");
    return JSON.stringify({ items: points.map(point => ({ id: point.id, status: "covered", quote: "复述草稿" })) });
  } }, guideProvider: { async run() { guides++; return { status: "completed" }; } } });
  try {
    const address = server.address(); assert.ok(address && typeof address !== "string");
    const { chromium } = await import(process.env.PITH_PLAYWRIGHT_MODULE!); browser = await chromium.launchPersistentContext(join(root, "profile"), { executablePath: process.env.PITH_CHROME_PATH, headless: true, viewport: { width: 1240, height: 960 } });
    const page = await browser.newPage(); await page.goto(`http://127.0.0.1:${address.port}`); await page.locator(`[data-topic="${topic.id}"]`).first().click();
    await page.locator("#open-toolkit").click(); await page.locator('[data-toolkit-choose="feynman"]').click(); await page.getByText(/对照不可用：controlled extraction failure/).waitFor();
    await page.locator("[data-toolkit-produced]").fill("复述草稿");
    await page.locator("[data-toolkit-submit]").evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
    await page.getByText(/本次复述已保存，对照不可用：controlled extraction failure/).waitFor(); assert.equal((await store.getTopic(topic.id))!.notes.length, 1); assert.equal(guides, 0);
    mode = "compare-fail"; await page.locator("[data-toolkit-submit]").click(); await page.getByText(/本次复述已保存，对照不可用：controlled comparison failure/).waitFor();
    assert.equal((await store.getTopic(topic.id))!.notes.length, 2); assert.equal(await page.locator("[data-toolkit-produced]").inputValue(), "复述草稿");
    if (process.env.PITH_TASK53_SCREENSHOTS) await page.screenshot({ path: join(process.env.PITH_TASK53_SCREENSHOTS, "retry-web.png") });
    mode = "success"; await page.locator("[data-toolkit-submit]").click(); await page.getByText("本次复述已保存。").waitFor();
    const notes = (await store.getTopic(topic.id))!.notes; assert.equal(notes.length, 3); assert.equal(notes[0]!.result, undefined); assert.equal(notes[1]!.result, undefined); assert.ok(notes[2]!.result); assert.equal(guides, 0);
  } finally { if (browser) await browser.close(); await new Promise<void>(ok => { server.close(() => ok()); server.closeAllConnections(); }); await rm(root, { recursive: true, force: true }); }
});

test("leaving the real workbench during delayed comparison saves to its topic without reopening a guide", { skip: !enabled, timeout: 30000 }, async () => {
  const root = await testSandbox("task53-late-"); let browser: any, guides = 0;
  const gate = deferred<void>(), seen = deferred<void>(), aborted = deferred<void>();
  const store = new DefaultWorkspaceStore(new NodeWorkspaceStorage(root));
  const topic = await store.createTopic({ title: "迟到对照", target: "解释", materialIds: [], toolkits: ["feynman"] }); await store.writeLesson(topic.id, "source.md", source);
  const server = await createPithWebServer({ workspaceDir: root, promptService: { async prompt(prompt, { signal } = {}) {
    if (prompt.includes("原文：")) return JSON.stringify({ points });
    const abort = () => aborted.resolve();
    signal?.addEventListener("abort", abort, { once: true });
    seen.resolve();
    try {
      await Promise.race([gate.promise, aborted.promise]);
      signal?.throwIfAborted();
      return JSON.stringify({ items: points.map(point => ({ id: point.id, status: "covered", quote: "离开前提交" })) });
    } finally { signal?.removeEventListener("abort", abort); }
  } }, guideProvider: { async run() { guides++; return { status: "completed" }; } } });
  try {
    const address = server.address(); assert.ok(address && typeof address !== "string"); const base = `http://127.0.0.1:${address.port}`;
    const { chromium } = await import(process.env.PITH_PLAYWRIGHT_MODULE!); browser = await chromium.launchPersistentContext(join(root, "profile"), { executablePath: process.env.PITH_CHROME_PATH, headless: true });
    const page = await browser.newPage(); await page.goto(base); await page.locator(`[data-topic="${topic.id}"]`).first().click(); await page.locator("#open-toolkit").click(); await page.locator('[data-toolkit-choose="feynman"]').click();
    await page.locator("[data-toolkit-produced]").fill("离开前提交"); await page.locator("[data-toolkit-submit]").click(); await seen.promise;
    await page.locator('[data-command="home"]').click(); await page.locator(".pith-home").waitFor();
    await page.waitForFunction(async (id: string) => (await (await fetch("/api/state")).json()).compass.exploring.find((topic: any) => topic.id === id).notes.length === 1, topic.id);
    assert.equal(guides, 0); assert.equal(await page.locator(".pith-guide").count(), 0); assert.equal(await page.locator(".pith-home").count(), 1);
    const note = (await store.getTopic(topic.id))!.notes[0]!; assert.equal(note.body, "离开前提交"); assert.equal(note.anchor!.file, "source.md"); assert.equal(note.result, undefined);
  } finally { gate.resolve(); if (browser) await browser.close(); await new Promise<void>(ok => { server.close(() => ok()); server.closeAllConnections(); }); await rm(root, { recursive: true, force: true }); }
});

test("Web card close aborts the server Agent request during extraction and comparison", { skip: !enabled, timeout: 35000 }, async () => {
  const root = await testSandbox("task63-abort-");
  let browser: any, holdExtraction = true;
  const storage = new NodeWorkspaceStorage(root);
  const store = new DefaultWorkspaceStore(storage);
  const topic = await store.createTopic({ title: "关闭复述", target: "解释", materialIds: [], toolkits: ["feynman"] });
  await store.writeLesson(topic.id, "source.md", source);
  const observed = [
    { started: deferred<void>(), aborted: deferred<void>() },
    { started: deferred<void>(), aborted: deferred<void>() },
  ];
  const release = deferred<string>();
  const server = await createPithWebServer({ workspaceDir: root, guideProvider: { async run() { assert.fail("Feynman does not open a topic turn"); } }, promptService: { async prompt(text, { signal } = {}) {
    const extracting = text.includes("原文：");
    if (extracting && !holdExtraction) return JSON.stringify({ points });
    const stage = observed[extracting ? 0 : 1]!;
    stage.started.resolve();
    const abort = () => stage.aborted.resolve();
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    try { return await Promise.race([release.promise, stage.aborted.promise.then(() => { throw signal?.reason; })]); }
    finally { signal?.removeEventListener("abort", abort); }
  } } });
  const waitForAbort = async (phase: number) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { await Promise.race([observed[phase]!.aborted.promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`Agent never aborted in phase ${phase}`)), 3000); })]); }
    finally { clearTimeout(timer); }
  };
  try {
    const address = server.address(); assert.ok(address && typeof address !== "string");
    const { chromium } = await import(process.env.PITH_PLAYWRIGHT_MODULE!);
    browser = await chromium.launchPersistentContext(join(root, "profile"), { executablePath: process.env.PITH_CHROME_PATH, headless: true });
    const page = await browser.newPage(); page.setDefaultTimeout(8000);
    await page.goto(`http://127.0.0.1:${address.port}`);
    await page.locator(`[data-topic="${topic.id}"]`).first().click();
    const open = async () => { await page.locator("#open-toolkit").click(); await page.locator('[data-toolkit-choose="feynman"]').click(); };
    await open(); await observed[0]!.started.promise;
    await page.locator("[data-toolkit-close]").click(); await waitForAbort(0);
    holdExtraction = false;
    await open(); await page.getByText(/要点已准备/).waitFor();
    await page.locator("[data-toolkit-produced]").fill("关闭前已提交"); await page.locator("[data-toolkit-submit]").click();
    await observed[1]!.started.promise;
    await page.locator("[data-toolkit-close]").click(); await waitForAbort(1);
    await page.waitForFunction(async (id: string) => (await (await fetch("/api/state")).json()).compass.exploring.find((entry: any) => entry.id === id).notes.length === 1, topic.id);
    assert.equal((await store.getTopic(topic.id))!.notes[0]!.result, undefined);
  } finally { release.resolve("{}"); if (browser) await browser.close(); await new Promise<void>(ok => { server.close(() => ok()); server.closeAllConnections(); }); await rm(root, { recursive: true, force: true }); }
});

for (const scenario of ["mask after reconnect", "offline save", "offline retry gate"] as const) {
  test(`active Feynman settings transition: ${scenario}`, { skip: !enabled, timeout: 35000 }, async () => {
    const root = await testSandbox("task63-live-toggle-");
    const storage = new NodeWorkspaceStorage(root), store = new DefaultWorkspaceStore(storage);
    const topic = await store.createTopic({ title: "开卡切换向导", target: "解释", materialIds: [], toolkits: ["feynman"] });
    await store.writeLesson(topic.id, "source.md", source);
    await storage.writeText("_cache/web-settings.json", JSON.stringify({ preset: "all", persona: "sanctuary", plugins: {}, agentId: "dsh", agentConfigured: true }));
    let browser: any, compares = 0, fail = scenario === "offline retry gate";
    const attempts = async () => (await store.getTopic(topic.id))!.notes;
    const server = await createPithWebServer({
      workspaceDir: root,
      processPort: { findExecutable: async () => null, probeExecutable: async () => null, spawnStdio: async () => { throw new Error("Only the controlled prompt boundary is used"); } },
      promptService: { async prompt(text) {
        if (text.includes("原文：")) return JSON.stringify({ points });
        compares++;
        if (fail) throw new Error("暂时失败");
        const { produced } = JSON.parse(text.slice(text.lastIndexOf("\n") + 1));
        return JSON.stringify({ items: points.map(point => ({ id: point.id, status: "covered", quote: produced })) });
      } },
    });
    try {
      const address = server.address(); assert.ok(address && typeof address !== "string");
      const { chromium } = await import(process.env.PITH_PLAYWRIGHT_MODULE!);
      browser = await chromium.launchPersistentContext(join(root, "profile"), { executablePath: process.env.PITH_CHROME_PATH, headless: true });
      const page = await browser.newPage(); page.setDefaultTimeout(6000);
      await page.goto(`http://127.0.0.1:${address.port}`);
      await page.locator(`[data-topic="${topic.id}"]`).first().click();
      await page.locator(".pith-article").getByText(source).waitFor();
      await page.locator("#open-toolkit").click(); await page.locator('[data-toolkit-choose="feynman"]').click();
      await page.getByText(/要点已准备/).waitFor();
      const select = async (agentId: "" | "dsh") => {
        await page.locator('[data-command="settings"]').click();
        const selector = page.locator("#simple-agent");
        if (await selector.inputValue() === agentId) await selector.dispatchEvent("change");
        else await selector.selectOption(agentId);
        await page.locator("#simple-status").getByText("设置已保存", { exact: true }).waitFor();
        await page.locator("#close-drawer").click();
      };
      const card = page.locator(".pith-inline-toolkit"), field = card.locator("[data-toolkit-produced]");
      const submit = card.locator("[data-toolkit-submit]"), repeat = card.locator("[data-toolkit-repeat]");
      const result = card.locator(".pith-recall-results"), status = card.getByRole("status");
      await field.fill("第一遍复述"); await submit.click();
      await status.getByText(/本次复述已保存/).waitFor();
      const first = (await attempts())[0]!;
      if (scenario === "offline retry gate") await card.getByRole("button", { name: /重试对照/ }).waitFor();
      else await repeat.waitFor();
      await select("");
      if (scenario === "mask after reconnect") {
        await select("dsh"); await select("dsh");
        await repeat.click();
        assert.equal(await field.inputValue(), "");
        assert.equal(await result.count(), 0);
        const block = page.locator(".pith-article [data-prose='true']").filter({ hasText: source });
        assert.equal(await block.locator(".pith-toolkit-source[hidden]").count(), 1, "repeat must mask the actual original after reconnect");
        assert.equal((await block.innerText()).includes(source), false, "original prose must not be visible");
        assert.match(await block.innerText(), /合上原文/);
      } else if (scenario === "offline save") {
        assert.match(await status.textContent(), /向导未连接.*对照不可用/);
        assert.equal(await repeat.count(), 0);
        assert.equal(await field.inputValue(), "第一遍复述");
        assert.equal(await result.count(), 1, "historical comparison remains viewable");
        await field.fill("离线撰写的新草稿");
        await select(""); await select("");
        assert.equal(await field.inputValue(), "离线撰写的新草稿");
        await card.getByRole("button", { name: "保存复述" }).click();
        await status.getByText(/本次复述已保存/).waitFor();
        assert.equal(await submit.isDisabled(), true);
        assert.deepEqual((await attempts()).map(note => [note.id, note.body, note.result]), [[first.id, first.body, first.result], [(await attempts())[1]!.id, "离线撰写的新草稿", undefined]]);
        assert.equal(compares, 1);
      } else {
        assert.equal(await card.getByRole("button", { name: /重试对照/ }).count(), 0, "offline failure must not offer retry");
        // The action guard must reject even a stale retry invoked with a new draft.
        await field.fill("不可被旧重试动作保存");
        await submit.evaluate((button: HTMLButtonElement) => { button.dataset.toolkitRetry = ""; button.click(); });
        await field.fill("第一遍复述");
        assert.deepEqual(await attempts(), [first], "offline attempted retry must not save another practice");
        assert.equal(await submit.isDisabled(), true);
        assert.equal(compares, 1);
        fail = false; await select("dsh");
        await card.getByRole("button", { name: /重试对照/ }).click();
        await repeat.waitFor();
        assert.equal((await attempts()).length, 2);
        assert.equal(compares, 2);
      }
    } finally { if (browser) await browser.close(); await new Promise<void>(ok => { server.close(() => ok()); server.closeAllConnections(); }); await rm(root, { recursive: true, force: true }); }
  });
}

test("reselecting a transformed paragraph sends original prose and a matching anchor, also after switching toolkits", { skip: !enabled, timeout: 40000 }, async () => {
  const root = await testSandbox("task53-reselect-"); let browser: any;
  const store = new DefaultWorkspaceStore(new NodeWorkspaceStorage(root));
  const material = await store.importMaterial({ title: "原文目标", kind: "article", files: [{ name: "source.md", bytes: new TextEncoder().encode(`# 标题\n\n${source}\n\n相邻段必须保持独立。`) }] });
  const topic = await store.createTopic({ title: "重新选段", target: "解释条件", materialIds: [material.id], toolkits: ["feynman", "shadowing"] });
  const requested: string[] = [];
  const server = await createPithWebServer({ workspaceDir: root, promptService: { async prompt(prompt) {
    if (prompt.includes("原文：")) { const target = JSON.parse(prompt.slice(prompt.lastIndexOf("\n") + 4)); return JSON.stringify({ points: [{ id: "p1", claim: "原文要点", sourceQuote: target }] }); }
    const data = JSON.parse(prompt.slice(prompt.lastIndexOf("\n") + 1)); return JSON.stringify({ items: data.points.map((point: any) => ({ id: point.id, status: "covered", quote: data.produced })) });
  } }, guideProvider: { async run() { return { status: "completed" }; } } });
  try {
    const address = server.address(); assert.ok(address && typeof address !== "string");
    const { chromium } = await import(process.env.PITH_PLAYWRIGHT_MODULE!);
    browser = await chromium.launchPersistentContext(join(root, "profile"), { executablePath: process.env.PITH_CHROME_PATH, headless: true, viewport: { width: 1240, height: 960 } });
    const page = await browser.newPage();
    page.on("request", (request: any) => { if (request.url().endsWith("/api/feynman/prepare")) requested.push(request.postDataJSON().source); });
    await page.goto(`http://127.0.0.1:${address.port}`); await page.locator(`[data-topic="${topic.id}"]`).first().click();
    const paragraph = page.locator('[data-locator="text:line:2"]');
    await paragraph.click(); await page.locator('[data-toolkit-choose="feynman"]').click();
    await page.getByText("要点已准备，请用自己的话复述。").waitFor();
    await paragraph.locator("[data-toolkit-display]").click({ clickCount: 3 });
    const response = page.waitForResponse((response: any) => response.url().endsWith("/api/feynman/prepare"));
    await page.locator("#open-toolkit").click(); await page.locator('[data-toolkit-choose="feynman"]').click(); await response;
    assert.equal(requested.at(-1), source, "a real triple-click on the mask must resolve to its original paragraph");
    await page.getByText("要点已准备，请用自己的话复述。").waitFor();
    await paragraph.locator('[data-toolkit-display]').evaluate((display: HTMLElement) => {
      const range = document.createRange(); range.selectNodeContents(display);
      const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
      display.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });
    const bounded = page.waitForResponse((response: any) => response.url().endsWith('/api/feynman/prepare'));
    await page.locator('#open-toolkit').click(); await page.locator('[data-toolkit-choose="feynman"]').click(); await bounded;
    assert.equal(requested.at(-1), source, 'a DOM range confined to transformed text also maps to the original');
    await page.getByText("要点已准备，请用自己的话复述。").waitFor();
    await page.locator("[data-toolkit-produced]").fill("本次真实输入"); await page.locator("[data-toolkit-submit]").click();
    await page.getByText("本次复述已保存。").waitFor();
    const saved = (await store.getTopic(topic.id))!.notes[0]!;
    assert.equal(saved.anchor!.quote, source); assert.equal(saved.anchor!.locator, "text:line:2"); assert.ok(saved.result);
    if (process.env.PITH_TASK53_FIX_SCREENSHOTS) await page.screenshot({ path: join(process.env.PITH_TASK53_FIX_SCREENSHOTS, "selection-reopened-web.png") });
    await page.locator("#open-toolkit").click(); await page.locator('[data-toolkit-choose="shadowing"]').click();
    await paragraph.locator("[data-toolkit-display]").click({ clickCount: 3 });
    const switched = page.waitForResponse((response: any) => response.url().endsWith("/api/feynman/prepare"));
    await page.locator("#open-toolkit").click(); await page.locator('[data-toolkit-choose="feynman"]').click(); await switched;
    assert.equal(requested.at(-1), source, "shadowing's transformed display must also resolve to the original");
    await page.locator("[data-toolkit-reveal]").click();
    const original = paragraph.locator(".pith-toolkit-source"); await original.click({ clickCount: 3 });
    await page.locator('#open-toolkit').click(); await page.locator('[data-toolkit-choose="feynman"]').click();
    await page.getByText("要点已准备，请用自己的话复述。").waitFor(); assert.equal(requested.at(-1), source);
  } finally { if (browser) await browser.close(); await new Promise<void>(ok => { server.close(() => ok()); server.closeAllConnections(); }); await rm(root, { recursive: true, force: true }); }
});
