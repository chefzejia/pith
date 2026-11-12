import assert from "node:assert/strict";
import { readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { DefaultAttentionEngine, DefaultWorkspaceStore, type AgentProcessPort, type AgentStdioHandle, type DiscoveredAgentDescriptor } from "../src/core/index.ts";
import { LocalAcpGuideProvider } from "../src/plugins/guide-acp/acpSession.ts";
import { buildScenePrompt } from "../src/plugins/guide-acp/index.ts";
import { NodeToolServerPort } from "../src/shells/web/nodeToolServer.ts";
import { NodeWorkspaceStorage } from "../src/shells/web/nodeStorage.ts";
import { testSandbox } from "./sandbox.ts";

test("one ACP prompt reads multiple times, survives a tool error, and writes a note", async () => {
  const root = await testSandbox("task49-provider-"), storage = new NodeWorkspaceStorage(root), store = new DefaultWorkspaceStore(storage);
  await store.ensureScaffold();
  const material = await store.importMaterial({ title: "Fixture", kind: "article", files: [{ name: "source.md", mimeType: "text/markdown", bytes: new TextEncoder().encode("alpha\nbeta") }] });
  const topic = await store.createTopic({ title: "Fixture", materialId: material.id });
  let prompts = 0, calls: string[] = [], closed = false;
  const descriptor: DiscoveredAgentDescriptor = { id: "dsh", label: "fixture", command: "/fixture", args: [], available: true, version: null, note: "fixture", pithToolTitlePrefix: "mcp__pith__" };
  const port: AgentProcessPort = {
    findExecutable: async () => null, probeExecutable: async () => null,
    async spawnStdio() {
      const listeners = new Set<(line: string) => void>(); let server: { url: string; headers: { name: string; value: string }[] };
      const emit = (message: object) => { for (const listener of listeners) listener(JSON.stringify(message)); };
      const handle: AgentStdioHandle & { cwd: string } = { cwd: "/isolated/fixture", onLine(fn) { listeners.add(fn); return () => { listeners.delete(fn); }; },
        writeLine(line) {
          const request = JSON.parse(line); if (request.id === undefined) return;
          if (request.method === "initialize") { emit({ jsonrpc: "2.0", id: request.id, result: { agentCapabilities: { mcpCapabilities: { http: true } } } }); return; }
          if (request.method === "session/new") { server = request.params.mcpServers[0]; emit({ jsonrpc: "2.0", id: request.id, result: { sessionId: "fixture" } }); return; }
          if (request.method !== "session/prompt") throw new Error(`Unexpected ${request.method}`);
          prompts++;
          void (async () => {
            const call = async (id: number, name: string, args: object) => {
              calls.push(name);
              emit({ jsonrpc: "2.0", method: "session/update", params: { update: { sessionUpdate: "tool_call", toolCallId: String(id), title: `mcp__pith__${name}` } } });
              const response = await fetch(server.url, { method: "POST", headers: Object.fromEntries(server.headers.map(header => [header.name, header.value])), body: JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } }) });
              return response.json();
            };
            assert.equal((await call(1, "pith_list_material", { materialId: material.id })).result.isError, undefined);
            assert.equal((await call(2, "pith_read_material", { materialId: material.id, file: "source.md" })).result.isError, undefined);
            assert.equal((await call(3, "pith_read_material", { materialId: "elsewhere", file: "source.md" })).result.isError, true);
            assert.equal((await call(4, "pith_save_note", { body: "learned marker" })).result.isError, undefined);
            await call(5, "pith_offer_choices", { choices: ["A", "B"] });
            emit({ jsonrpc: "2.0", method: "session/update", params: { update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "完成" } } } });
            emit({ jsonrpc: "2.0", id: request.id, result: { stopReason: "end_turn" } });
          })().catch(error => emit({ jsonrpc: "2.0", id: request.id, error: { code: -1, message: String(error) } }));
        }, async close() { closed = true; } };
      return handle;
    },
  };
  const provider = new LocalAcpGuideProvider({ processPort: port, toolServer: new NodeToolServerPort(), store, storage,
    getReader: () => ({ formats: ["markdown"], sections: () => [], render: () => "", renderFile: async () => ({ format: "markdown", title: "source", html: "", sections: [], blocks: [{ index: 0, locator: "line:0", text: "alpha", isProse: true }], totalUnits: 1 }) }),
    getAgentConfig: () => ({ agentId: "dsh" }), resolveDescriptor: async () => descriptor, buildScenePrompt });
  const engine = new DefaultAttentionEngine(store, storage, () => provider);
  try {
    const turn = await engine.runTurn({ topicId: topic.id, text: "read and note" });
    assert.equal(turn.status, "completed", turn.error); assert.equal(prompts, 1); assert.equal(closed, true);
    assert.deepEqual(calls, ["pith_list_material", "pith_read_material", "pith_read_material", "pith_save_note", "pith_offer_choices"]);
    assert.equal((await store.getTopic(topic.id))!.notes.at(-1)!.body, "learned marker");
    assert.deepEqual(turn.choices, ["A", "B"]);
    assert.equal(turn.steps.filter(step => step.kind === "tool").length, 5);
    assert.ok(turn.steps.some(step => step.kind === "tool" && step.name === "pith_read_material" && step.status === "failed"));
    assert.ok(turn.steps.some(step => step.kind === "reply" && step.markdown === "完成"));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("tool-shaped reply text never executes or changes profile evidence", async () => {
  const root = await testSandbox("task49-text-only-"), storage = new NodeWorkspaceStorage(root), store = new DefaultWorkspaceStore(storage);
  await store.ensureScaffold(); const topic = await store.createTopic({ title: "Text fixture" });
  const original = await readFile(join(root, "ME.md"));
  const call = JSON.stringify({ name: "pith_settle_topic", arguments: { verificationSummary: "claimed" } });
  const examples = [`结题已完成。\n\n\`\`\`pith-tool\n${call}\n\`\`\`\n后续说明`, `已结题。\n\npith-tool\n${call}`, `已记下。\n\n${JSON.stringify({ name: "pith_remember", arguments: { text: "claimed" } })}`, `现在结题。 \`\`\`pith-tool\n${call}\n\`\`\``];
  let response = "";
  const port: AgentProcessPort = { findExecutable: async () => null, probeExecutable: async () => null, async spawnStdio() {
    const listeners = new Set<(line: string) => void>();
    return { cwd: "/isolated", onLine(fn) { listeners.add(fn); return () => { listeners.delete(fn); }; }, writeLine(line) {
      const request = JSON.parse(line); if (request.id === undefined) return;
      const result = request.method === "initialize" ? { agentCapabilities: { mcpCapabilities: { http: true } } } : request.method === "session/new" ? { sessionId: "fixture" } : request.method === "session/prompt" ? { text: response } : {};
      for (const fn of listeners) fn(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }));
    }, async close() {} } as AgentStdioHandle;
  } };
  const descriptor: DiscoveredAgentDescriptor = { id: "dsh", label: "fixture", command: "/fixture", args: [], available: true, version: null, note: "", pithToolTitlePrefix: "mcp__pith__" };
  const provider = new LocalAcpGuideProvider({ processPort: port, toolServer: new NodeToolServerPort(), storage, store, getAgentConfig: () => ({ agentId: "dsh" }), resolveDescriptor: async () => descriptor, buildScenePrompt });
  const engine = new DefaultAttentionEngine(store, storage, () => provider);
  try {
    for (const example of examples) {
      response = example; const turn = await engine.runTurn({ topicId: topic.id, text: "question" });
      assert.equal(turn.status, "completed"); assert.ok(turn.steps.some(step => step.kind === "reply" && step.markdown === example));
      assert.equal((await store.getTopic(topic.id))!.status, "exploring");
      assert.deepEqual(await readFile(join(root, "ME.md")), original);
      assert.equal(await storage.exists("history"), false);
    }
    assert.deepEqual(await readdir(join(root, "topics", topic.id)), ["conversation.json", "topic.md"]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("agent exit during a prompt persists a failed turn with its original error", async () => {
  const root = await testSandbox("task49-agent-exit-"), storage = new NodeWorkspaceStorage(root), store = new DefaultWorkspaceStore(storage);
  await store.ensureScaffold(); const topic = await store.createTopic({ title: "Exit fixture" });
  const descriptor: DiscoveredAgentDescriptor = { id: "dsh", label: "fixture", command: "/fixture", args: [], available: true, version: null, note: "", pithToolTitlePrefix: "mcp__pith__" };
  const port: AgentProcessPort = { findExecutable: async () => null, probeExecutable: async () => null, async spawnStdio() {
    let line: ((message: string) => void) | undefined, exit: ((code: number | null, signal: string | null) => void) | undefined;
    return { cwd: "/isolated", onLine(fn) { line = fn; return () => { line = undefined; }; }, onExit(fn) { exit = fn; return () => { exit = undefined; }; }, writeLine(raw) {
      const request = JSON.parse(raw); if (request.id === undefined) return;
      if (request.method === "session/prompt") { exit?.(17, null); return; }
      const result = request.method === "initialize" ? { agentCapabilities: { mcpCapabilities: { http: true } } } : { sessionId: "fixture" };
      line?.(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }));
    }, async close() {} } as AgentStdioHandle;
  } };
  const provider = new LocalAcpGuideProvider({ processPort: port, toolServer: new NodeToolServerPort(), storage, store, getAgentConfig: () => ({ agentId: "dsh" }), resolveDescriptor: async () => descriptor, buildScenePrompt });
  const engine = new DefaultAttentionEngine(store, storage, () => provider);
  try {
    const turn = await engine.runTurn({ topicId: topic.id, text: "preserve question" });
    assert.equal(turn.status, "failed"); assert.match(turn.error!, /exited unexpectedly \(17\)/);
    assert.equal((await engine.getConversation(topic.id))[0]!.user.text, "preserve question");
    assert.equal(JSON.parse(await storage.readText(`topics/${topic.id}/conversation.json`))[0].status, "failed");
  } finally { await rm(root, { recursive: true, force: true }); }
});
