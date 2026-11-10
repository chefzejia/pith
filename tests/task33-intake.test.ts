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
import { createGuideWorkspaceTools } from "../src/plugins/guide-acp/tools.ts";
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
    const read = createGuideWorkspaceTools(store, undefined, storage).find(tool => tool.name === "pith_read_material_section")!;
    for (const [name, mimeType] of [["sample.ts", "video/mp2t"], ["module.py", "application/octet-stream"]]) {
      const bytes = new TextEncoder().encode("const answer = 42;\nnext line");
      const material = await store.importMaterial({ title: name!, kind: "article", files: [{ name: name!, mimeType: mimeType!, bytes }] });
      const view = await renderFile(material.files[0]!, bytes);
      assert.deepEqual(filterProseOnly(view.blocks!), []);
      assert.match(view.html, /data-prose="false" data-trainable="true"/);
      assert.match((await read.execute({ materialId: material.id, file: name }) as { text: string }).text, /answer = 42/);
    }
    for (const name of ["prose.txt", "prose.abc"]) {
      const bytes = new TextEncoder().encode("Natural prose.\nAnother sentence.");
      const view = await renderFile({ name, mimeType: "application/octet-stream", bytes: bytes.length, sha256: "" }, bytes);
      assert.equal(filterProseOnly(view.blocks!).length, 2);
      assert.match(view.html, /data-prose="true"/);
    }
    for (const bytes of [new Uint8Array([65, 0, 66]), new Uint8Array([255]), new Uint8Array(256 * 1024 + 1).fill(65)]) {
      const material = await store.importMaterial({ title: "invalid", kind: "article", files: [{ name: "invalid.ts", mimeType: "text/plain", bytes }] });
      await assert.rejects(read.execute({ materialId: material.id, file: "invalid.ts" }), /not text|size limit/);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("real HTTP intake and repository binding preserve explicit empty toolkit lists", async () => {
  const root = await testSandbox("task33-http-");
  const repo = join(root, "repo"), workspace = join(root, "workspace"); await mkdir(repo); await mkdir(workspace);
  const git = promisify(execFile), env = { PATH: process.env.PATH, HOME: root, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_AUTHOR_NAME: "Fixture", GIT_AUTHOR_EMAIL: "fixture@example.invalid", GIT_COMMITTER_NAME: "Fixture", GIT_COMMITTER_EMAIL: "fixture@example.invalid" };
  await git("git", ["-C", repo, "init", "-q"], { env }); await writeFile(join(repo, "source.ts"), "export const value = 1;\n"); await git("git", ["-C", repo, "add", "source.ts"], { env }); await git("git", ["-C", repo, "commit", "-qm", "fixture"], { env });
  const server = await createPithWebServer({ workspaceDir: workspace });
  try {
    const address = server.address(); assert.ok(address && typeof address !== "string"); const base = `http://127.0.0.1:${address.port}`;
    const post = async (path: string, value: unknown) => { const response = await fetch(base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(value) }); assert.equal(response.status, 201, await response.clone().text()); return response.json() as Promise<any>; };
    const material = await post("/api/materials/repo", { repoPath: repo }); assert.equal(material.kind, "repo"); assert.match(material.commitSha, /^[a-f0-9]{40,64}$/);
    assert.deepEqual((await post("/api/topics", { title: "仓库", materialId: material.id })).toolkits, ["feynman"]);
    assert.deepEqual((await post("/api/topics", { title: "空工具", materialId: material.id, toolkits: [] })).toolkits, []);
    const text = await post("/api/materials", { title: "标题", kind: "article", files: [{ name: "中文.ts", data: Buffer.from("这是中文正文").toString("base64") }] });
    assert.deepEqual((await post("/api/topics", { title: "标题", materialId: text.id })).toolkits, ["feynman"]);
  } finally { await new Promise<void>((ok, fail) => server.close(error => error ? fail(error) : ok())); await rm(root, { recursive: true, force: true }); }
});

