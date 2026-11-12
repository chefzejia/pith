import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { createObsidianHostPort, type ObsidianVaultAdapter } from "../src/shells/obsidian/index.ts";
import { NodeWorkspaceStorage } from "../src/shells/web/nodeStorage.ts";

const exec = promisify(execFile);

function adapterFor(dir: string): ObsidianVaultAdapter {
  const storage = new NodeWorkspaceStorage(dir);
  return {
    getFullPath: path => join(dir, path),
    exists: path => storage.exists(path), read: path => storage.readText(path),
    readBinary: async path => new Uint8Array(await storage.readBinary(path)).buffer,
    write: (path, data) => storage.writeText(path, data),
    writeBinary: (path, data) => storage.writeBinary(path, new Uint8Array(data)),
    mkdir: path => storage.mkdir(path),
    list: async path => { const entries = await storage.list(path); return { files: entries.filter(entry => entry.type === "file").map(entry => entry.path), folders: entries.filter(entry => entry.type === "folder").map(entry => entry.path) }; },
  };
}

for (const binary of [false, true]) test(`Obsidian ${binary ? "binary" : "text"} creation never overwrites an external winner`, async () => {
  const dir = await mkdtemp(join(tmpdir(), "pith-atomic-"));
  try {
    await mkdir(join(dir, "Pith"));
    const base = adapterFor(dir), target = join(dir, "Pith", "race");
    let created = false;
    const adapter = { ...base, getFullPath: (path: string) => {
      if (path === "Pith/race" && !created) {
        created = true;
        execFileSync(process.execPath, ["-e", "require('node:fs').writeFileSync(process.argv[1], 'external', {flag:'wx'})", target]);
      }
      return join(dir, path);
    }, exists: async (path: string) => path === "Pith/race" ? false : base.exists(path) };
    const storage = createObsidianHostPort(adapter, "Pith", undefined, adapter).storage;
    const create = binary ? storage.createBinary("race", new TextEncoder().encode("internal")) : storage.createText("race", "internal");
    await assert.rejects(create, (error: NodeJS.ErrnoException) => error.code === "EEXIST");
    assert.equal(await readFile(target, "utf8"), "external");
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("concurrent external and Obsidian creators have exactly one winner", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pith-atomic-"));
  try {
    await mkdir(join(dir, "Pith"));
    const adapter = adapterFor(dir), target = join(dir, "Pith", "concurrent"), storage = createObsidianHostPort(adapter, "Pith", undefined, adapter).storage;
    const external = exec(process.execPath, ["-e", "require('node:fs').writeFileSync(process.argv[1], 'external', {flag:'wx'})", target]);
    const outcomes = await Promise.allSettled([external, storage.createText("concurrent", "internal")]);
    assert.equal(outcomes.filter(item => item.status === "fulfilled").length, 1);
    assert.equal(outcomes.filter(item => item.status === "rejected").length, 1);
    const content = await readFile(target, "utf8");
    assert.equal(content, outcomes[0]!.status === "fulfilled" ? "external" : "internal");
  } finally { await rm(dir, { recursive: true, force: true }); }
});

for (const binary of [false, true]) test(`Obsidian ${binary ? "binary" : "text"} creation cannot escape through a concurrently replaced directory`, async () => {
  const dir = await mkdtemp(join(tmpdir(), "pith-atomic-"));
  try {
    await mkdir(join(dir, "Pith", "parent"), { recursive: true });
    await mkdir(join(dir, "outside"));
    const base = adapterFor(dir);
    let leafLookups = 0;
    const adapter = { ...base, getFullPath: (path: string) => {
      if (path === "Pith/parent/new" && ++leafLookups === 2) {
        execFileSync(process.execPath, ["-e", "const fs=require('node:fs'); fs.renameSync(process.argv[1], process.argv[2]); fs.symlinkSync(process.argv[3], process.argv[1], 'dir')", join(dir, "Pith", "parent"), join(dir, "Pith", "old-parent"), join(dir, "outside")]);
      }
      return join(dir, path);
    } };
    const storage = createObsidianHostPort(adapter, "Pith", undefined, adapter).storage;
    const create = binary ? storage.createBinary("parent/new", new Uint8Array([1])) : storage.createText("parent/new", "internal");
    const result = await Promise.allSettled([create]);
    await assert.rejects(readFile(join(dir, "outside", "new")), (error: NodeJS.ErrnoException) => error.code === "ENOENT");
    assert.equal(result[0]!.status, "rejected");
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("exclusive creation rejects unsupported hosts, unsafe paths and symlinks without hiding errors", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pith-atomic-"));
  try {
    await mkdir(join(dir, "Pith")); await mkdir(join(dir, "outside"));
    const adapter = adapterFor(dir), storage = createObsidianHostPort(adapter, "Pith", undefined, adapter).storage;
    const unsupported = { ...adapter, getFullPath: undefined };
    for (const create of [(value: string) => createObsidianHostPort(unsupported).storage.createText(value, "x"), (value: string) => createObsidianHostPort(unsupported).storage.createBinary(value, new Uint8Array([1]))]) {
      await assert.rejects(create("unsupported"), /atomic|exclusive/i);
    }
    await assert.rejects(createObsidianHostPort(adapter).storage.createText("unverified", "x"), /atomic|exclusive/i);
    await assert.rejects(storage.createText("../escape", "x"), /Invalid workspace path/);
    await assert.rejects(storage.createBinary("missing/file", new Uint8Array([1])), (error: NodeJS.ErrnoException) => error.code === "ENOENT");
    await writeFile(join(dir, "Pith", "existing"), "original");
    await assert.rejects(storage.createText("existing", "replacement"), (error: NodeJS.ErrnoException) => error.code === "EEXIST");
    await assert.rejects(storage.createBinary("existing/child", new Uint8Array([1])), (error: NodeJS.ErrnoException) => error.code === "ENOTDIR");
    assert.equal(await readFile(join(dir, "Pith", "existing"), "utf8"), "original");
    await symlink(join(dir, "outside"), join(dir, "Pith", "link"));
    await assert.rejects(storage.createBinary("link/file", new Uint8Array([1])), /Symbolic links/);
    await symlink(join(dir, "outside", "absent"), join(dir, "Pith", "leaf"));
    await assert.rejects(storage.createText("leaf", "x"), /Symbolic links/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("workspace copies preserve bytes and refuse existing or unsafe destinations", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pith-copy-"));
  try {
    await mkdir(join(dir, "Pith")); await mkdir(join(dir, "outside"));
    const adapter = adapterFor(dir), hosts = [new NodeWorkspaceStorage(join(dir, "Pith")), createObsidianHostPort(adapter, "Pith", undefined, adapter).storage];
    await writeFile(join(dir, "Pith", "source"), Buffer.from([0, 255, 13, 10]));
    await symlink(join(dir, "outside"), join(dir, "Pith", "link"));
    for (const [index, storage] of hosts.entries()) {
      const target = `copy-${index}`;
      await storage.copy("source", target);
      assert.deepEqual(await readFile(join(dir, "Pith", target)), Buffer.from([0, 255, 13, 10]));
      await assert.rejects(storage.copy("source", target), (error: NodeJS.ErrnoException) => error.code === "EEXIST");
      await assert.rejects(storage.copy("source", "link/copy"), /Symbolic links/);
      await assert.rejects(storage.copy("source", "../escape"), /Invalid workspace path/);
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});
