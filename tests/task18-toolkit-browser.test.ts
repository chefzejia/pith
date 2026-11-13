import { createTestTopic } from "./topic-fixture.ts";
import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { build } from "esbuild";
import test from "node:test";
import { createPithWebServer } from "../src/shells/web/server.ts";
import { testSandbox } from "./sandbox.ts";
import { buildScenePrompt } from "../src/plugins/guide-acp/index.ts";
import { shadowingToolkit } from "../src/plugins/toolkit-shadowing/index.ts";
import { feynmanToolkit } from "../src/plugins/toolkit-feynman/index.ts";
import { installSyntheticVoice, recordSyntheticVoice } from "./task37-voice-fixture.ts";
import { DefaultWorkspaceStore } from "../src/core/store/WorkspaceStore.ts";
import { NodeWorkspaceStorage } from "../src/shells/web/nodeStorage.ts";

test("rubrics and alignment represent the two evaluation modes", () => {
  const result = shadowingToolkit.diagnose("one two one", "one one");
  assert.match(result.summaryMarkdown, /one <mark>two<\/mark> one/);
  assert.doesNotMatch(result.summaryMarkdown, /准确率/);
  assert.equal(feynmanToolkit.evalMode, "guide-rubric");
  const topic = { id: "t", title: "t", target: "", status: "exploring" as const, materialIds: [], lessons: [], toolkits: [], notes: [], createdAt: "", updatedAt: "" };
  const prompt = buildScenePrompt({ topic, materials: [], profileMarkdown: "", userMessage: "复述", instruction: feynmanToolkit.evaluationRubric! });
  assert.match(prompt, /本回合指令/); assert.match(prompt, /反例/);
});

test("unconfigured guide saves practice and reports offline fallback", async () => {
  const dir = await testSandbox("pith-toolkit18-offline-");
  const store = new DefaultWorkspaceStore(new NodeWorkspaceStorage(dir));
  const material = await store.importMaterial({ title: "Offline", kind: "article", files: [{ name: "source.md", bytes: new TextEncoder().encode("Source text.") }] });
  const topic = await store.createTopic({ title: "Offline", target: "Understand source", materialIds: [material.id], toolkits: ["feynman"] });
  const server = await createPithWebServer({ workspaceDir: dir });
  try {
    const address = server.address(); assert.ok(address && typeof address !== "string"); const base = `http://127.0.0.1:${address.port}`;
    const post = async (path: string, body: unknown) => { const response = await fetch(base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); assert.ok(response.ok); return response.json(); };
    const result = await post("/api/toolkit/submit", { topicId: topic.id, materialId: material.id, toolkit: "feynman", file: "source.md", targetText: "Source text.", producedText: "My reasoning", anchor: { source: { kind: "material", materialId: material.id }, file: "source.md", locator: "text:offset:0", quote: "Source text." } });
    assert.equal(result.guided, false); assert.equal(result.note.kind, "practice"); assert.equal(result.note.body, "My reasoning");
    const state = await (await fetch(`${base}/api/state`)).json(); assert.ok(state.compass.exploring.find((item: any) => item.id === topic.id).notes.some((note: any) => note.id === result.note.id));
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); await rm(dir, { recursive: true, force: true }); }
});

test("toolbar practice anchors the visible paragraph after scrolling", { timeout: 30000, skip: !process.env.PITH_PLAYWRIGHT_MODULE || !process.env.PITH_CHROME_PATH }, async () => {
  const dir = await testSandbox("pith-visible-toolkit-"); const server = await createPithWebServer({ workspaceDir: dir }); let browser: any;
  try {
    const address = server.address(); assert.ok(address && typeof address !== "string"); const base = `http://127.0.0.1:${address.port}`;
    const post = async (path: string, body: unknown) => { const response = await fetch(base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); assert.ok(response.ok); return response.json(); };
    const topic = await createTestTopic(dir, { title: "Visible paragraph" });
    await post("/api/materials", { topicId: topic.id, title: "Visible paragraph", kind: "article", files: [{ name: "source.md", data: Buffer.from(`${"First paragraph. ".repeat(400)}\n\nVisible target paragraph.\n\n${"Following text. ".repeat(100)}`).toString("base64") }] });
    await post(`/api/topics/${topic.id}/toolkits`, { toolkits: ["feynman"] });
    const { chromium } = await import(process.env.PITH_PLAYWRIGHT_MODULE!); browser = await chromium.launchPersistentContext(`${dir}/profile`, { executablePath: process.env.PITH_CHROME_PATH, headless: true, viewport: { width: 900, height: 500 } });
    const page = await browser.newPage(); await page.goto(base); await page.locator(`[data-topic="${topic.id}"]`).first().click();
    const target = page.locator('.pith-article [data-prose="true"]').filter({ hasText: "Visible target paragraph." }); await target.evaluate((node: HTMLElement) => node.scrollIntoView({ block: "start" }));
    await page.locator("#open-toolkit").click(); await page.locator('[data-toolkit-choose="feynman"]').click(); await page.locator("[data-toolkit-reveal]").click();
    assert.equal(await page.locator(".pith-toolkit-source").textContent(), "Visible target paragraph.");
  } finally { if (browser) await browser.close(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); await rm(dir, { recursive: true, force: true }); }
});

