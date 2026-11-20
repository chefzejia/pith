import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import test from "node:test";
import {
  DefaultAttentionEngine,
  DefaultWorkspaceStore,
  LOCAL_AGENT_IDS,
  type AgentProcessPort,
  type AgentProcessSpawnSpec,
  type AgentStdioHandle,
  type DiscoveredAgentDescriptor,
  type WorkspaceStoragePort,
} from "../src/core/index.ts";
import { discoverLocalAgents, LocalAcpGuideProvider, runOneShotAcpPrompt } from "../src/plugins/guide-acp/index.ts";
import { PithObsidianController, PithSettingTab } from "../src/shells/obsidian/index.ts";
import { NodeToolServerPort } from "../src/shells/web/nodeToolServer.ts";
import { NodeWorkspaceStorage } from "../src/shells/web/nodeStorage.ts";
import { createPithWebServer } from "../src/shells/web/server.ts";
import { testSandbox } from "./sandbox.ts";

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

type RpcRequest = { id?: number; method: string; params?: Record<string, unknown> };

function createAcpTestPort(options: {
  installed?: Record<string, { path: string; version: string | null; helpText?: string }>;
  onSpawn?: (spec: AgentProcessSpawnSpec, wire: {
    emit: (message: unknown) => void;
    reply: (req: RpcRequest, result: unknown) => void;
    replyError: (req: RpcRequest, code: number, message: string) => void;
    onRequest: (handler: (req: RpcRequest) => void) => void;
  }) => void;
}): {
  port: AgentProcessPort;
  probeCalls: Array<{ execPath: string; args: readonly string[] }>;
  spawnedSpecs: AgentProcessSpawnSpec[];
  closedCount: () => number;
} {
  const probeCalls: Array<{ execPath: string; args: readonly string[] }> = [];
  const spawnedSpecs: AgentProcessSpawnSpec[] = [];
  let closed = 0;
  const installed = options.installed ?? {};

  const port: AgentProcessPort = {
    searchPaths: () => ["/opt/homebrew/bin", "/usr/local/bin"],
    async findExecutable(command) {
      return installed[command]?.path ?? null;
    },
    async probeExecutable(execPath, args) {
      probeCalls.push({ execPath, args: [...args] });
      const match = Object.values(installed).find((item) => item.path === execPath);
      if (!match) return null;
      if (args.includes("--version")) return match.version;
      if (args.includes("--help")) return match.helpText ?? null;
      return null;
    },
    async spawnStdio(spec) {
      spawnedSpecs.push(spec);
      const listeners = new Set<(line: string) => void>();
      let handler: ((req: RpcRequest) => void) | undefined;
      const emit = (message: unknown) => {
        const raw = typeof message === "string" ? message : JSON.stringify(message);
        for (const fn of listeners) fn(raw);
      };
      const wire = {
        emit,
        reply: (req: RpcRequest, result: unknown) => emit({ jsonrpc: "2.0", id: req.id, result }),
        replyError: (req: RpcRequest, code: number, message: string) => emit({ jsonrpc: "2.0", id: req.id, error: { code, message } }),
        onRequest: (fn: (req: RpcRequest) => void) => {
          handler = fn;
        },
      };
      options.onSpawn?.(spec, wire);
      const handle: AgentStdioHandle & { cwd: string } = {
        cwd: spec.cwd ?? "/isolated/m71",
        onLine(listener) {
          listeners.add(listener);
          return () => {
            listeners.delete(listener);
          };
        },
        writeLine(line) {
          const req = JSON.parse(line) as RpcRequest;
          handler?.(req);
        },
        async close() {
          closed += 1;
        },
      };
      return handle;
    },
  };

  return { port, probeCalls, spawnedSpecs, closedCount: () => closed };
}

class SelectStubElement {
  children: SelectStubElement[] = [];
  parentElement: SelectStubElement | null = null;
  textContent = "";
  #value = "";
  disabled = false;
  hidden = false;
  title = "";
  label = "";
  className = "";
  type = "";
  autocomplete = "";
  innerHTML = "";
  onclick: (() => void) | null = null;
  onchange: (() => void) | null = null;
  ownerDocument = { createElement: (_tag: string) => new SelectStubElement() };

  get value(): string {
    return this.#value;
  }

  set value(next: string) {
    this.#value = next;
  }

  append(...children: SelectStubElement[]) {
    for (const child of children) child.parentElement = this;
    this.children.push(...children);
  }

  replaceChildren(...children: SelectStubElement[]) {
    this.children = [];
    this.append(...children);
  }

  contains(node: SelectStubElement): boolean {
    return this === node || this.children.some((child) => child.contains(node));
  }

  querySelector(selector: string): SelectStubElement | null {
    if (selector === 'option[value="unconfigured"]') {
      return this.children.find((child) => child.value === "unconfigured") ?? null;
    }
    return null;
  }

  setAttribute(_name: string, _value: string) {}

  addEventListener(type: string, listener: () => void) {
    if (type === "change") this.onchange = listener;
  }
}

