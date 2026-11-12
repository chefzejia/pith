import assert from "node:assert/strict";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { DefaultAttentionEngine, DefaultWorkspaceStore, type AgentProcessPort, type AgentStdioHandle, type DiscoveredAgentDescriptor, type TurnStep, type WorkspaceStoragePort } from "../src/core/index.ts";
import { LocalAcpGuideProvider } from "../src/plugins/guide-acp/acpSession.ts";
import { buildScenePrompt } from "../src/plugins/guide-acp/index.ts";
import { openTurnTools } from "../src/plugins/guide-acp/mcpTools.ts";
import { createScopedTools } from "../src/plugins/guide-acp/tools.ts";
import { NodeWorkspaceStorage } from "../src/shells/web/nodeStorage.ts";
import { NodeToolServerPort } from "../src/shells/web/nodeToolServer.ts";
import { testSandbox } from "./sandbox.ts";

function gate() { let release!: () => void; const promise = new Promise<void>(resolve => { release = resolve; }); return { promise, release }; }

for (const phase of ["before", "after"] as const) test(`stopping ${phase} a note write follows the actual disk state`, async () => {
  const root = await testSandbox("task49-durable-stop-"), disk = new NodeWorkspaceStorage(root), initialStore = new DefaultWorkspaceStore(disk);
  await initialStore.ensureScaffold();
  const topic = await initialStore.createTopic({ title: "Stop fixture" }), path = `topics/${topic.id}/topic.md`;
  const before = await readFile(join(root, path), "utf8"), arrived = gate(), resume = gate();
  let active = true;
  const storage: WorkspaceStoragePort = {
    mutationIdentity: disk.mutationIdentity,
    exists: path => disk.exists(path), readBinary: path => disk.readBinary(path), list: path => disk.list(path),
    async readText(path) { const result = await disk.readText(path); if (active && phase === "before" && path === `topics/${topic.id}/topic.md`) { active = false; arrived.release(); await resume.promise; } return result; },
    async writeText(path, value) { await disk.writeText(path, value); if (active && phase === "after" && path === `topics/${topic.id}/topic.md`) { active = false; arrived.release(); await resume.promise; } },
    createText: (path, value) => disk.createText(path, value), writeBinary: (path, value) => disk.writeBinary(path, value), createBinary: (path, value) => disk.createBinary(path, value), copy: (from, to) => disk.copy(from, to), processText: (path, update) => disk.processText(path, update), mkdir: path => disk.mkdir(path),
  };
  const store = new DefaultWorkspaceStore(storage), controller = new AbortController(), steps = new Map<number, TurnStep>();
  const tools = createScopedTools({ topicId: topic.id, store, storage, onChoices: () => {} });
  const server = await openTurnTools(new NodeToolServerPort(), tools, controller.signal, (step, index) => steps.set(index, step), () => 0);
  try {
    const response = fetch(server.endpoint.url, { method: "POST", headers: Object.fromEntries(server.endpoint.headers.map(header => [header.name, header.value])), body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "pith_save_note", arguments: { body: "persisted marker" } } }) });
    await arrived.promise; controller.abort(); resume.release();
    const result = await (await response).json();
    const actual = await readFile(join(root, path), "utf8"), step = steps.get(0);
    if (phase === "before") { assert.equal(actual, before); assert.equal(result.result.isError, true); assert.ok(step?.kind === "tool" && step.status === "failed"); }
    else { assert.match(actual, /persisted marker/); assert.equal(result.result.isError, undefined); assert.ok(step?.kind === "tool" && step.status === "completed" && step.effects.some(effect => effect.kind === "note")); }
  } finally { resume.release(); await server.drain(); await server.endpoint.close(); await rm(root, { recursive: true, force: true }); }
});

