import assert from "node:assert/strict";
import dns from "node:dns";
import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import https from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createNeuralSpeech } from "../src/plugins/speech-service/neuralSpeech.ts";
import { isLoopbackSafe } from "../src/plugins/speech-service/index.ts";
import { PithObsidianController } from "../src/shells/obsidian/index.ts";
import { createObsidianSecretAccess } from "../src/shells/obsidian/index.ts";
import { migrateLegacySpeech } from "../src/shells/speechSettings.ts";
import { NodeHttpPort } from "../src/shells/web/nodeHttp.ts";
import { NodeWorkspaceStorage } from "../src/shells/web/nodeStorage.ts";
import { createPithWebServer } from "../src/shells/web/server.ts";
import type { HttpRequestSpec, SpeechAsrService } from "../src/core/index.ts";

const result = (spec: HttpRequestSpec) => { const text = spec.url.includes("transcriptions") ? '{"text":"ok"}' : "audio"; const bytes = new TextEncoder().encode(text); return { status: 200, headers: { "content-type": spec.url.includes("transcriptions") ? "application/json" : "audio/mpeg" }, bytes, text: () => text }; };

test("all valid legacy loopback endpoints migrate, while versioned and invalid values remain unchanged", () => {
  for (const endpoint of ["http://127.12.34.56:4321/custom", "https://localhost:2345/v1/audio/transcriptions", "http://[::1]:9876/asr"]) {
    const speech = { asrProvider: "openai-whisper", asrLoopbackUrl: endpoint };
    assert.equal(migrateLegacySpeech(speech, undefined, undefined).asrLoopbackUrl, "");
    assert.equal(migrateLegacySpeech(speech, 1, undefined).asrLoopbackUrl, endpoint);
    assert.equal(migrateLegacySpeech(speech, undefined, {}).asrLoopbackUrl, endpoint);
  }
  for (const endpoint of ["http://192.168.1.2/", "http://user@localhost/", "http://localhost/?", "https://speech.example.com/v1/audio/transcriptions"]) assert.equal(migrateLegacySpeech({ asrProvider: "openai-whisper", asrLoopbackUrl: endpoint }, undefined, undefined).asrLoopbackUrl, endpoint);
});

test("unavailable secret storage uses session memory and environment fallback without touching the vault", async () => {
  let accesses = 0;
  const secrets = createObsidianSecretAccess(() => { accesses++; throw new Error("unavailable"); });
  assert.equal(accesses, 0);
  const key = "PITH_TEST_MISSING_SECRET"; process.env[key] = "environment-test-value";
  try {
    assert.equal(await secrets.getSecret(key), "environment-test-value");
    assert.equal(secrets.setSecret("OPENAI_API_KEY", "session-test-value"), "session");
    assert.equal(await secrets.getSecret("OPENAI_API_KEY"), "session-test-value");
    assert.equal(createObsidianSecretAccess(() => undefined).getSecret(key), "environment-test-value");
  } finally { delete process.env[key]; }
});

test("local speech never consults secret storage and throwing storage falls back to the environment", async () => {
  let accesses = 0;
  const access = createObsidianSecretAccess(() => { accesses++; return { getSecret: () => { throw new Error("locked"); }, setSecret: () => { throw new Error("locked"); }, isEncryptionAvailable: () => true }; });
  const host = { id: "obsidian" as const, secrets: access, http: { request: async (spec: HttpRequestSpec) => result(spec) } } as never;
  const config = { ttsProvider: "kokoro-local" as const, ttsEndpoint: "", ttsVoice: "", azureRegion: "", asrProvider: "whisper-local" as const, asrLoopbackUrl: "http://localhost:8765", rate: 1 };
  await createNeuralSpeech(host, config, isLoopbackSafe).synthesizeSpeech("test");
  assert.equal(accesses, 0);
  assert.equal(access.setSecret("OPENAI_API_KEY", "session-value"), "session");
  assert.equal(access.getSecret("OPENAI_API_KEY"), "session-value");
  const fresh = createObsidianSecretAccess(() => { throw new Error("locked"); });
  const originalEnv = process.env;
  try { process.env = { OPENAI_API_KEY: "env-value" }; assert.equal(fresh.getSecret("OPENAI_API_KEY"), "env-value"); } finally { process.env = originalEnv; }
});

