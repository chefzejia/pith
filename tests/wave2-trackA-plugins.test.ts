import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DefaultAttentionEngine, DefaultWorkspaceStore, PluginRuntime, type AgentProcessPort, type AgentStdioHandle, type GuideAgentService, type StageReaderService, type StageTimelineService } from "../src/core/index.ts";
import { builtinRegistry } from "../src/plugins/all.ts";
import { buildScenePrompt, LocalAcpGuideProvider, parseToolkitDirective } from "../src/plugins/guide-acp/index.ts";
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
    const topic = await store.createTopic({ title: "Language", target: "Speak clearly" });
    const engine = new DefaultAttentionEngine(store, storage);
    const runtime = new PluginRuntime(builtinRegistry.list(), { host: { id: "memory", storage }, store, engine, window: {} });
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
      const prompt = buildScenePrompt({ profileMarkdown: "Profile", topic: mounted, userMessage: "Help", availableToolkits: [{ id: "custom", label: "Custom", category: "music" }] });
      for (const text of ["Dojo Toolkits", "custom: Custom", "shadowing"]) assert.ok(prompt.includes(text));
      assert.match(buildScenePrompt({ profileMarkdown: "", topic: mounted, userMessage: "Help" }), /shadowing: 4-Stage Language Shadowing/);
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
      await tool.execute({ topicId: topic.id, toolkits: ["none"] });
      const topicPath = join(dir, "topics", topic.id, "topic.md");
      const original = readFileSync(topicPath);
      assert.deepEqual((await new DefaultWorkspaceStore(new NodeWorkspaceStorage(dir)).getTopic(topic.id))!.toolkits, ["none"]);
      assert.deepEqual(readFileSync(topicPath), original);
      await assert.rejects(tool.execute({ topicId: topic.id, toolkits: ["INVALID"] }), /Invalid toolkit/);
      await assert.rejects(tool.execute({ topicId: topic.id, toolkits: "shadowing" }), /Invalid toolkits/);
    } finally { runtime.stop(); }
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("ACP toolkit directive is validated and persisted", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pith-wave2-acp-"));
  try {
    const storage = new NodeWorkspaceStorage(dir);
    const store = new DefaultWorkspaceStore(storage);
    await store.ensureScaffold();
    const topic = await store.createTopic({ title: "Language", target: "Speak" });
    let closed = false;
    const port: AgentProcessPort = {
      searchPaths: () => [], findExecutable: async () => null, probeExecutable: async () => null,
      async spawnStdio() {
        let listener: (line: string) => void = () => {};
        const handle: AgentStdioHandle = {
          pid: 1,
          onLine(fn) { listener = fn; return () => { listener = () => {}; }; },
          writeLine(line) {
            const request = JSON.parse(line) as { id?: number; method: string };
            if (request.id === undefined) return;
            const result = request.method === "session/new" ? { sessionId: "test" } : request.method === "session/prompt" ? { text: '练习跟读。\n```pith-toolkits\n["shadowing"]\n```' } : {};
            listener(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }));
          },
          async close() { closed = true; },
        };
        return handle;
      },
    };
    const provider = new LocalAcpGuideProvider({ processPort: port, store, getAgentConfig: () => ({ agentId: "dsh" }), resolveDescriptor: async () => ({ id: "dsh", label: "DSH", command: "dsh", args: [], version: "1", available: true, note: "" }), buildScenePrompt });
    assert.equal(await provider.reply({ topicId: topic.id, conversation: [] }), "练习跟读。");
    assert.deepEqual((await store.getTopic(topic.id))!.toolkits, ["shadowing"]);
    assert.equal(closed, true);
    const bad = 'Text\n```pith-toolkits\n["../bad"]\n```';
    assert.deepEqual(parseToolkitDirective(bad), { text: bad, toolkits: null });
    assert.deepEqual(parseToolkitDirective('Text\n```pith-toolkits\n[]\n```\nmore'), { text: 'Text\n```pith-toolkits\n[]\n```\nmore', toolkits: null });
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
