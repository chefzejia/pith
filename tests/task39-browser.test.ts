import { testToolkits } from "./guide-tools-fixture.ts";
import { createTestTopic } from "./topic-fixture.ts";
import assert from "node:assert/strict";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import { DefaultWorkspaceStore } from "../src/core/index.ts";
import { createScopedTools } from "../src/plugins/guide-acp/tools.ts";
import { NodeMediaCorpusPort } from "../src/shells/web/nodeMediaCorpus.ts";
import { NodeWorkspaceStorage } from "../src/shells/web/nodeStorage.ts";
import { createPithWebServer } from "../src/shells/web/server.ts";
import { testSandbox } from "./sandbox.ts";
import { resolveMediaPair } from "../src/workbench/mediaAssets.ts";

test("subtitle pairing uses matching stems and rejects ambiguous media", () => {
  const files = [{ name: "old.wav", mimeType: "audio/wav" }, { name: "new.webm", mimeType: "video/webm" }, { name: "new.en-US.auto.vtt", mimeType: "text/vtt" }];
  assert.equal(resolveMediaPair(files, "new.en-US.auto.vtt").media?.name, "new.webm");
  assert.equal(resolveMediaPair(files, "new.webm").transcript?.name, "new.en-US.auto.vtt");
  assert.equal(resolveMediaPair([...files, { name: "unmatched.vtt", mimeType: "text/vtt" }], "unmatched.vtt").media, null);
  assert.equal(resolveMediaPair([...files, { name: "new.wav", mimeType: "audio/wav" }], "new.en-US.auto.vtt").media, null);
  assert.equal(resolveMediaPair([files[0]!, { name: "other.vtt", mimeType: "text/vtt" }], "other.vtt").media, null);
  assert.equal(resolveMediaPair([files[0]!, { name: "other.vtt", mimeType: "text/vtt" }], "old.wav").transcript, null);
});

test("media selects a matching transcript deterministically across languages", () => {
  const multi = [{ name: "clip.wav", mimeType: "audio/wav" }, { name: "clip.zh.vtt", mimeType: "text/vtt" }, { name: "clip.en.vtt", mimeType: "text/vtt" }];
  assert.equal(resolveMediaPair(multi, "clip.wav").transcript?.name, "clip.en.vtt");
  assert.equal(resolveMediaPair([...multi].reverse(), "clip.wav").transcript?.name, "clip.en.vtt");
  assert.equal(resolveMediaPair([...multi, { name: "clip.vtt", mimeType: "text/vtt" }], "clip.wav").transcript?.name, "clip.vtt");
  assert.equal(resolveMediaPair(multi, "clip.zh.vtt").media?.name, "clip.wav");
  const nested = [...multi, { name: "clip.en.mp4", mimeType: "video/mp4" }];
  assert.equal(resolveMediaPair(nested, "clip.en.vtt").media?.name, "clip.en.mp4");
  assert.equal(resolveMediaPair(nested, "clip.wav").transcript?.name, "clip.zh.vtt");
});

