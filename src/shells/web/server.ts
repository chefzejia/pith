import { materialReadings, rememberMaterialReading } from "../../workbench/readingState.ts";
import { GUIDE_UNAVAILABLE_REASON } from "../../workbench/guideAvailability.ts";
import { readLessonVersions, readSessionRepositoryFiles, useRepositoryVersion } from "../../workbench/lessonVersions.ts";
import { trainingToolkits } from "./toolkits.ts";
import { createFeynmanContrast } from "../../plugins/toolkit-feynman/index.ts";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { DefaultAttentionEngine, DefaultWorkspaceStore, MutationQueue, type ToolkitStage, type ToolkitDescriptor, type GuideAgentService, type GuideProvider, type InterlineDisplayMode, type InterlineService, type InterlineTranslator, type PluginsConfigFile, type SelectionAnchor, type SpeechTtsService, type SpeechAsrService, type StageTimelineService, type StageReaderService } from "../../core/index.ts";
import { LocalAcpGuideProvider, buildScenePrompt, normalizeToolkits } from "../../plugins/guide-acp/index.ts";
import { recoverInterruptedToolSteps } from "../../plugins/guide-acp/turnRecovery.ts";
import { bootStandaloneShell, type WorkspaceSnapshot } from "./index.ts";
import { NodeAgentProcessPort } from "./nodeProcess.ts";
import { NodeToolServerPort } from "./nodeToolServer.ts";
import { NodeRepositoryPort } from "./nodeRepository.ts";
import { NodeWorkspaceStorage } from "./nodeStorage.ts";
import { NodeHttpPort } from "./nodeHttp.ts";
import { NodeMediaCorpusPort } from "./nodeMediaCorpus.ts";
import * as readerFont from "../../plugins/stage-reader/lxgwWenKaiData.ts";
import { audioContentType, videoContentType, isMediaFile, isSourceTextFile, resolveMediaPair } from "../../workbench/mediaAssets.ts";
import { initialMaterialAids } from "../../workbench/toolkitSlot.ts";
import { boardMaterials, materialCoverSource, coverCachePath } from "../../workbench/boardMaterials.ts";
import { topicObservations, undoTopicObservation } from "../../workbench/observations.ts";
import { checkRepositoryUpdate, resolveRepositoryIntake } from "../../workbench/repositoryIntake.ts";
import { migrateLegacySpeech, switchSpeechMode, validSpeechProfiles, type SpeechMode, type SpeechProfiles } from "../speech/speechSettings.ts";
import { agentInterlineTranslator, InterlineSession, type InterlineUnitInput } from "../../plugins/toolkit-interline/index.ts";
import { ingestExternalUrl } from "../../plugins/guide-acp/externalIngest.ts";
import { fixedPageFormat } from "../../plugins/stage-reader/fixedPage.ts";
import { sampleMaterialText } from "../../workbench/importMaterial.ts";
import { NodeManagedSpeechRuntime } from "../speech/speechRuntime.ts";
import type { AgentProcessPort, AgentPromptService, HttpPort, ManagedSpeechRuntimePort } from "../../core/index.ts";

interface WebSettings { preset: "essentials" | "all"; persona: "sanctuary" | "studio"; plugins: Record<string, { enabled: boolean }>; agentId: "" | "dsh" | "claude" | "codex"; agentConfigured?: boolean; model: string; effort: string; speech?: Record<string, string>; speechProfiles?: SpeechProfiles; speechSettingsVersion?: 1; agentTimeoutMs?: unknown }
export interface PithWebServerOptions { workspaceDir: string; port?: number; guideProvider?: GuideProvider; promptService?: AgentPromptService; interlineTranslator?: InterlineTranslator; speechRuntime?: ManagedSpeechRuntimePort; http?: HttpPort; processPort?: AgentProcessPort }

async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  let raw = "";
  for await (const chunk of req) {
    raw += String(chunk);
    if (raw.length > 90_000_000) throw new Error("Request too large");
  }
  const parsed: unknown = JSON.parse(raw || "{}");
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Expected an object");
  return parsed as Record<string, unknown>;
}
function str(data: Record<string, unknown>, key: string): string {
  const value = data[key];
  if (typeof value !== "string" || !value.trim()) throw new Error(`Invalid ${key}`);
  return value;
}
function anchor(value: unknown): SelectionAnchor | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid anchor");
  const a = value as Record<string, unknown>;
  if (!a.source || typeof a.source !== "object" || Array.isArray(a.source)) throw new Error("Invalid anchor source");
  const source = a.source as Record<string, unknown>;
  if (source.kind !== "lesson" && source.kind !== "material") throw new Error("Invalid anchor source");
  const quote = a.quote;
  if (quote !== undefined && typeof quote !== "string") throw new Error("Invalid quote");
  return { source: source.kind === "lesson" ? { kind: "lesson" } : { kind: "material", materialId: str(source, "materialId") }, file: str(a, "file"), locator: str(a, "locator"), ...(typeof quote === "string" ? { quote } : {}) };
}
function send(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" });
  res.end(JSON.stringify(value));
}
function speechErrorMessage(error: unknown, service: SpeechTtsService | SpeechAsrService | undefined): string {
  let message = error instanceof Error ? error.message : String(error);
  if (service && service.listPresets) for (const preset of service.listPresets()) message = message.replaceAll(preset.installHint, "请检查语音服务配置");
  return message;
}

