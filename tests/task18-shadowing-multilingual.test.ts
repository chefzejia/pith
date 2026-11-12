import assert from "node:assert/strict";
import { build } from "esbuild";
import { rm } from "node:fs/promises";
import test from "node:test";
import { renderToolkitAlignment, shadowingToolkit } from "../src/plugins/toolkit-shadowing/index.ts";
import { createPithWebServer } from "../src/shells/web/server.ts";
import { testSandbox } from "./sandbox.ts";
import { linkedEpub } from "./wave12-epub-fixture.ts";
import { installSyntheticVoice, recordSyntheticVoice } from "./task37-voice-fixture.ts";

test("shadowing aligns multilingual text and rejects non-lexical source", () => {
  const chinese = shadowingToolkit.diagnose("清晨阳光照进窗户", "清晨阳光");
  assert.deepEqual(chinese.missedTokens, ["照", "进", "窗", "户"]);
  assert.equal(renderToolkitAlignment(chinese.targetText, chinese.matchedTokens), "清晨阳光<mark>照</mark><mark>进</mark><mark>窗</mark><mark>户</mark>");
  assert.match(chinese.summaryMarkdown, /清晨阳光<mark>照<\/mark><mark>进<\/mark><mark>窗<\/mark><mark>户<\/mark>/);
  const mixed = shadowingToolkit.diagnose("Hello, 世界! déjà vu. Привет мир", "hello 世界 déjà Привет");
  assert.deepEqual(mixed.missedTokens, ["vu", "мир"]);
  assert.equal(renderToolkitAlignment(mixed.targetText, mixed.matchedTokens), "Hello, 世界! déjà <mark>vu</mark>. Привет <mark>мир</mark>");
  const repeated = shadowingToolkit.diagnose("人人人人", "人人"); assert.deepEqual(repeated.missedTokens, ["人", "人"]);
  const safe = shadowingToolkit.diagnose("<script>你好 & world", "你好");
  assert.match(renderToolkitAlignment(safe.targetText, safe.matchedTokens), /&lt;<mark>script<\/mark>&gt;你好 &amp; <mark>world<\/mark>/);
  assert.doesNotMatch(safe.summaryMarkdown, /<script>/);
  assert.throws(() => shadowingToolkit.diagnose("…… 🟢", ""), /没有可对齐/);
});

test("practice notes do not create persistent marks across EPUB pages and chapters", { timeout: 60000, skip: !process.env.PITH_PLAYWRIGHT_MODULE || !process.env.PITH_CHROME_PATH }, async () => {
  const dir = await testSandbox("pith-practice-pages-"); const server = await createPithWebServer({ workspaceDir: dir }); let browser: any;
  try {
    const address = server.address(); assert.ok(address && typeof address !== "string"); const base = `http://127.0.0.1:${address.port}`;
    const post = async (path: string, body: unknown) => { const response = await fetch(base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); assert.ok(response.ok); return response.json(); };
    const topic = await post("/api/topics", { title: "Practice pages" });
    await post("/api/materials", { topicId: topic.id, title: "Book", kind: "book", files: [{ name: "book.epub", data: Buffer.from(linkedEpub()).toString("base64") }] });
    await post(`/api/topics/${topic.id}/toolkits`, { toolkits: ["shadowing"] });
    const highlight = await post("/api/notes", { topicId: topic.id, kind: "highlight", body: "Keep", anchor: { file: "book.epub", locator: "text:offset:0", quote: "Decoy" } });
    const { chromium } = await import(process.env.PITH_PLAYWRIGHT_MODULE!); browser = await chromium.launchPersistentContext(`${dir}/profile`, { executablePath: process.env.PITH_CHROME_PATH, headless: true, viewport: { width: 1000, height: 700 } });
    const page = await browser.newPage(); page.setDefaultTimeout(5000); await installSyntheticVoice(page, "other"); await page.goto(base); await page.locator(`[data-topic="${topic.id}"]`).first().click();
    await page.locator(`.pith-article mark[data-pith-note="${highlight.id}"]`).waitFor();
    await page.locator("#open-toolkit").click(); await page.locator('[data-toolkit-choose="shadowing"]').click(); await recordSyntheticVoice(page); await page.locator("[data-toolkit-save]").click();
    await page.locator('.pith-inline-toolkit [role="status"]').getByText("已记入实训账本").waitFor(); await page.locator("[data-toolkit-close]").click();
    const marks = async () => page.locator('.pith-article mark[data-pith-note]').evaluateAll((nodes: HTMLElement[]) => nodes.map(node => ({ id: node.dataset.pithNote, text: node.textContent })));
    assert.deepEqual(await marks(), [{ id: highlight.id, text: "Decoy" }]);
    const reader = page.locator(".pith-reader"); const initial = await reader.evaluate((node: HTMLElement) => node.scrollLeft);
    await page.locator('[data-page="next"]').click(); await page.waitForFunction((left: number) => (document.querySelector('.pith-reader') as HTMLElement).scrollLeft > left, initial);
    await page.locator('[data-page="previous"]').click(); await page.waitForFunction((left: number) => Math.abs((document.querySelector('.pith-reader') as HTMLElement).scrollLeft - left) < 1, initial);
    await page.locator('.pith-nav-toggle').click(); await page.locator('[data-toc-locator]').filter({ hasText: 'Two' }).click();
    await page.locator('.pith-nav-toggle').click(); await page.locator('[data-toc-locator]').filter({ hasText: 'One' }).click();
    assert.deepEqual(await marks(), [{ id: highlight.id, text: "Decoy" }]);
  } finally { if (browser) await browser.close(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); await rm(dir, { recursive: true, force: true }); }
});

