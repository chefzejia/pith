import test from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { join } from 'node:path';
import { createPithWebServer } from '../src/shells/web/server.ts';
import { parseFrontmatter, stringifyFrontmatter, type GuideProvider } from '../src/core/index.ts';
import { versionFixture } from './task60-fixture.ts';
import { nativeWorkbenchFixture } from './native-workbench-fixture.ts';

const unavailable = !process.env.PITH_PLAYWRIGHT_MODULE || !process.env.PITH_CHROME_PATH;
const close = (server: Server) => new Promise<void>((ok, no) => server.close(error => error ? no(error) : ok()));
const rewriteSelector = '[data-rewrite-lesson="01-changed.md"]';

async function seed(f: Awaited<ReturnType<typeof versionFixture>>) {
  const first = await f.importLocal();
  const topic = await f.store.createTopic({ title: '版本与出处', target: '核对提交中的值', materialIds: [first.id], toolkits: [] });
  await f.store.writeLesson(topic.id, '01-changed.md', '# 变化讲义\n\n`src/changed.ts:1`\n\nother/src/changed.ts:1\n\nsrc/added.ts:1\n');
  await f.store.writeLesson(topic.id, '02-stable.md', '# 稳定讲义\r\n\r\nsrc/stable.ts:1\r\n\r\nother/src/changed.ts:1\r\n');
  const note = await f.store.appendMaterialNote(first.id, { kind: 'note', author: 'user', body: '旧版本笔记', anchor: { source: { kind: 'material', materialId: first.id }, file: 'src/changed.ts', locator: `repo:${f.first}:src/changed.ts#L1-L1`, quote: 'export const value = "old";' } });
  await f.storage.writeText('_cache/web-settings.json', JSON.stringify({ preset: 'all', persona: 'sanctuary', plugins: {}, agentId: '', agentConfigured: true }));
  return { first, topic, note };
}

