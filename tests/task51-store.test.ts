import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { DefaultWorkspaceStore } from "../src/core/store/WorkspaceStore.ts";
import { NodeWorkspaceStorage } from "../src/shells/web/nodeStorage.ts";
import { testSandbox } from "./sandbox.ts";

test("topics share immutable materials while owning lessons, anchored notes and state", async () => {
  const root = await testSandbox("task51-store-");
  try {
    const storage = new NodeWorkspaceStorage(root), store = new DefaultWorkspaceStore(storage);
    await store.ensureScaffold();
    const bytes = new TextEncoder().encode("original");
    const first = await store.importMaterial({ title: "first", kind: "article", files: [{ name: "README.md", bytes }] });
    const second = await store.importMaterial({ title: "second", kind: "article", files: [{ name: "README.md", bytes }] });
    const a = await store.createTopic({ title: "A", target: "Understand A", materialIds: [first.id, second.id], toolkits: [] });
    const b = await store.createTopic({ title: "B", target: "Understand B", materialIds: [first.id], toolkits: [] });
    await store.writeLesson(a.id, "00-课程大纲.md", "A");
    await store.writeLesson(b.id, "00-课程大纲.md", "B");
    assert.equal(await store.readLesson(a.id, "00-课程大纲.md"), "A");
    assert.equal(await store.readLesson(b.id, "00-课程大纲.md"), "B");
    assert.equal(await readFile(join(root, "materials", first.id, "files", "README.md"), "utf8"), "original");
    const anchor = { source: { kind: "material" as const, materialId: second.id }, file: "README.md", locator: "text:line:1" };
    const user = await store.appendTopicNote(a.id, { kind: "note", author: "user", body: "evidence", anchor });
    const guide = await store.appendTopicNote(a.id, { kind: "note", author: "guide", body: "guide note" });
    assert.deepEqual((await store.getTopic(a.id))!.notes[0]!.anchor, anchor);
    await assert.rejects(store.addObservation({ text: "x", topicId: a.id, noteId: guide.id }));
    await store.addObservation({ text: "x", topicId: a.id, noteId: user.id });
    await store.updateTopic(a.id, { status: "shelved" });
    await assert.rejects(store.updateTopic(a.id, { status: "settled" }));
    await store.updateTopic(a.id, { status: "exploring" });
    await store.updateTopic(a.id, { status: "settled" });
    await assert.rejects(store.updateTopic(a.id, { status: "exploring" }));
    await assert.rejects(store.writeLesson(b.id, "../escape.md", "x"));
    await assert.rejects(store.writeLesson(b.id, "not-markdown.txt", "x"));
    await assert.rejects(store.appendMaterialNote(first.id, { kind: "practice", author: "user", body: "x" }));
    await assert.rejects(store.appendMaterialNote(first.id, { kind: "note", author: "guide", body: "x" }));
    await mkdir(join(root, "topics", "old-topic"));
    await writeFile(join(root, "topics", "old-topic", "topic.md"), '---\ntype: pith-topic\nid: old-topic\ntitle: Old\ntarget: Old\nstatus: exploring\ntoolkits: []\ncreatedAt: now\nupdatedAt: now\n---\n');
    await mkdir(join(root, "materials", "old-material"));
    await writeFile(join(root, "materials", "old-material", "material.md"), '---\ntype: pith-material\nid: old-material\ntitle: Old\nkind: article\ncreatedAt: now\nfiles: []\n---\n');
    const unreadable = await store.listUnreadable();
    assert.ok(unreadable.some(entry => entry.id === "old-topic" && /materials/.test(entry.error)));
    assert.ok(unreadable.some(entry => entry.id === "old-material" && /aids/.test(entry.error)));
    assert.ok(!(await store.listTopics()).some(topic => topic.id === "old-topic"));
    assert.ok(!(await store.listMaterials()).some(material => material.id === "old-material"));
  } finally { await rm(root, { recursive: true, force: true }); }
});
