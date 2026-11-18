import test from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { createPithWebServer } from '../src/shells/web/server.ts';
import { createScopedTools } from '../src/plugins/guide-acp/tools.ts';
import { parseFrontmatter, stringifyFrontmatter, type GuideProvider } from '../src/core/index.ts';
import { versionFixture } from './task60-fixture.ts';
import { nativeWorkbenchFixture } from './native-workbench-fixture.ts';

const unavailable = !process.env.PITH_PLAYWRIGHT_MODULE || !process.env.PITH_CHROME_PATH;
const close = (server: Server) => new Promise<void>((ok, no) => server.close(error => error ? no(error) : ok()));
async function assertAdjustmentEntry(page: any, disabled: boolean, reason?: RegExp) {
  await page.locator('.pith-left-drawer').waitFor();
  const action = page.locator('[data-adjust-lessons]');
  assert.equal(await action.count(), 1, 'exactly one adjustment entry regardless of the current file');
  assert.equal(await action.isVisible(), true);
  assert.equal(await action.isDisabled(), disabled);
  assert.equal(await action.evaluate((button: HTMLElement) => {
    const heading = button.parentElement?.previousElementSibling;
    return heading?.matches('.pith-left-drawer > h2') && heading.textContent;
  }), '讲义', 'adjustment must be the first row under the lesson group heading');
  if (reason) assert.match(await page.locator('.pith-lesson-adjustment small:visible').innerText(), reason);
  else assert.equal(await page.locator('.pith-lesson-adjustment small:visible').count(), 0);
}

async function seed(f: Awaited<ReturnType<typeof versionFixture>>) {
  const first = await f.importLocal();
  const topic = await f.store.createTopic({ title: '版本与出处', target: '核对提交中的值', materialIds: [first.id], toolkits: [] });
  await f.store.writeLesson(topic.id, '01-changed.md', '# 变化讲义\n\nsrc/changed.ts:1\n\nsrc/added.ts:1\n');
  await f.store.writeLesson(topic.id, '02-stable.md', '# 稳定讲义\r\n\r\nsrc/stable.ts:1\r\n');
  const note = await f.store.appendMaterialNote(first.id, { kind: 'note', author: 'user', body: '旧版本笔记', anchor: { source: { kind: 'material', materialId: first.id }, file: 'src/changed.ts', locator: `repo:${f.first}:src/changed.ts#L1-L1`, quote: 'export const value = "old";' } });
  await f.storage.writeText('_cache/web-settings.json', JSON.stringify({ preset: 'all', persona: 'sanctuary', plugins: {}, agentId: '', agentConfigured: true }));
  return { first, topic, note };
}

