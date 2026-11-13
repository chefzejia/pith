import { testToolkits } from "./guide-tools-fixture.ts";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { NodeRepositoryPort } from "../src/shells/web/nodeRepository.ts";
import { createPithWebServer } from "../src/shells/web/server.ts";
import { NodeWorkspaceStorage } from "../src/shells/web/nodeStorage.ts";
import { DefaultWorkspaceStore } from "../src/core/index.ts";
import { createScopedTools } from "../src/plugins/guide-acp/tools.ts";
import { pithIcon } from "../src/workbench/icons.ts";
import { quickActionsForTopic } from "../src/plugins/guide-acp/index.ts";
import { emptyMaterialHtml, resolveRepositoryIntake } from "../src/workbench/repositoryIntake.ts";
import { testSandbox } from "./sandbox.ts";

test("repository paths retain spaces, expand home and reject foreign paths", async () => {
  const root = await testSandbox("task35-repo-"), repo = join(root, "repo with spaces"); await mkdir(repo);
  const git = promisify(execFile), env = { ...process.env, HOME: root, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_AUTHOR_NAME: "Fixture", GIT_AUTHOR_EMAIL: "fixture@example.invalid", GIT_COMMITTER_NAME: "Fixture", GIT_COMMITTER_EMAIL: "fixture@example.invalid" };
  const previous = process.env.HOME;
  try {
    await git("git", ["-C", repo, "init", "-q"], { env }); await writeFile(join(repo, "source.txt"), "text"); await git("git", ["-C", repo, "add", "."], { env }); await git("git", ["-C", repo, "commit", "-qm", "fixture"], { env });
    process.env.HOME = root; const port = new NodeRepositoryPort();
    assert.equal((await port.inspectRepository(repo)).externalPath, repo);
    assert.equal((await port.inspectRepository("~/repo with spaces")).externalPath, repo);
    assert.deepEqual(await resolveRepositoryIntake(`${repo} — 探索`, port), { info: await port.inspectRepository(repo), description: "探索" });
    assert.deepEqual(await resolveRepositoryIntake(`${repo} 学习架构`, port), { info: await port.inspectRepository(repo), description: "学习架构" });
    assert.equal((await resolveRepositoryIntake(`~/repo with spaces 理解缓存`, port)).description, "理解缓存");
    const longer = `${repo} — 探索`; await mkdir(longer); await git("git", ["-C", longer, "init", "-q"], { env }); await writeFile(join(longer, "content"), "x"); await git("git", ["-C", longer, "add", "."], { env }); await git("git", ["-C", longer, "commit", "-qm", "longer"], { env });
    const exact = await resolveRepositoryIntake(longer, port); assert.equal(exact.info.externalPath, longer); assert.equal(exact.description, "");
    assert.equal((await resolveRepositoryIntake(`${longer} 深入学习`, port)).info.externalPath, longer);
    const denied = Object.assign(new Error("denied"), { code: "EACCES", syscall: "realpath" });
    await assert.rejects(resolveRepositoryIntake(`${repo} denied`, { inspectRepository: async () => { throw denied; } }), error => error === denied);
    const gitMissing = Object.assign(new Error("git missing"), { code: "ENOENT", syscall: "spawn git" });
    await assert.rejects(resolveRepositoryIntake(`${repo} target`, { inspectRepository: async () => { throw gitMissing; } }), error => error === gitMissing);
    if (process.platform !== "win32") await assert.rejects(port.inspectRepository("C:\\repo"), /Windows/);
    assert.match(pithIcon("sliders"), /viewBox="0 0 24 24".*stroke-width="1.75"/);
  } finally { if (previous === undefined) delete process.env.HOME; else process.env.HOME = previous; await rm(root, { recursive: true, force: true }); }
});