test("ACP cancellation persists a started disk write and rejects a queued write", async () => {
  const root = await testSandbox("task49-acp-durable-"), disk = new NodeWorkspaceStorage(root), initial = new DefaultWorkspaceStore(disk);
  await initial.ensureScaffold(); const topic = await initial.createTopic({ title: "Durable" });
  const entered = gate(), resume = gate(), queued = gate(); let intercept = true;
  const storage: WorkspaceStoragePort = {
    mutationIdentity: disk.mutationIdentity, exists: path => disk.exists(path), readText: path => disk.readText(path), readBinary: path => disk.readBinary(path), list: path => disk.list(path),
    async writeText(path, value) { await disk.writeText(path, value); if (intercept && path === `topics/${topic.id}/topic.md`) { intercept = false; entered.release(); await resume.promise; } },
    createText: (path, value) => disk.createText(path, value), writeBinary: (path, value) => disk.writeBinary(path, value), createBinary: (path, value) => disk.createBinary(path, value), copy: (from, to) => disk.copy(from, to), processText: (path, update) => disk.processText(path, update), mkdir: path => disk.mkdir(path),
  };
  const store = new DefaultWorkspaceStore(storage), descriptor: DiscoveredAgentDescriptor = { id: "dsh", label: "fixture", command: "/fixture", args: [], available: true, version: null, note: "", pithToolTitlePrefix: "mcp__pith__" };
  const port: AgentProcessPort = { findExecutable: async () => null, probeExecutable: async () => null, async spawnStdio() {
    let listener: ((line: string) => void) | undefined, endpoint: { url: string; headers: { name: string; value: string }[] }, promptId: number;
    const emit = (value: object) => listener?.(JSON.stringify(value));
    return { cwd: "/isolated", onLine(fn) { listener = fn; return () => { listener = undefined; }; }, writeLine(raw) {
      const request = JSON.parse(raw);
      if (request.method === "session/cancel") { emit({ jsonrpc: "2.0", id: promptId, result: { stopReason: "cancelled" } }); return; }
      if (request.id === undefined) return;
      if (request.method === "initialize") emit({ jsonrpc: "2.0", id: request.id, result: { agentCapabilities: { mcpCapabilities: { http: true } } } });
      else if (request.method === "session/new") { endpoint = request.params.mcpServers[0]; emit({ jsonrpc: "2.0", id: request.id, result: { sessionId: "fixture" } }); }
      else if (request.method === "session/prompt") {
        promptId = request.id;
        const call = (id: number, body: string) => fetch(endpoint.url, { method: "POST", headers: Object.fromEntries(endpoint.headers.map(header => [header.name, header.value])), body: JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name: "pith_save_note", arguments: { body } } }) });
        void call(1, "started write").catch(() => {}); void entered.promise.then(() => call(2, "queued write")).catch(() => {});
      }
    }, async close() {} } as AgentStdioHandle;
  } };
  const provider = new LocalAcpGuideProvider({ processPort: port, toolServer: new NodeToolServerPort(), storage, store, getAgentConfig: () => ({ agentId: "dsh" }), resolveDescriptor: async () => descriptor, buildScenePrompt });
  const engine = new DefaultAttentionEngine(store, storage, () => provider), controller = new AbortController();
  try {
    const running = engine.runTurn({ topicId: topic.id, text: "question" }, { signal: controller.signal, onUpdate(turn) { if (turn.steps.filter(step => step.kind === "tool").length === 2) queued.release(); } });
    await queued.promise; controller.abort(); resume.release();
    const turn = await running; assert.equal(turn.status, "stopped");
    const steps = turn.steps.filter(step => step.kind === "tool");
    assert.equal(steps[0]!.status, "completed"); assert.ok(steps[0]!.effects.some(effect => effect.kind === "note")); assert.equal(steps[1]!.status, "failed");
    const notes = (await initial.getTopic(topic.id))!.notes; assert.deepEqual(notes.map(note => note.body), ["started write"]);
    assert.equal(JSON.parse(await disk.readText(`topics/${topic.id}/conversation.json`))[0].status, "stopped");
  } finally { controller.abort(); resume.release(); await rm(root, { recursive: true, force: true }); }
});
