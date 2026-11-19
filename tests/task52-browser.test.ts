import { testToolkits } from "./guide-tools-fixture.ts";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, readFile, rm, writeFile, copyFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { DefaultWorkspaceStore, type GuideProvider } from "../src/core/index.ts";
import { createScopedTools } from "../src/plugins/guide-acp/tools.ts";
import { createPithWebServer } from "../src/shells/web/server.ts";
import { NodeWorkspaceStorage } from "../src/shells/web/nodeStorage.ts";
import { coveredEpub } from "./task29-fixture.ts";
import { testSandbox } from "./sandbox.ts";

const enabled = Boolean(process.env.PITH_PLAYWRIGHT_MODULE && process.env.PITH_CHROME_PATH);
async function capture(page: any, name: string): Promise<void> {
  const path = join(process.env.PITH_TEST_SCREENSHOT_DIR!, `${name}.png`); await page.screenshot({ path });
  if (process.env.PITH_WORKER_CAPTURE_DIR) { await mkdir(process.env.PITH_WORKER_CAPTURE_DIR, { recursive: true }); await copyFile(path, join(process.env.PITH_WORKER_CAPTURE_DIR, `${name}.png`)); }
}
async function quote(page: any): Promise<void> {
  await page.locator('.pith-article p[data-prose="true"]').first().evaluate((node: HTMLElement) => { const range = document.createRange(); range.selectNodeContents(node); const selection = getSelection()!; selection.removeAllRanges(); selection.addRange(range); node.dispatchEvent(new MouseEvent("mouseup", { bubbles: true })); });
}

