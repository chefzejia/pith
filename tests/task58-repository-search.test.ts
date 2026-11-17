import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { DefaultWorkspaceStore, type RepositoryPort, type TurnStep } from "../src/core/index.ts";
import { buildScenePrompt } from "../src/plugins/guide-acp/index.ts";
import { openTurnTools } from "../src/plugins/guide-acp/mcpTools.ts";
import { createScopedTools } from "../src/plugins/guide-acp/tools.ts";
import { createDshPluginBundle } from "../src/shells/dsh/index.ts";
import { NodeRepositoryPort } from "../src/shells/web/nodeRepository.ts";
import { NodeWorkspaceStorage } from "../src/shells/web/nodeStorage.ts";
import { NodeToolServerPort } from "../src/shells/web/nodeToolServer.ts";
import { testSandbox } from "./sandbox.ts";

const run = promisify(execFile);
type SearchResult = Awaited<ReturnType<RepositoryPort["searchFiles"]>>;
async function fixture() {
  const root = await testSandbox("pith-task58-");
  try {
  const path = join(root, "repo"), port = new NodeRepositoryPort();
  await mkdir(join(path, "src"), { recursive: true });
  const git = async (...args: string[]) => (await run("git", ["-C", path, ...args], { env: { PATH: process.env.PATH, HOME: root, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_AUTHOR_NAME: "Fixture", GIT_AUTHOR_EMAIL: "fixture@example.invalid", GIT_COMMITTER_NAME: "Fixture", GIT_COMMITTER_EMAIL: "fixture@example.invalid" } })).stdout.trim();
  await git("init", "-q");
  const source = "// 插件注册入口\r\nexport function registerPlugin() {}\r\nregisterPlugin();\r\nREGISTERPLUGIN();\r\nconst literal = 'a.b';\r\nconst wildcard = 'axb';\r\n";
  await writeFile(join(path, "src/main.ts"), source);
  await writeFile(join(path, "src/名称 [*]:文件.ts"), "中文调用：注册插件\n");
  await writeFile(join(path, "binary.bin"), Buffer.from("BINARY_ONLY\0\n"));
  await writeFile(join(path, "invalid.txt"), Buffer.concat([Buffer.from("INVALID_ONLY\n"), Buffer.from([0xff])]));
  await writeFile(join(path, "large.txt"), "LARGE_ONLY\n" + "x".repeat(256 * 1024));
  await writeFile(join(path, "boundary.txt"), "BOUNDARY_ONLY\n" + "x".repeat(256 * 1024 - 14));
  await writeFile(join(path, "many.txt"), Array.from({ length: 205 }, (_, i) => `hit ${i + 1}`).join("\n"));
  await writeFile(join(path, "long.txt"), "LONG_ONLY " + "😀".repeat(400));
  await writeFile(join(path, "empty-lines.txt"), Buffer.alloc(256 * 1024, 10));
  await symlink("src/main.ts", join(path, "alias.ts"));
  await git("add", "."); await git("commit", "-qm", "search fixture");
  const first = await git("rev-parse", "HEAD");
  await git("update-index", "--add", "--cacheinfo", `160000,${first},submodule`); await git("commit", "-qm", "gitlink");
  const binding = await port.inspectRepository(path);
  await writeFile(join(path, "src/main.ts"), "LATER_COMMIT_ONLY\n");
  await git("add", "src/main.ts"); await git("commit", "-qm", "later");
  await writeFile(join(path, "src/main.ts"), "DIRTY_ONLY\n"); await writeFile(join(path, "untracked.txt"), "UNTRACKED_ONLY\n");
  await mkdir(join(root, "workspace"));
  const storage = new NodeWorkspaceStorage(join(root, "workspace")), store = new DefaultWorkspaceStore(storage);
  await store.ensureScaffold();
  const material = await store.importMaterial({ title: "仓库", kind: "repo", files: [], externalPath: path, commitSha: binding.commitSha });
  const other = await store.importMaterial({ title: "未引用", kind: "repo", files: [], externalPath: path, commitSha: first });
  const article = await store.importMaterial({ title: "普通文档", kind: "article", files: [{ name: "a.md", bytes: new TextEncoder().encode("article") }] });
  const topic = await store.createTopic({ title: "插件入口", target: "理解注册", materialIds: [material.id, article.id], toolkits: [] });
  const search = (query: Parameters<RepositoryPort["searchFiles"]>[2]) => port.searchFiles(path, binding.commitSha, query);
  const tools = createScopedTools({ store, storage, repository: port, topicId: topic.id, onChoices() {} });
  return { root, path, port, binding, git, source, storage, store, material, other, article, topic, tools, search, close: () => rm(root, { recursive: true, force: true }) };
  } catch (error) { await rm(root, { recursive: true, force: true }); throw error; }
}

