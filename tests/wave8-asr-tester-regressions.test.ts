import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { HostPort, HttpRequestSpec, HttpResponseData } from "../src/core/index.ts";
import { createNeuralSpeech, isLoopbackSafe } from "../src/plugins/speech-service/index.ts";
import { createPithWebServer } from "../src/shells/web/server.ts";

const config = { ttsProvider: "kokoro-local" as const, ttsEndpoint: "", ttsVoice: "", azureRegion: "", asrProvider: "whisper-local" as const, asrLoopbackUrl: "http://localhost:9999", rate: 1 };
const response = (text: string, contentType: string, status = 200): HttpResponseData => ({ status, headers: { "content-type": contentType }, bytes: new TextEncoder().encode(text), text: () => text });

for (const provider of ["whisper-local", "sensevoice-local"] as const) {
  test(`${provider} health distinguishes unverified protocol and invalid legacy model`, async () => {
    const calls: HttpRequestSpec[] = [];
    const host: HostPort = { id: "memory", storage: {} as HostPort["storage"], http: { request: async spec => { calls.push(spec); return spec.url.endsWith("/health") ? response("missing", "text/plain", 404) : response('{"text":"works"}', "application/json"); } } };
    const compatible = createNeuralSpeech(host, { ...config, asrProvider: provider, asrLoopbackUrl: "http://localhost:9999/v1/audio/transcriptions", asrModel: "custom" }, isLoopbackSafe);
    assert.equal((await compatible.transcribeAudio(new Uint8Array([1]))).text, "works");
    const health = await compatible.checkAsrHealth(); assert.equal(health.ok, false); assert.equal(health.status, "unverified"); assert.match(health.note, /未验证/); assert.equal(calls.length, 1);
    const invalid = createNeuralSpeech({ ...host, http: { request: async spec => { calls.push(spec); return response("ok", "text/plain"); } } }, { ...config, asrProvider: provider, asrModel: "custom" }, isLoopbackSafe);
    const invalidHealth = await invalid.checkAsrHealth(); assert.equal(invalidHealth.ok, false); assert.equal(invalidHealth.status, "failed"); assert.match(invalidHealth.note, /不支持指定模型/); assert.equal(calls.length, 1);
    const legacy = createNeuralSpeech({ ...host, http: { request: async spec => { calls.push(spec); return response("ok", "text/plain"); } } }, { ...config, asrProvider: provider }, isLoopbackSafe);
    const legacyHealth = await legacy.checkAsrHealth(); assert.equal(legacyHealth.ok, true); assert.equal(legacyHealth.status, "unverified"); assert.match(legacyHealth.note, /未验证/); assert.equal(calls.at(-1)!.url, "http://localhost:9999/health");
  });

  test(`${provider} only accepts documented transcription content types`, async () => {
    let result = response("<html>not an ASR result</html>", "text/html; charset=utf-8");
    const host: HostPort = { id: "memory", storage: {} as HostPort["storage"], http: { request: async () => result } };
    const legacy = createNeuralSpeech(host, { ...config, asrProvider: provider }, isLoopbackSafe);
    const compatible = createNeuralSpeech(host, { ...config, asrProvider: provider, asrLoopbackUrl: "http://localhost:9999/v1/audio/transcriptions" }, isLoopbackSafe);
    for (const client of [legacy, compatible]) await assert.rejects(client.transcribeAudio(new Uint8Array([1])), /Invalid transcription response/);
    result = response('{"text":"hello"}', "application/json; charset=utf-8");
    for (const client of [legacy, compatible]) assert.equal((await client.transcribeAudio(new Uint8Array([1]))).text, "hello");
    result = response("spoken words", "text/plain; charset=utf-8");
    assert.equal((await legacy.transcribeAudio(new Uint8Array([1]))).text, "spoken words");
    await assert.rejects(compatible.transcribeAudio(new Uint8Array([1])), /Invalid transcription response/);
    result = response("{invalid", "application/json"); await assert.rejects(legacy.transcribeAudio(new Uint8Array([1])), /Invalid transcription response/);
    result = response('"not an object"', "application/json"); await assert.rejects(compatible.transcribeAudio(new Uint8Array([1])), /Invalid transcription response/);
  });
}

test("web ASR provider settings preserve custom endpoints across changes and restart", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pith-asr-provider-"));
  let server: Awaited<ReturnType<typeof createPithWebServer>> | undefined;
  try {
    const start = async () => { server = await createPithWebServer({ workspaceDir: dir }); const address = server.address(); assert.ok(address && typeof address !== "string"); return `http://127.0.0.1:${address.port}`; };
    const close = async () => { await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve())); server = undefined; };
    let base = await start();
    for (const asrProvider of ["whisper-local", "sensevoice-local", "whisper-local"]) {
      const speech = { asrProvider, asrLoopbackUrl: "http://localhost:9876/custom" };
      const result = await fetch(`${base}/api/settings`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ speech }) });
      assert.equal(result.status, 200);
      assert.deepEqual((await result.json()).settings.speech, speech);
    }
    await close(); base = await start();
    const saved = (await (await fetch(`${base}/api/state`)).json()).settings.speech;
    assert.deepEqual(saved, { asrProvider: "whisper-local", asrLoopbackUrl: "http://localhost:9876/custom" });
  } finally { if (server) await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve())); await rm(dir, { recursive: true, force: true }); }
});
