import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DefaultAttentionEngine, DefaultWorkspaceStore, PluginRuntime, type AgentProcessPort, type AgentStdioHandle, type GuideAgentService } from "../src/core/index.ts";
import { builtinRegistry } from "../src/plugins/all.ts";
import { buildScenePrompt, createGuidePermissionGate, createGuideWorkspaceTools, LocalAcpGuideProvider } from "../src/plugins/guide-acp/index.ts";
import { createDshPluginBundle } from "../src/shells/dsh/index.ts";
import { NodeWorkspaceStorage } from "../src/shells/web/nodeStorage.ts";

test("workspace tools bound reads, protect imports and gate settlement", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pith-guide-tools-"));
  try {
    const storage = new NodeWorkspaceStorage(dir);
    const store = new DefaultWorkspaceStore(storage);
    await store.ensureScaffold();
    await store.writeProfile("# Learner");
    const lines = Array.from({ length: 100 }, (_, index) => `line ${index}`);
    await store.importMaterial({ id: "material-one", title: "Source", kind: "book", files: [{ name: "source.md", mimeType: "text/markdown", bytes: new TextEncoder().encode(lines.join("\n")) }] });
    const topic = await store.createTopic({ id: "topic-one", title: "Topic", materialId: "material-one" });
    const engine = new DefaultAttentionEngine(store, storage);
    const tools = createGuideWorkspaceTools(store, engine, storage);
    assert.equal(tools.length, 6);
    const call = (name: string, input: Record<string, unknown>) => {
      const tool = tools.find(item => item.name === name);
      assert.ok(tool);
      return tool.execute(input);
    };
    const context = await call("pith_get_context", { topicId: topic.id }) as { profile: { markdown: string }; topic: { id: string }; compass: { exploring: unknown[] } };
    assert.equal(context.profile.markdown, "# Learner");
    assert.equal(context.topic.id, topic.id);
    assert.equal(context.compass.exploring.length, 1);
    const excerpt = await call("pith_read_material_section", { materialId: "material-one", file: "source.md", locator: "text:line:50" }) as { text: string; startLine: number; endLine: number; truncated: boolean };
    assert.equal(excerpt.startLine, 40);
    assert.equal(excerpt.endLine, 61);
    assert.match(excerpt.text, /line 50/);
    assert.doesNotMatch(excerpt.text, /line 80/);
    assert.equal(excerpt.truncated, true);
    await assert.rejects(call("pith_read_material_section", { materialId: "material-one", file: "../source.md" }));
    await assert.rejects(call("pith_read_material_section", { materialId: "material-one", file: "source.md", locator: "page:1" }));
    await assert.rejects(createGuideWorkspaceTools(store, engine).find(item => item.name === "pith_read_material_section")!.execute({ materialId: "material-one", file: "source.md" }), /storage unavailable/);
    await call("pith_write_lesson", { materialId: "material-one", fileName: "lesson.md", markdown: "# Lesson" });
    assert.equal(await storage.readText("materials/material-one/files/lesson.md"), "# Lesson");
    await assert.rejects(call("pith_write_lesson", { materialId: "material-one", fileName: "source.md", markdown: "replace" }), /original material/);
    assert.equal(await storage.readText("materials/material-one/files/source.md"), lines.join("\n"));
    await call("pith_configure_toolkits", { topicId: topic.id, toolkits: ["shadowing"] });
    assert.deepEqual((await store.getTopic(topic.id))!.toolkits, ["shadowing"]);
    await assert.rejects(call("pith_settle_topic", { topicId: topic.id, verificationSummary: "understood" }), /learner note/);
    await call("pith_save_note", { topicId: topic.id, kind: "highlight", body: "My thought", guideRemark: "Good", anchor: { file: "source.md", locator: "text:line:50", quote: "line 50" } });
    await assert.rejects(call("pith_settle_topic", { topicId: topic.id, verificationSummary: "  " }), /verificationSummary/);
    assert.equal((await store.getTopic(topic.id))!.notes.length, 1);
    const settled = await call("pith_settle_topic", { topicId: topic.id, verificationSummary: "Applied the idea" }) as { status: string; notes: { body: string }[] };
    assert.equal(settled.status, "settled");
    assert.match(settled.notes[1]!.body, /Applied the idea/);
    await assert.rejects(call("pith_settle_topic", { topicId: topic.id, verificationSummary: "Again" }), /not exploring/);
    const dsh = createDshPluginBundle({ storage }).tools;
    assert.ok(dsh.find(tool => tool.name === "pith_read_material_section"));
    const dshSettle = dsh.find(tool => tool.name === "pith_settle_topic")!;
    const other = await store.createTopic({ title: "Other" });
    await assert.rejects(dshSettle.execute({ topicId: other.id, verificationSummary: "verified" }), /learner note/);
    const runtime = new PluginRuntime(builtinRegistry.list(), { host: { id: "memory", storage }, store, engine, window: {} });
    runtime.reconcile({});
    try { assert.equal(runtime.getService<GuideAgentService>("guide.agent")!.listWorkspaceTools!().length, 6); } finally { runtime.stop(); }
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("permission gate only accepts a registered matching MCP call once", () => {
  const gate = createGuidePermissionGate(["pith_save_note", "shell"]);
  const observe = (id: string, tool: string, server = "pith-tools", title = `mcp.${server}.${tool}`) => gate.observe({ type: "tool-call", toolCallId: id, title, rawInput: { server, tool } });
  observe("a", "pith_save_note");
  assert.equal(gate.decide({ toolCallId: "a" }), "allow_once");
  assert.equal(gate.decide({ toolCallId: "a" }), "reject_once");
  observe("b", "shell");
  observe("c", "pith_save_note", "other");
  observe("d", "pith_save_note", "pith-tools", "write_file");
  observe("e", "pith_save_note");
  gate.observe({ type: "tool-call-update", toolCallId: "e", status: "completed" });
  for (const toolCallId of ["b", "c", "d", "e", "unknown"]) assert.equal(gate.decide({ toolCallId }), "reject_once");
});

test("ACP executes only scoped workspace directives", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pith-guide-acp-"));
  try {
    const storage = new NodeWorkspaceStorage(dir);
    const store = new DefaultWorkspaceStore(storage);
    await store.ensureScaffold();
    const topic = await store.createTopic({ id: "topic-one", title: "One" });
    await store.createTopic({ id: "topic-two", title: "Two" });
    let response = '';
    const port: AgentProcessPort = {
      findExecutable: async () => null, probeExecutable: async () => null,
      async spawnStdio() {
        let listener: (line: string) => void = () => {};
        const handle: AgentStdioHandle & { cwd: string } = {
          cwd: dir,
          onLine(fn) { listener = fn; return () => {}; },
          writeLine(line) {
            const request = JSON.parse(line) as { id?: number; method: string };
            if (request.id === undefined) return;
            const result = request.method === "session/new" ? { sessionId: "test" } : request.method === "session/prompt" ? { text: response } : {};
            listener(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }));
          },
          async close() {},
        };
        return handle;
      },
    };
    const provider = new LocalAcpGuideProvider({ processPort: port, store, engine: new DefaultAttentionEngine(store, storage), storage, getAgentConfig: () => ({ agentId: "dsh" }), resolveDescriptor: async () => ({ id: "dsh", label: "DSH", command: "dsh", args: [], version: null, available: true, note: "" }), buildScenePrompt });
    const reply = () => provider.reply({ topicId: topic.id, conversation: [] });
    response = 'Saved.\n```pith-tool\n{"name":"pith_save_note","arguments":{"topicId":"topic-one","body":"Learner thought"}}\n```';
    assert.equal(await reply(), "Saved.");
    assert.equal((await store.getTopic(topic.id))!.notes[0]!.body, "Learner thought");
    response = 'Saved.\n```pith-tool\n{\n  "name": "pith_save_note",\n  "arguments": {"topicId":"topic-one","body":"Second thought"}\n}\n```';
    assert.equal(await reply(), "Saved.");
    assert.equal((await store.getTopic(topic.id))!.notes.length, 2);
    response = 'Example:\n````markdown\n```pith-tool\n{"name":"pith_save_note","arguments":{"topicId":"topic-one","body":"not a command"}}\n```\n````';
    assert.equal(await reply(), response);
    assert.equal((await store.getTopic(topic.id))!.notes.length, 2);
    response = 'Example:\n```markdown\n```pith-tool\n{"name":"pith_save_note","arguments":{"topicId":"topic-one","body":"not a command"}}\n```';
    assert.equal(await reply(), response);
    assert.equal((await store.getTopic(topic.id))!.notes.length, 2);
    response = 'No.\n```pith-tool\n{"name":"pith_save_note","arguments":{"topicId":"topic-two","body":"wrong"}}\n```';
    await assert.rejects(reply(), /outside the current session/);
    assert.equal((await store.getTopic("topic-two"))!.notes.length, 0);
    response = 'No.\n```pith-tool\n{"name":"write_file","arguments":{}}\n```';
    await assert.rejects(reply(), /Unknown guide tool/);
    response = 'No.\n```pith-tool\n{"name":"pith_settle_topic","arguments":{"topicId":"topic-one","verificationSummary":" "}}\n```';
    await assert.rejects(reply(), /verificationSummary/);
    assert.equal((await store.getTopic(topic.id))!.status, "exploring");
  } finally { await rm(dir, { recursive: true, force: true }); }
});
