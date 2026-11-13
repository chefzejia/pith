import { testToolkits } from "./guide-tools-fixture.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { rm } from "node:fs/promises";
import { createConnection } from "node:net";
import { DefaultAttentionEngine, DefaultWorkspaceStore, type AgentProcessPort, type AgentStdioHandle, type DiscoveredAgentDescriptor, type ToolServerPort, type GuideTurn, type TurnStep } from "../src/core/index.ts";
import { AGENT_HANDSHAKE_TIMEOUT_MS, LocalAcpGuideProvider, runOneShotAcpPrompt } from "../src/plugins/guide-acp/acpSession.ts";
import { openTurnTools, type TurnTool } from "../src/plugins/guide-acp/mcpTools.ts";
import { recoverInterruptedToolSteps } from "../src/plugins/guide-acp/turnRecovery.ts";
import { createScopedTools } from "../src/plugins/guide-acp/tools.ts";
import { NodeWorkspaceStorage } from "../src/shells/web/nodeStorage.ts";
import { NodeToolServerPort } from "../src/shells/web/nodeToolServer.ts";
import { testSandbox } from "./sandbox.ts";

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
const descriptor: DiscoveredAgentDescriptor = { id: "dsh", label: "fixture", command: "/fixture/dsh", args: [], available: true, version: null, note: "fixture", pithToolTitlePrefix: "mcp__pith__" };
type Request = { id?: number; method: string; params?: Record<string, unknown> };

// Process and HTTP boundaries are controlled; provider, engine, tools and disk store are real.
function agent(onRequest: (request: Request, wire: ReturnType<typeof agent>) => void) {
  const lines = new Set<(line: string) => void>(), errors = new Set<(error: Error) => void>(), exits = new Set<(code: number | null, signal: string | null) => void>();
  const requests: Request[] = [];
  let closed = 0;
  const wire = {
    requests, closed: () => closed,
    emit(value: unknown) { for (const listener of lines) listener(typeof value === "string" ? value : JSON.stringify(value)); },
    reply(request: Request, result: unknown) { wire.emit({ jsonrpc: "2.0", id: request.id, result }); },
    update(update: object, sessionId = "session") { wire.emit({ jsonrpc: "2.0", method: "session/update", params: { sessionId, update } }); },
    fail(error: Error) { for (const listener of errors) listener(error); },
    exit() { for (const listener of exits) listener(23, null); },
    port: {
      findExecutable: async () => null, probeExecutable: async () => null,
      async spawnStdio() {
        return {
          cwd: "/fixture/isolated", onLine(listener) { lines.add(listener); return () => { lines.delete(listener); }; },
          onError(listener) { errors.add(listener); return () => { errors.delete(listener); }; },
          onExit(listener) { exits.add(listener); return () => { exits.delete(listener); }; },
          writeLine(line) { const request = JSON.parse(line) as Request; requests.push(request); onRequest(request, wire); },
          async close() { closed++; },
        } satisfies AgentStdioHandle & { cwd: string };
      },
    } satisfies AgentProcessPort,
  };
  return wire;
}
function handshake(request: Request, wire: ReturnType<typeof agent>) {
  if (request.method === "initialize") wire.reply(request, { agentCapabilities: { mcpCapabilities: { http: true } } });
  if (request.method === "session/new") wire.reply(request, { sessionId: "session" });
}
const mcp = { url: "http://127.0.0.1:1/", headers: [], toolNames: [], onUpdate: () => {} };

test("ACP latches a crash between RPCs, validates JSON frames and refuses a missing session ID", async () => {
  for (const fault of ["exit", "null", "[]", "missing-session"] as const) {
    const wire = agent((request, wire) => {
      if (request.method === "initialize") {
        wire.reply(request, { agentCapabilities: { mcpCapabilities: { http: true } } });
        if (fault === "exit") wire.exit();
        if (fault === "null" || fault === "[]") wire.emit(fault);
      } else if (request.method === "session/new") wire.reply(request, {});
    });
    await assert.rejects(runOneShotAcpPrompt("test", { descriptor, processPort: wire.port, mcp }), fault === "exit" ? /exited unexpectedly \(23\)/ : fault === "missing-session" ? /sessionId/ : /Invalid ACP/);
    assert.equal(wire.requests.some(item => item.method === "session/prompt"), false);
    assert.equal(wire.closed(), 1);
  }
});