test("Task52 Web feeds without Agent, groups originals, caches covers and owns standalone notes", { skip: !enabled, timeout: 60000 }, async () => {
  const root = await testSandbox("task52-web-feed-"), workspace = join(root, "workspace"), repo = join(root, "repository with spaces");
  await mkdir(repo); const git = promisify(execFile), env = { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_AUTHOR_NAME: "Fixture", GIT_AUTHOR_EMAIL: "fixture@example.invalid", GIT_COMMITTER_NAME: "Fixture", GIT_COMMITTER_EMAIL: "fixture@example.invalid" };
  await git("git", ["-C", repo, "init", "-q"], { env }); await writeFile(join(repo, "README.md"), "Pinned repository content\n"); await mkdir(join(repo, "src")); await writeFile(join(repo, "src/index.ts"), "export const pinned = true;\n"); await git("git", ["-C", repo, "add", "README.md", "src/index.ts"], { env }); await git("git", ["-C", repo, "commit", "-qm", "fixture"], { env });
  const source = "# A learning notebook\n\nAn original paragraph explains a causal mechanism.\n\nA second paragraph gives a counterexample.";
  const http = { request: async () => { throw new Error("unused"); }, requestPublic: async () => ({ status: 200, headers: { "content-type": "text/markdown" }, bytes: new TextEncoder().encode(source) }) };
  await mkdir(workspace); const server = await createPithWebServer({ workspaceDir: workspace, http }); let browser: any;
  try {
    const address = server.address(); assert.ok(address && typeof address !== "string"); const base = `http://127.0.0.1:${address.port}`, storage = new NodeWorkspaceStorage(workspace), store = new DefaultWorkspaceStore(storage);
    const { chromium } = await import(process.env.PITH_PLAYWRIGHT_MODULE!); browser = await chromium.launchPersistentContext(join(root, "profile"), { executablePath: process.env.PITH_CHROME_PATH, headless: true, viewport: { width: 1280, height: 860 } }); const page = await browser.newPage(); page.setDefaultTimeout(8000);
    let agentCalls = 0, translations = 0; const errors: string[] = []; page.on("pageerror", (error: Error) => errors.push(error.message)); page.on("request", (request: any) => { if (/\/api\/(intake|chat)$/.test(new URL(request.url()).pathname) && request.method() === "POST") agentCalls++; if (request.url().endsWith("/api/interline")) translations++; });
    await page.goto(base); await page.locator('[name="title"]').fill("需要向导的问题"); assert.equal(await page.locator('[data-intake-open]').isDisabled(), true); await page.getByText(/向导未连接/).waitFor(); await page.locator('[name="title"]').fill("");
    const media = await readFile("tests/fixtures/task38-video.webm");
    await page.locator('.pith-intake-box [type="file"]').setInputFiles([
      { name: "notebook.md", mimeType: "text/markdown", buffer: Buffer.from(source) },
      { name: "reading.epub", mimeType: "application/epub+zip", buffer: Buffer.from(coveredEpub()) },
      { name: "clip.webm", mimeType: "video/webm", buffer: media },
      { name: "clip.en-US.vtt", mimeType: "text/vtt", buffer: Buffer.from("WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nA controlled caption.\n") },
    ]);
    await page.locator('[data-intake-open]').click(); await page.locator('.pith-material-card').nth(2).waitFor(); assert.equal(await page.locator('.pith-home').isVisible(), true);
    const materials = await store.listMaterials(); assert.equal(materials.length, 3); assert.equal((await store.listTopics()).length, 0); assert.equal(agentCalls, 0);
    const clip = materials.find(material => material.kind === "media")!; assert.deepEqual(clip.files.map(file => file.name), ["clip.webm", "clip.en-US.vtt"]); assert.deepEqual(new Uint8Array(await storage.readBinary(`materials/${clip.id}/files/clip.webm`)), new Uint8Array(media));
    const book = materials.find(material => material.kind === "book")!; const cache = JSON.parse(await storage.readText(`_cache/covers/${book.id}.json`)); assert.match(cache.url, /^data:image\/png;base64,/);
    await page.waitForFunction(() => Array.from(document.querySelectorAll<HTMLImageElement>(".pith-material-card img")).some(image => image.naturalWidth > 0)); await capture(page, "home-library");
    const article = materials.find(material => material.title === "notebook")!;
    await page.locator(`[data-material="${article.id}"]`).click(); await page.locator('.pith-article').getByText("An original paragraph explains a causal mechanism.").waitFor();
    assert.equal(await page.locator('#open-toolkit').isHidden(), true); assert.equal(await page.locator('[data-guide-tab="chat"]').count(), 0); assert.equal(translations, 0);
    await quote(page); assert.equal(await page.locator('.pith-selection [data-selection="ask"]').count(), 0); await page.locator('[data-selection="highlight"]').click(); await page.locator('mark[data-pith-note]').waitFor();
    await quote(page); await page.locator('[data-selection="note"]').click(); await page.locator('.pith-guide textarea').fill("先检查因果成立的条件"); await page.locator('[data-guide-send]').click(); await page.locator('.pith-note-source').getByText("先检查因果成立的条件").waitFor();
    assert.deepEqual((await store.getMaterial(article.id))!.notes.map(note => [note.kind, note.author, note.anchor?.source]), [["highlight", "user", { kind: "material", materialId: article.id }], ["note", "user", { kind: "material", materialId: article.id }]]);
    await page.locator('[data-command="typography"]').click(); await page.locator('[data-interline-reason]').getByText(/向导未连接/).waitFor(); assert.equal(await page.locator('[data-interline-mode="bilingual"]').isDisabled(), true); await page.keyboard.press("Escape");
    await capture(page, "standalone-notes"); await page.setViewportSize({ width: 375, height: 812 }); await capture(page, "standalone-phone"); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true); await page.setViewportSize({ width: 1280, height: 860 });
    await page.locator('[data-command="intake"]').click(); await page.locator('[data-intake-open]').click(); await page.getByText("请输入你想搞懂的问题").waitFor(); await page.locator('.pith-guide [name="title"]').fill("解释这个机制"); assert.equal(await page.locator('[data-intake-open]').isDisabled(), true); await page.getByRole("button", { name: "返回笔记" }).click(); await page.locator('.pith-note-source').getByText("先检查因果成立的条件").waitFor();
    await page.locator('[data-command="home"]').click(); await page.locator('[name="title"]').fill("https://example.com/article"); await page.locator('[data-intake-open]').click(); await page.locator('.pith-article h1').getByText("A learning notebook").waitFor();
    await page.locator('[data-command="home"]').click(); await page.locator('[name="title"]').fill(repo); await page.locator('[data-intake-open]').click(); await page.locator('.pith-article').getByText("Pinned repository content").waitFor();
    const repository = (await store.listMaterials()).find(material => material.kind === "repo")!;
    const savedPosition = page.waitForResponse((response: any) => response.url().endsWith("/api/reading-locator") && response.request().postDataJSON().file === "src/index.ts");
    await page.locator('.pith-nav-toggle').click(); await page.locator('[data-file="src/index.ts"]').click(); await page.locator('.pith-article').getByText("export const pinned = true;").waitFor(); assert.equal((await savedPosition).ok(), true);
    await page.locator('[data-command="home"]').click(); assert.equal(await page.locator('.pith-material-card').first().getAttribute("data-material"), repository.id); await page.locator(`[data-material="${repository.id}"]`).click(); await page.locator('.pith-article').getByText("export const pinned = true;").waitFor(); assert.deepEqual((await store.getMaterial(repository.id))!.files, []);

    await page.locator('[data-command="home"]').click(); await page.locator('[name="title"]').fill(`${repo} 解释绑定提交`); await page.locator('[data-intake-open]').click(); await page.getByText(/向导未连接/).waitFor(); assert.equal(await page.locator('[data-intake-open]').isDisabled(), true);
    assert.equal((await store.listTopics()).length, 0); assert.equal(agentCalls, 0); assert.equal(translations, 0); assert.deepEqual(errors, []);
  } finally { if (browser) await browser.close(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); await rm(root, { recursive: true, force: true }); }
});

