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
  buildScenePrompt,
  buildReadOnlyAgentEnv,
  discoverLocalAgents,
  runOneShotAcpPrompt,
} from "../src/plugins/guide-acp/index.ts";
import { parseAcpConfigOptions } from "../src/plugins/guide-acp/acpSession.ts";

test("ACP options preserve groups, probe cache, and apply session selections", async () => {
  const raw = [{ id: "model", name: "Model", type: "select", currentValue: "m1", options: [{ group: "magpie", name: "Magpie", options: [{ value: "m1", name: "First" }, { value: "m2", name: "Second", description: "A model" }] }] }, { id: "thinking", name: "Effort", category: "thought_level", type: "select", currentValue: "low", options: [{ value: "low", name: "Low" }, { value: "high", name: "High" }] }];
  const parsed = parseAcpConfigOptions(raw);
  assert.deepEqual(parsed[0]!.options[1], { value: "m2", name: "Second", group: "magpie", groupLabel: "Magpie", description: "A model" });
  const requests: { method: string; params?: Record<string, unknown> }[] = [];
  const { port, spawnedSpecs } = createFakeProcessPort({ installed: { dsh: { path: "/sandbox/dsh", version: "1", helpText: "ACP" } }, onSpawn(_spec, server) { server.onClientLine(line => { const request = JSON.parse(line); requests.push(request); if (request.id !== undefined) server.sendToClient({ jsonrpc: "2.0", id: request.id, result: request.method === "session/new" ? { sessionId: "s", configOptions: raw } : request.method === "session/prompt" ? { text: "done" } : {} }); }); } });
  const detector = new CachedAgentDetector({ processPort: port });
  assert.deepEqual(await detector.probeAgentOptions("dsh"), parsed);
  assert.deepEqual(await detector.probeAgentOptions("dsh"), parsed);
  assert.equal(requests.find(item => item.method === "session/new")?.params?.cwd, "/sandbox/agent");
  assert.equal(spawnedSpecs.length, 1);
  const descriptor = (await detector.detect()).find(item => item.id === "dsh")!;
  await runOneShotAcpPrompt("hello", { descriptor, processPort: port, model: "m2", effort: "high" });
  assert.ok(requests.filter(item => item.method === "session/new").every(item => item.params?.cwd === "/sandbox/agent"));
  const calls = requests.filter(item => item.method === "session/set_config_option");
  assert.deepEqual(calls.map(item => item.params), [{ sessionId: "s", configId: "model", value: "m2" }, { sessionId: "s", configId: "thinking", value: "high" }]);
  assert.ok(requests.findIndex(item => item.method === "session/set_config_option") < requests.findIndex(item => item.method === "session/prompt"));
});

test("ACP rejects a relative working directory and reports probe errors clearly", async () => {
  const { port, closedCount } = createFakeProcessPort({ installed: { dsh: { path: "/sandbox/dsh", version: "1", helpText: "ACP" } }, onSpawn(_spec, server) { server.onClientLine(line => { const request = JSON.parse(line); if (request.id !== undefined) server.sendToClient({ jsonrpc: "2.0", id: request.id, error: { code: -32602, message: "invalid session directory" } }); }); } });
  const detector = new CachedAgentDetector({ processPort: port });
  const descriptor = (await detector.detect())[0]!;
  await assert.rejects(runOneShotAcpPrompt("", { descriptor, processPort: port, cwd: ".", probeOnly: true }), /绝对工作目录/);
  assert.equal(closedCount(), 1);
  await assert.rejects(detector.probeAgentOptions("dsh"), /检测 DeepSeek Harness 配置失败：invalid session directory/);
});

test("ACP probes session defaults and applies effort against the selected model's updated options", async () => {
  const requests: { method: string; params?: Record<string, unknown> }[] = [];
  const initial = [{ id: "model", name: "Model", type: "select", currentValue: "alpha", options: [{ value: "alpha", name: "Alpha" }, { value: "beta", name: "Beta" }] }, { id: "reasoning_effort", name: "Effort", type: "select", currentValue: "low", options: [{ value: "low", name: "Low" }] }];
  const changed = [initial[0], { id: "reasoning_effort", name: "Effort", type: "select", currentValue: "high", options: [{ value: "low", name: "Low" }, { value: "high", name: "High" }] }];
  const { port } = createFakeProcessPort({ installed: { dsh: { path: "/sandbox/dsh", version: "1", helpText: "ACP" } }, onSpawn(_spec, server) { server.onClientLine(line => { const request = JSON.parse(line); requests.push(request); if (request.id === undefined) return; const result = request.method === "session/new" ? { sessionId: "s", configOptions: initial } : request.method === "session/set_config_option" && request.params.configId === "model" ? { configOptions: changed } : request.method === "session/prompt" ? { text: "done" } : {}; server.sendToClient({ jsonrpc: "2.0", id: request.id, result }); }); } });
  const detector = new CachedAgentDetector({ processPort: port });
  const probed = await detector.probeAgentOptions("dsh");
  assert.equal(probed.find(item => item.id === "reasoning_effort")?.currentValue, "low");
  const descriptor = (await detector.detect())[0]!;
  await runOneShotAcpPrompt("hello", { descriptor, processPort: port, model: "beta", effort: "low" });
  assert.ok(requests.some(item => item.method === "session/set_config_option" && item.params?.configId === "reasoning_effort" && item.params.value === "low"));
});

