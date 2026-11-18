import assert from "node:assert/strict";
import test from "node:test";
import { rm } from "node:fs/promises";
import { setImmediate as turn } from "node:timers/promises";
import { testSandbox } from "./sandbox.ts";
import { NodeWorkspaceStorage } from "../src/shells/web/nodeStorage.ts";
import { DefaultAttentionEngine, DefaultWorkspaceStore } from "../src/core/index.ts";
import { createFeynmanContrast } from "../src/plugins/toolkit-feynman/index.ts";
import { RecallPractice } from "../src/workbench/recallPractice.ts";

const source = "只有通过检查才可发布。";
const points = [{ id: "p1", claim: "检查是发布的必要条件", sourceQuote: source }];
const response = JSON.stringify({ points });
class ObservedStorage extends NodeWorkspaceStorage {
  checks = 0;
  override exists(path: string): Promise<boolean> {
    if (path.startsWith("_cache/feynman/")) this.checks++;
    return super.exists(path);
  }
}
async function fixture() {
  const root = await testSandbox("task53-cancellation-");
  const storage = new ObservedStorage(root);
  const requests: { signal?: AbortSignal; resolve(value: string): void; reject(error: Error): void }[] = [];
  const pending: Promise<unknown>[] = [];
  let closed = false;
  const contrast = createFeynmanContrast(storage, { prompt: async (text, options) => {
    if (text.includes('"items"')) return JSON.stringify({ items: [{ id: "p1", status: "covered", quote: source }] });
    if (closed) return response;
    return new Promise<string>((resolve, reject) => { requests.push({ signal: options?.signal, resolve, reject }); });
  } });
  return {
    storage, contrast,
    prepare(signal?: AbortSignal) {
      const promise = contrast.prepare(source, signal); pending.push(promise); void promise.catch(() => {}); return promise;
    },
    async request(index: number) {
      const end = Date.now() + 3000;
      while (!requests[index] && Date.now() < end) await turn();
      assert.ok(requests[index], `external request ${index} started`); return requests[index]!;
    },
    async close() {
      closed = true;
      for (const request of requests) request.resolve(response);
      await Promise.allSettled(pending); await turn();
      await rm(root, { recursive: true, force: true });
    },
  };
}

test("Feynman initial extraction can reopen immediately and save only the new real practice", async () => {
  const f = await fixture();
  try {
    const store = new DefaultWorkspaceStore(f.storage), engine = new DefaultAttentionEngine(store, f.storage);
    const topic = await store.createTopic({ title: "发布", target: "解释发布条件", materialIds: [], toolkits: ["feynman"] });
    await store.writeLesson(topic.id, "source.md", source);
    const anchor = { source: { kind: "lesson" as const }, file: "source.md", locator: "text:line:0", quote: source };
    let changes = 0;
    const ports = { ...f.contrast, capture: (body: string, target: typeof anchor, result?: import("../src/plugins/toolkit-feynman/index.ts").RecallResult) => engine.capture({ owner: { topicId: topic.id }, kind: "practice", body, anchor: target, result }) };
    const old = new RecallPractice(source, anchor, ports, () => { changes++; });
    const first = await f.request(0);
    assert.equal((await store.getTopic(topic.id))!.notes.length, 0);
    old.dispose(); const before = changes;
    const fresh = new RecallPractice(source, anchor, ports);
    assert.equal(f.storage.checks, 2, "reopening must start fresh preparation synchronously");
    const second = await f.request(1); assert.equal(second.signal?.aborted, false);
    second.resolve(response); first.reject(new Error("old transport finished cancelling"));
    await fresh.submit(source);
    assert.equal(fresh.preparation, "ready"); assert.equal(fresh.error, ""); assert.equal(fresh.saved, true);
    const notes = (await new DefaultWorkspaceStore(f.storage).getTopic(topic.id))!.notes;
    assert.equal(notes.length, 1); assert.deepEqual(notes[0]!.anchor, anchor); assert.deepEqual(notes[0]!.result, fresh.result);
    assert.ok(fresh.result); assert.equal(changes, before);
  } finally { await f.close(); }
});

test("Feynman shared extraction cancels one consumer without cancelling the other", async () => {
  const f = await fixture();
  try {
    const a = new AbortController(), b = new AbortController();
    const first = f.prepare(a.signal), second = f.prepare(b.signal), request = await f.request(0);
    assert.equal(f.storage.checks, 1);
    const reason = new Error("first card closed"); a.abort(reason);
    assert.equal(request.signal?.aborted, false, "one consumer must not own the shared transport");
    await assert.rejects(first, error => error === reason);
    request.resolve(response); assert.deepEqual(await second, points);
    assert.deepEqual(await f.prepare(), points);
    const cancelled = new AbortController(); cancelled.abort(reason);
    const checks = f.storage.checks;
    await assert.rejects(f.prepare(cancelled.signal), error => error === reason);
    assert.equal(f.storage.checks, checks, "pre-aborted callers must not join or start work");
  } finally { await f.close(); }
});

test("Feynman last consumer cancellation aborts and evicts before immediate same-key reopen", async () => {
  const f = await fixture();
  try {
    const a = new AbortController(), b = new AbortController();
    const first = f.prepare(a.signal), second = f.prepare(b.signal), old = await f.request(0);
    a.abort(); assert.equal(old.signal?.aborted, false);
    b.abort(); assert.equal(old.signal?.aborted, true, "last consumer must abort the abandoned transport immediately");
    const fresh = f.prepare();
    assert.equal(f.storage.checks, 2, "same-tick reopen must not join the abandoned entry");
    await Promise.all([assert.rejects(first), assert.rejects(second)]);
    const next = await f.request(1); next.resolve(response); assert.deepEqual(await fresh, points);
    old.resolve(JSON.stringify({ points: [{ ...points[0]!, claim: "abandoned late standard" }] }));
    await turn(); await turn();
    assert.deepEqual(await f.prepare(), points, "abandoned completion must not overwrite the fresh disk cache");
  } finally { await f.close(); }
});

test("Feynman late old finally cannot delete a newer pending entry", async () => {
  const f = await fixture();
  try {
    const a = new AbortController();
    const first = f.prepare(a.signal), old = await f.request(0);
    a.abort(); const second = f.prepare();
    assert.equal(f.storage.checks, 2, "cancellation must evict before new preparation");
    const next = await f.request(1);
    await assert.rejects(first);
    old.reject(new Error("late cancelled transport")); await turn(); await turn();
    const third = f.prepare();
    assert.equal(f.storage.checks, 2, "old finally must preserve the new pending entry for its next consumer");
    next.resolve(response); assert.deepEqual(await second, points); assert.deepEqual(await third, points);
  } finally { await f.close(); }
});
