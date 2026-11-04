import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { HttpRequestSpec, SpeechAsrService, SpeechTtsService } from "../src/core/index.ts";
import { PithObsidianController, PithSettingTab } from "../src/shells/obsidian/index.ts";
import { NodeHttpPort } from "../src/shells/web/nodeHttp.ts";
import { NodeWorkspaceStorage } from "../src/shells/web/nodeStorage.ts";
import { createPithWebServer } from "../src/shells/web/server.ts";
import { testSandbox } from "./sandbox.ts";

const close = (server: Server) => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
const response = (value: string, contentType: string) => { const bytes = new TextEncoder().encode(value); return { status: 200, headers: { "content-type": contentType }, bytes, text: () => value }; };

test("web speech settings survive restart and reach local TTS and ASR and cloud ASR", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pith-wave8-web-"));
  const requests: { url: string; body: string }[] = [];
  const engine = createServer(async (req, res) => {
    const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
    requests.push({ url: req.url!, body: Buffer.concat(chunks).toString() });
    if (req.url === "/tts") { res.writeHead(200, { "content-type": "audio/mpeg" }); res.end("audio"); }
    else if (req.url === "/asr/v1/audio/transcriptions") { res.writeHead(200, { "content-type": "application/json" }); res.end('{"text":"recognized"}'); }
    else { res.writeHead(404); res.end(); }
  });
  await new Promise<void>(resolve => engine.listen(0, "127.0.0.1", resolve));
  const engineAddress = engine.address(); assert.ok(engineAddress && typeof engineAddress !== "string");
  const endpoint = `http://127.0.0.1:${engineAddress.port}`;
  const cloudRequests: HttpRequestSpec[] = [];
  const original = NodeHttpPort.prototype.request;
  const originalPublicSpeech = NodeHttpPort.prototype.requestPublicSpeech;
  NodeHttpPort.prototype.requestPublicSpeech = async function (spec) { cloudRequests.push(spec); return response('{"text":"cloud"}', "application/json"); };
  NodeHttpPort.prototype.request = async function (spec) {
    if (spec.url === "https://api.openai.com/v1/audio/transcriptions") { cloudRequests.push(spec); return response('{"text":"cloud"}', "application/json"); }
    return original.call(this, spec);
  };
  let app: Server | undefined;
  let base = "";
  const start = async () => { app = await createPithWebServer({ workspaceDir: dir }); const address = app.address(); assert.ok(address && typeof address !== "string"); base = `http://127.0.0.1:${address.port}`; };
  const post = (path: string, value: unknown) => fetch(base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(value) });
  const speech = { ttsProvider: "openai-compatible-local", ttsEndpoint: `${endpoint}/tts`, ttsModel: "custom-tts", ttsVoice: "custom-voice", asrProvider: "whisper-local", asrLoopbackUrl: `${endpoint}/asr/v1/audio/transcriptions`, asrModel: "custom-asr" };
  try {
    await start();
    const html = await (await fetch(base)).text();
    for (const field of ["ttsModel", "asrModel", "ttsEndpoint", "asrLoopbackUrl"]) assert.ok(html.includes(`data-speech-field="${field}"`), field);
    assert.doesNotMatch(html, /Kokoro-82M|ghcr\.io\/remsky/);
    assert.equal((await post("/api/settings", { speech })).status, 200);
    assert.equal((await post("/api/settings", { speech: { ttsModel: 12 } })).status, 400);
    assert.equal((await post("/api/speech/synthesize", { text: "hello" })).status, 200);
    assert.deepEqual(JSON.parse(requests.at(-1)!.body), { model: "custom-tts", input: "hello", voice: "custom-voice", response_format: "mp3", speed: 1 });
    assert.equal((await post("/api/speech/transcribe", { audio: Buffer.from("recording").toString("base64") })).status, 200);
    assert.equal(requests.at(-1)!.url, "/asr/v1/audio/transcriptions"); assert.match(requests.at(-1)!.body, /name="model"\r\n\r\ncustom-asr\r\n/);
    await close(app!); app = undefined; await start();
    assert.deepEqual((await (await fetch(base + "/api/state")).json()).settings.speech, speech);
    assert.equal((await post("/api/speech/synthesize", { text: "again" })).status, 200);
    assert.equal(JSON.parse(requests.at(-1)!.body).model, "custom-tts"); assert.equal(JSON.parse(requests.at(-1)!.body).voice, "custom-voice");
    assert.equal((await post("/api/speech/transcribe", { audio: Buffer.from("recording").toString("base64") })).status, 200);
    assert.equal(requests.at(-1)!.url, "/asr/v1/audio/transcriptions"); assert.match(requests.at(-1)!.body, /name="model"\r\n\r\ncustom-asr\r\n/);
    assert.equal((await post("/api/settings", { speech: { ...speech, asrProvider: "openai-whisper", asrLoopbackUrl: "https://speech.example.com/v1/audio/transcriptions" }, secrets: { OPENAI_API_KEY: "test-key" } })).status, 200);
    assert.equal((await post("/api/speech/transcribe", { audio: Buffer.from("recording").toString("base64") })).status, 200);
    assert.equal(cloudRequests[0]!.url, "https://speech.example.com/v1/audio/transcriptions");
    assert.equal(cloudRequests[0]!.headers!.Authorization, "Bearer test-key");
    assert.match(new TextDecoder().decode(cloudRequests[0]!.body as Uint8Array), /name="model"\r\n\r\ncustom-asr\r\n/);
    assert.equal((await post("/api/settings", { speech: { ...speech, ttsEndpoint: "http://127.0.0.1:1/tts" } })).status, 200);
    const failure = await post("/api/speech/synthesize", { text: "offline" }); assert.equal(failure.status, 503);
    const error = (await failure.json()).error as string; assert.match(error, /设置/); assert.doesNotMatch(error, /Kokoro|MLX-Audio/);
    const health = await (await fetch(base + "/api/speech/presets")).json(); assert.equal(health.ttsHealth.ok, false); assert.doesNotMatch(health.ttsHealth.note, /Kokoro|MLX-Audio/);
  } finally { if (app) await close(app); await close(engine); NodeHttpPort.prototype.request = original; NodeHttpPort.prototype.requestPublicSpeech = originalPublicSpeech; await rm(dir, { recursive: true, force: true }); }
});