test("Task52 controlled provider exercises failure, stop, follow-up intake and all topic material sources", { skip: !enabled, timeout: 60000 }, async () => {
  const root = await testSandbox("task52-web-intake-"), workspace = join(root, "workspace"), storage = new NodeWorkspaceStorage(workspace), store = new DefaultWorkspaceStore(storage);
  let calls = 0, stopped = 0; const translations: string[] = [];
  const provider: GuideProvider = { async run(input, options) {
    calls++; if (input.scope.kind !== "intake") throw new Error("unexpected topic turn");
    options.onStep({ kind: "thought", text: "读取材料并厘清问题" }, 0);
    if (input.text === "失败目标") return { status: "failed", error: "受控连接中断" };
    if (input.text === "停止目标") { await new Promise<void>(resolve => options.signal.addEventListener("abort", () => resolve(), { once: true })); stopped++; return { status: "stopped" }; }
    if (input.text === "尚不清楚") { options.onStep({ kind: "reply", markdown: "你想区分哪两个机制？" }, 1); return { status: "completed" }; }
    assert.ok(input.history.some(turn => turn.user.text === "尚不清楚"));
    const tools = createScopedTools({ toolkits: testToolkits, store, storage, materialIds: input.scope.materialIds, onChoices() {} });
    const create = tools.find(tool => tool.name === "pith_create_topic")!, args = { title: "区分因果与相关", target: input.text, materialIds: input.scope.materialIds, toolkits: ["feynman"] }, topic = await create.execute(args);
    options.onStep({ kind: "tool", callId: "create", name: create.name, inputPreview: "{}", status: "completed", effects: await create.effects!(topic, args) }, 1);
    await tools.find(tool => tool.name === "pith_write_lesson")!.execute({ fileName: "00-课程大纲.md", markdown: "# 区分因果与相关\n\n- [01-证据.md] 证据：什么支持因果结论\n- [02-反例.md] 反例：条件何时不成立" });
    await tools.find(tool => tool.name === "pith_write_lesson")!.execute({ fileName: "01-证据.md", markdown: "# 证据\n\n从原文中的前提开始，核对结论成立的条件。" });
    options.onStep({ kind: "reply", markdown: "先核对因果成立的条件。" }, 2); return { status: "completed" };
  } };
  const http = { request: async () => { throw new Error("unused"); }, requestPublic: async () => ({ status: 200, headers: { "content-type": "text/markdown" }, bytes: new TextEncoder().encode("# External evidence\n\nAn external paragraph supplies evidence.") }) };
  const repo = join(root, "topic repository"); await mkdir(repo);
  const git = promisify(execFile), env = { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_AUTHOR_NAME: "Fixture", GIT_AUTHOR_EMAIL: "fixture@example.invalid", GIT_COMMITTER_NAME: "Fixture", GIT_COMMITTER_EMAIL: "fixture@example.invalid" };
  await git("git", ["-C", repo, "init", "-q"], { env }); await writeFile(join(repo, "README.md"), "Pinned topic repository evidence\n"); await git("git", ["-C", repo, "add", "README.md"], { env }); await git("git", ["-C", repo, "commit", "-qm", "fixture"], { env });
  await mkdir(workspace); const server = await createPithWebServer({ workspaceDir: workspace, guideProvider: provider, http, interlineTranslator: async input => { translations.push(input.materialId); return new Map(input.segments.map(segment => [segment.locator, "译文：检查因果条件。"])) } }); let browser: any;
  try {
    const address = server.address(); assert.ok(address && typeof address !== "string"); const base = `http://127.0.0.1:${address.port}`;
    const { chromium } = await import(process.env.PITH_PLAYWRIGHT_MODULE!); browser = await chromium.launchPersistentContext(join(root, "profile"), { executablePath: process.env.PITH_CHROME_PATH, headless: true, viewport: { width: 1280, height: 860 } }); const page = await browser.newPage(); page.setDefaultTimeout(8000); await page.goto(base);
    await page.locator('.pith-intake-box [type="file"]').setInputFiles({ name: "evidence.md", mimeType: "text/markdown", buffer: Buffer.from("# Causal evidence\n\nAn original paragraph states necessary conditions.") });
    await page.locator('[name="title"]').fill("失败目标"); await page.locator('[data-intake-open]').click(); await page.locator('.pith-home-status').getByText("受控连接中断").waitFor(); assert.equal(await page.locator('[name="title"]').inputValue(), "失败目标"); assert.equal((await store.listMaterials()).length, 1); assert.equal((await store.listTopics()).length, 0);
    const intakeProcess = page.locator(".pith-intake-process");
    const previousTurn = await intakeProcess.getAttribute("data-intake-turn");
    await page.locator('[name="title"]').fill("停止目标"); await page.locator('[data-intake-open]').click();
    await page.waitForFunction((id: string | null) => document.querySelector(".pith-intake-process")?.getAttribute("data-intake-turn") !== id, previousTurn);
    const summary = intakeProcess.locator(".pith-guide-thought summary");
    const thought = intakeProcess.getByText("读取材料并厘清问题", { exact: true });
    await summary.waitFor({ state: "visible" });
    await thought.waitFor({ state: "attached" });
    assert.equal(await thought.isVisible(), false);
    await summary.click();
    await thought.waitFor({ state: "visible" });
    await page.getByRole("button", { name: "停止", exact: true }).click(); await page.locator('.pith-home-status').getByText("已停止", { exact: true }).waitFor(); assert.equal(stopped, 1); assert.equal(await page.locator('[name="title"]').inputValue(), "停止目标");
    await page.locator('[name="title"]').fill("尚不清楚"); await page.locator('[data-intake-open]').click(); await page.getByText("你想区分哪两个机制？").waitFor(); assert.equal((await store.listTopics()).length, 0); assert.equal((await store.listMaterials()).length, 1);
    await page.locator('[name="title"]').fill("区分因果与相关的机制"); await page.locator('[data-intake-open]').click(); await page.locator('.pith-article').getByText("区分因果与相关", { exact: true }).waitFor(); const topic = (await store.listTopics())[0]!; assert.equal(calls, 4); assert.equal((await store.listMaterials()).length, 1); assert.equal(await page.locator('.pith-guide').isVisible(), true);
    await page.locator('.pith-nav-toggle').click(); await page.locator('[data-planned-lesson="02-反例.md"]').waitFor(); assert.equal(await page.locator('.pith-left-drawer h2').getByText("材料", { exact: true }).count(), 1); await page.locator('[data-material-id]').first().click(); await page.locator('.pith-interline-subtitle').first().waitFor(); assert.deepEqual(topic.toolkits, ["feynman"]);
    await page.locator('#open-toolkit').click(); assert.equal(await page.locator('[data-toolkit-choose="interline"]').count(), 0); await page.keyboard.press("Escape");
    await page.locator('[data-command="typography"]').click(); await page.locator('[data-interline-mode="original"]').click(); await page.waitForFunction(() => document.querySelectorAll(".pith-interline-subtitle").length === 0); assert.deepEqual((await store.getMaterial(topic.materialIds[0]!))!.aids, []); await page.locator('[data-interline-mode="bilingual"]').click(); await page.locator('.pith-interline-subtitle').first().waitFor(); await page.keyboard.press("Escape");
    const second = await store.importMaterial({ title: "图书馆证据", kind: "article", files: [{ name: "library.md", bytes: new TextEncoder().encode("# 库中原文\n\n已有材料的证据。") }] });
    await page.locator('[data-command="import"]').click(); await page.locator('.pith-material-picker-list button').getByText("图书馆证据").click(); await page.locator('.pith-article').getByText("已有材料的证据。").waitFor();
    assert.ok((await store.getTopic(topic.id))!.materialIds.includes(second.id));
    await page.locator('.pith-material-picker [type="file"]').setInputFiles([{ name: "extra.md", mimeType: "text/markdown", buffer: Buffer.from("# Extra evidence\n\nAnother original paragraph.") }, { name: "other.md", mimeType: "text/markdown", buffer: Buffer.from("# 另一份\n\n独立材料。") }]); await page.locator('.pith-article').getByText("独立材料。").waitFor();
    await page.locator('.pith-material-picker form input').fill("https://example.com/evidence"); await page.locator('.pith-material-picker form button').click(); await page.locator('.pith-article').getByText("An external paragraph supplies evidence.").waitFor();
    await page.locator('.pith-material-picker form input').fill(repo); await page.locator('.pith-material-picker form button').click(); await page.locator('.pith-article').getByText("Pinned topic repository evidence").waitFor();
    await page.locator('[data-picker-close]').click(); await page.locator('.pith-nav-toggle').click(); await capture(page, "topic-drawer"); assert.equal((await store.getTopic(topic.id))!.materialIds.length, 6);
    const translatedBeforeStandalone = translations.filter(id => id === topic.materialIds[0]).length;
    await page.locator('[data-command="home"]').click(); await page.locator(`[data-material="${topic.materialIds[0]}"]`).click(); await page.locator('.pith-interline-subtitle').first().waitFor(); assert.equal(translations.filter(id => id === topic.materialIds[0]).length, translatedBeforeStandalone, "standalone reuses the same material cache");
    assert.deepEqual((await store.getTopic(topic.id))!.toolkits, ["feynman"]);
  } finally { if (browser) await browser.close(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); await rm(root, { recursive: true, force: true }); }
});