test("guide tool imports real bytes and opens new subtitles in Web", { timeout: 60000, skip: !process.env.PITH_PLAYWRIGHT_MODULE || !process.env.PITH_CHROME_PATH }, async () => {
  const root = await testSandbox("task39-browser-"); const workspace = join(root, "workspace"), binary = join(root, "yt-dlp.cjs"); await mkdir(workspace);
  await writeFile(binary, `#!/usr/bin/env node\nconst fs = require('node:fs'); if (!process.argv.includes('--skip-download')) { fs.copyFileSync(${JSON.stringify(resolve("tests/fixtures/task38-video.webm"))}, process.argv.includes('asr.%(ext)s') ? 'asr.webm' : 'clip.webm'); console.log('Controlled video\\nvp9\\n60'); }\n`); await chmod(binary, 0o755);
  const previous = process.env.PITH_YTDLP_PATH; process.env.PITH_YTDLP_PATH = binary;
  const storage = new NodeWorkspaceStorage(workspace), store = new DefaultWorkspaceStore(storage), corpus = new NodeMediaCorpusPort({ transcribeAudio: async () => ({ text: "First sentence. Second sentence. Third sentence.", durationSec: 4 }) });
  let browser: any; const server = await createPithWebServer({ workspaceDir: workspace, guideProvider: { async run(input, options) { if (input.scope.kind !== "topic") throw new Error("topic required"); const tool = createScopedTools({ toolkits: testToolkits, topicId: input.scope.topicId, store, storage, mediaCorpus: corpus, onChoices: () => {} }).find(item => item.name === "pith_fetch_media_corpus")!; const args = { url: "https://8.8.8.8/asr" }, result = await tool.execute(args); options.onStep({ kind: "tool", name: tool.name, callId: "media", inputPreview: "{}", status: "completed", effects: await tool.effects!(result, args) }, 0); options.onStep({ kind: "reply", markdown: "语料已准备" }, 1); return { status: "completed" }; } } });
  try {
    const address = server.address(); assert.ok(address && typeof address !== "string"); const base = `http://127.0.0.1:${address.port}`;
    const post = async (path: string, body: unknown) => { const response = await fetch(base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); if (!response.ok) throw new Error(await response.text()); return response.json(); };
    const oldAudio = Buffer.alloc(44 + 16000 * 2); oldAudio.write("RIFF"); oldAudio.writeUInt32LE(oldAudio.length - 8, 4); oldAudio.write("WAVEfmt ", 8); oldAudio.writeUInt32LE(16, 16); oldAudio.writeUInt16LE(1, 20); oldAudio.writeUInt16LE(1, 22); oldAudio.writeUInt32LE(16000, 24); oldAudio.writeUInt32LE(32000, 28); oldAudio.writeUInt16LE(2, 32); oldAudio.writeUInt16LE(16, 34); oldAudio.write("data", 36); oldAudio.writeUInt32LE(oldAudio.length - 44, 40);
    const material = await post("/api/materials", { title: "阅读材料", kind: "article", files: [{ name: "lesson.md", mimeType: "text/markdown", data: Buffer.from("# 原始讲义\n原有内容").toString("base64") }, { name: "old.wav", mimeType: "audio/wav", data: oldAudio.toString("base64") }] }); const topic = await createTestTopic(workspace, { title: "阅读材料", materialIds: [material.id], toolkits: ["feynman"] });
    const { chromium } = await import(process.env.PITH_PLAYWRIGHT_MODULE!); browser = await chromium.launch({ executablePath: process.env.PITH_CHROME_PATH, headless: true }); const page = await browser.newPage({ viewport: { width: 390, height: 844 } }); const requested: string[] = []; page.on("request", (request: any) => { const url = new URL(request.url()); if (url.pathname.endsWith('/raw')) requested.push(url.searchParams.get('name') || ''); }); page.setDefaultTimeout(8000); await page.goto(base); await page.locator(`[data-topic="${topic.id}"]`).first().click(); await page.locator('.pith-article').getByText("原始讲义").waitFor(); await page.locator('.pith-guide-toggle').click(); await page.locator('.pith-guide textarea').fill("请找语料"); await page.locator('[data-guide-send]').click(); await page.getByText("语料已准备").waitFor(); await page.locator('.pith-guide-process summary').last().click(); await page.locator('[data-guide-material]').last().click(); await page.locator('.pith-cue').first().getByText("First sentence.").waitFor();
    assert.equal(await page.locator('.pith-cue').count(), 3); const state = await store.getTopic(topic.id); assert.deepEqual(state?.toolkits, topic.toolkits); const importedId = state!.materialIds.find(id => id !== material.id)!; assert.match(await storage.readText(`materials/${importedId}/files/clip.auto.vtt`), /First sentence/); assert.match(await store.readLesson(topic.id, "00-跟读切片导读.md"), /Second sentence/); assert.equal(await storage.readText(`materials/${material.id}/files/lesson.md`), "# 原始讲义\n原有内容");
    await page.waitForFunction(() => (document.querySelector('.pith-timeline-video') as HTMLVideoElement | null)?.readyState! >= 1); assert.equal(requested.at(-1), 'clip.webm'); assert.deepEqual(new Uint8Array(await storage.readBinary(`materials/${importedId}/files/clip.webm`)), new Uint8Array(await readFile('tests/fixtures/task38-video.webm'))); await page.locator('.pith-guide-toggle').click(); await page.locator('[data-media="play"]').click(); await page.waitForFunction(() => !(document.querySelector('.pith-timeline-video') as HTMLVideoElement).paused); assert.ok((await page.locator('.pith-timeline-video').evaluate((video: HTMLVideoElement) => video.duration)) > 0);
    await mkdir(resolve(`${process.env.PITH_TEST_SCREENSHOT_DIR}/task-39`), { recursive: true }); await page.screenshot({ path: resolve(`${process.env.PITH_TEST_SCREENSHOT_DIR}/task-39/audit-f1-web.png`) });
    await page.locator('[data-command="home"]').click(); await page.locator(`[data-topic="${topic.id}"]`).first().click(); await page.locator('.pith-nav-toggle').click(); await page.locator('[data-file="clip.auto.vtt"]').click(); await page.locator('.pith-cue').first().getByText('First sentence.').waitFor(); await page.waitForFunction(() => (document.querySelector('.pith-timeline-video') as HTMLVideoElement | null)?.readyState! >= 1); assert.equal(requested.at(-1), 'clip.webm');
    const unmatched = await store.importMaterial({ title: "Unmatched", kind: "media", files: [{ name: 'unknown.vtt', mimeType: 'text/vtt', bytes: new TextEncoder().encode('WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nUnmatched sentence.\n') }] }); await store.attachMaterial(topic.id, unmatched.id); await page.reload(); await page.locator(`[data-topic="${topic.id}"]`).first().click(); await page.locator('.pith-nav-toggle').click(); const priorRequests = requested.length; await page.locator('[data-file="unknown.vtt"]').click(); await page.locator('.pith-cue').getByText('Unmatched sentence.').waitFor(); assert.equal(await page.locator('.pith-media-deck').isHidden(), true); assert.equal(requested.length, priorRequests);
  } finally { if (browser) await browser.close(); await new Promise<void>((ok, fail) => server.close(error => error ? fail(error) : ok())); if (previous === undefined) delete process.env.PITH_YTDLP_PATH; else process.env.PITH_YTDLP_PATH = previous; await rm(root, { recursive: true, force: true }); }
});