for (const host of ['Web', 'Obsidian'] as const) test(`${host} groups repository versions, checks only on click, uses newer version offline and isolates old lesson citations/notes`, { skip: unavailable, timeout: 60000 }, async () => {
  const f = await versionFixture(); let browser: any, server: Server | undefined, page: any;
  try {
    const { first, topic, note } = await seed(f); const secondSha = await f.advance();
    const { chromium } = await import(process.env.PITH_PLAYWRIGHT_MODULE!); browser = await chromium.launch({ executablePath: process.env.PITH_CHROME_PATH, headless: true });
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
    await page.locator('[data-command=home]').click(); await page.locator(`[data-topic="${topic.id}"]`).first().click();
    await page.locator('.pith-source-citation').first().waitFor();
    await page.locator('.pith-nav-toggle').click(); await page.locator(`[data-use-version="${second.id}"]`).click();
    await page.locator('[data-adjust-lessons]').waitFor();
    await assertAdjustmentEntry(page, true, /向导|连接/);
    assert.equal(await page.locator('.pith-left-drawer .pith-lesson-badge').filter({ hasText: '基于旧版本' }).count(), 2);
    assert.match(await page.locator('.pith-old-version summary').innerText(), /2 讲依据/);
    assert.equal(await page.locator('.pith-old-version').getAttribute('open'), null);
    assert.deepEqual((await f.store.getTopic(topic.id))!.materialIds, [first.id, second.id]);
    // The same path has different committed bytes; unrebased citations must still target v1 only.
    assert.equal(await page.locator('[data-citation-path="src/changed.ts"]').count(), 1);
    assert.equal(await page.locator('[data-citation-path="src/changed.ts"]').getAttribute('data-citation-material'), first.id);
    assert.equal(await page.locator('[data-citation-path="src/added.ts"]').count(), 0, 'absent in basis stays plain text');
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
    assert.equal(await f.storage.readText(path), ledger, 'reading must not stamp released ledger');
    assert.deepEqual((await f.store.getMaterial(first.id))!.notes, oldNotes);
    assert.equal((await f.store.getMaterial(first.id))!.commitSha, f.first);
    await page.locator('[data-command=home]').click(); await page.locator('.pith-library').waitFor();
    await f.store.rebaseLesson(topic.id, '02-stable.md');
    await page.locator(`[data-topic="${topic.id}"]`).first().click();
    await page.locator('.pith-article h1').getByText('变化讲义', { exact: true }).waitFor();
    await page.locator('.pith-nav-toggle').click(); await page.locator('[data-file="02-stable.md"][data-lesson]').click();
    await page.locator('.pith-article h1').getByText('稳定讲义', { exact: true }).waitFor();
    await page.locator('.pith-nav-toggle').click();
    await assertAdjustmentEntry(page, true, /向导|连接/);
    assert.equal(await page.locator('.pith-lesson-badge').filter({ hasText: '基于旧版本' }).count(), 1);
    assert.equal(await page.locator('.pith-lesson-adjustment + [data-lesson]').getAttribute('data-file'), '01-changed.md');
    await page.locator(`[data-material-id="${second.id}"][data-file="src/changed.ts"]`).click();
    await page.locator('.pith-article').getByText('export const value = "new";', { exact: true }).waitFor();
    await page.locator('.pith-nav-toggle').click();
    await assertAdjustmentEntry(page, true, /向导|连接/);
    for (const width of [390, 1440]) { await page.setViewportSize({ width, height: 800 }); const status = page.locator('.pith-lesson-adjustment'); assert.ok(await status.evaluate((node: HTMLElement) => node.clientWidth > 0 && node.scrollWidth <= node.clientWidth + 1)); }
  } catch (error) { console.error(await page?.locator('body').innerText()); throw error; }
  finally { if (browser) await browser.close(); if (server) await close(server); await f.close(); }
});

