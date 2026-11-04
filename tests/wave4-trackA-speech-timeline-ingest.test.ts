import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DefaultWorkspaceStore, type HostPort, type HttpRequestSpec, type HttpResponseData } from "../src/core/index.ts";
import { createNeuralSpeech, CURATED_ASR_PRESETS, CURATED_TTS_PRESETS, isLoopbackSafe, PrefetchSpeechQueue } from "../src/plugins/speech-service/index.ts";
import { renderTimelineView } from "../src/plugins/stage-timeline/index.ts";
import { ingestExternalUrl, isPublicHttpUrl, type PublicHttpPort } from "../src/plugins/guide-acp/externalIngest.ts";
import { createDshPluginBundle } from "../src/shells/dsh/index.ts";
import { NodeWorkspaceStorage } from "../src/shells/web/nodeStorage.ts";

const encoder = new TextEncoder();
const response = (content: string, type = "audio/mpeg", status = 200): HttpResponseData => {
  const bytes = encoder.encode(content); return { bytes, status, headers: { "content-type": type }, text: () => new TextDecoder().decode(bytes) };
};
const config = { ttsProvider: "kokoro-local" as const, ttsEndpoint: "", ttsVoice: "", azureRegion: "", asrProvider: "whisper-local" as const, asrLoopbackUrl: "http://localhost:8765", rate: 1 };
const storage = {} as HostPort["storage"];

test("curated TTS requests, missing prerequisites, and no fallback", async () => {
  const calls: HttpRequestSpec[] = [];
  const http = { async request(spec: HttpRequestSpec) { calls.push(spec); return response("audio"); }, async requestPublicSpeech(spec: HttpRequestSpec) { return this.request(spec); } };
  const host: HostPort = { id: "memory", storage, http, secrets: { getSecret: async () => "secret" } };
  assert.deepEqual(CURATED_TTS_PRESETS.map(p => p.id), ["kokoro-local", "openai-tts", "azure-neural"]);
  for (const [provider, region] of [["kokoro-local", ""], ["openai-tts", ""], ["azure-neural", "eastus"]] as const) {
    const client = createNeuralSpeech(host, { ...config, ttsProvider: provider, azureRegion: region }, isLoopbackSafe);
    assert.equal((await client.synthesizeSpeech("A & B")).providerId, provider);
    const request = calls.at(-1)!;
    if (provider === "azure-neural") { assert.match(String(request.body), /A &amp; B/); assert.equal(request.headers!["Ocp-Apim-Subscription-Key"], "secret"); }
    else { const body = JSON.parse(String(request.body)); assert.equal(body.input, "A & B"); assert.equal(body.model, provider === "kokoro-local" ? "kokoro" : "gpt-4o-mini-tts"); }
  }
  const noKey = createNeuralSpeech({ ...host, secrets: undefined }, { ...config, ttsProvider: "openai-tts" }, isLoopbackSafe);
  await assert.rejects(noKey.synthesizeSpeech("hello"), /OPENAI_API_KEY/);
  const offline = createNeuralSpeech({ ...host, http: { request: async () => { throw new Error("offline"); } } }, config, isLoopbackSafe);
  await assert.rejects(offline.synthesizeSpeech("hello"), /Kokoro/);
  assert.equal((await offline.checkTtsHealth()).ok, false);
  const empty = createNeuralSpeech({ ...host, http: { request: async () => response("") } }, config, isLoopbackSafe);
  await assert.rejects(empty.synthesizeSpeech("hello"), /Kokoro/);
  await assert.rejects(createNeuralSpeech(host, { ...config, ttsEndpoint: "http://192.168.1.1/" }, isLoopbackSafe).synthesizeSpeech("hello"), /Unsafe local/);
  await assert.rejects(createNeuralSpeech(host, { ...config, ttsProvider: "openai-tts", ttsEndpoint: "http://evil.example/v1/audio/speech" }, isLoopbackSafe).synthesizeSpeech("hello"), /Unsafe cloud/);
  const customLocal = createNeuralSpeech(host, { ...config, ttsProvider: "openai-compatible-local", ttsModel: "custom-tts-v1", ttsVoice: "custom-voice" }, isLoopbackSafe);
  assert.equal((await customLocal.synthesizeSpeech("Custom model")).providerId, "openai-compatible-local");
  const customBody = JSON.parse(String(calls.at(-1)!.body));
  assert.equal(customBody.model, "custom-tts-v1");
  assert.equal(customBody.voice, "custom-voice");
});

