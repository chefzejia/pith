import assert from "node:assert/strict";
import { join } from "node:path";
import { mkdir, rm } from "node:fs/promises";
import test, { type TestContext } from "node:test";
import { DefaultAttentionEngine, DefaultWorkspaceStore, libraryOverview, parseFrontmatter, stringifyFrontmatter, type Frontmatter } from "../src/core/index.ts";
import { LocalAcpGuideProvider, buildScenePrompt } from "../src/plugins/guide-acp/index.ts";
import { createScopedTools } from "../src/plugins/guide-acp/tools.ts";
import { NodeAgentProcessPort } from "../src/shells/web/nodeProcess.ts";
import { NodeToolServerPort } from "../src/shells/web/nodeToolServer.ts";
import { NodeWorkspaceStorage } from "../src/shells/web/nodeStorage.ts";
import { testSandbox } from "./sandbox.ts";
import { libraryAgent } from "./task67-acp-fixture.ts";

async function fixture(t: TestContext) {
  const root = await testSandbox("task67-");
  t.after(() => rm(root, { recursive: true, force: true }));
  const workspace = join(root, "workspace");
  await mkdir(workspace);
  const storage = new NodeWorkspaceStorage(workspace), store = new DefaultWorkspaceStore(storage);
  await store.ensureScaffold();
  const article = (title: string, name = "article.md") => store.importMaterial({ title, kind: "article", files: [{ name, mimeType: "text/markdown", bytes: new TextEncoder().encode(title) }] });
  const repo = (title: string, commit: string, remoteUrl?: string) => store.importMaterial({ title, kind: "repo", files: [], externalPath: join(root, title), commitSha: commit.repeat(40), remoteUrl });
  const topic = (title: string, materialIds: string[] = [], target = "Explain the mechanism") => store.createTopic({ title, target, materialIds, toolkits: [] });
  const tools = (topicId?: string) => createScopedTools({ topicId, store, storage, onChoices() {} });
  const update = async (path: string, fields: Frontmatter) => {
    const { attributes, body } = parseFrontmatter(await storage.readText(path));
    await storage.writeText(path, stringifyFrontmatter({ ...attributes, ...fields }, body));
  };
  return { root, workspace, storage, store, article, repo, topic, tools, update };
}

