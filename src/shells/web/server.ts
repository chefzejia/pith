import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { DefaultAttentionEngine, DefaultWorkspaceStore, MutationQueue, type DojoScaffoldStage, type DojoToolkitDescriptor, type GuideAgentService, type GuideProvider, type InterlineDisplayMode, type InterlineService, type InterlineTranslator, type PluginsConfigFile, type SelectionAnchor, type SpeechTtsService, type SpeechAsrService, type StageTimelineService, type StageReaderService } from "../../core/index.ts";
import { LocalAcpGuideProvider, buildScenePrompt } from "../../plugins/guide-acp/index.ts";
import { bootStandaloneShell, type WorkspaceSnapshot } from "./index.ts";
import { NodeAgentProcessPort } from "./nodeProcess.ts";
import { NodeWorkspaceStorage } from "./nodeStorage.ts";
import { NodeHttpPort } from "./nodeHttp.ts";
import * as readerFont from "../../plugins/stage-reader/lxgwWenKaiData.ts";
import { audioContentType } from "../../workbench/mediaAssets.ts";
import { effectiveToolkits } from "../../workbench/toolkitSlot.ts";
import { migrateLegacySpeech, switchSpeechMode, validSpeechProfiles, type SpeechMode, type SpeechProfiles } from "../speech/speechSettings.ts";
import { agentInterlineTranslator } from "../../plugins/guide-acp/index.ts";
import { InterlineSession, type InterlineUnitInput } from "../../plugins/dojo-interline/index.ts";
import { NodeManagedSpeechRuntime } from "../speech/speechRuntime.ts";
import { practiceMessage } from "../../plugins/dojo-feynman/index.ts";
import type { ManagedSpeechRuntimePort } from "../../core/index.ts";

