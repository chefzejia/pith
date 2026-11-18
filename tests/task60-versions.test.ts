import test from 'node:test';
import assert from 'node:assert/strict';
import { DefaultWorkspaceStore, lessonIsOutdated, lessonRepositoryMaterials, materialVersionGroups, parseFrontmatter, stringifyFrontmatter } from '../src/core/index.ts';
import { createScopedTools } from '../src/plugins/guide-acp/tools.ts';
import { buildScenePrompt } from '../src/plugins/guide-acp/index.ts';
import { ADJUST_LESSONS_MESSAGE, checkRepositoryUpdate } from '../src/workbench/repositoryIntake.ts';
import { versionFixture } from './task60-fixture.ts';

const changed = '# Changed\r\n\r\nsrc/changed.ts:1\r\n';
const stable = '# Stable\r\n\r\nsrc/stable.ts:1\r\n';

test('writeLesson stamps latest referenced versions, preserves immutable old material and notes, rebase preserves exact bytes', async () => {
  const f = await versionFixture();
  try {
    const first = await f.importLocal();
    await f.store.appendMaterialNote(first.id, { kind: 'note', author: 'user', body: 'old note', anchor: { source: { kind: 'material', materialId: first.id }, file: 'src/changed.ts', locator: `repo:${f.first}:src/changed.ts#L1-L1`, quote: 'old' } });
    const oldLedger = await f.storage.readBinary(`materials/${first.id}/material.md`);
    const topic = await f.store.createTopic({ title: 'Versions', target: 'Understand versioned values', materialIds: [first.id], toolkits: [] });
    await f.store.writeLesson(topic.id, '01-changed.md', changed);
    await f.store.writeLesson(topic.id, '02-stable.md', stable);
    assert.deepEqual((await f.store.getTopic(topic.id))!.lessons.map(lesson => lesson.basedOn), [[first.id], [first.id]]);
    const latestSha = await f.advance(), result = await checkRepositoryUpdate(f.store, f.repository, first.id), second = result.material;
    assert.equal(result.added, true); assert.equal(second.commitSha, latestSha); assert.notEqual(first.id, second.id);
    assert.equal((await checkRepositoryUpdate(f.store, f.repository, first.id)).added, false);
    assert.deepEqual((await f.store.getTopic(topic.id))!.materialIds, [first.id]);
    await f.store.attachMaterial(topic.id, second.id);
    const materials = await f.store.listMaterials();
    assert.equal(materialVersionGroups([...materials].reverse())[0]!.latest.id, second.id);
    assert.ok(first.createdAt < second.createdAt);
    const before = (await f.store.getTopic(topic.id))!;
    assert.ok(before.lessons.every(lesson => lessonIsOutdated(lesson, materials)));
    await f.store.writeLesson(topic.id, '01-changed.md', '# Changed\n相对上一版的变化：old → new\nsrc/changed.ts:1\n');
    const bytes = await f.storage.readBinary(`topics/${topic.id}/lessons/02-stable.md`);
    await f.store.rebaseLesson(topic.id, '02-stable.md');
    assert.deepEqual(await f.storage.readBinary(`topics/${topic.id}/lessons/02-stable.md`), bytes, 'rebase must preserve exact lesson bytes');
    const after = (await new DefaultWorkspaceStore(f.storage).getTopic(topic.id))!;
    assert.deepEqual(after.materialIds, [first.id, second.id]);
    assert.deepEqual(after.lessons.map(lesson => lesson.basedOn), [[second.id], [second.id]]);
    assert.ok(after.lessons.every(lesson => !lessonIsOutdated(lesson, materials)));
    assert.deepEqual(await f.storage.readBinary(`materials/${first.id}/material.md`), oldLedger);
    await assert.rejects(f.store.rebaseLesson(topic.id, 'missing.md'), /Lesson not found/);
    const plain = await f.store.createTopic({ title: 'Plain', target: 'No repo', materialIds: [], toolkits: [] });
    assert.equal((await f.store.writeLesson(plain.id, '01.md', 'text')).lessons[0]!.basedOn, undefined);
  } finally { await f.close(); }
});