test("browser intake binds Git, opens guide, refreshes generated lesson and persists toolkit changes", { timeout: 60000, skip: !process.env.PITH_PLAYWRIGHT_MODULE || !process.env.PITH_CHROME_PATH }, async () => {
  const root = await testSandbox("task33-browser-"), repo = join(root, "repo with spaces"), workspace = join(root, "workspace"); await mkdir(repo); await mkdir(workspace);
  const git = promisify(execFile), env = { PATH: process.env.PATH, HOME: root, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_AUTHOR_NAME: "Fixture", GIT_AUTHOR_EMAIL: "fixture@example.invalid", GIT_COMMITTER_NAME: "Fixture", GIT_COMMITTER_EMAIL: "fixture@example.invalid" };
  await git("git", ["-C", repo, "init", "-q"], { env }); await writeFile(join(repo, "source.ts"), "export const fixture = true;\n"); await git("git", ["-C", repo, "add", "."], { env }); await git("git", ["-C", repo, "commit", "-qm", "fixture"], { env });
  const store = new DefaultWorkspaceStore(new NodeWorkspaceStorage(workspace));
  let replies = 0;
  const server = await createPithWebServer({ workspaceDir: workspace, guideProvider: { async reply(input) { const topic = await store.getTopic(input.topicId); assert.ok(topic?.materialId); const turn = replies++; if (turn === 0) { await store.writeGeneratedFile(topic.materialId, "00-课程大纲.md", "# 受控课程大纲\n第一讲"); await store.writeGeneratedFile(topic.materialId, "01-第一讲.md", "# 第一讲\n真实内容"); } if (turn === 2) await store.writeGeneratedFile(topic.materialId, "02-第二讲.md", "# 第二讲"); return "课程已准备"; } } });
  let browser: any;
  try {
    const address = server.address(); assert.ok(address && typeof address !== "string"); const base = `http://127.0.0.1:${address.port}`;
    const { chromium } = await import(process.env.PITH_PLAYWRIGHT_MODULE!); browser = await chromium.launch({ executablePath: process.env.PITH_CHROME_PATH, headless: true });
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 } }); await page.goto(base);
    const evidence = resolve(".tmp/evidence/task-33"); await mkdir(evidence, { recursive: true }); await page.screenshot({ path: join(evidence, "intake.png") });
    await page.locator('[name="title"]').fill(repo); await page.locator("[data-intake-open]").click();
    await page.getByText("受控课程大纲").first().waitFor(); assert.equal(await page.locator(".pith-guide").isVisible(), true);
    await page.locator(".pith-nav-toggle").click(); assert.equal(await page.getByText("01-第一讲.md").count(), 1); const oldCompose = await page.locator('.pith-guide textarea').elementHandle(); await page.locator('[data-file="01-第一讲.md"]').click(); await page.waitForFunction((old: HTMLElement) => !old.isConnected, oldCompose);
    await page.waitForFunction(() => document.querySelector('.pith-article h1')?.textContent === '第一讲'); await page.evaluate(() => { (window as any).readingNode = document.querySelector(".pith-article h1"); });
    await page.locator('.pith-guide textarea').fill("普通问题"); await page.locator('[data-guide-send]').click();
    try { await page.getByText("普通问题").waitFor({ timeout: 8000 }); } catch (error) { throw new Error(`web guide: ${await page.locator('.pith-guide').innerText()} replies=${replies}`, { cause: error }); }
    assert.equal(await page.evaluate(() => (window as any).readingNode === document.querySelector(".pith-article h1")), true); assert.equal(await page.locator(".pith-article h1").textContent(), "第一讲");
    await page.locator('.pith-guide textarea').fill("继续生成"); await page.locator('[data-guide-send]').click(); await page.getByText("继续生成").waitFor(); assert.equal(await page.locator(".pith-article h1").textContent(), "第一讲"); await page.locator('.pith-nav-toggle').click(); assert.equal(await page.getByText("02-第二讲.md").count(), 1);
    await page.locator("#open-dojo").click(); await page.locator('[data-toolkit-toggle="feynman"]').uncheck(); await page.locator('[data-toolkit-toggle="interline"]').check(); await page.waitForFunction(() => Array.from(document.querySelectorAll<HTMLInputElement>('[data-toolkit-toggle]')).every(item => !item.disabled));
    await page.screenshot({ path: join(evidence, "guide-toolkit.png") });
    const state = await (await fetch(base + "/api/state")).json() as any; assert.deepEqual(state.compass.exploring[0].toolkits, ["interline"]);
    await page.setViewportSize({ width: 390, height: 844 }); await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))); await page.screenshot({ path: join(evidence, "fix-web-narrow.png") }); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.equal(await page.locator('.pith-dojo-panel').evaluate((panel: HTMLElement) => panel.scrollWidth <= panel.clientWidth && Array.from(panel.querySelectorAll('button')).every(button => getComputedStyle(button).whiteSpace === 'nowrap' && button.scrollWidth <= button.clientWidth)), true);
    await page.locator('[data-command="home"]').click(); await page.locator('.pith-intake-box input[type="file"]').setInputFiles({ name: "example.ts", mimeType: "video/mp2t", buffer: Buffer.from('const value = "<script>";\nsecond line') }); await page.locator('[data-intake-open]').click();
    await page.locator('.pith-article [data-locator="text:line:1"]').getByText("second line").waitFor(); assert.equal(await page.locator('.pith-article script').count(), 0); assert.match(await page.locator('.pith-article').textContent(), /<script>/);
    assert.equal(await page.locator('.pith-article [data-prose="true"]').count(), 0);
    await page.locator('[data-command="read"]').click(); await page.getByText("当前页面没有可朗读的正文段落").waitFor();
    await page.locator('#open-dojo').click(); await page.locator('[data-toolkit-toggle="feynman"]').check(); await page.waitForFunction(() => Array.from(document.querySelectorAll<HTMLInputElement>('[data-toolkit-toggle]')).every(item => !item.disabled)); await page.locator('#open-dojo').click();
    await page.locator('.pith-article [data-locator="text:line:1"]').click(); await page.locator('[data-dojo-choose="feynman"]').click();
    assert.match(await page.locator('.pith-dojo-source').textContent(), /second line/);
    await page.screenshot({ path: resolve('.tmp/evidence/audit-fix/web-source-feynman.png') });
  } finally { if (browser) await browser.close(); await new Promise<void>((ok, fail) => server.close(error => error ? fail(error) : ok())); await rm(root, { recursive: true, force: true }); }
});

