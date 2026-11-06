import assert from "node:assert/strict";
import { build } from "esbuild";
import { rm } from "node:fs/promises";
import test from "node:test";
import { renderDojoAlignment, shadowingToolkit } from "../src/plugins/dojo-shadowing/index.ts";
import { createPithWebServer } from "../src/shells/web/server.ts";
import { testSandbox } from "./sandbox.ts";

test("shadowing aligns multilingual text and rejects non-lexical source", () => {
  const chinese = shadowingToolkit.diagnose("清晨阳光照进窗户", "清晨阳光");
  assert.deepEqual(chinese.missedTokens, ["照", "进", "窗", "户"]);
  assert.equal(renderDojoAlignment(chinese.targetText, chinese.matchedTokens), "清晨阳光<mark>照</mark><mark>进</mark><mark>窗</mark><mark>户</mark>");
  assert.match(chinese.summaryMarkdown, /清晨阳光<mark>照<\/mark><mark>进<\/mark><mark>窗<\/mark><mark>户<\/mark>/);
  const mixed = shadowingToolkit.diagnose("Hello, 世界! déjà vu. Привет мир", "hello 世界 déjà Привет");
  assert.deepEqual(mixed.missedTokens, ["vu", "мир"]);
  assert.equal(renderDojoAlignment(mixed.targetText, mixed.matchedTokens), "Hello, 世界! déjà <mark>vu</mark>. Привет <mark>мир</mark>");
  const repeated = shadowingToolkit.diagnose("人人人人", "人人"); assert.deepEqual(repeated.missedTokens, ["人", "人"]);
  const safe = shadowingToolkit.diagnose("<script>你好 & world", "你好");
  assert.match(renderDojoAlignment(safe.targetText, safe.matchedTokens), /&lt;<mark>script<\/mark>&gt;你好 &amp; <mark>world<\/mark>/);
  assert.doesNotMatch(safe.summaryMarkdown, /<script>/);
  assert.throws(() => shadowingToolkit.diagnose("…… 🟢", ""), /没有可对齐/);
});

test("Web and Obsidian practice highlight and save Chinese omissions", { timeout: 60000, skip: !process.env.PITH_PLAYWRIGHT_MODULE || !process.env.PITH_CHROME_PATH }, async () => {
  const dir = await testSandbox("pith-shadowing-cjk-"); const server = await createPithWebServer({ workspaceDir: dir }); let browser: any;
  try {
    const address = server.address(); assert.ok(address && typeof address !== "string"); const base = `http://127.0.0.1:${address.port}`;
    const post = async (path: string, body: unknown) => { const response = await fetch(base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); assert.ok(response.ok); return response.json(); };
    const topic = await post("/api/topics", { title: "中文跟读" });
    await post("/api/materials", { topicId: topic.id, title: "中文跟读", kind: "article", files: [{ name: "source.md", data: Buffer.from("清晨阳光照进窗户").toString("base64") }] });
    await post(`/api/topics/${topic.id}/toolkits`, { toolkits: ["shadowing"] });
    const { chromium } = await import(process.env.PITH_PLAYWRIGHT_MODULE!); browser = await chromium.launchPersistentContext(`${dir}/profile`, { executablePath: process.env.PITH_CHROME_PATH, headless: true, viewport: { width: 1200, height: 800 } });
    const page = await browser.newPage(); await page.goto(base); await page.locator(`[data-open="${topic.id}"]`).first().click(); await page.locator("#open-dojo").click();
    await page.waitForFunction(() => document.querySelector("#scaffold")?.textContent?.includes("清晨阳光")); await page.locator("#dojo-produced").fill("清晨阳光"); await page.locator("#diagnose").click();
    await page.waitForFunction(() => document.querySelectorAll(".training-panel mark").length === 4, null, { timeout: 4000 }); assert.equal((await page.locator(".training-panel mark").allTextContents()).join(""), "照进窗户");
    await page.locator("#save-diagnosis").click(); await page.waitForFunction(() => document.querySelector(".training-panel .result")?.textContent?.includes("已记入"));
    const state = await (await fetch(`${base}/api/state`)).json(); const note = state.compass.exploring.find((item: any) => item.id === topic.id).notes.find((item: any) => item.kind === "practice");
    assert.match(note.body, /清晨阳光<mark>照<\/mark><mark>进<\/mark><mark>窗<\/mark><mark>户<\/mark>/); assert.doesNotMatch(note.body, /漏词：无/);
    const viewBundle = await build({ entryPoints: ["src/shells/obsidian/plugin.ts"], bundle: true, write: false, platform: "browser", format: "iife", globalName: "PithView" });
    const dojoBundle = await build({ entryPoints: ["src/plugins/dojo-shadowing/index.ts"], bundle: true, write: false, platform: "browser", format: "iife", globalName: "Shadow" });
    await page.setContent('<style>html,body,#root{height:100%;margin:0}</style><div id="root"></div>'); await page.addScriptTag({ content: viewBundle.outputFiles[0]!.text }); await page.addScriptTag({ content: dojoBundle.outputFiles[0]!.text });
    await page.evaluate(() => { const state: any = (window as any).cjkTest = { saved: "" }; const view = new (window as any).PithView.PithObsidianView(document.getElementById("root"), { openFile() {}, selection() {}, openDojo() {}, savePractice: async (body: string) => { state.saved = body; } }); state.view = view; view.render({ title: "中文跟读", currentFile: "source.md", files: [], sections: [], format: "markdown", html: '<p data-prose="true">清晨阳光照进窗户</p>' }); view.setToolkits(["shadowing"]); view.openDojo([(window as any).Shadow.shadowingToolkit]); });
    await page.locator("[data-dojo-produced]").fill("清晨阳光"); await page.locator("[data-dojo-diagnose]").click(); assert.equal((await page.locator(".pith-dojo-panel mark").allTextContents()).join(""), "照进窗户");
    await page.locator("[data-dojo-save]").click(); await page.waitForFunction(() => Boolean((window as any).cjkTest.saved)); assert.doesNotMatch(await page.evaluate(() => (window as any).cjkTest.saved), /漏词：无/);
    assert.match(await page.evaluate(() => (window as any).cjkTest.saved), /<mark>照<\/mark><mark>进<\/mark><mark>窗<\/mark><mark>户<\/mark>/);
  } finally { if (browser) await browser.close(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); await rm(dir, { recursive: true, force: true }); }
});
