import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { build } from "esbuild";
import { DefaultWorkspaceStore } from "../src/core/index.ts";
import { createScopedTools } from "../src/plugins/guide-acp/tools.ts";
import { NodeWorkspaceStorage } from "../src/shells/web/nodeStorage.ts";
import { createPithWebServer } from "../src/shells/web/server.ts";
import { NodeRepositoryPort } from "../src/shells/web/nodeRepository.ts";
import { testSandbox } from "./sandbox.ts";

test("Web intake binds two repositories to one topic and shows both directories", { timeout: 60000, skip: !process.env.PITH_PLAYWRIGHT_MODULE || !process.env.PITH_CHROME_PATH }, async () => {
  const root = await testSandbox("task51-two-repos-"), workspace = join(root, "workspace");
  const paths = [join(root, "repo one"), join(root, "repo two")];
  const git = promisify(execFile), env = { PATH: process.env.PATH, HOME: root, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_AUTHOR_NAME: "Fixture", GIT_AUTHOR_EMAIL: "fixture@example.invalid", GIT_COMMITTER_NAME: "Fixture", GIT_COMMITTER_EMAIL: "fixture@example.invalid" };
  await mkdir(workspace);
  for (const [index, path] of paths.entries()) {
    await mkdir(path); await git("git", ["-C", path, "init", "-q"], { env });
    await writeFile(join(path, "README.md"), `repository ${index + 1}\n`);
    await git("git", ["-C", path, "add", "."], { env }); await git("git", ["-C", path, "commit", "-qm", "fixture"], { env });
  }
  const storage = new NodeWorkspaceStorage(workspace), store = new DefaultWorkspaceStore(storage);
  let intakeCalls = 0, releaseIntake: (() => void) | undefined, intakeArrived: (() => void) | undefined;
  const intakeWaiting = new Promise<void>(resolve => { intakeArrived = resolve; });
  const server = await createPithWebServer({ workspaceDir: workspace, guideProvider: { async run(input, options) {
    if (input.scope.kind !== "intake") throw new Error("Expected intake");
    intakeCalls++; await new Promise<void>(resolve => { releaseIntake = resolve; intakeArrived!(); });
    assert.equal(input.text, "比较两个仓库的结构"); assert.equal(input.scope.materialIds.length, 2);
    const tools = createScopedTools({ store, storage, materialIds: input.scope.materialIds, onChoices() {} });
    const create = tools.find(tool => tool.name === "pith_create_topic")!, args = { title: input.text, target: input.text, materialIds: input.scope.materialIds, toolkits: [] };
    const topic = await create.execute(args);
    options.onStep({ kind: "tool", name: create.name, callId: "create", inputPreview: "{}", status: "completed", effects: await create.effects!(topic, args) }, 0);
    options.onStep({ kind: "reply", markdown: "已建立比较课题" }, 1);
    await tools.find(tool => tool.name === "pith_write_lesson")!.execute({ fileName: "00-课程大纲.md", markdown: "# 比较结构\n\n参见 `README.md:1`。" });
    return { status: "completed" };
  } } });
  let browser: any;
  try {
    const address = server.address(); assert.ok(address && typeof address !== "string");
    const { chromium } = await import(process.env.PITH_PLAYWRIGHT_MODULE!);
    browser = await chromium.launchPersistentContext(join(root, "profile"), { executablePath: process.env.PITH_CHROME_PATH, headless: true, viewport: { width: 1100, height: 800 } });
    const page = await browser.newPage(); page.setDefaultTimeout(8000); await page.goto(`http://127.0.0.1:${address.port}`);
    await page.locator('[name="title"]').fill(paths[0]!); await page.locator('[data-intake-open]').click();
    await page.getByText("请写下想搞懂的问题").waitFor(); assert.equal((await store.listMaterials()).length, 0);
    await page.locator('[name="title"]').fill(`比较两个仓库的结构 ${paths.map(path => JSON.stringify(path)).join(" ")}`); await page.locator('[data-intake-open]').click();
    await Promise.race([intakeWaiting, new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Web intake did not arrive")), 8000))]); assert.equal(await page.locator('[data-intake-open]').isDisabled(), true); assert.equal(intakeCalls, 1);
    assert.equal((await store.listTopics()).length, 0); releaseIntake!();
    await page.locator('.pith-article').getByText("比较结构").waitFor();
    const topic = (await store.listTopics())[0]!; assert.equal(topic.materialIds.length, 2);
    await page.locator('.pith-guide-content').getByText("已建立比较课题").waitFor();
    const conversation = JSON.parse(await storage.readText(`topics/${topic.id}/conversation.json`));
    assert.equal(conversation.length, 1); assert.equal(conversation[0].user.text, "比较两个仓库的结构");
    const materials = await Promise.all(topic.materialIds.map(id => store.getMaterial(id)));
    assert.deepEqual(materials.map(material => material?.externalPath), paths);
    const citations = page.locator('.pith-article [data-citation-path="README.md"]'); assert.equal(await citations.count(), 2);
    await citations.nth(1).click(); await page.locator('.pith-article').getByText("repository 2").waitFor();
    await page.locator('.pith-nav-toggle').click();
    assert.equal(await page.locator('[data-material-id][data-file="README.md"]').count(), 2);
    for (const [index, material] of materials.entries()) {
      assert.ok(material);
      const response: any = await page.request.post(`http://127.0.0.1:${address.port}/api/notes`, { data: { topicId: topic.id, kind: "note", body: `note ${index + 1}`, anchor: { source: { kind: "material", materialId: material.id }, file: "README.md", locator: `repo:${material.commitSha}:README.md#L1-L1`, quote: `repository ${index + 1}` } } });
      assert.equal(response.status(), 201, await response.text());
    }
    await page.locator('[data-command="home"]').click(); await page.locator(`[data-topic="${topic.id}"]`).first().click();
    await page.locator('.pith-article').getByText("比较结构").waitFor();
    if (!await page.locator('.pith-guide').isVisible()) await page.locator('.pith-guide-toggle').click();
    await page.locator('[data-guide-tab="notes"]').click();
    await page.locator('.pith-note-source').getByText("note 1").click(); await page.locator('.pith-article').getByText("repository 1").waitFor();
    await page.locator('.pith-note-source').getByText("note 2").click(); await page.locator('.pith-article').getByText("repository 2").waitFor();

    const nativeBundle = await build({ entryPoints: ["src/shells/obsidian/index.ts"], bundle: true, write: false, platform: "browser", format: "iife", globalName: "NativePith", external: ["node:*", "obsidian"] });
    const toolsBundle = await build({ entryPoints: ["src/plugins/guide-acp/tools.ts"], bundle: true, write: false, platform: "browser", format: "iife", globalName: "NativeTools" });
    const repository = new NodeRepositoryPort();
    await page.exposeFunction("inspectFixtureRepo", (path: string) => repository.inspectRepository(path));
    await page.exposeFunction("listFixtureRepo", (path: string, sha: string, offset: number, limit: number) => repository.listFiles(path, sha, offset, limit));
    await page.exposeFunction("readFixtureRepo", (path: string, sha: string, file: string, start: number, limit: number) => repository.readFile(path, sha, file, start, limit));
    await page.route('**/native-fixture', (route: any) => route.fulfill({ contentType: "text/html", body: '<style>html,body{height:100%;margin:0}#root{height:100%;width:70%}#side{position:absolute;right:0;top:0;width:30%;height:100%}</style><div id="root"></div><div id="side"></div>' }));
    await page.goto(`http://127.0.0.1:${address.port}/native-fixture`);
    await page.evaluate(() => { (window as any).require = (id: string) => id === "obsidian" ? { ItemView: class { contentEl: HTMLElement | null; constructor(leaf: any) { this.contentEl = leaf?.container || document.getElementById("root"); } }, Plugin: class {}, Notice: class {} } : id === "node:util" ? { promisify: (fn: unknown) => fn } : id === "node:net" ? { BlockList: class { addSubnet() {} } } : {}; });
    await page.addScriptTag({ content: nativeBundle.outputFiles[0]!.text }); await page.addScriptTag({ content: toolsBundle.outputFiles[0]!.text });
    await page.evaluate(async () => {
      const data = new Map<string, Uint8Array>(), folders = new Set<string>(), encoder = new TextEncoder(), decoder = new TextDecoder();
      const storage = {
        exists: async (path: string) => data.has(path) || folders.has(path),
        readText: async (path: string) => { const value = data.get(path); if (!value) throw new Error(`missing ${path}`); return decoder.decode(value); },
        readBinary: async (path: string) => { const value = data.get(path); if (!value) throw new Error(`missing ${path}`); return value; },
        writeText: async (path: string, value: string) => { data.set(path, encoder.encode(value)); },
        createText: async (path: string, value: string) => { if (data.has(path)) throw new Error("exists"); data.set(path, encoder.encode(value)); },
        writeBinary: async (path: string, value: Uint8Array) => { data.set(path, value); },
        createBinary: async (path: string, value: Uint8Array) => { if (data.has(path)) throw new Error("exists"); data.set(path, value); },
        processText: async (path: string, update: (value: string) => string) => { const value = update(decoder.decode(data.get(path))); data.set(path, encoder.encode(value)); return value; },
        copy: async (from: string, to: string) => { const value = data.get(from); if (!value || data.has(to)) throw new Error("copy failed"); data.set(to, value.slice()); },
        mkdir: async (path: string) => { folders.add(path); },
        list: async (path: string) => [...folders, ...data.keys()].filter(item => item.startsWith(path + "/") && !item.slice(path.length + 1).includes("/")).map(item => ({ path: item, type: folders.has(item) ? "folder" : "file" })),
      };
      const repository = { inspectRepository: (path: string) => (window as any).inspectFixtureRepo(path), listFiles: (...args: unknown[]) => (window as any).listFixtureRepo(...args), readFile: (...args: unknown[]) => (window as any).readFixtureRepo(...args) };
      const host = { id: "obsidian", storage, repository }; let controller: any;
      const intakeState: any = { calls: 0 }; intakeState.waiting = new Promise<void>(resolve => { intakeState.arrived = resolve; });
      const provider = { async run(input: any, options: any) {
        if (input.scope.kind !== "intake") throw new Error("Expected intake");
        intakeState.calls++; await new Promise<void>(resolve => { intakeState.release = resolve; intakeState.arrived(); });
        if (input.text !== "比较两个仓库的结构" || input.scope.materialIds.length !== 2) throw new Error("Unexpected intake input");
        const tools = (window as any).NativeTools.createScopedTools({ store: controller.store, storage, materialIds: input.scope.materialIds, onChoices() {} });
        const create = tools.find((tool: any) => tool.name === "pith_create_topic"), args = { title: input.text, target: input.text, materialIds: input.scope.materialIds, toolkits: [] }, topic = await create.execute(args);
        options.onStep({ kind: "tool", name: create.name, callId: "create", inputPreview: "{}", status: "completed", effects: await create.effects(topic, args) }, 0);
        options.onStep({ kind: "reply", markdown: "已建立原生比较课题" }, 1);
        await tools.find((tool: any) => tool.name === "pith_write_lesson").execute({ fileName: "00-课程大纲.md", markdown: "# 原生比较\n\n`README.md:1`" });
        return { status: "completed" };
      } };
      controller = new (window as any).NativePith.PithObsidianController(host, undefined, provider); await controller.initialize();
      const leaf: any = { container: document.getElementById("side"), detach() {}, async setViewState() { this.view = new (window as any).NativePith.PithGuideView(this); } };
      const workspace = { rightSplit: { expand() {}, collapse() {} }, getRightLeaf: () => leaf, getLeavesOfType: () => leaf.view ? [leaf] : [], revealLeaf: async () => {} };
      const view = new (window as any).NativePith.PithWorkspaceView({}, controller, host, workspace); (window as any).nativeTask51 = { controller, view, intakeState }; await view.onOpen();
    });
    await page.locator('[name="title"]').fill(paths[0]!); await page.locator('[data-intake-open]').click();
    await page.getByText("请写下想搞懂的问题").waitFor();
    assert.equal(await page.evaluate(async () => (await (window as any).nativeTask51.controller.store.listMaterials()).length), 0);
    await page.locator('[name="title"]').fill(`比较两个仓库的结构 ${paths.map(path => JSON.stringify(path)).join(" ")}`); await page.locator('[data-intake-open]').click();
    await page.evaluate(() => Promise.race([(window as any).nativeTask51.intakeState.waiting, new Promise((_, reject) => setTimeout(() => reject(new Error("Native intake did not arrive")), 8000))]));
    assert.equal(await page.locator('[data-intake-open]').isDisabled(), true);
    assert.equal(await page.evaluate(() => (window as any).nativeTask51.intakeState.calls), 1);
    assert.equal(await page.evaluate(async () => (await (window as any).nativeTask51.controller.store.listTopics()).length), 0);
    await page.evaluate(() => (window as any).nativeTask51.intakeState.release());
    await page.locator('.pith-article').getByText("原生比较").waitFor();
    await page.locator('.pith-guide-content').getByText("已建立原生比较课题").waitFor();
    assert.deepEqual(await page.evaluate(async () => { const controller = (window as any).nativeTask51.controller, topic = (await controller.store.listTopics())[0], turns = await controller.engine.getConversation(topic.id); return turns.map((turn: any) => turn.user.text); }), ["比较两个仓库的结构"]);
    assert.deepEqual(await page.evaluate(async () => { const controller = (window as any).nativeTask51.controller, topic = (await controller.store.listTopics())[0]; return Promise.all(topic.materialIds.map(async (id: string) => (await controller.store.getMaterial(id)).externalPath)); }), paths);
    const nativeCitations = page.locator('.pith-article [data-citation-path="README.md"]'); assert.equal(await nativeCitations.count(), 2);
    await nativeCitations.first().click(); await page.locator('.pith-article').getByText("repository 1").waitFor();
    await page.evaluate(async () => {
      const { controller, view } = (window as any).nativeTask51, topic = (await controller.store.listTopics())[0];
      for (const [index, id] of topic.materialIds.entries()) { const material = await controller.store.getMaterial(id); await controller.engine.capture({ owner: { topicId: topic.id }, kind: "note", body: `native note ${index + 1}`, anchor: { source: { kind: "material", materialId: id }, file: "README.md", locator: `repo:${material.commitSha}:README.md#L1-L1`, quote: `repository ${index + 1}` } }); }
      await view.view.refreshGuide();
    });
    await page.locator('[data-guide-tab="notes"]').click();
    await page.locator('.pith-note-source').getByText("native note 2").click(); await page.locator('.pith-article').getByText("repository 2").waitFor();
    await page.locator('.pith-note-source').getByText("native note 1").click(); await page.locator('.pith-article').getByText("repository 1").waitFor();
    await page.evaluate(() => (window as any).nativeTask51.controller.dispose());
  } finally { releaseIntake?.(); if (browser) await browser.close(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); await rm(root, { recursive: true, force: true }); }
});