test("task67 overview matches the disk shape and the compass references", async t => {
  const f = await fixture(t);
  const old = await f.repo("Repo", "a", "https://github.com/fixture/repo");
  const latest = await f.repo("Repo", "b", "https://github.com/fixture/repo");
  const local = await f.repo("Local repo", "c");
  const article = await f.article("Reading");
  const exploring = await f.topic("Exploring", [old.id, article.id]);
  const shelved = await f.topic("Shelved", [old.id, latest.id]);
  await f.store.updateTopic(shelved.id, { status: "shelved" });
  await f.store.appendMaterialNote(article.id, { kind: "note", author: "user", body: "material record" });
  await f.store.appendTopicNote(exploring.id, { kind: "note", author: "guide", body: "guide record" });
  await f.store.appendTopicNote(exploring.id, { kind: "note", author: "user", body: "user record" });
  await f.store.appendTopicNote(exploring.id, { kind: "practice", author: "user", body: "practice record" });
  await f.store.appendTopicNote(exploring.id, { kind: "highlight", author: "user", body: "highlight" });
  await f.store.writeLesson(exploring.id, "01.md", "# Lesson");
  const day = (n: number) => new Date(Date.UTC(2025, 0, n)).toISOString();
  await f.update("materials/" + old.id + "/material.md", { createdAt: day(1) });
  await f.update("materials/" + latest.id + "/material.md", { createdAt: day(2) });
  await f.update("materials/" + local.id + "/material.md", { createdAt: day(8) });
  await f.update("materials/" + article.id + "/material.md", { createdAt: day(3), readingFile: "article.md", readingOpenedAt: day(7) });
  await f.update("topics/" + exploring.id + "/topic.md", { updatedAt: day(4) });
  await f.update("topics/" + shelved.id + "/topic.md", { updatedAt: day(6) });
  const [materials, topics] = await Promise.all([f.store.listMaterials(), f.store.listTopics()]);
  const overview = libraryOverview(materials, topics);
  const shelf = { id: shelved.id, title: shelved.title, status: "shelved" };
  const open = { id: exploring.id, title: exploring.title, status: "exploring" };
  assert.deepEqual(overview.materials.slice(0, 2), [
    { id: local.id, title: local.title, kind: "repo", createdAt: day(8), noteCount: 0, repository: { source: local.externalPath, commit: "c".repeat(40), latest: true }, topics: [] },
    { id: article.id, title: article.title, kind: "article", createdAt: day(3), lastOpenedAt: day(7), noteCount: 1, topics: [open] },
  ]);
  assert.deepEqual(overview.materials.find(item => item.id === old.id), {
    id: old.id, title: old.title, kind: "repo", createdAt: day(1), noteCount: 0,
    repository: { source: "https://github.com/fixture/repo", commit: "a".repeat(40), latest: false }, topics: [shelf, open],
  });
  assert.deepEqual(overview.materials.find(item => item.id === latest.id)?.topics, [shelf]);
  assert.equal(overview.materials.find(item => item.id === latest.id)?.repository?.latest, true);
  assert.deepEqual(overview.topics, [
    { ...shelf, target: shelved.target, materialIds: [old.id, latest.id], lessonCount: 0, userRecordCount: 0, updatedAt: day(6) },
    { ...open, target: exploring.target, materialIds: [old.id, article.id], lessonCount: 1, userRecordCount: 2, updatedAt: day(4) },
  ]);
  const compass = await new DefaultAttentionEngine(f.store, f.storage).compass();
  for (const item of compass.library) {
    assert.deepEqual(item.topicIds, overview.materials.find(entry => entry.id === item.material.id)!.topics.map(topic => topic.id));
  }
});

test("task67 library tool includes shelved topics in both scopes and matches titles or goals", async t => {
  const f = await fixture(t);
  const material = await f.article("Plugin boundaries");
  const shelved = await f.topic("A related question", [material.id], "How PLUGIN hosts load tools");
  await f.store.updateTopic(shelved.id, { status: "shelved" });
  const settled = await f.topic("Plugin lesson");
  await f.store.updateTopic(settled.id, { status: "settled" });
  await f.topic("Unrelated");
  const expected = libraryOverview(await f.store.listMaterials(), await f.store.listTopics());
  for (const scope of [undefined, shelved.id]) {
    const tool = f.tools(scope).find(tool => tool.name === "pith_list_library")!;
    assert.equal(tool.write, false);
    assert.deepEqual(await tool.execute({ keyword: "pLuGiN" }), {
      materials: expected.materials, topics: expected.topics.filter(item => [shelved.id, settled.id].includes(item.id)),
      materialTotal: 1, topicTotal: 2, truncated: false,
    });
    await assert.rejects(tool.execute({ keyword: " " }), /Invalid keyword/);
    await assert.rejects(tool.execute({ offset: -1 }), /Invalid offset/);
    await assert.rejects(tool.execute({ limit: 0 }), /Invalid limit/);
  }
});

test("task67 library pages each list independently and clamps to 200", async t => {
  const f = await fixture(t);
  for (let i = 0; i < 203; i++) {
    await f.store.importMaterial({ title: "Material " + i, kind: "article", files: [] });
    await f.topic("Topic " + i);
  }
  const expected = libraryOverview(await f.store.listMaterials(), await f.store.listTopics());
  const list = f.tools().find(tool => tool.name === "pith_list_library")!;
  assert.deepEqual(await list.execute({}), {
    materials: expected.materials.slice(0, 50), topics: expected.topics.slice(0, 50),
    materialTotal: 203, topicTotal: 203, truncated: true, nextOffset: 50,
  });
  assert.deepEqual(await list.execute({ limit: 900 }), {
    materials: expected.materials.slice(0, 200), topics: expected.topics.slice(0, 200),
    materialTotal: 203, topicTotal: 203, truncated: true, nextOffset: 200,
  });
  assert.deepEqual(await list.execute({ offset: 200 }), {
    materials: expected.materials.slice(200), topics: expected.topics.slice(200),
    materialTotal: 203, topicTotal: 203, truncated: false,
  });
});