test("Obsidian speech configuration persists and reaches the speech services", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pith-wave8-obsidian-"));
  const storage = new NodeWorkspaceStorage(dir);
  const calls: HttpRequestSpec[] = [];
  const transports: string[] = [];
  const request = async (spec: HttpRequestSpec) => { calls.push(spec); return spec.url.includes("transcriptions") ? response('{"text":"recognized"}', "application/json") : response("audio", "audio/mpeg"); };
  const host = { id: "obsidian" as const, storage, secrets: { getSecret: () => "test-key" }, http: { request: async (spec: HttpRequestSpec) => { transports.push("local"); return request(spec); }, requestPublicSpeech: async (spec: HttpRequestSpec) => { transports.push("public"); return request(spec); } } };
  let controller = new PithObsidianController(host);
  const speech = { ttsProvider: "openai-compatible-local", ttsEndpoint: "http://127.0.0.1:9999/tts", ttsModel: "custom-tts", ttsVoice: "custom-voice", asrProvider: "openai-whisper", asrLoopbackUrl: "https://speech.example.com/v1/audio/transcriptions", asrModel: "custom-asr", azureRegion: "eastus" };
  try {
    await controller.initialize(); await controller.setSpeechConfig(speech); controller.dispose();
    controller = new PithObsidianController(host); await controller.initialize();
    assert.deepEqual(controller.getSpeechConfig(), speech);
    const tts = controller.runtime.getService<SpeechTtsService>("speech.tts")!;
    const asr = controller.runtime.getService<SpeechAsrService>("speech.asr")!;
    assert.equal(asr.model, "custom-asr");
    await tts.synthesizeSpeech!("hello");
    assert.equal(calls[0]!.url, speech.ttsEndpoint); assert.equal(JSON.parse(String(calls[0]!.body)).model, "custom-tts"); assert.equal(JSON.parse(String(calls[0]!.body)).voice, "custom-voice");
    await asr.transcribeAudio!(new TextEncoder().encode("audio"));
    assert.equal(calls[1]!.url, speech.asrLoopbackUrl);
    assert.deepEqual(transports, ["local", "public"]);
    assert.match(new TextDecoder().decode(calls[1]!.body as Uint8Array), /name="model"\r\n\r\ncustom-asr\r\n/);
  } finally { controller.dispose(); await rm(dir, { recursive: true, force: true }); }
});

