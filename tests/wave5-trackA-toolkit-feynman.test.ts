import assert from "node:assert/strict";
import test from "node:test";
import { PluginRuntime, type Topic } from "../src/core/index.ts";
import { builtinRegistry } from "../src/plugins/all.ts";
import { feynmanInUse, feynmanToolkit, transformCue } from "../src/plugins/toolkit-feynman/index.ts";
import { shadowingToolkit } from "../src/plugins/toolkit-shadowing/index.ts";
import { buildScenePrompt, quickActionsForTopic } from "../src/plugins/guide-acp/index.ts";

function topic(toolkits: string[]): Topic {
  return { id: "t", title: "Mechanisms", target: "Explain", status: "exploring", materialIds: [], lessons: [], toolkits, notes: [], createdAt: "today", updatedAt: "today" };
}

test("Feynman scaffold only prompts blind recall and rejects retired stages", () => {
  assert.deepEqual(feynmanToolkit.stages, ["blind-produce"]);
  assert.deepEqual(feynmanToolkit.quickActions, []);
  const text = "因为缓存降低延迟；所以 `SQLite WAL` supports durable writes.\n如果索引失效，查询变慢。";
  assert.equal(transformCue(text, "blind-produce"), "【合上原文】请用自己的话向初学者解释这段机制的核心因果链与边界条件：");
  for (const stage of ["listen-decompose", "guided-follow", "scaffold-cloze", "invalid"] as const) {
    assert.throws(() => transformCue(text, stage as never), /Invalid scaffold stage/);
  }
});

test("Only shadowing diagnoses", () => {
  assert.equal(feynmanToolkit.diagnose, undefined);
  assert.equal(typeof shadowingToolkit.diagnose, "function");
});

test("registered Feynman plugin is kept active by injected topic usage and promotes its reader", () => {
  let topics = [topic(["feynman"]), topic(["feynman"]), topic(["shadowing"])];
  assert.equal(feynmanInUse(topics), 2);
  const manifest = builtinRegistry.list().find(item => item.id === "toolkit-feynman");
  assert.ok(manifest);
  assert.equal(manifest.api, "^1");
  assert.deepEqual(manifest.requires, ["stage.reader"]);
  assert.deepEqual(manifest.provides, ["toolkit.feynman"]);
  assert.equal(manifest.essential, false);
  const reader = { id: "reader", name: "Reader", description: "Reader", essential: false, provides: ["stage.reader"], apply: (ctx: import("../src/core/index.ts").PluginContext) => ctx.provide("stage.reader", {}) };
  const runtime = new PluginRuntime([{ ...manifest, inUse: () => feynmanInUse(topics) }, reader]);
  const config = { preset: "essentials" as const, plugins: { "toolkit-feynman": { enabled: false } } };
  try {
    runtime.reconcile(config);
    assert.equal(runtime.active("toolkit-feynman"), true);
    assert.equal(runtime.active("reader"), true);
    assert.equal(runtime.getService("toolkit.feynman"), feynmanToolkit);
    assert.equal(runtime.statuses().find(status => status.id === "toolkit-feynman")!.inUseCount, 2);
    topics = [topic([])];
    runtime.reconcile(config);
    assert.equal(runtime.active("toolkit-feynman"), false);
    assert.equal(runtime.active("reader"), false);
    assert.equal(runtime.getService("toolkit.feynman"), undefined);
  } finally { runtime.stop(); }
});

test("Guide merges only mounted toolkit actions and defaults to both toolkit descriptions", () => {
  const current = topic(["feynman", "shadowing"]);
  const actions = quickActionsForTopic(current, [feynmanToolkit, shadowingToolkit]);
  assert.deepEqual(actions.map(action => action.id), ["plan-curriculum", "shadowing-coach"]);
  assert.deepEqual(quickActionsForTopic(topic(["feynman"]), [feynmanToolkit]).map(action => action.id), ["plan-curriculum"]);
  assert.deepEqual(quickActionsForTopic(topic([]), [feynmanToolkit]).map(action => action.id), ["plan-curriculum"]);
  const prompt = buildScenePrompt({ profileMarkdown: "", topic: current, materials: [], userMessage: "Explain", availableToolkits: [shadowingToolkit, feynmanToolkit] });
  assert.match(prompt, /影子跟读/);
  assert.match(prompt, /费曼复述/);
  const explicit = buildScenePrompt({ profileMarkdown: "", topic: current, materials: [], userMessage: "Explain", availableToolkits: [] });
  assert.doesNotMatch(explicit, /费曼复述/);
});
