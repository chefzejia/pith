import { testToolkits } from "./guide-tools-fixture.ts";
import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import test from "node:test";
import { DefaultWorkspaceStore } from "../src/core/index.ts";
import { createGuidePermissionGate } from "../src/plugins/guide-acp/acpSession.ts";
import { createScopedTools } from "../src/plugins/guide-acp/tools.ts";
import { createDshPluginBundle } from "../src/shells/dsh/index.ts";
import { NodeWorkspaceStorage } from "../src/shells/web/nodeStorage.ts";
import { testSandbox } from "./sandbox.ts";

test("scoped tools and dsh share names and enforce topic scope", async () => {
  const root = await testSandbox("pith-guide-tools-");
  try {
    const storage = new NodeWorkspaceStorage(root), store = new DefaultWorkspaceStore(storage); await store.ensureScaffold();
    const material = await store.importMaterial({ title: "Source", kind: "article", files: [{ name: "source.md", bytes: new TextEncoder().encode("original") }] });
    const topic = await store.createTopic({ title: "Topic", target: "Understand the source", materialIds: [material.id], toolkits: [] });
    const scoped = createScopedTools({ toolkits: testToolkits, topicId: topic.id, store, storage, http: { request: async () => { throw new Error("offline"); } }, onChoices: () => {} });
    const dsh = createDshPluginBundle({ storage }).tools;
    assert.deepEqual(dsh.map(tool => tool.name).sort(), scoped.map(tool => tool.name).sort());
    const lessonSchema = dsh.find(tool => tool.name === "pith_write_lesson")!.inputSchema as { properties: Record<string, unknown>; required: string[] };
    assert.deepEqual(Object.keys(lessonSchema.properties).sort(), ["fileName", "markdown", "topicId"]);
    assert.deepEqual(lessonSchema.required.sort(), ["fileName", "markdown", "topicId"]);
    const call = (name: string, input: Record<string, unknown>) => scoped.find(tool => tool.name === name)!.execute(input);
    assert.ok(!scoped.some(tool => tool.name === "pith_remember"));
    await assert.rejects(call("pith_write_lesson", { topicId: "other", fileName: "lesson.md", markdown: "x" }), /Invalid/);
    await assert.rejects(dsh.find(tool => tool.name === "pith_write_lesson")!.execute({ topicId: topic.id, materialId: material.id, fileName: "lesson.md", markdown: "x" }), /Invalid/);
    await call("pith_write_lesson", { fileName: "source.md", markdown: "lesson" });
    assert.equal(await storage.readText(`materials/${material.id}/files/source.md`), "original");
    assert.equal(await store.readLesson(topic.id, "source.md"), "lesson");
    await assert.rejects(call("pith_settle_topic", { verificationSummary: "understood" }), /learner note/);
    await call("pith_save_note", { body: "evidence" });
    await assert.rejects(call("pith_settle_topic", { verificationSummary: "understood" }), /learner note/);
    await store.appendTopicNote(topic.id, { kind: "note", author: "user", body: "user evidence" });
    await call("pith_configure_toolkits", { toolkits: [] });
    assert.deepEqual((await store.getTopic(topic.id))!.toolkits, []);
    const result = await call("pith_settle_topic", { verificationSummary: "explained" }) as { topic: { status: string } };
    assert.equal(result.topic.status, "settled");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("permission gate allows a registered title once and rejects all other tools", () => {
  const gate = createGuidePermissionGate(["pith_save_note"]);
  gate.observe({ type: "tool-call", toolCallId: "a", title: "mcp__pith__pith_save_note" });
  assert.equal(gate.decide({ toolCallId: "a" }), "allow_once");
  assert.equal(gate.decide({ toolCallId: "a" }), "reject_once");
  for (const [id, title] of [["b", "write_file"], ["c", "other__pith_save_note"], ["d", "mcp__pith__unknown"]]) gate.observe({ type: "tool-call", toolCallId: id!, title });
  for (const id of ["b", "c", "d", "unknown"]) assert.equal(gate.decide({ toolCallId: id }), "reject_once");
});