for (const host of ['Web', 'Obsidian'] as const) test(`${host} groups repository versions, checks only on click, uses newer version offline and isolates old lesson citations/notes`, { skip: unavailable, timeout: 60000 }, async () => {
  const f = await versionFixture(); let browser: any, server: Server | undefined, page: any;
  try {
    const { first, topic, note } = await seed(f); const secondSha = await f.advance();
    const captures = process.env.PITH_TASK67_REBASE_SCREENSHOT_DIR;
    const { chromium } = await import(process.env.PITH_PLAYWRIGHT_MODULE!); browser = await chromium.launch({ executablePath: process.env.PITH_CHROME_PATH, headless: !captures });
    page = await browser.newPage({ viewport: { width: 1024, height: 800 } }); page.setDefaultTimeout(8000);
    if (host === 'Web') { server = await createPithWebServer({ workspaceDir: f.workspace }); const address = server.address(); assert.ok(address && typeof address !== 'string'); await page.goto(`http://127.0.0.1:${address.port}`); }
    else await nativeWorkbenchFixture(page, f.workspace);
    assert.equal((await f.store.listMaterials()).length, 1);
    await page.locator('[data-check-update]').click(); await page.locator('.pith-library-update [role=status]').getByText(`已导入 @${secondSha.slice(0, 7)}`, { exact: true }).waitFor();
    const second = (await f.store.listMaterials()).find(material => material.commitSha === secondSha)!;
    assert.equal(await page.locator('.pith-material-card').count(), 1);
    assert.match(await page.locator('.pith-material-card').innerText(), /2 个版本 · 1 个课题引用/);
    assert.equal(await page.locator('.pith-material-card').getAttribute('data-material'), second.id);
    await page.locator('[data-check-update]').click(); await page.getByText('已是最新版本', { exact: true }).waitFor();
    await page.locator('[data-material]').click(); await page.locator('.pith-article').getByText('export const added = 4;', { exact: true }).waitFor();
    await page.locator('.pith-nav-toggle').click(); await page.locator(`[data-material-id="${second.id}"][data-file="src/changed.ts"]`).click();
    await page.locator('.pith-article').getByText('export const value = "new";', { exact: true }).waitFor();
    const other = await f.importDistinct('Distinct repository');
    await page.locator('[data-command=home]').click(); await page.locator(`[data-topic="${topic.id}"]`).first().click();
    await page.locator('.pith-source-citation').first().waitFor();
    await page.getByRole('button', { name: '导入材料', exact: true }).click();
    const picker = page.getByRole('region', { name: '添加材料' });
    await picker.getByRole('button', { name: other.title, exact: true }).click();
    await picker.getByText('材料已入库并引用', { exact: true }).waitFor();
    await picker.getByRole('button', { name: '关闭添加材料' }).click();
    await page.locator('.pith-nav-toggle').click();
    const contents = page.locator('.pith-left-drawer');
    await contents.getByRole('heading', { name: other.title, exact: true }).waitFor();
    assert.equal(await contents.locator('.pith-lesson-badge').count(), 0, 'a distinct attachment must not mark either stamped lesson stale');
    assert.equal(await contents.locator('.pith-lesson-version, [data-rewrite-lesson]').count(), 0);
    assert.deepEqual((await f.store.getTopic(topic.id))!.lessons.map(lesson => lesson.basedOn), [[first.id], [first.id]]);
    if (captures) await page.screenshot({ path: join(captures, `${host.toLowerCase()}-distinct-attachment.png`), type: 'png' });
    await contents.locator('[data-file="01-changed.md"][data-lesson]').click();
    await page.locator('.pith-source-citation').first().waitFor();
    await page.locator('.pith-nav-toggle').click(); await page.locator(`[data-use-version="${second.id}"]`).click();
    await page.waitForFunction(() => !document.querySelector('[data-use-version]'));
    const after = (await f.store.getTopic(topic.id))!;
    assert.deepEqual(after.lessons.map(lesson => lesson.basedOn), [[first.id], [second.id]], 'only the unaffected lesson follows the new version');
    await page.locator(rewriteSelector).waitFor();
    assert.equal(await page.locator(rewriteSelector).isDisabled(), true);
    assert.match(await page.locator('.pith-lesson-version').innerText(), /变化文件：src\/changed\.ts[\s\S]*向导.*连接/);
    assert.equal(await page.locator('.pith-left-drawer .pith-lesson-badge').filter({ hasText: '基于旧版本' }).count(), 1);
    assert.match(await page.locator('.pith-old-version summary').innerText(), /1 讲依据/);
    assert.equal(await page.locator('.pith-old-version').getAttribute('open'), null);
    assert.deepEqual((await f.store.getTopic(topic.id))!.materialIds, [first.id, other.id, second.id]);
    // The same path has different committed bytes; unrebased citations must still target v1 only.
    assert.equal(await page.locator('[data-citation-path="src/changed.ts"]').count(), 1, 'a path suffix is not a second citation');
    assert.equal(await page.locator('[data-citation-path="src/changed.ts"]').getAttribute('data-citation-material'), first.id);
    assert.equal(await page.locator('[data-citation-path="src/added.ts"]').count(), 0, 'absent in basis stays plain text');
    if (captures) await page.screenshot({ path: join(captures, `${host.toLowerCase()}-same-repository-update.png`), type: 'png' });
    await page.keyboard.press('Escape'); await page.locator('.pith-left-drawer').waitFor({ state: 'hidden' });
    await page.locator('[data-citation-path="src/changed.ts"]').click();
    await page.locator('.pith-article').getByText('export const value = "old";', { exact: true }).waitFor();
    if (!await page.locator('.pith-guide').isVisible()) await page.locator('.pith-guide-toggle').click();
    await page.locator('[data-guide-tab=notes]').click(); await page.locator(`[data-note-id="${note.id}"]`).click();
    assert.match(await page.locator('.pith-article').innerText(), /old/);
    const oldNotes = (await f.store.getMaterial(first.id))!.notes;
    await page.locator('[data-command=home]').click();
    await page.locator(`[data-topic="${topic.id}"]`).first().click();
    await page.locator('.pith-article h1').getByText('变化讲义', { exact: true }).waitFor();
    assert.equal(await page.locator('[data-citation-path="src/changed.ts"]').count(), 1, 'stamped basis must exclude same-path newer version');
    assert.equal(await page.locator('[data-citation-path="src/changed.ts"]').getAttribute('data-citation-material'), first.id);
    await page.locator('[data-command=home]').click();
    await page.locator('.pith-library').waitFor();
    // Explicit released-format sample: remove only the optional field, then read without writes.
    const path = `topics/${topic.id}/topic.md`, parsed = parseFrontmatter(await f.storage.readText(path));
    for (const entry of parsed.attributes.lessons as Record<string, unknown>[]) delete entry.basedOn;
    const ledger = stringifyFrontmatter(parsed.attributes, parsed.body); await f.storage.writeText(path, ledger);
    await page.locator(`[data-topic="${topic.id}"]`).first().click();
    await page.locator('.pith-article h1').getByText('变化讲义', { exact: true }).waitFor();
    assert.equal(await page.locator('[data-citation-path="src/changed.ts"]').getAttribute('data-citation-material'), first.id, 'released lesson must choose earliest');
    assert.ok((await f.store.getTopic(topic.id))!.lessons.every(lesson => lesson.basedOn === undefined), 'reading must not stamp released lessons');
    assert.deepEqual((await f.store.getMaterial(first.id))!.notes, oldNotes);
    assert.equal((await f.store.getMaterial(first.id))!.commitSha, f.first);
    await page.locator('[data-command=home]').click(); await page.locator('.pith-library').waitFor();
    await f.store.rebaseLesson(topic.id, '02-stable.md'); // Restore the stamp removed for the released-format read test.
    await page.locator(`[data-topic="${topic.id}"]`).first().click();
    await page.locator('.pith-article h1').getByText('变化讲义', { exact: true }).waitFor();
    await page.locator('.pith-nav-toggle').click(); await page.locator('[data-file="02-stable.md"][data-lesson]').click();
    await page.locator('.pith-article h1').getByText('稳定讲义', { exact: true }).waitFor();
    await page.locator('.pith-nav-toggle').click();
    assert.equal(await page.locator(rewriteSelector).isDisabled(), true);
    assert.equal(await page.locator('.pith-lesson-badge').filter({ hasText: '基于旧版本' }).count(), 1);
    assert.equal(await page.locator('[data-citation-path="src/stable.ts"]').getAttribute('data-citation-material'), second.id);
    await page.locator(`[data-material-id="${second.id}"][data-file="src/changed.ts"]`).click();
    await page.locator('.pith-article').getByText('export const value = "new";', { exact: true }).waitFor();
    await page.locator('.pith-nav-toggle').click();
    assert.equal(await page.locator(rewriteSelector).isDisabled(), true);
    // Obsidian's open right leaf takes 330px independently of the Pith workbench.
    for (const width of [host === 'Obsidian' ? 720 : 390, 1440]) {
      await page.setViewportSize({ width, height: 800 });
      const status = page.locator('.pith-lesson-version'); await status.waitFor();
      const sizes = await status.evaluate((node: HTMLElement) => ({ client: node.clientWidth, scroll: node.scrollWidth, children: Array.from(node.children, child => [child.tagName, child.clientWidth, child.scrollWidth]) }));
      assert.ok(sizes.client > 0 && sizes.scroll <= sizes.client + 1, `${host} at ${width}px: ${JSON.stringify(sizes)}`);
    }
  } catch (error) { console.error(await page?.locator('body').innerText()); throw error; }
  finally { if (browser) await browser.close(); if (server) await close(server); await f.close(); }
});

