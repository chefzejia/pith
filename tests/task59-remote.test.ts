import assert from "node:assert/strict";
import { access, mkdir, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { DefaultWorkspaceStore, normalizeRepositoryUrl } from "../src/core/index.ts";
import { ingestExternalUrl } from "../src/plugins/guide-acp/externalIngest.ts";
import { NodeWorkspaceStorage } from "../src/shells/web/nodeStorage.ts";
import { splitIntakeText } from "../src/workbench/intake.ts";
import { resolveRepositoryIntake } from "../src/workbench/repositoryIntake.ts";
import { remoteFixture } from "./task59-remote-fixture.ts";

test("GitHub roots normalize, document URLs remain documents, MCP rejects before transport", async () => {
  for (const url of ["https://github.com/Owner/Repo", "https://github.com/Owner/Repo.git/", "git@github.com:Owner/Repo.git"]) {
    assert.equal(normalizeRepositoryUrl(url), "https://github.com/owner/repo");
    assert.deepEqual(splitIntakeText(`学习 ${url}`), { goal: "学习", repositories: [url], urls: [] });
    await assert.rejects(ingestExternalUrl({ url }, undefined), /代码仓库请用户从立项框或添加材料导入/);
  }
  for (const url of ["http://github.com/a/b", "https://github.com/a/b/tree/main", "https://github.com/a/b/blob/main/x", "https://github.com/a/b?x", "https://github.com/a/b#x", "https://user@github.com/a/b", "https://github.com/../b", "https://github.com/a/..", "https://gitlab.com/a/b", "git@github.com:a/b", "https://github.com/a/.git", "https://github.com/a/b%20c"]) assert.equal(normalizeRepositoryUrl(url), null, url);
  const doc = "https://github.com/a/b/blob/main/x";
  assert.deepEqual(splitIntakeText(doc), { goal: "", repositories: [], urls: [doc] });
});

test("real git honors global insteadOf, shallow no-checkout clone, latest reuse and durable pins after forced history/GC", async () => {
  const f = await remoteFixture();
  try {
    const first = await f.port.cloneRemote(f.url + ".git/");
    assert.equal(first.remoteUrl, f.url); assert.equal(first.title, "fixture/repository"); assert.equal(first.commitSha, f.first);
    assert.equal(first.externalPath, join(f.repositories, "github.com/fixture/repository"));
    assert.deepEqual(await readdir(first.externalPath), [".git"]);
    assert.equal(await f.git("-C", first.externalPath, "rev-parse", "--is-shallow-repository"), "true");
    assert.equal(await f.git("-C", first.externalPath, "rev-list", "--count", "HEAD"), "1");
    assert.equal((await resolveRepositoryIntake(f.url + " 理解边界", f.port)).description, "理解边界");
    // Rewrite history; the prior snapshot becomes unreachable from every upstream branch.
    await f.git("-C", f.source, "checkout", "--orphan", "replacement");
    await writeFile(join(f.source, "src/main.ts"), "export const after = 2;\n");
    await f.git("-C", f.source, "add", "."); await f.git("-C", f.source, "commit", "-qm", "replacement");
    await f.git("-C", f.source, "push", "--force", f.remote, "HEAD:main");
    const second = await f.port.cloneRemote(f.url);
    assert.notEqual(second.commitSha, first.commitSha); assert.equal(second.externalPath, first.externalPath);
    assert.equal((await f.port.inspectRepository(second.externalPath)).commitSha, second.commitSha);
    // Advance every non-pin remote ref, as a forced upstream update does.
    const refs = (await f.git("-C", first.externalPath, "for-each-ref", "--format=%(refname)", "refs/remotes/")).split("\n").filter(Boolean);
    for (const ref of refs) await f.git("-C", first.externalPath, "update-ref", ref, second.commitSha);
    await f.git("-C", first.externalPath, "reflog", "expire", "--expire=now", "--all");
    await f.git("-C", first.externalPath, "gc", "--prune=now");
    assert.match((await f.port.readFile(first.externalPath, first.commitSha, "src/main.ts")).text, /before = 1/);
    assert.match((await f.port.readFile(second.externalPath, second.commitSha, "src/main.ts")).text, /after = 2/);
    for (const sha of [first.commitSha, second.commitSha]) assert.equal(await f.git("-C", first.externalPath, "rev-parse", `refs/pith/pins/${sha}`), sha);
    assert.deepEqual(await readdir(first.externalPath), [".git"]);
  } finally { await f.close(); }
});

test("repo same-commit imports preserve original material bytes across local/remote sources and queued imports", async () => {
  const f = await remoteFixture();
  try {
    const workspace = join(f.root, "workspace"); await mkdir(workspace);
    const storage = new NodeWorkspaceStorage(workspace), store = new DefaultWorkspaceStore(storage);
    const binding = await f.port.cloneRemote(f.url);
    const input = { ...binding, kind: "repo" as const, files: [] };
    const first = await store.importMaterial(input), path = `materials/${first.id}/material.md`, before = await storage.readText(path);
    for (const material of await Promise.all([store.importMaterial({ ...input, title: "renamed" }), store.importMaterial({ ...input, remoteUrl: undefined })])) assert.deepEqual(material, first);
    assert.equal(await storage.readText(path), before); assert.deepEqual(await store.getMaterial(first.id), first);
    const localInput = { ...input, externalPath: f.source, remoteUrl: undefined };
    const local = await store.importMaterial(localInput);
    assert.notEqual(local.id, first.id); assert.equal(local.remoteUrl, undefined);
    assert.deepEqual(await store.importMaterial({ ...localInput, remoteUrl: f.url }), local);
    assert.notEqual((await store.importMaterial({ ...input, commitSha: "a".repeat(40) })).id, first.id);
    for (const remoteUrl of ["https://github.com/Fixture/Repository", f.url + ".git", "https://example.com/a/b"]) await assert.rejects(store.importMaterial({ ...input, remoteUrl }), /remoteUrl/);
    await assert.rejects(store.importMaterial({ title: "bad", kind: "article", files: [], remoteUrl: f.url }), /remoteUrl/);
    await storage.writeText(path, before.replace(f.url, f.url + ".git"));
    await assert.rejects(store.getMaterial(first.id), /remoteUrl/);
  } finally { await f.close(); }
});

test("real git cancellation removes new partial directory, queued cancellation and fetch failure preserve existing clone", async () => {
  const f = await remoteFixture();
  try {
    const hold = await f.holdPack(), abort = new AbortController();
    const pending = f.port.cloneRemote(f.url, abort.signal); void pending.catch(() => {});
    await Promise.race([hold.arrived, pending.then(() => { throw new Error("clone bypassed hold"); })]);
    const waiting = new AbortController(), queued = f.port.cloneRemote(f.url, waiting.signal); waiting.abort(); await assert.rejects(queued, /停止/);
    abort.abort(); await assert.rejects(pending, /停止/);
    const target = join(f.repositories, "github.com/fixture/repository");
    await assert.rejects(access(target), { code: "ENOENT" });
    await hold.release();
    const binding = await f.port.cloneRemote(f.url);
    const secondAbort = new AbortController();
    const fetching = f.port.cloneRemote(f.url, secondAbort.signal); void fetching.catch(() => {});
    // A fetch with no changes need not invoke pack-objects, so cancel at the public boundary instead.
    secondAbort.abort(); await assert.rejects(fetching);
    assert.equal((await f.port.inspectRepository(target)).commitSha, binding.commitSha);
    await f.git("config", "--global", "--unset-all", `url.file://${f.remote}.insteadOf`);
    await f.git("config", "--global", `url.file://${join(f.root, "gone.git")}.insteadOf`, f.url);
    await assert.rejects(f.port.cloneRemote(f.url), /仓库操作失败/);
    assert.match((await f.port.readFile(target, binding.commitSha, "src/main.ts")).text, /before = 1/);
    const missing = "https://github.com/fixture/missing";
    await f.git("config", "--global", `url.file://${join(f.root, "absent.git")}.insteadOf`, missing);
    await assert.rejects(f.port.cloneRemote(missing), /does not appear to be a git repository|does not exist/);
    await assert.rejects(access(join(f.repositories, "github.com/fixture/missing")), { code: "ENOENT" });
  } finally { await f.close(); }
});
