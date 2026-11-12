import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
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
    await storage.writeText("ME.md", "# Learner");
    const lines = Array.from({ length: 100 }, (_, index) => `line ${index}`);
    await store.importMaterial({ id: "material-one", title: "Source", kind: "book", files: [{ name: "source.md", mimeType: "text/markdown", bytes: new TextEncoder().encode(lines.join("\n")) }] });
    const topic = await store.createTopic({ id: "topic-one", title: "Topic", materialId: "material-one" });
    const engine = new DefaultAttentionEngine(store, storage);
    const tools = createGuideWorkspaceTools(store, engine, storage);
    const expectedNames = ["pith_get_context", "pith_list_repository_files", "pith_read_repository_file", "pith_read_material_section", "pith_save_note", "pith_write_lesson", "pith_configure_toolkits", "pith_settle_topic"].sort();
    assert.deepEqual(tools.map(tool => tool.name).sort(), expectedNames);
    assert.ok(tools.some(tool => tool.name === "pith_list_repository_files"));
    assert.ok(tools.some(tool => tool.name === "pith_read_repository_file"));
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
    try { assert.deepEqual(runtime.getService<GuideAgentService>("guide.agent")!.listWorkspaceTools!().map(tool => tool.name).sort(), expectedNames); } finally { runtime.stop(); }
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
    let responses: string[] = [];
    let promptCount = 0;
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
            if (request.method === "session/prompt") promptCount++;
            const result = request.method === "session/new" ? { sessionId: "test" } : request.method === "session/prompt" ? { text: responses.shift() ?? response } : {};
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

    const noteId = (await store.getTopic(topic.id))!.notes[0]!.id;
    const profileBefore = await readFile(join(dir, "ME.md"));
    const directive = `\`\`\`pith-tool\n${JSON.stringify({ name: "pith_settle_topic", arguments: { topicId: topic.id, verificationSummary: "Learner explained ownership and lifecycle", observations: [{ text: "Understands dependency ownership", noteId }] } })}\n\`\`\``;
    const misplaced = `你的回答通过了结题门控。现在结题。\n\n${directive}\n\n结题已完成。`;
    const bare = `结题判断：我按笔记记录观察并结题。\n\n---\n\npith-tool\n${JSON.stringify({ name: "pith_settle_topic", arguments: { topicId: topic.id, verificationSummary: "Learner explained ownership and lifecycle", observations: [{ text: "Understands dependency ownership", noteId }] } })}\n\n---\n\n画像里已有观察。`;
    const bareJson = `已记下：你熟悉依赖注入。\n\n${JSON.stringify({ name: "pith_remember", arguments: { topicId: topic.id, text: "熟悉依赖注入", noteId } })}\n\n\`\`\`pith-choices\n- 继续\n- 考考我\n\`\`\``;
    const inline = `你的回答达标，现在结题。 ${directive}\n\n\`\`\`pith-choices\n- 继续\n- 考考我\n\`\`\``;
    response = misplaced;
    promptCount = 0;
    await assert.rejects(reply(), /directive|围栏/i);
    assert.equal(promptCount, 4);
    assert.equal((await store.getTopic(topic.id))!.status, "exploring");
    assert.deepEqual(await readFile(join(dir, "ME.md")), profileBefore);
    assert.equal(await storage.exists("history"), false);

    response = inline;
    promptCount = 0;
    await assert.rejects(reply(), /directive|围栏/i);
    assert.equal(promptCount, 4);
    assert.equal((await store.getTopic(topic.id))!.status, "exploring");
    assert.deepEqual(await readFile(join(dir, "ME.md")), profileBefore);
    assert.equal(await storage.exists("history"), false);

    response = bare;
    promptCount = 0;
    await assert.rejects(reply(), /directive|围栏/i);
    assert.equal(promptCount, 4);
    assert.equal((await store.getTopic(topic.id))!.status, "exploring");
    assert.deepEqual(await readFile(join(dir, "ME.md")), profileBefore);
    assert.equal(await storage.exists("history"), false);

    response = bareJson;
    promptCount = 0;
    await assert.rejects(reply(), /directive|围栏/i);
    assert.equal(promptCount, 4);
    assert.equal((await store.getTopic(topic.id))!.status, "exploring");
    assert.deepEqual(await readFile(join(dir, "ME.md")), profileBefore);
    assert.equal(await storage.exists("history"), false);

    responses = [misplaced, "结题已完成。"];
    await assert.rejects(reply(), /directive|围栏/i);
    assert.equal((await store.getTopic(topic.id))!.status, "exploring");
    assert.deepEqual(await readFile(join(dir, "ME.md")), profileBefore);

    const trailingWrite = `\`\`\`pith-tool\n${JSON.stringify({ name: "pith_save_note", arguments: { topicId: topic.id, body: "must not be written" } })}\n\`\`\``;
    responses = [`${misplaced}\n${trailingWrite}`, "结题已完成。"];
    await assert.rejects(reply(), /directive|围栏/i);
    assert.equal((await store.getTopic(topic.id))!.notes.length, 2);
    responses = [`${bare}\n${trailingWrite}`, "结题已完成。"];
    await assert.rejects(reply(), /directive|围栏/i);
    assert.equal((await store.getTopic(topic.id))!.notes.length, 2);

    const wrongScope = `No.\n\`\`\`pith-tool\n${JSON.stringify({ name: "pith_settle_topic", arguments: { topicId: "topic-two", verificationSummary: "wrong" } })}\n\`\`\``;
    responses = [misplaced, wrongScope];
    await assert.rejects(reply(), /outside the current session/);
    assert.equal((await store.getTopic(topic.id))!.status, "exploring");
    assert.equal((await store.getTopic("topic-two"))!.status, "exploring");

    const quoted = `示例：\n> \`\`\`pith-tool\n> {"name":"pith_settle_topic","arguments":{}}\n> \`\`\`\n说明文字。`;
    response = quoted;
    promptCount = 0;
    assert.equal(await reply(), quoted);
    assert.equal(promptCount, 1);
    assert.equal((await store.getTopic(topic.id))!.status, "exploring");

    const plainJson = '学习 JSON：\n{"name":"student","arguments":{"course":"dependency injection"}}\n这是普通数据。';
    const quotedJson = `示例：\n> ${JSON.stringify({ name: "pith_remember", arguments: { topicId: topic.id, text: "示例" } })}\n不要执行。`;
    const fencedJson = `示例：\n\`\`\`json\n${JSON.stringify({ name: "pith_remember", arguments: { topicId: topic.id, text: "示例" } })}\n\`\`\`\n不要执行。`;
    const quotedInline = `> 示例 \`\`\`pith-tool\n> ${JSON.stringify({ name: "pith_remember", arguments: { topicId: topic.id, text: "示例" } })}\n> \`\`\``;
    for (const sample of [plainJson, quotedJson, fencedJson, quotedInline]) {
      response = sample;
      promptCount = 0;
      assert.equal(await reply(), sample);
      assert.equal(promptCount, 1);
      assert.deepEqual(await readFile(join(dir, "ME.md")), profileBefore);
    }

    const example = `示例：\n\`\`\`\npith-tool\n{"name":"pith_settle_topic","arguments":{}}\n\`\`\`\n不要执行示例。`;
    response = example;
    promptCount = 0;
    assert.equal(await reply(), example);
    assert.equal(promptCount, 1);
    assert.equal((await store.getTopic(topic.id))!.status, "exploring");

    responses = [misplaced, bare, inline, `回答通过检验。\n${directive}`];
    promptCount = 0;
    assert.equal(await reply(), "回答通过检验。");
    assert.equal(promptCount, 4);
    assert.equal((await store.getTopic(topic.id))!.status, "settled");
    assert.deepEqual((await store.readProfile()).observations.map(item => [item.text, item.noteId]), [["Understands dependency ownership", noteId]]);
    const history = await readdir(join(dir, "history"));
    assert.equal(history.length, 1);
    assert.deepEqual(await readFile(join(dir, "history", history[0]!)), profileBefore);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
