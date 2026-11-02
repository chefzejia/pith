import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DefaultAttentionEngine, DefaultWorkspaceStore, parseGuideReply } from "../src/core/index.ts";
import { NodeWorkspaceStorage } from "../src/shells/web/nodeStorage.ts";

test("compass, concurrent capture, offline conversation and durable effects", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pith-engine-"));
  try {
    const storage = new NodeWorkspaceStorage(dir);
    const store = new DefaultWorkspaceStore(storage);
    await store.createTopic({ id: "topic-test", title: "Attention", nextAction: "Read one page" });
    const engine = new DefaultAttentionEngine(store, storage);
    const compass = await engine.compass();
    assert.equal(compass.focusRecommendation?.nextAction, "Read one page");
    await Promise.all(Array.from({ length: 5 }, (_, i) => engine.captureSelection({ topicId: "topic-test", kind: "highlight", body: `selection ${i}`, anchor: { file: "x.md", locator: `page:${i}` } })));
    assert.equal((await store.getTopic("topic-test"))?.notes.length, 5);
    assert.equal((await engine.listEffects()).length, 1);
    assert.equal((await engine.compass()).pendingEffectsCount, 1);
    assert.equal(await engine.processDueEffects(), 0);
    const sent = await engine.sendMessage({ topicId: "topic-test", text: "Why?", saveAsNote: true });
    assert.equal(sent.guideEntry, undefined);
    assert.ok(sent.userEntry.savedNoteId);
    const restarted = new DefaultAttentionEngine(store, new NodeWorkspaceStorage(dir));
    assert.deepEqual(await restarted.getConversation("topic-test"), [sent.userEntry]);
    const seen: unknown[] = [];
    restarted.registerEffectHandler("prepare-next-action", async payload => { seen.push(payload); });
    assert.equal(await restarted.processDueEffects(), 1);
    assert.equal(seen.length, 1);
    assert.equal((await restarted.listEffects())[0]?.status, "completed");
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("a running effect retains a later same-key effect and records failures", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pith-engine-"));
  try {
    const storage = new NodeWorkspaceStorage(dir); const store = new DefaultWorkspaceStore(storage);
    const engine = new DefaultAttentionEngine(store, storage);
    await engine.enqueueEffect("curate-topic", "t", { revision: 1 });
    let started!: () => void; let release!: () => void;
    const entered = new Promise<void>(resolve => { started = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    const calls: unknown[] = [];
    engine.registerEffectHandler("curate-topic", async payload => { calls.push(payload.revision); if (payload.revision === 1) { started(); await gate; } else throw new Error("offline"); });
    const processing = engine.processDueEffects();
    await entered;
    await engine.enqueueEffect("curate-topic", "t", { revision: 2 });
    release();
    assert.equal(await processing, 2);
    assert.deepEqual(calls, [1, 2]);
    assert.deepEqual((await engine.listEffects()).map(effect => effect.status), ["completed", "failed"]);
    assert.equal((await engine.listEffects())[1]?.lastError, "offline");
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("only a valid trailing choices capsule is parsed", async () => {
  assert.deepEqual(parseGuideReply("Answer\n\n```pith-choices\n- First\n- Second\n```"), { text: "Answer", choices: ["First", "Second"] });
  assert.deepEqual(parseGuideReply('Answer\n```pith-choices\n["A", "B"]\n```'), { text: "Answer", choices: ["A", "B"] });
  const middle = "```pith-choices\n- A\n```\nmore";
  assert.deepEqual(parseGuideReply(middle), { text: middle, choices: [] });
  const dir = await mkdtemp(join(tmpdir(), "pith-engine-"));
  try {
    const storage = new NodeWorkspaceStorage(dir); const store = new DefaultWorkspaceStore(storage);
    await store.createTopic({ id: "t", title: "T" });
    const engine = new DefaultAttentionEngine(store, storage, () => ({ reply: async () => "Response\n```pith-choices\n- Next\n```" }));
    const result = await engine.sendMessage({ topicId: "t", text: "Question" });
    assert.deepEqual(result.guideEntry?.choices, ["Next"]);
    assert.equal((await engine.getConversation("t")).length, 2);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
