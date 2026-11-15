import assert from "node:assert/strict";
import test from "node:test";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { testSandbox } from "./sandbox.ts";
import { DefaultWorkspaceStore } from "../src/core/index.ts";
import { NodeWorkspaceStorage } from "../src/shells/web/nodeStorage.ts";
import { createPithWebServer } from "../src/shells/web/server.ts";

const source = "只有温度不变时，气体才满足此关系。体积缩小使压强升高。样本应保持密闭。";
const points = [{ id: "p1", claim: "恒温前提", sourceQuote: "只有温度不变时，气体才满足此关系。" }, { id: "p2", claim: "体积影响压强", sourceQuote: "体积缩小使压强升高。" }, { id: "p3", claim: "密闭", sourceQuote: "样本应保持密闭。" }];
const enabled = Boolean(process.env.PITH_PLAYWRIGHT_MODULE && process.env.PITH_CHROME_PATH);
test("Feynman real rendered flow verifies references, reuses standards, saves attempt and automatically follows up", { skip: !enabled, timeout: 40000 }, async () => {
  const root = await testSandbox("task53-rendered-"); let browser: any;
  const store = new DefaultWorkspaceStore(new NodeWorkspaceStorage(root));
  const material = await store.importMaterial({ title: "气体", kind: "article", files: [{ name: "source.md", bytes: new TextEncoder().encode(`# 条件核对\n\n${source}`) }] });
  const topic = await store.createTopic({ title: "解释条件", target: "解释条件", materialIds: [material.id], toolkits: ["feynman"] });
  const events: string[] = [], turns: any[] = [];
  // Only the external prompt/guide responses are controlled; production UI, reference validation, cache, Engine and Store run unchanged.
  const server = await createPithWebServer({ workspaceDir: root, promptService: { async prompt(prompt) {
    if (prompt.includes("原文：")) { events.push("extract"); return JSON.stringify({ points: [...points, { id: "forged", claim: "不存在", sourceQuote: "外部内容" }] }); }
    events.push("compare"); const data = JSON.parse(prompt.slice(prompt.lastIndexOf("\n") + 1));
    assert.deepEqual(Object.keys(data), ["source", "points", "produced"]);
    assert.deepEqual(data.points, points);
    return JSON.stringify({ items: [{ id: "p1", status: "missing", quote: "" }, { id: "p2", status: "contradicted", quote: "体积越小压强越低" }, { id: "p3", status: "covered", quote: "本次复述不存在的内容" }] });
  } }, guideProvider: { async run(input) { turns.push(input); return { status: "completed" }; } } });
  try {
    const address = server.address(); assert.ok(address && typeof address !== "string");
    const { chromium } = await import(process.env.PITH_PLAYWRIGHT_MODULE!);
    browser = await chromium.launchPersistentContext(join(root, "profile"), { executablePath: process.env.PITH_CHROME_PATH, headless: true, viewport: { width: 1240, height: 960 } });
    const page = await browser.newPage(); await page.goto(`http://127.0.0.1:${address.port}`); await page.locator(`[data-topic="${topic.id}"]`).first().click();
    await page.locator('[data-prose="true"]').filter({ hasText: source }).click(); await page.locator("#open-toolkit").click(); await page.locator('[data-toolkit-choose="feynman"]').click();
    await page.getByText("要点已准备，请用自己的话复述。").waitFor(); assert.deepEqual(events, ["extract"]);
    const produced = "体积越小压强越低"; await page.locator("[data-toolkit-produced]").fill(produced); await page.locator("[data-toolkit-submit]").click();
    await page.getByText("本次复述已保存，已发起向导追问。").waitFor();
    assert.deepEqual(events, ["extract", "compare"]); assert.equal(turns.length, 1);
    assert.equal(turns[0].text, produced); assert.ok(turns[0].instruction.includes(points[1]!.sourceQuote)); assert.ok(!turns[0].instruction.includes(points[0]!.sourceQuote));
    const results = page.locator(".pith-inline-toolkit .pith-recall-results");
    assert.deepEqual(await results.locator("section").evaluateAll((nodes: HTMLElement[]) => nodes.map(node => node.dataset.recallStatus)), ["missing", "contradicted", "unverified"]);
    assert.match(await results.textContent(), /未能核对/); assert.doesNotMatch(await results.textContent(), /不存在的内容|分数|覆盖率|总评/);
    const notes = (await store.getTopic(topic.id))!.notes; assert.equal(notes.length, 1); assert.equal(notes[0]!.body, produced); assert.ok(notes[0]!.result);
    if (process.env.PITH_TASK53_SCREENSHOTS) await page.screenshot({ path: join(process.env.PITH_TASK53_SCREENSHOTS, "contrast-web.png") });
    await page.locator("[data-toolkit-close]").click(); await page.locator("#open-toolkit").click(); await page.locator('[data-toolkit-choose="feynman"]').click(); await page.getByText("要点已准备，请用自己的话复述。").waitFor();
    assert.equal(events.filter(event => event === "extract").length, 1);
  } finally { if (browser) await browser.close(); await new Promise<void>(ok => { server.close(() => ok()); server.closeAllConnections(); }); await rm(root, { recursive: true, force: true }); }
});

