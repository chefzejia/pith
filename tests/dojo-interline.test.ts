import assert from "node:assert/strict";
import test from "node:test";
import { PluginRuntime, type InterlineSourceSegment, type PluginContext, type Topic, type WorkspaceStoragePort } from "../src/core/index.ts";
import { builtinRegistry } from "../src/plugins/all.ts";
import { computeSourceHash, interlineInUse, interlineToolkit, planNeighborhoodOrder, renderInterlineHtml } from "../src/plugins/dojo-interline/index.ts";
import { InterlinePreparationCoordinator, type InterlineCoordinatorOptions } from "../src/plugins/dojo-interline/coordinator.ts";

function storage(): WorkspaceStoragePort & { files: Map<string, string> } {
  const files = new Map<string, string>();
  return { files, exists: async path => files.has(path), readText: async path => { const text = files.get(path); if (text === undefined) throw new Error("missing"); return text; },
    writeText: async (path, text) => { files.set(path, text); }, mkdir: async () => {},
    createText: async () => { throw new Error("unused"); }, readBinary: async () => { throw new Error("unused"); },
    writeBinary: async () => { throw new Error("unused"); }, createBinary: async () => { throw new Error("unused"); },
    processText: async () => { throw new Error("unused"); }, list: async () => [] };
}

function segment(text: string, index = 0): InterlineSourceSegment {
  return { locator: `p:${index}`, blockIndex: index, sourceText: text, sourceHash: "untrusted" };
}

