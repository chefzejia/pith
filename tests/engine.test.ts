import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DefaultAttentionEngine, DefaultWorkspaceStore } from "../src/core/index.ts";
import { NodeWorkspaceStorage } from "../src/shells/web/nodeStorage.ts";

test("compass, concurrent capture, offline conversation and durable effects", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pith-engine-"));
  try {
    const storage = new NodeWorkspaceStorage(dir);
    const store = new DefaultWorkspaceStore(storage);
    const topic = await store.createTopic({ title: "Attention", target: "Understand attention", materialIds: [], toolkits: [], nextAction: "Read one page" });
    await store.writeLesson(topic.id, "x.md", "A lesson");
    const engine = new DefaultAttentionEngine(store, storage);
    const compass = await engine.compass();
    assert.equal(compass.focusRecommendation?.nextAction, "Read one page");
    await Promise.all(Array.from({ length: 5 }, (_, i) => engine.capture({ owner: { topicId: topic.id }, kind: "highlight", body: `selection ${i}`, anchor: { source: { kind: "lesson" }, file: "x.md", locator: `page:${i}` } })));
    assert.equal((await store.getTopic(topic.id))?.notes.length, 5);
    assert.equal((await engine.listEffects()).length, 1);
    assert.equal((await engine.compass()).pendingEffectsCount, 1);
    assert.equal(await engine.processDueEffects(), 0);
    const sent = await engine.runTurn({ topicId: topic.id, text: "Why?" });
    assert.equal(sent.status, "failed");
    assert.match(sent.error ?? "", /向导不可用/);
    const restarted = new DefaultAttentionEngine(store, new NodeWorkspaceStorage(dir));
    assert.deepEqual(await restarted.getConversation(topic.id), [sent]);
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

test("provider reply and offered choices persist together in one turn", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pith-engine-"));
  try {
    const storage = new NodeWorkspaceStorage(dir); const store = new DefaultWorkspaceStore(storage);
    const topic = await store.createTopic({ title: "T", target: "Understand T", materialIds: [], toolkits: [] });
    const engine = new DefaultAttentionEngine(store, storage, () => ({ run: async (_input, options) => { options.onStep({ kind: "reply", markdown: "Response" }, 0); options.onChoices(["Next", "Review"]); return { status: "completed" }; } }));
    const result = await engine.runTurn({ topicId: topic.id, text: "Question" });
    assert.deepEqual(result.choices, ["Next", "Review"]);
    assert.equal((await engine.getConversation(topic.id)).length, 1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