export async function createPithWebServer(options: PithWebServerOptions): Promise<Server> {
  const bundle = await build({ entryPoints: [fileURLToPath(new URL("./client.ts", import.meta.url))], bundle: true, platform: "browser", format: "iife", target: "es2022", write: false });
  const client = bundle.outputFiles[0]?.contents;
  if (!client) throw new Error("Web client build produced no output");
  const storage = new NodeWorkspaceStorage(options.workspaceDir);
  const store = new DefaultWorkspaceStore(storage);
  await store.ensureScaffold();
  let localProvider: GuideProvider | undefined;
  const engine = new DefaultAttentionEngine(store, storage, () => options.guideProvider ?? (settings.agentId ? localProvider : undefined));
  const snapshot: WorkspaceSnapshot = { topics: [], materials: [], known: false };
  let settings: WebSettings = { preset: "all", persona: "sanctuary", plugins: {}, agentId: "", agentConfigured: false, model: "", effort: "" };
  async function loadSettings(): Promise<void> {
    if (!await storage.exists("_cache/web-settings.json")) return;
    const saved: unknown = JSON.parse(await storage.readText("_cache/web-settings.json"));
    if (!saved || typeof saved !== "object" || Array.isArray(saved)) throw new Error("Invalid web settings");
    const value = saved as Partial<WebSettings>;
    if (value.agentConfigured !== undefined && typeof value.agentConfigured !== "boolean") throw new Error("Invalid agent configuration state");
    if ((value.preset !== "all" && value.preset !== "essentials") || (value.persona !== "sanctuary" && value.persona !== "studio") || !value.plugins || typeof value.plugins !== "object" || Array.isArray(value.plugins) || (value.agentId !== undefined && !["", "dsh", "claude", "codex"].includes(value.agentId)) || (value.model !== undefined && typeof value.model !== "string") || (value.effort !== undefined && typeof value.effort !== "string")) throw new Error("Invalid web settings");
    if (value.speechProfiles !== undefined && !validSpeechProfiles(value.speechProfiles)) throw new Error("Invalid speech profiles");
    if (value.speechSettingsVersion !== undefined && value.speechSettingsVersion !== 1) throw new Error("Invalid speech settings version");
    settings = { ...value, ...(value.speech ? { speech: migrateLegacySpeech(value.speech, value.speechSettingsVersion, value.speechProfiles) } : {}), preset: value.preset, persona: value.persona, plugins: value.plugins, agentId: value.agentId ?? "", agentConfigured: value.agentConfigured ?? value.agentId !== undefined, model: value.model ?? "", effort: value.effort ?? "" };
  }
  await loadSettings();
  const config = (): PluginsConfigFile => ({ preset: settings.preset, plugins: { ...settings.plugins, "speech-service": { ...settings.plugins["speech-service"], config: settings.speech ?? {} }, "guide-acp": { ...settings.plugins["guide-acp"], config: { agentId: settings.agentId, model: settings.model, effort: settings.effort, persona: settings.persona, ...(settings.agentTimeoutMs === undefined ? {} : { timeoutMs: settings.agentTimeoutMs }) } } } });
  const processPort = options.processPort ?? new NodeAgentProcessPort({ workspaceRoot: options.workspaceDir });
  const repository = new NodeRepositoryPort();
  const http = options.http ?? new NodeHttpPort();
  const mediaCorpus = new NodeMediaCorpusPort({ transcribeAudio: async (bytes, mimeType, signal) => { const asr = runtime.getService<SpeechAsrService>("speech.asr"); if (!asr?.transcribeAudio) throw new Error("语音识别服务不可用"); return asr.transcribeAudio(bytes, mimeType, signal); } });
  const speechRuntime = options.speechRuntime ?? new NodeManagedSpeechRuntime({ protectedRoot: options.workspaceDir });
  const secrets: Record<string, string> = {};
  const toolServer = new NodeToolServerPort();
  const runtime = bootStandaloneShell({ id: "web", storage, process: processPort, toolServer, repository, speechRuntime, http, mediaCorpus, secrets: { getSecret: key => secrets[key] || process.env[key] || null } }, config(), { store, engine, snapshot, provider: options.guideProvider });
  const recall = createFeynmanContrast(storage, { prompt: (text, options_) => {
    const service = options.promptService ?? runtime.getService<AgentPromptService>("guide.prompt");
    if (!service) throw new Error("向导 Agent 不可用");
    return service.prompt(text, options_);
  } });
  const agentTimeoutMs = (): number => { const guide = runtime.getService<GuideAgentService>("guide.agent"); if (!guide) throw new Error("Guide service unavailable"); return guide.timeoutMs; };
  localProvider = new LocalAcpGuideProvider({ processPort, toolServer, store, engine, storage, http, repository, mediaCorpus, getReader: () => runtime.getService<StageReaderService>("stage.reader"), getToolkits: () => trainingToolkits, getAgentConfig: () => ({ agentId: settings.agentId, model: settings.model, effort: settings.effort, timeoutMs: agentTimeoutMs() }), resolveDescriptor: async id => {
    const guide = runtime.getService<GuideAgentService>("guide.agent");
    if (!guide || !guide.detectAgents) throw new Error("Guide service unavailable");
    return (await guide.detectAgents()).find(item => item.id === id) ?? null;
  }, buildScenePrompt });
  const interlineSessions = new Map<string, { signature: string; session: InterlineSession }>();
  const guideTurns = new Map<string, AbortController>();
  const guideAvailable = (): boolean => Boolean(options.guideProvider || settings.agentId) && runtime.statuses().some(plugin => plugin.id === "guide-acp" && plugin.state === "active");
  const interlineTranslator = options.interlineTranslator ?? agentInterlineTranslator({ prompt: async (text, options) => { const service = runtime.getService<AgentPromptService>("guide.prompt"); if (!service) throw new Error("向导 Agent 不可用"); return service.prompt(text, options); } });
  const processEffects = (): void => {
    if (options.guideProvider || settings.agentId) void engine.processDueEffects().catch(error => console.error("Effect processing failed:", error));
  };
  async function refresh(): Promise<void> {
    snapshot.known = false;
    try {
      await loadSettings();
      const [topics, materials] = await Promise.all([store.listTopics(), store.listMaterials()]);
      snapshot.topics = topics; snapshot.materials = materials; snapshot.known = true;
    } finally {
      runtime.reconcile(config());
    }
  }
  await refresh();
  processEffects();
  const server = createServer(async (req, res) => {
    try {
      const host = req.headers.host;
      if (!host || !/^(?:localhost|127\.0\.0\.1)(?::\d+)?$/.test(host)) return send(res, 403, { error: "Invalid host" });
      if (req.headers.origin && req.headers.origin !== `http://${host}`) return send(res, 403, { error: "Invalid origin" });
      const url = new URL(req.url ?? "/", `http://${host}`);
      const method = req.method ?? "GET";
      if (method === "POST" && req.headers["content-type"] !== "application/json") return send(res, 415, { error: "JSON required" });
      if (method === "GET" && url.pathname === "/") {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8", "content-security-policy": "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; font-src 'self' data:; img-src 'self' data:; media-src 'self' blob:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'", "x-content-type-options": "nosniff" });
        res.end(APP); return;
      }
      if (method === "GET" && url.pathname === "/app.js") {
        res.writeHead(200, { "content-type": "text/javascript; charset=utf-8", "x-content-type-options": "nosniff" });
        res.end(client); return;
      }
      if (method === "GET" && url.pathname === "/fonts/lxgw-wenkai.woff2") {
        res.writeHead(200, { "content-type": "font/woff2", "cache-control": "public, max-age=31536000, immutable", "x-content-type-options": "nosniff" });
        res.end(Buffer.from(readerFont[("LXGW_WENKAI_" + "WOFF2") as keyof typeof readerFont], "base64")); return;
      }
      if (method === "GET" && url.pathname === "/api/state") {
        await refresh(); const toolkits = trainingToolkits; return send(res, 200, { compass: await engine.compass(), materials: snapshot.materials, boardMaterials: await boardMaterials(storage, snapshot.materials), settings, guideConfigured: Boolean(options.guideProvider || settings.agentId), plugins: runtime.statuses(), toolkits: toolkits.map(item => item.id) });
      }
      if (method === "GET" && url.pathname === "/api/agents") {
        const guide = runtime.getService<GuideAgentService>("guide.agent");
        if (!guide || !guide.detectAgents) return send(res, 503, { error: "Guide service unavailable" });
        return send(res, 200, await guide.detectAgents(url.searchParams.get("force") === "true"));
      }
      if (method === "GET" && url.pathname === "/api/agents/options") {
        const guide = runtime.getService<GuideAgentService>("guide.agent"), id = url.searchParams.get("id");
        if (!guide || !guide.probeAgentOptions) return send(res, 503, { error: "Guide service unavailable" });
        if (!id || !["dsh", "claude", "codex"].includes(id)) return send(res, 400, { error: "Invalid agent" });
        return send(res, 200, await guide.probeAgentOptions(id, url.searchParams.get("force") === "true"));
      }
      if (url.pathname === "/api/speech/runtime" && method === "GET") return send(res, 200, await speechRuntime.getState());
      if (url.pathname === "/api/speech/voices" && method === "GET") {
        if (!("getVoices" in speechRuntime) || typeof speechRuntime.getVoices !== "function") return send(res, 501, { error: "本宿主不支持音色读取" });
        return send(res, 200, await speechRuntime.getVoices());
      }
      if (url.pathname === "/api/speech/runtime" && method === "POST") {
        const data = await body(req), action = str(data, "action");
        if (action !== "install" && action !== "ensureRunning" && action !== "stop" && action !== "remove") return send(res, 400, { error: "Invalid runtime action" });
        const operation = speechRuntime[action]; if (!operation) throw new Error("本宿主不支持该操作");
        return send(res, 200, await operation.call(speechRuntime));
      }
      if (method === "POST" && url.pathname === "/api/intake") {
        const data = await body(req);
        if (!Array.isArray(data.materialIds) || !data.materialIds.every(id => typeof id === "string")) throw new Error("Invalid materialIds");
        if (data.previous !== undefined && !Array.isArray(data.previous)) throw new Error("Invalid previous turns");
        if (guideTurns.has("intake")) return send(res, 409, { error: "Intake already running" });
        const controller = new AbortController(); guideTurns.set("intake", controller);
        const streaming = req.headers.accept === "text/event-stream";
        if (streaming) res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store" });
        res.once("close", () => { if (!res.writableEnded) controller.abort(); });
        try {
          const result = await engine.intake({ text: str(data, "text"), materialIds: data.materialIds as string[], ...(data.previous ? { previous: data.previous as import("../../core/index.ts").GuideTurn[] } : {}) }, { signal: controller.signal, onUpdate: turn => { if (streaming && !res.destroyed) res.write(`event: turn\ndata: ${JSON.stringify(turn)}\n\n`); } });
          await refresh();
          if (streaming) { res.end(`event: result\ndata: ${JSON.stringify(result)}\n\n`); return; }
          return send(res, 201, result);
        } catch (error) { if (streaming) { res.end(`event: error\ndata: ${JSON.stringify(error instanceof Error ? error.message : String(error))}\n\n`); return; } throw error; }
        finally { guideTurns.delete("intake"); }
      }
      if (method === "POST" && url.pathname === "/api/intake/stop") { guideTurns.get("intake")?.abort(); return send(res, 200, { stopped: true }); }
      const statusPath = /^\/api\/topics\/([^/]+)\/status$/.exec(url.pathname);
      if (method === "POST" && statusPath) {
        const data = await body(req);
        if (data.status !== "exploring" && data.status !== "shelved") throw new Error("Invalid status");
        const id = decodeURIComponent(statusPath[1]!);
        const topic = data.status === "shelved" ? await store.updateTopic(id, { status: "shelved" }) : await store.updateTopic(id, { status: "exploring" });
        await refresh(); return send(res, 200, topic);
      }
      const toolkitPath = /^\/api\/topics\/([^/]+)\/toolkits$/.exec(url.pathname);
      if (method === "POST" && toolkitPath) {
        const data = await body(req);
        if (!Array.isArray(data.toolkits) || !data.toolkits.every(item => typeof item === "string" && /^[a-z][a-z0-9-]*$/.test(item)) || new Set(data.toolkits).size !== data.toolkits.length) throw new Error("Invalid toolkits");
        const topicId = decodeURIComponent(toolkitPath[1]!); const topic = await store.updateTopic(topicId, { toolkits: normalizeToolkits(data.toolkits, trainingToolkits) });
        await refresh(); return send(res, 200, topic);
      }
      const actionsPath = /^\/api\/topics\/([^/]+)\/actions$/.exec(url.pathname);
      if (method === "GET" && actionsPath) {
        await refresh();
        const topic = await store.getTopic(decodeURIComponent(actionsPath[1]!));
        if (!topic) return send(res, 404, { error: "Topic not found" });
        if (!guideAvailable()) return send(res, 200, []);
        const guide = runtime.getService<GuideAgentService>("guide.agent");
        if (!guide || !guide.quickActionsForTopic) return send(res, 503, { error: "Guide service unavailable" });
        const toolkits = trainingToolkits;
        return send(res, 200, guide.quickActionsForTopic(topic, toolkits));
      }
      const coverPath = /^\/api\/materials\/([^/]+)\/cover$/.exec(url.pathname);
      if (coverPath) {
        const material = await store.getMaterial(decodeURIComponent(coverPath[1]!)); if (!material) throw new Error("材料不存在");
        if (method === "GET") return send(res, 200, { source: await materialCoverSource(storage, material) });
        if (method === "POST") { const data = await body(req), value = data.url; if (value !== null && (typeof value !== "string" || value.length > 500000 || !/^data:image\/png;base64,[a-zA-Z0-9+/=]+$/.test(value))) throw new Error("Invalid thumbnail"); await storage.mkdir("_cache/covers"); await storage.writeText(coverCachePath(material.id), JSON.stringify({ url: value })); return send(res, 200, {}); }
      }
      if (method === "POST" && url.pathname === "/api/materials/attach") { const data = await body(req); const topic = await store.attachMaterial(str(data, "topicId"), str(data, "materialId")); await refresh(); return send(res, 200, topic); }
      if (method === "POST" && url.pathname === "/api/materials/use-repository-version") { const data = await body(req); const versions = await useRepositoryVersion(store, repository, str(data, "topicId"), str(data, "materialId")); await refresh(); return send(res, 200, versions); }
      if (method === "POST" && url.pathname === "/api/materials/check-update") { const data = await body(req); const result = await checkRepositoryUpdate(store, repository, str(data, "materialId")); await refresh(); return send(res, 200, result); }
      if (method === "POST" && url.pathname === "/api/materials/aids") { const data = await body(req); if (!Array.isArray(data.aids) || !data.aids.every(id => id === "interline") || new Set(data.aids).size !== data.aids.length) throw new Error("Invalid reading aids"); const material = await store.setMaterialAids(str(data, "materialId"), data.aids); await refresh(); return send(res, 200, material); }
      if (method === "POST" && ["/api/reading-locator", "/api/material-open"].includes(url.pathname)) {
        const data = await body(req), file = str(data, "file"), locator = url.pathname === "/api/reading-locator" ? str(data, "locator") : undefined;
        if (data.topicId) { if (!locator) throw new Error("Missing locator"); await store.updateLessonLocator(str(data, "topicId"), file, locator); }
        else {
          const material = await store.getMaterial(str(data, "materialId")); if (!material) throw new Error("材料不存在");
          if (material.kind !== "repo" && !material.files.some(entry => entry.name === file)) throw new Error("材料文件不存在");
          if (locator && material.kind !== "repo") await store.updateReadingLocator(material.id, file, locator);
          await rememberMaterialReading(store, material.id, file, locator);
        }
        return send(res, 200, {});
      }
      if (method === "POST" && url.pathname === "/api/interline") {
        const data = await body(req), topicId = typeof data.topicId === "string" ? data.topicId : "", file = str(data, "file"), mode = str(data, "mode");
        const topic = topicId ? await store.getTopic(topicId) : null;
        const materialId = str(data, "materialId");
        if (topicId && (!topic || !topic.materialIds.includes(materialId))) return send(res, 403, { error: "行间未挂载" });
        const material = await store.getMaterial(materialId);
        if (!material || !material.aids.includes("interline") || !material.files.some(item => item.name === file)) return send(res, 404, { error: "材料不存在" });
        const service = runtime.getService<InterlineService>("toolkit.interline");
        if (!service) return send(res, 503, { error: "行间不可用" });
        if (!Array.isArray(data.units) || !data.units.length || data.units.length > 10000 || JSON.stringify(data.units).length > 10_000_000 || !data.units.every((unit: any) => unit && typeof unit.html === "string" && Array.isArray(unit.segments) && unit.segments.every((segment: any) => segment && typeof segment.locator === "string" && typeof segment.sourceText === "string" && Number.isInteger(segment.blockIndex)))) throw new Error("Invalid interline units");
        const units = data.units as InterlineUnitInput[], index = data.index;
        if (typeof index !== "number") throw new Error("Invalid interline unit");
        const signature = JSON.stringify(units), key = JSON.stringify([materialId, file]);
        let entry = interlineSessions.get(key);
        if (!entry || entry.signature !== signature) { entry = { signature, session: new InterlineSession(service, storage, interlineTranslator, materialId, file, units) }; interlineSessions.set(key, entry); }
        return send(res, 200, await entry.session.render(index, mode as InterlineDisplayMode));
      }
      if (method === "POST" && url.pathname === "/api/speech/sentences") {
        const data = await body(req);
        const speech = runtime.getService<SpeechTtsService>("speech.tts");
        if (!speech) return send(res, 503, { error: "Speech service unavailable" });
        return send(res, 200, speech.splitSentences(str(data, "text")));
      }
      if (method === "GET" && url.pathname === "/api/speech/presets") {
        const tts = runtime.getService<SpeechTtsService>("speech.tts");
        const asr = runtime.getService<SpeechAsrService>("speech.asr");
        const health = async (service: SpeechTtsService | SpeechAsrService | undefined) => {
          if (!service || !service.checkHealth) return { ok: false, note: "语音引擎服务尚未接入，请在设置中配置本地或云端语音服务" };
          try { const result = await service.checkHealth(); return { ...result, note: speechErrorMessage(result.note, service) }; } catch (error) { return { ok: false, note: speechErrorMessage(error, service) }; }
        };
        return send(res, 200, { tts: tts && tts.listPresets ? tts.listPresets() : [], asr: asr && asr.listPresets ? asr.listPresets() : [], ttsHealth: await health(tts), asrHealth: await health(asr) });
      }
      if (method === "POST" && (url.pathname === "/api/speech/synthesize" || url.pathname === "/api/speech/transcribe")) {
        const data = await body(req);
        const tts = runtime.getService<SpeechTtsService>("speech.tts");
        const asr = runtime.getService<SpeechAsrService>("speech.asr");
        const abort = new AbortController();
        res.once("close", () => { if (!res.writableEnded) abort.abort(); });
        try {
          if (url.pathname.endsWith("synthesize")) {
            const text = str(data, "text");
            if (!tts || !tts.synthesizeSpeech) throw new Error("未连接语音引擎，请前往 ⚙ 设置配置本地或云端 TTS 服务");
            const audio = await tts.synthesizeSpeech(text, abort.signal);
            if (!audio.bytes.byteLength) throw new Error("语音引擎返回空音频，请检查 ⚙ 设置");
            res.writeHead(200, { "content-type": audio.mimeType, "cache-control": "no-store", "x-content-type-options": "nosniff" }); res.end(Buffer.from(audio.bytes)); return;
          }
          if (!asr || !asr.transcribeAudio) throw new Error("未连接跟读识别引擎，请前往 ⚙ 设置配置 ASR");
          const encoded = str(data, "audio");
          if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) throw new Error("Invalid audio");
          return send(res, 200, await asr.transcribeAudio(new Uint8Array(Buffer.from(encoded, "base64")), typeof data.mimeType === "string" ? data.mimeType : undefined, abort.signal));
        } catch (error) { return send(res, 503, { error: `语音引擎不可用，请前往 ⚙ 设置检查配置：${speechErrorMessage(error, url.pathname.endsWith("synthesize") ? tts : asr)}` }); }
      }
      if (method === "POST" && url.pathname === "/api/repo/inspect") {
        const data = await body(req);
        return send(res, 200, await resolveRepositoryIntake(str(data, "repoPath"), { inspectRepository: path => repository.inspectRepository(path), cloneRemote: async () => { throw new Error("请从导入入口克隆仓库"); } }));
      }
      if (method === "POST" && (url.pathname === "/api/materials/repo" || url.pathname === "/api/materials/url")) {
        const abort = new AbortController(), stop = () => abort.abort();
        res.on("close", stop);
        try {
          const data = await body(req);
          let material, description = "";
          if (url.pathname.endsWith("/repo")) {
            const resolved = await resolveRepositoryIntake(str(data, "repoPath"), repository, abort.signal);
            abort.signal.throwIfAborted(); description = resolved.description;
            material = await store.importMaterial({ ...resolved.info, kind: "repo", files: [] });
          } else {
            const bundle = await ingestExternalUrl({ url: str(data, "url") }, http, abort.signal);
            abort.signal.throwIfAborted();
            material = await store.importMaterial({ title: bundle.title, kind: bundle.kind, files: bundle.files, aids: initialMaterialAids(await sampleMaterialText(bundle.files)) });
          }
          await refresh(); return send(res, 201, { ...material, intakeDescription: description });
        } finally { res.off("close", stop); }
      }
      if (method === "POST" && url.pathname === "/api/materials") {
        const data = await body(req);
        const kind = str(data, "kind");
        if (!["book", "article", "media", "discussion", "repo"].includes(kind) || !Array.isArray(data.files) || !data.files.length) throw new Error("Invalid material");
        const topicId = typeof data.topicId === "string" && data.topicId ? data.topicId : undefined;
        if (topicId && !await store.getTopic(topicId)) return send(res, 404, { error: "Topic not found" });
        const files = data.files.map((item: unknown) => {
          if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("Invalid file");
          const entry = item as Record<string, unknown>; const encoded = str(entry, "data");
          if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) throw new Error("Invalid file data");
          return { name: str(entry, "name"), mimeType: typeof entry.mimeType === "string" ? entry.mimeType : "application/octet-stream", bytes: new Uint8Array(Buffer.from(encoded, "base64")) };
        });
        const material = await store.importMaterial({ title: str(data, "title"), kind: kind as "book" | "article" | "media" | "discussion" | "repo", files, aids: initialMaterialAids(await sampleMaterialText(files)) });
        if (topicId) await store.attachMaterial(topicId, material.id);
        await refresh(); return send(res, 201, material);
      }
      if (method === "GET" && (url.pathname === "/api/topic-session" || url.pathname === "/api/material-session")) {
        const topicId = url.searchParams.get("topicId");
        const standalone = url.pathname === "/api/material-session";
        const topic = topicId ? await store.getTopic(topicId) : null; if (!standalone && !topic) throw new Error("Topic not found");
        const materials = await Promise.all((standalone ? [url.searchParams.get("materialId") ?? ""] : topic!.materialIds).map(async id => { const material = await store.getMaterial(id); if (!material) throw new Error(`Material not found: ${id}`); return material; }));
        const repositoryFiles = await readSessionRepositoryFiles(repository, materials, standalone ? null : topic);
        const lessonVersions = !standalone && topic ? await readLessonVersions(store, repository, topic, materials, repositoryFiles) : undefined;
        return send(res, 200, { topic, materials, libraryMaterials: await store.listMaterials(), repositoryFiles, lessonVersions, readings: materialReadings(materials) });
      }
      if (method === "GET" && url.pathname === "/api/topic-lesson") {
        const topicId = url.searchParams.get("topicId"), fileName = url.searchParams.get("name");
        if (!topicId || !fileName) throw new Error("Missing topic or lesson");
        const text = await store.readLesson(topicId, fileName), reader = runtime.getService<StageReaderService>("stage.reader");
        if (!reader) throw new Error("Reader unavailable");
        return send(res, 200, { text, html: reader.render(text), sections: reader.sections(text), format: "markdown" });
      }
      if (method === "GET" && url.pathname === "/api/topic-repository") {
        const topicId = url.searchParams.get("topicId"), materialId = url.searchParams.get("materialId"), fileName = url.searchParams.get("name");
        if (!materialId || !fileName) throw new Error("Missing repository file");
        const topic = topicId ? await store.getTopic(topicId) : null, material = await store.getMaterial(materialId);
        if ((topicId && !topic?.materialIds.includes(materialId)) || material?.kind !== "repo" || !material.externalPath || !material.commitSha) throw new Error("Repository is not in topic");
        const parts: string[] = []; let startLine = 1;
        for (;;) { const page = await repository.readFile(material.externalPath, material.commitSha, fileName, startLine, 1000); parts.push(page.text); if (!page.truncated) break; startLine = page.endLine + 1; }
        return send(res, 200, { text: parts.join("\n"), commitSha: material.commitSha });
      }
      if (method === "POST" && (url.pathname === "/api/feynman/prepare" || url.pathname === "/api/feynman/compare")) {
        if (!options.promptService && !guideAvailable()) return send(res, 503, { error: GUIDE_UNAVAILABLE_REASON });
        const controller = new AbortController();
        const cancel = () => controller.abort();
        res.once("close", cancel);
        try {
          if (res.destroyed) cancel();
          const data = await body(req), topic = await store.getTopic(str(data, "topicId"));
          if (!topic || !topic.toolkits.includes("feynman")) throw new Error("费曼未挂载");
          const { signal } = controller;
          const source = str(data, "source"), points = await recall.prepare(source, signal);
          signal.throwIfAborted();
          const result = url.pathname.endsWith("/prepare") ? points : await recall.compare(source, points, str(data, "produced"), signal);
          if (!signal.aborted) return send(res, 200, result);
          return;
        } catch (error) {
          if (!controller.signal.aborted) throw error;
          return;
        } finally { res.off("close", cancel); }
      }
      if (method === "POST" && (url.pathname === "/api/toolkit/diagnose" || url.pathname === "/api/toolkit/transform")) {
        const data = await body(req);
        const topicId = str(data, "topicId");
        await refresh();
        const topic = await store.getTopic(topicId);
        if (!topic) return send(res, 404, { error: "Topic not found" });
        const toolkitId = data.toolkit === undefined ? "shadowing" : data.toolkit;
        if (toolkitId !== "shadowing" && toolkitId !== "feynman") throw new Error("Invalid toolkit");
        const materialId = typeof data.materialId === "string" ? data.materialId : undefined;
        if (materialId && !topic.materialIds.includes(materialId)) throw new Error("Material does not belong to topic");
        const material = materialId ? await store.getMaterial(materialId) : null;
        const requestedFile = typeof data.file === "string" ? material?.files.find(item => item.name === data.file) : undefined;
        if (!topic.toolkits.includes(toolkitId)) return send(res, 403, { error: `${toolkitId} is not enabled for this topic` });
        const toolkit = runtime.getService<ToolkitDescriptor>(`toolkit.${toolkitId}`);
        if (!toolkit) return send(res, 503, { error: `${toolkitId} service unavailable` });
        const targetText = str(data, "targetText");
        if (url.pathname === "/api/toolkit/transform") {
          const stage = str(data, "stage");
          if (!toolkit.stages.includes(stage as ToolkitStage)) throw new Error("Invalid stage");
          return send(res, 200, { text: toolkit.transformCue(targetText, stage as ToolkitStage) });
        }
        if (typeof data.producedText !== "string") throw new Error("Invalid producedText");
        if (!toolkit.diagnose) throw new Error("此工具不提供确定性对齐");
        const result = toolkit.diagnose(targetText, data.producedText);
        if (data.saveNote !== undefined && typeof data.saveNote !== "boolean") throw new Error("Invalid saveNote");
        if (data.saveNote === true) {
          if (!materialId) throw new Error("Material required");
          const note = await engine.capture({ owner: { topicId }, kind: "practice", body: result.summaryMarkdown, anchor: { source: { kind: "material", materialId }, file: str(data, "file"), locator: str(data, "locator"), quote: targetText } });
          processEffects(); return send(res, 201, { ...result, note });
        }
        return send(res, 200, result);
      }
      const rawPath = /^\/api\/materials\/([^/]+)\/raw$/.exec(url.pathname);
      if (method === "GET" && rawPath) {
        const id = decodeURIComponent(rawPath[1]!); const name = url.searchParams.get("name");
        if (!name) throw new Error("Missing file");
        const material = await store.getMaterial(id);
        const entry = material && material.files.find(item => item.name === name);
        if (!entry) return send(res, 404, { error: "File not found" });
        const page = fixedPageFormat(entry);
        const mimeType = audioContentType(entry) ?? videoContentType(entry) ?? (page && { pdf: "application/pdf", cbz: "application/vnd.comicbook+zip", epub: "application/epub+zip" }[page]);
        if (!mimeType) return send(res, 415, { error: "Unsupported file" });
        const bytes = await storage.readBinary(`materials/${id}/files/${entry.name}`);
        const range = req.headers.range;
        const match = range && /^bytes=(\d*)-(\d*)$/.exec(range);
        if (range && (!match || (!match[1] && !match[2]))) { res.writeHead(416, { "content-range": `bytes */${bytes.length}` }); res.end(); return; }
        let start = 0; let end = bytes.length - 1;
        if (match) {
          if (!match[1]) { const suffix = Number(match[2]); start = Math.max(0, bytes.length - suffix); }
          else { start = Number(match[1]); if (match[2]) end = Math.min(end, Number(match[2])); }
          if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= bytes.length) { res.writeHead(416, { "content-range": `bytes */${bytes.length}` }); res.end(); return; }
        }
        res.writeHead(match ? 206 : 200, { "content-type": mimeType, "cache-control": "no-store", "x-content-type-options": "nosniff", "accept-ranges": "bytes", "content-length": String(Math.max(0, end - start + 1)), ...(match ? { "content-range": `bytes ${start}-${end}/${bytes.length}` } : {}) });
        res.end(Buffer.from(bytes.subarray(start, end + 1))); return;
      }
      const materialPath = /^\/api\/materials\/([^/]+)\/file$/.exec(url.pathname);
      if (method === "GET" && (url.pathname === "/api/materials/file" || materialPath)) {
        const id = materialPath ? decodeURIComponent(materialPath[1]!) : url.searchParams.get("id"); const file = url.searchParams.get("name");
        if (!id || !file) throw new Error("Missing material or file");
        const material = await store.getMaterial(id);
        const entry = material && material.files.find(item => item.name === file);
        if (!entry) return send(res, 404, { error: "File not found" });
        if (url.searchParams.get("raw") === "1" && isMediaFile(entry) && /^(audio|video)\//.test(entry.mimeType)) { const bytes = await storage.readBinary(`materials/${id}/files/${file}`); res.writeHead(200, { "content-type": entry.mimeType, "cache-control": "no-store", "x-content-type-options": "nosniff" }); res.end(Buffer.from(bytes)); return; }
        if (material && isMediaFile(entry)) {
          const timeline = runtime.getService<StageTimelineService>("stage.timeline");
          if (!timeline) return send(res, 503, { error: "Timeline unavailable" });
          const { media, transcript } = resolveMediaPair(material.files, file);
          const text = transcript ? await storage.readText(`materials/${id}/files/${transcript.name}`) : "";
          const cues = timeline.parseTranscript(text);
          const escape = (value: string) => value.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
          const mediaKind = media && videoContentType(media) ? "video" : "audio";
          const html = timeline.renderTimelineView ? timeline.renderTimelineView({ title: material.title, cues, mediaKind }) : `<section class="pith-timeline-stage"><h1>${escape(material.title)}</h1>${mediaKind === "video" ? `<video class="pith-timeline-video" playsinline preload="metadata"></video>` : ""}${cues.map(cue => `<div class="pith-cue" data-cue-id="${escape(cue.id)}" data-locator="time:${cue.startSec}" data-end-sec="${cue.endSec}" data-prose="true"><time data-prose="false">${timeline.formatTimestamp(cue.startSec)}</time> ${escape(cue.text)}</div>`).join("")}</section>`;
          return send(res, 200, { text, html, sections: [], mediaFile: media?.name ?? null });
        }
        const reader = runtime.getService<StageReaderService>("stage.reader");
        if (!reader) return send(res, 503, { error: "Reader unavailable" });
        if (reader.renderFile) {
          const bytes = await storage.readBinary(`materials/${id}/files/${file}`);
          const document = await reader.renderFile(isSourceTextFile(entry.name) ? { ...entry, mimeType: "text/plain" } : entry, bytes);
          const text = document.format === "markdown" ? new TextDecoder().decode(bytes) : "";
          return send(res, 200, { text, html: document.html, sections: document.sections, format: document.format });
        }
        const text = await storage.readText(`materials/${id}/files/${file}`);
        return send(res, 200, { text, html: reader.render(text), sections: reader.sections(text) });
      }
      if (method === "POST" && url.pathname === "/api/notes") {
        const data = await body(req); const kind = str(data, "kind");
        if (kind !== "highlight" && kind !== "note" && kind !== "practice") throw new Error("Invalid kind");
        const note = await engine.capture({ owner: typeof data.materialId === "string" ? { materialId: data.materialId } : { topicId: str(data, "topicId") }, kind, body: str(data, "body"), anchor: anchor(data.anchor), ...(kind === "practice" && data.result !== undefined ? { result: data.result as Readonly<Record<string, unknown>> } : {}) });
        processEffects(); return send(res, 201, note);
      }
      if (url.pathname === "/api/chat" && method === "GET") {
        const id = url.searchParams.get("topicId"); if (!id || !await store.getTopic(id)) return send(res, 404, { error: "Topic not found" });
        return send(res, 200, (await engine.getConversation(id)).map(recoverInterruptedToolSteps));
      }
      if (url.pathname === "/api/observations" && method === "GET") {
        const id = url.searchParams.get("topicId"); if (!id || !await store.getTopic(id)) return send(res, 404, { error: "Topic not found" });
        return send(res, 200, await topicObservations(store, id));
      }
      if (url.pathname === "/api/observations/undo" && method === "POST") {
        const data = await body(req); await undoTopicObservation(store, engine, str(data, "topicId"), str(data, "observationId"));
        return send(res, 200, { ok: true });
      }
      if (url.pathname === "/api/chat" && method === "POST") {
        const data = await body(req);
        const topicId = str(data, "topicId");
        if (!guideAvailable()) return send(res, 503, { error: GUIDE_UNAVAILABLE_REASON });
        if (guideTurns.has(topicId)) return send(res, 409, { error: "Topic already has a running turn" });
        const retryId = data.turnId === undefined ? undefined : str(data, "turnId");
        const text = retryId ? undefined : str(data, "text"), selection = anchor(data.anchor);
        const controller = new AbortController(); guideTurns.set(topicId, controller);
        const stream = req.headers.accept === "text/event-stream";
        if (stream) res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
        try {
          const turnOptions = { signal: controller.signal, onUpdate: (turn: import("../../core/index.ts").GuideTurn) => { if (stream && !res.destroyed) res.write(`data: ${JSON.stringify(turn)}\n\n`); } };
          const result = retryId ? await engine.retryTurn(topicId, retryId, turnOptions) : await engine.runTurn({ topicId, text: text!, anchor: selection }, turnOptions);
          if (stream) { res.end(); return; }
          return send(res, 201, result);
        } catch (error) { if (stream) { res.write(`event: error\ndata: ${JSON.stringify(error instanceof Error ? error.message : String(error))}\n\n`); res.end(); return; } throw error; }
        finally { guideTurns.delete(topicId); }
      }
      if (url.pathname === "/api/chat/stop" && method === "POST") {
        const data = await body(req), topicId = str(data, "topicId");
        guideTurns.get(topicId)?.abort();
        return send(res, 200, { stopped: true });
      }
      if (url.pathname === "/api/settings" && method === "POST") {
        const data = await body(req);
        if (data.agentId !== undefined && (typeof data.agentId !== "string" || !["", "dsh", "claude", "codex"].includes(data.agentId))) throw new Error("Invalid agentId");
        if (data.model !== undefined && typeof data.model !== "string") throw new Error("Invalid model");
        if (data.effort !== undefined && typeof data.effort !== "string") throw new Error("Invalid effort");
        if (data.persona !== undefined && data.persona !== "sanctuary" && data.persona !== "studio") throw new Error("Invalid persona");
        if (data.speech !== undefined && (!data.speech || typeof data.speech !== "object" || Array.isArray(data.speech) || Object.entries(data.speech).some(([key, value]) => !["ttsProvider", "ttsEndpoint", "ttsModel", "ttsVoice", "azureRegion", "asrProvider", "asrLoopbackUrl", "asrModel"].includes(key) || typeof value !== "string"))) throw new Error("Invalid speech settings");
        if (data.speechMode !== undefined && (data.speechMode !== "local" && data.speechMode !== "cloud" || data.speech !== undefined)) throw new Error("Invalid speech mode");
        if (data.secrets !== undefined && (!data.secrets || typeof data.secrets !== "object" || Array.isArray(data.secrets) || Object.entries(data.secrets).some(([key, value]) => !["OPENAI_API_KEY", "AZURE_SPEECH_KEY"].includes(key) || typeof value !== "string"))) throw new Error("Invalid secrets");
        if (data.secrets) Object.assign(secrets, data.secrets);
        await MutationQueue.forStorage(storage).run(async () => {
          await loadSettings();
          if (data.speechMode !== undefined) { const next = switchSpeechMode(settings.speech ?? {}, settings.speechProfiles ?? {}, data.speechMode as SpeechMode); settings = { ...settings, speech: next.speech, speechProfiles: next.profiles }; }
          if (data.speech !== undefined || data.speechMode !== undefined) settings = { ...settings, speechSettingsVersion: 1 };
          settings = { ...settings, ...(data.speech !== undefined ? { speech: data.speech as Record<string, string> } : {}), ...(data.agentId !== undefined ? { agentId: data.agentId as WebSettings["agentId"], agentConfigured: true } : {}), ...(data.model !== undefined ? { model: data.model as string } : {}), ...(data.effort !== undefined ? { effort: data.effort as string } : {}), ...(data.persona !== undefined ? { persona: data.persona as WebSettings["persona"] } : {}) };
          await storage.writeText("_cache/web-settings.json", `${JSON.stringify(settings, null, 2)}\n`);
        });
        await refresh(); processEffects();
        return send(res, 200, { settings, plugins: runtime.statuses() });
      }
      if (url.pathname === "/api/plugins" && method === "POST") {
        const data = await body(req);
        if (data.preset !== undefined && data.preset !== "all" && data.preset !== "essentials") throw new Error("Invalid preset");
        if (data.persona !== undefined && data.persona !== "sanctuary" && data.persona !== "studio") throw new Error("Invalid persona");
        await MutationQueue.forStorage(storage).run(async () => {
          await loadSettings();
          if (data.id !== undefined) {
            const id = str(data, "id");
            if (!runtime.statuses().some(plugin => plugin.id === id) || typeof data.enabled !== "boolean") throw new Error("Invalid plugin");
            settings.plugins[id] = { enabled: data.enabled };
          }
          if (data.preset === "all" || data.preset === "essentials") settings.preset = data.preset;
          if (data.persona === "sanctuary" || data.persona === "studio") settings.persona = data.persona;
          await storage.writeText("_cache/web-settings.json", `${JSON.stringify(settings, null, 2)}\n`);
        });
        await refresh(); return send(res, 200, { settings, plugins: runtime.statuses() });
      }
      return send(res, 404, { error: "Not found" });
    } catch (error) {
      return send(res, 400, { error: error instanceof Error ? error.message : "Request failed" });
    }
  });
  server.on("close", () => runtime.stop());
  server.on("close", () => { if (speechRuntime.stop) void speechRuntime.stop().catch(error => console.error("Speech runtime stop failed:", error)); });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(options.port ?? 0, "127.0.0.1", () => { server.off("error", reject); resolve(); }); });
  return server;
}

