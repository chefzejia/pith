import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { NodeRepositoryPort } from "../src/shells/web/nodeRepository.ts";
import { createPithWebServer } from "../src/shells/web/server.ts";
import { pithIcon } from "../src/workbench/icons.ts";
import { quickActionsForTopic } from "../src/plugins/guide-acp/index.ts";
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
    assert.equal((await port.inspectRepository(`${repo} — 探索`)).externalPath, repo);
    if (process.platform !== "win32") await assert.rejects(port.inspectRepository("C:\\repo"), /Windows/);
    assert.match(pithIcon("sliders"), /viewBox="0 0 24 24".*stroke-width="1.75"/);
  } finally { if (previous === undefined) delete process.env.HOME; else process.env.HOME = previous; await rm(root, { recursive: true, force: true }); }
});

test("repository guide replaces planning after a lesson is generated", () => {
  const topic = { id: "t", title: "Repo", materialId: "m", target: "", status: "exploring", notes: [], toolkits: [], createdAt: "", updatedAt: "", material: { id: "m", title: "Repo", kind: "repo", createdAt: "", files: [] } } as const;
  assert.equal(quickActionsForTopic(topic, [])[0]!.id, "plan-curriculum");
  const withLesson = { ...topic, material: { ...topic.material, files: [{ name: "00-课程大纲.md", mimeType: "text/markdown", bytes: 10, sha256: "" }] } };
  assert.deepEqual(quickActionsForTopic(withLesson, []).map(action => action.id), ["orient", "quiz"]);
});

test("omnibox stages files, routes intent and keeps only current guide choices", { timeout: 60000, skip: !process.env.PITH_PLAYWRIGHT_MODULE || !process.env.PITH_CHROME_PATH }, async () => {
  const root = await testSandbox("task35-browser-"), workspace = join(root, "workspace"); await mkdir(workspace);
  const received: string[] = [];
  const server = await createPithWebServer({ workspaceDir: workspace, guideProvider: { async reply(input) { received.push(input.conversation.at(-1)!.text); return received.length === 1 ? "第一轮\n```pith-choices\n- 旧选项 A\n- 旧选项 B\n```" : received.length === 2 ? "第二轮\n```pith-choices\n- 新选项 A\n- 新选项 B\n```" : "第三轮"; } } });
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
    const evidence = resolve('.tmp/evidence/task-35'); await mkdir(evidence, { recursive: true }); await page.screenshot({ path: join(evidence, 'web-light-narrow.png') });
    await page.locator('[name="title"]').fill('解释这个材料'); await page.locator('[name="title"]').press('Enter');
    await page.locator('.pith-choice-btn').first().waitFor(); assert.equal(received[0], '解释这个材料'); assert.equal(await page.locator('.pith-quick-actions').count(), 0); assert.equal(await page.locator('.pith-choice-btn').count(), 2);
    await page.locator('.pith-choice-btn').first().click(); await page.locator('[data-guide-send]').click(); await page.getByText('第二轮').waitFor(); assert.equal(await page.locator('.pith-choice-btn').count(), 2); assert.equal(await page.getByRole('button', { name: /旧选项/ }).count(), 0); assert.equal(await page.locator('.pith-quick-actions').count(), 0);
    assert.equal(await page.locator('.pith-view-header button svg').count() > 0, true);
    await page.emulateMedia({ colorScheme: 'dark' }); await page.screenshot({ path: join(evidence, 'web-dark-guide.png') });
    await page.locator('.pith-choice-btn').first().click(); await page.locator('[data-guide-send]').click(); await page.getByText('第三轮').waitFor(); assert.equal(await page.locator('.pith-choice-btn').count(), 0); assert.equal(await page.locator('.pith-quick-actions').count(), 1);
    await page.locator('[data-command="home"]').click(); await page.locator('[name="title"]').fill('理解分布式系统'); await page.locator('[name="title"]').press('Enter'); await page.getByText('第三轮').waitFor(); assert.match(received[3]!, /理解分布式系统/); assert.match(received[3]!, /课程大纲/);
  } finally { if (browser) await browser.close(); await new Promise<void>((ok, fail) => server.close(error => error ? fail(error) : ok())); await rm(root, { recursive: true, force: true }); }
});

test("offline intent and file-only intake open without starting guide", { timeout: 60000, skip: !process.env.PITH_PLAYWRIGHT_MODULE || !process.env.PITH_CHROME_PATH }, async () => {
  const root = await testSandbox("task35-offline-"); const server = await createPithWebServer({ workspaceDir: root }); let browser: any;
  try {
    const address = server.address(); assert.ok(address && typeof address !== "string"); const { chromium } = await import(process.env.PITH_PLAYWRIGHT_MODULE!); browser = await chromium.launch({ executablePath: process.env.PITH_CHROME_PATH, headless: true });
    const page = await browser.newPage(); const posts: string[] = []; page.on('request', (request: any) => { if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/chat') posts.push(request.url()); }); await page.goto(`http://127.0.0.1:${address.port}`); await page.locator('[name="title"]').fill('离线学习主题'); await page.locator('[name="title"]').press('Enter'); await page.getByText('这个课题还没有关联材料。').waitFor(); await page.locator('.pith-guide-content').waitFor({ state: 'attached' }); await page.waitForLoadState('networkidle'); assert.equal(await page.locator('.pith-guide').isVisible(), false); assert.equal(posts.length, 0);
    await page.locator('[data-command="home"]').click(); await page.locator('.pith-intake-box input[type="file"]').setInputFiles({ name: 'offline.txt', mimeType: 'text/plain', buffer: Buffer.from('Offline text.') }); await page.locator('[data-intake-open]').click(); await page.locator('.pith-article').getByText('Offline text.').waitFor(); assert.equal(await page.locator('.pith-guide').isVisible(), false);
    const state = await (await page.request.get(`http://127.0.0.1:${address.port}/api/state`)).json(); assert.equal(state.guideConfigured, false);
  } finally { if (browser) await browser.close(); await new Promise<void>((ok, fail) => server.close(error => error ? fail(error) : ok())); await rm(root, { recursive: true, force: true }); }
});