test('published missing basedOn resolves earliest per repository without rewriting; explicit basis is validated', async () => {
  const f = await versionFixture();
  try {
    const first = await f.importLocal(); await f.advance(); const second = await f.importLocal();
    const article = await f.store.importMaterial({ title: 'Text', kind: 'article', files: [] });
    const topic = await f.store.createTopic({ title: 'Released lesson', target: 'Read', materialIds: [second.id, article.id, first.id], toolkits: [] });
    await f.store.writeLesson(topic.id, '01.md', changed);
    const path = `topics/${topic.id}/topic.md`, parsed = parseFrontmatter(await f.storage.readText(path));
    const entries = parsed.attributes.lessons as Record<string, unknown>[]; delete entries[0]!.basedOn;
    const released = stringifyFrontmatter(parsed.attributes, parsed.body); await f.storage.writeText(path, released);
    const legacy = (await f.store.getTopic(topic.id))!;
    assert.equal(legacy.lessons[0]!.basedOn, undefined);
    assert.deepEqual(lessonRepositoryMaterials(legacy.lessons[0]!, await f.store.listMaterials()).map(material => material.id), [first.id], 'missing basis means earliest, not newest');
    assert.equal(lessonIsOutdated(legacy.lessons[0]!, await f.store.listMaterials()), true);
    await f.store.readLesson(topic.id, '01.md'); assert.equal(await f.storage.readText(path), released);
    for (const invalid of [article.id, `${first.id},${second.id}`, `${first.id},${first.id}`, 'material-missing']) {
      entries[0]!.basedOn = invalid; await f.storage.writeText(path, stringifyFrontmatter(parsed.attributes, parsed.body));
      await assert.rejects(f.store.getTopic(topic.id), /basedOn/);
    }
  } finally { await f.close(); }
});

test('real scoped version tools compare pinned commits, reject foreign scope, gate rebase and emit lesson effect', async () => {
  const f = await versionFixture();
  try {
    const first = await f.importLocal(), topic = await f.store.createTopic({ title: 'Scoped', target: 'Compare', materialIds: [first.id], toolkits: [] });
    await f.store.writeLesson(topic.id, '01.md', stable); await f.advance(); const second = await f.importLocal();
    const tools = () => createScopedTools({ topicId: topic.id, store: f.store, storage: f.storage, repository: f.repository, onChoices() {} });
    const compare = tools().find(tool => tool.name === 'pith_compare_material')!;
    const input = { fromMaterialId: first.id, toMaterialId: second.id };
    await assert.rejects(compare.execute(input), /scope/); await f.store.attachMaterial(topic.id, second.id);
    assert.equal(compare.write, false);
    const patch = await compare.execute({ ...input, path: 'src/changed.ts' }) as { patch: string }; assert.match(patch.patch, /-export const value = "old"/); assert.match(patch.patch, /\+export const value = "new"/);
    assert.equal((await compare.execute({ ...input, path: 'src/stable.ts' }) as { patch: string }).patch, '');
    const page = await compare.execute({ ...input, limit: 1 }) as { total: number; nextOffset: number }; assert.equal(page.total, 4); assert.equal(page.nextOffset, 1);
    await assert.rejects(compare.execute({ ...input, path: 'src/stable.ts', offset: 1 }), /Pagination/);
    const rebase = tools().find(tool => tool.name === 'pith_rebase_lesson')!, bytes = await f.store.readLesson(topic.id, '01.md');
    const controller = new AbortController(); controller.abort(); await assert.rejects(rebase.execute({ fileName: '01.md' }, controller.signal));
    let writes = 0; const rebased = await rebase.execute({ fileName: '01.md' }, undefined, () => { writes++; }); assert.equal(writes, 1);
    assert.deepEqual(rebase.effects!(rebased, { fileName: '01.md' }), [{ kind: 'lesson', fileName: '01.md' }]); assert.equal(await f.store.readLesson(topic.id, '01.md'), bytes);
    const intake = createScopedTools({ store: f.store, storage: f.storage, repository: f.repository, onChoices() {} });
    assert.equal(intake.some(tool => tool.name === 'pith_compare_material'), false);
    await assert.rejects(intake.find(tool => tool.name === 'pith_rebase_lesson')!.execute({ fileName: '01.md' }), /先创建/);
    const prompt = buildScenePrompt({ profileMarkdown: '', topic: (await f.store.getTopic(topic.id))!, materials: [second, first], userMessage: '调整' });
    const materialPart = JSON.parse(prompt.split('# 材料\n')[1]!.split('\n\n')[0]!) as { id: string; latest: boolean }[];
    assert.deepEqual(materialPart.map(item => [item.id, item.latest]), [[first.id, false], [second.id, true]]);
  } finally { await f.close(); }
});