test("M71: LOCAL_AGENT_IDS and discovery metadata cover all 4 ACP adapters and reject bare claude/codex", async () => {
  assert.deepEqual(LOCAL_AGENT_IDS, ["dsh", "claude", "codex", "agy"]);

  const { port, probeCalls } = createAcpTestPort({
    installed: {
      dsh: { path: "/bin/dsh", version: "dsh 0.4.5", helpText: "DeepSeek Harness Agent Client Protocol (ACP)" },
      "claude-agent-acp": { path: "/bin/claude-agent-acp", version: "0.94.0" },
      "codex-acp": { path: "/bin/codex-acp", version: "0.8.1" },
      agy: { path: "/bin/agy", version: "1.9.0", helpText: "Usage: agy acp\nAgent Client Protocol server" },
    },
  });

  const discovered = await discoverLocalAgents({ processPort: port });
  assert.deepEqual(discovered.map((d) => d.id), ["dsh", "claude", "codex", "agy"]);

  const dsh = discovered.find((d) => d.id === "dsh")!;
  assert.equal(dsh.available, true);
  assert.deepEqual(dsh.args, ["--profile", "acp"]);
  assert.equal(dsh.pithToolTitlePrefix, "mcp__pith__");
  assert.equal(dsh.httpMcpWithoutCapability, undefined);
  assert.equal(dsh.requiredSafeModes, undefined);

  const claude = discovered.find((d) => d.id === "claude")!;
  assert.equal(claude.available, true);
  assert.equal(claude.command, "/bin/claude-agent-acp");
  assert.deepEqual(claude.args, []);
  assert.equal(claude.pithToolTitlePrefix, "mcp__pith__");
  assert.deepEqual(claude.requiredSafeModes, ["default"]);
  assert.equal(
    probeCalls.some((c) => c.execPath === "/bin/claude-agent-acp" && c.args.includes("--help")),
    false,
    "claude-agent-acp must never be probed with --help",
  );

  const codex = discovered.find((d) => d.id === "codex")!;
  assert.equal(codex.available, true);
  assert.equal(codex.command, "/bin/codex-acp");
  assert.deepEqual(codex.args, []);
  assert.equal(codex.pithToolTitlePrefix, "mcp.pith.");
  assert.deepEqual(codex.requiredSafeModes, ["read-only"]);

  const agy = discovered.find((d) => d.id === "agy")!;
  assert.equal(agy.available, true);
  assert.equal(agy.command, "/bin/agy");
  assert.deepEqual(agy.args, ["acp", "--sandbox"]);
  assert.equal(agy.pithToolTitlePrefix, "Run mcp_pith_");
  assert.equal(agy.httpMcpWithoutCapability, true);
  assert.deepEqual(agy.requiredSafeModes, ["default"]);

  // Bare claude/codex without -acp adapter, plus agy failing acp --help check
  const bareOnly = createAcpTestPort({
    installed: {
      claude: { path: "/usr/local/bin/claude", version: "2.1.12" },
      codex: { path: "/usr/local/bin/codex", version: "0.52.0" },
      agy: { path: "/usr/local/bin/agy", version: "1.0.0", helpText: "Usage: agy open" },
    },
  });
  const bareDiscovered = await discoverLocalAgents({ processPort: bareOnly.port });
  assert.equal(bareDiscovered.find((d) => d.id === "claude")!.available, false);
  assert.match(bareDiscovered.find((d) => d.id === "claude")!.note, /裸 claude CLI 不是 ACP 服务/);
  assert.match(bareDiscovered.find((d) => d.id === "claude")!.note, /@agentclientprotocol\/claude-agent-acp/);
  assert.equal(bareDiscovered.find((d) => d.id === "codex")!.available, false);
  assert.match(bareDiscovered.find((d) => d.id === "codex")!.note, /@agentclientprotocol\/codex-acp/);
  assert.equal(bareDiscovered.find((d) => d.id === "agy")!.available, false);
  assert.match(bareDiscovered.find((d) => d.id === "agy")!.note, /未通过 ACP profile 探测/);
});

