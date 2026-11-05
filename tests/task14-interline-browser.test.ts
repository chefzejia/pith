import assert from "node:assert/strict";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { build } from "esbuild";
import type { InterlineTranslator } from "../src/core/index.ts";
import { interlineToolkit } from "../src/plugins/dojo-interline/index.ts";
import { renderEpub } from "../src/plugins/stage-reader/epub.ts";
import { InterlineSession, type InterlineUnitInput } from "../src/shells/interline.ts";
import { NodeWorkspaceStorage } from "../src/shells/web/nodeStorage.ts";
import { createPithWebServer } from "../src/shells/web/server.ts";
import { PithObsidianController } from "../src/shells/obsidian/index.ts";
import { buildScenePrompt } from "../src/plugins/guide-acp/index.ts";
import { linkedEpub } from "./wave12-epub-fixture.ts";
import { testSandbox } from "./sandbox.ts";

test("interline appears in guide discovery", () => {
  const prompt = buildScenePrompt({ profileMarkdown: "", topic: { id: "t", title: "English", target: "Read", status: "exploring", toolkits: [], notes: [], createdAt: "", updatedAt: "" }, userMessage: "Read" });
  assert.match(prompt, /interline: 行间双语/);
});

test("interline session warms only the active neighborhood and follows navigation", async () => {
  const dir = await testSandbox("pith-interline-neighborhood-");
  const storage = new NodeWorkspaceStorage(dir), calls: number[] = [];
  const units = Array.from({ length: 5 }, (_, index) => ({ html: `<p data-locator="p:${index}" data-prose="true">Passage ${index}.</p>`, segments: [{ locator: `p:${index}`, blockIndex: 0, sourceText: `Passage ${index}.`, sourceHash: "" }] }));
  const session = new InterlineSession(interlineToolkit, storage, async input => { calls.push(input.unitIndex); return new Map(input.segments.map(segment => [segment.locator, "翻译"])); }, "material", "book.epub", units);
  try {
    await session.render(0, "bilingual"); await session.whenIdle(); assert.deepEqual(calls, [0, 1]);
    await session.render(2, "bilingual"); await session.whenIdle(); assert.deepEqual(calls, [0, 1, 2, 3]);
    await session.render(1, "subtitle-primary"); await session.whenIdle(); assert.deepEqual(calls, [0, 1, 2, 3]);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("Obsidian keeps mounted interline active under essentials and replays cached units", async () => {
  const dir = await testSandbox("pith-interline-controller-"); const storage = new NodeWorkspaceStorage(dir);
  await storage.mkdir("_cache"); await storage.writeText("_cache/web-settings.json", JSON.stringify({ preset: "essentials", persona: "sanctuary", plugins: {} }));
  let calls = 0; const translator: InterlineTranslator = async input => { calls++; return new Map(input.segments.map(segment => [segment.locator, "翻译"])); };
  const controller = new PithObsidianController({ id: "obsidian", storage }, translator);
  try {
    await controller.initialize(); assert.equal(controller.runtime.active("dojo-interline"), false);
    const topic = await controller.store.createTopic({ title: "English" }); await controller.store.updateTopic(topic.id, { toolkits: ["interline"] }); await controller.openCompass();
    assert.equal(controller.runtime.active("dojo-interline"), true); assert.equal(controller.runtime.statuses().find(status => status.id === "dojo-interline")!.inUseCount, 1);
    const units = [{ html: '<p data-locator="p:0" data-prose="true">Hello.</p>', segments: [{ locator: "p:0", blockIndex: 0, sourceText: "Hello.", sourceHash: "" }] }];
    const first = controller.createInterlineSession("material", "book.epub", units); assert.match((await first.render(0, "bilingual")).html, /翻译/); await first.whenIdle();
    const second = controller.createInterlineSession("material", "book.epub", units); assert.match((await second.render(0, "subtitle-primary")).html, /翻译/); await second.whenIdle(); assert.equal(calls, 1);
    await controller.store.updateTopic(topic.id, { toolkits: [] }); await controller.openCompass(); assert.equal(controller.runtime.active("dojo-interline"), false);
  } finally { controller.dispose(); await rm(dir, { recursive: true, force: true }); }
});

test("Web and Obsidian render interline modes, warm neighbors, and speak only source", { timeout: 60000, skip: !process.env.PITH_PLAYWRIGHT_MODULE || !process.env.PITH_CHROME_PATH }, async () => {
  const { chromium } = await import(process.env.PITH_PLAYWRIGHT_MODULE!);
  const dir = await testSandbox("pith-interline-browser-");
  let browser: Awaited<ReturnType<typeof chromium.launchPersistentContext>> | undefined;
  let server: Awaited<ReturnType<typeof createPithWebServer>> | undefined;
  const calls: number[] = [], spoken: string[] = []; let neighborReady!: () => void;
  const neighbor = new Promise<void>(resolve => { neighborReady = resolve; });
  const translator: InterlineTranslator = async input => { calls.push(input.unitIndex); if (input.unitIndex === 1) neighborReady(); return new Map(input.segments.map(segment => [segment.locator, `译文标记 ${segment.blockIndex}`])); };
  try {
    await mkdir(join(dir, "web")); await mkdir(join(dir, "obsidian"));
    server = await createPithWebServer({ workspaceDir: join(dir, "web"), interlineTranslator: translator });
    const address = server.address(); assert.ok(address && typeof address !== "string"); const base = `http://127.0.0.1:${address.port}`;
    const post = async (path: string, body: unknown) => { const response = await fetch(base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); if (!response.ok) throw new Error(await response.text()); return response.json(); };
    const topic = await post("/api/topics", { title: "Interline" });
    const bytes = linkedEpub();
    await post("/api/materials", { topicId: topic.id, title: "Interline", kind: "book", files: [{ name: "book.epub", data: Buffer.from(bytes).toString("base64") }] });
    await post(`/api/topics/${topic.id}/toolkits`, { toolkits: ["interline"] });
    await post("/api/plugins", { preset: "essentials" });
    browser = await chromium.launchPersistentContext(join(dir, "profile"), { executablePath: process.env.PITH_CHROME_PATH, headless: true, viewport: { width: 1200, height: 750 } });
    const page = await browser.newPage();
    await page.route("**/api/speech/synthesize", async (route: any) => { spoken.push(route.request().postDataJSON().text); await route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"stub"}' }); });
    await page.goto(base); await page.locator(`[data-open="${topic.id}"]`).first().click();
    assert.match((await page.locator("#open-dojo").textContent())!, /行间双语/);
    await page.locator("#open-dojo").click(); await page.locator('.training-panel [data-interline-mode="bilingual"]').click();
    await page.locator(".pith-interline-subtitle").first().waitFor();
    await page.waitForFunction(() => document.querySelectorAll(".pith-interline-subtitle").length > 1);
    await neighbor; assert.deepEqual(calls.slice(0, 2), [0, 1]);
    await page.locator('.training-panel [data-interline-mode="subtitle-primary"]').click();
    await page.locator('#article [data-interline-mode="subtitle-primary"] .pith-interline-subtitle').first().waitFor();
    await page.locator('#read-aloud').click();
    await page.locator('#speech-result[role="alert"]').getByText("stub").waitFor();
    assert.ok(spoken.length > 0); assert.ok(spoken.every(text => !text.includes("译文标记")));
    await page.locator('.training-panel [data-interline-mode="original"]').click();
    assert.equal(await page.locator(".pith-interline-subtitle").count(), 0);
    const state = await (await fetch(base + "/api/state")).json(); assert.ok(state.dojos.includes("interline")); assert.equal(state.plugins.find((item: { id: string }) => item.id === "dojo-interline").inUseCount, 1);

    calls.length = 0; spoken.length = 0;
    const bundle = await build({ entryPoints: ["src/shells/obsidian/plugin.ts"], bundle: true, write: false, platform: "browser", format: "iife", globalName: "PithView" });
    const rendered = await renderEpub(bytes), storage = new NodeWorkspaceStorage(join(dir, "obsidian"));
    let session: InterlineSession | undefined;
    await page.exposeFunction("prepareInterline", async (units: InterlineUnitInput[], index: number, mode: "original" | "bilingual" | "subtitle-primary") => { session ??= new InterlineSession(interlineToolkit, storage, translator, "material", "book.epub", units); return session.render(index, mode); });
    await page.exposeFunction("interlineSpeech", (text: string) => { spoken.push(text); throw new Error("stub"); });
    await page.setContent('<style>html,body,#root{height:100%;margin:0}</style><div id="root"></div>');
    await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
    await page.evaluate((documentData: unknown) => { const toolkit = { id: "interline", label: "行间双语", category: "language", stages: [], quickActions: [], transformCue: (text: string) => text, diagnose() { throw new Error("unused"); } }; let view: any; view = new (window as any).PithView.PithObsidianView(document.getElementById("root"), { openFile() {}, selection() {}, openDojo() { view.openDojo([toolkit]); }, prepareInterline: (...args: unknown[]) => (window as any).prepareInterline(...args), synthesizeSpeech: (text: string) => (window as any).interlineSpeech(text) }); view.setToolkits(["interline"]); view.render({ ...(documentData as object), currentFile: "book.epub", files: [], title: "Interline" }); }, rendered);
    await page.locator('[data-command="dojo"]').click(); await page.locator('.pith-dojo-panel [data-interline-mode="bilingual"]').click();
    await page.locator('.pith-interline-subtitle').first().waitFor(); assert.equal(calls[0], 0);
    await page.locator('.pith-dojo-panel [data-interline-mode="subtitle-primary"]').click();
    await page.locator('.pith-article [data-interline-mode="subtitle-primary"] .pith-interline-subtitle').first().waitFor();
    await page.locator('[data-command="read"]').click();
    await page.locator('.pith-speech-controls [role="alert"]').getByText('stub').waitFor();
    assert.ok(spoken.length > 0); assert.ok(spoken.every(text => !text.includes("译文标记")));
    await page.locator('.pith-dojo-panel [data-interline-mode="original"]').click(); assert.equal(await page.locator('.pith-interline-subtitle').count(), 0);
  } finally { if (browser) await browser.close(); if (server) await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve())); await rm(dir, { recursive: true, force: true }); }
});
