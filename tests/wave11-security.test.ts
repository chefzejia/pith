import assert from "node:assert/strict";
import dns from "node:dns";
import { EventEmitter } from "node:events";
import https from "node:https";
import test from "node:test";
import { NodeHttpPort } from "../src/shells/web/nodeHttp.ts";
import { effectiveToolkits, topicUsesToolkit } from "../src/workbench/toolkitSlot.ts";
import { createNeuralSpeech, type NeuralSpeechConfig } from "../src/plugins/speech-service/neuralSpeech.ts";
import type { HostPort, HttpRequestSpec } from "../src/core/index.ts";

test("empty toolkits never mount or authorize tools", () => {
  for (const format of ["chapter.epub", "book.pdf", "comic.cbz", "article.md", "caption.vtt", "caption.srt", "movie.mp4", "media"]) assert.deepEqual(effectiveToolkits([], format), []);
  assert.deepEqual(effectiveToolkits(["shadowing"], "chapter.epub"), ["shadowing"]);
  const materials = [{ id: "book", kind: "book", files: [{ name: "chapter.epub" }] }, { id: "audio", kind: "media", files: [{ name: "caption.vtt" }] }];
  assert.equal(topicUsesToolkit({ toolkits: [], materialId: "book" }, materials, "feynman"), false);
  assert.equal(topicUsesToolkit({ toolkits: [], materialId: "audio" }, materials, "shadowing"), false);
});

test("cloud speech pins public DNS, refuses mixed addresses and never follows redirects", async () => {
  const lookup = dns.promises.lookup, request = https.request;
  let dnsCalls = 0, connections = 0, status = 200, pinned = "", hostname = "", auth = "";
  dns.promises.lookup = (async (host: string) => { dnsCalls++; if (host === "mixed.example.com") return [{ address: "8.8.8.8", family: 4 }, { address: "127.0.0.1", family: 4 }]; if (host === "private.example.com") return [{ address: "10.0.0.1", family: 4 }]; if (host === "ipv6.example.com") return [{ address: "fd00::1", family: 6 }]; return [{ address: dnsCalls === 1 ? "8.8.8.8" : "127.0.0.1", family: 4 }]; }) as unknown as typeof dns.promises.lookup;
  https.request = ((url: URL, options: { lookup: (host: string, opts: unknown, cb: (error: null, address: string, family: number) => void) => void; headers: Record<string, string>; servername?: string; rejectUnauthorized?: boolean; agent: unknown }, callback: (response: EventEmitter & { statusCode: number; headers: Record<string, string>; destroy(): void }) => void) => {
    connections++; hostname = url.hostname; auth = options.headers.Authorization || ""; options.lookup(url.hostname, {}, (_error, address) => { pinned = address; });
    assert.equal(options.servername, undefined); assert.equal(options.rejectUnauthorized, undefined); assert.equal(options.agent, false);
    const req = new EventEmitter() as EventEmitter & { setTimeout(): void; write(): void; end(): void; destroy(): void };
    req.setTimeout = () => {}; req.write = () => {}; req.destroy = () => {};
    req.end = () => { const response = new EventEmitter() as EventEmitter & { statusCode: number; headers: Record<string, string>; destroy(): void }; response.statusCode = status; response.headers = { location: "https://attacker.example/" }; response.destroy = () => {}; callback(response); if (status === 200) { response.emit("data", Buffer.from("ok")); response.emit("end"); } };
    return req;
  }) as unknown as typeof https.request;
  try {
    const host = new NodeHttpPort();
    await assert.rejects(host.requestPublicSpeech({ url: "https://mixed.example.com/v1/audio/speech", method: "POST", headers: { Authorization: "Bearer test-only" } }), /non-public/);
    for (const name of ["private", "ipv6"]) await assert.rejects(host.requestPublicSpeech({ url: `https://${name}.example.com/v1/audio/speech`, method: "POST", headers: { Authorization: "Bearer test-only" } }), /non-public/);
    assert.equal(connections, 0);
    dnsCalls = 0;
    assert.equal((await host.requestPublicSpeech({ url: "https://public.example.com/v1/audio/speech", method: "POST", headers: { Authorization: "Bearer test-only" }, body: "{}" })).text(), "ok");
    assert.equal(dnsCalls, 1); assert.equal(pinned, "8.8.8.8"); assert.equal(hostname, "public.example.com"); assert.equal(auth, "Bearer test-only");
    status = 302; dnsCalls = 0;
    await assert.rejects(host.requestPublicSpeech({ url: "https://public.example.com/v1/audio/speech", method: "POST", headers: { Authorization: "Bearer test-only" } }), /302/);
    assert.equal(connections, 2);
    for (const url of ["http://public.example.com/", "https://127.0.0.1/", "https://user@public.example.com/", "https://public.example.com/?key=x", "https://public.example.com/#x"]) await assert.rejects(host.requestPublicSpeech({ url, method: "POST" }));
    assert.equal(connections, 2);
  } finally { dns.promises.lookup = lookup; https.request = request; }
});

test("cloud speech requires pinned transport while local services retain ordinary HTTP", async () => {
  const calls: { kind: string; spec: HttpRequestSpec }[] = [];
  const response = (spec: HttpRequestSpec) => { const value = spec.url.includes("transcriptions") ? '{"text":"ok"}' : "audio"; const bytes = new TextEncoder().encode(value); return { status: 200, headers: { "content-type": spec.url.includes("transcriptions") ? "application/json" : "audio/mpeg" }, bytes, text: () => value }; };
  const host = { id: "web", secrets: { getSecret: () => "test-only" }, http: { request: async (spec: HttpRequestSpec) => { calls.push({ kind: "local", spec }); return response(spec); }, requestPublicSpeech: async (spec: HttpRequestSpec) => { calls.push({ kind: "public", spec }); return response(spec); } } } as unknown as HostPort;
  const config: NeuralSpeechConfig = { ttsProvider: "openai-tts", ttsEndpoint: "https://voice.example.com/v1/audio/speech", ttsVoice: "alloy", azureRegion: "", asrProvider: "openai-whisper", asrLoopbackUrl: "https://voice.example.com/v1/audio/transcriptions", asrModel: "custom-asr", rate: 1 };
  const cloud = createNeuralSpeech(host, config, () => true);
  await cloud.synthesizeSpeech("hello"); await cloud.transcribeAudio(new Uint8Array([1]));
  assert.deepEqual(calls.map(call => call.kind), ["public", "public"]);
  assert.deepEqual(calls.map(call => call.spec.url), [config.ttsEndpoint, config.asrLoopbackUrl]);
  assert.match(new TextDecoder().decode(calls[1]!.spec.body as Uint8Array), /custom-asr/);
  const local = createNeuralSpeech(host, { ...config, ttsProvider: "kokoro-local", ttsEndpoint: "http://127.0.0.1:8880/v1/audio/speech", asrProvider: "whisper-local", asrLoopbackUrl: "http://127.0.0.1:8765/v1/audio/transcriptions" }, () => true);
  await local.synthesizeSpeech("hello"); await local.transcribeAudio(new Uint8Array([1]));
  assert.deepEqual(calls.map(call => call.kind), ["public", "public", "local", "local"]);
  const unsafeHost = { ...host, http: { request: host.http!.request } } as HostPort;
  await assert.rejects(createNeuralSpeech(unsafeHost, config, () => true).synthesizeSpeech("hello"), /Safe public speech transport unavailable/);
  assert.equal(calls.length, 4);
});