test('Web single-lesson rewrite drafts first, then sends one ordinary user message', { skip: unavailable, timeout: 60000 }, async () => {
  const f = await versionFixture(); let browser: any, server: Server | undefined;
  try {
    const { first, topic } = await seed(f);
    await f.advance(); const second = await f.importLocal();
    const provider: GuideProvider = { async run() { return { status: 'completed' }; } };
    server = await createPithWebServer({ workspaceDir: f.workspace, guideProvider: provider });
    const address = server.address(); assert.ok(address && typeof address !== 'string');
    const { chromium } = await import(process.env.PITH_PLAYWRIGHT_MODULE!); browser = await chromium.launch({ executablePath: process.env.PITH_CHROME_PATH, headless: true });
    const page = await browser.newPage({ viewport: { width: 1024, height: 800 } }); page.setDefaultTimeout(8000);
    const requests: Record<string, unknown>[] = [];
    page.on('request', (request: any) => { if (request.url().endsWith('/api/chat')) requests.push(request.postDataJSON()); });
    await page.goto(`http://127.0.0.1:${address.port}`);
    await page.locator(`[data-topic="${topic.id}"]`).first().click();
    await page.locator('.pith-article h1').getByText('变化讲义', { exact: true }).waitFor();
    await page.locator('.pith-nav-toggle').click(); await page.locator(`[data-use-version="${second.id}"]`).click();
    const rewrite = page.locator(rewriteSelector);
    await rewrite.click();
    assert.deepEqual(requests, [], 'rewrite must not send before user confirmation');
    const input = page.getByRole('textbox', { name: '消息' });
    assert.equal(await input.evaluate((element: HTMLElement) => element === document.activeElement), true);
    const draft = await input.inputValue();
    assert.ok(draft.includes('01-changed.md') && draft.includes('src/changed.ts') && draft.includes(first.commitSha!.slice(0, 7)) && draft.includes(second.commitSha!.slice(0, 7)), 'draft must name the lesson, changed path and both commits');
    assert.doesNotMatch(draft, /02-stable\.md|src\/added\.ts/);
    const sent = page.waitForRequest((request: any) => request.url().endsWith('/api/chat'));
    await page.locator('[data-guide-send]').click();
    assert.deepEqual((await sent).postDataJSON(), { topicId: topic.id, text: draft });
    assert.equal(requests.length, 1);
  } finally { if (browser) await browser.close(); if (server) await close(server); await f.close(); }
});
