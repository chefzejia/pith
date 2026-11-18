import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { checkRepositoryUpdate } from '../src/workbench/repositoryIntake.ts';
import { versionFixture } from './task60-fixture.ts';

test('real git comparison reports add/modify/delete/rename and bounded pages/patches without working-tree or config leakage', async () => {
  const f = await versionFixture();
  try {
    const second = await f.advance();
    await writeFile(join(f.source, 'src/changed.ts'), 'DIRTY MUST NOT APPEAR');
    const marker = join(f.root, 'external-diff-ran'), hook = join(f.root, 'diff.sh');
    await writeFile(hook, `#!/bin/sh\ntouch '${marker}'\nexit 1\n`, { mode: 0o755 });
    await f.git('config', '--global', 'diff.external', hook);
    await f.git('-C', f.source, 'config', 'diff.external', hook);
    await f.git('-C', f.source, 'config', 'diff.fixture.textconv', hook);
    await writeFile(join(f.source, '.gitattributes'), '*.ts diff=fixture\n');
    const page = await f.repository.listChanges(f.source, f.first, second, 0, 2);
    assert.equal(page.total, 4); assert.equal(page.changes.length, 2); assert.equal(page.nextOffset, 2);
    const last = await f.repository.listChanges(f.source, f.first, second, 2, 2); assert.equal(last.nextOffset, null);
    const changes = [...page.changes, ...last.changes];
    assert.deepEqual(changes, [
      { path: 'src/added.ts', status: 'added', additions: 1, deletions: 0 },
      { path: 'src/changed.ts', status: 'modified', additions: 1, deletions: 1 },
      { path: 'src/deleted.ts', status: 'deleted', additions: 0, deletions: 1 },
      { path: 'src/renamed.ts', status: 'renamed', previousPath: 'src/rename.ts', additions: 0, deletions: 0 },
    ]);
    const diff = await f.repository.readChange(f.source, f.first, second, 'src/changed.ts');
    assert.match(diff.patch, /-export const value = "old"/); assert.match(diff.patch, /\+export const value = "new"/); assert.doesNotMatch(diff.patch, /DIRTY/); assert.equal(diff.truncated, false);
    const clipped = await f.repository.readChange(f.source, f.first, second, 'src/changed.ts', 2); assert.equal(clipped.truncated, true); assert.equal(clipped.patch.split('\n').length, 2);
    assert.deepEqual(await f.repository.readChange(f.source, f.first, second, 'src/stable.ts'), { path: 'src/stable.ts', patch: '', truncated: false });
    assert.match((await f.repository.readChange(f.source, f.first, second, 'src/deleted.ts')).patch, /-export const deleted/);
    assert.equal((await readdir(f.root)).includes('external-diff-ran'), false);
    for (const [offset, limit] of [[-1, 2], [0, 0], [0, 1001]]) await assert.rejects(f.repository.listChanges(f.source, f.first, second, offset, limit));
    for (const path of ['../outside', '/etc/passwd', 'src/missing.ts', ':(glob)*']) await assert.rejects(f.repository.readChange(f.source, f.first, second, path));
    await assert.rejects(f.repository.listChanges(f.source, '0'.repeat(40), second));
    await assert.rejects(f.repository.readChange(f.source, f.first, second, 'src/changed.ts', 2001));
    await writeFile(join(f.source, 'large.txt'), 'bounded diff line 中文\n'.repeat(400000));
    await writeFile(join(f.source, 'unsupported\nname.ts'), 'not an addressable path\n');
    await f.git('-C', f.source, 'add', 'large.txt', 'unsupported\nname.ts'); await f.git('-C', f.source, 'commit', '-qm', 'large snapshot');
    const third = await f.git('-C', f.source, 'rev-parse', 'HEAD');
    const large = await f.repository.readChange(f.source, second, third, 'large.txt', 3);
    assert.equal(large.truncated, true); assert.equal(large.patch.split('\n').length, 3);
    assert.deepEqual((await f.repository.listChanges(f.source, second, third)).changes.map(change => change.path), ['large.txt']);
  } finally { await f.close(); }
});

test('managed remote update uses real shallow fetch, imports only on click, pins snapshots through rewritten history and GC', async () => {
  const f = await versionFixture();
  try {
    const clone = await f.repository.cloneRemote(f.url);
    const first = await f.store.importMaterial({ ...clone, kind: 'repo', files: [] });
    assert.deepEqual(await readdir(clone.externalPath), ['.git']);
    assert.equal(await f.git('-C', clone.externalPath, 'rev-parse', '--is-shallow-repository'), 'true');
    const second = await f.advance(); await f.git('-C', f.source, 'push', f.remote, 'main');
    assert.equal((await f.store.listMaterials()).length, 1);
    assert.equal(await f.git('-C', clone.externalPath, 'rev-parse', 'HEAD'), f.first);
    const update = await checkRepositoryUpdate(f.store, f.repository, first.id); assert.equal(update.added, true); assert.equal(update.material.commitSha, second); assert.equal(update.material.externalPath, clone.externalPath);
    assert.equal((await checkRepositoryUpdate(f.store, f.repository, first.id)).added, false);
    await f.git('-C', f.source, 'checkout', '--orphan', 'rewritten'); await f.git('-C', f.source, 'rm', '-rf', '.');
    await writeFile(join(f.source, 'fresh.md'), 'new root\n'); await f.git('-C', f.source, 'add', '.'); await f.git('-C', f.source, 'commit', '-qm', 'rewrite');
    const rewritten = await f.git('-C', f.source, 'rev-parse', 'HEAD'); await f.git('-C', f.source, 'push', '--force', f.remote, 'HEAD:main');
    assert.equal((await f.repository.fetchRemote(clone.externalPath)).commitSha, rewritten);
    await f.git('-C', clone.externalPath, 'reflog', 'expire', '--expire=now', '--all'); await f.git('-C', clone.externalPath, 'gc', '--prune=now');
    for (const sha of [f.first, second, rewritten]) assert.equal(await f.git('-C', clone.externalPath, 'rev-parse', `refs/pith/pins/${sha}`), sha);
    assert.match((await f.repository.readFile(clone.externalPath, f.first, 'src/changed.ts')).text, /old/);
    assert.match((await f.repository.readChange(clone.externalPath, f.first, second, 'src/changed.ts')).patch, /new/);
    assert.deepEqual(await readdir(clone.externalPath), ['.git']);
    await assert.rejects(f.repository.fetchRemote(f.source), /Pith/);
    const controller = new AbortController(); controller.abort(); await assert.rejects(f.repository.fetchRemote(clone.externalPath, controller.signal));
  } finally { await f.close(); }
});
