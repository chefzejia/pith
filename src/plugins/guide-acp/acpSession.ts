import { libraryOverview } from "../../core/library.ts";
import type {
  AgentProcessPort,
  AgentProcessSpawnSpec,
  AgentStdioHandle,
  AcpConfigOptionDescriptor,
  AttentionEngine,
  DiscoveredAgentDescriptor,
  GuideProvider,
  ToolServerPort,
  TurnStep,
  HttpPort,
  MediaCorpusPort,
  LibraryOverview,
  RepositoryPort,
  ToolkitDescriptor,
  Material,
  SelectionAnchor,
  StageReaderService,
  Topic,
  WorkspaceStore,
  WorkspaceStoragePort,
} from "../../core/index.ts";
import { createScopedTools, normalizeToolkits } from "./tools.ts";
import { openTurnTools } from "./mcpTools.ts";
import { selectConversationHistory, type GuideHistoryTurn } from "./conversationMemory.ts";

export { normalizeToolkits } from "./tools.ts";

/** Deadline of a background prompt when the caller configures none; foreground turns have no prompt deadline. */
export const AGENT_REQUEST_TIMEOUT_MS = 300_000;
/** Upper bound of each handshake request (initialize, session/new, configuration), so an executable that does not speak ACP fails early. */
export const AGENT_HANDSHAKE_TIMEOUT_MS = 60_000;

export interface JsonRpcRequestMessage {
  readonly jsonrpc: "2.0";
  readonly id?: number | string;
  readonly method: string;
  readonly params?: Record<string, unknown>;
}

export interface JsonRpcResponseMessage {
  readonly jsonrpc: "2.0";
  readonly id?: number | string | null;
  readonly result?: unknown;
  readonly error?: { readonly code: number; readonly message: string; readonly data?: unknown };
  readonly method?: string;
  readonly params?: Record<string, unknown>;
}

export function buildReadOnlyAgentEnv(
  descriptor: Pick<DiscoveredAgentDescriptor, "id" | "command">,
  baseEnv: Readonly<Record<string, string | undefined>> = {},
): Record<string, string | undefined> {
  const isDsh =
    descriptor.id === "dsh" || /(^|[\\/])dsh(?:\.exe)?$/iu.test(descriptor.command ?? "");
  if (isDsh) {
    return {
      ...baseEnv,
      DSH_PERMISSION_MODE: "read-only",
    };
  }
  return { ...baseEnv };
}

export interface AcpClientSessionOptions {
  readonly descriptor: DiscoveredAgentDescriptor;
  readonly processPort: AgentProcessPort;
  readonly cwd?: string;
  readonly readOnlyPaths?: readonly string[];
  readonly model?: string;
  readonly effort?: string;
  readonly timeoutMs?: number;
  readonly onTextDelta?: (delta: string) => void;
  readonly probeOnly?: boolean;
  readonly mcp?: { readonly url: string; readonly headers: readonly { readonly name: string; readonly value: string }[]; readonly toolNames: readonly string[]; readonly onUpdate: (update: Record<string, unknown>) => void };
}

export interface AcpPromptResult {
  readonly sessionId: string;
  readonly text: string;
  readonly stopReason: string;
  readonly configOptions?: readonly AcpConfigOptionDescriptor[];
}

export function parseAcpConfigOptions(raw: unknown): AcpConfigOptionDescriptor[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap(item => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const record = item as Record<string, unknown>;
    if (typeof record.id !== "string" || typeof record.name !== "string" || typeof record.type !== "string") return [];
    const choices: AcpConfigOptionDescriptor["options"][number][] = [];
    const add = (value: unknown, group?: string, groupLabel?: string): void => {
      if (!value || typeof value !== "object" || Array.isArray(value)) return;
      const choice = value as Record<string, unknown>;
      if (Array.isArray(choice.options)) {
        const id = typeof choice.group === "string" ? choice.group : undefined;
        const label = typeof choice.name === "string" ? choice.name : id;
        for (const child of choice.options) add(child, id, label);
      } else if (typeof choice.value === "string" && typeof choice.name === "string") {
        choices.push({ value: choice.value, name: choice.name, ...(group !== undefined ? { group } : {}), ...(groupLabel !== undefined ? { groupLabel } : {}), ...(typeof choice.description === "string" ? { description: choice.description } : {}) });
      }
    };
    if (Array.isArray(record.options)) for (const choice of record.options) add(choice);
    return [{ id: record.id, name: record.name, type: record.type, ...(typeof record.category === "string" ? { category: record.category } : {}), ...(typeof record.currentValue === "string" ? { currentValue: record.currentValue } : {}), options: choices }];
  });
}

