import { testToolkits } from "./guide-tools-fixture.ts";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { DefaultAttentionEngine, DefaultWorkspaceStore } from "../src/core/index.ts";
import { quickActionsForTopic } from "../src/plugins/guide-acp/index.ts";
import { createScopedTools } from "../src/plugins/guide-acp/tools.ts";
import { feynmanToolkit } from "../src/plugins/toolkit-feynman/index.ts";
import { interlineToolkit } from "../src/plugins/toolkit-interline/index.ts";
import { shadowingToolkit } from "../src/plugins/toolkit-shadowing/index.ts";
import { NodeAgentProcessPort } from "../src/shells/web/nodeProcess.ts";
import { NodeRepositoryPort } from "../src/shells/web/nodeRepository.ts";
import { NodeWorkspaceStorage } from "../src/shells/web/nodeStorage.ts";
import { createPithWebServer } from "../src/shells/web/server.ts";
import { testSandbox } from "./sandbox.ts";

const run = promisify(execFile);
async function createRepo(root: string) {
  const path = join(root, "repo"); await mkdir(path);
  const git = async (...args: string[]) => run("git", ["-C", path, ...args], { env: { PATH: process.env.PATH, HOME: root, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_AUTHOR_NAME: "Fixture", GIT_AUTHOR_EMAIL: "fixture@example.invalid", GIT_COMMITTER_NAME: "Fixture", GIT_COMMITTER_EMAIL: "fixture@example.invalid" } });
  await git("init", "-q"); await mkdir(join(path, "src"));
  await writeFile(join(path, "src/main.ts"), "first committed line\nsecond committed line\nthird\n");
  await writeFile(join(path, "long.txt"), "x".repeat(13000));
  await writeFile(join(path, "binary.bin"), Buffer.from([1, 0, 2]));
  await writeFile(join(path, "invalid.txt"), Buffer.from([0xff]));
  await writeFile(join(path, "large.txt"), Buffer.alloc(256 * 1024 + 1, 65));
  await symlink("src/main.ts", join(path, "link"));
  await git("add", "."); await git("commit", "-qm", "fixture");
  const commit = (await git("rev-parse", "HEAD")).stdout.trim();
  await git("update-index", "--add", "--cacheinfo", `160000,${commit},nested`); await git("commit", "-qm", "submodule fixture");
  await writeFile(join(path, "src/main.ts"), "DIRTY NOT COMMITTED\n"); await writeFile(join(path, "untracked.txt"), "PRIVATE\n");
  return { path, git };
}