test("M71: HTTP MCP capability gate allows omitted mcpCapabilities only for agy and rejects explicit http:false", async () => {
  const mcp = { url: "http://127.0.0.1:1/", headers: [], toolNames: ["pith_save_note"], onUpdate: () => {} };
  const descriptors: Record<string, DiscoveredAgentDescriptor> = {
    dsh: { id: "dsh", label: "DeepSeek Harness", command: "/bin/dsh", args: ["--profile", "acp"], available: true, version: "1", note: "", pithToolTitlePrefix: "mcp__pith__" },
    claude: { id: "claude", label: "Claude Code", command: "/bin/claude-agent-acp", args: [], available: true, version: "1", note: "", pithToolTitlePrefix: "mcp__pith__", requiredSafeModes: ["default"] },
    codex: { id: "codex", label: "Codex", command: "/bin/codex-acp", args: [], available: true, version: "1", note: "", pithToolTitlePrefix: "mcp.pith.", requiredSafeModes: ["read-only"] },
    agy: { id: "agy", label: "Antigravity", command: "/bin/agy", args: ["acp", "--sandbox"], available: true, version: "1", note: "", pithToolTitlePrefix: "Run mcp_pith_", httpMcpWithoutCapability: true, requiredSafeModes: ["default"] },
  };

  // agy without mcpCapabilities succeeds
  {
    const requests: string[] = [];
    const { port, closedCount } = createAcpTestPort({
      onSpawn(_spec, wire) {
        wire.onRequest((req) => {
          requests.push(req.method);
          if (req.method === "initialize") wire.reply(req, { protocolVersion: 1, agentCapabilities: {} });
          else if (req.method === "session/new") {
            wire.reply(req, {
              sessionId: "agy-s1",
              configOptions: [{ id: "mode", name: "Mode", type: "select", currentValue: "default", options: [{ value: "default", name: "Default" }] }],
            });
          } else if (req.method === "session/prompt") wire.reply(req, { stopReason: "end_turn", text: "ok" });
        });
      },
    });
    const result = await runOneShotAcpPrompt("hi", { descriptor: descriptors.agy!, processPort: port, mcp });
    assert.equal(result.text, "ok");
    assert.ok(requests.includes("session/prompt"));
    assert.equal(closedCount(), 1);
  }

  // agy with explicit { http: false } or { http: undefined } inside mcpCapabilities MUST fail before session/new
  for (const agentCaps of [
    { mcpCapabilities: { http: false } },
    { mcpCapabilities: {} },
  ]) {
    const requests: string[] = [];
    const { port, closedCount } = createAcpTestPort({
      onSpawn(_spec, wire) {
        wire.onRequest((req) => {
          requests.push(req.method);
          if (req.method === "initialize") wire.reply(req, { protocolVersion: 1, agentCapabilities: agentCaps });
          else if (req.method === "session/new") wire.reply(req, { sessionId: "leaked" });
          else if (req.method === "session/prompt") wire.reply(req, { stopReason: "end_turn", text: "leaked" });
        });
      },
    });
    await assert.rejects(runOneShotAcpPrompt("hi", { descriptor: descriptors.agy!, processPort: port, mcp }), /HTTP MCP/);
    assert.equal(requests.includes("session/new"), false);
    assert.equal(closedCount(), 1);
  }

  // dsh, claude, codex without mcpCapabilities MUST fail before session/new
  for (const id of ["dsh", "claude", "codex"] as const) {
    const requests: string[] = [];
    const { port, closedCount } = createAcpTestPort({
      onSpawn(_spec, wire) {
        wire.onRequest((req) => {
          requests.push(req.method);
          if (req.method === "initialize") wire.reply(req, { protocolVersion: 1, agentCapabilities: {} });
          else if (req.method === "session/new") wire.reply(req, { sessionId: "leaked" });
          else if (req.method === "session/prompt") wire.reply(req, { stopReason: "end_turn", text: "leaked" });
        });
      },
    });
    await assert.rejects(runOneShotAcpPrompt("hi", { descriptor: descriptors[id]!, processPort: port, mcp }), /HTTP MCP/);
    assert.equal(requests.includes("session/new"), false);
    assert.equal(closedCount(), 1);
  }
});

