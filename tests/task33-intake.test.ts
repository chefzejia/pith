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
import { createPithWebServer } from "../src/shells/web/server.ts";
import { NodeWorkspaceStorage } from "../src/shells/web/nodeStorage.ts";
import { defaultToolkitsForMaterial } from "../src/workbench/toolkitSlot.ts";
import { importedMaterialKind, isMediaFile } from "../src/workbench/mediaAssets.ts";
import { testSandbox } from "./sandbox.ts";

test("material defaults count writing rather than extensions and respect media and repositories", () => {
  const classify = (name: string, sampleText?: string) => defaultToolkitsForMaterial({ kind: "book", files: [{ name }], sampleText });
  assert.deepEqual(classify("数学.pdf"), ["feynman"]);
  assert.deepEqual(classify("数学.epub", "数学.pdf"), ["feynman"]);
  assert.deepEqual(classify("English.epub", "A short English title"), ["interline", "feynman"]);
  assert.deepEqual(classify("English.epub", "这是中文正文"), ["feynman"]);
  assert.deepEqual(classify("混排.pdf", "AB中文"), ["interline", "feynman"]);
  assert.deepEqual(classify("混排.pdf", "A1"), ["interline", "feynman"]);
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
  const root = await testSandbox("task33-browser-"), repo = join(root, "repo"), workspace = join(root, "workspace"); await mkdir(repo); await mkdir(workspace);
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
    await page.locator('[name="title"]').fill("理解受控代码仓"); await page.locator("[data-intake-repo]").click(); await page.locator('[name="repoPath"]').fill(repo); await page.locator("[data-intake-guide]").click();
    await page.getByText("受控课程大纲").first().waitFor(); assert.equal(await page.locator(".pith-guide").isVisible(), true);
    await page.locator(".pith-nav-toggle").click(); assert.equal(await page.getByText("01-第一讲.md").count(), 1); const oldCompose = await page.locator('.pith-guide textarea').elementHandle(); await page.locator('[data-file="01-第一讲.md"]').click(); await page.waitForFunction((old: HTMLElement) => !old.isConnected, oldCompose);
    await page.locator(".pith-article").getByText("第一讲").waitFor(); await page.evaluate(() => { (window as any).readingNode = document.querySelector(".pith-article h1"); });
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
  } finally { if (browser) await browser.close(); await new Promise<void>((ok, fail) => server.close(error => error ? fail(error) : ok())); await rm(root, { recursive: true, force: true }); }
});

