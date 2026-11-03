import type { HttpRequestSpec } from "../core/index.ts";

export async function withHttpDeadline<T>(spec: HttpRequestSpec, execute: (signal: AbortSignal | undefined) => Promise<T>): Promise<T> {
  const timeoutMs = spec.timeoutMs;
  if (timeoutMs !== undefined && (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 600_000)) throw new Error("Invalid HTTP timeout");
  const source = spec.signal;
  if (source) source.throwIfAborted();
  if (timeoutMs === undefined && !source) return execute(undefined);

  const controller = new AbortController();
  let deadline: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  const interrupted = new Promise<never>((_resolve, reject) => {
    if (source) {
      onAbort = () => { controller.abort(source.reason); reject(source.reason); };
      source.addEventListener("abort", onAbort, { once: true });
    }
    if (timeoutMs !== undefined) deadline = setTimeout(() => {
      const error = new Error("HTTP request timed out");
      controller.abort(error);
      reject(error);
    }, timeoutMs);
  });
  try { return await Promise.race([execute(controller.signal), interrupted]); }
  finally {
    if (deadline !== undefined) clearTimeout(deadline);
    if (source && onAbort) source.removeEventListener("abort", onAbort);
  }
}