test("Obsidian settings tab edits and saves all speech fields", async () => {
  class Element {
    children: Element[] = []; parentElement: Element | null = null; textContent = ""; value = ""; disabled = false; hidden = false; onclick: (() => void) | null = null; onchange: (() => void) | null = null;
    ownerDocument = { createElement: (_tag: string) => new Element() };
    append(...children: Element[]) { for (const child of children) child.parentElement = this; this.children.push(...children); }
    replaceChildren() { this.children = []; }
    contains(node: Element): boolean { return this === node || this.children.some(child => child.contains(node)); }
    querySelector(selector: string): Element | null { return selector === 'option[value="unconfigured"]' ? this.children.find(child => child.value === "unconfigured") ?? null : null; }
    setAttribute(_name: string, _value: string) {}
    addEventListener(_type: string, listener: () => void) { this.onchange = listener; }
  }
  const dir = await mkdtemp(join(tmpdir(), "pith-wave8-form-"));
  const controller = new PithObsidianController({ id: "obsidian", storage: new NodeWorkspaceStorage(dir) });
  try {
    await controller.initialize();
    const plugin = { getWorkspacePath: () => "Pith", setWorkspacePath: async () => false };
    const tab = new PithSettingTab({} as never, plugin as never, controller);
    const root = new Element(); tab.containerEl = root as unknown as HTMLElement; tab.display();
    const all = (element: Element): Element[] => [element, ...element.children.flatMap(all)];
    const row = (label: string) => { const found = all(root).find(element => element.textContent === label); assert.ok(found && found.children[0], label); return found.children[0]; };
    const fields = { "TTS 端点 URL": "http://localhost:9999/tts", "TTS 模型": "model-t", "音色": "voice-t", "ASR 端点 URL": "http://localhost:9998", "ASR 模型": "model-a" };
    for (const [label, value] of Object.entries(fields)) { const field = row(label); field.value = value; field.onchange!(); }
    const status = root.children.at(-1)!;
    for (let i = 0; i < 1000 && controller.getSpeechConfig().asrModel !== "model-a"; i++) await new Promise<void>(resolve => setImmediate(resolve));
    assert.deepEqual(controller.getSpeechConfig(), { ttsEndpoint: "http://localhost:9999/tts", ttsModel: "model-t", ttsVoice: "voice-t", asrLoopbackUrl: "http://localhost:9998", asrModel: "model-a" });
    const path = row("Pith 数据目录（相对于 Vault）"); path.value = "../invalid"; status.textContent = ""; path.onchange!();
    for (let i = 0; i < 1000 && !status.textContent; i++) await new Promise<void>(resolve => setImmediate(resolve));
    assert.match(status.textContent, /Invalid workspace root/);
  } finally { controller.dispose(); await rm(dir, { recursive: true, force: true }); }
});

test("Obsidian ignores a stale scan after settings are rebuilt and persists explicit offline", async () => {
  class Element {
    children: Element[] = []; parentElement: Element | null = null; textContent = ""; value = ""; disabled = false; hidden = false; onclick: (() => void) | null = null; onchange: (() => void) | null = null;
    ownerDocument = { createElement: (_tag: string) => new Element() };
    append(...children: Element[]) { for (const child of children) child.parentElement = this; this.children.push(...children); }
    replaceChildren() { this.children = []; }
    contains(node: Element): boolean { return this === node || this.children.some(child => child.contains(node)); }
    querySelector(selector: string): Element | null { return selector === 'option[value="unconfigured"]' ? this.children.find(child => child.value === "unconfigured") ?? null : null; }
    setAttribute() {}
    addEventListener(type: string, listener: () => void) { if (type === "change") this.onchange = listener; }
  }
  const dir = await mkdtemp(join(tmpdir(), "pith-wave13-obsidian-agent-"));
  const host = { id: "obsidian" as const, storage: new NodeWorkspaceStorage(dir) };
  let controller = new PithObsidianController(host);
  try {
    await controller.initialize();
    let resolveScan!: (value: Awaited<ReturnType<typeof controller.detectAgents>>) => void;
    let calls = 0;
    controller.detectAgents = () => ++calls === 1 ? new Promise(resolve => { resolveScan = resolve; }) : Promise.resolve([]);
    const tab = new PithSettingTab({} as never, { getWorkspacePath: () => "Pith", setWorkspacePath: async () => false } as never, controller);
    const root = new Element(); tab.containerEl = root as never; tab.display();
    const firstScan = root.children.find(node => node.textContent === "本机 Agent")!.children[1]!;
    tab.display();
    resolveScan([{ id: "dsh", available: true } as Awaited<ReturnType<typeof controller.detectAgents>>[number]]);
    for (let i = 0; i < 100 && firstScan.disabled; i++) await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(firstScan.disabled, false);
    assert.equal(controller.isAgentConfigured(), false);
    const agent = root.children.find(node => node.textContent === "本机 Agent")!.children[0]!;
    agent.value = ""; agent.onchange!();
    for (let i = 0; i < 100 && !controller.isAgentConfigured(); i++) await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(controller.isAgentConfigured(), true);
    for (let i = 0; i < 100 && !await host.storage.exists("_cache/web-settings.json"); i++) await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(JSON.parse(await host.storage.readText("_cache/web-settings.json")).agentConfigured, true);
    controller.dispose(); controller = new PithObsidianController(host); await controller.initialize();
    assert.equal(controller.isAgentConfigured(), true);
    assert.equal(controller.getAgentConfig().agentId, "");
  } finally { controller.dispose(); await rm(dir, { recursive: true, force: true }); }
});