export function createGuidePermissionGate(allowedToolNames: readonly string[], titlePrefix = "mcp__pith__"): {
  observe(event: { readonly type: string; readonly toolCallId: string; readonly title?: string; readonly rawInput?: unknown; readonly status?: string }): void;
  decide(request: { readonly toolCallId: string }): "allow_once" | "reject_once";
} {
  const names = new Set(allowedToolNames.filter(name => /^pith_[a-z0-9_]+$/.test(name)));
  const calls = new Set<string>();
  return {
    observe(event) {
      if (event.type === "tool-call") {
        calls.delete(event.toolCallId);
        if (typeof event.title === "string" && [...names].some(name => event.title === `${titlePrefix}${name}`)) calls.add(event.toolCallId);
      } else if (event.type === "tool-call-update" && (event.status === "completed" || event.status === "failed")) calls.delete(event.toolCallId);
    },
    decide(request) { return calls.delete(request.toolCallId) ? "allow_once" : "reject_once"; },
  };
}

function extractTextFromPromptResult(result: unknown): { text: string; stopReason: string } {
  if (!result || typeof result !== "object") {
    return { text: "", stopReason: "end_turn" };
  }
  const obj = result as Record<string, unknown>;
  const stopReason = typeof obj.stopReason === "string" ? obj.stopReason : "end_turn";
  if (typeof obj.text === "string") {
    return { text: obj.text, stopReason };
  }
  if (Array.isArray(obj.content)) {
    const parts: string[] = [];
    for (const item of obj.content) {
      if (item && typeof item === "object" && typeof (item as Record<string, unknown>).text === "string") {
        parts.push((item as Record<string, unknown>).text as string);
      }
    }
    return { text: parts.join(""), stopReason };
  }
  return { text: "", stopReason };
}

function extractNotificationTextDelta(method: string, params: Record<string, unknown> | undefined): string {
  if (method !== "session/update" || !params) return "";
  const update = (params.update ?? params) as Record<string, unknown>;
  const sessionUpdate = update.sessionUpdate ?? update.type;
  if (sessionUpdate === "agent_message_chunk") {
    const content = update.content as Record<string, unknown> | undefined;
    if (content && typeof content.text === "string") return content.text;
    if (typeof update.text === "string") return update.text;
  }
  return "";
}