test("legacy cloud ASR upgrades without treating a newly saved invalid endpoint as legacy", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pith-legacy-cloud-")); await mkdir(join(dir, "web")); await mkdir(join(dir, "obsidian"));
  const speech = { asrProvider: "openai-whisper", asrLoopbackUrl: "http://127.3.4.5:12345/custom" };
  const seed = JSON.stringify({ preset: "all", persona: "sanctuary", plugins: {}, speech });
  for (const name of ["web", "obsidian"]) { await mkdir(join(dir, name, "_cache")); await writeFile(join(dir, name, "_cache/web-settings.json"), seed); }
  const calls: HttpRequestSpec[] = []; const original = NodeHttpPort.prototype.requestPublicSpeech;
  NodeHttpPort.prototype.requestPublicSpeech = async function (spec) { calls.push(spec); return result(spec); };
  let server: Awaited<ReturnType<typeof createPithWebServer>> | undefined;
  const host = { id: "obsidian" as const, storage: new NodeWorkspaceStorage(join(dir, "obsidian")), secrets: { getSecret: () => "test-only" }, http: new NodeHttpPort() };
  let controller = new PithObsidianController(host);
  try {
    await controller.initialize(); await controller.runtime.getService<SpeechAsrService>("speech.asr")!.transcribeAudio!(new Uint8Array([1]));
    assert.equal(calls.at(-1)!.url, "https://api.openai.com/v1/audio/transcriptions");
    await controller.setSpeechConfig(speech); controller.dispose(); controller = new PithObsidianController(host); await controller.initialize();
    await assert.rejects(controller.runtime.getService<SpeechAsrService>("speech.asr")!.transcribeAudio!(new Uint8Array([1])), /Unsafe cloud endpoint/);
    server = await createPithWebServer({ workspaceDir: join(dir, "web") }); const address = server.address(); assert.ok(address && typeof address !== "string"); let base = `http://127.0.0.1:${address.port}`;
    const post = (path: string, value: unknown) => fetch(base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(value) });
    await post("/api/settings", { secrets: { OPENAI_API_KEY: "test-only" } });
    assert.equal((await post("/api/speech/transcribe", { audio: "YQ==" })).status, 200); assert.equal(calls.at(-1)!.url, "https://api.openai.com/v1/audio/transcriptions");
    await post("/api/settings", { speech }); assert.equal((await post("/api/speech/transcribe", { audio: "YQ==" })).status, 503);
    await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve())); server = await createPithWebServer({ workspaceDir: join(dir, "web") });
    const restarted = server.address(); assert.ok(restarted && typeof restarted !== "string"); base = `http://127.0.0.1:${restarted.port}`;
    await post("/api/settings", { secrets: { OPENAI_API_KEY: "test-only" } }); assert.equal((await post("/api/speech/transcribe", { audio: "YQ==" })).status, 503);
  } finally { controller.dispose(); if (server) await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve())); NodeHttpPort.prototype.requestPublicSpeech = original; await rm(dir, { recursive: true, force: true }); }
});

test("strict raw URLs and public IPv6 preserve pinned TLS transport", async () => {
  const lookup = dns.promises.lookup, request = https.request; let calls = 0, selected = "";
  dns.promises.lookup = (async () => [{ address: "2606:4700:4700::1111", family: 6 }]) as unknown as typeof dns.promises.lookup;
  https.request = ((url: URL, options: { lookup(host: string, options: unknown, cb: (error: null, address: string, family: number) => void): void }, callback: (res: EventEmitter & { statusCode: number; headers: object }) => void) => {
    calls++; options.lookup(url.hostname, {}, (_error, address) => { selected = address; });
    const req = new EventEmitter() as EventEmitter & { setTimeout(): void; write(): void; end(): void }; req.setTimeout = () => {}; req.write = () => {}; req.end = () => { const res = new EventEmitter() as EventEmitter & { statusCode: number; headers: object }; res.statusCode = 200; res.headers = {}; callback(res); res.emit("data", Buffer.from("ok")); res.emit("end"); }; return req;
  }) as unknown as typeof https.request;
  try {
    const port = new NodeHttpPort();
    for (const url of ["https://public.example.com/?", "https://public.example.com/#", "https://@public.example.com/"]) await assert.rejects(port.requestPublicSpeech({ url, method: "POST" }));
    assert.equal(calls, 0);
    await port.requestPublicSpeech({ url: "https://[2606:4700:4700::1111]/v1/audio/speech", method: "POST" });
    assert.equal(selected, "2606:4700:4700::1111");
    await port.requestPublicSpeech({ url: "https://public.example.com/v1/audio/speech", method: "POST" }); assert.equal(selected, "2606:4700:4700::1111");
    for (const address of ["::1", "fc00::1", "fe80::1", "2001:db8::1", "::ffff:127.0.0.1"]) await assert.rejects(port.requestPublicSpeech({ url: `https://[${address}]/`, method: "POST" }));
    const config = { ttsProvider: "openai-tts" as const, ttsEndpoint: "https://[2606:4700:4700::1111]/v1/audio/speech", ttsVoice: "alloy", azureRegion: "", asrProvider: "openai-whisper" as const, asrLoopbackUrl: "", rate: 1 };
    const host = { id: "web" as const, secrets: { getSecret: () => "test-only" }, http: port } as never;
    await createNeuralSpeech(host, config, isLoopbackSafe).synthesizeSpeech("test");
    for (const suffix of ["?", "#"]) {
      await assert.rejects(createNeuralSpeech(host, { ...config, ttsEndpoint: `https://public.example.com/${suffix}` }, isLoopbackSafe).synthesizeSpeech("test"), /Unsafe cloud endpoint/);
      await assert.rejects(createNeuralSpeech(host, { ...config, asrLoopbackUrl: `https://public.example.com/${suffix}` }, isLoopbackSafe).transcribeAudio(new Uint8Array([1])), /Unsafe cloud endpoint/);
    }
    await assert.rejects(createNeuralSpeech(host, { ...config, ttsEndpoint: "https://@public.example.com/" }, isLoopbackSafe).synthesizeSpeech("test"), /Unsafe cloud endpoint/);
    dns.promises.lookup = (async () => [{ address: "2606:4700:4700::1111", family: 6 }, { address: "fd00::1", family: 6 }]) as unknown as typeof dns.promises.lookup;
    await assert.rejects(port.requestPublicSpeech({ url: "https://public.example.com/", method: "POST" }), /non-public/);
  } finally { dns.promises.lookup = lookup; https.request = request; }
});
