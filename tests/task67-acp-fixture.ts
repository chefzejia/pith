import assert from "node:assert/strict";
import type { AgentProcessPort, AgentStdioHandle, WorkspaceStore } from "../src/core/index.ts";
import { LocalAcpGuideProvider, buildScenePrompt } from "../src/plugins/guide-acp/index.ts";
import { NodeToolServerPort } from "../src/shells/web/nodeToolServer.ts";
import type { NodeWorkspaceStorage } from "../src/shells/web/nodeStorage.ts";

type ToolCall = <T>(name: string, input: object) => Promise<T>;

/** Script the ACP peer only. The actual provider opens and drains its authenticated MCP endpoint. */
export function libraryAgent(workspace: string, store: WorkspaceStore, storage: NodeWorkspaceStorage, answer: (scene: string, call: ToolCall) => Promise<string>) {
  const prompts: string[] = [];
  const processPort: AgentProcessPort = {
    findExecutable: async () => null,
    probeExecutable: async () => null,
    async spawnStdio() {
      let listener: ((line: string) => void) | undefined;
      let endpoint: { url: string; headers: { name: string; value: string }[] };
      const emit = (message: object) => listener?.(JSON.stringify({ jsonrpc: "2.0", ...message }));
      return {
        cwd: workspace,
        onLine(callback) { listener = callback; return () => { listener = undefined; }; },
        writeLine(line) {
          const request = JSON.parse(line);
          if (request.id === undefined) return;
          if (request.method === "initialize") {
            emit({ id: request.id, result: { agentCapabilities: { mcpCapabilities: { http: true } } } });
            return;
          }
          if (request.method === "session/new") {
            endpoint = request.params.mcpServers[0];
            emit({ id: request.id, result: { sessionId: "library-fixture" } });
            return;
          }
          assert.equal(request.method, "session/prompt");
          const scene: string = request.params.prompt[0].text;
          prompts.push(scene);
          let sequence = 0;
          const call: ToolCall = async (name, args) => {
            assert.equal(new URL(endpoint.url).hostname, "127.0.0.1");
            const response = await fetch(endpoint.url, {
              method: "POST", headers: Object.fromEntries(endpoint.headers.map(({ name, value }) => [name, value])),
              body: JSON.stringify({ jsonrpc: "2.0", id: ++sequence, method: "tools/call", params: { name, arguments: args } }),
            });
            const { result, error } = await response.json();
            assert.equal(response.status, 200);
            assert.equal(error, undefined, JSON.stringify(error));
            assert.equal(result.isError, undefined, result.content[0].text);
            return JSON.parse(result.content[0].text);
          };
          void answer(scene, call).then(markdown => {
            emit({ method: "session/update", params: { update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: markdown } } } });
            emit({ id: request.id, result: { stopReason: "end_turn" } });
          }, error => emit({ id: request.id, error: { code: -1, message: String(error) } }));
        },
        async close() {},
      } satisfies AgentStdioHandle & { cwd: string };
    },
  };
  const provider = new LocalAcpGuideProvider({
    processPort, toolServer: new NodeToolServerPort(), store, storage, buildScenePrompt,
    getAgentConfig: () => ({ agentId: "dsh" }),
    resolveDescriptor: async () => ({ id: "dsh", label: "Library fixture", command: "/fixture", args: [], available: true, version: null, note: "", pithToolTitlePrefix: "mcp__pith__" }),
  });
  return { provider, prompts };
}