test("Obsidian settings serialize offline intent across rebuilt panels and delayed saves", async () => {
  class Element {
    children: Element[] = []; parentElement: Element | null = null; textContent = ""; value = ""; disabled = false; hidden = false; onclick: (() => void) | null = null; onchange: (() => void) | null = null;
    ownerDocument = { createElement: (_tag: string) => new Element() };
    append(...children: Element[]) { for (const child of children) child.parentElement = this; this.children.push(...children); }
    replaceChildren() { this.children = []; }
    contains(node: Element): boolean { return this === node || this.children.some(child => child.contains(node)); }
    querySelector(selector: string): Element | null { return selector === 'option[value="unconfigured"]' ? this.children.find(child => child.value === "unconfigured") ?? null : null; }
    setAttribute() {}
    addEventListener(type: string, listener: () => void) { if (type === "change") this.onchange = listener; }
  }
  const dir = await testSandbox("pith-agent-queue-");
  const host = { id: "obsidian" as const, storage: new NodeWorkspaceStorage(dir) };
  let controller = new PithObsidianController(host);
  try {
    await controller.initialize();
    let release!: () => void, entered!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { entered = resolve; });
    const setPersona = controller.setPersona.bind(controller);
    controller.setPersona = async value => { entered(); await gate; await setPersona(value); };
    let offlineDone!: () => void, releaseDsh!: () => void, dshDone!: () => void, dshCalls = 0;
    const offlineSaved = new Promise<void>(resolve => { offlineDone = resolve; });
    const dshGate = new Promise<void>(resolve => { releaseDsh = resolve; });
    const dshSaved = new Promise<void>(resolve => { dshDone = resolve; });
    const setAgentConfig = controller.setAgentConfig.bind(controller);
    controller.setAgentConfig = async config => { if (config.agentId === "dsh") { dshCalls++; await dshGate; } await setAgentConfig(config); if (config.agentId === "") offlineDone(); else if (config.agentId === "dsh") dshDone(); };
    let scans = 0;
    controller.detectAgents = async () => ++scans === 1 ? [] : [{ id: "dsh", available: true } as Awaited<ReturnType<typeof controller.detectAgents>>[number]];
    const tab = new PithSettingTab({} as never, { getWorkspacePath: () => "Pith", setWorkspacePath: async () => false } as never, controller);
    const root = new Element(); tab.containerEl = root as never; tab.display();
    const field = (label: string) => root.children.find(node => node.textContent === label)!.children[0]!;
    field("术语风格").value = "studio"; field("术语风格").onchange!(); await started;
    field("本机 Agent").value = ""; field("本机 Agent").onchange!();
    tab.display();
    const scan = root.children.find(node => node.textContent === "本机 Agent")!.children[1]!;
    for (let i = 0; i < 100 && scan.disabled; i++) await new Promise<void>(resolve => setImmediate(resolve));
    const displayed = field("本机 Agent").value;
    release(); await offlineSaved; releaseDsh(); if (dshCalls) await dshSaved;
    assert.equal(scan.disabled, false); assert.equal(displayed, "");
    assert.equal(dshCalls, 0); assert.equal(controller.getAgentConfig().agentId, "");
    controller.dispose(); controller = new PithObsidianController(host); await controller.initialize();
    assert.equal(controller.isAgentConfigured(), true); assert.equal(controller.getAgentConfig().agentId, "");
  } finally { controller.dispose(); await rm(dir, { recursive: true, force: true }); }
});