test("ACP handshake keeps its 60 second deadline independently of background prompt timeout", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const received = deferred();
  const wire = agent(request => { if (request.method === "initialize") received.resolve(); });
  const result = runOneShotAcpPrompt("test", { descriptor, processPort: wire.port, timeoutMs: 5_000 });
  const rejected = assert.rejects(result, /initialize timed out after 60000ms/);
  await received.promise;
  t.mock.timers.tick(AGENT_HANDSHAKE_TIMEOUT_MS);
  await rejected;
  assert.equal(wire.closed(), 1);
});

test("ACP foreground stays open beyond configured timeout, ignores foreign sessions, and stops in five seconds", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const prompted = deferred(), cancelled = deferred(), stop = new AbortController(), text: string[] = [];
  const wire = agent((request, wire) => {
    handshake(request, wire);
    if (request.method === "session/prompt") { wire.update({ sessionUpdate: "agent_message_chunk", content: { text: "wrong" } }, "foreign"); prompted.resolve(); }
    if (request.method === "session/cancel") cancelled.resolve();
  });
  const result = runOneShotAcpPrompt("test", { descriptor, processPort: wire.port, timeoutMs: 5_000, mcp, onTextDelta: delta => text.push(delta) }, stop.signal);
  const rejected = assert.rejects(result, /cancelled/);
  await prompted.promise;
  t.mock.timers.tick(600_000);
  assert.equal(wire.closed(), 0); assert.deepEqual(text, []);
  stop.abort(); await cancelled.promise;
  t.mock.timers.tick(4_999); assert.equal(wire.closed(), 0);
  t.mock.timers.tick(1); await rejected;
  assert.equal(wire.closed(), 1);
});

test("ACP background prompt timeout and failed permission writes close the owned process", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const prompted = deferred();
  const wire = agent((request, wire) => { handshake(request, wire); if (request.method === "session/prompt") prompted.resolve(); });
  const result = runOneShotAcpPrompt("test", { descriptor, processPort: wire.port, timeoutMs: 5_000 });
  const rejected = assert.rejects(result, /session\/prompt timed out after 5000ms/);
  await prompted.promise; t.mock.timers.tick(5_000); await rejected;
  assert.equal(wire.closed(), 1);
  const broken = agent((request, wire) => {
    handshake(request, wire);
    if (request.method === "session/prompt") wire.emit({ jsonrpc: "2.0", id: 99, method: "session/request_permission", params: { toolCall: { toolCallId: "unknown" }, options: [] } });
    if (request.id === 99) throw new Error("permission pipe closed");
  });
  await assert.rejects(runOneShotAcpPrompt("test", { descriptor, processPort: broken.port, mcp }), /permission pipe closed/);
  assert.equal(broken.closed(), 1);
});

function memoryEndpoint() {
  let handle!: (body: string) => Promise<string>;
  const port: ToolServerPort = { async open(callback) { handle = callback; return { url: "http://127.0.0.1:1/", headers: [], async close() {} }; } };
  return { port, async call(id: number, name: string, args: object = {}) { return JSON.parse(await handle(JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } }))); } };
}

test("tool preparation timeout aborts a stalled read, rejects late results and permits a subsequent call", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const port = memoryEndpoint(), pending = deferred<string>(), steps: TurnStep[] = [];
  let signal: AbortSignal | undefined, count = 0;
  const tool: TurnTool = { name: "pith_read", description: "read", inputSchema: {}, write: false, async execute(_args, currentSignal) { signal = currentSignal; return ++count === 1 ? pending.promise : "retry result"; } };
  let index = 0;
  const server = await openTurnTools(port.port, [tool], new AbortController().signal, (step, i) => { steps[i] = step; }, () => index++, 5_000);
  try {
    const first = port.call(1, tool.name); t.mock.timers.tick(5_000);
    assert.match((await first).result.content[0].text, /超时/);
    assert.equal(signal?.aborted, true);
    pending.resolve("late content");
    assert.match((await port.call(2, tool.name)).result.content[0].text, /retry result/);
    assert.deepEqual(steps.map(step => step.kind === "tool" && step.status), ["failed", "completed"]);
  } finally { pending.resolve("done"); await server.drain(); await server.endpoint.close(); }
});

test("drain seals the endpoint, cancels noncooperative reads, and does not wait for late completion", async () => {
  const port = memoryEndpoint(), late = deferred(), steps: TurnStep[] = [];
  const tool: TurnTool = { name: "pith_read", description: "read", inputSchema: {}, write: false, async execute() { await late.promise; return "late"; } };
  const server = await openTurnTools(port.port, [tool], new AbortController().signal, step => steps.push(step), () => 0);
  try {
    const call = port.call(1, tool.name);
    await server.drain();
    assert.equal((await call).result.isError, true);
    assert.match((await port.call(2, tool.name)).error.message, /回合已结束/);
    assert.equal(steps.at(-1)?.kind === "tool" && (steps.at(-1) as Extract<TurnStep, { kind: "tool" }>).status, "failed");
  } finally { late.resolve(); await server.endpoint.close(); }
});

