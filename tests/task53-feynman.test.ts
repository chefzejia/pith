import assert from "node:assert/strict";
import test from "node:test";
import { rm } from "node:fs/promises";
import { testSandbox } from "./sandbox.ts";
import { NodeWorkspaceStorage } from "../src/shells/web/nodeStorage.ts";
import { createFeynmanContrast, validatePoints, validateComparison, paragraphHash, comparePrompt, recallFollowUp } from "../src/plugins/toolkit-feynman/index.ts";
import { RecallPractice } from "../src/workbench/recallPractice.ts";
import { DefaultAttentionEngine, DefaultWorkspaceStore } from "../src/core/index.ts";
import { feynmanToolkit } from "../src/plugins/toolkit-feynman/index.ts";

const source = "只有版本相同才可复用缓存。缓存命中减少重复读取。";
const points = [{ id: "p1", claim: "版本相同是复用前提", sourceQuote: "只有版本相同才可复用缓存。" }, { id: "p2", claim: "减少读取", sourceQuote: "缓存命中减少重复读取。" }];

test("Feynman source quotes are whitespace tolerant, filter forged references and reject empty standards", () => {
  assert.deepEqual(validatePoints(source, { points: [...points, { id: "bad", claim: "编造", sourceQuote: "缓存总是有效" }] }), points);
  assert.equal(validatePoints(source, { points: [{ ...points[0], sourceQuote: "只有版本\n相同才可复用 缓存。" }] }).length, 1);
  assert.throws(() => validatePoints(source, { points: [] }), /没有可核对/);
  assert.throws(() => validatePoints(source, { points: [{ id: "bad", claim: "错", sourceQuote: "不存在" }] }), /没有可核对/);
});

test("Feynman comparison verifies every covered/contradicted quote and rejects malformed/free-text output", () => {
  const produced = "版本不同也能用缓存。命中后少读一次。";
  const result = validateComparison(points, produced, { items: [{ id: "p2", status: "covered", quote: "命中后 少读一次。" }, { id: "p1", status: "contradicted", quote: "版本不同也能用缓存。" }] });
  assert.deepEqual(result.points.map(item => item.status), ["contradicted", "covered"]);
  for (const status of ["covered", "contradicted"]) {
    const invalid = validateComparison([points[0]!], produced, { items: [{ id: "p1", status, quote: "虚构复述" }] });
    assert.equal(invalid.points[0]!.status, "unverified");
    assert.equal(invalid.points[0]!.quote, "");
  }
  assert.throws(() => validateComparison(points, produced, { items: [] }), /不完整/);
  assert.throws(() => validateComparison([points[0]!], produced, { items: [{ id: "p1", status: "missing", quote: "" }], summary: "不错" }), /格式/);
});