test("native shared surface opens empty topic and refreshes a generated lesson", { timeout: 60000, skip: !process.env.PITH_PLAYWRIGHT_MODULE || !process.env.PITH_CHROME_PATH }, async () => {
  const root = await testSandbox("task33-native-"); let browser: any;
  const host = createServer((_req, res) => res.end("<!doctype html>")); await new Promise<void>(ok => host.listen(0, "127.0.0.1", ok));
  try {
    const bundle = await build({ entryPoints: ["src/shells/obsidian/index.ts"], bundle: true, write: false, platform: "browser", format: "iife", globalName: "NativePith", external: ["node:*", "obsidian"] });
    const toolsBundle = await build({ entryPoints: ["src/plugins/guide-acp/tools.ts"], bundle: true, write: false, platform: "browser", format: "iife", globalName: "GuideTools" });
    const { chromium } = await import(process.env.PITH_PLAYWRIGHT_MODULE!); browser = await chromium.launch({ executablePath: process.env.PITH_CHROME_PATH, headless: true });
    const page = await browser.newPage({ viewport: { width: 1100, height: 800 } }); page.setDefaultTimeout(8000);
    const address = host.address(); assert.ok(address && typeof address !== "string"); await page.goto(`http://127.0.0.1:${address.port}`);
    await page.setContent('<style>html,body{height:100%;margin:0}#root{height:100%;width:75%}#side{position:absolute;right:0;top:0;width:25%;height:100%}body{--background-primary:#fff;--background-secondary:#f1f3ef;--background-modifier-border:#ccd5cd;--background-modifier-hover:#e1e9e2;--text-normal:#222;--text-muted:#666;--font-interface:Arial}</style><div id="root"></div><div id="side"></div>');
    await page.evaluate(() => { (window as any).require = (id: string) => id === "obsidian" ? { ItemView: class { contentEl: HTMLElement | null; constructor(leaf: any) { this.contentEl = leaf?.container || document.getElementById("root"); } }, Plugin: class {}, Notice: class { constructor(message: string) { (window as any).notice = message; } } } : id === "node:util" ? { promisify: (fn: unknown) => fn } : id === "node:net" ? { BlockList: class { addSubnet() {} } } : {}; });
    await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
    await page.addScriptTag({ content: toolsBundle.outputFiles[0]!.text });
    await page.evaluate(async () => {
      const data = new Map<string, Uint8Array>(), folders = new Set<string>(); (window as any).nativeBytes = data; const encoder = new TextEncoder(), decoder = new TextDecoder();
      const storage = { exists: async (path: string) => data.has(path) || folders.has(path), readText: async (path: string) => { if (!data.has(path)) throw new Error("missing " + path); return decoder.decode(data.get(path)); }, readBinary: async (path: string) => { const value = data.get(path); if (!value) throw new Error("missing " + path); return value; }, writeText: async (path: string, text: string) => { data.set(path, encoder.encode(text)); }, createText: async (path: string, text: string) => { if (data.has(path)) throw new Error("exists"); data.set(path, encoder.encode(text)); }, writeBinary: async (path: string, bytes: Uint8Array) => { data.set(path, bytes); }, createBinary: async (path: string, bytes: Uint8Array) => { if (data.has(path)) throw new Error("exists"); data.set(path, bytes); }, processText: async (path: string, update: (text: string) => string) => { const result = update(decoder.decode(data.get(path))); data.set(path, encoder.encode(result)); return result; }, mkdir: async (path: string) => { folders.add(path); }, list: async (path: string) => [...folders, ...data.keys()].filter(item => item.startsWith(path + "/") && !item.slice(path.length + 1).includes("/")).map(item => ({ path: item, type: folders.has(item) ? "folder" : "file" })) };
      const repository = { async inspectRepository(path: string) { if (path !== "/fixture/repo with spaces") throw Object.assign(new Error("missing"), { code: "ENOENT", syscall: "realpath" }); return { externalPath: path, title: "repo with spaces", commitSha: "a".repeat(40) }; } };
      const mediaCorpus = { async fetchMediaCorpus() { return { title: "语料", sourceUrl: "https://8.8.8.8/watch", files: [{ name: "clip.vtt", mimeType: "text/vtt", bytes: encoder.encode("WEBVTT\n\n00:00:00.000 --> 00:00:03.000\nNative subtitle.\n") }, { name: "clip.mp3", mimeType: "audio/mpeg", bytes: new Uint8Array([1, 2, 3]) }], slices: [{ id: "slice-1", title: "片段 1 (00:00 - 00:03)", startSec: 0, endSec: 3, cueCount: 1, text: "Native subtitle." }] }; } };
      const host = { id: "obsidian", storage, repository, mediaCorpus }; let controller: any; const received: string[] = []; (window as any).guideReceived = received;
      const provider = { async reply({ topicId, conversation }: any) { const text = conversation.at(-1).text; received.push(text); if (received.length === 1) { const material = await controller.store.importMaterial({ title: "课程", kind: "article", files: [] }); await controller.store.updateTopic(topicId, { materialId: material.id }); await controller.store.writeGeneratedFile(material.id, "00-课程大纲.md", "# 原生课程大纲\n- [01-第一讲.md] 原生第一讲\n- [原生第二讲](./02-第二讲.md)\n- [第三讲](03-第三讲.md#section)"); await controller.store.writeGeneratedFile(material.id, "01-第一讲.md", "# 原生第一讲\n## 概览\n真实内容"); } else if (text.includes("导入语料")) { const tool = (window as any).GuideTools.createGuideWorkspaceTools(controller.store, undefined, storage, undefined, undefined, mediaCorpus, topicId).find((item: any) => item.name === "pith_fetch_media_corpus"); await tool.execute({ topicId, url: "https://8.8.8.8/watch" }); } else if (text.includes("02-第二讲.md")) { const topic = await controller.store.getTopic(topicId); await controller.store.writeGeneratedFile(topic.materialId, "02-第二讲.md", "# 原生第二讲\n生成正文"); } else if (text.includes("03-第三讲.md")) { await new Promise<void>(resolve => { (window as any).releaseNativeLesson = resolve; }); const topic = await controller.store.getTopic(topicId); await controller.store.writeGeneratedFile(topic.materialId, "03-第三讲.md", "# 原生第三讲\n真实落盘"); } return "受控向导回复"; } };
      controller = new (window as any).NativePith.PithObsidianController(host, undefined, provider); await controller.initialize();
      const leaf: any = { container: document.getElementById("side"), detach() {}, async setViewState() { this.view = new (window as any).NativePith.PithGuideView(this); } }; const workspace = { rightSplit: { expand() {}, collapse() {} }, getRightLeaf: () => leaf, getLeavesOfType: () => leaf.view ? [leaf] : [], revealLeaf: async () => {} };
      const view = new (window as any).NativePith.PithWorkspaceView({}, controller, host, workspace); (window as any).nativeController = controller; await view.onOpen();
    });
    await mkdir(resolve('.tmp/evidence/task-35'), { recursive: true }); await page.screenshot({ path: resolve('.tmp/evidence/task-35/native-home.png') });
    await page.locator('[name="title"]').fill("原生空课题"); await page.locator("[data-intake-open]").click();
    try { await page.getByText("原生课程大纲").first().waitFor({ timeout: 8000 }); } catch (error) { throw new Error(`native state: ${await page.locator("body").innerText()} notice=${await page.evaluate(() => (window as any).notice)}`, { cause: error }); }
    await page.locator('.pith-nav-toggle').click(); await page.locator('[data-file="01-第一讲.md"]').click(); await page.locator('.pith-article').getByText("原生第一讲").waitFor(); await page.evaluate(() => { (window as any).readingNode = document.querySelector(".pith-article h1"); });
    await page.locator('.pith-guide textarea').fill("普通问题"); await page.locator('[data-guide-send]').click(); await page.waitForFunction(() => !(document.querySelector('[data-guide-send]') as HTMLButtonElement).disabled);
    assert.equal(await page.evaluate(() => (window as any).readingNode === document.querySelector(".pith-article h1")), true); assert.equal(await page.locator('.pith-article h1').textContent(), "原生第一讲");
    const conversation = await page.evaluate(async () => { const c = (window as any).nativeController; const topic = (await c.store.listTopics())[0]; return { received: (window as any).guideReceived, entries: await c.engine.getConversation(topic.id) }; });
    assert.equal(conversation.received.at(-1), "普通问题"); assert.equal(conversation.entries.at(-2).text, "普通问题"); assert.equal(conversation.entries.at(-1).text, "受控向导回复");
    await page.locator('.pith-guide textarea').fill("导入语料"); await page.locator('[data-guide-send]').click(); await page.locator('.pith-cue').getByText("Native subtitle.").waitFor(); assert.match(await page.evaluate(async () => { const c = (window as any).nativeController, t = (await c.store.listTopics())[0]; return new TextDecoder().decode((window as any).nativeBytes.get(`materials/${t.materialId}/files/clip.vtt`)); }), /Native subtitle/);
    await mkdir(resolve('.tmp/evidence/task-39'), { recursive: true }); await page.screenshot({ path: resolve('.tmp/evidence/task-39/native-subtitles.png') }); await page.locator('.pith-nav-toggle').click(); await page.locator('[data-file="01-第一讲.md"]').click(); await page.locator('.pith-article').getByText("原生第一讲").waitFor();
    await page.locator('.pith-nav-toggle').click(); assert.equal(await page.locator('[data-toc-locator]').count(), 1); await page.locator('[data-planned-lesson="02-第二讲.md"]').click();
    await page.locator('.pith-article').getByText('生成正文').waitFor(); assert.match((await page.evaluate(() => (window as any).guideReceived.at(-1))), /02-第二讲\.md.*原生第二讲/);
    await page.locator('.pith-nav-toggle').click(); assert.equal(await page.locator('[data-file="02-第二讲.md"][aria-current="true"]').count(), 1); await page.locator('.pith-nav-toggle').click();
    await page.setViewportSize({ width: 420, height: 700 }); await page.waitForFunction(() => document.querySelector('.pith-view')?.getAttribute('data-sheet-mode') === 'bottom-sheet');
    await page.locator('.pith-nav-toggle').click(); await page.locator('[data-planned-lesson="03-第三讲.md"]').click(); await page.waitForFunction(() => typeof (window as any).releaseNativeLesson === 'function');
    assert.equal(await page.locator('.pith-layout > .pith-guide').count(), 0); assert.equal(await page.locator('#side .pith-guide').isVisible(), true);
    assert.equal(await page.locator('.pith-layout').evaluate((layout: HTMLElement) => { const stage = layout.querySelector<HTMLElement>('.pith-stage')!; return Math.abs(stage.getBoundingClientRect().height - layout.getBoundingClientRect().height) < 1 && getComputedStyle(stage).maxHeight === 'none'; }), true);
    await page.locator('.pith-nav-toggle').click(); await page.locator('[data-file="01-第一讲.md"]').click(); await page.locator('.pith-article').getByText('真实内容').waitFor(); await page.evaluate(() => { (window as any).nativeReading = document.querySelector('.pith-article h1'); (window as any).releaseNativeLesson(); });
    await page.locator('.pith-nav-toggle').click(); await page.locator('[data-file="03-第三讲.md"]').waitFor(); assert.equal(await page.evaluate(() => (window as any).nativeReading === document.querySelector('.pith-article h1')), true);
    assert.equal(await page.evaluate(async () => { const c = (window as any).nativeController; const topic = (await c.store.listTopics())[0]; return (await c.store.getMaterial(topic.materialId)).files.some((file: any) => file.name === '03-第三讲.md'); }), true); await page.locator('.pith-nav-toggle').click(); await page.setViewportSize({ width: 1100, height: 800 });
    await page.locator("#open-dojo").click(); await page.locator('[data-toolkit-toggle="feynman"]').uncheck(); await page.waitForFunction(() => Array.from(document.querySelectorAll<HTMLInputElement>('[data-toolkit-toggle]')).every(item => !item.disabled)); await page.locator('[data-toolkit-toggle="shadowing"]').uncheck(); await page.waitForFunction(() => Array.from(document.querySelectorAll<HTMLInputElement>('[data-toolkit-toggle]')).every(item => !item.disabled));
    assert.deepEqual(await page.evaluate(async () => (await (window as any).nativeController.store.listTopics())[0].toolkits), []);
    const evidence = resolve(".tmp/evidence/task-33"); await mkdir(evidence, { recursive: true }); await page.screenshot({ path: join(evidence, "native-guide.png") });
    await page.locator('[data-command="home"]').click(); await page.locator('[name="title"]').fill('/fixture/repo with spaces 学习架构'); await page.locator('[data-intake-open]').click();
    await page.locator('.pith-article').getByText('仓库已绑定').waitFor(); assert.match(await page.locator('.pith-article').innerText(), /尚无讲义/); assert.match(await page.locator('.pith-article').innerText(), /a{40}/);
    await page.waitForFunction(() => (window as any).guideReceived.at(-1).includes('学习架构'));
    assert.equal(await page.evaluate(async () => (await (window as any).nativeController.store.listTopics()).find((item: any) => item.title === 'repo with spaces').target), '学习架构');
    await mkdir(resolve('.tmp/evidence/task-35'), { recursive: true }); await page.screenshot({ path: resolve('.tmp/evidence/task-35/native-repo-fix.png') });
    await page.locator('[data-command="home"]').click(); await page.locator('[name="title"]').fill('/fixture/repo with spaces — 理解缓存'); await page.locator('[data-intake-open]').click();
    await page.locator('.pith-article').getByText('仓库已绑定').waitFor(); await page.waitForFunction(() => (window as any).guideReceived.at(-1).includes('理解缓存'));
    assert.equal(await page.evaluate(async () => (await (window as any).nativeController.store.listTopics()).some((item: any) => item.target === '理解缓存')), true);
    await page.locator('[data-command="home"]').click(); await page.locator('.pith-intake-box input[type="file"]').setInputFiles({ name: "sample.ts", mimeType: "video/mp2t", buffer: Buffer.from('const value = "<script>";\nsecond line') }); await page.locator('[data-intake-open]').click();
    await page.locator('.pith-article [data-locator="text:line:1"]').getByText("second line").waitFor();
    const imported = await page.evaluate(async () => { const controller = (window as any).nativeController; const topics = await controller.store.listTopics(); for (const topic of topics) { if (!topic.materialId) continue; const material = await controller.store.getMaterial(topic.materialId); if (material.files.some((file: any) => file.name === "sample.ts")) return { topic, material }; } throw new Error("imported topic not found"); });
    assert.equal(imported.material.kind, "article"); assert.equal(imported.material.files[0].mimeType, "video/mp2t"); assert.deepEqual(imported.topic.toolkits, ["interline"]); assert.equal(await page.locator('.pith-article script').count(), 0);
    assert.equal(await page.locator('.pith-article [data-prose="true"]').count(), 0);
    await page.locator('[data-command="read"]').click(); await page.getByText("当前页面没有可朗读的正文段落").waitFor();
    await page.locator('#open-dojo').click(); await page.locator('[data-toolkit-toggle="feynman"]').check(); await page.waitForFunction(() => Array.from(document.querySelectorAll<HTMLInputElement>('[data-toolkit-toggle]')).every(item => !item.disabled)); await page.locator('#open-dojo').click();
    await page.locator('.pith-article [data-locator="text:line:1"]').click();
    await page.locator('[data-dojo-choose="feynman"]').click();
    assert.match(await page.locator('.pith-dojo-source').textContent(), /second line/);
    await page.locator('[data-dojo-reveal]').click(); assert.match(await page.locator('.pith-dojo-source').textContent(), /second line/);
    await page.screenshot({ path: resolve('.tmp/evidence/audit-fix/native-source-feynman.png') });
    await page.locator('[data-dojo-close]').click();
    await page.evaluate(() => { const line = document.querySelector('[data-locator="text:line:1"]')!; const range = document.createRange(); range.selectNodeContents(line); const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range); line.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); });
    await page.locator('[data-selection="highlight"]').click();
    await page.waitForFunction(() => !!document.querySelector('mark[data-pith-note]'));
    await page.evaluate(() => { const line = document.querySelector('[data-locator="text:line:1"]')!; const range = document.createRange(); range.selectNodeContents(line); const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range); line.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); });
    await page.locator('[data-selection="ask"]').click(); await page.locator('.pith-guide blockquote').getByText('second line').waitFor();
    await page.evaluate(() => { window.getSelection()!.removeAllRanges(); document.querySelector('.pith-article')!.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); });
    const binaryRejected = await page.evaluate(async () => { const c = (window as any).nativeController; const material = await c.importMaterial({ title: "binary", kind: "article", files: [{ name: "fake.ts", mimeType: "video/mp2t", bytes: new Uint8Array([65, 0, 66]) }] }); try { await c.renderMaterialFile(material.id, "fake.ts"); return false; } catch (error) { return String(error).includes("binary"); } }); assert.equal(binaryRejected, true);
    await page.screenshot({ path: join(evidence, "fix-native-source.png") });
    await page.setViewportSize({ width: 700, height: 850 }); await page.locator('#root').evaluate((root: HTMLElement) => { root.style.width = '332px'; });
    const header = await page.locator('.pith-view-header').evaluate((element: HTMLElement) => { const title = element.querySelector<HTMLElement>('.pith-title')!, button = element.querySelector<HTMLElement>('#open-dojo')!, outer = element.getBoundingClientRect(), rect = button.getBoundingClientRect(); return { width: outer.width, title: title.getBoundingClientRect().width, scroll: element.scrollLeft, clipped: element.scrollWidth > element.clientWidth, icon: !!button.querySelector('svg'), buttonInside: rect.left >= outer.left && rect.right <= outer.right, name: button.getAttribute('aria-label') }; });
    assert.equal(header.width, 332); assert.equal(header.scroll, 0); assert.ok(header.title >= 56, `title width ${header.title}`); assert.equal(header.clipped, false); assert.equal(header.buttonInside, true); assert.equal(header.icon, true); assert.match(header.name || '', /行间|费曼复述/);
    await page.locator('#open-dojo').click();
    assert.equal(await page.locator('.pith-dojo-panel').evaluate((panel: HTMLElement) => panel.scrollWidth <= panel.clientWidth && Array.from(panel.querySelectorAll('button')).every(button => getComputedStyle(button).whiteSpace === 'nowrap' && button.scrollWidth <= button.clientWidth)), true);
    assert.equal(await page.locator('.pith-dojo-group').count(), 3); assert.equal(await page.locator('.pith-dojo-group').evaluateAll((groups: Element[]) => groups.every((group: Element) => { const rect = group.getBoundingClientRect(), panel = group.parentElement!.getBoundingClientRect(); return rect.left >= panel.left && rect.right <= panel.right && (!group.querySelector('button') || !!group.querySelector('label input:checked')); })), true);
    await page.screenshot({ path: join(evidence, "header-native-narrow.png") });
    await page.evaluate(() => { const style = document.body.style; style.setProperty('--background-primary', '#1e1e1e'); style.setProperty('--background-secondary', '#282828'); style.setProperty('--background-modifier-border', '#454545'); style.setProperty('--background-modifier-hover', '#383838'); style.setProperty('--text-normal', '#eee'); style.setProperty('--text-muted', '#aaa'); }); await page.screenshot({ path: join(evidence, "header-native-narrow-dark.png") });
    for (const id of ['feynman', 'interline']) { await page.locator(`[data-toolkit-toggle="${id}"]`).uncheck(); await page.waitForFunction(() => Array.from(document.querySelectorAll<HTMLInputElement>('[data-toolkit-toggle]')).every(item => !item.disabled)); }
    assert.equal(await page.locator('#open-dojo').getAttribute('aria-label'), '打开实训工具'); assert.equal(await page.locator('#open-dojo svg').count(), 1);
    await page.locator('[data-toolkit-toggle="feynman"]').check(); await page.waitForFunction(() => Array.from(document.querySelectorAll<HTMLInputElement>('[data-toolkit-toggle]')).every(item => !item.disabled));
    await page.locator('#root').evaluate((root: HTMLElement) => { root.style.width = '650px'; }); await page.waitForFunction(() => getComputedStyle(document.querySelector('#open-dojo')!).fontSize !== '0px'); assert.match(await page.locator('#open-dojo').textContent(), /费曼复述/); assert.match(await page.locator('#open-dojo').getAttribute('aria-label') || '', /费曼复述/);
  } finally { if (browser) await browser.close(); await new Promise<void>((ok, fail) => host.close(error => error ? fail(error) : ok())); await rm(root, { recursive: true, force: true }); }
});