test("started disk writes survive deadlines and stop while queued writes never execute", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const port = memoryEndpoint(), started = deferred(), release = deferred(), stop = new AbortController(), writes: number[] = [];
  const tool: TurnTool = { name: "pith_write", description: "write", inputSchema: {}, write: true, async execute(args, _signal, beginWrite) { beginWrite!(); writes.push(Number(args.value)); started.resolve(); await release.promise; return args; } };
  let index = 0;
  const server = await openTurnTools(port.port, [tool], stop.signal, () => {}, () => index++, 5_000);
  try {
    const first = port.call(1, tool.name, { value: 1 }); await started.promise;
    assert.match((await port.call(1, tool.name)).error.message, /Duplicate/);
    const queued = port.call(2, tool.name, { value: 2 });
    t.mock.timers.tick(5_000);
    assert.equal((await queued).result.isError, true);
    const third = port.call(3, tool.name, { value: 3 });
    assert.match((await port.call(3, tool.name)).error.message, /Duplicate/);
    assert.deepEqual(writes, [1], "a timed-out queued call cannot release the preceding write's lock");
    stop.abort(); release.resolve();
    assert.equal((await third).result.isError, true);
    assert.equal((await first).result.isError, undefined);
    await server.drain(); assert.deepEqual(writes, [1]);
  } finally { release.resolve(); await server.drain(); await server.endpoint.close(); }
});

test("real scoped tools cannot write after a preparation timeout and retain a write already on disk", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const root = await testSandbox("task56-write-"), disk = new NodeWorkspaceStorage(root);
  const store = new DefaultWorkspaceStore(disk); await store.ensureScaffold();
  const topic = await store.createTopic({ title: "recovery", target: "explain", materialIds: [], toolkits: [] });
  const reading = deferred(), releaseRead = deferred(), writing = deferred(), releaseWrite = deferred();
  let holdRead = true, holdWrite = false;
  const storage = { ...disk, mutationIdentity: disk.mutationIdentity,
    exists: disk.exists.bind(disk), readBinary: disk.readBinary.bind(disk), list: disk.list.bind(disk), mkdir: disk.mkdir.bind(disk), copy: disk.copy.bind(disk), createBinary: disk.createBinary.bind(disk), writeBinary: disk.writeBinary.bind(disk), createText: disk.createText.bind(disk), processText: disk.processText.bind(disk),
    async readText(path: string) { if (holdRead && path.endsWith("topic.md")) { reading.resolve(); await releaseRead.promise; } return disk.readText(path); },
    async writeText(path: string, text: string) { await disk.writeText(path, text); if (holdWrite && path.endsWith("topic.md")) { writing.resolve(); await releaseWrite.promise; } },
  };
  const port = memoryEndpoint(), stop = new AbortController(); let index = 0;
  const tools = createScopedTools({ toolkits: testToolkits, topicId: topic.id, store, storage, onChoices() {} });
  const server = await openTurnTools(port.port, tools, stop.signal, () => {}, () => index++, 5_000);
  try {
    const late = port.call(1, "pith_save_note", { body: "must not appear" }); await reading.promise;
    t.mock.timers.tick(5_000); assert.equal((await late).result.isError, true);
    holdRead = false; releaseRead.resolve();
    holdWrite = true;
    const committed = port.call(2, "pith_save_note", { body: "must survive" }); await writing.promise;
    t.mock.timers.tick(5_000); stop.abort(); releaseWrite.resolve();
    assert.equal((await committed).result.isError, undefined);
    assert.deepEqual((await store.getTopic(topic.id))!.notes.map(note => note.body), ["must survive"]);
  } finally { releaseRead.resolve(); releaseWrite.resolve(); await server.drain(); await server.endpoint.close(); await rm(root, { recursive: true, force: true }); }
});

