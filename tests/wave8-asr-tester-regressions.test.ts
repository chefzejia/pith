import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createContext, runInContext } from "node:vm";
import type { HostPort, HttpRequestSpec, HttpResponseData } from "../src/core/index.ts";
import { createNeuralSpeech, isLoopbackSafe } from "../src/plugins/speech-service/index.ts";

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

test("web ASR provider switching preserves custom endpoints and updates defaults", async () => {
  const source = await readFile(new URL("../src/shells/web/server.ts", import.meta.url), "utf8");
  const lines = source.split("\n");
  const submit = lines.find(line => line.startsWith("document.addEventListener('submit',async e=>{if(e.target.id!=='create'"));
  const options = lines.find(line => line.startsWith("const speechOptions="));
  const click = lines.find(line => line.startsWith("document.addEventListener('click',async e=>{const button=e.target.closest('button')"));
  assert.ok(submit && options && click);
  const handlers: Record<string, ((event: never) => Promise<void>)[]> = {};
  class Element {
    value = ""; disabled = false; textContent = ""; listeners: (() => void)[] = [];
    addEventListener(_type: string, fn: () => void) { this.listeners.push(fn); }
    insertAdjacentHTML() {}
    change(value: string) { this.value = value; for (const listener of this.listeners) listener(); }
  }
  const elements = new Map<string, Element>();
  const element = (key: string) => { if (!elements.has(key)) elements.set(key, new Element()); return elements.get(key)!; };
  const document = { addEventListener: (event: string, fn: (event: never) => Promise<void>) => { (handlers[event] ||= []).push(fn); } };
  const sent: { speech: { asrProvider: string; asrLoopbackUrl: string } }[] = [];
  const state = { settings: { speech: { asrProvider: "whisper-local", asrLoopbackUrl: "http://localhost:9876/custom" } } };
  const context = createContext({ document, $: element, state, api: async (_path: string, body: typeof sent[number]) => { sent.push(body); }, refresh: async () => {}, topic: null, drawer: { hidden: false }, notify: (error: unknown) => { throw error; } });
  runInContext(`${options}\n${click}\n${submit}`, context);
  await handlers.click![0]!({ target: { closest: () => ({ id: "settings" }) } } as never);
  const select = element("#asr-provider"), endpoint = element("#asr-endpoint");
  assert.equal(endpoint.value, "http://localhost:9876/custom");
  select.change("sensevoice-local"); assert.equal(endpoint.value, "http://localhost:9876/custom");
  select.change("whisper-local"); assert.equal(endpoint.value, "http://localhost:9876/custom");
  await handlers.submit![0]!({ target: { id: "settings-form" }, preventDefault() {} } as never);
  assert.equal(sent[0]!.speech.asrLoopbackUrl, "http://localhost:9876/custom");
  endpoint.value = "http://localhost:8765";
  select.change("sensevoice-local"); assert.equal(endpoint.value, "http://127.0.0.1:8766");
  select.change("whisper-local"); assert.equal(endpoint.value, "http://localhost:8765");
});
