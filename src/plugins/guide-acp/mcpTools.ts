import type { GuideMcpToolSpec, ToolServerPort, TurnEffect, TurnStep } from "../../core/index.ts";

export interface TurnTool extends GuideMcpToolSpec {
  readonly write: boolean;
  execute(input: Readonly<Record<string, unknown>>, signal?: AbortSignal): Promise<unknown>;
  effects?(result: unknown, input: Readonly<Record<string, unknown>>): Promise<readonly TurnEffect[]> | readonly TurnEffect[];
}

export async function openTurnTools(port: ToolServerPort, tools: readonly TurnTool[], signal: AbortSignal, onStep: (step: TurnStep, index: number) => void, nextIndex: () => number) {
  const calls = new Map<string | number, AbortController>();
  const active = new Set<Promise<unknown>>();
  let writeTail = Promise.resolve();
  const response = (id: unknown, result: unknown) => JSON.stringify({ jsonrpc: "2.0", id, result });
  const error = (id: unknown, code: number, message: string) => JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } });
  const endpoint = await port.open(async body => {
    let request: Record<string, unknown>;
    try { const parsed: unknown = JSON.parse(body); if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return error(null, -32600, "Invalid request"); request = parsed as Record<string, unknown>; }
    catch { return error(null, -32700, "Parse error"); }
    const id = request.id, method = request.method, params = request.params && typeof request.params === "object" && !Array.isArray(request.params) ? request.params as Record<string, unknown> : {};
    if (id === undefined) {
      if (method === "notifications/cancelled" && (typeof params.requestId === "string" || typeof params.requestId === "number")) calls.get(params.requestId)?.abort();
      return "";
    }
    if (method === "initialize") return response(id, { protocolVersion: typeof params.protocolVersion === "string" ? params.protocolVersion : "2025-03-26", capabilities: { tools: {} }, serverInfo: { name: "pith", version: "0.1.0" } });
    if (method === "ping") return response(id, {});
    if (method === "tools/list") return response(id, { tools: tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
    if (method !== "tools/call") return error(id, -32601, "Method not found");
    const tool = tools.find(item => item.name === params.name);
    if (!tool || !params.arguments || typeof params.arguments !== "object" || Array.isArray(params.arguments)) return error(id, -32602, "Unknown tool or invalid arguments");
    const callId = String(id), index = nextIndex(), argumentsValue = params.arguments as Record<string, unknown>, preview = JSON.stringify(argumentsValue).slice(0, 500);
    const running: TurnStep = { kind: "tool", callId, name: tool.name, inputPreview: preview, status: "running", effects: [] };
    onStep(running, index);
    const cancel = new AbortController();
    if (typeof id === "number" || typeof id === "string") calls.set(id, cancel);
    const work = async () => {
      try {
        if (signal.aborted || cancel.signal.aborted) throw new Error("已停止");
        const result = await tool.execute(argumentsValue, AbortSignal.any([signal, cancel.signal]));
        const effects = tool.effects ? await tool.effects(result, argumentsValue) : [];
        onStep({ ...running, status: "completed", summary: "完成", effects }, index);
        return response(id, { content: [{ type: "text", text: JSON.stringify(result ?? null) }] });
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        onStep({ ...running, status: "failed", summary: message, effects: [] }, index);
        return response(id, { isError: true, content: [{ type: "text", text: message }] });
      } finally { if (typeof id === "number" || typeof id === "string") calls.delete(id); }
    };
    const promise = tool.write ? writeTail.then(work) : work();
    if (tool.write) writeTail = promise.then(() => {}, () => {});
    active.add(promise); void promise.finally(() => active.delete(promise));
    return promise;
  });
  return { endpoint, async drain() { await Promise.allSettled([...active]); } };
}
