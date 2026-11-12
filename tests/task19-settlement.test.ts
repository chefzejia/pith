import assert from "node:assert/strict";
import { readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { DefaultWorkspaceStore } from "../src/core/index.ts";
import { buildScenePrompt, createGuideWorkspaceTools } from "../src/plugins/guide-acp/index.ts";
import { createDshPluginBundle } from "../src/shells/dsh/index.ts";
import { NodeWorkspaceStorage } from "../src/shells/web/nodeStorage.ts";
import { testSandbox } from "./sandbox.ts";

const start = "<!-- pith-observations:v1 -->", end = "<!-- pith-observations:end -->";
const prefix = Buffer.from("\ufeff# 我的画像\r\n手写第一段\r\n\r\n## 向导的观察\r\n");
const suffix = Buffer.from("\r\n\r\n## 私人笔记\r\n保留空行与文字\r\n");

async function fixture() {
  const dir = await testSandbox("task47-profile-");
  const storage = new NodeWorkspaceStorage(dir), store = new DefaultWorkspaceStore(storage);
  await store.ensureScaffold();
  const topic = await store.createTopic({ id: "topic-one", title: "Topic" });
  const note = await store.appendNote(topic.id, { kind: "practice", body: "Evidence" });
  const tools = createGuideWorkspaceTools(store, undefined);
  const tool = (name: string) => { const found = tools.find(item => item.name === name); assert.ok(found); return found; };
  return { dir, storage, store, topic, note, tool };
}

test("profile adds and removes observations without changing outside bytes and backs up each version", async () => {
  const f = await fixture();
  try {
    const original = Buffer.concat([prefix, Buffer.from(`${start}\n- id: "obs-existing" · 2026-01-01 · topic-one\n  旧观察\n${end}`), suffix]);
    await writeFile(join(f.dir, "ME.md"), original);
    const added = await f.store.addObservation({ topicId: f.topic.id, noteId: f.note.id, text: "第一行\r第二行\u2028第三行\n第四行" });
    assert.equal(added.text, "第一行 第二行 第三行 第四行");
    assert.equal(added.noteId, f.note.id);
    const after = await readFile(join(f.dir, "ME.md"));
    assert.deepEqual(after.subarray(0, prefix.length), prefix);
    assert.deepEqual(after.subarray(after.length - suffix.length), suffix);
    assert.deepEqual((await f.store.readProfile()).observations.map(item => item.id), ["obs-existing", added.id]);
    const first = (await readdir(join(f.dir, "history"))).sort();
    assert.equal(first.length, 1); assert.match(first[0]!, /^ME-\d{8}T\d{9}Z\.md$/);
    assert.deepEqual(await readFile(join(f.dir, "history", first[0]!)), original);
    await f.store.removeObservation("obs-existing");
    const final = await readFile(join(f.dir, "ME.md"));
    assert.deepEqual(final.subarray(0, prefix.length), prefix);
    assert.deepEqual(final.subarray(final.length - suffix.length), suffix);
    assert.deepEqual((await f.store.readProfile()).observations.map(item => item.id), [added.id]);
    const backups = (await readdir(join(f.dir, "history"))).sort(); assert.equal(backups.length, 2);
    assert.deepEqual(await readFile(join(f.dir, "history", backups[1]!)), after);
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});

test("missing markers append without altering original bytes; incomplete or duplicate markers reject writes", async () => {
  const f = await fixture();
  try {
    const original = Buffer.from("\ufeff# 我的画像\r\n不带结束换行");
    await writeFile(join(f.dir, "ME.md"), original);
    await f.store.addObservation({ topicId: f.topic.id, text: "新观察" });
    const added = await readFile(join(f.dir, "ME.md"));
    assert.deepEqual(added.subarray(0, original.length), original);
    assert.deepEqual(await readFile(join(f.dir, "history", (await readdir(join(f.dir, "history")))[0]!)), original);
    for (const [body, error] of [[`intro\n${start}\nunfinished`, /Incomplete/], [`${start}\n${end}\n${start}`, /Duplicate/], [`${end}\n${start}`, /wrong order/]] as const) {
      await writeFile(join(f.dir, "ME.md"), body);
      const before = await readFile(join(f.dir, "ME.md")), backups = await readdir(join(f.dir, "history"));
      await assert.rejects(f.store.addObservation({ topicId: f.topic.id, text: "not saved" }), error);
      assert.deepEqual(await readFile(join(f.dir, "ME.md")), before);
      assert.deepEqual(await readdir(join(f.dir, "history")), backups);
    }
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});

test("copy failure rejects profile writes and timestamp collisions preserve both backups", async () => {
  const f = await fixture();
  try {
    const original = Buffer.from("# Original\n"); await writeFile(join(f.dir, "ME.md"), original);
    const copy = f.storage.copy.bind(f.storage);
    f.storage.copy = async () => { throw new Error("copy failed"); };
    await assert.rejects(f.store.addObservation({ topicId: f.topic.id, text: "denied" }), /copy failed/);
    assert.deepEqual(await readFile(join(f.dir, "ME.md")), original);
    f.storage.copy = copy;
    const now = Date.now; Date.now = () => 1794480000000;
    try {
      await f.store.addObservation({ topicId: f.topic.id, text: "one" });
      const afterFirst = await readFile(join(f.dir, "ME.md"));
      await f.store.addObservation({ topicId: f.topic.id, text: "two" });
      const backups = (await readdir(join(f.dir, "history"))).sort(); assert.equal(backups.length, 2);
      assert.deepEqual(await readFile(join(f.dir, "history", backups[0]!)), original);
      assert.deepEqual(await readFile(join(f.dir, "history", backups[1]!)), afterFirst);
    } finally { Date.now = now; }
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});

test("concurrent stores serialize observations and retain every previous profile", async () => {
  const f = await fixture();
  try {
    const other = new DefaultWorkspaceStore(new NodeWorkspaceStorage(f.dir));
    const before = await readFile(join(f.dir, "ME.md"));
    const observations = await Promise.all(Array.from({ length: 5 }, (_, i) => (i % 2 ? other : f.store).addObservation({ topicId: f.topic.id, text: `observation ${i}` })));
    assert.deepEqual(new Set((await f.store.readProfile()).observations.map(item => item.id)), new Set(observations.map(item => item.id)));
    const backups = (await readdir(join(f.dir, "history"))).sort(); assert.equal(backups.length, 5);
    assert.deepEqual(await readFile(join(f.dir, "history", backups[0]!)), before);
    for (let i = 1; i < backups.length; i++) assert.equal((await readFile(join(f.dir, "history", backups[i]!), "utf8")).split("- id:").length - 1, i);
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});

test("exhausted backup timestamps fail without writing the profile", async () => {
  const f = await fixture();
  try {
    const before = await readFile(join(f.dir, "ME.md"));
    const exists = f.storage.exists.bind(f.storage);
    f.storage.exists = async path => path.startsWith("history/ME-") || exists(path);
    await assert.rejects(f.store.addObservation({ topicId: f.topic.id, text: "not saved" }), /timestamp exhausted/);
    assert.deepEqual(await readFile(join(f.dir, "ME.md")), before);
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});

test("invalid UTF-8 and invalid observation text fail without changing bytes", async () => {
  const f = await fixture();
  try {
    const invalid = Buffer.from([0xff, 0xfe, 0x0a]); await writeFile(join(f.dir, "ME.md"), invalid);
    await assert.rejects(f.store.addObservation({ topicId: f.topic.id, text: "x" }));
    assert.deepEqual(await readFile(join(f.dir, "ME.md")), invalid);
    await writeFile(join(f.dir, "ME.md"), "# Profile\n");
    await assert.rejects(f.store.addObservation({ topicId: f.topic.id, text: "x".repeat(501) }), /Invalid observation/);
    assert.equal(await readFile(join(f.dir, "ME.md"), "utf8"), "# Profile\n");
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});

test("guide settlement and explicit remember use topic evidence and reject replacement", async () => {
  const f = await fixture();
  try {
    const before = await readFile(join(f.dir, "ME.md"));
    const remember = f.tool("pith_remember"), settle = f.tool("pith_settle_topic");
    const remembered = await remember.execute({ topicId: f.topic.id, text: "熟悉依赖注入", noteId: f.note.id }) as { id: string };
    await assert.rejects(remember.execute({ topicId: f.topic.id, text: "bad", noteId: "other-note" }), /Note does not belong/);
    await assert.rejects(settle.execute({ topicId: f.topic.id, verificationSummary: "Understood", profilePatchMarkdown: "replacement" }), /Invalid tool arguments/);
    await assert.rejects(settle.execute({ topicId: f.topic.id, verificationSummary: "Understood", observations: [{ text: "ok" }, { text: "bad", noteId: "other-note" }] }), /Note does not belong/);
    const prompt = buildScenePrompt({ profileMarkdown: "", topic: (await f.store.getTopic(f.topic.id))!, userMessage: "test" });
    assert.ok(prompt.includes(f.note.id)); assert.match(prompt, /只有用户明确要求记住/);
    const settled = await settle.execute({ topicId: f.topic.id, verificationSummary: "Applied insight", observations: [{ text: "理解边界", noteId: f.note.id }], removeObservationIds: [remembered.id] }) as { status: string };
    assert.equal(settled.status, "settled");
    const profile = await f.store.readProfile(); assert.deepEqual(profile.observations.map(item => [item.text, item.noteId]), [["理解边界", f.note.id]]);
    assert.ok(Buffer.from(profile.markdown).subarray(0, before.length).equals(before));
    const dsh = createDshPluginBundle({ storage: f.storage }).tools;
    assert.ok(dsh.some(item => item.name === "pith_remember")); assert.ok(!dsh.some(item => item.name === "pith_update_profile"));
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});