export async function runOneShotAcpPrompt(
  promptText: string,
  options: AcpClientSessionOptions,
  signal?: AbortSignal,
): Promise<AcpPromptResult> {
  if (!options.descriptor.available || !options.descriptor.command) {
    throw new Error(`Agent ${options.descriptor.label} (${options.descriptor.id}) has no available ACP endpoint`);
  }
  signal?.throwIfAborted();

  const timeoutMs = Math.min(600_000, Math.max(1_000, options.timeoutMs ?? AGENT_REQUEST_TIMEOUT_MS));
  const handshakeTimeoutMs = AGENT_HANDSHAKE_TIMEOUT_MS;
  const spawnSpec: AgentProcessSpawnSpec = {
    command: options.descriptor.command,
    args: options.descriptor.args,
    cwd: options.cwd,
    env: buildReadOnlyAgentEnv(options.descriptor),
    readOnlyPaths: options.readOnlyPaths,
  };

  const handle: AgentStdioHandle = await options.processPort.spawnStdio(spawnSpec);
  let nextId = 0;
  let streamedText = "";
  let sessionId = "";
  if (options.mcp && !options.descriptor.pithToolTitlePrefix) { await handle.close(1_500); throw new Error("Agent tool title format is not registered"); }
  const permissions = createGuidePermissionGate(options.mcp?.toolNames ?? [], options.descriptor.pithToolTitlePrefix);
  const pending = new Map<
    number,
    {
      resolve: (value: unknown) => void;
      reject: (reason: Error) => void;
      timer: ReturnType<typeof setTimeout> | undefined;
    }
  >();

  let failure: Error | undefined;
  const rejectAll = (error: Error) => {
    failure ??= error;
    for (const [id, entry] of pending) {
      clearTimeout(entry.timer);
      pending.delete(id);
      entry.reject(failure);
    }
  };

  const send = (message: object) => {
    try { void Promise.resolve(handle.writeLine(JSON.stringify(message))).catch(error => rejectAll(error instanceof Error ? error : new Error(String(error)))); }
    catch (error) { rejectAll(error instanceof Error ? error : new Error(String(error))); }
  };
  const offLine = handle.onLine((line) => {
    if (failure) return;
    const trimmed = line.trim();
    if (!trimmed) return;
    let parsed: JsonRpcResponseMessage;
    try {
      const value: unknown = JSON.parse(trimmed);
      if (!value || typeof value !== "object" || Array.isArray(value) || (value as { jsonrpc?: unknown }).jsonrpc !== "2.0") throw new Error("Invalid frame");
      parsed = value as JsonRpcResponseMessage;
      if (parsed.params !== undefined && (!parsed.params || typeof parsed.params !== "object" || Array.isArray(parsed.params))) throw new Error("Invalid params");
      if (parsed.method === undefined && ((typeof parsed.id !== "number" && typeof parsed.id !== "string") || ("result" in parsed) === ("error" in parsed))) throw new Error("Invalid response");
      if ("error" in parsed && (!parsed.error || typeof parsed.error.message !== "string" || typeof parsed.error.code !== "number")) throw new Error("Invalid error");
    } catch {
      // Ignore known DSH model-catalog diagnostic line; fail on other corrupt frames
      if (/^\[llm-deepseek-(?:account|api-key)\] model listing/.test(trimmed)) {
        return;
      }
      rejectAll(new Error(`Invalid ACP JSON-RPC frame: ${trimmed.slice(0, 120)}`));
      return;
    }

    if (parsed.params?.sessionId !== undefined && parsed.params.sessionId !== sessionId) return;
    if (typeof parsed.method === "string" && parsed.id !== undefined && parsed.id !== null) {
      if (parsed.method === "session/request_permission") {
        const toolCall = parsed.params?.toolCall;
        const id = toolCall && typeof toolCall === "object" && !Array.isArray(toolCall) ? (toolCall as Record<string, unknown>).toolCallId : undefined;
        const decision = permissions.decide({ toolCallId: typeof id === "string" ? id : "" });
        const choices = parsed.params?.options;
        const option = Array.isArray(choices) ? choices.find(item => item && typeof item === "object" && item.kind === decision && typeof item.optionId === "string") as { optionId: string } | undefined : undefined;
        send({
          jsonrpc: "2.0",
          id: parsed.id,
          result: { outcome: option ? { outcome: "selected", optionId: option.optionId } : { outcome: "cancelled" } },
        });
        return;
      }
      send({
        jsonrpc: "2.0",
        id: parsed.id,
        error: { code: -32601, message: `Unsupported client method: ${parsed.method}` },
      });
      return;
    }

    // Handle streaming notifications
    if (typeof parsed.method === "string") {
      if (parsed.method === "session/update" && parsed.params) {
        const value = parsed.params.update;
        if (value && typeof value === "object" && !Array.isArray(value)) {
          const update = value as Record<string, unknown>;
          const id = typeof update.toolCallId === "string" ? update.toolCallId : "";
          if (update.sessionUpdate === "tool_call") permissions.observe({ type: "tool-call", toolCallId: id, title: typeof update.title === "string" ? update.title : undefined });
          if (update.sessionUpdate === "tool_call_update") permissions.observe({ type: "tool-call-update", toolCallId: id, status: typeof update.status === "string" ? update.status : undefined });
          try { options.mcp?.onUpdate(update); }
          catch (error) { rejectAll(error instanceof Error ? error : new Error(String(error))); }
        }
      }
      const delta = extractNotificationTextDelta(parsed.method, parsed.params);
      if (delta) {
        streamedText += delta;
        try { options.onTextDelta?.(delta); }
        catch (error) { rejectAll(error instanceof Error ? error : new Error(String(error))); }
      }
      return;
    }

    if (typeof parsed.id === "number") {
      const entry = pending.get(parsed.id);
      if (!entry) return;
      clearTimeout(entry.timer);
      pending.delete(parsed.id);
      if (parsed.error) {
        entry.reject(new Error(parsed.error.message || `ACP error (${parsed.error.code})`));
      } else {
        entry.resolve(parsed.result);
      }
    }
  });

  const offError = handle.onError?.((err) => rejectAll(err)) ?? (() => {});
  const offExit =
    handle.onExit?.((code, sig) =>
      rejectAll(new Error(`ACP agent exited unexpectedly (${sig ?? code ?? "closed"})`)),
    ) ?? (() => {});

  const callRpc = (method: string, params: Record<string, unknown>, deadlineMs: number | null = handshakeTimeoutMs): Promise<unknown> => {
    if (failure) return Promise.reject(failure);
    if (signal?.aborted) return Promise.reject(new Error("ACP request cancelled"));
    const id = ++nextId;
    return new Promise((resolveCall, rejectCall) => {
      const timer = deadlineMs === null ? undefined : setTimeout(() => {
        pending.delete(id);
        rejectCall(new Error(`ACP request ${method} timed out after ${deadlineMs}ms`));
      }, deadlineMs);
      pending.set(id, { resolve: resolveCall, reject: rejectCall, timer });
      Promise.resolve().then(() =>
        handle.writeLine(
          JSON.stringify({
            jsonrpc: "2.0",
            id,
            method,
            params,
          } satisfies JsonRpcRequestMessage),
        ),
      ).catch((err) => {
        clearTimeout(timer);
        pending.delete(id);
        rejectCall(err instanceof Error ? err : new Error(String(err)));
      });
    });
  };

  let stopTimer: ReturnType<typeof setTimeout> | undefined;
  const onAbort = () => {
    if (sessionId) {
      send({ jsonrpc: "2.0", method: "session/cancel", params: { sessionId } });
    }
    if (options.mcp && sessionId) stopTimer = setTimeout(() => rejectAll(new Error("ACP request cancelled")), 5_000);
    else rejectAll(new Error("ACP request cancelled"));
  };
  signal?.addEventListener("abort", onAbort, { once: true });
  if (signal?.aborted) onAbort();

  try {
    const cwd = options.mcp ? (handle as AgentStdioHandle & { readonly cwd?: string }).cwd : options.cwd ?? (handle as AgentStdioHandle & { readonly cwd?: string }).cwd;
    if (!cwd || !/^(?:\/|[a-zA-Z]:[\\/]|\\\\)/u.test(cwd)) throw new Error("ACP 会话需要宿主提供绝对工作目录");
    const initialization = await callRpc("initialize", {
      protocolVersion: 1,
      clientCapabilities: {
        fs: { readTextFile: false, writeTextFile: false },
        terminal: false,
      },
      clientInfo: { name: "pith-guide-acp", version: "0.1.0" },
    });
    if (options.mcp && !(initialization && typeof initialization === "object" && (initialization as { agentCapabilities?: { mcpCapabilities?: { http?: boolean } } }).agentCapabilities?.mcpCapabilities?.http === true)) throw new Error("Agent does not support HTTP MCP");

    const newSessionResult = (await callRpc("session/new", {
      cwd,
      mcpServers: options.mcp ? [{ name: "pith", type: "http", url: options.mcp.url, headers: options.mcp.headers }] : [],
      permissionMode: "read-only",
      ...(!options.probeOnly && options.model ? { model: options.model } : {}),
      ...(!options.probeOnly && options.effort ? { reasoningEffort: options.effort } : {}),
    })) as Record<string, unknown> | undefined;

    if (typeof newSessionResult?.sessionId !== "string" || !newSessionResult.sessionId) throw new Error("ACP session/new returned no sessionId");
    sessionId = newSessionResult.sessionId;

    let configOptions = parseAcpConfigOptions(newSessionResult?.configOptions);
    if (options.probeOnly) return { sessionId, text: "", stopReason: "end_turn", configOptions };
    const modelOption = configOptions.find(option => option.id === "model");
    if (options.model && (!modelOption || modelOption.currentValue !== options.model)) {
      const result = await callRpc("session/set_config_option", { sessionId, configId: modelOption ? modelOption.id : "model", value: options.model });
      if (result && typeof result === "object" && Array.isArray((result as Record<string, unknown>).configOptions)) configOptions = parseAcpConfigOptions((result as Record<string, unknown>).configOptions);
    }
    const effortOption = configOptions.find(option => option.id === "reasoning_effort" || option.id === "effort" || option.category === "thought_level");
    if (options.effort && (!effortOption || effortOption.currentValue !== options.effort)) await callRpc("session/set_config_option", { sessionId, configId: effortOption ? effortOption.id : "reasoning_effort", value: options.effort });

    const promptResult = await callRpc("session/prompt", {
      sessionId,
      prompt: [{ type: "text", text: promptText }],
    }, options.mcp ? null : timeoutMs);

    const extracted = extractTextFromPromptResult(promptResult);
    const finalText = extracted.text || streamedText;
    return {
      sessionId,
      text: finalText,
      stopReason: extracted.stopReason,
    };
  } finally {
    if (stopTimer) clearTimeout(stopTimer);
    signal?.removeEventListener("abort", onAbort);
    offLine();
    offError();
    offExit();
    if (sessionId) send({ jsonrpc: "2.0", method: "session/close", params: { sessionId } });
    await handle.close(1_500);
  }
}