test("task67 attach rejects another version and only updates the active topic", async t => {
  const f = await fixture(t);
  const first = await f.repo("Repository", "a"), second = await f.repo("Repository", "b");
  const other = await f.repo("Another repository", "c");
  const topic = await f.topic("This topic", [first.id]), unrelated = await f.topic("Other topic");
  const topicPath = "topics/" + topic.id + "/topic.md", original = await f.storage.readText(topicPath);
  const tool = f.tools(topic.id).find(tool => tool.name === "pith_attach_material")!;
  await assert.rejects(f.tools().find(tool => tool.name === "pith_attach_material")!.execute({ materialId: other.id }), /先创建课题/);
  let writes = 0;
  const begin = () => { writes++; };
  await assert.rejects(tool.execute({ materialId: second.id }, undefined, begin), /请在目录里点「改用」/);
  await assert.rejects(tool.execute({ materialId: first.id }, undefined, begin), /已引用/);
  await assert.rejects(tool.execute({ materialId: "unknown" }, undefined, begin), /Material not found/);
  await assert.rejects(tool.execute({ materialId: other.id, topicId: unrelated.id }, undefined, begin), /Invalid tool arguments/);
  await assert.rejects(tool.execute({ materialId: other.id }, AbortSignal.abort(), begin));
  assert.equal(writes, 0);
  assert.equal(await f.storage.readText(topicPath), original);
  const args = { materialId: other.id };
  const result = await tool.execute(args, undefined, begin);
  assert.equal(writes, 1);
  assert.deepEqual(await tool.effects!(result, args), [{ kind: "topic", topicId: topic.id }]);
  assert.deepEqual((await f.store.getTopic(topic.id))!.materialIds, [first.id, other.id]);
  assert.deepEqual((await f.store.getTopic(unrelated.id))!.materialIds, []);
  await f.store.updateTopic(topic.id, { status: "settled" });
  await assert.rejects(tool.execute(args), /已沉淀/);
});

