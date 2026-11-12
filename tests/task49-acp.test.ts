import assert from "node:assert/strict";
import test from "node:test";
import type { AgentProcessPort, AgentStdioHandle, DiscoveredAgentDescriptor } from "../src/core/index.ts";
import { runOneShotAcpPrompt } from "../src/plugins/guide-acp/acpSession.ts";

const descriptor: DiscoveredAgentDescriptor = { id: "dsh", label: "fixture", command: "/fixture/dsh", args: [], available: true, version: null, note: "fixture", pithToolTitlePrefix: "mcp__pith__" };

function fakeAgent(http: boolean, title: string) {
  const requests: Array<Record<string, unknown>> = [];
  let permission: unknown;
  let closed = false;
  const port: AgentProcessPort = {
    findExecutable: async () => null, probeExecutable: async () => null,
    async spawnStdio() {
      const listeners = new Set<(line: string) => void>();
      const emit = (message: object) => { for (const listener of listeners) listener(JSON.stringify(message)); };
      const handle: AgentStdioHandle & { cwd: string } = {
        cwd: "/isolated/agent",
        onLine(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
        writeLine(line) {
          const request = JSON.parse(line) as Record<string, unknown>;
          requests.push(request);
          if (request.id === 99 && request.result) { permission = request.result; return; }
          if (request.id === undefined) return;
          let result: unknown = {};
          if (request.method === "initialize") result = { agentCapabilities: { mcpCapabilities: { http } } };
          if (request.method === "session/new") result = { sessionId: "session" };
          if (request.method === "session/prompt") {
            emit({ jsonrpc: "2.0", method: "session/update", params: { update: { sessionUpdate: "tool_call", toolCallId: "call", title } } });
            emit({ jsonrpc: "2.0", id: 99, method: "session/request_permission", params: { toolCall: { toolCallId: "call" }, options: [{ kind: "allow_once", optionId: "allow" }, { kind: "reject_once", optionId: "deny" }] } });
            result = { stopReason: "end_turn", text: "done" };
          }
          emit({ jsonrpc: "2.0", id: request.id, result });
        },
        async close() { closed = true; },
      };
      return handle;
    },
  };
  return { port, requests, permission: () => permission, closed: () => closed };
}

const mcp = { url: "http://127.0.0.1:1/", headers: [{ name: "x-pith-token", value: "fixture" }], toolNames: ["pith_save_note"], onUpdate: () => {} };

test("ACP requires HTTP capability and a registered title shape", async () => {
  const noHttp = fakeAgent(false, "");
  await assert.rejects(runOneShotAcpPrompt("test", { descriptor, processPort: noHttp.port, mcp }), /HTTP MCP/);
  assert.equal(noHttp.requests.some(request => request.method === "session/new"), false);
  assert.equal(noHttp.closed(), true);
  const unregistered = fakeAgent(true, "");
  await assert.rejects(runOneShotAcpPrompt("test", { descriptor: { ...descriptor, pithToolTitlePrefix: undefined }, processPort: unregistered.port, mcp }), /title format/);
  assert.equal(unregistered.closed(), true);
});

test("ACP permits only an exactly registered Pith title and uses the sandbox cwd", async () => {
  for (const [title, expected] of [["mcp__pith__pith_save_note", "allow"], ["write", "deny"], ["external__pith_save_note", "deny"], ["mcp__pith__pith_save_note_suffix", "deny"]]) {
    const agent = fakeAgent(true, title!);
    await runOneShotAcpPrompt("test", { descriptor, processPort: agent.port, cwd: "/user/workspace", mcp });
    assert.deepEqual(agent.permission(), { outcome: { outcome: "selected", optionId: expected } }, title);
    const session = agent.requests.find(request => request.method === "session/new")!;
    assert.equal((session.params as { cwd: string }).cwd, "/isolated/agent");
    assert.equal(agent.closed(), true);
  }
});
