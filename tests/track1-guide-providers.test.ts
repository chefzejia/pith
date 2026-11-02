import assert from "node:assert/strict";
import test from "node:test";
import {
  DefaultAttentionEngine,
  DefaultWorkspaceStore,
  PluginRuntime,
  type AgentProcessPort,
  type AgentProcessSpawnSpec,
  type AgentStdioHandle,
  type HostPort,
  type StorageEntry,
  type WorkspaceStoragePort,
} from "../src/core/index.ts";
import { builtinRegistry } from "../src/plugins/all.ts";
import {
  CachedAgentDetector,
  LocalAcpGuideProvider,
  buildReadOnlyAgentEnv,
  discoverLocalAgents,
  runOneShotAcpPrompt,
} from "../src/plugins/guide-acp/index.ts";

function createMemoryStorage(): WorkspaceStoragePort {
  const files = new Map<string, Uint8Array>();
  const folders = new Set<string>([""]);
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  return {
    async exists(path) {
      return files.has(path) || folders.has(path);
    },
    async readText(path) {
      const data = files.get(path);
      if (!data) throw new Error(`Missing file: ${path}`);
      return dec.decode(data);
    },
    async readBinary(path) {
      const data = files.get(path);
      if (!data) throw new Error(`Missing file: ${path}`);
      return new Uint8Array(data);
    },
    async writeText(path, data) {
      files.set(path, enc.encode(data));
    },
    async createText(path, data) {
      if (files.has(path)) throw new Error(`File exists: ${path}`);
      files.set(path, enc.encode(data));
    },
    async writeBinary(path, data) {
      files.set(path, new Uint8Array(data));
    },
    async createBinary(path, data) {
      if (files.has(path)) throw new Error(`File exists: ${path}`);
      files.set(path, new Uint8Array(data));
    },
    async processText(path, update) {
      const next = update(await this.readText(path));
      await this.writeText(path, next);
      return next;
    },
    async mkdir(path) {
      folders.add(path);
    },
    async list(prefix) {
      const out: StorageEntry[] = [];
      const seenFolders = new Set<string>();
      const norm = prefix ? `${prefix.replace(/\/$/, "")}/` : "";
      for (const key of files.keys()) {
        if (!key.startsWith(norm)) continue;
        const rest = key.slice(norm.length);
        if (!rest) continue;
        const slash = rest.indexOf("/");
        if (slash < 0) {
          out.push({ path: key, type: "file" });
        } else {
          const folder = `${norm}${rest.slice(0, slash)}`;
          if (!seenFolders.has(folder)) {
            seenFolders.add(folder);
            out.push({ path: folder, type: "folder" });
          }
        }
      }
      return out;
    },
  };
}

function createFakeProcessPort(options: {
  installed: Record<string, { path: string; version: string | null; helpText?: string }>;
  onSpawn?: (spec: AgentProcessSpawnSpec, server: {
    sendToClient: (msg: unknown) => void;
    onClientLine: (fn: (line: string) => void) => void;
  }) => void;
}): { port: AgentProcessPort; spawnedSpecs: AgentProcessSpawnSpec[]; closedCount: () => number } {
  const spawnedSpecs: AgentProcessSpawnSpec[] = [];
  let closed = 0;

  const port: AgentProcessPort = {
    searchPaths: () => ["/opt/homebrew/bin", "/usr/local/bin"],
    async findExecutable(command) {
      return options.installed[command]?.path ?? null;
    },
    async probeExecutable(execPath, args) {
      const match = Object.values(options.installed).find((item) => item.path === execPath);
      if (!match) return null;
      if (args.includes("--version")) return match.version;
      if (args.includes("--help")) return match.helpText ?? "";
      return null;
    },
    async spawnStdio(spec): Promise<AgentStdioHandle> {
      spawnedSpecs.push(spec);
      const clientListeners = new Set<(line: string) => void>();
      const serverListeners = new Set<(line: string) => void>();

      const handle: AgentStdioHandle = {
        pid: 4242,
        writeLine(line: string) {
          for (const fn of serverListeners) fn(line);
        },
        onLine(listener: (line: string) => void) {
          clientListeners.add(listener);
          return () => clientListeners.delete(listener);
        },
        async close() {
          closed += 1;
        },
      };

      if (options.onSpawn) {
        options.onSpawn(spec, {
          sendToClient(msg: unknown) {
            const raw = typeof msg === "string" ? msg : JSON.stringify(msg);
            for (const fn of clientListeners) fn(raw);
          },
          onClientLine(fn: (line: string) => void) {
            serverListeners.add(fn);
          },
        });
      }

      return handle;
    },
  };

  return { port, spawnedSpecs, closedCount: () => closed };
}

