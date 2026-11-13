import type { GuideMcpToolSpec, ToolServerPort, TurnEffect, TurnStep } from "../../core/index.ts";

export interface TurnTool extends GuideMcpToolSpec {
  readonly write: boolean;
  execute(input: Readonly<Record<string, unknown>>, signal?: AbortSignal, beginWrite?: () => void): Promise<unknown>;
  effects?(result: unknown, input: Readonly<Record<string, unknown>>): Promise<readonly TurnEffect[]> | readonly TurnEffect[];
}

export class ToolExecutionFailure extends Error {
  readonly effects: readonly TurnEffect[];
  constructor(message: string, effects: readonly TurnEffect[]) { super(message); this.effects = effects; }
}

/** Deadline applies to queueing and preparation only; an acknowledged disk write must finish. */
export const TOOL_PREPARATION_TIMEOUT_MS = 300_000;

export async function openTurnTools(port: ToolServerPort, tools: readonly TurnTool[], signal: AbortSignal, onStep: (step: TurnStep, index: number) => void, nextIndex: () => number, timeoutMs = TOOL_PREPARATION_TIMEOUT_MS) {
  const calls = new Map<string | number, AbortController>();
  const active = new Set<Promise<unknown>>();
  let writeTail = Promise.resolve();
  let accepting = true;
  const response = (id: unknown, result: unknown) => JSON.stringify({ jsonrpc: "2.0", id, result });
  const error = (id: unknown, code: number, message: string) => JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } });
  const endpoint = await port.open(async body => {
    let request: Record<string, unknown>;
    try { const parsed: unknown = JSON.parse(body); if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return error(null, -32600, "Invalid request"); request = parsed as Record<string, unknown>; }
    catch { return error(null, -32700, "Parse error"); }
    const id = request.id, method = request.method, params = request.params && typeof request.params === "object" && !Array.isArray(request.params) ? request.params as Record<string, unknown> : {};
    if (id === undefined) {
      if (method === "notifications/cancelled" && (typeof params.requestId === "string" || typeof params.requestId === "number")) calls.get(params.requestId)?.abort(new Error("已停止"));
      return "";
    }
    if (method === "initialize") return response(id, { protocolVersion: typeof params.protocolVersion === "string" ? params.protocolVersion : "2025-03-26", capabilities: { tools: {} }, serverInfo: { name: "pith", version: "0.1.0" } });
    if (method === "ping") return response(id, {});
    if (method === "tools/list") return response(id, { tools: tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
    if (method !== "tools/call") return error(id, -32601, "Method not found");
    const tool = tools.find(item => item.name === params.name);
    if (!tool || !params.arguments || typeof params.arguments !== "object" || Array.isArray(params.arguments)) return error(id, -32602, "Unknown tool or invalid arguments");
    if (!accepting) return error(id, -32600, "回合已结束");
    if (typeof id !== "string" && typeof id !== "number") return error(null, -32600, "Invalid request ID");
    if (calls.has(id)) return error(id, -32600, "Duplicate active request ID");
    const callId = String(id), index = nextIndex(), argumentsValue = params.arguments as Record<string, unknown>, preview = JSON.stringify(argumentsValue).slice(0, 500);
    const running: TurnStep = { kind: "tool", callId, name: tool.name, inputPreview: preview, status: "running", effects: [] };
    onStep(running, index);
    const cancel = new AbortController();
    if (typeof id === "number" || typeof id === "string") calls.set(id, cancel);
    let writing = false;
    const combined = AbortSignal.any([signal, cancel.signal]);
    let rejectCancelled!: (reason: unknown) => void;
    const cancelled = new Promise<never>((_resolve, reject) => { rejectCancelled = reject; });
    const abort = () => { if (!writing) rejectCancelled(signal.aborted ? new Error("已停止") : combined.reason); };
    combined.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(() => cancel.abort(new Error(`工具 ${tool.name} 等待超时 (${timeoutMs}ms)`)), timeoutMs);
    const beginWrite = () => {
      if (!tool.write) throw new Error("Read-only tool cannot write");
      combined.throwIfAborted();
      writing = true;
      clearTimeout(timer);
    };
    const work = async () => {
      combined.throwIfAborted();
      const result = await tool.execute(argumentsValue, combined, beginWrite);
      if (!writing) combined.throwIfAborted();
      const effects = tool.effects ? await tool.effects(result, argumentsValue) : [];
      return { result, effects };
    };
    const execution = tool.write ? writeTail.then(work) : work();
    const promise = (async () => {
      try {
        if (combined.aborted) abort();
        const { result, effects } = await Promise.race([execution, cancelled]);
        onStep({ ...running, status: "completed", summary: "完成", effects }, index);
        return response(id, { content: [{ type: "text", text: JSON.stringify(result ?? null) }] });
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        onStep({ ...running, status: "failed", summary: message, effects: cause instanceof ToolExecutionFailure ? cause.effects : [] }, index);
        return response(id, { isError: true, content: [{ type: "text", text: message }] });
      } finally {
        clearTimeout(timer);
        combined.removeEventListener("abort", abort);
        calls.delete(id);
      }
    })();
    if (tool.write) writeTail = Promise.allSettled([writeTail, promise]).then(() => {});
    active.add(promise); void promise.then(() => active.delete(promise), () => active.delete(promise));
    return promise;
  });
  return { endpoint, async drain() { accepting = false; for (const cancel of calls.values()) cancel.abort(new Error("已停止")); await Promise.allSettled([...active]); } };
}
