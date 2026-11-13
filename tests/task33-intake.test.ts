import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { build } from "esbuild";
import { DefaultWorkspaceStore } from "../src/core/index.ts";
import { renderFile } from "../src/plugins/stage-reader/index.ts";
import { filterProseOnly } from "../src/plugins/speech-service/index.ts";
import { createScopedTools } from "../src/plugins/guide-acp/tools.ts";
import { createPithWebServer } from "../src/shells/web/server.ts";
import { NodeWorkspaceStorage } from "../src/shells/web/nodeStorage.ts";
import { defaultToolkitsForMaterial } from "../src/workbench/toolkitSlot.ts";
import { importedMaterialKind, isMediaFile } from "../src/workbench/mediaAssets.ts";
import { testSandbox } from "./sandbox.ts";

test("material defaults count writing rather than extensions and respect media and repositories", () => {
  const classify = (name: string, sampleText?: string) => defaultToolkitsForMaterial({ kind: "book", files: [{ name }], sampleText });
  assert.deepEqual(classify("数学.pdf"), ["feynman"]);
  assert.deepEqual(classify("数学.epub", "数学.pdf"), ["feynman"]);
  assert.deepEqual(classify("English.epub", "A short English title"), ["interline"]);
  assert.deepEqual(classify("English.epub", "这是中文正文"), ["feynman"]);
  assert.deepEqual(classify("混排.pdf", "AB中文"), ["interline"]);
  assert.deepEqual(classify("混排.pdf", "A1"), ["interline"]);
  assert.deepEqual(classify("混排.pdf", "ABC你好!!!"), ["feynman"]);
  assert.deepEqual(classify("混排.pdf", "ABC你好123"), ["feynman"]);
  assert.deepEqual(defaultToolkitsForMaterial({ kind: "article", files: [{ name: "字幕.srt" }] }), ["shadowing"]);
  assert.deepEqual(defaultToolkitsForMaterial({ kind: "article", files: [{ name: "sample.ts", mimeType: "video/mp2t" }], sampleText: "这是中文代码" }), ["feynman"]);
  assert.equal(importedMaterialKind([{ name: "sample.ts", mimeType: "video/mp2t" }]), "article");
  assert.equal(importedMaterialKind([{ name: "sample.ts", mimeType: "video/mp2t" }, { name: "clip.mp4", mimeType: "video/mp4" }]), "media");
  assert.equal(isMediaFile({ name: "recording.flac", mimeType: "application/octet-stream" }), true);
  assert.equal(isMediaFile({ name: "film.bin", mimeType: "video/mp2t" }), true);
  assert.deepEqual(defaultToolkitsForMaterial({ kind: "repo", files: [] }), ["feynman"]);
});

test("source reader escapes markup, anchors every line and rejects binary", async () => {
  const file = { name: "example.abc", mimeType: "application/octet-stream", bytes: 0, sha256: "" };
  const view = await renderFile(file, new TextEncoder().encode('<script>alert("x")</script>\nsecond & third\n'));
  assert.match(view.html, /&lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt;/);
  assert.match(view.html, /data-locator="text:line:1"[^>]*>second &amp; third/);
  assert.deepEqual(view.blocks?.map(block => block.locator), ["text:line:0", "text:line:1", "text:line:2"]);
  await assert.rejects(renderFile(file, new Uint8Array([65, 0, 66])), /binary/);
  await assert.rejects(renderFile(file, new Uint8Array([255])), /binary/);
});