test("task67 ACP scene bounds library entries and sends full details only for scoped materials", async t => {
  const f = await fixture(t);
  const brought = await f.article("Brought", "submitted-source.md");
  const privateToLibrary = await f.article("Library fixture", "unrelated-file-marker.md");
  await f.store.appendMaterialNote(privateToLibrary.id, { kind: "note", author: "user", body: "unrelated note body marker" });
  for (let i = 0; i < 51; i++) await f.article("Other material " + i);
  for (let i = 0; i < 22; i++) {
    const topic = await f.topic("Settled " + i);
    await f.store.updateTopic(topic.id, { status: "settled" });
  }
  const shelved = await f.topic("Shelved subject");
  await f.store.updateTopic(shelved.id, { status: "shelved" });
  const current = await f.topic("Exploring subject", [brought.id, privateToLibrary.id]);
  const agent = libraryAgent(f.workspace, f.store, f.storage, async () => "Fixture reply");
  const engine = new DefaultAttentionEngine(f.store, f.storage, () => agent.provider);
  assert.equal((await engine.intake({ text: "Question", materialIds: [brought.id] })).turn.status, "completed");
  const intake = agent.prompts[0]!;
  assert.match(intake, /# 材料（这次带来的）\n\[.*submitted-source\.md/);
  assert.doesNotMatch(intake, /unrelated-file-marker|unrelated note body marker/);
  const section = (prompt: string) => prompt.split("# 材料库与课题\n")[1]!.split("\n\n# 讲义")[0]!;
  const listing = section(intake);
  assert.match(listing, /材料 \(50\/53\).*"article":53/);
  assert.match(listing, /课题 \(22\/24\).*"exploring":1,"shelved":1,"settled":22/);
  assert.match(listing, /列表已截断.*pith_list_library/);
  const entries = listing.split("\n").filter(line => line.startsWith("{")).map(line => JSON.parse(line));
  const overview = libraryOverview(await f.store.listMaterials(), await f.store.listTopics());
  const latestSettled = overview.topics.filter(topic => topic.status === "settled").slice(0, 20);
  assert.deepEqual(entries, [
    ...overview.materials.slice(0, 50),
    ...overview.topics.filter(topic => topic.status !== "settled" || latestSettled.includes(topic)),
  ]);
  assert.equal((await engine.intake({ text: "Question only", materialIds: [] })).turn.status, "completed");
  assert.match(agent.prompts[1]!, /# 材料（这次带来的）\n\[\]/);
  const turn = await engine.runTurn({ topicId: current.id, text: "Continue" });
  assert.equal(turn.status, "completed", turn.error);
  assert.equal(section(agent.prompts[2]!), listing);
  assert.match(agent.prompts[2]!, /# 材料\n\[.*unrelated-file-marker\.md/);
  assert.match(agent.prompts[2]!, /unrelated note body marker/);
});

test("task67 a topic turn launches with an unrelated missing repository", { skip: process.platform !== "darwin" }, async t => {
  const f = await fixture(t);
  const referenced = await f.repo("Referenced", "a");
  const archived = await f.repo("Archived", "b");
  await mkdir(referenced.externalPath!);
  const topic = await f.topic("Normal topic", [referenced.id]);
  const script = [
    'const { createInterface } = require("node:readline");',
    'createInterface({ input: process.stdin }).on("line", line => {',
    '  const { id, method } = JSON.parse(line);',
    '  if (id === undefined) return;',
    '  const result = method === "initialize" ? { agentCapabilities: { mcpCapabilities: { http: true } } }',
    '    : method === "session/new" ? { sessionId: "sandboxed" }',
    '    : { stopReason: "end_turn", content: [{ type: "text", text: "Sandboxed topic reply" }] };',
    '  console.log(JSON.stringify({ jsonrpc: "2.0", id, result }));',
    '});',
  ].join("\n");
  const host = new NodeAgentProcessPort({ workspaceRoot: f.workspace });
  const provider = new LocalAcpGuideProvider({
    processPort: host, toolServer: new NodeToolServerPort(), store: f.store, storage: f.storage, buildScenePrompt,
    getAgentConfig: () => ({ agentId: "dsh" }),
    resolveDescriptor: async () => ({ id: "dsh", label: "Sandbox fixture", command: process.execPath, args: ["-e", script], available: true, version: null, note: "", pithToolTitlePrefix: "mcp__pith__" }),
  });
  const engine = new DefaultAttentionEngine(f.store, f.storage, () => provider);
  const turn = await engine.runTurn({ topicId: topic.id, text: "Normal question" });
  assert.equal(turn.status, "completed", turn.error);
  assert.ok(turn.steps.some(step => step.kind === "reply" && step.markdown === "Sandboxed topic reply"));
  assert.equal((await f.store.getMaterial(archived.id))!.externalPath, archived.externalPath);
  assert.deepEqual((await f.store.getTopic(topic.id))!.materialIds, [referenced.id]);
});

test("task67 the intake MCP endpoint can attach after creating a topic in the same turn", async t => {
  const f = await fixture(t);
  const material = await f.article("Library attachment");
  const agent = libraryAgent(f.workspace, f.store, f.storage, async (_scene, call) => {
    const args = { materialId: material.id };
    await assert.rejects(call("pith_attach_material", args), /先创建课题/);
    const topic = await call<{ id: string }>("pith_create_topic", { title: "New topic", target: "Learn a mechanism", materialIds: [], toolkits: [] });
    assert.deepEqual(await call("pith_attach_material", args), { topicId: topic.id, materialId: material.id });
    return "Attached";
  });
  const result = await new DefaultAttentionEngine(f.store, f.storage, () => agent.provider).intake({ text: "Start with the library", materialIds: [] });
  assert.equal(result.turn.status, "completed", result.turn.error);
  assert.deepEqual(result.topic?.materialIds, [material.id]);
});
