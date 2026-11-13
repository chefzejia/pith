import { testToolkits } from "./guide-tools-fixture.ts";
import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import test from "node:test";
import { DefaultWorkspaceStore } from "../src/core/store/WorkspaceStore.ts";
import { createScopedTools } from "../src/plugins/guide-acp/tools.ts";
import { NodeWorkspaceStorage } from "../src/shells/web/nodeStorage.ts";
import { testSandbox } from "./sandbox.ts";

test("intake creates one topic and settlement accepts only user evidence", async () => {
  const root = await testSandbox("task51-tools-");
  try {
    const storage = new NodeWorkspaceStorage(root), store = new DefaultWorkspaceStore(storage);
    await store.ensureScaffold();
    const material = await store.importMaterial({ title: "source", kind: "article", files: [{ name: "source.md", bytes: new TextEncoder().encode("source") }] });
    const tools = createScopedTools({ toolkits: testToolkits, store, storage, materialIds: [material.id], onChoices: () => {} });
    const call = (name: string, input: Record<string, unknown>) => tools.find(tool => tool.name === name)!.execute(input);
    await assert.rejects(call("pith_write_lesson", { fileName: "01.md", markdown: "lesson" }), /先创建课题/);
    const topic = await call("pith_create_topic", { title: "topic", target: "understand", materialIds: [material.id], toolkits: [] }) as { id: string };
    await assert.rejects(call("pith_create_topic", { title: "another", target: "understand", materialIds: [], toolkits: [] }));
    await call("pith_write_lesson", { fileName: "01.md", markdown: "lesson" });
    assert.equal(await store.readLesson(topic.id, "01.md"), "lesson");
    const guideNote = await call("pith_save_note", { body: "guide" }) as { id: string };
    await assert.rejects(call("pith_settle_topic", { verificationSummary: "understands" }), /learner note/);
    const userNote = await store.appendTopicNote(topic.id, { kind: "note", author: "user", body: "evidence" });
    await assert.rejects(call("pith_settle_topic", { verificationSummary: "understands", observations: [{ text: "observation", noteId: guideNote.id }] }), /user evidence/);
    await call("pith_settle_topic", { verificationSummary: "understands", observations: [{ text: "observation", noteId: userNote.id }] });
    const result = await store.getTopic(topic.id);
    assert.equal(result!.status, "settled");
    assert.equal(result!.notes.at(-1)!.author, "guide");
    assert.equal((await store.readProfile()).observations[0]!.noteId, userNote.id);
  } finally { await rm(root, { recursive: true, force: true }); }
});