test("imported source remains trainable but is excluded from prose and guide validates bytes", async () => {
  const root = await testSandbox("audit-source-");
  try {
    const storage = new NodeWorkspaceStorage(root), store = new DefaultWorkspaceStore(storage);
    await store.ensureScaffold();
    const reader = { formats: ["markdown" as const], sections: () => [], render: () => "", renderFile };
    for (const [name, mimeType] of [["sample.ts", "video/mp2t"], ["module.py", "application/octet-stream"]]) {
      const bytes = new TextEncoder().encode("const answer = 42;\nnext line");
      const material = await store.importMaterial({ title: name!, kind: "article", files: [{ name: name!, mimeType: mimeType!, bytes }] });
      const topic = await store.createTopic({ title: name!, target: "Read source", materialIds: [material.id], toolkits: [] });
      const read = createScopedTools({ topicId: topic.id, store, storage, reader, onChoices: () => {} }).find(tool => tool.name === "pith_read_material")!;
      const view = await renderFile(material.files[0]!, bytes);
      assert.deepEqual(filterProseOnly(view.blocks!), []);
      assert.match(view.html, /data-prose="false" data-trainable="true"/);
      assert.match((await read.execute({ materialId: material.id, file: name }) as { blocks: { text: string }[] }).blocks.map(block => block.text).join("\n"), /answer = 42/);
    }
    for (const name of ["prose.txt", "prose.abc"]) {
      const bytes = new TextEncoder().encode("Natural prose.\nAnother sentence.");
      const view = await renderFile({ name, mimeType: "application/octet-stream", bytes: bytes.length, sha256: "" }, bytes);
      assert.equal(filterProseOnly(view.blocks!).length, 2);
      assert.match(view.html, /data-prose="true"/);
    }
    for (const bytes of [new Uint8Array([65, 0, 66]), new Uint8Array([255])]) {
      const material = await store.importMaterial({ title: "invalid", kind: "article", files: [{ name: "invalid.ts", mimeType: "text/plain", bytes }] });
      const topic = await store.createTopic({ title: "invalid", target: "Read source", materialIds: [material.id], toolkits: [] });
      const read = createScopedTools({ topicId: topic.id, store, storage, reader, onChoices: () => {} }).find(tool => tool.name === "pith_read_material")!;
      await assert.rejects(read.execute({ materialId: material.id, file: "invalid.ts" }), /binary/);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("real HTTP intake and repository binding preserve explicitly selected toolkit lists", async () => {
  const root = await testSandbox("task33-http-");
  const repo = join(root, "repo"), workspace = join(root, "workspace"); await mkdir(repo); await mkdir(workspace);
  const git = promisify(execFile), env = { PATH: process.env.PATH, HOME: root, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_AUTHOR_NAME: "Fixture", GIT_AUTHOR_EMAIL: "fixture@example.invalid", GIT_COMMITTER_NAME: "Fixture", GIT_COMMITTER_EMAIL: "fixture@example.invalid" };
  await git("git", ["-C", repo, "init", "-q"], { env }); await writeFile(join(repo, "source.ts"), "export const value = 1;\n"); await git("git", ["-C", repo, "add", "source.ts"], { env }); await git("git", ["-C", repo, "commit", "-qm", "fixture"], { env });
  const storage = new NodeWorkspaceStorage(workspace), store = new DefaultWorkspaceStore(storage);
  const server = await createPithWebServer({ workspaceDir: workspace, guideProvider: { async run(input, options) {
    assert.equal(input.scope.kind, "intake"); if (input.scope.kind !== "intake") throw new Error("intake required");
    const create = createScopedTools({ store, storage, materialIds: input.scope.materialIds, onChoices() {} }).find(item => item.name === "pith_create_topic")!;
    const args = { title: input.text, target: input.text, materialIds: input.scope.materialIds, toolkits: input.text === "空工具" ? [] : ["feynman"] };
    const topic = await create.execute(args);
    options.onStep({ kind: "tool", callId: "create", name: create.name, inputPreview: "{}", status: "completed", effects: await create.effects!(topic, args) }, 0);
    return { status: "completed" };
  } } });
  try {
    const address = server.address(); assert.ok(address && typeof address !== "string"); const base = `http://127.0.0.1:${address.port}`;
    const post = async (path: string, value: unknown) => { const response = await fetch(base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(value) }); assert.equal(response.status, 201, await response.clone().text()); return response.json() as Promise<any>; };
    const material = await post("/api/materials/repo", { repoPath: repo }); assert.equal(material.kind, "repo"); assert.match(material.commitSha, /^[a-f0-9]{40,64}$/);
    assert.deepEqual((await post("/api/intake", { text: "仓库", materialIds: [material.id] })).topic.toolkits, ["feynman"]);
    assert.deepEqual((await post("/api/intake", { text: "空工具", materialIds: [material.id] })).topic.toolkits, []);
    const text = await post("/api/materials", { title: "标题", kind: "article", files: [{ name: "中文.ts", data: Buffer.from("这是中文正文").toString("base64") }] });
    assert.deepEqual((await post("/api/intake", { text: "标题", materialIds: [text.id] })).topic.toolkits, ["feynman"]);
  } finally { await new Promise<void>((ok, fail) => server.close(error => error ? fail(error) : ok())); await rm(root, { recursive: true, force: true }); }
});

test("browser intake binds Git, opens guide, refreshes generated lesson and persists toolkit changes", { timeout: 60000, skip: !process.env.PITH_PLAYWRIGHT_MODULE || !process.env.PITH_CHROME_PATH }, async () => {
  const root = await testSandbox("task33-browser-"), repo = join(root, "repo with spaces"), workspace = join(root, "workspace"); await mkdir(repo); await mkdir(workspace);
  const git = promisify(execFile), env = { PATH: process.env.PATH, HOME: root, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_AUTHOR_NAME: "Fixture", GIT_AUTHOR_EMAIL: "fixture@example.invalid", GIT_COMMITTER_NAME: "Fixture", GIT_COMMITTER_EMAIL: "fixture@example.invalid" };
  await git("git", ["-C", repo, "init", "-q"], { env }); await writeFile(join(repo, "source.ts"), "export const fixture = true;\n"); await git("git", ["-C", repo, "add", "."], { env }); await git("git", ["-C", repo, "commit", "-qm", "fixture"], { env });
  const store = new DefaultWorkspaceStore(new NodeWorkspaceStorage(workspace));
  let replies = 0;
  const http = { request: async () => { throw new Error("unexpected request"); }, requestPublic: async () => { const text = "# English blog\n\nA complete English article about learning and reading."; return { status: 200, headers: { "content-type": "text/markdown" }, bytes: new TextEncoder().encode(text), text: () => text }; } };
  const server = await createPithWebServer({ workspaceDir: workspace, guideProvider: { async run(input, options) {
    let topicId: string;
    if (input.scope.kind === "intake") {
      const tools = createScopedTools({ materialIds: input.scope.materialIds, store, storage: new NodeWorkspaceStorage(workspace), http, onChoices: () => {} });
      const create = tools.find(item => item.name === "pith_create_topic")!;
      const args = { title: input.text, target: input.text, materialIds: input.scope.materialIds, toolkits: input.text === "英文博客回归" || input.text === "学习源代码" ? ["interline"] : ["feynman"] };
      const topic = await create.execute(args) as { id: string }; topicId = topic.id;
      options.onStep({ kind: "tool", callId: "create", name: create.name, inputPreview: "{}", status: "completed", effects: await create.effects!(topic, args) }, 0);
    } else topicId = input.scope.topicId;
    const topic = await store.getTopic(topicId); assert.ok(topic);
    if (topic.title === "英文博客回归") {
      const tool = createScopedTools({ topicId, store, storage: new NodeWorkspaceStorage(workspace), http, onChoices: () => {} }).find(item => item.name === "pith_ingest_external")!;
      await tool.execute({ url: "https://public.com/blog" });
    }
    const turn = replies++;
    if (turn === 0) { await store.writeLesson(topicId, "00-课程大纲.md", "# 受控课程大纲\n第一讲"); await store.writeLesson(topicId, "01-第一讲.md", "# 第一讲\n真实内容"); }
    if (turn === 2) await store.writeLesson(topicId, "02-第二讲.md", "# 第二讲");
    options.onStep({ kind: "reply", markdown: "课程已准备" }, input.scope.kind === "intake" ? 1 : 0); return { status: "completed" };
  } } });
  let browser: any;
  try {
    const address = server.address(); assert.ok(address && typeof address !== "string"); const base = `http://127.0.0.1:${address.port}`;
    const { chromium } = await import(process.env.PITH_PLAYWRIGHT_MODULE!); browser = await chromium.launch({ executablePath: process.env.PITH_CHROME_PATH, headless: true });
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 } }); await page.goto(base);
    const evidence = resolve(`${process.env.PITH_TEST_SCREENSHOT_DIR}/task-33`); await mkdir(evidence, { recursive: true }); await page.screenshot({ path: join(evidence, "intake.png") });
    await page.locator('[name="title"]').fill(`学习仓库 ${JSON.stringify(repo)}`); await page.locator("[data-intake-open]").click();
    await page.getByText("受控课程大纲").first().waitFor(); assert.equal(await page.locator(".pith-guide").isVisible(), true);
    await page.locator(".pith-nav-toggle").click(); assert.equal(await page.getByText("01-第一讲.md").count(), 1); const oldContent = await page.locator('.pith-guide-content').elementHandle(); await page.locator('[data-file="01-第一讲.md"]').click(); await page.waitForFunction((old: HTMLElement) => !old.isConnected, oldContent);
    await page.waitForFunction(() => document.querySelector('.pith-article h1')?.textContent === '第一讲'); await page.evaluate(() => { (window as any).readingNode = document.querySelector(".pith-article h1"); });
    await page.locator('.pith-guide textarea').fill("普通问题"); await page.locator('[data-guide-send]').click();
    try { await page.getByText("普通问题").waitFor({ timeout: 8000 }); } catch (error) { throw new Error(`web guide: ${await page.locator('.pith-guide').innerText()} replies=${replies}`, { cause: error }); }
    assert.equal(await page.evaluate(() => (window as any).readingNode === document.querySelector(".pith-article h1")), true); assert.equal(await page.locator(".pith-article h1").textContent(), "第一讲");
    await page.locator('.pith-guide textarea').fill("继续生成"); await page.locator('[data-guide-send]').click(); await page.getByText("继续生成").waitFor(); assert.equal(await page.locator(".pith-article h1").textContent(), "第一讲"); await page.locator('.pith-nav-toggle').click(); await page.getByText("02-第二讲.md").waitFor();
    await page.locator("#open-toolkit").click(); await page.locator('[data-toolkit-remove="feynman"]').click(); await page.locator('[data-toolkit-choose="interline"]').click(); await page.locator('[data-interline-mode="bilingual"]').waitFor();
    await page.screenshot({ path: join(evidence, "guide-toolkit.png") });
    const state = await (await fetch(base + "/api/state")).json() as any; assert.deepEqual(state.compass.exploring[0].toolkits, ["interline"]);
    await page.setViewportSize({ width: 390, height: 844 }); await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))); await page.screenshot({ path: join(evidence, "fix-web-narrow.png") }); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.equal(await page.locator('.pith-toolkit-panel').evaluate((panel: HTMLElement) => panel.scrollWidth <= panel.clientWidth && Array.from(panel.querySelectorAll('button')).every(button => getComputedStyle(button).whiteSpace === 'nowrap' && button.scrollWidth <= button.clientWidth)), true);
    await page.locator('[data-command="home"]').click(); await page.locator('.pith-intake-box input[type="file"]').setInputFiles({ name: "example.ts", mimeType: "video/mp2t", buffer: Buffer.from('const value = "<script>";\nsecond line') }); await page.locator('[name="title"]').fill("学习源代码"); await page.locator('[data-intake-open]').click();
    await page.locator('.pith-article [data-locator="text:line:1"]').getByText("second line").waitFor(); assert.equal(await page.locator('.pith-article script').count(), 0); assert.match(await page.locator('.pith-article').textContent(), /<script>/);
    assert.equal(await page.locator('.pith-article [data-prose="true"]').count(), 0);
    await page.locator('[data-command="read"]').click(); await page.getByText("当前页面没有可朗读的正文段落").waitFor();
    await page.locator('#open-toolkit').click(); await page.locator('[data-toolkit-choose="feynman"]').click(); await page.locator('[data-toolkit-close]').waitFor(); await page.locator('#open-toolkit').click();
    await page.locator('.pith-article [data-locator="text:line:1"]').click(); await page.locator('[data-toolkit-choose="feynman"]').click();
    assert.match(await page.locator('.pith-toolkit-source').textContent(), /second line/);
    await page.screenshot({ path: resolve(`${process.env.PITH_TEST_SCREENSHOT_DIR}/audit-fix/web-source-feynman.png`) });
    await page.setViewportSize({ width: 1200, height: 800 }); await page.locator('[data-command="home"]').click(); await page.locator('[name="title"]').fill('英文博客回归'); await page.locator('[data-intake-open]').click(); await page.locator('.pith-article').getByText('A complete English article about learning and reading.').waitFor(); await page.waitForFunction(() => document.querySelector('#open-toolkit')?.textContent?.includes('行间'));
    const blogTopic = (await store.listTopics()).find(item => item.title === '英文博客回归')!; assert.deepEqual(blogTopic.toolkits, ['interline']); await mkdir(resolve(`${process.env.PITH_TEST_SCREENSHOT_DIR}/task-39`), { recursive: true }); await page.screenshot({ path: resolve(`${process.env.PITH_TEST_SCREENSHOT_DIR}/task-39/f2-web-blog.png`) });
    await page.reload(); await page.locator(`[data-topic="${blogTopic.id}"]`).first().click(); await page.locator('.pith-article').getByText('A complete English article about learning and reading.').waitFor(); assert.match(await page.locator('#open-toolkit').textContent(), /行间/);
  } finally { if (browser) await browser.close(); await new Promise<void>((ok, fail) => server.close(error => error ? fail(error) : ok())); await rm(root, { recursive: true, force: true }); }
});

