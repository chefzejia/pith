import { testToolkits } from "./guide-tools-fixture.ts";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DefaultAttentionEngine, DefaultWorkspaceStore, PluginRuntime, type AgentProcessPort, type AgentStdioHandle, type GuideAgentService, type StageReaderService, type StageTimelineService } from "../src/core/index.ts";
import { builtinRegistry } from "../src/plugins/all.ts";
import { buildScenePrompt } from "../src/plugins/guide-acp/index.ts";
import { extractProseBlocks, extractTeachingBlocks, matchTextAnchor, renderMarkdown } from "../src/plugins/stage-reader/index.ts";
import { filterProseOnly } from "../src/plugins/speech-service/index.ts";
import { parseTranscript, sliceLoopRange } from "../src/plugins/stage-timeline/index.ts";
import { createDshPluginBundle } from "../src/shells/dsh/index.ts";
import { NodeWorkspaceStorage } from "../src/shells/web/nodeStorage.ts";

test("plugins do not import Node host modules", () => {
  const walk = (directory: string): string[] => readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? walk(path) : entry.name.endsWith(".ts") ? [path] : [];
  });
  for (const path of walk(join(process.cwd(), "src/plugins"))) {
    assert.doesNotMatch(readFileSync(path, "utf8"), /\b(?:from\s*|import\s*\(\s*|import\s*)["']node:/, path);
  }
});

test("guide and DSH configure toolkits through the same workspace", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pith-wave2-guide-"));
  try {
    const storage = new NodeWorkspaceStorage(dir);
    const store = new DefaultWorkspaceStore(storage);
    await store.ensureScaffold();
    const topic = await store.createTopic({ title: "Language", target: "Speak clearly", materialIds: [], toolkits: [] });
    const engine = new DefaultAttentionEngine(store, storage);
    const runtime = new PluginRuntime(builtinRegistry.list(), { host: { id: "memory", storage }, store, engine, window: {}, "toolkit.catalog": testToolkits });
    runtime.reconcile({});
    try {
      const guide = runtime.getService<GuideAgentService>("guide.agent")!;
      const reader = runtime.getService<StageReaderService>("stage.reader")!;
      const timeline = runtime.getService<StageTimelineService>("stage.timeline")!;
      assert.equal(typeof reader.extractTeachingBlocks, "function");
      assert.equal(typeof reader.matchTextAnchor, "function");
      assert.equal(typeof timeline.sliceLoopRange, "function");
      assert.deepEqual((await guide.configureTopicToolkits!(topic.id, ["shadowing", "shadowing"])).toolkits, ["shadowing"]);
      const mounted = await store.getTopic(topic.id);
      assert.ok(mounted);
      const prompt = buildScenePrompt({ profileMarkdown: "Profile", topic: mounted, materials: [], userMessage: "Help", availableToolkits: [{ id: "custom", label: "Custom", role: "training", category: "music" }] });
      for (const text of ["可用训练工具", "custom", "Custom", "shadowing"]) assert.ok(prompt.includes(text));
      assert.match(buildScenePrompt({ profileMarkdown: "", topic: mounted, materials: [], userMessage: "Help" }), /shadowing/);
      await assert.rejects(guide.configureTopicToolkits!(topic.id, ["shadowing", "../unsafe"]), /Invalid toolkit/);
      assert.deepEqual((await store.getTopic(topic.id))!.toolkits, ["shadowing"]);
      const tool = createDshPluginBundle({ storage }).tools.find(item => item.name === "pith_configure_toolkits")!;
      await tool.execute({ topicId: topic.id, toolkits: [] });
      assert.deepEqual((await store.getTopic(topic.id))!.toolkits, []);
      await tool.execute({ topicId: topic.id, toolkits: ["shadowing", "shadowing"] });
      assert.deepEqual((await store.getTopic(topic.id))!.toolkits, ["shadowing"]);
      assert.deepEqual((await new DefaultWorkspaceStore(new NodeWorkspaceStorage(dir)).getTopic(topic.id))!.toolkits, ["shadowing"]);
      await guide.configureTopicToolkits!(topic.id, []);
      assert.deepEqual((await new DefaultWorkspaceStore(new NodeWorkspaceStorage(dir)).getTopic(topic.id))!.toolkits, []);
      await assert.rejects(tool.execute({ topicId: topic.id, toolkits: ["none"] }), /Invalid toolkit/);
      const topicPath = join(dir, "topics", topic.id, "topic.md");
      const original = readFileSync(topicPath);
      assert.deepEqual((await new DefaultWorkspaceStore(new NodeWorkspaceStorage(dir)).getTopic(topic.id))!.toolkits, []);
      await assert.rejects(tool.execute({ topicId: topic.id, toolkits: ["unknown"] }), /Invalid toolkit/);
      await assert.rejects(tool.execute({ topicId: topic.id, toolkits: ["toolkit-shadowing"] }), /Invalid toolkit/);
      assert.deepEqual(readFileSync(topicPath), original);
      await assert.rejects(tool.execute({ topicId: topic.id, toolkits: ["INVALID"] }), /Invalid toolkit/);
      await assert.rejects(tool.execute({ topicId: topic.id, toolkits: "shadowing" }), /Invalid toolkits/);
    } finally { runtime.stop(); }
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("teaching fences and callouts are addressable, escaped and excluded from speech", () => {
  const markdown = ['# Lesson', 'Before.', '```pith-teaching', 'kind: reflection', 'title: Think <script>', '', 'What did you learn?', '```', '> [!hint] Hint', '> Try again.', '> Second line.', 'After.', '~~~garden-teaching checkpoint Check', 'Do it.', '~~~', '```md', '> [!hint] Not a card', '```'].join('\n');
  const specs = extractTeachingBlocks(markdown);
  assert.deepEqual(specs.map(item => [item.kind, item.title, item.locator]), [["reflection", "Think <script>", "text:line:2"], ["hint", "Hint", "text:line:8"], ["checkpoint", "Check", "text:line:12"]]);
  assert.equal(specs[1]!.body, "Try again.\nSecond line.");
  const html = renderMarkdown(markdown);
  assert.equal((html.match(/class="pith-teaching-block"/g) ?? []).length, 3);
  assert.match(html, /data-teaching-kind="reflection" data-locator="text:line:2" data-prose="false"/);
  assert.ok(html.includes("Think &lt;script&gt;"));
  assert.deepEqual(filterProseOnly(extractProseBlocks(markdown)).map(item => item.text), ["Lesson", "Before.", "After."]);
  assert.deepEqual(extractTeachingBlocks('```pith-teaching\n{"kind":"hint","title":"Tip","body":"Go"}\n```').map(item => [item.kind, item.title, item.body]), [["hint", "Tip", "Go"]]);
  assert.equal(extractTeachingBlocks('```pith-teaching\nunterminated').length, 0);
});

test("text anchors relocate using context and distance", () => {
  const original = "red quote apple; blue quote pear";
  const anchor = { locator: `text:offset:${original.lastIndexOf("quote")}`, quote: "quote", prefix: "blue ", suffix: " pear" };
  const inserted = "inserted " + original;
  assert.equal(matchTextAnchor(inserted, anchor)!.startOffset, inserted.lastIndexOf("quote"));
  const removed = original.replace("red ", "");
  const relocated = matchTextAnchor(removed, anchor)!;
  assert.equal(relocated.startOffset, removed.lastIndexOf("quote"));
  assert.equal(removed.slice(relocated.startOffset, relocated.endOffset), "quote");
  assert.equal(relocated.prefix, "blue ");
  assert.equal(relocated.suffix, " pear");
  assert.equal(matchTextAnchor("quote xxx quote", { locator: "text:offset:9", quote: "quote" })!.startOffset, 10);
  assert.equal(matchTextAnchor(original, { locator: "text:offset:0", quote: "absent" }), null);
  assert.equal(matchTextAnchor(original, { locator: "text:offset:0", quote: "" }), null);
});

test("timeline loop slicing excludes touching boundaries and validates values", () => {
  const cues = parseTranscript("1\n00:00:01,000 --> 00:00:03,000\nHello\n你好\n\n2\n00:00:03,000 --> 00:00:05,000\nNext\n\n3\n00:00:05,000 --> 00:00:06,000\nLast");
  assert.deepEqual(sliceLoopRange(cues, 3, 5).map(cue => cue.text), ["Next"]);
  assert.deepEqual(sliceLoopRange(cues, 2, 4).map(cue => cue.text), ["Hello\n你好", "Next"]);
  for (const [start, end] of [[-1, 2], [2, 2], [3, 2], [NaN, 3], [1, Infinity]]) assert.throws(() => sliceLoopRange(cues, start!, end!), /Invalid loop range/);
});
