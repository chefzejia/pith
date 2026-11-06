import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { HttpRequestSpec, SpeechAsrService, SpeechTtsService } from "../src/core/index.ts";
import { PithObsidianController } from "../src/shells/obsidian/index.ts";
import { switchSpeechMode } from "../src/shells/speech/speechSettings.ts";
import { NodeWorkspaceStorage } from "../src/shells/web/nodeStorage.ts";
import { NodeHttpPort } from "../src/shells/web/nodeHttp.ts";
import { createPithWebServer } from "../src/shells/web/server.ts";

const local = { ttsProvider: "kokoro-local", ttsEndpoint: "http://127.0.0.1:18880/tts", ttsModel: "local-model", ttsVoice: "local-voice", asrProvider: "whisper-local", asrLoopbackUrl: "http://127.0.0.1:18765/v1/audio/transcriptions", asrModel: "local-asr" };
const cloud = { ttsProvider: "openai-tts", ttsEndpoint: "https://speech.example.com/v1/audio/speech", ttsModel: "cloud-model", ttsVoice: "cloud-voice", asrProvider: "openai-whisper", asrLoopbackUrl: "https://speech.example.com/v1/audio/transcriptions", asrModel: "cloud-asr" };
const reply = (spec: HttpRequestSpec) => { const value = spec.url.includes("transcriptions") ? '{"text":"ok"}' : "audio"; const bytes = new TextEncoder().encode(value); return { status: 200, headers: { "content-type": spec.url.includes("transcriptions") ? "application/json" : "audio/mpeg" }, bytes, text: () => value }; };

test("mode transition preserves legacy config and uses independent defaults", () => {
  const next = switchSpeechMode(local, {}, "cloud");
  assert.deepEqual(next.speech, { ttsProvider: "openai-tts", asrProvider: "openai-whisper" });
  assert.deepEqual(next.profiles.local, local);
  const back = switchSpeechMode(cloud, next.profiles, "local");
  assert.deepEqual(back.speech, local); assert.deepEqual(back.profiles.cloud, cloud);
  assert.deepEqual(switchSpeechMode(back.speech, back.profiles, "cloud").speech, cloud);
  const legacy = { ...local, ttsProvider: "azure-neural", azureRegion: "eastus" };
  const migration = switchSpeechMode(legacy, {}, "cloud");
  assert.deepEqual(migration.profiles.legacy, legacy);
  assert.deepEqual(migration.speech, { ttsProvider: "openai-tts", asrProvider: "openai-whisper" });
});

test("Obsidian preserves both profiles across restarts and sends each mode to its endpoint", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pith-speech-modes-"));
  const calls: { route: string; spec: HttpRequestSpec }[] = [];
  const host = { id: "obsidian" as const, storage: new NodeWorkspaceStorage(dir), secrets: { getSecret: () => "test-only" }, http: { request: async (spec: HttpRequestSpec) => { calls.push({ route: "local", spec }); return reply(spec); }, requestPublicSpeech: async (spec: HttpRequestSpec) => { calls.push({ route: "public", spec }); return reply(spec); } } };
  let controller = new PithObsidianController(host);
  try {
    await controller.initialize(); await controller.setSpeechConfig(local); await controller.setSpeechMode("cloud");
    assert.deepEqual(controller.getSpeechConfig(), { ttsProvider: "openai-tts", asrProvider: "openai-whisper" });
    await controller.runtime.getService<SpeechTtsService>("speech.tts")!.synthesizeSpeech!("default");
    await controller.runtime.getService<SpeechAsrService>("speech.asr")!.transcribeAudio!(new Uint8Array([1]));
    assert.deepEqual(calls.map(call => call.spec.url), ["https://api.openai.com/v1/audio/speech", "https://api.openai.com/v1/audio/transcriptions"]); calls.length = 0;
    await controller.setSpeechConfig(cloud); controller.dispose(); controller = new PithObsidianController(host); await controller.initialize();
    const speak = async () => { await controller.runtime.getService<SpeechTtsService>("speech.tts")!.synthesizeSpeech!("hello"); await controller.runtime.getService<SpeechAsrService>("speech.asr")!.transcribeAudio!(new Uint8Array([1])); };
    await speak(); await controller.setSpeechMode("local"); assert.deepEqual(controller.getSpeechConfig(), local); await speak();
    controller.dispose(); controller = new PithObsidianController(host); await controller.initialize(); await controller.setSpeechMode("cloud"); assert.deepEqual(controller.getSpeechConfig(), cloud);
    assert.deepEqual(calls.map(call => call.route), ["public", "public", "local", "local"]);
    assert.deepEqual(calls.map(call => call.spec.url), [cloud.ttsEndpoint, cloud.asrLoopbackUrl, local.ttsEndpoint, local.asrLoopbackUrl]);
  } finally { controller.dispose(); await rm(dir, { recursive: true, force: true }); }
});