test("Track 1: discoverLocalAgents probes dsh, claude-agent-acp, and codex-acp with TTL cache", async () => {
  let probeCalls = 0;
  const { port } = createFakeProcessPort({
    installed: {
      dsh: {
        path: "/opt/homebrew/bin/dsh",
        version: "dsh 0.4.0",
        helpText: "DeepSeek Harness Agent Client Protocol (ACP) mode",
      },
      "claude-agent-acp": {
        path: "/usr/local/bin/claude-agent-acp",
        version: "0.2.1",
      },
    },
  });

  const countingPort: AgentProcessPort = {
    ...port,
    async probeExecutable(execPath, args, timeoutMs) {
      probeCalls += 1;
      return port.probeExecutable(execPath, args, timeoutMs);
    },
  };

  let clock = 1_000;
  const detector = new CachedAgentDetector({ processPort: countingPort }, 30_000, () => clock);

  const first = await detector.detect();
  assert.equal(first.length, 3);

  const dsh = first.find((a) => a.id === "dsh")!;
  assert.equal(dsh.available, true);
  assert.equal(dsh.command, "/opt/homebrew/bin/dsh");
  assert.deepEqual(dsh.args, ["--profile", "acp"]);
  assert.equal(dsh.version, "dsh 0.4.0");

  const claude = first.find((a) => a.id === "claude")!;
  assert.equal(claude.available, true);
  assert.equal(claude.command, "/usr/local/bin/claude-agent-acp");

  const codex = first.find((a) => a.id === "codex")!;
  assert.equal(codex.available, false);
  assert.equal(codex.command, null);
  assert.match(codex.note, /未找到 codex-acp/);

  const callsAfterFirst = probeCalls;
  clock += 5_000;
  await detector.detect();
  assert.equal(probeCalls, callsAfterFirst, "within 30s TTL should reuse cached descriptors");

  clock += 30_001;
  await detector.detect();
  assert.equal(probeCalls > callsAfterFirst, true, "after TTL expiry should re-probe");
});