test("Obsidian toolkit renders one input, anchored source and mode-specific actions", { timeout: 60000, skip: !process.env.PITH_PLAYWRIGHT_MODULE || !process.env.PITH_CHROME_PATH }, async () => {
  const dir = await testSandbox("pith-toolkit18-obsidian-"); let browser: any;
  try {
    const viewBundle = await build({ entryPoints: ["src/shells/obsidian/plugin.ts"], bundle: true, write: false, platform: "browser", format: "iife", globalName: "PithView" });
    const { chromium } = await import(process.env.PITH_PLAYWRIGHT_MODULE!); browser = await chromium.launchPersistentContext(`${dir}/profile`, { executablePath: process.env.PITH_CHROME_PATH, headless: true, viewport: { width: 1200, height: 800 } });
    const page = await browser.newPage(); await installSyntheticVoice(page, "One three four"); await page.route('http://localhost:31419/**', (route: any) => route.fulfill({ contentType: 'text/html', body: '<style>html,body,#root{height:100%;margin:0}</style><div id="root"></div>' })); await page.goto('http://localhost:31419/'); await page.addScriptTag({ content: viewBundle.outputFiles[0]!.text });
    const shadow = await build({ entryPoints: ["src/plugins/toolkit-shadowing/index.ts"], bundle: true, write: false, platform: "browser", format: "iife", globalName: "Shadow" });
    const feynman = await build({ entryPoints: ["src/plugins/toolkit-feynman/index.ts"], bundle: true, write: false, platform: "browser", format: "iife", globalName: "Feynman" });
    await page.addScriptTag({ content: shadow.outputFiles[0]!.text }); await page.addScriptTag({ content: feynman.outputFiles[0]!.text });
    await page.evaluate(() => {
      const state: any = (window as any).toolkitTest = { calls: [] };
      const view = new (window as any).PithView.PithObsidianView(document.getElementById("root"), { openFile() {}, selection() {}, openToolkit(text?: string, locator?: string) { state.view.openToolkit([state.shadow, state.feynman], text, text === undefined ? undefined : { file: "toolkit.md", locator, quote: text }); }, guideData: async () => ({ notes: [], conversation: [], actions: [], toolkits: ["shadowing", "feynman"] }), transcribeAudio: async () => ({ text: "One three four" }), submitPractice: async (body: string, anchor: any, toolkit: any) => { state.calls.push({ body, anchor, rubric: toolkit.evaluationRubric }); return { guided: true }; } });
      state.view = view; document.body.append(view.guideElement()); view.render({ title: "Toolkit", currentFile: "toolkit.md", source: { kind: "material", materialId: "material" }, files: [], sections: [], format: "markdown", html: '<p data-prose="true">One two three four.</p>' }); view.setToolkits(["shadowing", "feynman"]);
      state.shadow = (window as any).Shadow.shadowingToolkit; state.feynman = (window as any).Feynman.feynmanToolkit; view.openToolkit([state.shadow, state.feynman]);
    });
    await page.locator('[data-toolkit-choose="shadowing"]').click(); assert.equal(await page.locator(".pith-inline-toolkit textarea").count(), 0); assert.equal(await page.locator('[data-voice="toolkit"]').count(), 1);
    assert.equal(await page.locator('.pith-article .pith-inline-toolkit[data-toolkit="shadowing"]').count(), 1);
    assert.equal(await page.locator(".pith-toolkit-panel textarea").count(), 0);
    await recordSyntheticVoice(page); assert.equal(await page.locator('[data-toolkit-display] mark').textContent(), "two");
    await page.locator('[data-toolkit-stage="blind-produce"]').click(); assert.equal(await page.locator('[data-toolkit-display] mark').count(), 0); assert.match(await page.locator('[data-toolkit-display]').textContent(), /One two three four/);
    await page.evaluate(() => { const state: any = (window as any).toolkitTest; state.view.openToolkit([state.shadow, state.feynman]); state.view.openToolkit([state.shadow, state.feynman]); });
    await page.locator('[data-toolkit-choose="feynman"]').click(); assert.equal(await page.locator('.pith-toolkit-source').isHidden(), true); assert.equal(await page.locator('[data-toolkit-produced]').inputValue(), ""); await page.locator('[data-toolkit-produced]').fill("Explain"); await page.locator('[data-toolkit-submit]').click();
    assert.equal(await page.locator('.pith-inline-toolkit [data-voice]').count(), 0);
    assert.equal(await page.locator('.pith-article .pith-inline-toolkit[data-toolkit="feynman"]').count(), 1);
    assert.equal(await page.locator('.pith-inline-toolkit [data-toolkit-stage]').count(), 0);
    await page.waitForFunction(() => (window as any).toolkitTest.calls.length === 1); const call = await page.evaluate(() => (window as any).toolkitTest.calls[0]); assert.equal(call.anchor.quote, "One two three four."); assert.equal(call.body, "Explain"); assert.match(call.rubric, /反例/); await page.locator(".pith-guide").waitFor({ state: "visible", timeout: 3000 });
    await page.locator('[data-toolkit-close]').click();
    await page.evaluate(() => { const block = document.querySelector('.pith-article [data-prose="true"]')!, text = block.firstChild!; const selection = window.getSelection()!; selection.setBaseAndExtent(text, 13, text, 4); block.dispatchEvent(new MouseEvent("mouseup", { bubbles: true })); });
    assert.equal(await page.locator('.pith-selection').isVisible(), true);
    await page.locator('#open-toolkit').focus(); await page.locator('#open-toolkit').press('Enter');
    assert.equal(await page.locator('.pith-selection').isHidden(), true);
    assert.equal(await page.evaluate(() => window.getSelection()!.toString()), "two three");
    await page.locator('[data-toolkit-choose="feynman"]').focus(); await page.locator('[data-toolkit-choose="feynman"]').press('Enter');
    assert.equal(await page.locator('.pith-selection').isHidden(), true);
    assert.deepEqual(await page.evaluate(() => { const selection = window.getSelection()!; return { text: selection.getRangeAt(0).toString(), anchor: selection.anchorOffset, focus: selection.focusOffset }; }), { text: "two three", anchor: 13, focus: 4 });
    await page.locator('[data-toolkit-close]').click();
    assert.equal(await page.locator('.pith-selection').isHidden(), true);
    assert.equal(await page.evaluate(() => window.getSelection()!.toString()), "two three");
  } finally { if (browser) await browser.close(); await rm(dir, { recursive: true, force: true }); }
});