test("repository guide replaces planning after a lesson is generated", () => {
  const topic = { id: "t", title: "Repo", materialIds: ["m"], lessons: [], target: "Understand", status: "exploring", notes: [], toolkits: [], createdAt: "", updatedAt: "" } as const;
  assert.equal(quickActionsForTopic(topic, [])[0]!.id, "plan-curriculum");
  const withLesson = { ...topic, lessons: [{ name: "00-课程大纲.md" }] };
  const actions = quickActionsForTopic(withLesson, []);
  assert.deepEqual(actions.map(action => [action.id, action.label]), [["orient", "导读这一节"], ["quiz", "下一讲 / 考考我"]]);
  assert.match(actions[1]!.prompt, /检验.*理解/); assert.match(actions[1]!.prompt, /下一讲/);
});

test("empty repository describes its binding and escapes its path", () => {
  const material = { id: "m", title: "Repo", kind: "repo", createdAt: "", files: [], aids: [], notes: [], externalPath: '/tmp/<repo>', commitSha: 'a'.repeat(40) } as const;
  const html = emptyMaterialHtml(material);
  assert.match(html, /仓库已绑定/); assert.match(html, /尚无讲义/); assert.match(html, /&lt;repo&gt;/); assert.match(html, /a{40}/);
  assert.match(emptyMaterialHtml(undefined), /还没有关联材料/);
});

test("web repository intake retains the requested objective and shows the bound repository", { timeout: 60000, skip: !process.env.PITH_PLAYWRIGHT_MODULE || !process.env.PITH_CHROME_PATH }, async () => {
  const root = await testSandbox("task35-repo-ui-"), repo = join(root, "repo with spaces"), workspace = join(root, "workspace"); await mkdir(repo); await mkdir(workspace);
  const git = promisify(execFile), env = { ...process.env, HOME: root, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_AUTHOR_NAME: "Fixture", GIT_AUTHOR_EMAIL: "fixture@example.invalid", GIT_COMMITTER_NAME: "Fixture", GIT_COMMITTER_EMAIL: "fixture@example.invalid" };
  await git("git", ["-C", repo, "init", "-q"], { env }); await writeFile(join(repo, "source.txt"), "sample"); await git("git", ["-C", repo, "add", "."], { env }); await git("git", ["-C", repo, "commit", "-qm", "fixture"], { env });
  const sha = (await git("git", ["-C", repo, "rev-parse", "HEAD"], { env })).stdout.trim(); const received: string[] = [];
  const storage = new NodeWorkspaceStorage(workspace), store = new DefaultWorkspaceStore(storage);
  const server = await createPithWebServer({ workspaceDir: workspace, guideProvider: { async run(input, options) { if (input.scope.kind !== "intake") throw new Error("intake required"); received.push(input.text); const tool = createScopedTools({ toolkits: testToolkits, store, storage, materialIds: input.scope.materialIds, onChoices() {} }).find(item => item.name === "pith_create_topic")!, args = { title: input.text, target: input.text, materialIds: input.scope.materialIds, toolkits: [] }, topic = await tool.execute(args); options.onStep({ kind: "tool", name: tool.name, callId: "create", inputPreview: "{}", status: "completed", effects: await tool.effects!(topic, args) }, 0); options.onStep({ kind: "reply", markdown: "已收到目标" }, 1); return { status: "completed" }; } } }); let browser: any;
  try {
    const address = server.address(); assert.ok(address && typeof address !== "string"); const base = `http://127.0.0.1:${address.port}`;
    const { chromium } = await import(process.env.PITH_PLAYWRIGHT_MODULE!); browser = await chromium.launch({ executablePath: process.env.PITH_CHROME_PATH, headless: true });
    const page = await browser.newPage({ viewport: { width: 1100, height: 800 } }); page.setDefaultTimeout(8000); await page.goto(base);
    for (const objective of ["学习架构", "理解缓存"]) {
      await page.locator('[name="title"]').fill(`${objective} ${JSON.stringify(repo)}`); await page.locator('[data-intake-open]').click(); await page.locator('.pith-article').getByText('sample').waitFor();
      await page.getByText('已收到目标').waitFor(); assert.match(received.at(-1)!, new RegExp(objective));
      const state = await (await page.request.get(`${base}/api/state`)).json(); assert.ok(state.compass.exploring.some((topic: { target: string }) => topic.target === objective));
      assert.ok(state.materials.some((material: { externalPath: string; commitSha: string }) => material.externalPath === repo && material.commitSha === sha));
      const evidence = resolve(`${process.env.PITH_TEST_SCREENSHOT_DIR}/task-35`); await mkdir(evidence, { recursive: true }); await page.screenshot({ path: join(evidence, 'web-repo-fix.png') });
      await page.locator('[data-command="home"]').click();
    }
  } finally { if (browser) await browser.close(); await new Promise<void>((ok, fail) => server.close(error => error ? fail(error) : ok())); await rm(root, { recursive: true, force: true }); }
});