test("repository port reads only bounded ordinary UTF-8 files in the pinned commit", async () => {
  const root = await testSandbox("pith-task32-repo-");
  try {
    const repo = await createRepo(root), port = new NodeRepositoryPort();
    const binding = await port.inspectRepository(join(repo.path, "src")); assert.equal(binding.externalPath, repo.path); assert.equal(binding.title, "repo"); assert.match(binding.commitSha, /^[a-f0-9]{40,64}$/);
    await repo.git("add", "src/main.ts"); await repo.git("commit", "-qm", "later commit"); await writeFile(join(repo.path, "src/main.ts"), "NEW DIRTY CONTENT\n");
    const marker = join(root, "external-command-ran");
    await repo.git("config", "core.fsmonitor", `touch ${marker}`);
    const first = await port.listFiles(binding.externalPath, binding.commitSha, 0, 2);
    const second = await port.listFiles(binding.externalPath, binding.commitSha, first.nextOffset!, 100);
    const files = [...first.files, ...second.files]; assert.equal(first.total, files.length); assert.equal(second.nextOffset, null);
    assert.ok(files.includes("src/main.ts")); for (const forbidden of ["link", "nested", "untracked.txt"]) assert.ok(!files.includes(forbidden));
    const excerpt = await port.readFile(binding.externalPath, binding.commitSha, "src/main.ts", 2, 1);
    assert.deepEqual({ text: excerpt.text, start: excerpt.startLine, end: excerpt.endLine, truncated: excerpt.truncated }, { text: "second committed line", start: 2, end: 2, truncated: true });
    assert.equal(excerpt.commitSha, binding.commitSha);
    for (const path of ["./src/main.ts", "src/./main.ts", "./src/./main.ts"]) {
      const relative = await port.readFile(binding.externalPath, binding.commitSha, path, 2, 1);
      assert.equal(relative.text, "second committed line");
    }
    assert.equal((await port.readFile(binding.externalPath, binding.commitSha, "long.txt")).text.length, 13000);
    assert.equal((await port.readFile(binding.externalPath, binding.commitSha, "long.txt")).truncated, false);
    for (const path of ["link", "nested", "untracked.txt", "../src/main.ts", "src/../src/main.ts", "./../src/main.ts", "/etc/passwd", "C:/src/main.ts", "src\\main.ts", "binary.bin", "invalid.txt", "large.txt"]) await assert.rejects(port.readFile(binding.externalPath, binding.commitSha, path), path);
    for (const [offset, limit] of [[-1, 1], [0, 0], [0, 1001], [1.5, 1]]) await assert.rejects(port.listFiles(binding.externalPath, binding.commitSha, offset, limit));
    await assert.rejects(port.readFile(binding.externalPath, binding.commitSha, "src/main.ts", 0));
    await assert.rejects(port.listFiles(binding.externalPath, "HEAD"));
    await assert.rejects(port.listFiles(join(binding.externalPath, "src"), binding.commitSha));
    await assert.rejects(readFile(marker), { code: "ENOENT" });
    assert.equal(await readFile(join(repo.path, "src/main.ts"), "utf8"), "NEW DIRTY CONTENT\n");
    assert.equal(await readFile(join(repo.path, "untracked.txt"), "utf8"), "PRIVATE\n");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("scoped repository tools read the pinned commit and reject other materials", async () => {
  const root = await testSandbox("pith-task32-scope-");
  try {
    const repo = await createRepo(root), repository = new NodeRepositoryPort(), binding = await repository.inspectRepository(repo.path);
    await mkdir(join(root, "workspace"));
    const storage = new NodeWorkspaceStorage(join(root, "workspace")), store = new DefaultWorkspaceStore(storage); await store.ensureScaffold();
    const material = await store.importMaterial({ title: "代码", kind: "repo", files: [], externalPath: binding.externalPath, commitSha: binding.commitSha });
    const other = await store.importMaterial({ title: "其他", kind: "repo", files: [], externalPath: binding.externalPath, commitSha: binding.commitSha });
    const topic = await store.createTopic({ title: "读源码", target: "理解入口", materialIds: [material.id], toolkits: [] });
    const tools = createScopedTools({ toolkits: testToolkits, topicId: topic.id, store, storage, repository, onChoices: () => {} });
    const call = (name: string, args: Record<string, unknown>) => tools.find(tool => tool.name === name)!.execute(args);
    const listed = await call("pith_list_material", { materialId: material.id }) as { files: string[] };
    assert.ok(listed.files.includes("src/main.ts")); assert.ok(!listed.files.includes("untracked.txt"));
    const excerpt = await call("pith_read_material", { materialId: material.id, file: "src/main.ts", startLine: 1 }) as { text: string };
    assert.match(excerpt.text, /first committed line/); assert.doesNotMatch(excerpt.text, /DIRTY NOT COMMITTED/);
    await assert.rejects(call("pith_read_material", { materialId: other.id, file: "src/main.ts" }), /does not belong/);
    await assert.rejects(call("pith_read_material", { materialId: material.id, file: "../src/main.ts" }));
    await call("pith_write_lesson", { fileName: "00-课程大纲.md", markdown: "# 大纲" });
    assert.equal(await store.readLesson(topic.id, "00-课程大纲.md"), "# 大纲");
    await assert.rejects(call("pith_write_lesson", { topicId: topic.id, fileName: "bad.md", markdown: "x" }));
    assert.equal(quickActionsForTopic(topic, []).at(0)?.id, "plan-curriculum");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("lesson tool writes to a topic without creating a material", async () => {
  const root = await testSandbox("pith-task32-lesson-");
  try {
    const storage = new NodeWorkspaceStorage(root), store = new DefaultWorkspaceStore(storage); await store.ensureScaffold();
    const topic = await store.createTopic({ title: "课题", target: "学习" , materialIds: [], toolkits: [] });
    const lesson = createScopedTools({ toolkits: testToolkits, topicId: topic.id, store, storage, onChoices: () => {} }).find(tool => tool.name === "pith_write_lesson")!;
    await lesson.execute({ fileName: "00-课程大纲.md", markdown: "# 大纲" });
    const updated = await store.getTopic(topic.id); assert.deepEqual(updated?.materialIds, []);
    assert.equal(await store.readLesson(topic.id, "00-课程大纲.md"), "# 大纲");
    await assert.rejects(lesson.execute({ fileName: "../bad.md", markdown: "x" }));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("existing Web topic shows the curriculum quick action", { timeout: 30000, skip: !process.env.PITH_PLAYWRIGHT_MODULE || !process.env.PITH_CHROME_PATH }, async () => {
  const root = await testSandbox("pith-task32-browser-");
  const server = await createPithWebServer({ workspaceDir: root, guideProvider: { async run() { return { status: "completed" }; } } });
  const address = server.address(); assert.ok(address && typeof address !== "string"); const base = `http://127.0.0.1:${address.port}`;
  const { chromium } = await import(process.env.PITH_PLAYWRIGHT_MODULE!); let browser: any;
  try {
    const store = new DefaultWorkspaceStore(new NodeWorkspaceStorage(root));
    const topic = await store.createTopic({ title: "理解代码仓库", target: "从入口建立课程主线", materialIds: [], toolkits: [] });
    browser = await chromium.launch({ executablePath: process.env.PITH_CHROME_PATH, headless: true }); const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto(base); await page.locator(`[data-topic="${topic.id}"]`).first().click(); await page.locator(".pith-guide-toggle").click();
    await page.getByRole("button", { name: "规划课程大纲与第一讲" }).waitFor();
    const evidence = resolve(`${process.env.PITH_TEST_SCREENSHOT_DIR}/task-32`); await mkdir(evidence, { recursive: true }); await page.screenshot({ path: join(evidence, "web-curriculum-action.png") });
  } finally { if (browser) await browser.close(); await new Promise<void>((ok, fail) => server.close(error => error ? fail(error) : ok())); await rm(root, { recursive: true, force: true }); }
});