function options(overrides: Partial<InterlineCoordinatorOptions> = {}): InterlineCoordinatorOptions {
  return { materialId: "../material", file: "book/chapter.html", targetLanguage: "zh-Hans", units: [[segment("source")]],
    translator: async input => new Map(input.segments.map(item => [item.locator, `translated ${item.sourceText}`])), ...overrides };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

test("hash normalization and neighborhood priority", () => {
  assert.equal(computeSourceHash("  cafe\u0301\nword "), computeSourceHash("café word"));
  assert.notEqual(computeSourceHash("source"), computeSourceHash("changed"));
  assert.deepEqual(planNeighborhoodOrder(3, 8, 2), [3, 4, 2, 5, 1, 6, 7, 0]);
  assert.deepEqual(planNeighborhoodOrder(0, 4), [0, 1, 2, 3]);
  assert.deepEqual(planNeighborhoodOrder(3, 4), [3, 2, 0, 1]);
  assert.deepEqual(planNeighborhoodOrder(1, 3, 0), [1, 2, 0]);
  assert.deepEqual(planNeighborhoodOrder(0, 0), []);
  assert.throws(() => planNeighborhoodOrder(-1, 3), RangeError);
});

test("rendering preserves original and escapes bilingual subtitles inside located prose", () => {
  const html = '<section><p class="body" data-locator="p:&amp;1" data-prose="true">Hello <em>world</em>.</p><p data-locator="skip" data-prose="false">Other</p></section>';
  const translations = new Map([["p:&1", '<img src=x onerror="alert(1)"> & \''] , ["skip", "ignored"]]);
  assert.equal(renderInterlineHtml(html, translations, "original"), html);
  assert.equal(renderInterlineHtml(html, new Map(), "bilingual"), html);
  for (const mode of ["bilingual", "subtitle-primary"] as const) {
    const rendered = renderInterlineHtml(html, translations, mode);
    assert.equal(rendered, `<section><p class="body" data-locator="p:&amp;1" data-prose="true" data-interline-mode="${mode}">Hello <em>world</em>.<span class="pith-interline-subtitle" data-interline-mode="${mode}" data-prose="false">&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; &#39;</span></p><p data-locator="skip" data-prose="false">Other</p></section>`);
  }
});

test("cache replays valid units and invalidates changed source and target language", async () => {
  const cache = storage(); let calls = 0;
  const translator: InterlineCoordinatorOptions["translator"] = async input => { calls++; return new Map(input.segments.map(item => [item.locator, "译文"])); };
  const first = new InterlinePreparationCoordinator(options({ storage: cache, translator }));
  await first.activateUnit(0); await first.whenIdle();
  assert.equal(calls, 1); assert.equal(first.getUnit(0)!.status, "ready");
  assert.match([...cache.files.keys()][0]!, /^_cache\/interline\/[a-f0-9]+\/[a-f0-9]+\.zh-Hans\.unit-0\.json$/);
  const hits: string[] = [];
  const second = new InterlinePreparationCoordinator(options({ storage: cache, translator, onUnit: unit => hits.push(unit.status) }));
  await second.activateUnit(0); await second.whenIdle();
  assert.equal(calls, 1); assert.deepEqual(hits, ["ready"]);
  const changed = new InterlinePreparationCoordinator(options({ storage: cache, translator, units: [[segment("changed")]] }));
  await changed.activateUnit(0); await changed.whenIdle(); assert.equal(calls, 2);
  const language = new InterlinePreparationCoordinator(options({ storage: cache, translator, targetLanguage: "ja" }));
  await language.activateUnit(0); await language.whenIdle(); assert.equal(calls, 3);
});

test("reorders after in-flight request and isolates failed units", async () => {
  const first = deferred<ReadonlyMap<string, string>>(); const started = deferred<void>(); const calls: number[] = [];
  const coordinator = new InterlinePreparationCoordinator(options({ units: Array.from({ length: 5 }, (_, i) => [segment(`source ${i}`, i)]),
    translator: async input => { calls.push(input.unitIndex); if (input.unitIndex === 0) { started.resolve(); return first.promise; } if (input.unitIndex === 3) throw new Error("translation failed"); return new Map(input.segments.map(s => [s.locator, "译文"])); } }));
  await coordinator.activateUnit(0); await started.promise;
  await coordinator.activateUnit(3);
  assert.deepEqual(calls, [0]); assert.deepEqual(coordinator.snapshot().runningUnits, [0]);
  first.resolve(new Map([["p:0", "译文"]]));
  await coordinator.whenIdle();
  assert.deepEqual(calls, [0, 3, 4, 2, 1]);
  assert.equal(coordinator.getUnit(0)!.status, "ready");
  assert.equal(coordinator.getUnit(3)!.status, "failed");
  assert.equal(coordinator.getUnit(3)!.error, "translation failed");
  assert.deepEqual(coordinator.snapshot().readyUnits, [0, 1, 2, 4]);
});

test("active cached unit replays while another unit remains in flight", async () => {
  const cache = storage();
  const units = [[segment("first", 0)], [segment("second", 1)]];
  const seed = new InterlinePreparationCoordinator(options({ storage: cache, units }));
  await seed.activateUnit(1); await seed.whenIdle();
  const firstPath = [...cache.files.keys()].find(path => path.endsWith("unit-0.json")); assert.ok(firstPath);
  cache.files.delete(firstPath);
  const pending = deferred<ReadonlyMap<string, string>>(); const started = deferred<void>(); const updates: string[] = [];
  const coordinator = new InterlinePreparationCoordinator(options({ storage: cache, units, onUnit: unit => updates.push(`${unit.unitIndex}:${unit.status}`),
    translator: async () => { started.resolve(); return pending.promise; } }));
  await coordinator.activateUnit(0); await started.promise;
  await coordinator.activateUnit(1);
  assert.deepEqual(updates, ["0:warming", "1:ready"]);
  assert.deepEqual(coordinator.snapshot().runningUnits, [0]);
  pending.resolve(new Map([["p:0", "译文"]])); await coordinator.whenIdle();
  assert.deepEqual(coordinator.snapshot().readyUnits, [0, 1]);
});

test("corrupt cache is recomputed and missing translations remain independently visible", async () => {
  const cache = storage();
  const input = options({ storage: cache, units: [[segment("one", 0), segment("two", 1)], [segment("three", 2)]] });
  const seed = new InterlinePreparationCoordinator(input);
  await seed.activateUnit(0); await seed.whenIdle();
  const firstPath = [...cache.files.keys()].find(path => path.endsWith("unit-0.json")); assert.ok(firstPath);
  cache.files.set(firstPath, "{broken");
  let calls = 0;
  const coordinator = new InterlinePreparationCoordinator({ ...input, translator: async () => { calls++; return new Map([["p:0", "译文"]]); } });
  await coordinator.activateUnit(0); await coordinator.whenIdle();
  assert.equal(calls, 1);
  assert.equal(coordinator.getUnit(0)!.status, "partial");
  assert.deepEqual(coordinator.getUnit(0)!.blocks.map(block => block.status), ["ready", "failed"]);
  assert.equal(coordinator.getUnit(1)!.status, "ready");
});

test("runtime retains interline and reader with injected topic usage", () => {
  const topic = (id: string, toolkit: string): Topic => ({ id, title: id, target: "read", status: "exploring", toolkits: [toolkit], notes: [], createdAt: "today", updatedAt: "today" });
  let topics = [topic("one", "interline"), topic("two", "dojo-interline")];
  const manifest = builtinRegistry.list().find(item => item.id === "dojo-interline"); assert.ok(manifest);
  const reader = { id: "reader", name: "Reader", description: "Reader", provides: ["stage.reader"], apply: (ctx: PluginContext) => ctx.provide("stage.reader", {}) };
  const runtime = new PluginRuntime([{ ...manifest, inUse: () => interlineInUse(topics) }, reader]);
  const config = { preset: "essentials" as const, plugins: { "dojo-interline": { enabled: false } } };
  runtime.reconcile(config);
  assert.equal(runtime.getService("dojo.interline"), interlineToolkit);
  assert.equal(runtime.active("reader"), true);
  assert.equal(runtime.statuses().find(item => item.id === "dojo-interline")!.inUseCount, 2);
  topics = []; runtime.reconcile(config); assert.equal(runtime.active("dojo-interline"), false); runtime.stop();
});