test("omnibox stages files, routes intent and keeps only current guide choices", { timeout: 60000, skip: !process.env.PITH_PLAYWRIGHT_MODULE || !process.env.PITH_CHROME_PATH }, async () => {
  const root = await testSandbox("task35-browser-"), workspace = join(root, "workspace"); await mkdir(workspace);
  const received: string[] = [], storage = new NodeWorkspaceStorage(workspace), store = new DefaultWorkspaceStore(storage);
  const server = await createPithWebServer({ workspaceDir: workspace, guideProvider: { async run(input, options) { received.push(input.text); let index = 0; if (input.scope.kind === "intake") { const tool = createScopedTools({ toolkits: testToolkits, store, storage, materialIds: input.scope.materialIds, onChoices() {} }).find(item => item.name === "pith_create_topic")!, args = { title: input.text, target: input.text, materialIds: input.scope.materialIds, toolkits: [] }, topic = await tool.execute(args); options.onStep({ kind: "tool", name: tool.name, callId: "create", inputPreview: "{}", status: "completed", effects: await tool.effects!(topic, args) }, index++); await store.writeLesson((topic as { id: string }).id, "00-课程大纲.md", "# 课程大纲"); } options.onStep({ kind: "reply", markdown: received.length === 1 ? "第一轮" : received.length === 2 ? "第二轮" : "第三轮" }, index); if (received.length < 3) options.onChoices(received.length === 1 ? ["旧选项 A", "旧选项 B"] : ["新选项 A", "新选项 B"]); return { status: "completed" }; } } });
  let browser: any;
  try {
    const address = server.address(); assert.ok(address && typeof address !== "string");
    const { chromium } = await import(process.env.PITH_PLAYWRIGHT_MODULE!); browser = await chromium.launch({ executablePath: process.env.PITH_CHROME_PATH, headless: true });
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, colorScheme: "light" }); await page.goto(`http://127.0.0.1:${address.port}`);
    assert.equal(await page.locator('.pith-intake-box input[name="title"]').count(), 1);
    assert.equal(await page.locator('.pith-intake-box button[type="submit"]').count(), 1);
    await page.locator('.pith-intake-box input[type="file"]').setInputFiles({ name: 'first.txt', mimeType: 'text/plain', buffer: Buffer.from('Natural prose.') });
    await page.evaluate(() => { const transfer = new DataTransfer(); transfer.items.add(new File(['second'], 'second.txt', { type: 'text/plain' })); document.querySelector('.pith-intake-box')!.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: transfer })); });
    assert.equal(await page.locator('.pith-intake-chip').count(), 2); await page.getByRole('button', { name: '移除 first.txt' }).click(); assert.equal(await page.locator('.pith-intake-chip').count(), 1);
    const evidence = resolve(`${process.env.PITH_TEST_SCREENSHOT_DIR}/task-35`); await mkdir(evidence, { recursive: true }); await page.screenshot({ path: join(evidence, 'web-light-narrow.png') });
    await page.locator('[name="title"]').fill('解释这个材料'); await page.locator('[name="title"]').press('Enter');
    await page.locator('.pith-choice-btn').first().waitFor(); assert.equal(received[0], '解释这个材料'); assert.equal(await page.locator('.pith-quick-actions').count(), 0); assert.equal(await page.locator('.pith-choice-btn').count(), 2);
    await page.locator('.pith-choice-btn').first().click(); await page.locator('[data-guide-send]').click(); await page.getByText('第二轮').waitFor(); await page.getByRole('button', { name: /新选项 A/ }).waitFor(); assert.equal(await page.locator('.pith-choice-btn').count(), 2); assert.equal(await page.getByRole('button', { name: /旧选项/ }).count(), 0); assert.equal(await page.locator('.pith-quick-actions').count(), 0);
    assert.equal(await page.locator('.pith-view-header button svg').count() > 0, true);
    await page.emulateMedia({ colorScheme: 'dark' }); await page.screenshot({ path: join(evidence, 'web-dark-guide.png') });
    await page.locator('.pith-choice-btn').first().click(); await page.locator('[data-guide-send]').click(); await page.getByText('第三轮').waitFor(); await page.locator('.pith-quick-actions').waitFor(); assert.equal(await page.locator('.pith-choice-btn').count(), 0); assert.equal(await page.locator('.pith-quick-actions').count(), 1);
    assert.equal(await page.getByRole('button', { name: '导读这一节' }).count(), 1); assert.equal(await page.getByRole('button', { name: '下一讲 / 考考我' }).count(), 1);
    await page.getByRole('button', { name: '下一讲 / 考考我' }).scrollIntoViewIfNeeded(); await page.screenshot({ path: join(evidence, 'web-quick-actions-fix.png') });
    await page.getByRole('button', { name: '下一讲 / 考考我' }).click(); assert.match(await page.locator('.pith-guide textarea').inputValue(), /检验.*理解.*下一讲/);
    await page.locator('[data-command="home"]').click(); await page.locator('[name="title"]').fill('理解分布式系统'); await page.locator('[name="title"]').press('Enter'); await page.getByText('第三轮').waitFor(); assert.match(received[3]!, /理解分布式系统/);
  } finally { if (browser) await browser.close(); await new Promise<void>((ok, fail) => server.close(error => error ? fail(error) : ok())); await rm(root, { recursive: true, force: true }); }
});

