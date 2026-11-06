import assert from "node:assert/strict";
import test from "node:test";
import { DefaultWorkspaceStore } from "../src/core/index.ts";
import { buildScenePrompt, createGuideWorkspaceTools } from "../src/plugins/guide-acp/index.ts";
import { NodeWorkspaceStorage } from "../src/shells/web/nodeStorage.ts";
import { testSandbox } from "./sandbox.ts";

class FaultStorage extends NodeWorkspaceStorage {
  writes: string[] = [];
  failAt = 0;
  override async writeText(path: string, data: string): Promise<void> {
    this.writes.push(path);
    if (this.writes.length === this.failAt) throw new Error("injected write failure");
    await super.writeText(path, data);
  }
}

async function fixture(withNote = true) {
  const storage = new FaultStorage(await testSandbox("task19-settlement-"));
  const store = new DefaultWorkspaceStore(storage);
  await store.ensureScaffold();
  await store.writeProfile("# Original profile");
  const topic = await store.createTopic({ id: "topic-one", title: "Topic" });
  if (withNote) await store.appendNote(topic.id, { kind: "practice", body: "Learner observation" });
  storage.writes = [];
  const tool = createGuideWorkspaceTools(store, undefined).find(item => item.name === "pith_settle_topic")!;
  return { storage, store, topic, tool };
}

test("settlement writes profile then note and status, preserving Topic return and prompt contract", async () => {
  const { storage, store, topic, tool } = await fixture();
  const schema = tool.inputSchema as { properties: Record<string, unknown>; required: string[] };
  assert.deepEqual(schema.properties.profilePatchMarkdown, { type: "string", minLength: 1, maxLength: 100000 });
  assert.equal(schema.required.includes("profilePatchMarkdown"), false);
  const prompt = buildScenePrompt({ profileMarkdown: "# Original profile", topic: (await store.getTopic(topic.id))!, userMessage: "Explain" });
  assert.match(prompt, /profilePatchMarkdown/);
  assert.match(prompt, /完整 ME\.md/);
  const settled = await tool.execute({ topicId: topic.id, verificationSummary: "Applied insight", profilePatchMarkdown: "# Updated profile\n\nNew insight" }) as Awaited<ReturnType<typeof store.updateTopic>>;
  assert.equal(settled.id, topic.id);
  assert.equal(settled.status, "settled");
  assert.equal(settled.notes[1]!.body, "## 核心认知总结\n\nApplied insight");
  assert.equal(await storage.readText("ME.md"), "# Updated profile\n\nNew insight");
  assert.deepEqual(storage.writes, ["ME.md", "topics/topic-one/topic.md", "topics/topic-one/topic.md"]);
  assert.deepEqual(await store.getTopic(topic.id), settled);
});

test("settlement without profile preserves ME.md", async () => {
  const { storage, topic, tool } = await fixture();
  await tool.execute({ topicId: topic.id, verificationSummary: "Understood" });
  assert.equal(await storage.readText("ME.md"), "# Original profile");
  assert.deepEqual(storage.writes, ["topics/topic-one/topic.md", "topics/topic-one/topic.md"]);
});

test("invalid arguments and unmet settlement gates never mutate either file", async () => {
  const { storage, store, topic, tool } = await fixture();
  const args = { topicId: topic.id, verificationSummary: "Insight", profilePatchMarkdown: "# Replacement" };
  for (const change of [
    { topicId: "missing" }, { topicId: "../invalid" }, { verificationSummary: " " },
    { verificationSummary: "text\n<!-- pith-note:end -->" }, { profilePatchMarkdown: " " },
    { profilePatchMarkdown: "x".repeat(100001) }, { profilePatchMarkdown: null }, { extra: true },
  ]) {
    await assert.rejects(tool.execute({ ...args, ...change }));
    assert.deepEqual(storage.writes, []);
    assert.equal(await storage.readText("ME.md"), "# Original profile");
    assert.equal((await store.getTopic(topic.id))!.notes.length, 1);
  }
  const empty = await fixture(false);
  await assert.rejects(empty.tool.execute({ ...args, topicId: empty.topic.id }), /learner note/);
  assert.deepEqual(empty.storage.writes, []);
  assert.equal(await empty.storage.readText("ME.md"), "# Original profile");
  await store.updateTopic(topic.id, { status: "settled" });
  storage.writes = [];
  await assert.rejects(tool.execute(args), /not exploring/);
  assert.deepEqual(storage.writes, []);
  assert.equal(await storage.readText("ME.md"), "# Original profile");
});

test("write failures expose the prescribed sequential partial outcomes", async () => {
  for (const failAt of [1, 2, 3]) {
    const { storage, store, topic, tool } = await fixture();
    storage.failAt = failAt;
    await assert.rejects(tool.execute({ topicId: topic.id, verificationSummary: "Insight", profilePatchMarkdown: "# Updated" }), /injected write failure/);
    assert.equal(await storage.readText("ME.md"), failAt === 1 ? "# Original profile" : "# Updated");
    const after = (await store.getTopic(topic.id))!;
    assert.equal(after.status, "exploring");
    assert.equal(after.notes.length, failAt === 3 ? 2 : 1);
  }
});
