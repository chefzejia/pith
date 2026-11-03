import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import type { HostPort } from "../src/core/index.ts";
import { createNeuralSpeech, isLoopbackSafe } from "../src/plugins/speech-service/index.ts";
import { NodeHttpPort } from "../src/shells/web/nodeHttp.ts";

for (const provider of ["whisper-local", "sensevoice-local"] as const) {
  for (const contentType of [null, "text/plain; charset=utf-8"] as const) {
    test(`${provider} accepts brace-prefixed literal transcription with ${contentType ?? "no Content-Type"}`, async () => {
      const body = "{hello} is a literal transcription";
      const server = createServer((req, res) => {
        req.resume();
        if (contentType !== null) res.setHeader("Content-Type", contentType);
        res.end(body);
      });
      await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
      const address = server.address(); assert.ok(address && typeof address !== "string");
      const host: HostPort = { id: "memory", storage: {} as HostPort["storage"], http: new NodeHttpPort() };
      const speech = createNeuralSpeech(host, { ttsProvider: "kokoro-local", ttsEndpoint: "", ttsVoice: "", azureRegion: "", asrProvider: provider, asrLoopbackUrl: `http://127.0.0.1:${address.port}`, rate: 1 }, isLoopbackSafe);
      try { assert.equal((await speech.transcribeAudio(new Uint8Array([1]))).text, body); }
      finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
    });
  }
  test(`${provider} parses JSON mislabeled as text/plain`, async () => {
    const body = '{"text":"recognized"}';
    const host: HostPort = { id: "memory", storage: {} as HostPort["storage"], http: { request: async () => ({ status: 200, headers: { "content-type": "text/plain" }, bytes: new TextEncoder().encode(body), text: () => body }) } };
    const legacy = createNeuralSpeech(host, { ttsProvider: "kokoro-local", ttsEndpoint: "", ttsVoice: "", azureRegion: "", asrProvider: provider, asrLoopbackUrl: "http://localhost:8765", rate: 1 }, isLoopbackSafe);
    assert.equal((await legacy.transcribeAudio(new Uint8Array([1]))).text, "recognized");
  });
  test(`${provider} accepts legacy JSON without reliable Content-Type and rejects HTML`, async () => {
    let type: string | null = null;
    let body = '{"text":"recognized", "language":"zh", "duration":2}';
    const server = createServer((req, res) => { req.resume(); if (type !== null) res.setHeader("Content-Type", type); res.end(body); });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const address = server.address(); assert.ok(address && typeof address !== "string");
    const host: HostPort = { id: "memory", storage: {} as HostPort["storage"], http: new NodeHttpPort() };
    const config = { ttsProvider: "kokoro-local" as const, ttsEndpoint: "", ttsVoice: "", azureRegion: "", asrProvider: provider, asrLoopbackUrl: `http://127.0.0.1:${address.port}`, rate: 1 };
    const legacy = createNeuralSpeech(host, config, isLoopbackSafe);
    const compatible = createNeuralSpeech(host, { ...config, asrLoopbackUrl: `${config.asrLoopbackUrl}/v1/audio/transcriptions` }, isLoopbackSafe);
    const audio = new Uint8Array([1, 2, 3]);
    try {
      for (const contentType of [null, "text/plain; charset=utf-8", "application/json; charset=utf-8"]) {
        type = contentType;
        const result = await legacy.transcribeAudio(audio);
        assert.deepEqual(result, { text: "recognized", language: "zh", durationSec: 2, providerId: provider });
      }
      for (const contentType of [null, "text/plain"]) {
        type = contentType;
        for (const literal of ["plain transcript", "{hello}", "{hello} is a literal transcription", "{quoted} \"words\""]) {
          body = literal; assert.equal((await legacy.transcribeAudio(audio)).text, literal);
        }
        body = '{"text":'; await assert.rejects(legacy.transcribeAudio(audio), /Invalid transcription response/);
        body = '{"error":"failed"}'; await assert.rejects(legacy.transcribeAudio(audio), /Empty transcription/);
      }
      for (const contentType of [null, "text/plain", "text/html"]) {
        type = contentType;
        for (const html of ["<!DOCTYPE html><html><body>gateway error</body></html>", "<html>gateway error</html>", "<script>alert(1)</script>"]) {
          body = html; await assert.rejects(legacy.transcribeAudio(audio), /Invalid transcription response/);
        }
      }
      type = "application/json"; body = "{hello} is a literal transcription"; await assert.rejects(legacy.transcribeAudio(audio), /Invalid transcription response/);
      type = "application/json"; body = '<html>gateway error</html>'; await assert.rejects(legacy.transcribeAudio(audio), /Invalid transcription response/);
      type = null; body = '{"text":"recognized"}'; await assert.rejects(compatible.transcribeAudio(audio), /Invalid transcription response/);
    } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
  });
}