test('Web adjustment uses normal guide turn and real scoped compare/write/rebase, rewriting only affected lesson', { skip: unavailable, timeout: 60000 }, async () => {
  const f = await versionFixture(); let browser: any, server: Server | undefined;
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  try {
    const { first, topic } = await seed(f);
    const settled = await f.store.createTopic({ title: '已沉淀课题', target: '核对旧版本', materialIds: [first.id], toolkits: [] });
    await f.store.writeLesson(settled.id, '01.md', '# 仍基于旧版\n\nsrc/changed.ts:1\n');
    await f.advance(); const second = await f.importLocal();
    await f.store.attachMaterial(topic.id, second.id);
    await f.store.attachMaterial(settled.id, second.id);
    await f.store.updateTopic(settled.id, { status: 'settled' });
    const stablePath = `topics/${topic.id}/lessons/02-stable.md`, stableBytes = await f.storage.readBinary(stablePath), calls: string[] = [];
    const provider: GuideProvider = { async run(input, options) {
      assert.equal(input.scope.kind, 'topic'); assert.match(input.instruction!, /逐讲读取/);
      await pending;
      const tools = createScopedTools({ topicId: topic.id, store: f.store, storage: f.storage, repository: f.repository, onChoices: options.onChoices });
      const execute = async (name: string, args: Record<string, unknown>) => { const tool = tools.find(tool => tool.name === name)!; calls.push(name); const result = await tool.execute(args, options.signal); options.onStep({ kind: 'tool', name, callId: String(calls.length), inputPreview: JSON.stringify(args), status: 'completed', effects: tool.effects ? await tool.effects(result, args) : [] }, calls.length - 1); return result; };
      for (const [fileName, path] of [['01-changed.md', 'src/changed.ts'], ['02-stable.md', 'src/stable.ts']]) {
        await execute('pith_read_lesson', { fileName });
        const diff = await execute('pith_compare_material', { fromMaterialId: first.id, toMaterialId: second.id, path }) as { patch: string };
        if (diff.patch) await execute('pith_write_lesson', { fileName, markdown: '# 变化讲义\n\n相对上一版的变化：old 变为 new。\n\nsrc/changed.ts:1\n\nsrc/added.ts:1\n' });
        else await execute('pith_rebase_lesson', { fileName });
      }
      return { status: 'completed' };
    } };
    server = await createPithWebServer({ workspaceDir: f.workspace, guideProvider: provider }); const address = server.address(); assert.ok(address && typeof address !== 'string');
    const { chromium } = await import(process.env.PITH_PLAYWRIGHT_MODULE!); browser = await chromium.launch({ executablePath: process.env.PITH_CHROME_PATH, headless: true }); const page = await browser.newPage({ viewport: { width: 1024, height: 800 } }); page.setDefaultTimeout(8000);
    await page.goto(`http://127.0.0.1:${address.port}`); await page.locator(`[data-topic="${topic.id}"]`).first().click();
    await page.locator('.pith-article h1').getByText('变化讲义', { exact: true }).waitFor();
    await page.locator('.pith-nav-toggle').click(); await assertAdjustmentEntry(page, false);
    await page.locator('[data-adjust-lessons]').click();
    await page.locator('.pith-left-drawer').waitFor({ state: 'hidden' });
    await page.locator('[data-guide-stop]').waitFor();
    await page.locator('.pith-nav-toggle').click(); await assertAdjustmentEntry(page, true, /正在回应/);
    await page.locator('.pith-nav-toggle').click();
    release();
    await page.locator('.pith-article').getByText(/相对上一版的变化/).waitFor();
    await page.waitForFunction(() => !document.querySelector('[data-guide-stop]'));
    await page.locator('.pith-nav-toggle').click();
    assert.equal(await page.locator('[data-adjust-lessons]').count(), 0);
    await page.locator('.pith-nav-toggle').click();
    assert.deepEqual(calls, ['pith_read_lesson', 'pith_compare_material', 'pith_write_lesson', 'pith_read_lesson', 'pith_compare_material', 'pith_rebase_lesson']);
    assert.deepEqual(await f.storage.readBinary(stablePath), stableBytes);
    assert.ok((await f.store.getTopic(topic.id))!.lessons.every(lesson => lesson.basedOn?.[0] === second.id));
    assert.equal(await page.locator('[data-citation-path="src/changed.ts"]').getAttribute('data-citation-material'), second.id);
    assert.equal(await page.locator('[data-citation-path="src/added.ts"]').getAttribute('data-citation-material'), second.id);
    await page.locator('[data-citation-path="src/changed.ts"]').click(); await page.locator('.pith-article').getByText('export const value = "new";', { exact: true }).waitFor();
    await page.locator('[data-command=home]').click();
    await page.locator(`[data-topic="${settled.id}"]`).first().click();
    await page.locator('.pith-article h1').getByText('仍基于旧版', { exact: true }).waitFor();
    await page.locator('textarea[placeholder="课题已沉淀"]').waitFor({ state: 'attached' });
    await page.locator('.pith-nav-toggle').click(); await assertAdjustmentEntry(page, true, /课题已沉淀/);
  } finally { release(); if (browser) await browser.close(); if (server) await close(server); await f.close(); }
});
