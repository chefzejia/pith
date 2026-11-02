import type {
  AgentProcessPort,
  AgentProcessSpawnSpec,
  AgentStdioHandle,
  DiscoveredAgentDescriptor,
  GuideConversationEntry,
  GuideProvider,
  SelectionAnchor,
  Topic,
  WorkspaceStore,
} from "../../core/index.ts";

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
}

export interface AcpPromptResult {
  readonly sessionId: string;
  readonly text: string;
  readonly stopReason: string;
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

  const timeoutMs = Math.min(600_000, Math.max(1_000, options.timeoutMs ?? 60_000));
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
  const pending = new Map<
    number,
    {
      resolve: (value: unknown) => void;
      reject: (reason: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();

  const rejectAll = (error: Error) => {
    for (const [id, entry] of pending) {
      clearTimeout(entry.timer);
      pending.delete(id);
      entry.reject(error);
    }
  };

  const offLine = handle.onLine((line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let parsed: JsonRpcResponseMessage;
    try {
      parsed = JSON.parse(trimmed) as JsonRpcResponseMessage;
    } catch {
      // Ignore known DSH model-catalog diagnostic line; fail on other corrupt frames
      if (/^\[llm-deepseek-(?:account|api-key)\] model listing/.test(trimmed)) {
        return;
      }
      rejectAll(new Error(`Invalid ACP JSON-RPC frame: ${trimmed.slice(0, 120)}`));
      return;
    }

    // Handle server-initiated permission requests strictly in read-only mode (reject mutations)
    if (typeof parsed.method === "string" && parsed.id !== undefined && parsed.id !== null) {
      if (parsed.method === "session/request_permission") {
        void handle.writeLine(
          JSON.stringify({
            jsonrpc: "2.0",
            id: parsed.id,
            result: { outcome: { outcome: "cancelled" }, optionId: "reject_once" },
          }),
        );
        return;
      }
      void handle.writeLine(
        JSON.stringify({
          jsonrpc: "2.0",
          id: parsed.id,
          error: { code: -32601, message: `Unsupported client method: ${parsed.method}` },
        }),
      );
      return;
    }

    // Handle streaming notifications
    if (typeof parsed.method === "string") {
      const delta = extractNotificationTextDelta(parsed.method, parsed.params);
      if (delta) {
        streamedText += delta;
        options.onTextDelta?.(delta);
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

  const callRpc = (method: string, params: Record<string, unknown>): Promise<unknown> => {
    const id = ++nextId;
    return new Promise((resolveCall, rejectCall) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        rejectCall(new Error(`ACP request ${method} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      pending.set(id, { resolve: resolveCall, reject: rejectCall, timer });
      Promise.resolve(
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

  const onAbort = () => {
    if (sessionId) {
      void handle.writeLine(
        JSON.stringify({
          jsonrpc: "2.0",
          method: "session/cancel",
          params: { sessionId },
        }),
      );
    }
    rejectAll(new Error("ACP request cancelled"));
  };
  signal?.addEventListener("abort", onAbort, { once: true });

  try {
    await callRpc("initialize", {
      protocolVersion: 1,
      clientCapabilities: {
        fs: { readTextFile: false, writeTextFile: false },
        terminal: false,
      },
      clientInfo: { name: "pith-guide-acp", version: "0.1.0" },
    });

    const newSessionResult = (await callRpc("session/new", {
      cwd: options.cwd ?? ".",
      mcpServers: [],
      permissionMode: "read-only",
      ...(options.model ? { model: options.model } : {}),
      ...(options.effort ? { reasoningEffort: options.effort } : {}),
    })) as Record<string, unknown> | undefined;

    sessionId =
      typeof newSessionResult?.sessionId === "string" && newSessionResult.sessionId
        ? newSessionResult.sessionId
        : "session-1";

    const promptResult = await callRpc("session/prompt", {
      sessionId,
      prompt: [{ type: "text", text: promptText }],
    });

    const extracted = extractTextFromPromptResult(promptResult);
    const finalText = extracted.text || streamedText;
    return {
      sessionId,
      text: finalText,
      stopReason: extracted.stopReason,
    };
  } finally {
    signal?.removeEventListener("abort", onAbort);
    offLine();
    offError();
    offExit();
    if (sessionId) {
      try {
        await handle.writeLine(
          JSON.stringify({
            jsonrpc: "2.0",
            method: "session/close",
            params: { sessionId },
          }),
        );
      } catch {
        // best-effort session close before process shutdown
      }
    }
    await handle.close(1_500);
  }
}

export interface LocalAcpGuideProviderOptions {
  readonly processPort: AgentProcessPort;
  readonly store: WorkspaceStore;
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
    readonly topic: Topic;
    readonly userMessage: string;
    readonly anchor?: SelectionAnchor;
  }) => string;
}

export class LocalAcpGuideProvider implements GuideProvider {
  private readonly options: LocalAcpGuideProviderOptions;

  constructor(options: LocalAcpGuideProviderOptions) {
    this.options = options;
  }

  async reply(
    input: {
      readonly topicId: string;
      readonly conversation: readonly GuideConversationEntry[];
      readonly anchor?: SelectionAnchor;
    },
    signal?: AbortSignal,
  ): Promise<string> {
    const config = this.options.getAgentConfig();
    if (!config.agentId) {
      throw new Error("未选择向导 Agent（请在 guide-acp 设置中配置 agentId：dsh / claude / codex）");
    }
    const descriptor = await this.options.resolveDescriptor(config.agentId);
    if (!descriptor || !descriptor.available || !descriptor.command) {
      throw new Error(`向导 Agent "${config.agentId}" 不可用${descriptor?.note ? `：${descriptor.note}` : ""}`);
    }

    const [profile, topic] = await Promise.all([
      this.options.store.readProfile(),
      this.options.store.getTopic(input.topicId),
    ]);
    if (!topic) {
      throw new Error(`Topic not found: ${input.topicId}`);
    }

    const lastUserEntry = [...input.conversation].reverse().find((item) => item.role === "user");
    const userMessage = lastUserEntry?.text ?? "请结合当前课题给出指导。";
    const promptText = this.options.buildScenePrompt({
      profileMarkdown: profile.markdown,
      topic,
      userMessage,
      anchor: input.anchor ?? lastUserEntry?.anchor,
    });

    const result = await runOneShotAcpPrompt(
      promptText,
      {
        descriptor,
        processPort: this.options.processPort,
        cwd: config.cwd,
        readOnlyPaths: config.readOnlyPaths,
        model: config.model,
        effort: config.effort,
        timeoutMs: config.timeoutMs,
      },
      signal,
    );
    return result.text;
  }
}