export interface LocalAcpGuideProviderOptions {
  readonly processPort: AgentProcessPort;
  readonly toolServer?: ToolServerPort;
  readonly store: WorkspaceStore;
  readonly engine?: AttentionEngine;
  readonly storage?: WorkspaceStoragePort;
  readonly http?: HttpPort;
  readonly repository?: RepositoryPort;
  readonly mediaCorpus?: MediaCorpusPort;
  readonly getToolkits?: () => readonly ToolkitDescriptor[];
  readonly getReader?: () => StageReaderService | undefined;
  readonly getAgentConfig: () => {
    readonly agentId: string;
    readonly model?: string;
    readonly effort?: string;
    readonly timeoutMs?: number;
    readonly cwd?: string;
    readonly readOnlyPaths?: readonly string[];
  };
  readonly resolveDescriptor: (agentId: string) => Promise<DiscoveredAgentDescriptor | null>;
  readonly buildScenePrompt: (input: {
    readonly profileMarkdown: string;
    readonly topic: Topic | null;
    readonly materials: readonly Material[];
    readonly availableToolkits?: readonly Pick<ToolkitDescriptor, "id" | "role" | "label" | "category" | "whenToUse">[];
    readonly userMessage: string;
    readonly conversation?: readonly GuideHistoryTurn[];
    readonly anchor?: SelectionAnchor;
  }, library: LibraryOverview) => string;
}

