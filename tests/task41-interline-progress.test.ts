import assert from "node:assert/strict";
import test from "node:test";
import type { AgentProcessPort, AgentStdioHandle, DiscoveredAgentDescriptor } from "../src/core/index.ts";
import { agentInterlineTranslator } from "../src/plugins/guide-acp/index.ts";

const descriptor: DiscoveredAgentDescriptor = { id: "dsh", label: "fixture", command: "/fixture/dsh", args: [], available: true, version: null, note: "fixture" };

function boundary(hold = false, quoteResponse = false, emptyResponse = false) {
  const batches: string[][] = [], methods: string[] = []; let closed = 0, promptStarted!: () => void;
  const started = new Promise<void>(resolve => { promptStarted = resolve; });
  const port: AgentProcessPort = {
    findExecutable: async () => null, probeExecutable: async () => null,
    async spawnStdio(): Promise<AgentStdioHandle> {
      const listeners = new Set<(line: string) => void>();
      const send = (id: number, result: unknown) => { for (const listener of listeners) listener(JSON.stringify({ jsonrpc: "2.0", id, result })); };
      return { cwd: "/sandbox", onLine: listener => { listeners.add(listener); return () => listeners.delete(listener); },
        writeLine(line) { const request = JSON.parse(line); methods.push(request.method); if (request.method === "initialize") send(request.id, {}); else if (request.method === "session/new") send(request.id, { sessionId: "fixture" }); else if (request.method === "session/prompt") { const prompt = request.params.prompt[0].text as string; const input = JSON.parse(prompt.split("\n").at(-1)!) as string | string[]; const parts = Array.isArray(input) ? input : [input]; batches.push(parts); promptStarted(); if (!hold) send(request.id, { text: emptyResponse ? "  " : quoteResponse ? (Array.isArray(input) ? '[“我们当初瞄准的是模拟译文”]' : '“我们当初瞄准的是模拟译文”') : (Array.isArray(input) ? JSON.stringify(parts) : input) }); } },
        async close() { closed++; } } as AgentStdioHandle;
    },
  };
  return { port, batches, methods, started, closed: () => closed };
}

test("quoted passage returns literal translation without requiring model JSON escaping", async () => {
  const fixture = boundary(false, true), translate = agentInterlineTranslator({ process: fixture.port, resolveAgent: async () => ({ descriptor }) });
  const result = await translate({ materialId: "m", file: "a.md", unitIndex: 0, targetLanguage: "zh-Hans", segments: [{ locator: "p:0", blockIndex: 0, sourceText: '“We were after the C++ programmers.”', sourceHash: "" }] });
  assert.equal(result.get("p:0"), "“我们当初瞄准的是模拟译文”");
});

test("long paragraph is split into bounded requests and reassembled exactly", async () => {
  const fixture = boundary(), translate = agentInterlineTranslator({ process: fixture.port, resolveAgent: async () => ({ descriptor }) });
  const text = "A".repeat(1200) + "😀".repeat(1200) + "Z".repeat(101); const result = await translate({ materialId: "m", file: "a.md", unitIndex: 0, targetLanguage: "zh-Hans", segments: [{ locator: "p:0", blockIndex: 0, sourceText: text, sourceHash: "" }] });
  assert.deepEqual(fixture.batches.map(batch => Array.from(batch.join("")).length), [1200, 1200, 101]); assert.equal(result.get("p:0"), text); assert.equal(fixture.closed(), 3);
});

test("multiple passages retain their own mappings and empty replies fail", async () => {
  const fixture = boundary(), translate = agentInterlineTranslator({ process: fixture.port, resolveAgent: async () => ({ descriptor }) });
  const segments = [{ locator: "p:0", blockIndex: 0, sourceText: "first", sourceHash: "" }, { locator: "p:1", blockIndex: 1, sourceText: "second", sourceHash: "" }];
  const input = { materialId: "m", file: "a.md", unitIndex: 0, targetLanguage: "zh-Hans" as const, segments };
  assert.deepEqual([...await translate(input)], [["p:0", "first"], ["p:1", "second"]]); assert.deepEqual(fixture.batches, [["first"], ["second"]]);
  const empty = boundary(false, false, true), fail = agentInterlineTranslator({ process: empty.port, resolveAgent: async () => ({ descriptor }) });
  await assert.rejects(fail(input), /翻译结果不完整/); assert.equal(empty.closed(), 1);
});

test("cancelling an active translation cancels and closes the ACP session", async () => {
  const fixture = boundary(true), controller = new AbortController(), translate = agentInterlineTranslator({ process: fixture.port, resolveAgent: async () => ({ descriptor }) });
  const result = translate({ materialId: "m", file: "a.md", unitIndex: 0, targetLanguage: "zh-Hans", segments: [{ locator: "p:0", blockIndex: 0, sourceText: "short text", sourceHash: "" }], signal: controller.signal });
  await fixture.started; controller.abort(); await assert.rejects(result, /cancelled/); assert.ok(fixture.methods.includes("session/cancel")); assert.equal(fixture.closed(), 1);
});