interface WebSettings { preset: "essentials" | "all"; persona: "sanctuary" | "studio"; plugins: Record<string, { enabled: boolean }>; agentId: "" | "dsh" | "claude" | "codex"; agentConfigured?: boolean; model: string; effort: string; speech?: Record<string, string>; speechProfiles?: SpeechProfiles; speechSettingsVersion?: 1 }
export interface PithWebServerOptions { workspaceDir: string; port?: number; guideProvider?: GuideProvider; interlineTranslator?: InterlineTranslator; speechRuntime?: ManagedSpeechRuntimePort }

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
  const quote = a.quote;
  if (quote !== undefined && typeof quote !== "string") throw new Error("Invalid quote");
  return { file: str(a, "file"), locator: str(a, "locator"), ...(typeof quote === "string" ? { quote } : {}) };
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
  const config = (): PluginsConfigFile => ({ preset: settings.preset, plugins: { ...settings.plugins, "speech-service": { ...settings.plugins["speech-service"], config: settings.speech ?? {} }, "guide-acp": { ...settings.plugins["guide-acp"], config: { agentId: settings.agentId, model: settings.model, effort: settings.effort, persona: settings.persona } } } });
  const processPort = new NodeAgentProcessPort();
  const speechRuntime = options.speechRuntime ?? new NodeManagedSpeechRuntime({ protectedRoot: options.workspaceDir });
  const secrets: Record<string, string> = {};
  const runtime = bootStandaloneShell({ id: "web", storage, process: processPort, speechRuntime, http: new NodeHttpPort(), secrets: { getSecret: key => secrets[key] || process.env[key] || null } }, config(), { store, engine, snapshot, provider: options.guideProvider });
  localProvider = new LocalAcpGuideProvider({ processPort, store, getAgentConfig: () => ({ agentId: settings.agentId, model: settings.model, effort: settings.effort }), resolveDescriptor: async id => {
    const guide = runtime.getService<GuideAgentService>("guide.agent");
    if (!guide || !guide.detectAgents) throw new Error("Guide service unavailable");
    return (await guide.detectAgents()).find(item => item.id === id) ?? null;
  }, buildScenePrompt });
  const interlineSessions = new Map<string, { signature: string; session: InterlineSession }>();
  const interlineTranslator = options.interlineTranslator ?? agentInterlineTranslator({ process: processPort, resolveAgent: async () => { if (!settings.agentId) throw new Error("请先配置向导 Agent"); const guide = runtime.getService<GuideAgentService>("guide.agent"); if (!guide || !guide.detectAgents) throw new Error("向导 Agent 不可用"); const descriptor = (await guide.detectAgents()).find(item => item.id === settings.agentId); if (!descriptor || !descriptor.available) throw new Error("向导 Agent 不可用"); return { descriptor, model: settings.model, effort: settings.effort }; } });
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
        await refresh(); const dojos = ["shadowing", "feynman", "interline"].flatMap(id => { const service = runtime.getService<DojoToolkitDescriptor>(`dojo.${id}`); return service ? [{ id, evalMode: service.evalMode }] : []; }); return send(res, 200, { compass: await engine.compass(), materials: snapshot.materials, settings, plugins: runtime.statuses(), dojos: dojos.map(item => item.id), dojoModes: Object.fromEntries(dojos.map(item => [item.id, item.evalMode])) });
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
      if (url.pathname === "/api/speech/runtime" && method === "POST") {
        const data = await body(req), action = str(data, "action");
        if (action !== "install" && action !== "ensureRunning" && action !== "stop" && action !== "remove") return send(res, 400, { error: "Invalid runtime action" });
        const operation = speechRuntime[action]; if (!operation) throw new Error("本宿主不支持该操作");
        return send(res, 200, await operation.call(speechRuntime));
      }
      if (method === "POST" && url.pathname === "/api/topics") {
        const data = await body(req);
        const topic = await store.createTopic({ title: str(data, "title"), target: typeof data.target === "string" ? data.target : "", nextAction: typeof data.nextAction === "string" ? data.nextAction : undefined,
          materialId: typeof data.materialId === "string" && data.materialId ? data.materialId : undefined });
        await refresh(); return send(res, 201, topic);
      }
      const toolkitPath = /^\/api\/topics\/([^/]+)\/toolkits$/.exec(url.pathname);
      if (method === "POST" && toolkitPath) {
        const data = await body(req);
        if (!Array.isArray(data.toolkits) || !data.toolkits.every(item => typeof item === "string" && /^[a-z][a-z0-9-]*$/.test(item)) || new Set(data.toolkits).size !== data.toolkits.length) throw new Error("Invalid toolkits");
        const topic = await store.updateTopic(decodeURIComponent(toolkitPath[1]!), { toolkits: data.toolkits });
        await refresh(); return send(res, 200, topic);
      }
      const actionsPath = /^\/api\/topics\/([^/]+)\/actions$/.exec(url.pathname);
      if (method === "GET" && actionsPath) {
        await refresh();
        const topic = await store.getTopic(decodeURIComponent(actionsPath[1]!));
        if (!topic) return send(res, 404, { error: "Topic not found" });
        const guide = runtime.getService<GuideAgentService>("guide.agent");
        if (!guide || !guide.quickActionsForTopic) return send(res, 503, { error: "Guide service unavailable" });
        const dojos = ["shadowing", "feynman", "interline"].flatMap(id => { const dojo = runtime.getService<DojoToolkitDescriptor>(`dojo.${id}`); return dojo ? [dojo] : []; });
        return send(res, 200, guide.quickActionsForTopic(topic, dojos));
      }
      if (method === "POST" && url.pathname === "/api/interline") {
        const data = await body(req), topicId = str(data, "topicId"), file = str(data, "file"), mode = str(data, "mode");
        const topic = await store.getTopic(topicId);
        if (!topic || !topic.materialId || !effectiveToolkits(topic.toolkits, file).includes("interline")) return send(res, 403, { error: "行间双语未挂载" });
        const material = await store.getMaterial(topic.materialId);
        if (!material || !material.files.some(item => item.name === file)) return send(res, 404, { error: "材料不存在" });
        const service = runtime.getService<InterlineService>("dojo.interline");
        if (!service) return send(res, 503, { error: "行间双语不可用" });
        if (!Array.isArray(data.units) || !data.units.length || data.units.length > 10000 || JSON.stringify(data.units).length > 10_000_000 || !data.units.every((unit: any) => unit && typeof unit.html === "string" && Array.isArray(unit.segments) && unit.segments.every((segment: any) => segment && typeof segment.locator === "string" && typeof segment.sourceText === "string" && Number.isInteger(segment.blockIndex)))) throw new Error("Invalid interline units");
        const units = data.units as InterlineUnitInput[], index = data.index;
        if (typeof index !== "number") throw new Error("Invalid interline unit");
        const signature = JSON.stringify(units), key = JSON.stringify([topicId, topic.materialId, file]);
        let entry = interlineSessions.get(key);
        if (!entry || entry.signature !== signature) { entry = { signature, session: new InterlineSession(service, storage, interlineTranslator, topic.materialId, file, units) }; interlineSessions.set(key, entry); }
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
      if (method === "POST" && url.pathname === "/api/materials") {
        const data = await body(req);
        const kind = str(data, "kind");
        if (!["book", "article", "media", "discussion", "repo"].includes(kind) || !Array.isArray(data.files) || !data.files.length) throw new Error("Invalid material");
        const topicId = typeof data.topicId === "string" && data.topicId ? data.topicId : undefined;
        if (topicId) { const topic = await store.getTopic(topicId); if (!topic) return send(res, 404, { error: "Topic not found" }); if (topic.materialId) return send(res, 409, { error: "课题已有材料，无法替换" }); }
        const files = data.files.map((item: unknown) => {
          if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("Invalid file");
          const entry = item as Record<string, unknown>; const encoded = str(entry, "data");
          if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) throw new Error("Invalid file data");
          return { name: str(entry, "name"), mimeType: typeof entry.mimeType === "string" ? entry.mimeType : "application/octet-stream", bytes: new Uint8Array(Buffer.from(encoded, "base64")) };
        });
        const material = await store.importMaterial({ title: str(data, "title"), kind: kind as "book" | "article" | "media" | "discussion" | "repo", files });
        if (topicId) await store.updateTopic(topicId, { materialId: material.id });
        await refresh(); return send(res, 201, material);
      }
      if (method === "POST" && (url.pathname === "/api/dojo/diagnose" || url.pathname === "/api/dojo/transform" || url.pathname === "/api/dojo/submit")) {
        const data = await body(req);
        const topicId = str(data, "topicId");
        await refresh();
        const topic = await store.getTopic(topicId);
        if (!topic) return send(res, 404, { error: "Topic not found" });
        const toolkit = data.toolkit === undefined ? "shadowing" : data.toolkit;
        if (toolkit !== "shadowing" && toolkit !== "feynman") throw new Error("Invalid toolkit");
        const material = topic.materialId ? await store.getMaterial(topic.materialId) : null;
        const requestedFile = typeof data.file === "string" ? material?.files.find(item => item.name === data.file) : undefined;
        const format = requestedFile?.name ?? material?.files[0]?.name ?? material?.kind ?? "";
        if (!effectiveToolkits(topic.toolkits, format).includes(toolkit)) return send(res, 403, { error: `${toolkit} is not enabled for this topic` });
        const dojo = runtime.getService<DojoToolkitDescriptor>(`dojo.${toolkit}`);
        if (!dojo) return send(res, 503, { error: `${toolkit} service unavailable` });
        const targetText = str(data, "targetText");
        if (url.pathname === "/api/dojo/submit") {
          if (dojo.evalMode !== "guide-rubric" || !dojo.evaluationRubric) throw new Error("此工具不支持向导评价");
          const producedText = str(data, "producedText");
          const practiceAnchor = anchor(data.anchor);
          if (!practiceAnchor || !requestedFile || practiceAnchor.file !== requestedFile.name || practiceAnchor.quote !== targetText) throw new Error("原文锚点无效");
          const note = await engine.captureSelection({ topicId, kind: "practice", body: producedText, anchor: practiceAnchor });
          processEffects();
          if (!options.guideProvider && !settings.agentId) return send(res, 201, { note, guided: false });
          try { await engine.sendMessage({ topicId, text: practiceMessage(producedText, dojo.label, dojo.evaluationRubric), anchor: practiceAnchor }); return send(res, 201, { note, guided: true }); }
          catch (error) { return send(res, 201, { note, guided: false, guideError: error instanceof Error ? error.message : String(error) }); }
        }
        if (url.pathname === "/api/dojo/transform") {
          const stage = str(data, "stage");
          if (!dojo.stages.includes(stage as DojoScaffoldStage)) throw new Error("Invalid stage");
          return send(res, 200, { text: dojo.transformCue(targetText, stage as DojoScaffoldStage) });
        }
        if (typeof data.producedText !== "string") throw new Error("Invalid producedText");
        const result = dojo.diagnose(targetText, data.producedText);
        if (data.saveNote !== undefined && typeof data.saveNote !== "boolean") throw new Error("Invalid saveNote");
        if (data.saveNote === true) {
          const note = await engine.captureSelection({ topicId, kind: "practice", body: result.summaryMarkdown, anchor: { file: str(data, "file"), locator: str(data, "locator"), quote: targetText } });
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
        const mimeType = audioContentType(entry);
        if (!mimeType) return send(res, 415, { error: "Not an audio file" });
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
        if (url.searchParams.get("raw") === "1" && /^(audio|video)\//.test(entry.mimeType)) { const bytes = await storage.readBinary(`materials/${id}/files/${file}`); res.writeHead(200, { "content-type": entry.mimeType, "cache-control": "no-store", "x-content-type-options": "nosniff" }); res.end(Buffer.from(bytes)); return; }
        if (material && (/\.(vtt|srt)$/i.test(file) || audioContentType(entry) || entry.mimeType.startsWith("video/"))) {
          const timeline = runtime.getService<StageTimelineService>("stage.timeline");
          if (!timeline) return send(res, 503, { error: "Timeline unavailable" });
          const transcript = /\.(vtt|srt)$/i.test(file) ? entry : material.files.find(item => /\.(vtt|srt)$/i.test(item.name));
          const text = transcript ? await storage.readText(`materials/${id}/files/${transcript.name}`) : "";
          const cues = timeline.parseTranscript(text);
          const escape = (value: string) => value.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
          const media = /^(audio|video)\//.test(entry.mimeType) ? entry : material.files.find(item => /^(audio|video)\//.test(item.mimeType));
          const mediaKind = media && media.mimeType.startsWith("video/") ? "video" : "audio";
          const mediaFile = media ? `/api/materials/${encodeURIComponent(material.id)}/file?name=${encodeURIComponent(media.name)}&raw=1` : undefined;
          const html = timeline.renderTimelineView ? timeline.renderTimelineView({ title: material.title, cues, mediaKind, ...(mediaFile ? { mediaFile } : {}) }) : `<section class="pith-timeline-stage"><h1>${escape(material.title)}</h1>${mediaFile ? `<${mediaKind} controls src="${escape(mediaFile)}"></${mediaKind}>` : ""}${cues.map(cue => `<div class="pith-cue" data-cue-id="${escape(cue.id)}" data-locator="time:${cue.startSec}" data-prose="true"><time data-prose="false">${timeline.formatTimestamp(cue.startSec)}</time> ${escape(cue.text)}</div>`).join("")}</section>`;
          return send(res, 200, { text, html, sections: [] });
        }
        const reader = runtime.getService<StageReaderService>("stage.reader");
        if (!reader) return send(res, 503, { error: "Reader unavailable" });
        if (reader.renderFile) {
          const bytes = await storage.readBinary(`materials/${id}/files/${file}`);
          const document = await reader.renderFile(entry, bytes);
          const text = document.format === "markdown" ? new TextDecoder().decode(bytes) : "";
          return send(res, 200, { text, html: document.html, sections: document.sections, format: document.format });
        }
        const text = await storage.readText(`materials/${id}/files/${file}`);
        return send(res, 200, { text, html: reader.render(text), sections: reader.sections(text) });
      }
      if (method === "POST" && url.pathname === "/api/notes") {
        const data = await body(req); const kind = str(data, "kind");
        if (kind !== "highlight" && kind !== "note" && kind !== "practice") throw new Error("Invalid kind");
        const note = await engine.captureSelection({ topicId: str(data, "topicId"), kind, body: str(data, "body"), anchor: anchor(data.anchor) });
        processEffects(); return send(res, 201, note);
      }
      if (url.pathname === "/api/chat" && method === "GET") {
        const id = url.searchParams.get("topicId"); if (!id || !await store.getTopic(id)) return send(res, 404, { error: "Topic not found" });
        return send(res, 200, await engine.getConversation(id));
      }
      if (url.pathname === "/api/chat" && method === "POST") {
        const data = await body(req);
        const result = await engine.sendMessage({ topicId: str(data, "topicId"), text: str(data, "text"), anchor: anchor(data.anchor), saveAsNote: data.saveAsNote === true });
        if (data.saveAsNote === true) processEffects();
        return send(res, 201, result);
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
:root{color-scheme:light dark;--background-primary:#fff;--background-secondary:#f5f5f5;--background-modifier-border:#ddd;--background-modifier-hover:#eee;--text-normal:#222;--text-muted:#666;--text-faint:#999;--text-accent:#705dc7;--interactive-accent:#705dc7;--text-on-accent:#fff;--font-interface:system-ui,sans-serif}
@media(prefers-color-scheme:dark){:root{--background-primary:#1e1e1e;--background-secondary:#262626;--background-modifier-border:#444;--background-modifier-hover:#333;--text-normal:#ddd;--text-muted:#aaa;--text-faint:#777;--text-accent:#a99bea;--interactive-accent:#7865c4;--text-on-accent:#fff}}
*{box-sizing:border-box}body{margin:0;background:var(--background-primary);color:var(--text-normal);font:15px/1.6 var(--font-interface)}button,input,textarea,select{font:inherit;color:inherit}button{cursor:pointer}button:focus-visible,input:focus-visible,textarea:focus-visible,select:focus-visible{outline:2px solid var(--text-accent);outline-offset:2px}button:active{transform:scale(.97)}[hidden]{display:none!important}
.button{background:transparent;border:1px solid var(--background-modifier-border);border-radius:5px;padding:7px 12px;min-height:38px}.button:hover{background:var(--background-modifier-hover)}
@font-face{font-family:"Garden LXGW WenKai";src:url('/fonts/lxgw-wenkai.woff2') format('woff2');font-display:swap}
:root{--background-primary:#f7f8f6;--background-secondary:#edf0ed;--background-modifier-border:#d5dcd6;--background-modifier-hover:#e1e9e2;--text-normal:#25322b;--text-muted:#5f6c63;--text-faint:#87938a;--text-accent:#4e6a56;--interactive-accent:#4e6a56;--pith-sage:#4e6a56;--pith-clay:#ad6548;--pith-serif:"Garden LXGW WenKai","LXGW WenKai","Songti SC","Noto Serif CJK SC","Source Han Serif SC","Iowan Old Style",Georgia,serif}
@media(prefers-color-scheme:dark){:root{--background-primary:#202622;--background-secondary:#2a322d;--background-modifier-border:#455149;--background-modifier-hover:#35443a;--text-normal:#e0e8e1;--text-muted:#aebcb0;--text-faint:#829286;--text-accent:#9bbfa2;--interactive-accent:#58785e;--pith-sage:#9bbfa2;--pith-clay:#d88d70}}
.drawer{position:fixed;top:44px;right:0;bottom:0;width:min(360px,100%);background:var(--background-secondary);border:1px solid var(--background-modifier-border);z-index:20;padding:20px;overflow:auto}.form{display:grid;gap:10px;padding:20px 0}.pith-toast-tip{position:fixed;z-index:30;left:50%;bottom:80px;transform:translateX(-50%);background:var(--background-secondary);border:1px solid var(--background-modifier-border);padding:8px 12px;color:var(--text-normal)}@media(max-width:800px){body>header{padding:0 10px;gap:6px}.crumb{display:none}.home{padding:25px 18px}.focus{align-items:flex-start;flex-direction:column}.focus .button{margin:0}}
.drawer .form label{display:grid;grid-template-columns:minmax(0,1fr);gap:6px;padding:4px 0}.drawer .form label input,.drawer .form label select{min-width:0;width:100%;max-width:100%}.drawer .pith-setting-control{display:inline-flex;align-items:center;justify-content:flex-end;gap:8px}.drawer .pith-setting-control select{width:auto;min-width:120px}.drawer #speech-runtime{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px}.drawer #speech-runtime[hidden]{display:none}.drawer .pith-runtime-title{display:flex;flex-direction:column;gap:4px}.drawer .pith-runtime-title small{color:var(--text-muted)}
</style></head><body><main id="main"></main><aside class="drawer" id="drawer" hidden></aside><div class="pith-toast-tip" id="toast" role="status" hidden></div><script src="/app.js" defer></script></body></html>`;
