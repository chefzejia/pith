import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import test from "node:test";
import { DefaultAttentionEngine, type GuideTurn } from "../src/core/index.ts";
import { NodeWorkspaceStorage } from "../src/shells/web/nodeStorage.ts";
import { undoTopicObservation } from "../src/workbench/observations.ts";
import { auditRetryFixture } from "./audit11713-fixture.ts";
import { testSandbox } from "./sandbox.ts";

test("retry preserves durable receipts across repeated failure, stop, restart and success without replay", async () => {
  const root = await testSandbox("audit11713-retry-"), f = await auditRetryFixture(root, "failed,stopped,failed,completed");
  try {
    const post = async (input: object) => { const response = await fetch(f.base + "/api/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) }); assert.equal(response.status, 201); return response.json() as Promise<GuideTurn>; };
    const first = await post({ topicId: f.topic.id, text: "验证前提后结题" }); assert.equal(first.status, "failed");
    const observations = (await f.store.readProfile()).observations; assert.equal(observations.length, 2); assert.equal(f.storage.failures, 1);
    let engine = new DefaultAttentionEngine(f.store, new NodeWorkspaceStorage(f.workspace), () => f.provider);
    await undoTopicObservation(f.store, engine, f.topic.id, observations[1]!.id);
    const stop = new AbortController();
    const stopped = await engine.retryTurn(f.topic.id, first.id, { signal: stop.signal, onUpdate(turn) { if (turn.steps.some(step => step.kind === "tool" && step.name === "pith_save_note" && step.status === "completed")) stop.abort(); } });
    assert.equal(stopped.status, "stopped");
    const failed = await post({ topicId: f.topic.id, turnId: first.id }); assert.equal(failed.status, "failed");
    engine = new DefaultAttentionEngine(f.store, new NodeWorkspaceStorage(f.workspace), () => f.provider);
    const completed = await engine.retryTurn(f.topic.id, first.id); assert.equal(completed.status, "completed");
    const turns = await engine.getConversation(f.topic.id); assert.equal(turns.length, 1); assert.equal(turns[0]!.id, first.id); assert.equal(turns[0]!.user.text, "验证前提后结题");
    const receipts = completed.steps.filter(step => step.kind === "tool");
    assert.equal(receipts.length, 3); assert.ok(receipts.every(step => step.callId.startsWith("previous-attempt:")));
    assert.deepEqual(receipts.map(step => step.status), ["failed", "completed", "completed"]);
    assert.equal(receipts.flatMap(step => step.effects).length, 4);
    assert.match(receipts[0]!.summary!, /磁盘故障/);
    assert.equal((await f.store.getTopic(f.topic.id))!.notes.length, 3, "only two explicitly requested new notes, no replay");
    assert.equal((await f.store.readProfile()).observations.length, 1); assert.equal(f.attempts(), 4);
    await undoTopicObservation(f.store, engine, f.topic.id, observations[0]!.id); assert.equal((await f.store.readProfile()).observations.length, 0);
    await assert.rejects(undoTopicObservation(f.store, engine, f.topic.id, observations[0]!.id), /已撤销/);
  } finally { await f.close(); assert.ok(f.processes.every(process => process.closed)); await rm(root, { recursive: true, force: true }); }
});

test("interrupted running receipts survive retry before any new protocol step", async () => {
  const root = await testSandbox("audit11713-interrupted-"), f = await auditRetryFixture(root);
  try {
    const engine = new DefaultAttentionEngine(f.store, f.storage, () => f.provider);
    const first = await engine.runTurn({ topicId: f.topic.id, text: "保留已写入观察" });
    await f.storage.writeText(`topics/${f.topic.id}/conversation.json`, JSON.stringify([{ ...first, status: "running", steps: first.steps.map(step => step.kind === "tool" ? { ...step, status: "running" } : step) }]));
    const restarted = new DefaultAttentionEngine(f.store, new NodeWorkspaceStorage(f.workspace));
    const updates: GuideTurn[] = [];
    const result = await restarted.retryTurn(f.topic.id, first.id, { onUpdate: turn => updates.push(turn) });
    assert.equal(result.status, "failed"); assert.match(result.error!, /向导不可用/);
    for (const turn of updates) assert.equal(turn.steps.flatMap(step => step.kind === "tool" ? step.effects : []).length, 2);
    assert.ok(result.steps.every(step => step.kind === "tool" && step.status === "failed"));
    await undoTopicObservation(f.store, restarted, f.topic.id, (await f.store.readProfile()).observations[0]!.id);
  } finally { await f.close(); await rm(root, { recursive: true, force: true }); }
});
