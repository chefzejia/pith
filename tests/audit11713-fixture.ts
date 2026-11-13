import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DefaultWorkspaceStore, type AgentProcessPort, type AgentStdioHandle } from "../src/core/index.ts";
import { LocalAcpGuideProvider, buildScenePrompt } from "../src/plugins/guide-acp/index.ts";
import { NodeAgentProcessPort } from "../src/shells/web/nodeProcess.ts";
import { NodeToolServerPort } from "../src/shells/web/nodeToolServer.ts";
import { NodeWorkspaceStorage } from "../src/shells/web/nodeStorage.ts";
import { createPithWebServer } from "../src/shells/web/server.ts";
import { testToolkits } from "./guide-tools-fixture.ts";

/** Faults exist only at the storage/OS-process boundary; product MCP, engine and UI stay intact. */
export async function auditRetryFixture(root: string, outcomes = "failed,failed,completed") {
  const workspace = join(root, "workspace"); await mkdir(workspace, { recursive: true });
  class SummaryFailureStorage extends NodeWorkspaceStorage {
    failPath = ""; failures = 0;
    override async writeText(path: string, value: string): Promise<void> {
      if (path === this.failPath) { this.failPath = ""; this.failures++; throw new Error("受控磁盘故障：结题总结写入失败"); }
      return super.writeText(path, value);
    }
  }
  const storage = new SummaryFailureStorage(workspace), store = new DefaultWorkspaceStore(storage);
  await store.ensureScaffold();
  const topic = await store.createTopic({ title: "审计夹具：重试与撤销", target: "解释前提与反例", materialIds: [], toolkits: [] });
  await store.appendTopicNote(topic.id, { kind: "note", author: "user", body: "受控夹具的用户证据：结论依赖其前提。" });
  await store.writeLesson(topic.id, "01-证据.md", "# 受控故障夹具\n\n真实 Engine / MCP / Store / UI。协议进程固定输出，一次磁盘错误；没有真实模型。\n\n在向导中发送一句话，再点击重新请求、撤销。" );
  storage.failPath = `topics/${topic.id}/topic.md`;
  const native = new NodeAgentProcessPort({ workspaceRoot: workspace }), handles = new Set<AgentStdioHandle>();
  const processes: { pid: number | undefined; cwd: string | undefined; closed: boolean; exit?: number | null }[] = [];
  let attempts = 0;
  const processPort: AgentProcessPort = {
    findExecutable: name => native.findExecutable(name), probeExecutable: (command, args) => native.probeExecutable(command, args),
    async spawnStdio(spec) {
      const handle = await native.spawnStdio({ ...spec, env: { ...spec.env, PITH_FIXTURE_ATTEMPT: String(++attempts), PITH_FIXTURE_OUTCOMES: outcomes } });
      const record = { pid: handle.pid, cwd: (handle as AgentStdioHandle & { cwd?: string }).cwd, closed: false, exit: undefined as number | null | undefined }; processes.push(record); handles.add(handle);
      handle.onExit?.(code => { record.exit = code; });
      return { ...handle, async close(timeout) { try { await handle.close(timeout); record.closed = true; } finally { handles.delete(handle); } } };
    },
  };
  const provider = new LocalAcpGuideProvider({ processPort, toolServer: new NodeToolServerPort(), store, storage, getToolkits: () => testToolkits,
    getAgentConfig: () => ({ agentId: "dsh" }), buildScenePrompt,
    resolveDescriptor: async () => ({ id: "dsh", label: "受控 Node ACP 进程（非真实 Agent）", command: process.execPath, args: [fileURLToPath(new URL("./fixtures/audit11713-agent.mjs", import.meta.url))], available: true, version: null, note: "受控协议夹具", pithToolTitlePrefix: "mcp__pith__" }) });
  let server: Awaited<ReturnType<typeof createPithWebServer>>;
  try { server = await createPithWebServer({ workspaceDir: workspace, guideProvider: provider }); }
  catch (error) { for (const handle of handles) await handle.close(); throw error; }
  const address = server.address(); if (!address || typeof address === "string") throw new Error("Fixture server failed to listen");
  return { base: `http://127.0.0.1:${address.port}`, store, storage, topic, provider, workspace, processes, attempts: () => attempts,
    async close() {
      try { await fetch(`http://127.0.0.1:${address.port}/api/chat/stop`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ topicId: topic.id }) }); }
      finally { for (const handle of handles) await handle.close(); await new Promise<void>((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); server.closeAllConnections(); }); }
    } };
}
