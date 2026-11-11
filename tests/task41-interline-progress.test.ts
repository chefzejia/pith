import assert from "node:assert/strict";
import test from "node:test";
import type { AgentProcessPort, AgentStdioHandle, DiscoveredAgentDescriptor } from "../src/core/index.ts";
import { agentInterlineTranslator } from "../src/plugins/guide-acp/index.ts";

const descriptor: DiscoveredAgentDescriptor = { id: "dsh", label: "fixture", command: "/fixture/dsh", args: [], available: true, version: null, note: "fixture" };

function boundary(hold = false) {
  const batches: string[][] = [], methods: string[] = []; let closed = 0, promptStarted!: () => void;
  const started = new Promise<void>(resolve => { promptStarted = resolve; });
  const port: AgentProcessPort = {
    findExecutable: async () => null, probeExecutable: async () => null,
    async spawnStdio(): Promise<AgentStdioHandle> {
      const listeners = new Set<(line: string) => void>();
      const send = (id: number, result: unknown) => { for (const listener of listeners) listener(JSON.stringify({ jsonrpc: "2.0", id, result })); };
      return { cwd: "/sandbox", onLine: listener => { listeners.add(listener); return () => listeners.delete(listener); },
        writeLine(line) { const request = JSON.parse(line); methods.push(request.method); if (request.method === "initialize") send(request.id, {}); else if (request.method === "session/new") send(request.id, { sessionId: "fixture" }); else if (request.method === "session/prompt") { const parts = JSON.parse(request.params.prompt[0].text.split("\n").at(-1)) as string[]; batches.push(parts); promptStarted(); if (!hold) send(request.id, { text: JSON.stringify(parts) }); } },
        async close() { closed++; } } as AgentStdioHandle;
    },
  };
  return { port, batches, methods, started, closed: () => closed };
}

test("long paragraph is split into bounded requests and reassembled exactly", async () => {
  const fixture = boundary(), translate = agentInterlineTranslator({ process: fixture.port, resolveAgent: async () => ({ descriptor }) });
  const text = "A".repeat(1200) + "😀".repeat(1200) + "Z".repeat(101); const result = await translate({ materialId: "m", file: "a.md", unitIndex: 0, targetLanguage: "zh-Hans", segments: [{ locator: "p:0", blockIndex: 0, sourceText: text, sourceHash: "" }] });
  assert.deepEqual(fixture.batches.map(batch => Array.from(batch.join("")).length), [1200, 1200, 101]); assert.equal(result.get("p:0"), text); assert.equal(fixture.closed(), 3);
});

test("cancelling an active translation cancels and closes the ACP session", async () => {
  const fixture = boundary(true), controller = new AbortController(), translate = agentInterlineTranslator({ process: fixture.port, resolveAgent: async () => ({ descriptor }) });
  const result = translate({ materialId: "m", file: "a.md", unitIndex: 0, targetLanguage: "zh-Hans", segments: [{ locator: "p:0", blockIndex: 0, sourceText: "short text", sourceHash: "" }], signal: controller.signal });
  await fixture.started; controller.abort(); await assert.rejects(result, /cancelled/); assert.ok(fixture.methods.includes("session/cancel")); assert.equal(fixture.closed(), 1);
});
