import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer, type Server } from "node:http";
import test from "node:test";
import type { HostPort, HttpRequestSpec } from "../src/core/index.ts";
import { createNeuralSpeech, isLoopbackSafe } from "../src/plugins/speech-service/index.ts";
import { NodeHttpPort } from "../src/shells/web/nodeHttp.ts";

async function listen(server: Server): Promise<string> {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return `http://127.0.0.1:${address.port}`;
}

async function close(server: Server): Promise<void> {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}

test("curated speech providers use host timeout policy without a local inference extension", async () => {
  const calls: HttpRequestSpec[] = [];
  const host: HostPort = { id: "memory", storage: {} as HostPort["storage"], secrets: { getSecret: () => "test-key" }, http: { async request(spec) {
    calls.push(spec);
    return { status: 200, headers: { "content-type": "audio/mpeg" }, bytes: new TextEncoder().encode("audio"), text: () => "audio" };
  } } };
  for (const provider of ["kokoro-local", "openai-tts", "azure-neural"] as const) {
    const speech = createNeuralSpeech(host, { ttsProvider: provider, ttsEndpoint: "", ttsVoice: "", azureRegion: "eastus", asrProvider: "whisper-local", asrLoopbackUrl: "http://localhost:8765", rate: 1 }, isLoopbackSafe);
    const result = await speech.synthesizeSpeech("Test sentence.");
    assert.equal(result.providerId, provider);
    assert.equal(result.mimeType, "audio/mpeg");
    assert.equal(calls.at(-1)!.timeoutMs, undefined);
  }
});

test("an unavailable local speech engine fails closed without trying another provider", async () => {
  const calls: HttpRequestSpec[] = [];
  const host: HostPort = { id: "memory", storage: {} as HostPort["storage"], http: { async request(spec) {
    calls.push(spec);
    throw Object.assign(new Error("connection refused"), { code: "ECONNREFUSED" });
  } } };
  const speech = createNeuralSpeech(host, { ttsProvider: "kokoro-local", ttsEndpoint: "", ttsVoice: "", azureRegion: "", asrProvider: "whisper-local", asrLoopbackUrl: "http://localhost:8765", rate: 1 }, isLoopbackSafe);
  await assert.rejects(speech.synthesizeSpeech("Test sentence."), /connection refused.*Kokoro/i);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.url, "http://127.0.0.1:8880/v1/audio/speech");
  const health = await speech.checkTtsHealth();
  assert.equal(health.ok, false);
  assert.match(health.note, /connection refused.*Kokoro/i);
  assert.equal(calls.length, 2);
  assert.equal(calls[1]!.url, "http://127.0.0.1:8880/health");
});

test("HTTP deadlines remain bounded during streaming and cancellation closes the request", async () => {
  let requestReceived!: () => void;
  let requestClosed!: () => void;
  const received = new Promise<void>(resolve => { requestReceived = resolve; });
  const closed = new Promise<void>(resolve => { requestClosed = resolve; });
  const server = createServer((req, res) => {
    if (req.url === "/cancel") { res.once("close", requestClosed); requestReceived(); return; }
    res.writeHead(200); res.write("partial");
    const timer = setInterval(() => res.write("more"), 10);
    res.once("close", () => clearInterval(timer));
  });
  const base = await listen(server);
  try {
    const http = new NodeHttpPort();
    await assert.rejects(http.request({ url: `${base}/stream`, timeoutMs: 100, signal: AbortSignal.timeout(1000) }), /HTTP request timed out/);
    const controller = new AbortController();
    const host: HostPort = { id: "obsidian", storage: {} as HostPort["storage"], http };
    const speech = createNeuralSpeech(host, { ttsProvider: "kokoro-local", ttsEndpoint: `${base}/cancel`, ttsVoice: "", azureRegion: "", asrProvider: "whisper-local", asrLoopbackUrl: "http://localhost:8765", rate: 1 }, isLoopbackSafe);
    const pending = speech.synthesizeSpeech("Test sentence.", controller.signal);
    await received;
    controller.abort();
    await assert.rejects(pending, { name: "AbortError" });
    await closed;
    await assert.rejects(http.request({ url: `${base}/cancel`, timeoutMs: 0 }), /Invalid HTTP timeout/);
  } finally { await close(server); }
});

test("HTTP response errors reject instead of returning partial audio", async () => {
  const server = createServer((_req, res) => {
    res.writeHead(200); res.write("partial");
    res.socket!.destroy();
  });
  const base = await listen(server);
  try { await assert.rejects(new NodeHttpPort().request({ url: base })); }
  finally { await close(server); }
});
