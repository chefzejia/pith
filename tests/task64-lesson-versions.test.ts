import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { lessonIsOutdated, lessonRepositoryMaterials, topicMaterials } from '../src/core/index.ts';
import { repositoryCitations } from '../src/core/repositoryCitations.ts';
import { rebaseComparedLesson } from '../src/core/store/WorkspaceStore.ts';
import { readLessonVersions, readSessionRepositoryFiles, useRepositoryVersion } from '../src/workbench/lessonVersions.ts';
import { versionFixture } from './task60-fixture.ts';

test('citation matching preserves exact path boundaries, line numbers and ambiguous sources', () => {
  const files = [{ name: 'src/file.ts' }, { name: 'dir with space/m[ain].ts' }];
  const sources = [{ id: 'a', files }, { id: 'b', files: files.slice(0, 1) }];
  const text = 'x/src/file.ts:1 𐐀src/file.ts:2 src/file.ts:0 src/file.ts:9007199254740992 (src/file.ts:7), dir with space/m[ain].ts:8';
  const [matches] = repositoryCitations([text], sources);
  assert.deepEqual(matches!.map(match => [text.slice(match.start, match.end), match.line, match.sources.map(source => source.id)]), [
    ['src/file.ts:7', 7, ['a', 'b']], ['dir with space/m[ain].ts:8', 8, ['a']],
  ]);
});

test('task67 unrelated attachment leaves stamped versions current and comparison details empty', async () => {
  const f = await versionFixture();
  try {
    const first = await f.importLocal(), second = await f.importDistinct('second-basis');
    const topic = await f.store.createTopic({ title: 'Versions', target: 'Compare', materialIds: [first.id, second.id], toolkits: [] });
    await f.store.writeLesson(topic.id, '01.md', 'src/stable.ts:1');
    const other = await f.importDistinct('unrelated');
    const attached = await f.store.attachMaterial(topic.id, other.id);
    const materials = topicMaterials(attached, await f.store.listMaterials()), lesson = attached.lessons[0]!;
    assert.deepEqual(lessonRepositoryMaterials(lesson, materials).map(material => material.id), [first.id, second.id]);
    assert.equal(lessonIsOutdated(lesson, materials), false, 'new repository must not mark a stamped lesson stale');
    const files = await readSessionRepositoryFiles(f.repository, materials, attached);
    assert.deepEqual(await readLessonVersions(f.store, f.repository, attached, materials, files), {});
    assert.equal(await f.store.readLesson(topic.id, '01.md'), 'src/stable.ts:1');
  } finally { await f.close(); }
});

test('using a new version keeps modified, deleted and renamed citations; prose and inline code follow the rendered rules', async () => {
  const f = await versionFixture();
  try {
    const old = await f.importLocal(), topic = await f.store.createTopic({ title: 'Versions', target: 'Compare', materialIds: [old.id], toolkits: [] });
    const stable = 'src/stable.ts:1\r\n\r\n```ts\r\nsrc/changed.ts:1\r\n```\r\n\r\n[src/changed.ts:1](https://example.invalid)\r\n\r\nnot/src/rename.ts:1\r\n';
    await f.store.writeLesson(topic.id, '01-changed.md', '# `src/changed.ts:1`\n\n| file | other |\n|---|---|\n| src/rename.ts:1 | **src/deleted.ts:2** |\n\nsrc/added.ts:1');
    await f.store.writeLesson(topic.id, '02-stable.md', stable);
    await f.advance(); const latest = await f.importLocal();
    const result = await useRepositoryVersion(f.store, f.repository, topic.id, latest.id);
    const after = (await f.store.getTopic(topic.id))!;
    assert.deepEqual(after.lessons.map(lesson => lesson.basedOn), [[old.id], [latest.id]], 'changed citations must not advance');
    assert.deepEqual(result['01-changed.md']?.[0]?.paths, ['src/changed.ts', 'src/rename.ts', 'src/deleted.ts']);
    assert.equal(result['02-stable.md'], undefined);
    assert.equal(await f.store.readLesson(topic.id, '02-stable.md'), stable);
  } finally { await f.close(); }
});

