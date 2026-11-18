import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { promisify } from 'node:util';
import { DefaultWorkspaceStore } from '../src/core/index.ts';
import { NodeWorkspaceStorage } from '../src/shells/web/nodeStorage.ts';
import { NodeRepositoryPort } from '../src/shells/web/nodeRepository.ts';

const run = promisify(execFile);
export async function versionFixture() {
  const base = resolve('.tmp/runtime/task-60'); await mkdir(base, { recursive: true });
  const root = await mkdtemp(join(base, 'test-')), source = join(root, 'source'), home = join(root, 'home'), workspace = join(root, 'workspace'), remote = join(root, 'remote.git');
  const previous = { ...process.env };
  for (const key of Object.keys(process.env)) if (key.startsWith('GIT_')) delete process.env[key];
  Object.assign(process.env, { HOME: home, XDG_CONFIG_HOME: join(home, '.config'), PITH_SPEECH_HOME: join(home, 'speech'), PITH_REPOSITORY_HOME: join(root, 'repositories'), GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: join(home, '.gitconfig'), GIT_ALLOW_PROTOCOL: 'file', GIT_AUTHOR_NAME: 'Fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid', GIT_COMMITTER_NAME: 'Fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid' });
  const git = async (...args: string[]) => (await run('git', args, { env: process.env })).stdout.trim();
  const close = async () => { for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key]; Object.assign(process.env, previous); await rm(root, { recursive: true, force: true }); };
  try {
    await Promise.all([mkdir(home), mkdir(workspace), mkdir(join(source, 'src'), { recursive: true })]);
    await git('-C', source, 'init', '-q', '-b', 'main');
    await writeFile(join(source, 'src/changed.ts'), 'export const value = "old";\n');
    await writeFile(join(source, 'src/stable.ts'), 'export const stable = 1;\n');
    await writeFile(join(source, 'src/rename.ts'), 'export const rename = 2;\n');
    await writeFile(join(source, 'src/deleted.ts'), 'export const deleted = 3;\n');
    await git('-C', source, 'add', '.'); await git('-C', source, 'commit', '-qm', 'v1');
    const first = await git('-C', source, 'rev-parse', 'HEAD');
    await git('clone', '--bare', source, remote);
    const url = 'https://github.com/pith-task60/versions';
    await git('config', '--global', `url.file://${remote}.insteadOf`, url);
    const storage = new NodeWorkspaceStorage(workspace), store = new DefaultWorkspaceStore(storage), repository = new NodeRepositoryPort();
    await store.ensureScaffold();
    const importLocal = async () => store.importMaterial({ ...(await repository.inspectRepository(source)), kind: 'repo', files: [] });
    const advance = async () => {
      await writeFile(join(source, 'src/changed.ts'), 'export const value = "new";\n');
      await writeFile(join(source, 'src/added.ts'), 'export const added = 4;\n');
      await git('-C', source, 'mv', 'src/rename.ts', 'src/renamed.ts');
      await git('-C', source, 'rm', '-q', 'src/deleted.ts');
      await git('-C', source, 'add', '.'); await git('-C', source, 'commit', '-qm', 'v2');
      return git('-C', source, 'rev-parse', 'HEAD');
    };
    return { root, source, home, workspace, remote, url, first, git, close, storage, store, repository, importLocal, advance, read: (path: string) => readFile(path, 'utf8') };
  } catch (error) { await close(); throw error; }
}