test("native shared surface opens empty topic and refreshes a generated lesson", { timeout: 60000, skip: !process.env.PITH_PLAYWRIGHT_MODULE || !process.env.PITH_CHROME_PATH }, async () => {
  const root = await testSandbox("task33-native-"); let browser: any;
  const host = createServer((_req, res) => res.end("<!doctype html>")); await new Promise<void>(ok => host.listen(0, "127.0.0.1", ok));
  try {
    const bundle = await build({ entryPoints: ["src/shells/obsidian/index.ts"], bundle: true, write: false, platform: "browser", format: "iife", globalName: "NativePith", external: ["node:*", "obsidian"] });
    const { chromium } = await import(process.env.PITH_PLAYWRIGHT_MODULE!); browser = await chromium.launch({ executablePath: process.env.PITH_CHROME_PATH, headless: true });
    const page = await browser.newPage({ viewport: { width: 1100, height: 800 } }); page.setDefaultTimeout(8000);
    const address = host.address(); assert.ok(address && typeof address !== "string"); await page.goto(`http://127.0.0.1:${address.port}`);
    await page.setContent('<style>html,body{height:100%;margin:0}#root{height:100%;width:75%}#side{position:absolute;right:0;top:0;width:25%;height:100%}body{--background-primary:#fff;--background-secondary:#f1f3ef;--background-modifier-border:#ccd5cd;--background-modifier-hover:#e1e9e2;--text-normal:#222;--text-muted:#666;--font-interface:Arial}</style><div id="root"></div><div id="side"></div>');
    await page.evaluate(() => { (window as any).require = (id: string) => id === "obsidian" ? { ItemView: class { contentEl: HTMLElement | null; constructor(leaf: any) { this.contentEl = leaf?.container || document.getElementById("root"); } }, Plugin: class {}, Notice: class { constructor(message: string) { (window as any).notice = message; } } } : id === "node:util" ? { promisify: (fn: unknown) => fn } : id === "node:net" ? { BlockList: class { addSubnet() {} } } : {}; });
    await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
    await page.evaluate(async () => {
      const data = new Map<string, Uint8Array>(), folders = new Set<string>(); const encoder = new TextEncoder(), decoder = new TextDecoder();
      const storage = { exists: async (path: string) => data.has(path) || folders.has(path), readText: async (path: string) => { if (!data.has(path)) throw new Error("missing " + path); return decoder.decode(data.get(path)); }, readBinary: async (path: string) => { const value = data.get(path); if (!value) throw new Error("missing " + path); return value; }, writeText: async (path: string, text: string) => { data.set(path, encoder.encode(text)); }, createText: async (path: string, text: string) => { if (data.has(path)) throw new Error("exists"); data.set(path, encoder.encode(text)); }, writeBinary: async (path: string, bytes: Uint8Array) => { data.set(path, bytes); }, createBinary: async (path: string, bytes: Uint8Array) => { if (data.has(path)) throw new Error("exists"); data.set(path, bytes); }, processText: async (path: string, update: (text: string) => string) => { const result = update(decoder.decode(data.get(path))); data.set(path, encoder.encode(result)); return result; }, mkdir: async (path: string) => { folders.add(path); }, list: async (path: string) => [...folders, ...data.keys()].filter(item => item.startsWith(path + "/") && !item.slice(path.length + 1).includes("/")).map(item => ({ path: item, type: folders.has(item) ? "folder" : "file" })) };
      const host = { id: "obsidian", storage }, controller = new (window as any).NativePith.PithObsidianController(host); await controller.initialize();
      let calls = 0; controller.engine.sendMessage = async ({ topicId }: { topicId: string }) => { if (calls++ > 0) return; const material = await controller.store.importMaterial({ title: "课程", kind: "article", files: [] }); await controller.store.updateTopic(topicId, { materialId: material.id }); await controller.store.writeGeneratedFile(material.id, "00-课程大纲.md", "# 原生课程大纲\n第一讲"); await controller.store.writeGeneratedFile(material.id, "01-第一讲.md", "# 原生第一讲\n真实内容"); };
      const leaf: any = { container: document.getElementById("side"), detach() {}, async setViewState() { this.view = new (window as any).NativePith.PithGuideView(this); } }; const workspace = { rightSplit: { expand() {}, collapse() {} }, getRightLeaf: () => leaf, getLeavesOfType: () => leaf.view ? [leaf] : [], revealLeaf: async () => {} };
      const view = new (window as any).NativePith.PithWorkspaceView({}, controller, host, workspace); (window as any).nativeController = controller; await view.onOpen();
    });
    await page.locator('[name="title"]').fill("原生空课题"); await page.locator("[data-intake-guide]").click();
    try { await page.getByText("原生课程大纲").first().waitFor({ timeout: 8000 }); } catch (error) { throw new Error(`native state: ${await page.locator("body").innerText()} notice=${await page.evaluate(() => (window as any).notice)}`, { cause: error }); }
    await page.locator('.pith-nav-toggle').click(); await page.locator('[data-file="01-第一讲.md"]').click(); await page.locator('.pith-article').getByText("原生第一讲").waitFor(); await page.evaluate(() => { (window as any).readingNode = document.querySelector(".pith-article h1"); });
    await page.locator('.pith-guide textarea').fill("普通问题"); await page.locator('[data-guide-send]').click(); await page.waitForFunction(() => !(document.querySelector('[data-guide-send]') as HTMLButtonElement).disabled);
    assert.equal(await page.evaluate(() => (window as any).readingNode === document.querySelector(".pith-article h1")), true); assert.equal(await page.locator('.pith-article h1').textContent(), "原生第一讲");
    await page.locator("#open-dojo").click(); await page.locator('[data-toolkit-toggle="feynman"]').uncheck(); await page.waitForFunction(() => Array.from(document.querySelectorAll<HTMLInputElement>('[data-toolkit-toggle]')).every(item => !item.disabled));
    assert.deepEqual(await page.evaluate(async () => (await (window as any).nativeController.store.listTopics())[0].toolkits), []);
    const evidence = resolve(".tmp/evidence/task-33"); await mkdir(evidence, { recursive: true }); await page.screenshot({ path: join(evidence, "native-guide.png") });
    await page.locator('[data-command="home"]').click(); await page.locator('.pith-intake-box input[type="file"]').setInputFiles({ name: "sample.ts", mimeType: "video/mp2t", buffer: Buffer.from('const value = "<script>";\nsecond line') }); await page.locator('[data-intake-open]').click();
    await page.locator('.pith-article [data-locator="text:line:1"]').getByText("second line").waitFor();
    const imported = await page.evaluate(async () => { const controller = (window as any).nativeController; const topics = await controller.store.listTopics(); for (const topic of topics) { if (!topic.materialId) continue; const material = await controller.store.getMaterial(topic.materialId); if (material.files.some((file: any) => file.name === "sample.ts")) return { topic, material }; } throw new Error("imported topic not found"); });
    assert.equal(imported.material.kind, "article"); assert.equal(imported.material.files[0].mimeType, "video/mp2t"); assert.deepEqual(imported.topic.toolkits, ["interline", "feynman"]); assert.equal(await page.locator('.pith-article script').count(), 0);
    const binaryRejected = await page.evaluate(async () => { const c = (window as any).nativeController; const material = await c.importMaterial({ title: "binary", kind: "article", files: [{ name: "fake.ts", mimeType: "video/mp2t", bytes: new Uint8Array([65, 0, 66]) }] }); try { await c.renderMaterialFile(material.id, "fake.ts"); return false; } catch (error) { return String(error).includes("binary"); } }); assert.equal(binaryRejected, true);
    await page.screenshot({ path: join(evidence, "fix-native-source.png") });
    await page.setViewportSize({ width: 443, height: 850 }); await page.locator('#open-dojo').click();
    assert.equal(await page.locator('.pith-dojo-panel').evaluate((panel: HTMLElement) => panel.scrollWidth <= panel.clientWidth && Array.from(panel.querySelectorAll('button')).every(button => getComputedStyle(button).whiteSpace === 'nowrap' && button.scrollWidth <= button.clientWidth)), true);
    assert.equal(await page.locator('.pith-dojo-group').count(), 3); assert.equal(await page.locator('.pith-dojo-group').evaluateAll((groups: Element[]) => groups.every((group: Element) => { const rect = group.getBoundingClientRect(), panel = group.parentElement!.getBoundingClientRect(); return rect.left >= panel.left && rect.right <= panel.right && (!group.querySelector('button') || !!group.querySelector('label input:checked')); })), true);
    await page.screenshot({ path: join(evidence, "fix-native-narrow.png") });
    await page.evaluate(() => { const style = document.body.style; style.setProperty('--background-primary', '#1e1e1e'); style.setProperty('--background-secondary', '#282828'); style.setProperty('--background-modifier-border', '#454545'); style.setProperty('--background-modifier-hover', '#383838'); style.setProperty('--text-normal', '#eee'); style.setProperty('--text-muted', '#aaa'); }); await page.screenshot({ path: join(evidence, "fix-native-narrow-dark.png") });
  } finally { if (browser) await browser.close(); await new Promise<void>((ok, fail) => host.close(error => error ? fail(error) : ok())); await rm(root, { recursive: true, force: true }); }
});