test("M71: requiredSafeModes Fail-Closed matrix enforces safe mode after model/effort and blocks unsafe sessions", async () => {
  const mcp = { url: "http://127.0.0.1:1/", headers: [], toolNames: ["pith_save_note"], onUpdate: () => {} };
  const codexDesc: DiscoveredAgentDescriptor = {
    id: "codex", label: "Codex", command: "/bin/codex-acp", args: [], available: true, version: "1", note: "",
    pithToolTitlePrefix: "mcp.pith.", requiredSafeModes: ["read-only"],
  };
  const claudeDesc: DiscoveredAgentDescriptor = {
    id: "claude", label: "Claude Code", command: "/bin/claude-agent-acp", args: [], available: true, version: "1", note: "",
    pithToolTitlePrefix: "mcp__pith__", requiredSafeModes: ["default"],
  };
  const agyDesc: DiscoveredAgentDescriptor = {
    id: "agy", label: "Antigravity", command: "/bin/agy", args: ["acp", "--sandbox"], available: true, version: "1", note: "",
    pithToolTitlePrefix: "Run mcp_pith_", httpMcpWithoutCapability: true, requiredSafeModes: ["default"],
  };

  // 1. codex switches from "agent" to "read-only" after model & effort
  {
    const calls: RpcRequest[] = [];
    const { port } = createAcpTestPort({
      onSpawn(_spec, wire) {
        wire.onRequest((req) => {
          calls.push(req);
          if (req.method === "initialize") wire.reply(req, { agentCapabilities: { mcpCapabilities: { http: true } } });
          else if (req.method === "session/new") {
            wire.reply(req, {
              sessionId: "s-codex",
              configOptions: [
                { id: "model", name: "Model", type: "select", currentValue: "m1", options: [{ value: "m1", name: "M1" }, { value: "m2", name: "M2" }] },
                { id: "reasoning_effort", name: "Effort", category: "thought_level", type: "select", currentValue: "high", options: [{ value: "low", name: "Low" }, { value: "high", name: "High" }] },
                { id: "mode", name: "Mode", category: "mode", type: "select", currentValue: "agent", options: [{ value: "read-only", name: "Read Only" }, { value: "agent", name: "Agent" }] },
              ],
            });
          } else if (req.method === "session/set_config_option") {
            const configId = req.params?.configId;
            const value = req.params?.value;
            wire.reply(req, {
              configOptions: [
                { id: "model", name: "Model", type: "select", currentValue: configId === "model" ? value : "m2", options: [{ value: "m1", name: "M1" }, { value: "m2", name: "M2" }] },
                { id: "reasoning_effort", name: "Effort", category: "thought_level", type: "select", currentValue: configId === "reasoning_effort" ? value : configId === "model" ? "high" : "low", options: [{ value: "low", name: "Low" }, { value: "high", name: "High" }] },
                { id: "mode", name: "Mode", category: "mode", type: "select", currentValue: configId === "mode" ? value : "agent", options: [{ value: "read-only", name: "Read Only" }, { value: "agent", name: "Agent" }] },
              ],
            });
          } else if (req.method === "session/prompt") wire.reply(req, { text: "safe-codex" });
        });
      },
    });
    const res = await runOneShotAcpPrompt("go", { descriptor: codexDesc, processPort: port, model: "m2", effort: "low", mcp });
    assert.equal(res.text, "safe-codex");
    const sets = calls.filter((c) => c.method === "session/set_config_option").map((c) => [c.params?.configId, c.params?.value]);
    assert.deepEqual(sets, [["model", "m2"], ["reasoning_effort", "low"], ["mode", "read-only"]]);
    assert.ok(calls.findIndex((c) => c.method === "session/set_config_option" && c.params?.configId === "mode") < calls.findIndex((c) => c.method === "session/prompt"));
  }

  // 2. claude / agy when model selection resets mode back to unsafe ("auto" / "accept-edits"), must re-lock "default"
  for (const [desc, unsafeMode] of [[claudeDesc, "accept-edits"], [agyDesc, "auto"]] as const) {
    const calls: RpcRequest[] = [];
    const { port } = createAcpTestPort({
      onSpawn(_spec, wire) {
        wire.onRequest((req) => {
          calls.push(req);
          if (req.method === "initialize") wire.reply(req, { agentCapabilities: { mcpCapabilities: { http: true } } });
          else if (req.method === "session/new") {
            wire.reply(req, {
              sessionId: "s-safe",
              configOptions: [
                { id: "model_cfg", category: "model", name: "Model", type: "select", currentValue: "m1", options: [{ value: "m1", name: "M1" }, { value: "m2", name: "M2" }] },
                { id: "thought_level", category: "thought_level", name: "Thinking", type: "select", currentValue: "high", options: [{ value: "low", name: "Low" }, { value: "high", name: "High" }] },
                { id: "permission_mode", category: "mode", name: "Mode", type: "select", currentValue: "default", options: [{ value: "default", name: "Default" }, { value: unsafeMode, name: "Unsafe" }] },
              ],
            });
          } else if (req.method === "session/set_config_option") {
            const configId = req.params?.configId;
            const value = req.params?.value;
            // Selecting model unexpectedly flips mode to unsafeMode!
            const currentMode = configId === "permission_mode" ? value : unsafeMode;
            wire.reply(req, {
              configOptions: [
                { id: "model_cfg", category: "model", name: "Model", type: "select", currentValue: "m2", options: [{ value: "m1", name: "M1" }, { value: "m2", name: "M2" }] },
                { id: "thought_level", category: "thought_level", name: "Thinking", type: "select", currentValue: configId === "thought_level" ? value : "high", options: [{ value: "low", name: "Low" }, { value: "high", name: "High" }] },
                { id: "permission_mode", category: "mode", name: "Mode", type: "select", currentValue: currentMode, options: [{ value: "default", name: "Default" }, { value: unsafeMode, name: "Unsafe" }] },
              ],
            });
          } else if (req.method === "session/prompt") wire.reply(req, { text: "relocked" });
        });
      },
    });
    const res = await runOneShotAcpPrompt("go", { descriptor: desc, processPort: port, model: "m2", effort: "low", mcp });
    assert.equal(res.text, "relocked");
    const sets = calls.filter((c) => c.method === "session/set_config_option").map((c) => [c.params?.configId, c.params?.value]);
    assert.deepEqual(sets, [["model_cfg", "m2"], ["thought_level", "low"], ["permission_mode", "default"]]);
  }

  // 3. Fail-Closed failure cases: none may reach session/prompt
  const failureCases: Array<{ name: string; newOptions: unknown; setModeResult?: unknown; setModeError?: string }> = [
    {
      name: "missing mode option",
      newOptions: [{ id: "model", name: "Model", type: "select", currentValue: "m1", options: [{ value: "m1", name: "M1" }] }],
    },
    {
      name: "only high-privilege modes available",
      newOptions: [{ id: "mode", name: "Mode", type: "select", currentValue: "agent", options: [{ value: "agent", name: "Agent" }, { value: "bypassPermissions", name: "Bypass" }] }],
    },
    {
      name: "set_config_option omits configOptions",
      newOptions: [{ id: "mode", name: "Mode", type: "select", currentValue: "agent", options: [{ value: "read-only", name: "Read Only" }, { value: "agent", name: "Agent" }] }],
      setModeResult: {},
    },
    {
      name: "set_config_option leaves unsafe mode active",
      newOptions: [{ id: "mode", name: "Mode", type: "select", currentValue: "agent", options: [{ value: "read-only", name: "Read Only" }, { value: "agent", name: "Agent" }] }],
      setModeResult: {
        configOptions: [{ id: "mode", name: "Mode", type: "select", currentValue: "agent", options: [{ value: "read-only", name: "Read Only" }, { value: "agent", name: "Agent" }] }],
      },
    },
    {
      name: "set_config_option returns error",
      newOptions: [{ id: "mode", name: "Mode", type: "select", currentValue: "agent", options: [{ value: "read-only", name: "Read Only" }, { value: "agent", name: "Agent" }] }],
      setModeError: "mode locked by server",
    },
  ];

  for (const scenario of failureCases) {
    const methods: string[] = [];
    const { port, closedCount } = createAcpTestPort({
      onSpawn(_spec, wire) {
        wire.onRequest((req) => {
          methods.push(req.method);
          if (req.method === "initialize") wire.reply(req, { agentCapabilities: { mcpCapabilities: { http: true } } });
          else if (req.method === "session/new") wire.reply(req, { sessionId: "s-fail", configOptions: scenario.newOptions });
          else if (req.method === "session/set_config_option") {
            if (scenario.setModeError) wire.replyError(req, -32602, scenario.setModeError);
            else wire.reply(req, scenario.setModeResult ?? {});
          } else if (req.method === "session/prompt") wire.reply(req, { stopReason: "end_turn", text: "leaked" });
        });
      },
    });
    await assert.rejects(
      runOneShotAcpPrompt("go", { descriptor: codexDesc, processPort: port, mcp }),
      Error,
      scenario.name,
    );
    assert.equal(methods.includes("session/prompt"), false, `${scenario.name}: must NOT send session/prompt`);
    assert.equal(closedCount(), 1, scenario.name);

    // probeOnly MUST succeed and return configOptions without calling set_config_option
    const probeMethods: string[] = [];
    const probePort = createAcpTestPort({
      onSpawn(_spec, wire) {
        wire.onRequest((req) => {
          probeMethods.push(req.method);
          if (req.method === "initialize") wire.reply(req, { agentCapabilities: { mcpCapabilities: { http: true } } });
          else if (req.method === "session/new") wire.reply(req, { sessionId: "s-probe", configOptions: scenario.newOptions });
        });
      },
    });
    const probeResult = await runOneShotAcpPrompt("", { descriptor: codexDesc, processPort: probePort.port, probeOnly: true });
    assert.equal(probeResult.sessionId, "s-probe");
    assert.equal(probeMethods.includes("session/set_config_option"), false);
  }
});