test("Web and Obsidian practice highlight and save Chinese omissions", { timeout: 60000, skip: !process.env.PITH_PLAYWRIGHT_MODULE || !process.env.PITH_CHROME_PATH }, async () => {
  const dir = await testSandbox("pith-shadowing-cjk-"); const server = await createPithWebServer({ workspaceDir: dir }); let browser: any;
  try {
    const address = server.address(); assert.ok(address && typeof address !== "string"); const base = `http://127.0.0.1:${address.port}`;
    const post = async (path: string, body: unknown) => { const response = await fetch(base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); assert.ok(response.ok); return response.json(); };
    const topic = await post("/api/topics", { title: "中文跟读" });
    await post("/api/materials", { topicId: topic.id, title: "中文跟读", kind: "article", files: [{ name: "source.md", data: Buffer.from("清晨阳光照进窗户\n\n这是另一段文字").toString("base64") }] });
    await post(`/api/topics/${topic.id}/toolkits`, { toolkits: ["shadowing", "feynman"] });
    const highlight = await post("/api/notes", { topicId: topic.id, kind: "highlight", body: "用户高亮", anchor: { file: "source.md", locator: "text:line:0", quote: "清晨" } });
    const { chromium } = await import(process.env.PITH_PLAYWRIGHT_MODULE!); browser = await chromium.launchPersistentContext(`${dir}/profile`, { executablePath: process.env.PITH_CHROME_PATH, headless: true, viewport: { width: 1200, height: 800 } });
    const page = await browser.newPage(); await installSyntheticVoice(page, "清晨阳光照进"); await page.goto(base); await page.locator(`[data-topic="${topic.id}"]`).first().click(); await page.locator("#open-toolkit").click(); await page.locator('[data-toolkit-choose="shadowing"]').click();
    await page.waitForFunction(() => document.querySelector("[data-toolkit-display]")?.textContent?.includes("清晨阳光")); await recordSyntheticVoice(page);
    await page.waitForFunction(() => document.querySelectorAll("[data-toolkit-display] mark").length === 2, null, { timeout: 4000 }); assert.equal((await page.locator("[data-toolkit-display] mark").allTextContents()).join(""), "窗户");
    await page.locator("[data-toolkit-save]").click(); await page.waitForFunction(() => document.querySelector(".pith-inline-toolkit [role=status]")?.textContent?.includes("已记入"));
    const state = await (await fetch(`${base}/api/state`)).json(); const note = state.compass.exploring.find((item: any) => item.id === topic.id).notes.find((item: any) => item.kind === "practice");
    assert.match(note.body, /清晨阳光照进<mark>窗<\/mark><mark>户<\/mark>/); assert.doesNotMatch(note.body, /漏词：无/);
    await page.locator('[data-toolkit-close]').click();
    assert.equal(await page.locator('.pith-inline-toolkit').count(), 0);
    assert.equal(await page.locator('.pith-article [data-prose="true"]').first().textContent(), "清晨阳光照进窗户");
    assert.deepEqual(await page.locator('.pith-article mark').evaluateAll((marks: HTMLElement[]) => marks.map(mark => ({ id: mark.dataset.pithNote, text: mark.textContent }))), [{ id: highlight.id, text: "清晨" }]);
    assert.equal(await page.evaluate(() => window.getSelection()!.toString()), "");
    await page.locator("#open-toolkit").click(); await page.locator('[data-toolkit-choose="shadowing"]').click();
    await page.locator('.pith-article [data-prose="true"]').filter({ hasText: "这是另一段文字" }).click();
    await page.locator('[data-toolkit-choose="shadowing"]').click();
    assert.equal(await page.locator('[data-toolkit-display]').textContent(), "这是另一段文字");
    assert.deepEqual(await page.locator('.pith-article mark[data-pith-note]').evaluateAll((marks: HTMLElement[]) => marks.map(mark => ({ id: mark.dataset.pithNote, text: mark.textContent }))), [{ id: highlight.id, text: "清晨" }]);
    await page.locator("#open-toolkit").click(); await page.locator('[data-toolkit-choose="feynman"]').click();
    assert.deepEqual(await page.locator('.pith-article mark[data-pith-note]').evaluateAll((marks: HTMLElement[]) => marks.map(mark => ({ id: mark.dataset.pithNote, text: mark.textContent }))), [{ id: highlight.id, text: "清晨" }]);
    await page.locator('[data-toolkit-close]').click();
    await page.locator('[data-command="home"]').click(); await page.locator(`[data-topic="${topic.id}"]`).first().click();
    await page.locator(`.pith-article mark[data-pith-note="${highlight.id}"]`).waitFor();
    assert.deepEqual(await page.locator('.pith-article mark').evaluateAll((marks: HTMLElement[]) => marks.map(mark => ({ id: mark.dataset.pithNote, text: mark.textContent }))), [{ id: highlight.id, text: "清晨" }]);
    const viewBundle = await build({ entryPoints: ["src/shells/obsidian/plugin.ts"], bundle: true, write: false, platform: "browser", format: "iife", globalName: "PithView" });
    const toolkitBundle = await build({ entryPoints: ["src/plugins/toolkit-shadowing/index.ts"], bundle: true, write: false, platform: "browser", format: "iife", globalName: "Shadow" });
    await page.route('http://localhost:31419/**', (route: any) => route.fulfill({ contentType: 'text/html', body: '<style>html,body,#root{height:100%;margin:0}</style><div id="root"></div>' })); await page.goto('http://localhost:31419/'); await page.addScriptTag({ content: viewBundle.outputFiles[0]!.text }); await page.addScriptTag({ content: toolkitBundle.outputFiles[0]!.text });
    await page.evaluate(async () => { const state: any = (window as any).cjkTest = { saved: "", notes: [{ id: "existing", kind: "highlight", body: "用户高亮", anchor: { file: "source.md", locator: "text:line:0", quote: "清晨" } }] }; const view = new (window as any).PithView.PithObsidianView(document.getElementById("root"), { openFile() {}, selection() {}, openToolkit() {}, guideData: async () => ({ notes: state.notes, conversation: [], actions: [], toolkits: ["shadowing"] }), transcribeAudio: async () => ({ text: "清晨阳光照进" }), savePractice: async (body: string, anchor: unknown) => { state.saved = body; state.notes.push({ id: "practice", kind: "practice", body, anchor }); } }); state.view = view; view.render({ title: "中文跟读", currentFile: "source.md", files: [], sections: [], format: "markdown", html: '<p data-prose="true">清晨阳光照进窗户</p>' }); await view.refreshGuide(); view.setToolkits(["shadowing"]); view.openToolkit([(window as any).Shadow.shadowingToolkit]); });
    await recordSyntheticVoice(page); assert.equal((await page.locator("[data-toolkit-display] mark").allTextContents()).join(""), "窗户");
    await page.locator("[data-toolkit-save]").click(); await page.waitForFunction(() => Boolean((window as any).cjkTest.saved)); assert.doesNotMatch(await page.evaluate(() => (window as any).cjkTest.saved), /漏词：无/);
    assert.match(await page.evaluate(() => (window as any).cjkTest.saved), /照进<mark>窗<\/mark><mark>户<\/mark>/);
    await page.locator('[data-toolkit-close]').click();
    assert.equal(await page.locator('.pith-inline-toolkit').count(), 0);
    assert.equal(await page.locator('.pith-article [data-prose="true"]').first().textContent(), "清晨阳光照进窗户");
    assert.deepEqual(await page.locator('.pith-article mark').evaluateAll((marks: HTMLElement[]) => marks.map(mark => ({ id: mark.dataset.pithNote, text: mark.textContent }))), [{ id: "existing", text: "清晨" }]);
  } finally { if (browser) await browser.close(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); await rm(dir, { recursive: true, force: true }); }
});