test("provider reconciles missing tool starts/ends and crash recovery retries replace the original user turn", async () => {
  const root = await testSandbox("task56-turn-"), storage = new NodeWorkspaceStorage(root), store = new DefaultWorkspaceStore(storage);
  await store.ensureScaffold(); const topic = await store.createTopic({ title: "recovery", target: "explain", materialIds: [], toolkits: [] });
  let round = 0;
  const wire = agent((request, wire) => {
    handshake(request, wire);
    if (request.method !== "session/prompt") return;
    round++;
    wire.update({ sessionUpdate: "tool_call_update", toolCallId: "missing-start", title: "read", status: "completed" });
    wire.update({ sessionUpdate: "tool_call_update", toolCallId: "missing-start", status: "in_progress" });
    wire.update({ sessionUpdate: "tool_call", toolCallId: "missing-end", title: "external", status: "in_progress" });
    wire.update({ sessionUpdate: "tool_call_update", toolCallId: "pith-lost-start", title: "mcp__pith__pith_save_note", status: "failed" });
    wire.update({ sessionUpdate: "agent_message_chunk", content: { text: "partial reply" } });
    if (round === 1) wire.exit(); else wire.reply(request, { stopReason: "end_turn" });
  });
  const provider = new LocalAcpGuideProvider({ processPort: wire.port, toolServer: new NodeToolServerPort(), store, storage, getAgentConfig: () => ({ agentId: "dsh" }), resolveDescriptor: async () => descriptor, buildScenePrompt: () => "scene" });
  const engine = new DefaultAttentionEngine(store, storage, () => provider);
  try {
    const failed = await engine.runTurn({ topicId: topic.id, text: "same question" });
    assert.equal(failed.status, "failed"); assert.match(failed.error!, /23/);
    assert.deepEqual(failed.steps.filter(step => step.kind === "tool").map(step => [step.name, step.status]), [["read", "completed"], ["external", "failed"]]);
    const retried = await engine.retryTurn(topic.id, failed.id);
    assert.equal(retried.status, "completed"); assert.equal(retried.id, failed.id);
    const turns = await engine.getConversation(topic.id);
    assert.equal(turns.length, 1); assert.equal(turns[0]!.user.text, "same question");
    assert.equal(wire.closed(), 2);
  } finally { await rm(root, { recursive: true, force: true }); }
});


test("host restart exposes interrupted tools as unconfirmed failures without changing completed effects", async () => {
  const root = await testSandbox("task56-restart-"), storage = new NodeWorkspaceStorage(root), store = new DefaultWorkspaceStore(storage);
  try {
    await store.ensureScaffold(); const topic = await store.createTopic({ title: "restart", target: "recover", materialIds: [], toolkits: [] });
    const turn: GuideTurn = { id: "interrupted", status: "running", startedAt: new Date().toISOString(), user: { text: "original question" }, choices: [], steps: [
      { kind: "tool", callId: "done", name: "pith_save_note", status: "completed", inputPreview: "{}", effects: [{ kind: "note", noteId: "saved" }] },
      { kind: "tool", callId: "unknown", name: "external", status: "running", inputPreview: "{}", effects: [] },
    ] };
    await storage.writeText(`topics/${topic.id}/conversation.json`, JSON.stringify([turn]));
    const engine = new DefaultAttentionEngine(store, storage);
    const recovered = recoverInterruptedToolSteps((await engine.getConversation(topic.id))[0]!);
    assert.equal(recovered.status, "stopped"); assert.equal(recovered.user.text, "original question");
    assert.deepEqual(recovered.steps[0], turn.steps[0]);
    assert.deepEqual(recovered.steps[1], { ...turn.steps[1], status: "failed", summary: "进程中断" });
    assert.equal(recoverInterruptedToolSteps(turn), turn, "active turn must remain running");
  } finally { await rm(root, { recursive: true, force: true }); }
});


test("tool endpoint shutdown closes an incomplete owned HTTP connection", { timeout: 2000 }, async () => {
  const endpoint = await new NodeToolServerPort().open(async () => "");
  const socket = createConnection(Number(new URL(endpoint.url).port), "127.0.0.1");
  socket.on("error", () => {});
  const closed = new Promise<void>(resolve => socket.once("close", () => resolve()));
  let stopped = false;
  try {
    await new Promise<void>((resolve, reject) => { socket.once("connect", resolve); socket.once("error", reject); });
    const accepted = new Promise<Buffer>(resolve => socket.once("data", resolve));
    socket.write(`POST / HTTP/1.1\r\nHost: 127.0.0.1\r\n${endpoint.headers[0]!.name}: ${endpoint.headers[0]!.value}\r\nContent-Length: 10000\r\nExpect: 100-continue\r\n\r\n{`);
    assert.match((await accepted).toString(), /100 Continue/);
    await endpoint.close(); stopped = true; await closed;
    assert.equal(socket.destroyed, true);
  } finally { socket.destroy(); if (!stopped) await endpoint.close().catch(() => {}); }
});
