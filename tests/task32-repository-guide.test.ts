import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { DefaultAttentionEngine, DefaultWorkspaceStore } from "../src/core/index.ts";
import { buildScenePrompt, createGuideWorkspaceTools, LocalAcpGuideProvider, quickActionsForTopic } from "../src/plugins/guide-acp/index.ts";
import { feynmanToolkit } from "../src/plugins/dojo-feynman/index.ts";
import { interlineToolkit } from "../src/plugins/dojo-interline/index.ts";
import { shadowingToolkit } from "../src/plugins/dojo-shadowing/index.ts";
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
    assert.equal((await port.readFile(binding.externalPath, binding.commitSha, "long.txt")).text.length, 12000);
    assert.equal((await port.readFile(binding.externalPath, binding.commitSha, "long.txt")).truncated, true);
    for (const path of ["link", "nested", "untracked.txt", "../src/main.ts", "/etc/passwd", "src\\main.ts", "binary.bin", "invalid.txt", "large.txt"]) await assert.rejects(port.readFile(binding.externalPath, binding.commitSha, path), path);
    for (const [offset, limit] of [[-1, 1], [0, 0], [0, 1001], [1.5, 1]]) await assert.rejects(port.listFiles(binding.externalPath, binding.commitSha, offset, limit));
    await assert.rejects(port.readFile(binding.externalPath, binding.commitSha, "src/main.ts", 0));
    await assert.rejects(port.listFiles(binding.externalPath, "HEAD"));
    await assert.rejects(port.listFiles(join(binding.externalPath, "src"), binding.commitSha));
    await assert.rejects(readFile(marker), { code: "ENOENT" });
    assert.equal(await readFile(join(repo.path, "src/main.ts"), "utf8"), "NEW DIRTY CONTENT\n");
    assert.equal(await readFile(join(repo.path, "untracked.txt"), "utf8"), "PRIVATE\n");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("lesson tool creates and binds material only for a topic without one", async () => {
  const root = await testSandbox("pith-task32-lesson-");
  try {
    const storage = new NodeWorkspaceStorage(root), store = new DefaultWorkspaceStore(storage); await store.ensureScaffold();
    const topic = await store.createTopic({ title: "课题", target: "学习" });
    const tools = createGuideWorkspaceTools(store, new DefaultAttentionEngine(store, storage), storage);
    const lesson = tools.find(item => item.name === "pith_write_lesson")!;
    await lesson.execute({ topicId: topic.id, fileName: "00-课程大纲.md", markdown: "# 大纲" });
    const updated = await store.getTopic(topic.id); assert.ok(updated?.materialId);
    assert.equal(await storage.readText(`materials/${updated.materialId}/files/00-课程大纲.md`), "# 大纲");
    await lesson.execute({ materialId: updated.materialId, fileName: "01-first.md", markdown: "# First" });
    await assert.rejects(lesson.execute({ topicId: topic.id, materialId: "other", fileName: "02.md", markdown: "x" }));
    await assert.rejects(lesson.execute({ topicId: topic.id, fileName: "../bad.md", markdown: "x" }));
    assert.equal(quickActionsForTopic(topic, []).at(0)?.id, "plan-curriculum");
    assert.equal(quickActionsForTopic({ ...updated, material: await store.getMaterial(updated.materialId) }, []).at(0)?.id, "orient");
    assert.equal(interlineToolkit.uiProtocol, "interline-subtitle"); assert.equal(shadowingToolkit.uiProtocol, "inline-stage-lens"); assert.equal(feynmanToolkit.uiProtocol, "inline-stage-lens");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("real ACP process reads repository twice before writing lesson and toolkits", async () => {
  const root = await testSandbox("pith-task32-acp-");
  try {
    const repo = await createRepo(root), repository = new NodeRepositoryPort(), binding = await repository.inspectRepository(repo.path);
    await mkdir(join(root, "workspace"));
    const storage = new NodeWorkspaceStorage(join(root, "workspace")), store = new DefaultWorkspaceStore(storage); await store.ensureScaffold();
    const material = await store.importMaterial({ title: "代码", kind: "repo", files: [], externalPath: binding.externalPath, commitSha: binding.commitSha });
    const topic = await store.createTopic({ title: "读源码", target: "理解入口", materialId: material.id });
    const state = join(root, "calls.json"), script = join(root, "agent.cjs");
    const tool = (name: string, args: object) => `\`\`\`pith-tool\n${JSON.stringify({ name, arguments: args })}\n\`\`\``;
    const responses = [tool("pith_list_repository_files", { materialId: material.id }), tool("pith_read_repository_file", { materialId: material.id, path: "src/main.ts" }), `已生成。\n${tool("pith_write_lesson", { topicId: topic.id, fileName: "00-课程大纲.md", markdown: `# 大纲\n${binding.commitSha} src/main.ts:1` })}\n\`\`\`pith-toolkits\n["feynman"]\n\`\`\`\n\`\`\`pith-choices\n第一讲\n查看源码\n\`\`\``];
    await writeFile(script, `const fs=require('node:fs'), readline=require('node:readline'); const state=${JSON.stringify(state)}, responses=${JSON.stringify(responses)}; const rl=readline.createInterface({input:process.stdin}); rl.on('line', line=>{const m=JSON.parse(line); if(!m.id)return; let result={}; if(m.method==='initialize') result={protocolVersion:1}; if(m.method==='session/new') result={sessionId:'fixture'}; if(m.method==='session/prompt'){let calls=fs.existsSync(state)?JSON.parse(fs.readFileSync(state,'utf8')):[]; calls.push(m.params.prompt[0].text); fs.writeFileSync(state,JSON.stringify(calls)); result={text:responses[calls.length-1],stopReason:'end_turn'};} process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result})+'\\n');});`);
    const provider = new LocalAcpGuideProvider({ processPort: new NodeAgentProcessPort(), store, storage, engine: new DefaultAttentionEngine(store, storage), repository, getToolkits: () => [feynmanToolkit, interlineToolkit, shadowingToolkit], getAgentConfig: () => ({ agentId: "fixture", cwd: root }), resolveDescriptor: async () => ({ id: "fixture", label: "Fixture", command: process.execPath, args: [script], version: "1", note: "", available: true }), buildScenePrompt });
    const result = await provider.reply({ topicId: topic.id, conversation: [{ id: "1", role: "user", text: "规划课程", createdAt: new Date().toISOString() }] });
    const calls = JSON.parse(await readFile(state, "utf8")) as string[];
    assert.equal(calls.length, 3); assert.match(calls[1]!, /src\/main\.ts/); assert.match(calls[2]!, /first committed line/); assert.doesNotMatch(calls[2]!, /DIRTY NOT COMMITTED/);
    assert.match(result, /pith-choices/); assert.deepEqual((await store.getTopic(topic.id))!.toolkits, ["feynman"]);
    assert.match(await storage.readText(`materials/${material.id}/files/00-课程大纲.md`), /src\/main\.ts:1/);
    assert.equal(quickActionsForTopic({ ...topic, material }, []).at(0)?.id, "plan-curriculum");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("ACP read loop stops after four calls and rejects a foreign material", async () => {
  const root = await testSandbox("pith-task32-limit-");
  try {
    const storage = new NodeWorkspaceStorage(root), store = new DefaultWorkspaceStore(storage); await store.ensureScaffold();
    const topic = await store.createTopic({ title: "Loop" });
    const repo = await createRepo(root), repository = new NodeRepositoryPort(), binding = await repository.inspectRepository(repo.path);
    const other = await store.importMaterial({ title: "Other", kind: "repo", files: [], externalPath: binding.externalPath, commitSha: binding.commitSha });
    const script = join(root, "agent.cjs"), log = join(root, "calls");
    const read = `\`\`\`pith-tool\n${JSON.stringify({ name: "pith_get_context", arguments: { topicId: topic.id } })}\n\`\`\``;
    const foreign = `\`\`\`pith-tool\n${JSON.stringify({ name: "pith_read_repository_file", arguments: { materialId: other.id, path: "src/main.ts" } })}\n\`\`\``;
    await writeFile(script, `const fs=require('node:fs'),rl=require('node:readline').createInterface({input:process.stdin}); rl.on('line',line=>{const m=JSON.parse(line);if(!m.id)return;let result={};if(m.method==='session/new')result={sessionId:'fixture'};if(m.method==='session/prompt'){fs.appendFileSync(${JSON.stringify(log)},'x');result={text:process.argv[2]==='loop'?${JSON.stringify(read)}:${JSON.stringify(foreign)}};}process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result})+'\\n');});`);
    const make = (mode: string) => new LocalAcpGuideProvider({ processPort: new NodeAgentProcessPort(), store, storage, repository, engine: new DefaultAttentionEngine(store, storage), getAgentConfig: () => ({ agentId: "fixture", cwd: root }), resolveDescriptor: async () => ({ id: "fixture", label: "Fixture", command: process.execPath, args: [script, mode], version: "1", note: "", available: true }), buildScenePrompt });
    const input = { topicId: topic.id, conversation: [] };
    await assert.rejects(make("loop").reply(input), /four-turn/); assert.equal(await readFile(log, "utf8"), "xxxx");
    await assert.rejects(make("foreign").reply(input), /outside the current session/); assert.equal(await readFile(log, "utf8"), "xxxxx");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("existing Web topic shows the curriculum quick action", { timeout: 30000, skip: !process.env.PITH_PLAYWRIGHT_MODULE || !process.env.PITH_CHROME_PATH }, async () => {
  const root = await testSandbox("pith-task32-browser-");
  const server = await createPithWebServer({ workspaceDir: root });
  const address = server.address(); assert.ok(address && typeof address !== "string"); const base = `http://127.0.0.1:${address.port}`;
  const { chromium } = await import(process.env.PITH_PLAYWRIGHT_MODULE!); let browser: any;
  try {
    const created = await fetch(`${base}/api/topics`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: "理解代码仓库", target: "从入口建立课程主线" }) });
    assert.equal(created.status, 201); const topic = await created.json() as { id: string };
    browser = await chromium.launch({ executablePath: process.env.PITH_CHROME_PATH, headless: true }); const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto(base); await page.locator(`[data-topic="${topic.id}"]`).first().click(); await page.locator(".pith-guide-toggle").click();
    await page.getByRole("button", { name: "规划课程大纲与第一讲" }).waitFor();
    const evidence = resolve(".tmp/evidence/task-32"); await mkdir(evidence, { recursive: true }); await page.screenshot({ path: join(evidence, "web-curriculum-action.png") });
  } finally { if (browser) await browser.close(); await new Promise<void>((ok, fail) => server.close(error => error ? fail(error) : ok())); await rm(root, { recursive: true, force: true }); }
});