test("repository search uses pinned UTF-8 blobs, literal/case options and real line numbers", async () => {
  const f = await fixture();
  try {
    const result = await f.search({ pattern: "registerPlugin" });
    assert.deepEqual(result, { matches: [
      { path: "src/main.ts", line: 2, text: "export function registerPlugin() {}" },
      { path: "src/main.ts", line: 3, text: "registerPlugin();" },
      { path: "src/main.ts", line: 4, text: "REGISTERPLUGIN();" },
    ], truncated: false });
    assert.equal((await f.search({ pattern: "registerPlugin", caseSensitive: true })).matches.length, 2);
    assert.deepEqual((await f.search({ pattern: "a.b", caseSensitive: true })).matches.map(match => match.line), [5]);
    assert.deepEqual((await f.search({ pattern: "a.b", regex: true, caseSensitive: true, pathPrefix: "./src/" })).matches.map(match => match.line), [5, 6]);
    for (const pattern of ["LATER_COMMIT_ONLY", "DIRTY_ONLY", "UNTRACKED_ONLY"]) assert.deepEqual(await f.search({ pattern }), { matches: [], truncated: false });
    assert.deepEqual((await f.search({ pattern: "注册插件", pathPrefix: "./src/./名称 [*]:" })).matches, [{ path: "src/名称 [*]:文件.ts", line: 1, text: "中文调用：注册插件" }]);
    assert.equal(await readFile(join(f.path, "src/main.ts"), "utf8"), "DIRTY_ONLY\n");
  } finally { await f.close(); }
});

test("repository search skips NUL binary blobs", async () => {
  const f = await fixture();
  try { assert.deepEqual(await f.search({ pattern: "BINARY_ONLY" }), { matches: [], truncated: false }); }
  finally { await f.close(); }
});

test("repository search skips invalid UTF-8, oversized blobs, symlinks and gitlinks", async () => {
  const f = await fixture();
  try {
    for (const pattern of ["INVALID_ONLY", "LARGE_ONLY"]) assert.deepEqual(await f.search({ pattern }), { matches: [], truncated: false });
    for (const pathPrefix of ["alias.ts", "submodule/"]) assert.deepEqual(await f.search({ pattern: "registerPlugin", pathPrefix }), { matches: [], truncated: false });
    assert.equal((await f.search({ pattern: "BOUNDARY_ONLY" })).matches[0]?.path, "boundary.txt");
  } finally { await f.close(); }
});

test("repository search bounds result counts and Unicode text and reports exact truncation", async () => {
  const f = await fixture();
  try {
    for (const [limit, count, truncated] of [[undefined, 50, true], [200, 200, true], [1, 1, true]] as const) {
      const result = await f.search({ pattern: "hit ", limit });
      assert.equal(result.matches.length, count); assert.equal(result.truncated, truncated);
    }
    assert.equal((await f.search({ pattern: "^hit (1|2)$", regex: true, limit: 2 })).truncated, false);
    const text = (await f.search({ pattern: "LONG_ONLY" })).matches[0]!.text;
    assert.equal(Array.from(text).length, 300); assert.equal(text, "LONG_ONLY " + "😀".repeat(290));
    assert.deepEqual(await f.search({ pattern: "no such line" }), { matches: [], truncated: false });
    assert.deepEqual(await f.search({ pattern: "^$", regex: true, pathPrefix: "empty-lines.txt", limit: 1 }), { matches: [{ path: "empty-lines.txt", line: 1, text: "" }], truncated: true });
  } finally { await f.close(); }
});

test("repository search rejects limits above 200", async () => {
  const f = await fixture();
  try { await assert.rejects(f.search({ pattern: "hit", limit: 201 }), /limit.*200/); }
  finally { await f.close(); }
});

test("repository search rejects parent path segments", async () => {
  const f = await fixture();
  try {
    for (const pathPrefix of ["../", "src/../src/", "./../src"]) await assert.rejects(f.search({ pattern: "registerPlugin", pathPrefix }), /pathPrefix/);
  } finally { await f.close(); }
});