const APP = String.raw`<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Pith</title>
<style>
:root{color-scheme:light dark;--background-primary:#ffffff;--background-secondary:#f6f6f7;--background-modifier-border:#e4e4e7;--background-modifier-hover:#ececef;--text-normal:#18181b;--text-muted:#71717a;--text-faint:#a1a1aa;--text-accent:#4e6a56;--interactive-accent:#4e6a56;--text-on-accent:#fff;--font-interface:system-ui,sans-serif;--pith-sage:#4e6a56;--pith-clay:#ad6548;--pith-serif:"Garden LXGW WenKai","LXGW WenKai","Songti SC","Noto Serif CJK SC","Source Han Serif SC","Iowan Old Style",Georgia,serif}
@media(prefers-color-scheme:dark){:root{--background-primary:#18181b;--background-secondary:#202024;--background-modifier-border:#34343a;--background-modifier-hover:#2c2c32;--text-normal:#e4e4e7;--text-muted:#a1a1aa;--text-faint:#71717a;--text-accent:#9bbfa2;--interactive-accent:#58785e;--pith-sage:#9bbfa2;--pith-clay:#d88d70}}
*{box-sizing:border-box}body{margin:0;background:var(--background-primary);color:var(--text-normal);font:15px/1.6 var(--font-interface)}button,input,textarea,select{font:inherit;color:inherit}button{cursor:pointer}button:focus-visible,input:focus-visible,textarea:focus-visible,select:focus-visible{outline:2px solid var(--text-accent);outline-offset:2px}button:active{transform:scale(.97)}[hidden]{display:none!important}
.button{background:transparent;border:1px solid var(--background-modifier-border);border-radius:5px;padding:7px 12px;min-height:38px}.button:hover{background:var(--background-modifier-hover)}
@font-face{font-family:"Garden LXGW WenKai";src:url('/fonts/lxgw-wenkai.woff2') format('woff2');font-display:swap}
.drawer{position:fixed;top:44px;right:0;bottom:0;width:min(360px,100%);background:var(--background-secondary);border:1px solid var(--background-modifier-border);z-index:20;padding:20px;overflow:auto}.form{display:grid;gap:10px;padding:20px 0}.pith-toast-tip{position:fixed;z-index:30;left:50%;bottom:80px;transform:translateX(-50%);background:var(--background-secondary);border:1px solid var(--background-modifier-border);padding:8px 12px;color:var(--text-normal)}@media(max-width:800px){body>header{padding:0 10px;gap:6px}.crumb{display:none}.home{padding:25px 18px}.focus{align-items:flex-start;flex-direction:column}.focus .button{margin:0}}
.drawer .form label{display:grid;grid-template-columns:minmax(0,1fr);gap:6px;padding:4px 0}.drawer .form label input,.drawer .form label select{min-width:0;width:100%;max-width:100%}.drawer .pith-setting-control{display:inline-flex;align-items:center;justify-content:flex-end;gap:8px}.drawer .pith-setting-control select{width:auto;min-width:120px}.drawer #speech-runtime{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px}.drawer #speech-runtime[hidden]{display:none}.drawer .pith-runtime-title{display:flex;flex-direction:column;gap:4px}.drawer .pith-runtime-title small{color:var(--text-muted)}
</style></head><body><main id="main"></main><aside class="drawer" id="drawer" hidden></aside><div class="pith-toast-tip" id="toast" role="status" hidden></div><script src="/app.js" defer></script></body></html>`;