test('task67 same-repository update after unrelated attachment rebases only unchanged citations within each lesson basis', async () => {
  const f = await versionFixture();
  try {
    const old = await f.importLocal(), companion = await f.importDistinct('companion-basis');
    const topic = await f.store.createTopic({ title: 'Versions', target: 'Compare', materialIds: [old.id, companion.id], toolkits: [] });
    const changed = 'src/changed.ts:1', stable = 'src/stable.ts:1\r\n';
    await f.store.writeLesson(topic.id, '01-changed.md', changed);
    await f.store.writeLesson(topic.id, '02-stable.md', stable);
    const other = await f.importDistinct('unrelated');
    await f.store.attachMaterial(topic.id, other.id);
    await f.advance();
    const latest = await f.importLocal();
    const comparisons = await useRepositoryVersion(f.store, f.repository, topic.id, latest.id);
    const updated = (await f.store.getTopic(topic.id))!;
    assert.deepEqual(updated.materialIds, [old.id, companion.id, other.id, latest.id]);
    assert.deepEqual(updated.lessons.map(lesson => lesson.basedOn), [[old.id, companion.id], [latest.id, companion.id]]);
    assert.deepEqual({ ...comparisons }, {
      '01-changed.md': [{ title: old.title, from: old.commitSha, to: latest.commitSha, paths: ['src/changed.ts'] }],
    });
    const materials = topicMaterials(updated, await f.store.listMaterials());
    assert.deepEqual(updated.lessons.map(lesson => lessonIsOutdated(lesson, materials)), [true, false]);
    const files = await readSessionRepositoryFiles(f.repository, materials, updated);
    assert.deepEqual(await readLessonVersions(f.store, f.repository, updated, materials, files), { ...comparisons });
    assert.equal(await f.store.readLesson(topic.id, '01-changed.md'), changed);
    assert.equal(await f.store.readLesson(topic.id, '02-stable.md'), stable);
  } finally { await f.close(); }
});

test('a one-shot git diff failure keeps even an unaffected lesson on its old basis', async () => {
  const f = await versionFixture();
  try {
    const old = await f.importLocal(), topic = await f.store.createTopic({ title: 'Failure', target: 'Compare', materialIds: [old.id], toolkits: [] });
    await f.store.writeLesson(topic.id, '01.md', 'src/stable.ts:1');
    await f.advance(); const latest = await f.importLocal();
    const bin = join(f.root, 'bin'), marker = join(f.root, 'failed'); await mkdir(bin);
    await writeFile(join(bin, 'git'), `#!/bin/sh\nif [ "$5" = "$PITH_TEST_COMPARE_REPO" ] && [ "$6" = diff ] && [ "\${12}" = --numstat ] && [ ! -f "$PITH_TEST_COMPARE_MARKER" ]; then\n  printf 'once\\n' > "$PITH_TEST_COMPARE_MARKER"\n  exit 42\nfi\nexec /usr/bin/git "$@"\n`);
    await chmod(join(bin, 'git'), 0o755);
    Object.assign(process.env, { PATH: `${bin}:${process.env.PATH}`, PITH_TEST_COMPARE_REPO: f.source, PITH_TEST_COMPARE_MARKER: marker });
    const result = await useRepositoryVersion(f.store, f.repository, topic.id, latest.id);
    assert.equal(await readFile(marker, 'utf8'), 'once\n');
    assert.deepEqual((await f.store.getTopic(topic.id))!.lessons[0]!.basedOn, [old.id], 'unknown differences must not advance the basis');
    assert.match(result['01.md']![0]!.reason!, /比较失败/);
    assert.equal((await f.repository.listChanges(f.source, old.commitSha!, latest.commitSha!)).changes.length, 4);
  } finally { await f.close(); }
});

test('guarded rebase rejects an obsolete comparison of either bytes or target versions', async () => {
  const f = await versionFixture();
  try {
    const old = await f.importLocal(), topic = await f.store.createTopic({ title: 'Race', target: 'Compare', materialIds: [old.id], toolkits: [] });
    await f.store.writeLesson(topic.id, '01.md', 'src/stable.ts:1');
    await f.advance(); const latest = await f.importLocal();
    await f.store.attachMaterial(topic.id, latest.id);
    for (const compared of [
      { markdown: 'previous lesson bytes', from: [old.id], to: [latest.id] },
      { markdown: 'src/stable.ts:1', from: [old.id], to: [old.id] },
    ]) await assert.rejects(rebaseComparedLesson(f.store, topic.id, '01.md', compared), /未改依据/);
    assert.deepEqual((await f.store.getTopic(topic.id))!.lessons[0]!.basedOn, [old.id]);
  } finally { await f.close(); }
});
