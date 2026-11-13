import assert from "node:assert/strict";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { DefaultAttentionEngine, DefaultWorkspaceStore, type GuideProvider, type GuideTurn } from "../src/core/index.ts";
import { NodeWorkspaceStorage } from "../src/shells/web/nodeStorage.ts";
import { testSandbox } from "./sandbox.ts";

test("turns persist progress, stop, and retry the same user message", async () => {
  const root = await testSandbox("task49-turn-");
  try {
    const storage = new NodeWorkspaceStorage(root), store = new DefaultWorkspaceStore(storage);
    const topic = await store.createTopic({ title: "Turn", target: "Understand the turn", materialIds: [], toolkits: [] });
    let release!: () => void, started!: () => void;
    const running = new Promise<void>(resolve => { started = resolve; }), block = new Promise<void>(resolve => { release = resolve; });
    let attempt = 0;
    const provider: GuideProvider = { async run(_input, options) { attempt++; options.onStep({ kind: "reply", markdown: `attempt ${attempt}` }, 0); started(); if (attempt === 1) await block; return { status: "completed" }; } };
    const engine = new DefaultAttentionEngine(store, storage, () => provider), controller = new AbortController(), updates: GuideTurn[] = [];
    const result = engine.runTurn({ topicId: topic.id, text: "question" }, { signal: controller.signal, onUpdate: turn => updates.push(turn) });
    await running;
    assert.equal((await engine.getConversation(topic.id))[0]!.status, "running");
    await assert.rejects(engine.runTurn({ topicId: topic.id, text: "another" }), /running turn/);
    controller.abort(); release();
    const stopped = await result;
    assert.equal(stopped.status, "stopped"); assert.equal(stopped.steps[0]!.kind, "reply");
    const disk = JSON.parse(await readFile(join(root, "topics", topic.id, "conversation.json"), "utf8")) as GuideTurn[];
    assert.equal(disk[0]!.status, "stopped"); assert.equal(updates.at(-1)!.status, "stopped");
    const retried = await engine.retryTurn(topic.id, stopped.id);
    assert.equal(retried.status, "completed"); assert.equal(retried.id, stopped.id);
    const turns = await engine.getConversation(topic.id); assert.equal(turns.length, 1); assert.equal(turns[0]!.user.text, "question");
  } finally { await rm(root, { recursive: true, force: true }); }
});
