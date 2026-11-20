import { execFile } from "node:child_process";
import { watch } from "node:fs";
import { access, chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { NodeRepositoryPort } from "../src/shells/web/nodeRepository.ts";

const run = promisify(execFile);
export async function remoteFixture(base = resolve(".tmp/runtime/task-59")) {
  await mkdir(base, { recursive: true });
  const root = await mkdtemp(join(base, "test-")), home = join(root, "home"), source = join(root, "source"), remote = join(root, "remote.git"), repositories = join(root, "repositories");
  await mkdir(home); await mkdir(source);
  const previous = { ...process.env };
  Object.assign(process.env, { HOME: home, XDG_CONFIG_HOME: join(home, ".config"), PITH_REPOSITORY_HOME: repositories, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: join(home, ".gitconfig"), GIT_ALLOW_PROTOCOL: "file", GIT_AUTHOR_NAME: "Fixture", GIT_AUTHOR_EMAIL: "fixture@example.invalid", GIT_COMMITTER_NAME: "Fixture", GIT_COMMITTER_EMAIL: "fixture@example.invalid" });
  const git = async (...args: string[]) => (await run("git", args, { env: process.env })).stdout.trim();
  const close = async () => { for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key]; Object.assign(process.env, previous); await rm(root, { recursive: true, force: true }); };
  try {
    await git("-C", source, "init", "-q", "-b", "main");
    await mkdir(join(source, "src")); await writeFile(join(source, "src/main.ts"), "export const before = 1;\n");
    await git("-C", source, "add", "."); await git("-C", source, "commit", "-qm", "first");
    const first = await git("-C", source, "rev-parse", "HEAD");
    await git("clone", "--bare", source, remote);
    const url = "https://github.com/fixture/repository";
    await git("config", "--global", `url.file://${remote}.insteadOf`, url);
    const port = new NodeRepositoryPort();
    return { root, home, source, remote, repositories, first, url, port, git, close,
      async holdPack() {
        const marker = join(root, "pack-arrived"), script = join(root, "hold-pack.mjs");
        await writeFile(script, `#!${process.execPath}\nimport { writeFile } from 'node:fs/promises';\nawait writeFile(${JSON.stringify(marker)}, 'actual git pack-objects boundary');\nawait new Promise(() => { setInterval(() => {}, 1000); });\n`);
        await chmod(script, 0o755); await git("config", "--global", "uploadpack.packObjectsHook", script);
        let watcher: ReturnType<typeof watch>;
        let timer: ReturnType<typeof setTimeout>;
        const arrived = new Promise<void>((resolveReady, reject) => {
          const check = async () => { try { await access(marker); clearTimeout(timer); watcher.close(); resolveReady(); } catch {} };
          watcher = watch(root, () => { void check(); });
          timer = setTimeout(() => { watcher.close(); reject(new Error("real git pack boundary not reached")); }, 10000);
          void check();
        });
        return { arrived, marker, release: async () => { await git("config", "--global", "--unset", "uploadpack.packObjectsHook"); await rm(marker, { force: true }); } };
      },
      read: (path: string) => readFile(path, "utf8"),
    };
  } catch (error) { await close(); throw error; }
}