test("Track 1: DSH read-only isolation env and ACP JSON-RPC handshake + streaming + choices", async () => {
  assert.deepEqual(buildReadOnlyAgentEnv({ id: "dsh", command: "/opt/homebrew/bin/dsh" }), {
    DSH_PERMISSION_MODE: "read-only",
  });
  assert.deepEqual(buildReadOnlyAgentEnv({ id: "claude", command: "/usr/local/bin/claude-agent-acp" }), {});

  const methodsSeen: string[] = [];
  const { port, spawnedSpecs, closedCount } = createFakeProcessPort({
    installed: {
      dsh: {
        path: "/opt/homebrew/bin/dsh",
        version: "dsh 0.4.0",
        helpText: "Agent Client Protocol",
      },
    },
    onSpawn(_spec, server) {
      server.onClientLine((line) => {
        const req = JSON.parse(line) as { id?: number; method: string; params?: Record<string, unknown> };
        methodsSeen.push(req.method);
        if (req.method === "initialize") {
          // Emit a known DSH diagnostic line first to verify noise filtering
          server.sendToClient(
            "[llm-deepseek-account] model listing from https://api.deepseek.com/models loaded 2 model(s), skipped 0 row(s)",
          );
          server.sendToClient({
            jsonrpc: "2.0",
            id: req.id,
            result: { protocolVersion: 1, agentCapabilities: {} },
          });
        } else if (req.method === "session/new") {
          assert.equal(req.params?.permissionMode, "read-only");
          server.sendToClient({
            jsonrpc: "2.0",
            id: req.id,
            result: { sessionId: "sess-42" },
          });
        } else if (req.method === "session/prompt") {
          server.sendToClient({
            jsonrpc: "2.0",
            method: "session/update",
            params: {
              sessionId: "sess-42",
              update: {
                sessionUpdate: "agent_message_chunk",
                content: { type: "text", text: "请先用自己的话复述" },
              },
            },
          });
          server.sendToClient({
            jsonrpc: "2.0",
            method: "session/update",
            params: {
              sessionId: "sess-42",
              update: {
                sessionUpdate: "agent_message_chunk",
                content: { type: "text", text: "插件栈的回退机制。" },
              },
            },
          });
          server.sendToClient({
            jsonrpc: "2.0",
            id: req.id,
            result: { stopReason: "end_turn" },
          });
        }
      });
    },
  });

  const descriptors = await discoverLocalAgents({ processPort: port });
  const dshDescriptor = descriptors.find((d) => d.id === "dsh")!;
  const deltas: string[] = [];

  const result = await runOneShotAcpPrompt("解释插件栈", {
    descriptor: dshDescriptor,
    processPort: port,
    readOnlyPaths: ["/workspace/materials"],
    onTextDelta: (delta) => deltas.push(delta),
  });

  assert.equal(result.sessionId, "sess-42");
  assert.equal(result.text, "请先用自己的话复述插件栈的回退机制。");
  assert.deepEqual(deltas, ["请先用自己的话复述", "插件栈的回退机制。"]);
  assert.deepEqual(methodsSeen, ["initialize", "session/new", "session/prompt", "session/close"]);
  assert.equal(spawnedSpecs[0]?.env?.DSH_PERMISSION_MODE, "read-only");
  assert.deepEqual(spawnedSpecs[0]?.readOnlyPaths, ["/workspace/materials"]);
  assert.equal(closedCount(), 1);
});

test("Track 1: guide-acp plugin auto-wires LocalAcpGuideProvider into AttentionEngine prepare-next-action", async () => {
  const storage = createMemoryStorage();
  const store = new DefaultWorkspaceStore(storage);
  await store.ensureScaffold();
  const topic = await store.createTopic({
    title: "Cordis 插件与能力接缝",
    target: "独立写出带栈式回退的微内核",
  });

  const { port } = createFakeProcessPort({
    installed: {
      dsh: {
        path: "/opt/homebrew/bin/dsh",
        version: "dsh 0.4.0",
        helpText: "Agent Client Protocol",
      },
    },
    onSpawn(_spec, server) {
      server.onClientLine((line) => {
        const req = JSON.parse(line) as { id?: number; method: string };
        if (req.method === "initialize") {
          server.sendToClient({ jsonrpc: "2.0", id: req.id, result: { protocolVersion: 1 } });
        } else if (req.method === "session/new") {
          server.sendToClient({ jsonrpc: "2.0", id: req.id, result: { sessionId: "sess-bg" } });
        } else if (req.method === "session/prompt") {
          server.sendToClient({
            jsonrpc: "2.0",
            id: req.id,
            result: {
              text: "用 15 分钟画一张 `setService` / `deleteService` 的栈顶切换时序图\n```pith-choices\n[\"画时序图\", \"写单测\"]\n```",
              stopReason: "end_turn",
            },
          });
        }
      });
    },
  });

  const host: HostPort = { id: "memory", storage, process: port };
  const engine = new DefaultAttentionEngine(store, storage);
  const runtime = new PluginRuntime(builtinRegistry.list(), {
    host,
    store,
    engine,
    window: {},
  });

  runtime.reconcile({
    preset: "all",
    plugins: {
      "guide-acp": {
        enabled: true,
        config: {
          persona: "studio",
          agentId: "dsh",
          timeoutMs: 15000,
        },
      },
    },
  });

  await engine.captureSelection({
    topicId: topic.id,
    kind: "highlight",
    body: "当栈顶服务卸载时，自动回退到下一层服务实例而不销毁消费方。",
  });

  const processed = await engine.processDueEffects();
  assert.equal(processed, 1);

  const updated = await store.getTopic(topic.id);
  assert.equal(updated?.nextAction, "用 15 分钟画一张 `setService` / `deleteService` 的栈顶切换时序图");
});