test("offline intent and file-only intake do not create a topic", { timeout: 60000, skip: !process.env.PITH_PLAYWRIGHT_MODULE || !process.env.PITH_CHROME_PATH }, async () => {
  const root = await testSandbox("task35-offline-"), repo = join(root, "repo with spaces"), workspace = join(root, "workspace"); await mkdir(repo); await mkdir(workspace);
  const git = promisify(execFile), env = { ...process.env, HOME: root, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_AUTHOR_NAME: "Fixture", GIT_AUTHOR_EMAIL: "fixture@example.invalid", GIT_COMMITTER_NAME: "Fixture", GIT_COMMITTER_EMAIL: "fixture@example.invalid" };
  await git("git", ["-C", repo, "init", "-q"], { env }); await writeFile(join(repo, "source.txt"), "sample"); await git("git", ["-C", repo, "add", "."], { env }); await git("git", ["-C", repo, "commit", "-qm", "fixture"], { env });
  const server = await createPithWebServer({ workspaceDir: workspace }); let browser: any;
  try {
    const address = server.address(); assert.ok(address && typeof address !== "string"); const { chromium } = await import(process.env.PITH_PLAYWRIGHT_MODULE!); browser = await chromium.launch({ executablePath: process.env.PITH_CHROME_PATH, headless: true });
    const page = await browser.newPage(); const posts: string[] = []; page.on('request', (request: any) => { if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/chat') posts.push(request.url()); }); await page.goto(`http://127.0.0.1:${address.port}`); await page.locator('[name="title"]').fill('离线学习主题'); await page.locator('[name="title"]').press('Enter'); await page.getByRole('status').getByText(/向导未连接/).waitFor();
    await page.locator('[name="title"]').fill(''); await page.locator('.pith-intake-box input[type="file"]').setInputFiles({ name: 'offline.txt', mimeType: 'text/plain', buffer: Buffer.from('Offline text.') }); await page.locator('[data-intake-open]').click(); await page.locator('.pith-article').getByText('Offline text.').waitFor();
    const state = await (await page.request.get(`http://127.0.0.1:${address.port}/api/state`)).json(); assert.equal(state.guideConfigured, false); assert.equal(state.compass.exploring.length, 0); assert.equal(state.materials.length, 1); assert.equal(posts.length, 0);
  } finally { if (browser) await browser.close(); await new Promise<void>((ok, fail) => server.close(error => error ? fail(error) : ok())); await rm(root, { recursive: true, force: true }); }
});
