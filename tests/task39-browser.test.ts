import assert from "node:assert/strict";
import { chmod, mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import { DefaultWorkspaceStore } from "../src/core/index.ts";
import { createGuideWorkspaceTools } from "../src/plugins/guide-acp/tools.ts";
import { NodeMediaCorpusPort } from "../src/shells/web/nodeMediaCorpus.ts";
import { NodeWorkspaceStorage } from "../src/shells/web/nodeStorage.ts";
import { createPithWebServer } from "../src/shells/web/server.ts";
import { testSandbox } from "./sandbox.ts";

test("guide tool imports real bytes and opens new subtitles in Web", { timeout: 60000, skip: !process.env.PITH_PLAYWRIGHT_MODULE || !process.env.PITH_CHROME_PATH }, async () => {
  const root = await testSandbox("task39-browser-"); const workspace = join(root, "workspace"), binary = join(root, "yt-dlp.cjs"); await mkdir(workspace);
  await writeFile(binary, `#!/usr/bin/env node\nconst fs = require('node:fs'); if (!process.argv.includes('--skip-download')) { fs.copyFileSync(${JSON.stringify(resolve("tests/fixtures/task38-video.webm"))}, process.argv.includes('asr.%(ext)s') ? 'asr.webm' : 'clip.webm'); console.log('Controlled video\\nvp9\\n60'); }\n`); await chmod(binary, 0o755);
  const previous = process.env.PITH_YTDLP_PATH; process.env.PITH_YTDLP_PATH = binary;
  const storage = new NodeWorkspaceStorage(workspace), store = new DefaultWorkspaceStore(storage), corpus = new NodeMediaCorpusPort({ transcribeAudio: async () => ({ text: "First sentence. Second sentence. Third sentence.", durationSec: 4 }) });
  let browser: any; const server = await createPithWebServer({ workspaceDir: workspace, guideProvider: { async reply(input) { const tool = createGuideWorkspaceTools(store, undefined, storage, undefined, undefined, corpus, input.topicId).find(item => item.name === "pith_fetch_media_corpus")!; await tool.execute({ topicId: input.topicId, url: "https://8.8.8.8/asr" }); return "语料已准备"; } } });
  try {
    const address = server.address(); assert.ok(address && typeof address !== "string"); const base = `http://127.0.0.1:${address.port}`;
    const post = async (path: string, body: unknown) => { const response = await fetch(base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); if (!response.ok) throw new Error(await response.text()); return response.json(); };
    const material = await post("/api/materials", { title: "阅读材料", kind: "article", files: [{ name: "lesson.md", mimeType: "text/markdown", data: Buffer.from("# 原始讲义\n原有内容").toString("base64") }] }); const topic = await post("/api/topics", { title: "阅读材料", materialId: material.id, toolkits: ["feynman"] });
    const { chromium } = await import(process.env.PITH_PLAYWRIGHT_MODULE!); browser = await chromium.launch({ executablePath: process.env.PITH_CHROME_PATH, headless: true }); const page = await browser.newPage({ viewport: { width: 390, height: 844 } }); page.setDefaultTimeout(8000); await page.goto(base); await page.locator(`[data-topic="${topic.id}"]`).first().click(); await page.locator('.pith-article').getByText("原始讲义").waitFor(); await page.locator('.pith-guide-toggle').click(); await page.locator('.pith-guide textarea').fill("请找语料"); await page.locator('[data-guide-send]').click(); await page.locator('.pith-cue').first().getByText("First sentence.").waitFor();
    assert.equal(await page.locator('.pith-cue').count(), 3); const state = await store.getTopic(topic.id); assert.ok(state?.toolkits.includes("shadowing")); assert.match(await storage.readText(`materials/${material.id}/files/clip.auto.vtt`), /First sentence/); assert.match(await storage.readText(`materials/${material.id}/files/00-跟读切片导读.md`), /Second sentence/); assert.equal(await storage.readText(`materials/${material.id}/files/lesson.md`), "# 原始讲义\n原有内容");
    await page.locator('.pith-guide-toggle').click(); await mkdir(resolve(".tmp/evidence/task-39"), { recursive: true }); await page.screenshot({ path: resolve(".tmp/evidence/task-39/web-subtitles.png") });
  } finally { if (browser) await browser.close(); await new Promise<void>((ok, fail) => server.close(error => error ? fail(error) : ok())); if (previous === undefined) delete process.env.PITH_YTDLP_PATH; else process.env.PITH_YTDLP_PATH = previous; await rm(root, { recursive: true, force: true }); }
});