export class LocalAcpGuideProvider implements GuideProvider {
  private readonly options: LocalAcpGuideProviderOptions;

  constructor(options: LocalAcpGuideProviderOptions) {
    this.options = options;
  }

  private async resolveAgent() {
    const config = this.options.getAgentConfig();
    if (!config.agentId) {
      throw new Error("未选择向导 Agent（请在 guide-acp 设置中配置 agentId：dsh / claude / codex）");
    }
    const descriptor = await this.options.resolveDescriptor(config.agentId);
    if (!descriptor || !descriptor.available || !descriptor.command) {
      throw new Error(`向导 Agent "${config.agentId}" 不可用${descriptor?.note ? `：${descriptor.note}` : ""}`);
    }
    return { config, descriptor };
  }

  async run(input: Parameters<GuideProvider["run"]>[0], options: Parameters<GuideProvider["run"]>[1]): ReturnType<GuideProvider["run"]> {
    let endpoint: Awaited<ReturnType<typeof openTurnTools>> | undefined;
    const steps: TurnStep[] = [];
    let outcome: Awaited<ReturnType<GuideProvider["run"]>> = { status: "failed", error: "ACP 回合中断" };
    try {
      if (!this.options.toolServer || !this.options.storage) throw new Error("Host tool server unavailable");
      const { config, descriptor } = await this.resolveAgent();
      const topic = input.scope.kind === "topic" ? await this.options.store.getTopic(input.scope.topicId) : null;
      if (input.scope.kind === "topic" && !topic) throw new Error("Topic not found");
      const [profile, libraryMaterials, libraryTopics] = await Promise.all([
        this.options.store.readProfile(), this.options.store.listMaterials(), this.options.store.listTopics(),
      ]);
      const materialsById = new Map(libraryMaterials.map(material => [material.id, material]));
      const idsInScope = input.scope.kind === "intake" ? input.scope.materialIds : topic!.materialIds;
      const materials = [...new Set(idsInScope)].flatMap(id => {
        const material = materialsById.get(id);
        return material ? [material] : [];
      });
      const prompt = this.options.buildScenePrompt({
        profileMarkdown: profile.markdown, topic, materials,
        availableToolkits: this.options.getToolkits?.().filter(toolkit => toolkit.role === "training"),
        userMessage: input.text, conversation: selectConversationHistory(input.history),
        anchor: input.anchor,
      }, libraryOverview(libraryMaterials, libraryTopics));
      let count = 0;
      const nextIndex = () => count++;
      const publish = (step: TurnStep, index: number) => { steps[index] = step; options.onStep(step, index); };
      const tools = createScopedTools({ ...(topic ? { topicId: topic.id } : { materialIds: input.scope.kind === "intake" ? input.scope.materialIds : [] }), store: this.options.store, storage: this.options.storage,
        engine: this.options.engine, http: this.options.http, repository: this.options.repository,
        toolkits: this.options.getToolkits?.(), mediaCorpus: this.options.mediaCorpus, reader: this.options.getReader?.(), onChoices: options.onChoices });
      endpoint = await openTurnTools(this.options.toolServer, tools, options.signal, publish, nextIndex, config.timeoutMs);
      const ids = new Map<string, number>();
      const messages = new Map<string, number>();
      const pithTitles = new Set(tools.map(tool => `${descriptor.pithToolTitlePrefix ?? ""}${tool.name}`));
      const update = (event: Record<string, unknown>) => {
        const kind = event.sessionUpdate;
        if (kind === "agent_message_chunk" || kind === "agent_thought_chunk") {
          const content = event.content;
          const text = content && typeof content === "object" && typeof (content as Record<string, unknown>).text === "string" ? (content as Record<string, unknown>).text as string : "";
          if (!text) return;
          const stepKind = kind === "agent_message_chunk" ? "reply" : "thought";
          const key = typeof event.messageId === "string" ? `${stepKind}:${event.messageId}` : "";
          let index = key ? messages.get(key) : undefined;
          if (index === undefined && !key && count > 0 && steps[count - 1]?.kind === stepKind) index = count - 1;
          if (index === undefined) { index = nextIndex(); if (key) messages.set(key, index); }
          const previous = steps[index];
          if (stepKind === "reply") publish({ kind: "reply", markdown: (previous?.kind === "reply" ? previous.markdown : "") + text }, index);
          else publish({ kind: "thought", text: (previous?.kind === "thought" ? previous.text : "") + text }, index);
          return;
        }
        if (kind !== "tool_call" && kind !== "tool_call_update") return;
        const id = typeof event.toolCallId === "string" ? event.toolCallId : "";
        if (!id) return;
        if (typeof event.title === "string" && pithTitles.has(event.title)) {
          const index = ids.get(id);
          if (index !== undefined && index >= 0) publish({ kind: "thought", text: "" }, index);
          ids.set(id, -1); return;
        }
        const old = ids.get(id);
        if (old === -1) return;
        const index = old ?? nextIndex();
        ids.set(id, index);
        const previous = steps[index];
        const name = typeof event.title === "string" ? event.title : previous?.kind === "tool" ? previous.name : "tool";
        const status = previous?.kind === "tool" && previous.status !== "running" ? previous.status : event.status === "completed" || event.status === "failed" ? event.status : "running";
        publish({ kind: "tool", callId: id, name, inputPreview: "", status, effects: [] }, index);
      };
      const result = await runOneShotAcpPrompt(prompt, {
        descriptor, processPort: this.options.processPort, cwd: config.cwd,
        readOnlyPaths: [...new Set([...(config.readOnlyPaths ?? []), ...libraryMaterials.flatMap(material => material.externalPath ? [material.externalPath] : [])])],
        model: config.model, effort: config.effort, timeoutMs: config.timeoutMs,
        mcp: { url: endpoint.endpoint.url, headers: endpoint.endpoint.headers, toolNames: tools.map(tool => tool.name), onUpdate: update },
      }, options.signal);
      if (!steps.some(step => step.kind === "reply") && result.text) publish({ kind: "reply", markdown: result.text }, nextIndex());
      outcome = options.signal.aborted ? { status: "stopped" } : { status: "completed" };
    } catch (error) {
      outcome = options.signal.aborted ? { status: "stopped" } : { status: "failed", error: error instanceof Error ? error.message : String(error) };
    } finally {
      if (endpoint) { try { await endpoint.drain(); } finally { await endpoint.endpoint.close(); } }
      steps.forEach((step, index) => {
        if (step.kind === "tool" && step.status === "running") options.onStep({ ...step, status: "failed", summary: outcome.status === "failed" ? outcome.error : outcome.status === "stopped" ? "已停止" : "Agent 未报告工具结果" }, index);
      });
    }
    return outcome;
  }
}
