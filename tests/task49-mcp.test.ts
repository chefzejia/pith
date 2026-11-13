import assert from "node:assert/strict";
import test from "node:test";
import type { TurnStep } from "../src/core/index.ts";
import { openTurnTools, type TurnTool } from "../src/plugins/guide-acp/mcpTools.ts";
import { NodeToolServerPort } from "../src/shells/web/nodeToolServer.ts";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

test("MCP endpoint accepts notifications and continues after a tool failure", async () => {
  const steps = new Map<number, TurnStep>();
  const signal = new AbortController();
  const tools: TurnTool[] = [{
    name: "pith_read", description: "Read", inputSchema: { type: "object" }, write: false,
    async execute(input) { if (input.fail) throw new Error("unreadable"); return { text: "actual content" }; },
  }];
  let index = 0;
  const server = await openTurnTools(new NodeToolServerPort(), tools, signal.signal, (step, i) => steps.set(i, step), () => index++);
  const send = (message: object) => fetch(server.endpoint.url, { method: "POST", headers: Object.fromEntries(server.endpoint.headers.map(h => [h.name, h.value])), body: JSON.stringify(message) });
  try {
    assert.equal((await send({ jsonrpc: "2.0", method: "notifications/initialized" })).status, 202);
    assert.equal((await (await send({ jsonrpc: "2.0", id: 1, method: "server/discover" })).json()).error.code, -32601);
    assert.equal((await (await send({ jsonrpc: "2.0", id: 2, method: "initialize", params: { protocolVersion: "2025-03-26" } })).json()).result.protocolVersion, "2025-03-26");
    assert.deepEqual((await (await send({ jsonrpc: "2.0", id: 3, method: "tools/list" })).json()).result.tools.map((tool: { name: string }) => tool.name), ["pith_read"]);
    const failed = await (await send({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "pith_read", arguments: { fail: true } } })).json();
    assert.equal(failed.result.isError, true);
    assert.match(failed.result.content[0].text, /unreadable/);
    const succeeded = await (await send({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "pith_read", arguments: {} } })).json();
    assert.match(succeeded.result.content[0].text, /actual content/);
    assert.deepEqual([...steps.values()].map(step => step.kind === "tool" && step.status), ["failed", "completed"]);
  } finally { await server.drain(); await server.endpoint.close(); }
});

test("stopping preserves a started write and prevents a queued write", async () => {
  const started = deferred(), release = deferred(), secondSeen = deferred();
  const writes: string[] = [], steps = new Map<number, TurnStep>();
  const signal = new AbortController();
  const tools: TurnTool[] = [{
    name: "pith_write", description: "Write", inputSchema: { type: "object" }, write: true,
    async execute(input, _signal, beginWrite) { beginWrite!(); writes.push(String(input.value)); started.resolve(); await release.promise; return { value: input.value }; },
  }];
  let index = 0;
  const server = await openTurnTools(new NodeToolServerPort(), tools, signal.signal, (step, i) => { steps.set(i, step); if (i === 1) secondSeen.resolve(); }, () => index++);
  const call = (id: number, value: string) => fetch(server.endpoint.url, { method: "POST", headers: Object.fromEntries(server.endpoint.headers.map(h => [h.name, h.value])), body: JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name: "pith_write", arguments: { value } } }) });
  try {
    const first = call(1, "first");
    await started.promise;
    const second = call(2, "second");
    await secondSeen.promise;
    signal.abort(); release.resolve();
    const firstResult = await (await first).json(), secondResult = await (await second).json();
    assert.equal(firstResult.result.isError, undefined);
    assert.equal(secondResult.result.isError, true);
    assert.deepEqual(writes, ["first"]);
    assert.deepEqual([...steps.values()].map(step => step.kind === "tool" && step.status), ["completed", "failed"]);
  } finally { release.resolve(); await server.drain(); await server.endpoint.close(); }
});

test("MCP cancellation notification aborts its active request", async () => {
  const started = deferred();
  const signal = new AbortController(), steps = new Map<number, TurnStep>();
  const tools: TurnTool[] = [{
    name: "pith_wait", description: "Wait", inputSchema: { type: "object" }, write: false,
    async execute(_input, cancellation) {
      started.resolve();
      await new Promise<void>((_resolve, reject) => cancellation!.addEventListener("abort", () => reject(new Error("cancelled")), { once: true }));
    },
  }];
  const server = await openTurnTools(new NodeToolServerPort(), tools, signal.signal, (step, i) => steps.set(i, step), () => 0);
  const send = (message: object) => fetch(server.endpoint.url, { method: "POST", headers: Object.fromEntries(server.endpoint.headers.map(h => [h.name, h.value])), body: JSON.stringify(message) });
  try {
    const call = send({ jsonrpc: "2.0", id: 23, method: "tools/call", params: { name: "pith_wait", arguments: {} } });
    await started.promise;
    const notification = await send({ jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: 23 } });
    assert.equal(notification.status, 202);
    assert.equal((await (await call).json()).result.isError, true);
    assert.equal(steps.get(0)?.kind === "tool" && (steps.get(0) as Extract<TurnStep, { kind: "tool" }>).status, "failed");
  } finally { signal.abort(); await server.drain(); await server.endpoint.close(); }
});