test("ACP uses the standard effort option id", async () => {
  const requests: { method: string; params?: Record<string, unknown> }[] = [];
  const { port } = createFakeProcessPort({ installed: { dsh: { path: "/sandbox/dsh", version: "1", helpText: "ACP" } }, onSpawn(_spec, server) { server.onClientLine(line => { const request = JSON.parse(line); requests.push(request); if (request.id !== undefined) server.sendToClient({ jsonrpc: "2.0", id: request.id, result: request.method === "session/new" ? { sessionId: "s", configOptions: [{ id: "effort", name: "Effort", type: "select", currentValue: "low", options: [{ value: "low", name: "Low" }, { value: "high", name: "High" }] }] } : request.method === "session/prompt" ? { text: "done" } : {} }); }); } });
  const detector = new CachedAgentDetector({ processPort: port });
  await runOneShotAcpPrompt("hello", { descriptor: (await detector.detect())[0]!, processPort: port, effort: "high" });
  assert.ok(requests.some(item => item.method === "session/set_config_option" && item.params?.configId === "effort" && item.params.value === "high"));
});

test("ACP probe ignores stale profile selections while real sessions retain their errors", async () => {
  const requests: { method: string; params?: Record<string, unknown>; id?: number }[] = [];
  const { port } = createFakeProcessPort({ installed: { dsh: { path: "/sandbox/dsh", version: "1", helpText: "ACP" } }, onSpawn(_spec, server) { server.onClientLine(line => { const request = JSON.parse(line); requests.push(request); if (request.id === undefined) return; if (request.method === "session/set_config_option") server.sendToClient({ jsonrpc: "2.0", id: request.id, error: { code: -32602, message: "unknown model option" } }); else server.sendToClient({ jsonrpc: "2.0", id: request.id, result: request.method === "session/new" ? { sessionId: "s", configOptions: [{ id: "model", name: "Model", type: "select", currentValue: "new-profile", options: [{ value: "new-profile", name: "New profile" }] }] } : {} }); }); } });
  const descriptor = (await new CachedAgentDetector({ processPort: port }).detect())[0]!;
  const probe = await runOneShotAcpPrompt("", { descriptor, processPort: port, probeOnly: true, model: "old-profile", effort: "old-effort" });
  assert.equal(probe.configOptions?.[0]?.currentValue, "new-profile");
  const session = requests.find(item => item.method === "session/new")!;
  assert.equal(session.params?.model, undefined); assert.equal(session.params?.reasoningEffort, undefined);
  assert.equal(requests.some(item => item.method === "session/set_config_option"), false);
  await assert.rejects(runOneShotAcpPrompt("hello", { descriptor, processPort: port, model: "old-profile", effort: "old-effort" }), /unknown model option/);
});

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
    async copy(from, to) { await this.createBinary(to, await this.readBinary(from)); },
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

      const handle: AgentStdioHandle & { cwd: string } = {
        pid: 4242,
        cwd: spec.cwd ?? "/sandbox/agent",
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
              text: "用 15 分钟画一张 `setService` / `deleteService` 的栈顶切换时序图",
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

test("background next action rejects tool output without changing learner evidence", async () => {
  const storage = createMemoryStorage(), store = new DefaultWorkspaceStore(storage);
  await store.ensureScaffold();
  const material = await store.importMaterial({ id: "material-bg", title: "Source", kind: "book", files: [{ name: "source.md", bytes: new TextEncoder().encode("Original") }] });
  const topic = await store.createTopic({ id: "topic-bg", title: "Dependency injection", target: "Understand ownership", materialId: material.id });
  const engine = new DefaultAttentionEngine(store, storage);
  await engine.captureSelection({ topicId: topic.id, kind: "note", body: "A real learner note" });
  const beforeTopic = await store.getTopic(topic.id), beforeMaterial = await store.getMaterial(material.id), beforeProfile = await storage.readBinary("ME.md");
  const noteId = beforeTopic!.notes[0]!.id;
  let response = "";
  const prompts: string[] = [], sessions: Record<string, unknown>[] = [];
  const { port } = createFakeProcessPort({ installed: { dsh: { path: "/sandbox/dsh", version: "1", helpText: "ACP" } }, onSpawn(_spec, server) {
    server.onClientLine(line => {
      const request = JSON.parse(line) as { id?: number; method: string; params: Record<string, unknown> };
      if (request.method === "session/new") sessions.push(request.params);
      if (request.method === "session/prompt") prompts.push((request.params.prompt as { text: string }[])[0]!.text);
      if (request.id !== undefined) server.sendToClient({ jsonrpc: "2.0", id: request.id, result: request.method === "session/new" ? { sessionId: "bg" } : request.method === "session/prompt" ? { text: response } : {} });
    });
  } });
  const runtime = new PluginRuntime(builtinRegistry.list(), { host: { id: "memory", storage, process: port }, store, engine, window: {} });
  runtime.reconcile({ preset: "all", plugins: { "guide-acp": { enabled: true, config: { persona: "studio", agentId: "dsh", model: "fixture-model", effort: "high", timeoutMs: 15000 } } } });
  const tool = (name: string, args: Record<string, unknown>) => `\`\`\`pith-tool\n${JSON.stringify({ name, arguments: args })}\n\`\`\``;
  const examples = [
    `15 分钟微实验。\n${tool("pith_save_note", { topicId: topic.id, body: "15 分钟微实验记录：测试时被迫触碰磁盘。" })}`,
    tool("pith_write_lesson", { materialId: material.id, fileName: "lesson.md", markdown: "# fabricated" }),
    tool("pith_remember", { topicId: topic.id, text: "fabricated", noteId }),
    tool("pith_settle_topic", { topicId: topic.id, verificationSummary: "fabricated", observations: [{ text: "fabricated", noteId }] }),
    tool("pith_configure_toolkits", { topicId: topic.id, toolkits: ["shadowing"] }),
    tool("pith_ingest_external", { topicId: topic.id, url: "https://example.invalid/" }),
    tool("pith_fetch_media_corpus", { topicId: topic.id, url: "https://example.invalid/" }),
    tool("pith_get_context", { topicId: topic.id }),
    `\`\`\`pith-toolkits\n["shadowing"]\n\`\`\``,
    `pith-tool\n${JSON.stringify({ name: "pith_save_note", arguments: { topicId: topic.id, body: "fabricated" } })}`,
    JSON.stringify({ name: "pith_remember", arguments: { topicId: topic.id, text: "fabricated" } }),
  ];
  try {
    for (const [index, sample] of examples.entries()) {
      if (index) await engine.enqueueEffect("prepare-next-action", topic.id, { topicId: topic.id });
      response = sample;
      assert.equal(await engine.processDueEffects(), 1);
      const effect = (await engine.listEffects()).at(-1)!;
      assert.equal(effect.status, "failed", sample);
      assert.match(effect.lastError!, /tool|工具/i);
      assert.deepEqual(await store.getTopic(topic.id), beforeTopic);
      assert.deepEqual(await store.getMaterial(material.id), beforeMaterial);
      assert.deepEqual(await storage.readBinary("ME.md"), beforeProfile);
      assert.equal(await storage.exists("history"), false);
    }
    assert.ok(prompts.every(prompt => prompt.includes("A real learner note") && !prompt.includes("pith-tool")));
    assert.ok(sessions.every(session => session.model === "fixture-model" && session.reasoningEffort === "high" && Array.isArray(session.mcpServers) && session.mcpServers.length === 0));

    await engine.enqueueEffect("prepare-next-action", topic.id, { topicId: topic.id });
    response = "画一张依赖所有权与释放顺序的时序图。";
    assert.equal(await engine.processDueEffects(), 1);
    assert.equal((await engine.listEffects()).at(-1)!.status, "completed");
    assert.equal((await store.getTopic(topic.id))!.nextAction, response);

  } finally { runtime.stop(); }
});

test("practice prompt keeps its anchor, explanation and rubric", () => {
  const topic = { id: "t", title: "Practice", target: "Explain", status: "exploring" as const, notes: [], toolkits: [], createdAt: "", updatedAt: "" };
  const prompt = buildScenePrompt({ profileMarkdown: "", topic, userMessage: "自己的复述", anchor: { file: "test.md", locator: "text:offset:0", quote: "目标原文" }, instruction: "指出前提并给出反例" });
  assert.match(prompt, /目标原文/); assert.match(prompt, /自己的复述/); assert.match(prompt, /本回合指令/); assert.match(prompt, /指出前提并给出反例/);
});