test("Task52 Obsidian host uses real store for feed, material notes, Aa and material-based intake", { skip: !enabled, timeout: 60000 }, async () => {
  const root = await testSandbox("task52-native-"), workspace = join(root, "workspace"); await mkdir(workspace); let browser: any;
  try {
    const { nativeWorkbenchFixture } = await import("./native-workbench-fixture.ts");
    const { chromium } = await import(process.env.PITH_PLAYWRIGHT_MODULE!); browser = await chromium.launchPersistentContext(join(root, "profile"), { executablePath: process.env.PITH_CHROME_PATH, headless: true, viewport: { width: 1100, height: 800 } }); const page = await browser.newPage(); page.setDefaultTimeout(8000);
    await nativeWorkbenchFixture(page, workspace, true);
    await page.locator('.pith-intake-box [type="file"]').setInputFiles({ name: "causes.md", mimeType: "text/markdown", buffer: Buffer.from("# Causes and conditions\n\nA necessary condition explains when the causal claim holds.") }); await page.locator('[data-intake-open]').click(); await page.locator('.pith-interline-subtitle').first().waitFor();
    assert.equal(await page.locator('#open-toolkit').isHidden(), true); assert.equal(await page.locator('[data-guide-tab="chat"]').count(), 0);
    await quote(page); await page.locator('[data-selection="note"]').click(); await page.locator('.pith-guide textarea').fill("原生笔记保存到材料"); await page.locator('[data-guide-send]').click(); await page.locator('.pith-note-source').getByText("原生笔记保存到材料").waitFor();
    const store = new DefaultWorkspaceStore(new NodeWorkspaceStorage(workspace)), material = (await store.listMaterials())[0]!; assert.equal(material.notes[0]!.body, "原生笔记保存到材料"); assert.equal((await store.listTopics()).length, 0);
    await page.locator('[data-command="typography"]').click(); await page.locator('[data-interline-mode="original"]').click(); await page.waitForFunction(() => document.querySelectorAll(".pith-interline-subtitle").length === 0); assert.deepEqual((await store.getMaterial(material.id))!.aids, []); await page.locator('[data-interline-mode="bilingual"]').click(); await page.locator('.pith-interline-subtitle').first().waitFor(); await page.keyboard.press("Escape");
    assert.equal(await page.locator(".pith-note-source strong").textContent(), "笔记");
    await capture(page, "native-material-notes");
    await page.locator('[data-command="intake"]').click(); await page.locator('[data-intake-open]').click(); await page.getByText("请输入你想搞懂的问题").waitFor(); await page.locator('.pith-guide [name="title"]').fill("哪些条件保证因果结论成立"); await page.locator('[data-intake-open]').click(); await page.locator('#open-toolkit').waitFor({ state: "visible" }); await page.locator('.pith-guide [data-guide-tab="chat"]').waitFor().catch(async (error: Error) => { throw new Error(`${error.message}\n${await page.locator("body").innerText()}\nnotice=${await page.evaluate(() => (window as any).notice)}`); });
    const topic = (await store.listTopics())[0]!; assert.deepEqual(topic.materialIds, [material.id]); assert.deepEqual(topic.toolkits, ["feynman"]); assert.deepEqual(topic.notes, []); assert.equal((await store.getMaterial(material.id))!.notes.length, 1);
    await page.evaluate(async () => { await (window as any).nativeTask52.view.onClose(); (window as any).nativeTask52.controller.dispose(); });
  } finally { if (browser) await browser.close(); await rm(root, { recursive: true, force: true }); }
});