test("Web toolkit anchors source, aligns omissions, and persists guided practice", { timeout: 60000, skip: !process.env.PITH_PLAYWRIGHT_MODULE || !process.env.PITH_CHROME_PATH }, async () => {
  const dir = await testSandbox("pith-toolkit18-"); const requests: any[] = [];
  let releaseLate!: () => void, lateSeen!: () => void; const late = new Promise<void>(resolve => { releaseLate = resolve; }); const lateArrived = new Promise<void>(resolve => { lateSeen = resolve; });
  const server = await createPithWebServer({ workspaceDir: dir, guideProvider: { async run(input, options) { requests.push(input); if (input.text.includes("late explanation")) { lateSeen(); await late; } options.onStep({ kind: "reply", markdown: "受控追问" }, 0); return { status: "completed" }; } } }); let browser: any;
  try {
    const address = server.address(); assert.ok(address && typeof address !== "string"); const base = `http://127.0.0.1:${address.port}`;
    const post = async (path: string, body: unknown) => { const response = await fetch(base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); assert.ok(response.ok); return response.json(); };
    const topic = await createTestTopic(dir, { title: "Toolkit" });
    await post("/api/materials", { topicId: topic.id, title: "Toolkit", kind: "article", files: [{ name: "toolkit.md", data: Buffer.from("One two three four.").toString("base64") }] });
    await post(`/api/topics/${topic.id}/toolkits`, { toolkits: ["shadowing", "feynman"] });
    const { chromium } = await import(process.env.PITH_PLAYWRIGHT_MODULE!);
    browser = await chromium.launchPersistentContext(`${dir}/profile`, { executablePath: process.env.PITH_CHROME_PATH, headless: true, viewport: { width: 1200, height: 800 } });
    const page = await browser.newPage(); page.setDefaultTimeout(5000); await installSyntheticVoice(page, "One three four"); await page.goto(base); await page.locator(`[data-topic="${topic.id}"]`).first().click();
    await page.locator("#open-toolkit").click(); await page.locator('[data-toolkit-choose="shadowing"]').click();
    assert.equal(await page.locator('.pith-article .pith-inline-toolkit[data-toolkit="shadowing"]').count(), 1);
    assert.equal(await page.locator(".pith-toolkit-panel textarea").count(), 0);
    await page.waitForFunction(() => document.querySelector("[data-toolkit-display]")?.textContent?.includes("One two three four"));
    assert.equal(await page.locator(".pith-inline-toolkit textarea").count(), 0); assert.equal(await page.locator('[data-voice="toolkit"]').count(), 1);
    await recordSyntheticVoice(page);
    await page.locator("[data-toolkit-display] mark").waitFor(); assert.equal(await page.locator("[data-toolkit-display] mark").textContent(), "two");
    await page.locator('[data-toolkit-stage="guided-follow"]').click();
    await page.locator('[data-toolkit-stage="blind-produce"]').click(); await page.waitForFunction(() => document.querySelector("[data-toolkit-display]")?.textContent?.includes("One two three four")); assert.equal(await page.locator("[data-toolkit-display] mark").count(), 0);
    await page.locator("#open-toolkit").click(); await page.locator("#open-toolkit").click(); assert.equal(await page.locator(".pith-toolkit-panel").isHidden(), true);
    await page.locator("#open-toolkit").click(); await page.locator('[data-toolkit-choose="feynman"]').click();
    assert.equal(await page.locator('[data-toolkit-produced]').inputValue(), "");
    await page.locator("[data-toolkit-produced]").fill("My explanation"); await page.locator("[data-toolkit-submit]").click();
    await page.waitForFunction(() => document.querySelector(".pith-guide-content")?.textContent?.includes("My explanation") && document.querySelector(".pith-guide-content")?.textContent?.includes("受控追问"));
    await page.locator('[data-guide-stop]').waitFor({ state: "detached" });
    await page.locator('.pith-inline-toolkit [role="status"]').getByText("已提交并记入实训账本").waitFor();
    const entry = requests.find(item => item.text === "My explanation"); assert.ok(entry); assert.equal(entry.anchor.quote, "One two three four."); assert.equal(entry.anchor.file, "toolkit.md"); assert.equal(entry.anchor.locator, "text:line:0"); assert.match(entry.instruction, /反例/);
    const state = await (await fetch(`${base}/api/state`)).json(); const updated = state.compass.exploring.find((item: any) => item.id === topic.id); assert.ok(updated.notes.some((note: any) => note.kind === "practice" && note.body === "My explanation"));
    assert.equal(await page.locator(".pith-guide-content").textContent().then((text: string) => text.includes("PITH_PRACTICE:")), false);
    await page.locator("[data-toolkit-produced]").fill("late explanation"); await page.locator("[data-toolkit-submit]").click(); await lateArrived;
    assert.match(await page.locator('.pith-inline-toolkit [role="status"]').textContent(), /正在等待结果/);
    await page.locator('[data-command="home"]').click(); await page.locator(".pith-home").waitFor();
    releaseLate(); await page.waitForFunction(async (id: string) => { const response = await fetch(`/api/chat?topicId=${encodeURIComponent(id)}`); const turns = await response.json(); return turns.at(-1)?.status === "completed"; }, topic.id);
    assert.equal(await page.locator(".pith-home").count(), 1); assert.equal(await page.locator(".pith-guide-content").count(), 0);
    await page.locator(`[data-topic="${topic.id}"]`).first().click();
    await page.locator('.pith-article [data-prose="true"]').first().waitFor();
    await page.evaluate(() => { const root = document.querySelector('.pith-article [data-prose="true"]')!; const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); const nodes: Text[] = []; let node: Node | null; while ((node = walker.nextNode())) if (node.textContent) nodes.push(node as Text); const range = document.createRange(); let offset = 0; for (const text of nodes) { const end = offset + text.length; if (offset <= 4 && end > 4) range.setStart(text, 4 - offset); if (offset < 13 && end >= 13) { range.setEnd(text, 13 - offset); break; } offset = end; } const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range); root.dispatchEvent(new MouseEvent("mouseup", { bubbles: true })); });
    assert.equal(await page.locator('.pith-selection').isVisible(), true);
    await page.locator("#open-toolkit").click();
    assert.equal(await page.locator('.pith-selection').isHidden(), true);
    assert.equal(await page.evaluate(() => window.getSelection()!.toString()), "two three");
    await page.locator('[data-toolkit-choose="feynman"]').click();
    assert.equal(await page.locator('.pith-selection').isHidden(), true);
    assert.equal(await page.evaluate(() => window.getSelection()!.getRangeAt(0).toString()), "two three");
    await page.locator('[data-toolkit-reveal]').click();
    assert.match(await page.locator(".pith-toolkit-source").textContent(), /two three/);
    await page.locator("[data-toolkit-produced]").fill("Selected passage"); await page.locator("[data-toolkit-submit]").click();
    await page.waitForFunction(() => document.querySelector(".pith-guide-content")?.textContent?.includes("Selected passage"));
    await page.locator('.pith-inline-toolkit [role="status"]').getByText("已提交并记入实训账本").waitFor();
    const selectedEntry = requests.find(item => item.text.includes("Selected passage")); assert.equal(selectedEntry.anchor.quote, "two three");
  } finally { releaseLate(); if (browser) await browser.close(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); await rm(dir, { recursive: true, force: true }); }
});