test("Feynman failures save independent attempts, preserve draft and keep guide retry separate from comparison", { skip: !enabled, timeout: 40000 }, async () => {
  const root = await testSandbox("task53-retry-"); let browser: any; let mode = "extract-fail", guides = 0;
  const store = new DefaultWorkspaceStore(new NodeWorkspaceStorage(root));
  const topic = await store.createTopic({ title: "重试", target: "解释条件", materialIds: [], toolkits: ["feynman"] }); await store.writeLesson(topic.id, "source.md", source);
  const server = await createPithWebServer({ workspaceDir: root, promptService: { async prompt(prompt) {
    if (mode === "extract-fail") throw new Error("controlled extraction failure");
    if (prompt.includes("原文：")) return JSON.stringify({ points });
    if (mode === "compare-fail") throw new Error("controlled comparison failure");
    return JSON.stringify({ items: points.map(point => ({ id: point.id, status: "covered", quote: "复述草稿" })) });
  } }, guideProvider: { async run() { guides++; return guides === 1 ? { status: "failed", error: "controlled followUp failure" } : { status: "completed" }; } } });
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
    mode = "success"; await page.locator("[data-toolkit-submit]").click(); await page.getByText(/本次复述已保存，对照已完成。向导追问失败/).waitFor();
    let notes = (await store.getTopic(topic.id))!.notes; assert.equal(notes.length, 3); assert.equal(notes[0]!.result, undefined); assert.equal(notes[1]!.result, undefined); assert.ok(notes[2]!.result); assert.equal(guides, 1);
    await page.locator("[data-guide-retry]").click(); await page.waitForFunction(() => !document.querySelector("[data-guide-retry]"));
    notes = (await store.getTopic(topic.id))!.notes; assert.equal(notes.length, 3); assert.equal(guides, 2); assert.equal((await (await fetch(`http://127.0.0.1:${address.port}/api/chat?topicId=${topic.id}`)).json()).length, 1);
  } finally { if (browser) await browser.close(); await new Promise<void>(ok => { server.close(() => ok()); server.closeAllConnections(); }); await rm(root, { recursive: true, force: true }); }
});

test("leaving the real workbench during delayed comparison saves to its topic without reopening a guide", { skip: !enabled, timeout: 30000 }, async () => {
  const root = await testSandbox("task53-late-"); let browser: any; let release!: () => void, arrived!: () => void, guides = 0;
  const gate = new Promise<void>(ok => { release = ok; }), seen = new Promise<void>(ok => { arrived = ok; });
  const store = new DefaultWorkspaceStore(new NodeWorkspaceStorage(root));
  const topic = await store.createTopic({ title: "迟到对照", target: "解释", materialIds: [], toolkits: ["feynman"] }); await store.writeLesson(topic.id, "source.md", source);
  const server = await createPithWebServer({ workspaceDir: root, promptService: { async prompt(prompt) { if (prompt.includes("原文：")) return JSON.stringify({ points }); arrived(); await gate; return JSON.stringify({ items: points.map(point => ({ id: point.id, status: "covered", quote: "离开前提交" })) }); } }, guideProvider: { async run() { guides++; return { status: "completed" }; } } });
  try {
    const address = server.address(); assert.ok(address && typeof address !== "string"); const base = `http://127.0.0.1:${address.port}`;
    const { chromium } = await import(process.env.PITH_PLAYWRIGHT_MODULE!); browser = await chromium.launchPersistentContext(join(root, "profile"), { executablePath: process.env.PITH_CHROME_PATH, headless: true });
    const page = await browser.newPage(); await page.goto(base); await page.locator(`[data-topic="${topic.id}"]`).first().click(); await page.locator("#open-toolkit").click(); await page.locator('[data-toolkit-choose="feynman"]').click();
    await page.locator("[data-toolkit-produced]").fill("离开前提交"); await page.locator("[data-toolkit-submit]").click(); await seen;
    await page.locator('[data-command="home"]').click(); await page.locator(".pith-home").waitFor(); release();
    await page.waitForFunction(async (id: string) => (await (await fetch("/api/state")).json()).compass.exploring.find((topic: any) => topic.id === id).notes.length === 1, topic.id);
    assert.equal(guides, 0); assert.equal(await page.locator(".pith-guide").count(), 0); assert.equal(await page.locator(".pith-home").count(), 1);
    const note = (await store.getTopic(topic.id))!.notes[0]!; assert.equal(note.body, "离开前提交"); assert.equal(note.anchor!.file, "source.md"); assert.ok(note.result);
  } finally { release(); if (browser) await browser.close(); await new Promise<void>(ok => { server.close(() => ok()); server.closeAllConnections(); }); await rm(root, { recursive: true, force: true }); }
});