test("native shared surface opens empty topic and refreshes a generated lesson", { timeout: 60000, skip: !process.env.PITH_PLAYWRIGHT_MODULE || !process.env.PITH_CHROME_PATH }, async () => {
  const root = await testSandbox("task33-native-"); let browser: any;
  const host = createServer((_req, res) => res.end("<!doctype html>")); await new Promise<void>(ok => host.listen(0, "127.0.0.1", ok));
  try {
    const bundle = await build({ entryPoints: ["src/shells/obsidian/index.ts"], bundle: true, write: false, platform: "browser", format: "iife", globalName: "NativePith", external: ["node:*", "obsidian"] });
    const toolsBundle = await build({ entryPoints: ["tests/guide-tools-fixture.ts"], bundle: true, write: false, platform: "browser", format: "iife", globalName: "GuideTools" });
    const { chromium } = await import(process.env.PITH_PLAYWRIGHT_MODULE!); browser = await chromium.launch({ executablePath: process.env.PITH_CHROME_PATH, headless: true });
    const page = await browser.newPage({ viewport: { width: 1100, height: 800 } }); page.setDefaultTimeout(8000);
    const address = host.address(); assert.ok(address && typeof address !== "string"); await page.goto(`http://127.0.0.1:${address.port}`);
    await page.setContent('<style>html,body{height:100%;margin:0}#root{height:100%;width:75%}#side{position:absolute;right:0;top:0;width:25%;height:100%}body{--background-primary:#fff;--background-secondary:#f1f3ef;--background-modifier-border:#ccd5cd;--background-modifier-hover:#e1e9e2;--text-normal:#222;--text-muted:#666;--font-interface:Arial}</style><div id="root"></div><div id="side"></div>');
    await page.evaluate(() => { (window as any).require = (id: string) => id === "obsidian" ? { ItemView: class { contentEl: HTMLElement | null; constructor(leaf: any) { this.contentEl = leaf?.container || document.getElementById("root"); } }, Plugin: class {}, Notice: class { constructor(message: string) { (window as any).notice = message; } } } : id === "node:util" ? { promisify: (fn: unknown) => fn } : id === "node:net" ? { BlockList: class { addSubnet() {} } } : {}; });
    await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
    await page.addScriptTag({ content: toolsBundle.outputFiles[0]!.text });
    await page.evaluate(async () => {
      const data = new Map<string, Uint8Array>(), folders = new Set<string>(); (window as any).nativeBytes = data; const encoder = new TextEncoder(), decoder = new TextDecoder();
      const wav = (seconds: number) => { const bytes = new Uint8Array(44 + 16000 * 2 * seconds), header = new DataView(bytes.buffer); bytes.set(encoder.encode('RIFF'), 0); header.setUint32(4, bytes.length - 8, true); bytes.set(encoder.encode('WAVEfmt '), 8); header.setUint32(16, 16, true); header.setUint16(20, 1, true); header.setUint16(22, 1, true); header.setUint32(24, 16000, true); header.setUint32(28, 32000, true); header.setUint16(32, 2, true); header.setUint16(34, 16, true); bytes.set(encoder.encode('data'), 36); header.setUint32(40, bytes.length - 44, true); return bytes; };
      (window as any).nativeOldWav = wav(1);
      const storage = { exists: async (path: string) => data.has(path) || folders.has(path), readText: async (path: string) => { if (!data.has(path)) throw new Error("missing " + path); return decoder.decode(data.get(path)); }, readBinary: async (path: string) => { const value = data.get(path); if (!value) throw new Error("missing " + path); return value; }, writeText: async (path: string, text: string) => { data.set(path, encoder.encode(text)); }, createText: async (path: string, text: string) => { if (data.has(path)) throw new Error("exists"); data.set(path, encoder.encode(text)); }, writeBinary: async (path: string, bytes: Uint8Array) => { data.set(path, bytes); }, createBinary: async (path: string, bytes: Uint8Array) => { if (data.has(path)) throw new Error("exists"); data.set(path, bytes); }, processText: async (path: string, update: (text: string) => string) => { const result = update(decoder.decode(data.get(path))); data.set(path, encoder.encode(result)); return result; }, mkdir: async (path: string) => { folders.add(path); }, list: async (path: string) => [...folders, ...data.keys()].filter(item => item.startsWith(path + "/") && !item.slice(path.length + 1).includes("/")).map(item => ({ path: item, type: folders.has(item) ? "folder" : "file" })) };
      const repository = { async inspectRepository(path: string) { if (path !== "/fixture/repo with spaces") throw Object.assign(new Error("missing"), { code: "ENOENT", syscall: "realpath" }); return { externalPath: path, title: "repo with spaces", commitSha: "a".repeat(40) }; }, async listFiles() { return { files: [], total: 0, nextOffset: null }; } };
      const mediaCorpus = { async fetchMediaCorpus() { return { title: "语料", sourceUrl: "https://8.8.8.8/watch", files: [{ name: "clip.en.vtt", mimeType: "text/vtt", bytes: encoder.encode("WEBVTT\n\n00:00:00.000 --> 00:00:03.000\nNative subtitle.\n") }, { name: "clip.wav", mimeType: "audio/wav", bytes: wav(3) }], slices: [{ id: "slice-1", title: "片段 1 (00:00 - 00:03)", startSec: 0, endSec: 3, cueCount: 1, text: "Native subtitle." }] }; } };
      const http = { request: async () => { throw new Error("unexpected request"); }, requestPublic: async () => { const text = "# English blog\n\nA complete English article about learning and reading."; return { status: 200, headers: { "content-type": "text/markdown" }, bytes: encoder.encode(text), text: () => text }; } };
      const host = { id: "obsidian", storage, repository, mediaCorpus, http }; let controller: any; const received: string[] = []; (window as any).guideReceived = received;
      const provider = { async run({ scope, text }: any, options: any) {
        received.push(text); let topicId = scope.topicId, index = 0;
        if (scope.kind === "intake") {
          const tool = (window as any).GuideTools.createScopedTools({ materialIds: scope.materialIds, store: controller.store, storage, onChoices: () => {} }).find((item: any) => item.name === "pith_create_topic");
          const args = { title: text, target: text, materialIds: scope.materialIds, toolkits: text.includes("英文博客") || text.includes("源代码") ? ["interline"] : ["feynman"] }, topic = await tool.execute(args); topicId = topic.id;
          options.onStep({ kind: "tool", callId: "create", name: tool.name, inputPreview: "{}", status: "completed", effects: await tool.effects(topic, args) }, index++);
        }
        if (text.includes("原生英文博客回归")) { (window as any).initialBlogTopic = await controller.store.getTopic(topicId); const tool = (window as any).GuideTools.createScopedTools({ topicId, store: controller.store, storage, http, onChoices: () => {} }).find((item: any) => item.name === "pith_ingest_external"); await tool.execute({ url: "https://public.com/blog" }); }
        else if (received.length === 1) { await controller.store.writeLesson(topicId, "00-课程大纲.md", "# 原生课程大纲\n- [01-第一讲.md] 原生第一讲\n- [原生第二讲](./02-第二讲.md)\n- [第三讲](03-第三讲.md#section)"); await controller.store.writeLesson(topicId, "01-第一讲.md", "# 原生第一讲\n## 概览\n真实内容"); }
        else if (text.includes("导入语料")) { const tool = (window as any).GuideTools.createScopedTools({ topicId, store: controller.store, storage, mediaCorpus, onChoices: () => {} }).find((item: any) => item.name === "pith_fetch_media_corpus"), args = { url: "https://8.8.8.8/watch" }, result = await tool.execute(args); options.onStep({ kind: "tool", callId: "media", name: tool.name, inputPreview: "{}", status: "completed", effects: await tool.effects(result, args) }, index++); }
        else if (text.includes("02-第二讲.md")) await controller.store.writeLesson(topicId, "02-第二讲.md", "# 原生第二讲\n生成正文");
        else if (text.includes("03-第三讲.md")) { await new Promise<void>(resolve => { (window as any).releaseNativeLesson = resolve; }); await controller.store.writeLesson(topicId, "03-第三讲.md", "# 原生第三讲\n真实落盘"); }
        options.onStep({ kind: "reply", markdown: "受控向导回复" }, index); return { status: "completed" };
      } };
      controller = new (window as any).NativePith.PithObsidianController(host, undefined, provider); await controller.initialize();
      const leaf: any = { container: document.getElementById("side"), detach() {}, async setViewState() { this.view = new (window as any).NativePith.PithGuideView(this); } }; const workspace = { rightSplit: { expand() {}, collapse() {} }, getRightLeaf: () => leaf, getLeavesOfType: () => leaf.view ? [leaf] : [], revealLeaf: async () => {} };
      const view = new (window as any).NativePith.PithWorkspaceView({}, controller, host, workspace); (window as any).nativeController = controller; (window as any).nativeWorkspaceView = view; await view.onOpen();
    });
    await mkdir(resolve(`${process.env.PITH_TEST_SCREENSHOT_DIR}/task-35`), { recursive: true }); await page.screenshot({ path: resolve(`${process.env.PITH_TEST_SCREENSHOT_DIR}/task-35/native-home.png`) });
    await page.locator('[name="title"]').fill("原生空课题"); await page.locator("[data-intake-open]").click();
    try { await page.getByText("原生课程大纲").first().waitFor({ timeout: 8000 }); } catch (error) { throw new Error(`native state: ${await page.locator("body").innerText()} notice=${await page.evaluate(() => (window as any).notice)}`, { cause: error }); }
    await page.locator('.pith-nav-toggle').click(); await page.locator('[data-file="01-第一讲.md"]').click(); await page.locator('.pith-article').getByText("原生第一讲").waitFor(); await page.evaluate(() => { (window as any).readingNode = document.querySelector(".pith-article h1"); });
    await page.locator('.pith-guide textarea').fill("普通问题"); await page.locator('[data-guide-send]').click(); await page.waitForFunction(() => !(document.querySelector('[data-guide-send]') as HTMLButtonElement).disabled);
    assert.equal(await page.evaluate(() => (window as any).readingNode === document.querySelector(".pith-article h1")), true); assert.equal(await page.locator('.pith-article h1').textContent(), "原生第一讲");
    const conversation = await page.evaluate(async () => { const c = (window as any).nativeController; const topic = (await c.store.listTopics())[0]; return { received: (window as any).guideReceived, entries: await c.engine.getConversation(topic.id) }; });
    assert.equal(conversation.received.at(-1), "普通问题"); assert.equal(conversation.entries.at(-1).user.text, "普通问题"); assert.equal(conversation.entries.at(-1).steps.find((step: any) => step.kind === "reply").markdown, "受控向导回复");
    await page.evaluate(async () => { const c = (window as any).nativeController, t = (await c.store.listTopics())[0], m = await c.store.importMaterial({ title: 'old audio', kind: 'media', files: [{ name: 'old.wav', mimeType: 'audio/wav', bytes: (window as any).nativeOldWav }] }); await c.store.attachMaterial(t.id, m.id); });
    await page.locator('.pith-guide textarea').fill("导入语料"); await page.locator('[data-guide-send]').click(); await page.locator('.pith-guide-process summary').last().click(); await page.locator('[data-guide-material]').last().click(); await page.locator('.pith-cue').getByText("Native subtitle.").waitFor(); assert.match(await page.evaluate(async () => { const c = (window as any).nativeController, t = (await c.store.listTopics())[0]; for (const id of t.materialIds) { const bytes = (window as any).nativeBytes.get(`materials/${id}/files/clip.en.vtt`); if (bytes) return new TextDecoder().decode(bytes); } return ''; }), /Native subtitle/);
    await page.waitForFunction(() => (window as any).nativeWorkspaceView.view?.assetAudio?.readyState >= 1); assert.deepEqual(await page.evaluate(() => ({ name: (window as any).nativeWorkspaceView.view.assetSource.name, duration: (window as any).nativeWorkspaceView.view.assetAudio.duration })), { name: 'clip.wav', duration: 3 }); await page.locator('[data-media="play"]').click(); await page.waitForFunction(() => !(window as any).nativeWorkspaceView.view.assetAudio.paused);
    const nativeTopicId = await page.evaluate(async () => (await (window as any).nativeController.store.listTopics())[0].id); await page.locator('[data-command="home"]').click(); await page.locator(`[data-topic="${nativeTopicId}"]`).first().click(); await page.locator('.pith-nav-toggle').click(); await page.locator('[data-file="clip.en.vtt"]').click(); await page.waitForFunction(() => (window as any).nativeWorkspaceView.view?.assetAudio?.readyState >= 1); assert.equal(await page.evaluate(() => (window as any).nativeWorkspaceView.view.assetSource.name), 'clip.wav');
    await mkdir(resolve(`${process.env.PITH_TEST_SCREENSHOT_DIR}/task-39`), { recursive: true }); await page.screenshot({ path: resolve(`${process.env.PITH_TEST_SCREENSHOT_DIR}/task-39/audit-f1-native.png`) }); await page.locator('.pith-nav-toggle').click(); await page.locator('[data-file="01-第一讲.md"]').click(); await page.locator('.pith-article').getByText("原生第一讲").waitFor();
    await page.locator('.pith-nav-toggle').click(); assert.equal(await page.locator('[data-toc-locator]').getByText('概览').count(), 1); await page.locator('[data-planned-lesson="02-第二讲.md"]').click();
    await page.locator('.pith-article').getByText('生成正文').waitFor(); assert.match((await page.evaluate(() => (window as any).guideReceived.at(-1))), /02-第二讲\.md.*原生第二讲/);
    await page.locator('.pith-nav-toggle').click(); assert.equal(await page.locator('[data-file="02-第二讲.md"][aria-current="true"]').count(), 1); await page.locator('.pith-nav-toggle').click();
    await page.setViewportSize({ width: 420, height: 700 }); await page.waitForFunction(() => document.querySelector('.pith-view')?.getAttribute('data-sheet-mode') === 'bottom-sheet');
    await page.locator('.pith-nav-toggle').click(); await page.locator('[data-planned-lesson="03-第三讲.md"]').click(); await page.waitForFunction(() => typeof (window as any).releaseNativeLesson === 'function');
    assert.equal(await page.locator('.pith-layout > .pith-guide').count(), 0); assert.equal(await page.locator('#side .pith-guide').isVisible(), true);
    assert.equal(await page.locator('.pith-layout').evaluate((layout: HTMLElement) => { const stage = layout.querySelector<HTMLElement>('.pith-stage')!; return Math.abs(stage.getBoundingClientRect().height - layout.getBoundingClientRect().height) < 1 && getComputedStyle(stage).maxHeight === 'none'; }), true);
    await page.locator('.pith-nav-toggle').click(); await page.locator('[data-file="01-第一讲.md"]').click(); await page.locator('.pith-article').getByText('真实内容').waitFor(); await page.evaluate(() => { (window as any).nativeReading = document.querySelector('.pith-article h1'); (window as any).releaseNativeLesson(); });
    await page.locator('.pith-nav-toggle').click(); await page.locator('[data-file="03-第三讲.md"]').waitFor(); assert.equal(await page.evaluate(() => (window as any).nativeReading === document.querySelector('.pith-article h1')), true);
    assert.equal(await page.evaluate(async () => { const c = (window as any).nativeController; const topic = (await c.store.listTopics())[0]; return topic.lessons.some((file: any) => file.name === '03-第三讲.md'); }), true); await page.locator('.pith-nav-toggle').click(); await page.setViewportSize({ width: 1100, height: 800 });
    await page.locator("#open-toolkit").click(); await page.locator('[data-toolkit-remove="feynman"]').click(); await page.locator('[data-toolkit-remove="shadowing"]').click(); await page.locator('[data-toolkit-remove="shadowing"]').waitFor({ state: 'detached' });
    assert.deepEqual(await page.evaluate(async () => (await (window as any).nativeController.store.listTopics())[0].toolkits), []);
    const evidence = resolve(`${process.env.PITH_TEST_SCREENSHOT_DIR}/task-33`); await mkdir(evidence, { recursive: true }); await page.screenshot({ path: join(evidence, "native-guide.png") });
    await page.locator('[data-command="home"]').click(); await page.locator('[name="title"]').fill('学习架构 "/fixture/repo with spaces"'); await page.locator('[data-intake-open]').click();
    await page.locator('.pith-article').getByText('仓库已绑定').waitFor(); assert.match(await page.locator('.pith-article').innerText(), /尚无讲义/); assert.match(await page.locator('.pith-article').innerText(), /a{40}/);
    await page.waitForFunction(() => (window as any).guideReceived.at(-1).includes('学习架构'));
    assert.equal(await page.evaluate(async () => (await (window as any).nativeController.store.listTopics()).find((item: any) => item.title === '学习架构').target), '学习架构');
    await mkdir(resolve(`${process.env.PITH_TEST_SCREENSHOT_DIR}/task-35`), { recursive: true }); await page.screenshot({ path: resolve(`${process.env.PITH_TEST_SCREENSHOT_DIR}/task-35/native-repo-fix.png`) });
    await page.locator('[data-command="home"]').click(); await page.locator('[name="title"]').fill('理解缓存 "/fixture/repo with spaces"'); await page.locator('[data-intake-open]').click();
    await page.locator('.pith-article').getByText('仓库已绑定').waitFor(); await page.waitForFunction(() => (window as any).guideReceived.at(-1).includes('理解缓存'));
    assert.equal(await page.evaluate(async () => (await (window as any).nativeController.store.listTopics()).some((item: any) => item.target === '理解缓存')), true);
    await page.locator('[data-command="home"]').click(); await page.locator('.pith-intake-box input[type="file"]').setInputFiles({ name: "sample.ts", mimeType: "video/mp2t", buffer: Buffer.from('const value = "<script>";\nsecond line') }); await page.locator('[name="title"]').fill('原生源代码'); await page.locator('[data-intake-open]').click();
    await page.locator('.pith-article [data-locator="text:line:1"]').getByText("second line").waitFor();
    const imported = await page.evaluate(async () => { const controller = (window as any).nativeController; const topics = await controller.store.listTopics(); for (const topic of topics) for (const id of topic.materialIds) { const material = await controller.store.getMaterial(id); if (material.files.some((file: any) => file.name === "sample.ts")) return { topic, material }; } throw new Error("imported topic not found"); });
    assert.equal(imported.material.kind, "article"); assert.equal(imported.material.files[0].mimeType, "video/mp2t"); assert.deepEqual(imported.topic.toolkits, ["interline"]); assert.equal(await page.locator('.pith-article script').count(), 0);
    assert.equal(await page.locator('.pith-article [data-prose="true"]').count(), 0);
    await page.locator('[data-command="read"]').click(); await page.getByText("当前页面没有可朗读的正文段落").waitFor();
    await page.locator('#open-toolkit').click(); await page.locator('[data-toolkit-choose="feynman"]').click(); await page.locator('[data-toolkit-close]').waitFor(); await page.locator('#open-toolkit').click();
    await page.locator('.pith-article [data-locator="text:line:1"]').click();
    await page.locator('[data-toolkit-choose="feynman"]').click();
    assert.match(await page.locator('.pith-toolkit-source').textContent(), /second line/);
    await page.locator('[data-toolkit-reveal]').click(); assert.match(await page.locator('.pith-toolkit-source').textContent(), /second line/);
    await page.screenshot({ path: resolve(`${process.env.PITH_TEST_SCREENSHOT_DIR}/audit-fix/native-source-feynman.png`) });
    await page.locator('[data-toolkit-close]').click();
    await page.evaluate(() => { const line = document.querySelector('[data-locator="text:line:1"]')!; const range = document.createRange(); range.selectNodeContents(line); const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range); line.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); });
    await page.locator('[data-selection="highlight"]').click();
    await page.waitForFunction(() => !!document.querySelector('mark[data-pith-note]'));
    await page.evaluate(() => { const line = document.querySelector('[data-locator="text:line:1"]')!; const range = document.createRange(); range.selectNodeContents(line); const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range); line.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); });
    await page.locator('[data-selection="ask"]').click(); await page.locator('.pith-guide blockquote').getByText('second line').waitFor();
    await page.evaluate(() => { window.getSelection()!.removeAllRanges(); document.querySelector('.pith-article')!.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); });
    const binaryRejected = await page.evaluate(async () => { const c = (window as any).nativeController; const material = await c.importMaterial({ title: "binary", kind: "article", files: [{ name: "fake.ts", mimeType: "video/mp2t", bytes: new Uint8Array([65, 0, 66]) }] }); try { await c.renderMaterialFile(material.id, "fake.ts"); return false; } catch (error) { return String(error).includes("binary"); } }); assert.equal(binaryRejected, true);
    await page.screenshot({ path: join(evidence, "fix-native-source.png") });
    await page.setViewportSize({ width: 700, height: 850 }); await page.locator('#root').evaluate((root: HTMLElement) => { root.style.width = '332px'; });
    const header = await page.locator('.pith-view-header').evaluate((element: HTMLElement) => { const title = element.querySelector<HTMLElement>('.pith-title')!, button = element.querySelector<HTMLElement>('#open-toolkit')!, outer = element.getBoundingClientRect(), rect = button.getBoundingClientRect(); return { width: outer.width, title: title.getBoundingClientRect().width, scroll: element.scrollLeft, clipped: element.scrollWidth > element.clientWidth, icon: !!button.querySelector('svg'), buttonInside: rect.left >= outer.left && rect.right <= outer.right, name: button.getAttribute('aria-label') }; });
    assert.equal(header.width, 332); assert.equal(header.scroll, 0); assert.ok(header.title >= 56, `title width ${header.title}`); assert.equal(header.clipped, false); assert.equal(header.buttonInside, true); assert.equal(header.icon, true); assert.match(header.name || '', /行间|费曼复述/);
    await page.locator('#open-toolkit').click();
    assert.equal(await page.locator('.pith-toolkit-panel').evaluate((panel: HTMLElement) => panel.scrollWidth <= panel.clientWidth && Array.from(panel.querySelectorAll('button')).every(button => getComputedStyle(button).whiteSpace === 'nowrap' && button.scrollWidth <= button.clientWidth)), true);
    assert.equal(await page.locator('.pith-toolkit-group').count(), 3); assert.equal(await page.locator('.pith-toolkit-group').evaluateAll((groups: Element[]) => groups.every((group: Element) => { const rect = group.getBoundingClientRect(), panel = group.parentElement!.getBoundingClientRect(); return rect.left >= panel.left && rect.right <= panel.right && !!group.querySelector('[data-toolkit-choose]') && !group.querySelector('input'); })), true);
    await page.screenshot({ path: join(evidence, "header-native-narrow.png") });
    await page.evaluate(() => { const style = document.body.style; style.setProperty('--background-primary', '#1e1e1e'); style.setProperty('--background-secondary', '#282828'); style.setProperty('--background-modifier-border', '#454545'); style.setProperty('--background-modifier-hover', '#383838'); style.setProperty('--text-normal', '#eee'); style.setProperty('--text-muted', '#aaa'); }); await page.screenshot({ path: join(evidence, "header-native-narrow-dark.png") });
    for (const id of ['feynman', 'interline']) { await page.locator(`[data-toolkit-remove="${id}"]`).click(); await page.locator(`[data-toolkit-remove="${id}"]`).waitFor({ state: 'detached' }); }
    assert.equal(await page.locator('#open-toolkit').getAttribute('aria-label'), '打开实训工具'); assert.equal(await page.locator('#open-toolkit svg').count(), 1);
    await page.locator('[data-toolkit-choose="feynman"]').click(); await page.locator('[data-toolkit-close]').waitFor();
    await page.locator('#root').evaluate((root: HTMLElement) => { root.style.width = '650px'; }); await page.waitForFunction(() => getComputedStyle(document.querySelector('#open-toolkit')!).fontSize !== '0px'); assert.match(await page.locator('#open-toolkit').textContent(), /费曼复述/); assert.match(await page.locator('#open-toolkit').getAttribute('aria-label') || '', /费曼复述/);
    await page.setViewportSize({ width: 1100, height: 800 }); await page.evaluate(() => { document.body.removeAttribute('style'); document.querySelector<HTMLElement>('#root')!.style.width = '75%'; }); await page.locator('[data-command="home"]').click(); await page.locator('[name="title"]').fill('原生英文博客回归'); await page.locator('[data-intake-open]').click(); await page.locator('.pith-article').getByText('A complete English article about learning and reading.').waitFor(); await page.waitForFunction(() => document.querySelector('#open-toolkit')?.textContent?.includes('行间'));
    const initialBlogTopic = await page.evaluate(() => (window as any).initialBlogTopic); assert.deepEqual(initialBlogTopic.materialIds, []); assert.deepEqual(initialBlogTopic.toolkits, ['interline']); const blogTopic = await page.evaluate(async () => (await (window as any).nativeController.store.listTopics()).find((topic: any) => topic.title === '原生英文博客回归')); assert.deepEqual(blogTopic.toolkits, ['interline']); await page.screenshot({ path: resolve(`${process.env.PITH_TEST_SCREENSHOT_DIR}/task-39/f2-native-blog.png`) });
    await page.locator('[data-command="home"]').click(); await page.locator(`[data-topic="${blogTopic.id}"]`).first().click(); await page.locator('.pith-article').getByText('A complete English article about learning and reading.').waitFor(); assert.match(await page.locator('#open-toolkit').textContent(), /行间/);
    const beforeUrl = await page.evaluate(() => (window as any).guideReceived.length);
    await page.locator('[data-command="home"]').click(); await page.locator('[name="title"]').fill('https://public.com/direct'); await page.locator('[data-intake-open]').click();
    await page.getByRole('status').getByText('请写下想搞懂的问题').waitFor();
    assert.equal(await page.evaluate(() => (window as any).guideReceived.length), beforeUrl);
  } finally { if (browser) await browser.close(); await new Promise<void>((ok, fail) => host.close(error => error ? fail(error) : ok())); await rm(root, { recursive: true, force: true }); }
});