test('only the dedicated adjustment instruction carries the lesson version workflow', async () => {
  const f = await versionFixture();
  try {
    const first = await f.importLocal(), topic = await f.store.createTopic({ title: 'Versions', target: 'Compare versions', materialIds: [first.id], toolkits: [] });
    await f.store.writeLesson(topic.id, '01.md', changed);
    await f.advance(); const latest = await f.importLocal(); await f.store.attachMaterial(topic.id, latest.id);
    const scene = { profileMarkdown: '', topic: (await f.store.getTopic(topic.id))!, materials: [first, latest], userMessage: '按新版本调整' };
    const workflow = /逐讲|pith_read_lesson|pith_compare_material|pith_write_lesson|pith_rebase_lesson|相对上一版的变化|# 本回合指令/;
    const intake = buildScenePrompt({ ...scene, topic: null, userMessage: '核对版本' });
    assert.doesNotMatch(intake, workflow, 'ordinary intake must not carry the adjustment workflow');
    const ordinary = buildScenePrompt(scene);
    assert.doesNotMatch(ordinary, workflow, 'ordinary topic turns must not infer adjustment from stale lessons or message text');
    assert.match(ordinary, /"versionStatus":"基于旧版本"/);
    const adjustment = buildScenePrompt({ ...scene, instruction: ADJUST_LESSONS_MESSAGE });
    const [context, instruction] = adjustment.split('\n\n# 本回合指令\n');
    assert.equal(context, ordinary);
    assert.match(instruction!, /逐讲读取.*pith_read_lesson.*引用的文件.*pith_compare_material.*带路径.*依据版本.*最新引用版本/);
    assert.match(instruction!, /仅在需要了解整体变化时才分页.*不通读全部变化/);
    assert.match(instruction!, /实质变化.*pith_write_lesson.*相对上一版的变化/);
    assert.match(instruction!, /不受影响.*只调用 pith_rebase_lesson.*保持正文字节不变/);
    assert.match(instruction!, /最后在回复中列出改了哪些讲、为什么改/);
  } finally { await f.close(); }
});

test('basis stamps one latest snapshot per repository and excludes non-repository materials', async () => {
  const f = await versionFixture();
  try {
    const first = await f.importLocal(); await f.advance(); const latest = await f.importLocal();
    const otherPath = `${f.root}/other`; await f.git('clone', '--no-local', f.source, otherPath);
    const other = await f.store.importMaterial({ ...(await f.repository.inspectRepository(otherPath)), kind: 'repo', files: [] });
    const article = await f.store.importMaterial({ title: 'Article', kind: 'article', files: [] });
    const topic = await f.store.createTopic({ title: 'Several repositories', target: 'Compare basis', materialIds: [first.id, article.id, other.id, latest.id], toolkits: [] });
    const written = await f.store.writeLesson(topic.id, '01.md', 'src/changed.ts:1');
    assert.deepEqual(written.lessons[0]!.basedOn, [latest.id, other.id]);
    const tools = createScopedTools({ topicId: topic.id, store: f.store, storage: f.storage, repository: f.repository, onChoices() {} });
    await assert.rejects(tools.find(tool => tool.name === 'pith_compare_material')!.execute({ fromMaterialId: first.id, toMaterialId: other.id }), /same repository/);
    const prompt = buildScenePrompt({ topic: { ...written, lessons: [{ name: '01.md', basedOn: [first.id, other.id] }] }, materials: [latest, first, other, article], profileMarkdown: '', userMessage: '核对' });
    assert.match(prompt, /"versionStatus":"基于旧版本"/);
  } finally { await f.close(); }
});
