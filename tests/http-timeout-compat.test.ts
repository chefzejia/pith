import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { NodeHttpPort } from "../src/shells/web/nodeHttp.ts";

const publicIp = "93.184.216.34";
const response = (body: string, type: string, status = 200) => {
  const bytes = new TextEncoder().encode(body);
  return { status, headers: { "content-type": type }, bytes, text: () => new TextDecoder().decode(bytes) };
};

test("ordinary HTTP requests retain the 30 second idle timeout", async () => {
  const http = await import("node:http");
  const originalRequest = http.default.request;
  const timeouts: number[] = [];
  http.default.request = ((url: URL, _options: unknown, callback: (response: unknown) => void) => {
    const request = new EventEmitter() as EventEmitter & { setTimeout(timeout: number): EventEmitter; write(): void; end(): void; destroy(error?: Error): void };
    request.setTimeout = (timeout: number) => { timeouts.push(timeout); return request; };
    request.write = () => {};
    request.destroy = (error?: Error) => { if (error) request.emit("error", error); };
    request.end = () => {
      const response = new EventEmitter() as EventEmitter & { statusCode: number; headers: Record<string, string> };
      response.statusCode = 200; response.headers = {};
      callback(response);
      response.emit("data", Buffer.from("ok"));
      response.emit("end");
    };
    return request as unknown as ReturnType<typeof originalRequest>;
  }) as typeof http.default.request;
  try {
    const port = new NodeHttpPort();
    const result = await port.request({ url: "http://example.com/" });
    assert.equal(result.text(), "ok");
    assert.deepEqual(timeouts, [30_000]);
  } finally { http.default.request = originalRequest; }
});

test("public HTTP deadlines cover DNS and responses without opening sockets", { timeout: 5000 }, async () => {
  let releaseDns: (() => void) | undefined, sendStarted: (() => void) | undefined;
  let sends = 0;
  const port = new NodeHttpPort({
    async resolve(hostname) {
      if (hostname === "slow.example.com") return new Promise(resolve => { releaseDns = () => resolve([{ address: publicIp, family: 4 }]); });
      if (hostname === "private.example.com") return [{ address: "127.0.0.1", family: 4 }];
      return [{ address: publicIp, family: 4 }];
    },
    async send(_url, _address, _spec, _maxBytes, _responseLimit, signal) {
      sends++;
      sendStarted?.();
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, 250);
        signal?.addEventListener("abort", () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
      });
      return response("ok", "text/plain");
    },
  });

  await assert.rejects(port.requestPublic({ url: "https://slow.example.com/", timeoutMs: 40 }, 100), /timed out/i);
  assert.equal(typeof releaseDns, "function");
  releaseDns?.();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(sends, 0, "timed-out DNS does not reach the sender");

  await assert.rejects(port.requestPublic({ url: "https://public.example.com/", timeoutMs: 40 }, 100), /timed out/i);
  const controller = new AbortController();
  const started = new Promise<void>(resolve => { sendStarted = resolve; });
  const pending = port.requestPublic({ url: "https://public.example.com/", signal: controller.signal }, 100);
  await started;
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
  await assert.rejects(port.requestPublic({ url: "https://private.example.com/" }, 100), /non-public address/);
  assert.equal(sends, 2, "private DNS is rejected before sending");
  await assert.rejects(port.requestPublic({ url: "https://public.example.com/", timeoutMs: 0 }, 100), /Invalid HTTP timeout/);

  const status = new NodeHttpPort({
    async resolve() { return [{ address: publicIp, family: 4 }]; },
    async send() { return response("failure", "text/plain", 503); },
  });
  await assert.rejects(status.requestPublic({ url: "https://public.example.com/" }, 100), /Public HTTP request rejected: 503/);
});