test("Web mode changes persist independently and route requests after restart", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pith-web-modes-"));
  const calls: { route: string; spec: HttpRequestSpec }[] = [];
  const original = NodeHttpPort.prototype.request, originalPublic = NodeHttpPort.prototype.requestPublicSpeech;
  NodeHttpPort.prototype.request = async function (spec) { calls.push({ route: "local", spec }); return reply(spec); };
  NodeHttpPort.prototype.requestPublicSpeech = async function (spec) { calls.push({ route: "public", spec }); return reply(spec); };
  let server: Awaited<ReturnType<typeof createPithWebServer>> | undefined; let base = "";
  const start = async () => { server = await createPithWebServer({ workspaceDir: dir }); const address = server.address(); assert.ok(address && typeof address !== "string"); base = `http://127.0.0.1:${address.port}`; };
  const close = async () => { if (server) { const running = server; server = undefined; await new Promise<void>((resolve, reject) => running.close(error => error ? reject(error) : resolve())); } };
  const post = async (path: string, value: unknown) => { const response = await fetch(base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(value) }); assert.equal(response.status, 200); return path === "/api/speech/synthesize" ? response.arrayBuffer() : response.json(); };
  try {
    await start(); await post("/api/settings", { speech: local });
    let result = await post("/api/settings", { speechMode: "cloud" }); assert.deepEqual(result.settings.speech, { ttsProvider: "openai-tts", asrProvider: "openai-whisper" });
    await post("/api/settings", { speech: cloud, secrets: { OPENAI_API_KEY: "test-only" } }); await close(); await start();
    await post("/api/settings", { secrets: { OPENAI_API_KEY: "test-only" } });
    const speak = async () => { await post("/api/speech/synthesize", { text: "hello" }); await post("/api/speech/transcribe", { audio: Buffer.from("audio").toString("base64") }); };
    await speak(); result = await post("/api/settings", { speechMode: "local" }); assert.deepEqual(result.settings.speech, local); await speak();
    await close(); await start(); result = await post("/api/settings", { speechMode: "cloud" }); assert.deepEqual(result.settings.speech, cloud);
    assert.deepEqual(calls.map(call => call.route), ["public", "public", "local", "local"]);
    assert.deepEqual(calls.map(call => call.spec.url), [cloud.ttsEndpoint, cloud.asrLoopbackUrl, local.ttsEndpoint, local.asrLoopbackUrl]);
  } finally { await close(); NodeHttpPort.prototype.request = original; NodeHttpPort.prototype.requestPublicSpeech = originalPublic; await rm(dir, { recursive: true, force: true }); }
});

test("essentials mode only activates and authorizes explicitly mounted tools", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pith-default-dojo-"));
  await mkdir(join(dir, "obsidian")); await mkdir(join(dir, "web"));
  const controller = new PithObsidianController({ id: "obsidian", storage: new NodeWorkspaceStorage(join(dir, "obsidian")) });
  let server: Awaited<ReturnType<typeof createPithWebServer>> | undefined;
  try {
    await controller.initialize(); await controller.setPlugins({ preset: "essentials" });
    const topic = await controller.store.createTopic({ title: "reading" });
    await controller.importMaterial({ title: "reading", kind: "article", files: [{ name: "article.md", bytes: new TextEncoder().encode("A useful concept") }] }, topic.id);
    assert.equal(controller.runtime.getService("dojo.feynman"), undefined);
    await controller.store.updateTopic(topic.id, { toolkits: ["feynman"] }); await controller.setPlugins({ preset: "essentials" });
    assert.ok(controller.runtime.getService("dojo.feynman"));
    server = await createPithWebServer({ workspaceDir: join(dir, "web") }); const address = server.address(); assert.ok(address && typeof address !== "string");
    const base = `http://127.0.0.1:${address.port}`;
    const post = (path: string, data: unknown) => fetch(base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data) });
    assert.equal((await post("/api/plugins", { preset: "essentials" })).status, 200);
    const created = await post("/api/topics", { title: "reading" }); assert.equal(created.status, 201); const webTopic = await created.json();
    assert.equal((await post("/api/materials", { topicId: webTopic.id, title: "reading", kind: "article", files: [{ name: "article.md", data: Buffer.from("A useful concept").toString("base64") }] })).status, 201);
    assert.equal((await post("/api/dojo/transform", { topicId: webTopic.id, file: "article.md", toolkit: "feynman", targetText: "A useful concept", stage: "blind-produce" })).status, 403);
    assert.equal((await post(`/api/topics/${webTopic.id}/toolkits`, { toolkits: ["feynman"] })).status, 200);
    assert.equal((await post("/api/dojo/transform", { topicId: webTopic.id, file: "article.md", toolkit: "feynman", targetText: "A useful concept", stage: "blind-produce" })).status, 200);
    assert.equal((await post(`/api/topics/${webTopic.id}/toolkits`, { toolkits: ["none"] })).status, 200);
    assert.equal((await post("/api/dojo/transform", { topicId: webTopic.id, file: "article.md", toolkit: "feynman", targetText: "A useful concept", stage: "blind-produce" })).status, 403);
  } finally { controller.dispose(); if (server) await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve())); await rm(dir, { recursive: true, force: true }); }
});