test("Feynman caches verified standards by paragraph hash across service restarts before any comparison", async () => {
  const root = await testSandbox("task53-cache-");
  try {
    const storage = new NodeWorkspaceStorage(root); let requests = 0;
    const service = createFeynmanContrast(storage, { prompt: async () => { requests++; return JSON.stringify({ points }); } });
    assert.deepEqual(await service.prepare(source), points);
    assert.equal(requests, 1);
    assert.equal(await storage.exists(`_cache/feynman/${paragraphHash(source)}.json`), true);
    const restarted = createFeynmanContrast(storage, { prompt: async () => { throw new Error("must reuse cache"); } });
    assert.deepEqual(await restarted.prepare(source), points);
    await service.prepare(source + "新内容。");
    assert.equal(requests, 2, "different paragraph must not reuse the first standard");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("Feynman comparison has only passage, standards and production, and followUp prioritizes contradiction", () => {
  const prompt = comparePrompt(source, points, "同版本才用");
  const data = JSON.parse(prompt.slice(prompt.lastIndexOf("\n") + 1));
  assert.deepEqual(Object.keys(data), ["source", "points", "produced"]);
  const missing = { ...points[0]!, status: "missing", quote: "" }, contradicted = { ...points[1]!, status: "contradicted", quote: "相反" };
  const instruction = recallFollowUp({ toolkit: "feynman", points: [missing, contradicted] });
  assert.ok(instruction.includes(contradicted.sourceQuote)); assert.ok(!instruction.includes(missing.sourceQuote));
  assert.match(instruction, /只就.*一个问题.*不代答.*不评价/);
  assert.match(recallFollowUp({ toolkit: "feynman", points: [missing] }), /版本相同/);
  assert.match(recallFollowUp({ toolkit: "feynman", points: [{ ...missing, status: "covered" }] }), /反例或迁移/);
  assert.equal(recallFollowUp({}), "");
});

test("Feynman starts standards before production, saves each real attempt once, retains draft and passes followUp as instruction", async () => {
  const root = await testSandbox("task53-practice-");
  try {
    const storage = new NodeWorkspaceStorage(root), store = new DefaultWorkspaceStore(storage), engine = new DefaultAttentionEngine(store, storage);
    const material = await store.importMaterial({ title: "缓存", kind: "article", files: [{ name: "source.md", bytes: new TextEncoder().encode(source) }] });
    const topic = await store.createTopic({ title: "理解", target: "解释条件", materialIds: [material.id], toolkits: ["feynman"] });
    const anchor = { source: { kind: "material" as const, materialId: material.id }, file: "source.md", locator: "text:line:0", quote: source };
    const events: string[] = []; let fail = true; let follow: unknown;
    const practice = new RecallPractice(source, anchor, {
      prepare: async () => { events.push("prepare"); return points; },
      compare: async () => { events.push("compare"); if (fail) throw new Error("external process exited"); return { toolkit: "feynman", points: points.map(point => ({ ...point, status: "covered", quote: "换句话说" })) }; },
      capture: (body, target, result) => engine.capture({ owner: { topicId: topic.id }, kind: "practice", body, anchor: target, result }),
      followUp: async (text, instruction, target) => { follow = { text, instruction, anchor: target }; },
    });
    assert.deepEqual(events, ["prepare"]);
    await Promise.all([practice.submit("换句话说", feynmanToolkit), practice.submit("ignored double click", feynmanToolkit)]);
    assert.equal(practice.produced, "换句话说"); assert.equal(practice.saved, true); assert.match(practice.error, /external process/);
    let notes = (await store.getTopic(topic.id))!.notes;
    assert.equal(notes.length, 1); assert.equal(notes[0]!.result, undefined); assert.equal(notes[0]!.body, "换句话说");
    fail = false; await practice.submit(practice.produced, feynmanToolkit);
    notes = (await new DefaultWorkspaceStore(storage).getTopic(topic.id))!.notes;
    assert.equal(notes.length, 2); assert.notEqual(notes[0]!.id, notes[1]!.id);
    assert.equal(notes[0]!.result, undefined); assert.deepEqual(notes[1]!.result, practice.result);
    assert.deepEqual(follow, { text: "换句话说", instruction: feynmanToolkit.followUp!(practice.result!), anchor });
    assert.deepEqual((await store.getMaterial(material.id))!.notes, []);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("Feynman extraction failure or empty verified standards still saves the production without result", async () => {
  for (const response of [new Error("provider offline"), JSON.stringify({ points: [] })]) {
    const root = await testSandbox("task53-degrade-");
    try {
      const storage = new NodeWorkspaceStorage(root), store = new DefaultWorkspaceStore(storage), engine = new DefaultAttentionEngine(store, storage);
      const topic = await store.createTopic({ title: "降级", target: "解释", materialIds: [], toolkits: ["feynman"] });
      await store.writeLesson(topic.id, "source.md", source);
      const contrast = createFeynmanContrast(storage, { prompt: async () => { if (response instanceof Error) throw response; return response; } });
      const practice = new RecallPractice(source, { source: { kind: "lesson" }, file: "source.md", locator: "text:line:0", quote: source }, {
        ...contrast, capture: (body, anchor, result) => engine.capture({ owner: { topicId: topic.id }, kind: "practice", body, anchor, result }), followUp: async () => { assert.fail("no result, no followUp"); },
      });
      await practice.submit("  保留原复述\n不被改写  ", feynmanToolkit);
      const notes = (await new DefaultWorkspaceStore(storage).getTopic(topic.id))!.notes;
      assert.equal(notes.length, 1); assert.equal(notes[0]!.body, "  保留原复述\n不被改写  "); assert.equal(notes[0]!.result, undefined);
      assert.equal(practice.preparation, "failed"); assert.ok(practice.error);
      assert.equal(await storage.exists(`_cache/feynman/${paragraphHash(source)}.json`), false);
    } finally { await rm(root, { recursive: true, force: true }); }
  }
});

test("disposed Feynman saves its submitted late comparison to the original anchor without a new followUp or UI callback", async () => {
  let resolve!: (result: import("../src/plugins/toolkit-feynman/index.ts").RecallResult) => void;
  const late = new Promise<import("../src/plugins/toolkit-feynman/index.ts").RecallResult>(ok => { resolve = ok; });
  let compareStarted!: () => void; const started = new Promise<void>(ok => { compareStarted = ok; });
  const saved: unknown[] = []; let changes = 0, followUps = 0;
  const anchor = { source: { kind: "lesson" as const }, file: "original.md", locator: "text:line:0", quote: source };
  const practice = new RecallPractice(source, anchor, { prepare: async () => points, compare: async () => { compareStarted(); return late; }, capture: async (...args) => { saved.push(args); }, followUp: async () => { followUps++; } }, () => { changes++; });
  const pending = practice.submit("原始提交", feynmanToolkit); await started;
  practice.dispose(); const before = changes;
  const result = { toolkit: "feynman" as const, points: points.map(point => ({ ...point, status: "covered" as const, quote: "原始提交" })) };
  resolve(result); await pending;
  assert.equal(changes, before); assert.equal(followUps, 0); assert.deepEqual(saved, [["原始提交", anchor, result]]);
  await practice.submit("离开后的新提交", feynmanToolkit); assert.equal(saved.length, 1);
});