test("M71: permission gate and LocalAcpGuideProvider step deduplication enforce exact pithToolTitlePrefix per agent", async () => {
  const cases = [
    {
      id: "dsh" as const,
      descriptor: { id: "dsh", label: "DeepSeek Harness", command: "/bin/dsh", args: ["--profile", "acp"], available: true, version: "1", note: "", pithToolTitlePrefix: "mcp__pith__" } satisfies DiscoveredAgentDescriptor,
      validTitle: "mcp__pith__pith_save_note",
      forgedTitles: ["mcp__pith__pith_save_note_extra", "mcp.pith.pith_save_note", "Bash", "Write"],
      safeModeConfig: undefined,
    },
    {
      id: "codex" as const,
      descriptor: { id: "codex", label: "Codex", command: "/bin/codex-acp", args: [], available: true, version: "1", note: "", pithToolTitlePrefix: "mcp.pith.", requiredSafeModes: ["read-only"] } satisfies DiscoveredAgentDescriptor,
      validTitle: "mcp.pith.pith_save_note",
      forgedTitles: ["mcp.other.pith_save_note", "mcp.pith.pith_save_note_extra", "mcp__pith__pith_save_note", "Bash", "Write"],
      safeModeConfig: [{ id: "mode", name: "Mode", type: "select", currentValue: "read-only", options: [{ value: "read-only", name: "Read Only" }] }],
    },
    {
      id: "agy" as const,
      descriptor: { id: "agy", label: "Antigravity", command: "/bin/agy", args: ["acp", "--sandbox"], available: true, version: "1", note: "", pithToolTitlePrefix: "Run mcp_pith_", httpMcpWithoutCapability: true, requiredSafeModes: ["default"] } satisfies DiscoveredAgentDescriptor,
      validTitle: "Run mcp_pith_pith_save_note",
      forgedTitles: ["Run mcp_pith_pith_save_note_extra", "mcp.other.pith_save_note", "mcp__pith__pith_save_note", "Bash", "Write"],
      safeModeConfig: [{ id: "mode", name: "Mode", type: "select", currentValue: "default", options: [{ value: "default", name: "Default" }] }],
    },
  ];

  for (const entry of cases) {
    const root = await testSandbox(`m71-perm-${entry.id}-`);
    const storage = new NodeWorkspaceStorage(root);
    const store = new DefaultWorkspaceStore(storage);
    await store.ensureScaffold();
    const topic = await store.createTopic({ title: `Topic ${entry.id}`, target: "Test prefixes", materialIds: [], toolkits: [] });
    const permissionOutcomes = new Map<string, string>();
    const permissionReqToToolId = new Map<number, string>();
    let nextPermReqId = 500;

    const { port } = createAcpTestPort({
      onSpawn(_spec, wire) {
        let mcpServer!: { url: string; headers: { name: string; value: string }[] };
        wire.onRequest((req) => {
          if (req.id !== undefined && permissionReqToToolId.has(req.id)) {
            const callId = permissionReqToToolId.get(req.id)!;
            const outcome = (req as unknown as { result?: { outcome?: { optionId?: string } } }).result?.outcome?.optionId ?? "cancelled";
            permissionOutcomes.set(callId, outcome);
            return;
          }
          if (req.method === "initialize") {
            wire.reply(req, { agentCapabilities: entry.id === "agy" ? {} : { mcpCapabilities: { http: true } } });
          } else if (req.method === "session/new") {
            mcpServer = (req.params?.mcpServers as { url: string; headers: { name: string; value: string }[] }[])[0]!;
            wire.reply(req, { sessionId: `sess-${entry.id}`, ...(entry.safeModeConfig ? { configOptions: entry.safeModeConfig } : {}) });
          } else if (req.method === "session/prompt") {
            void (async () => {
              // 1. Real Pith MCP tool announcement + permission + MCP call
              wire.emit({
                jsonrpc: "2.0",
                method: "session/update",
                params: { sessionId: `sess-${entry.id}`, update: { sessionUpdate: "tool_call", toolCallId: "pith-1", title: entry.validTitle, status: "in_progress" } },
              });
              const allowReqId = ++nextPermReqId;
              permissionReqToToolId.set(allowReqId, "pith-1");
              wire.emit({
                jsonrpc: "2.0",
                id: allowReqId,
                method: "session/request_permission",
                params: {
                  sessionId: `sess-${entry.id}`,
                  toolCall: { toolCallId: "pith-1" },
                  options: [{ kind: "allow_once", optionId: "allow" }, { kind: "reject_once", optionId: "deny" }],
                },
              });
              // Call real MCP endpoint
              const mcpRes = await fetch(mcpServer.url, {
                method: "POST",
                headers: Object.fromEntries(mcpServer.headers.map((h) => [h.name, h.value])),
                body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "pith_save_note", arguments: { body: `note from ${entry.id}` } } }),
              });
              const mcpJson = (await mcpRes.json()) as { result?: { isError?: boolean } };
              assert.equal(mcpJson.result?.isError, undefined);
              wire.emit({
                jsonrpc: "2.0",
                method: "session/update",
                params: { sessionId: `sess-${entry.id}`, update: { sessionUpdate: "tool_call_update", toolCallId: "pith-1", status: "completed" } },
              });

              // 2. Forged and built-in tools must all receive reject_once
              for (let i = 0; i < entry.forgedTitles.length; i++) {
                const forgedId = `forged-${i}`;
                wire.emit({
                  jsonrpc: "2.0",
                  method: "session/update",
                  params: { sessionId: `sess-${entry.id}`, update: { sessionUpdate: "tool_call", toolCallId: forgedId, title: entry.forgedTitles[i], status: "in_progress" } },
                });
                const denyReqId = ++nextPermReqId;
                permissionReqToToolId.set(denyReqId, forgedId);
                wire.emit({
                  jsonrpc: "2.0",
                  id: denyReqId,
                  method: "session/request_permission",
                  params: {
                    sessionId: `sess-${entry.id}`,
                    toolCall: { toolCallId: forgedId },
                    options: [{ kind: "allow_once", optionId: "allow" }, { kind: "reject_once", optionId: "deny" }],
                  },
                });
                wire.emit({
                  jsonrpc: "2.0",
                  method: "session/update",
                  params: { sessionId: `sess-${entry.id}`, update: { sessionUpdate: "tool_call_update", toolCallId: forgedId, status: "failed" } },
                });
              }

              // Wait briefly for permission responses to flush
              await new Promise((r) => setTimeout(r, 20));
              wire.emit({
                jsonrpc: "2.0",
                method: "session/update",
                params: { sessionId: `sess-${entry.id}`, update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "done" } } },
              });
              wire.reply(req, { stopReason: "end_turn" });
            })().catch((err) => wire.replyError(req, -1, String(err)));
          }
        });
      },
    });

    const provider = new LocalAcpGuideProvider({
      processPort: port,
      toolServer: new NodeToolServerPort(),
      store,
      storage,
      getAgentConfig: () => ({ agentId: entry.id }),
      resolveDescriptor: async () => entry.descriptor,
      buildScenePrompt: () => "prompt",
    });
    const engine = new DefaultAttentionEngine(store, storage, () => provider);
    try {
      const turn = await engine.runTurn({ topicId: topic.id, text: "save note" });
      assert.equal(turn.status, "completed", turn.error);
      assert.equal(permissionOutcomes.get("pith-1"), "allow", `${entry.id}: valid pith tool must be allowed`);
      for (let i = 0; i < entry.forgedTitles.length; i++) {
        assert.equal(permissionOutcomes.get(`forged-${i}`), "deny", `${entry.id}: ${entry.forgedTitles[i]} must be rejected`);
      }
      // Exactly ONE Pith tool step card for pith_save_note (with effects), zero duplicate cards for pith-1
      const pithToolSteps = turn.steps.filter((s) => s.kind === "tool" && s.name === "pith_save_note");
      assert.equal(pithToolSteps.length, 1);
      assert.equal(pithToolSteps[0]!.kind === "tool" && pithToolSteps[0]!.effects.length, 1);
      assert.equal(turn.steps.some((s) => s.kind === "tool" && s.name === entry.validTitle), false);
      assert.equal((await store.getTopic(topic.id))!.notes.at(-1)!.body, `note from ${entry.id}`);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test("M71: Obsidian PithSettingTab clears model/effort synchronously across agent switch even when save lags behind probe", async () => {
  const dir = await testSandbox("m71-obsidian-race-");
  const disk = new NodeWorkspaceStorage(dir);
  let settingsWriteGate: Promise<void> | null = null;
  let releaseSettingsWrite = () => {};
  let settingsWriteEntered = () => {};

  const storage: WorkspaceStoragePort = {
    mutationIdentity: disk.mutationIdentity,
    exists: disk.exists.bind(disk),
    readText: disk.readText.bind(disk),
    readBinary: disk.readBinary.bind(disk),
    createText: disk.createText.bind(disk),
    writeBinary: disk.writeBinary.bind(disk),
    createBinary: disk.createBinary.bind(disk),
    copy: disk.copy.bind(disk),
    processText: disk.processText.bind(disk),
    mkdir: disk.mkdir.bind(disk),
    list: disk.list.bind(disk),
    async writeText(path, data) {
      if (path === "_cache/web-settings.json" && settingsWriteGate) {
        settingsWriteEntered?.();
        await settingsWriteGate;
      }
      return disk.writeText(path, data);
    },
  };

  let codexProbed!: () => void;
  const codexProbeResolved = new Promise<void>((resolve) => {
    codexProbed = resolve;
  });
  let dshProbed!: () => void;
  const dshProbeResolved = new Promise<void>((resolve) => {
    dshProbed = resolve;
  });

  const { port } = createAcpTestPort({
    installed: {
      dsh: { path: "/bin/dsh", version: "dsh 1.0", helpText: "ACP" },
      "codex-acp": { path: "/bin/codex-acp", version: "0.8.0" },
      agy: { path: "/bin/agy", version: "1.0", helpText: "ACP" },
    },
    onSpawn(spec, wire) {
      wire.onRequest((req) => {
        if (req.method === "initialize") {
          wire.reply(req, { agentCapabilities: spec.command.includes("agy") ? {} : { mcpCapabilities: { http: true } } });
        } else if (req.method === "session/new") {
          if (spec.command.includes("codex")) {
            wire.reply(req, {
              sessionId: "p-codex",
              configOptions: [
                { id: "model", name: "Model", type: "select", currentValue: "gpt-5.3-codex", options: [{ value: "gpt-5.3-codex", name: "GPT-5.3 Codex" }] },
                { id: "reasoning_effort", name: "Effort", category: "thought_level", type: "select", currentValue: "medium", options: [{ value: "low", name: "Low" }, { value: "xhigh", name: "Extra High" }] },
              ],
            });
            queueMicrotask(codexProbed);
          } else {
            wire.reply(req, {
              sessionId: "p-dsh",
              configOptions: [
                { id: "model", name: "Model", type: "select", currentValue: "old-model", options: [{ value: "old-model", name: "Old Model" }] },
                { id: "reasoning_effort", name: "Effort", type: "select", currentValue: "xhigh", options: [{ value: "low", name: "Low" }, { value: "xhigh", name: "Extra High" }] },
              ],
            });
            queueMicrotask(dshProbed);
          }
        }
      });
    },
  });

  const controller = new PithObsidianController({ id: "obsidian", storage, process: port });
  try {
    await controller.initialize();
    await controller.setAgentConfig({ agentId: "dsh", model: "old-model", effort: "xhigh" });

    const tab = new PithSettingTab({} as never, { getWorkspacePath: () => "Pith", setWorkspacePath: async () => false } as never, controller);
    const root = new SelectStubElement();
    tab.containerEl = root as unknown as HTMLElement;
    tab.display();

    await dshProbeResolved;
    for (let i = 0; i < 20; i++) await new Promise<void>((resolve) => setImmediate(resolve));

    const getControl = (label: string) => {
      const node = root.children.find((item) => item.textContent === label)!.children[0]!;
      return label === "本机 Agent" ? node.children[0]! : node;
    };
    const agent = getControl("本机 Agent");
    const model = getControl("模型（Model）");
    const effort = getControl("推理强度（Effort）");
    assert.deepEqual(agent.children.map((o) => o.value), ["", "dsh", "claude", "codex", "agy"]);
    assert.equal(model.value, "old-model");
    assert.equal(effort.value, "xhigh");

    // Hold disk save so probe finishes BEFORE save completes
    const writeStarted = new Promise<void>((resolve) => {
      settingsWriteEntered = resolve;
    });
    settingsWriteGate = new Promise<void>((resolve) => {
      releaseSettingsWrite = resolve;
    });

    agent.value = "codex";
    agent.onchange!();

    // Synchronously cleared!
    assert.equal(model.value, "");
    assert.equal(effort.value, "");

    // Wait for codex probe to resolve WHILE save is still blocked
    await codexProbeResolved;
    await writeStarted;
    for (let i = 0; i < 20; i++) await new Promise<void>((resolve) => setImmediate(resolve));

    // Even with codex options containing "xhigh", model/effort MUST remain "" and never contain "old-model"
    assert.equal(model.value, "");
    assert.equal(effort.value, "");
    assert.equal(model.children.some((o) => o.value === "old-model"), false);

    // Rebuilding display() while save is still pending MUST also not resurrect old-model/xhigh
    tab.display();
    for (let i = 0; i < 20; i++) await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(getControl("模型（Model）").value, "");
    assert.equal(getControl("推理强度（Effort）").value, "");

    // Release delayed save and verify persisted JSON
    settingsWriteGate = null;
    releaseSettingsWrite();
    for (let i = 0; i < 200 && controller.getAgentConfig().agentId !== "codex"; i++) {
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    for (let i = 0; i < 200 && JSON.parse(await disk.readText("_cache/web-settings.json")).agentId !== "codex"; i++) {
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    const saved = JSON.parse(await disk.readText("_cache/web-settings.json"));
    assert.deepEqual([saved.agentId, saved.model, saved.effort], ["codex", "", ""]);
  } finally {
    settingsWriteGate = null;
    releaseSettingsWrite();
    controller.dispose();
    await rm(dir, { recursive: true, force: true });
  }
});

test("M71: Web server POST /api/settings resets model and effort on cross-agent switch and validates agy", async () => {
  const dir = await testSandbox("m71-web-server-");
  const { port } = createAcpTestPort({
    installed: {
      dsh: { path: "/bin/dsh", version: "1.0", helpText: "ACP" },
      agy: { path: "/bin/agy", version: "2.0", helpText: "Agent Client Protocol" },
    },
    onSpawn(spec, wire) {
      wire.onRequest((req) => {
        if (req.method === "initialize") wire.reply(req, { agentCapabilities: {} });
        else if (req.method === "session/new") {
          wire.reply(req, {
            sessionId: "web-probe",
            configOptions: [
              { id: "model", name: "Model", type: "select", currentValue: "gemini-3-pro", options: [{ value: "gemini-3-pro", name: "Gemini 3 Pro" }] },
              { id: "thought_level", name: "Thinking", category: "thought_level", type: "select", currentValue: "high", options: [{ value: "low", name: "Low" }, { value: "high", name: "High" }] },
            ],
          });
        }
      });
    },
  });
  const server = await createPithWebServer({ workspaceDir: dir, processPort: port });
  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const base = `http://127.0.0.1:${address.port}`;
    const post = (path: string, data: unknown) => fetch(base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data) });

    assert.equal((await post("/api/settings", { agentId: "dsh", model: "old-model", effort: "xhigh" })).status, 200);
    // Same agent keeps model/effort
    const sameRes = await (await post("/api/settings", { agentId: "dsh" })).json() as { settings: { agentId: string; model: string; effort: string } };
    assert.deepEqual([sameRes.settings.agentId, sameRes.settings.model, sameRes.settings.effort], ["dsh", "old-model", "xhigh"]);

    // Switching to agy resets model & effort unless explicitly passed
    const switchRes = await (await post("/api/settings", { agentId: "agy" })).json() as { settings: { agentId: string; model: string; effort: string } };
    assert.deepEqual([switchRes.settings.agentId, switchRes.settings.model, switchRes.settings.effort], ["agy", "", ""]);

    // Probe agy options endpoint works
    const optionsRes = await fetch(`${base}/api/agents/options?id=agy`);
    assert.equal(optionsRes.status, 200);
    const options = await optionsRes.json() as Array<{ id: string }>;
    assert.ok(options.some((o) => o.id === "thought_level"));

    // Switching back with explicit model/effort preserves the explicit values
    const explicitRes = await (await post("/api/settings", { agentId: "dsh", model: "m-explicit", effort: "low" })).json() as { settings: { agentId: string; model: string; effort: string } };
    assert.deepEqual([explicitRes.settings.agentId, explicitRes.settings.model, explicitRes.settings.effort], ["dsh", "m-explicit", "low"]);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    await rm(dir, { recursive: true, force: true });
  }
});