test("repository search uses extended regex and returns invalid regex and binding reasons", async () => {
  const f = await fixture();
  try {
    assert.deepEqual((await f.search({ pattern: "^register[[:alpha:]]+\\(\\);[[:space:]]*$", regex: true, caseSensitive: true })).matches.map(match => match.line), [3]);
    for (const pathPrefix of [undefined, "absent/"]) await assert.rejects(f.search({ pattern: "[", regex: true, pathPrefix }), /仓库搜索失败.*(expression|bracket|正则|括号)/i);
    for (const pathPrefix of ["/src", "C:/src", "src\\main"]) await assert.rejects(f.search({ pattern: "x", pathPrefix }), /pathPrefix/);
    for (const limit of [0, -1, 1.5]) await assert.rejects(f.search({ pattern: "x", limit }), /limit/);
    await assert.rejects(f.port.searchFiles(f.path, "HEAD", { pattern: "x" }), /绑定/);
    const marker = join(f.root, "hook-must-not-run"); await f.git("config", "core.fsmonitor", `touch ${marker}`);
    assert.equal((await f.search({ pattern: "registerPlugin" })).matches.length, 3);
    await assert.rejects(readFile(marker), { code: "ENOENT" });
  } finally { await f.close(); }
});

test("MCP repository search rejects unreferenced topic materials but intake can search the library", async () => {
  const f = await fixture();
  try {
    const topicSearch = f.tools.find(tool => tool.name === "pith_search_material")!;
    const intake = createScopedTools({ store: f.store, storage: f.storage, repository: f.port, materialIds: [], onChoices() {} });
    const intakeSearch = intake.find(tool => tool.name === "pith_search_material")!;
    assert.equal((await intakeSearch.execute({ materialId: f.other.id, pattern: "registerPlugin" }) as SearchResult).matches.length, 3);
    await assert.rejects(topicSearch.execute({ materialId: f.other.id, pattern: "registerPlugin" }), /does not belong to scope/);
  } finally { await f.close(); }
});

test("real MCP HTTP lists and executes search, records steps and preserves error reasons", async () => {
  const f = await fixture(); let endpoint: Awaited<ReturnType<typeof openTurnTools>> | undefined;
  try {
    const steps: TurnStep[] = []; let sequence = 0;
    endpoint = await openTurnTools(new NodeToolServerPort(), f.tools, new AbortController().signal, (step, index) => { steps[index] = step; }, () => steps.length);
    const call = async (method: string, params: unknown) => (await fetch(endpoint!.endpoint.url, { method: "POST", headers: { "content-type": "application/json", ...Object.fromEntries(endpoint!.endpoint.headers.map(header => [header.name, header.value])) }, body: JSON.stringify({ jsonrpc: "2.0", id: ++sequence, method, params }) })).json();
    const listing = await call("tools/list", {});
    const definition = listing.result.tools.find((tool: { name: string }) => tool.name === "pith_search_material");
    assert.ok(definition); assert.deepEqual(definition.inputSchema.required, ["materialId", "pattern"]);
    assert.equal(definition.inputSchema.properties.limit.maximum, 200);
    const response = await call("tools/call", { name: definition.name, arguments: { materialId: f.material.id, pattern: "插件", pathPrefix: "src/", limit: 1 } });
    assert.deepEqual(JSON.parse(response.result.content[0].text), { matches: [{ path: "src/main.ts", line: 1, text: "// 插件注册入口" }], truncated: true });
    assert.ok(steps.some(step => step.kind === "tool" && step.name === "pith_search_material" && step.status === "completed"));
    for (const args of [{ materialId: f.material.id, pattern: "[", regex: true }, { materialId: f.article.id, pattern: "x" }, { materialId: f.material.id, pattern: "x", topicId: f.topic.id }, { materialId: f.material.id, pattern: "x", regex: "true" }]) {
      const failed = await call("tools/call", { name: definition.name, arguments: args });
      assert.equal(failed.result.isError, true); assert.ok(failed.result.content[0].text.length > 0);
    }
    const failed = steps.filter(step => step.kind === "tool" && step.status === "failed"); assert.equal(failed.length, 4);
    assert.deepEqual((await f.store.getTopic(f.topic.id))!.notes, []);
  } finally { if (endpoint) { await endpoint.drain(); await endpoint.endpoint.close(); } await f.close(); }
});

test("DSH shell exposes the same search tool and bound snapshot", async () => {
  const f = await fixture();
  try {
    const tool = createDshPluginBundle({ storage: f.storage }).tools.find(tool => tool.name === "pith_search_material")!;
    assert.ok(tool);
    assert.equal((await tool.execute({ topicId: f.topic.id, materialId: f.material.id, pattern: "registerPlugin", caseSensitive: true }) as SearchResult).matches.length, 2);
    const prompt = buildScenePrompt({ profileMarkdown: "", topic: f.topic, materials: [f.material], userMessage: "找定义和调用点" });
    assert.match(prompt, /先用 pith_search_material 搜索，再用 pith_read_material 读具体行/);
  } finally { await f.close(); }
});