test("ASR local safety, health and cloud multipart", async () => {
  const calls: HttpRequestSpec[] = [];
  const http = { async request(spec: HttpRequestSpec) { calls.push(spec); return response('{"text":"hello", "language":"en", "duration":2}', "application/json"); }, async requestPublicSpeech(spec: HttpRequestSpec) { return this.request(spec); } };
  const host: HostPort = { id: "memory", storage, secrets: { getSecret: () => "key" }, http };
  assert.equal(CURATED_ASR_PRESETS.length, 3);
  for (const provider of ["whisper-local", "sensevoice-local", "openai-whisper"] as const) {
    const client = createNeuralSpeech(host, { ...config, asrProvider: provider, asrLoopbackUrl: provider === "openai-whisper" ? "" : config.asrLoopbackUrl }, isLoopbackSafe);
    assert.equal((await client.checkAsrHealth()).ok, true);
    const result = await client.transcribeAudio(encoder.encode("bytes"), "audio/webm");
    assert.equal(result.text, "hello"); assert.equal(result.providerId, provider);
    assert.match(calls.at(-1)!.url, provider === "openai-whisper" ? /audio\/transcriptions$/ : /\/transcribe$/);
    if (provider === "openai-whisper") assert.match(calls.at(-1)!.headers!["Content-Type"]!, /^multipart\/form-data/);
  }
  const unsafe = createNeuralSpeech(host, { ...config, asrLoopbackUrl: "http://10.0.0.1" }, isLoopbackSafe);
  await assert.rejects(unsafe.transcribeAudio(encoder.encode("audio")), /Unsafe local/);
  await assert.rejects(unsafe.transcribeAudio(new Uint8Array()), /Empty audio/);
});

test("prefetch reuses the requested sentence and cancels stale work", async () => {
  const seen: string[] = [];
  const queue = new PrefetchSpeechQueue(async (text, signal) => { seen.push(text); signal!.throwIfAborted(); return { bytes: encoder.encode(text), mimeType: "audio/mpeg", providerId: "kokoro-local" }; });
  queue.prefetch(1, "next");
  assert.equal(new TextDecoder().decode((await queue.get(1, "next")).bytes), "next");
  assert.deepEqual(seen, ["next"]);
  const aborted = new AbortController(); aborted.abort();
  await assert.rejects(queue.get(2, "cancel", aborted.signal));
  const automatic = new PrefetchSpeechQueue(async text => { seen.push(text); return { bytes: encoder.encode(text), mimeType: "audio/mpeg", providerId: "kokoro-local" }; });
  await automatic.getAndPrefetch(0, ["first", "second"]);
  await automatic.get(1, "second");
  assert.equal(seen.filter(text => text === "second").length, 1);
  const controller = new AbortController();
  const stalled = new PrefetchSpeechQueue(() => new Promise(() => {}));
  stalled.prefetch(1, "stalled");
  const waiting = stalled.get(1, "stalled", controller.signal);
  controller.abort();
  await assert.rejects(waiting);
});

test("timeline escapes user text and retains cue anchors and loop status", () => {
  const html = renderTimelineView({ title: "<Title>", mediaKind: "video", cues: [{ id: 'x"', text: "<script>", startSec: 2, endSec: 4 }], activeCueId: 'x"', loopRange: { startSec: 2, endSec: 4 } });
  assert.match(html, /pith-timeline-stage/); assert.match(html, /data-media-kind="video"/);
  assert.match(html, /data-cue-id="x&quot;"/); assert.match(html, /data-locator="time:2" data-prose="true"/);
  assert.match(html, /A 00:02 - B 00:04/); assert.doesNotMatch(html, /<script>/);
});

test("external ingestion requires pinned transport and imports into a topic", async () => {
  for (const url of ["http://localhost/", "http://127.1/", "http://10.0.0.1", "http://172.31.1.1", "http://192.168.1.1", "http://169.254.169.254", "http://[::1]/", "http://printer.local/", "https://user@public.com/"]) assert.equal(isPublicHttpUrl(url), false, url);
  assert.equal(isPublicHttpUrl("https://public.com/post"), true);
  let called = false;
  await assert.rejects(ingestExternalUrl({ url: "https://public.com/" }, { request: async () => { called = true; return response("x"); } }), /DNS pinning/);
  assert.equal(called, false);
  const http: PublicHttpPort = { request: async () => { throw new Error("insecure path"); }, requestPublic: async () => response("# Hello\n\nSafe [link](http://127.0.0.1/) <script>x</script>", "text/markdown") };
  const dir = await mkdtemp(join(tmpdir(), "pith-ingest-"));
  try {
    const disk = new NodeWorkspaceStorage(dir); const store = new DefaultWorkspaceStore(disk); await store.ensureScaffold();
    const topic = await store.createTopic({ title: "Topic" });
    const tool = createDshPluginBundle({ storage: disk, http }).tools.find(item => item.name === "pith_ingest_external")!;
    const imported = await tool.execute({ url: "https://public.com/post", topicId: topic.id }) as { material: { id: string } };
    assert.equal((await store.getTopic(topic.id))!.materialId, imported.material.id);
    const body = await disk.readText(`materials/${imported.material.id}/files/article.md`);
    assert.match(body, /Hello/); assert.doesNotMatch(body, /127\.0\.0\.1|<script>/);
    await assert.rejects(tool.execute({ url: "http://localhost" }), /not public/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
