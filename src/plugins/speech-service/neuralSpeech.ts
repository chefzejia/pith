import type { AsrTranscriptionResult, CuratedAsrProviderId, CuratedTtsProviderId, HostPort, HttpRequestSpec, SpeechEnginePreset, SpeechHealthStatus, SpeechSynthesisAudio } from "../../core/index.ts";

export const CURATED_TTS_PRESETS: readonly SpeechEnginePreset<CuratedTtsProviderId>[] = [
  { id: "kokoro-local", label: "本机 OpenAI 兼容语音服务 (Local HTTP)", kind: "local", defaultEndpoint: "http://127.0.0.1:8880/v1/audio/speech", defaultModel: "tts-1", defaultVoice: "alloy", installHint: "在本机启动任意兼容 OpenAI /v1/audio/speech 协议的本地 TTS 服务（如 Kokoro / MLX-Audio，默认监听 127.0.0.1:8880）" },
  { id: "openai-tts", label: "OpenAI Audio Speech (云端或兼容网关)", kind: "cloud", defaultEndpoint: "https://api.openai.com/v1/audio/speech", defaultModel: "gpt-4o-mini-tts", defaultVoice: "alloy", installHint: "需配置 OPENAI_API_KEY" },
  { id: "azure-neural", label: "Azure Neural TTS (微软神经网络音色)", kind: "cloud", defaultEndpoint: "https://{region}.tts.speech.microsoft.com/cognitiveservices/v1", defaultVoice: "zh-CN-XiaoxiaoNeural", installHint: "需配置 AZURE_SPEECH_KEY 与区域" },
];
export const CURATED_ASR_PRESETS: readonly SpeechEnginePreset<CuratedAsrProviderId>[] = [
  { id: "whisper-local", label: "本机回环 ASR 服务 (Local Loopback)", kind: "local", defaultEndpoint: "http://localhost:8765", defaultModel: "whisper-1", installHint: "配置本机原始音频转写服务，或填写兼容 /v1/audio/transcriptions 的完整端点" },
  { id: "sensevoice-local", label: "本机极速多语种 ASR (Local 8766)", kind: "local", defaultEndpoint: "http://127.0.0.1:8766", defaultModel: "sensevoice", installHint: "配置本机原始音频转写服务，或填写兼容 /v1/audio/transcriptions 的完整端点" },
  { id: "openai-whisper", label: "OpenAI Audio Transcriptions (云端或兼容网关)", kind: "cloud", defaultEndpoint: "https://api.openai.com/v1/audio/transcriptions", defaultModel: "whisper-1", installHint: "需配置 OPENAI_API_KEY" },
];

export interface NeuralSpeechConfig {
  readonly ttsProvider: CuratedTtsProviderId; readonly ttsEndpoint: string; readonly ttsModel?: string; readonly ttsVoice: string;
  readonly azureRegion: string; readonly asrProvider: CuratedAsrProviderId; readonly asrLoopbackUrl: string; readonly asrModel?: string; readonly rate: number;
}
const xml = (text: string): string => text.replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[ch]!);
const header = (headers: Readonly<Record<string, string>>, name: string): string => Object.entries(headers).find(([key]) => key.toLowerCase() === name)?.[1] ?? "";

export function createNeuralSpeech(host: HostPort | undefined, config: NeuralSpeechConfig, isLoopbackSafe: (url: string) => boolean) {
  const normalizedTtsId = config.ttsProvider === "openai-compatible-local" ? "kokoro-local" : config.ttsProvider;
  const ttsPreset = CURATED_TTS_PRESETS.find(p => p.id === normalizedTtsId);
  const asrPreset = CURATED_ASR_PRESETS.find(p => p.id === config.asrProvider);
  if (!ttsPreset || !asrPreset) throw new Error("Invalid speech provider");
  const tts = ttsPreset; const asr = asrPreset;
  const ttsEndpoint = config.ttsEndpoint || (tts.id === "azure-neural" ? tts.defaultEndpoint.replace("{region}", config.azureRegion) : tts.defaultEndpoint);
  const asrEndpoint = config.asrLoopbackUrl || asr.defaultEndpoint;
  const openAiLocalAsr = asr.kind === "local" && /\/v1\/audio\/transcriptions\/?$/.test(asrEndpoint);
  const ttsModel = (config.ttsModel && config.ttsModel.trim()) || (tts.id === "kokoro-local" ? "kokoro" : tts.defaultModel || "gpt-4o-mini-tts");
  const asrModel = (config.asrModel && config.asrModel.trim()) || asr.defaultModel || "whisper-1";
  const voice = config.ttsVoice || tts.defaultVoice!;
  function validateAsrConfig(openAi = openAiLocalAsr): void {
    if (asr.kind === "local" && !openAi && config.asrModel && config.asrModel.trim()) throw new Error("本机原始音频协议不支持指定模型，请使用 /v1/audio/transcriptions 兼容端点");
  }
  async function managedEndpoint(preset: SpeechEnginePreset, fallback: string, kind: "tts" | "asr", signal?: AbortSignal): Promise<string> {
    if (preset.kind !== "local" || !host || !host.speechRuntime) return fallback;
    const state = await host.speechRuntime.getState();
    if (!state.supported || state.status === "not-installed") return fallback;
    if (!host.speechRuntime.ensureRunning) throw new Error("本机语音网关无法启动");
    const running = await host.speechRuntime.ensureRunning(signal);
    const endpoint = kind === "tts" ? running.endpoint : running.asrEndpoint;
    if (running.status !== "running" || !endpoint || !isLoopbackSafe(endpoint)) throw new Error("本机语音网关不可用");
    return endpoint;
  }
  async function prepare(preset: SpeechEnginePreset, endpoint: string): Promise<string> {
    if (!host || !host.http) throw new Error(`HTTP unavailable. ${preset.installHint}`);
    if (preset.kind === "local") {
      if (!isLoopbackSafe(endpoint)) throw new Error(`Unsafe local endpoint. ${preset.installHint}`);
      return "";
    }
    let url: URL;
    try { url = new URL(endpoint); } catch { throw new Error(`Unsafe cloud endpoint. ${preset.installHint}`); }
    const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
    const authority = /^https:\/\/([^/?#]*)/i.exec(endpoint);
    const ipv6 = hostname.startsWith("[") && hostname.endsWith("]");
    if (!authority || authority[1]!.includes("@") || /[?#]/.test(endpoint) || url.protocol !== "https:" || url.username || url.password || (!ipv6 && (!hostname.includes(".") || hostname === "localhost" || /\.(?:localhost|local|internal|test|invalid|example)$/.test(hostname)))) throw new Error(`Unsafe cloud endpoint. ${preset.installHint}`);
    if (!("requestPublicSpeech" in host.http) || typeof host.http.requestPublicSpeech !== "function") throw new Error("Safe public speech transport unavailable");
    const secret = host.secrets ? await host.secrets.getSecret(preset.id === "azure-neural" ? "AZURE_SPEECH_KEY" : "OPENAI_API_KEY") : null;
    if (!secret || !secret.trim()) throw new Error(`Missing API key. ${preset.installHint}`);
    return secret;
  }
  async function request(preset: SpeechEnginePreset, spec: Parameters<NonNullable<HostPort["http"]>["request"]>[0]) {
    try {
      const http = host!.http!;
      const response = preset.kind === "cloud" ? await (http as typeof http & { requestPublicSpeech(request: HttpRequestSpec): ReturnType<typeof http.request> }).requestPublicSpeech(spec) : await http.request(spec);
      if (response.status < 200 || response.status >= 300) throw new Error(`HTTP ${response.status}`);
      return response;
    } catch (error) {
      if (spec.signal && spec.signal.aborted) spec.signal.throwIfAborted();
      throw new Error(`Speech request failed: ${error instanceof Error ? error.message : String(error)}. ${preset.installHint}`);
    }
  }
  async function synthesizeSpeech(text: string, signal?: AbortSignal): Promise<SpeechSynthesisAudio> {
    if (!text.trim()) throw new Error(`Empty speech text. ${tts.installHint}`);
    const endpoint = await managedEndpoint(tts, ttsEndpoint, "tts", signal);
    const key = await prepare(tts, endpoint);
    const azure = tts.id === "azure-neural";
    const language = /^([a-z]{2,3}-[a-z]{2})-/i.exec(voice);
    if (azure && (!language || !/^[a-z0-9-]+$/i.test(voice))) throw new Error(`Invalid Azure voice. ${tts.installHint}`);
    const response = await request(tts, { url: endpoint, method: "POST", signal, headers: azure
      ? { "Content-Type": "application/ssml+xml", "Ocp-Apim-Subscription-Key": key, "X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3" }
      : { "Content-Type": "application/json", ...(key ? { Authorization: `Bearer ${key}` } : {}) },
      body: azure ? `<speak version="1.0" xml:lang="${language![1]}"><voice name="${xml(voice)}"><prosody rate="${Math.round((config.rate - 1) * 100)}%">${xml(text)}</prosody></voice></speak>` : JSON.stringify({ model: ttsModel, input: text, voice, response_format: "mp3", speed: config.rate }) });
    if (!response.bytes.byteLength) throw new Error(`Empty audio response. ${tts.installHint}`);
    return { bytes: response.bytes, mimeType: header(response.headers, "content-type").split(";")[0] || "audio/mpeg", providerId: config.ttsProvider };
  }
  async function transcribeAudio(bytes: Uint8Array, mimeType = "audio/webm", signal?: AbortSignal): Promise<AsrTranscriptionResult> {
    if (!bytes.byteLength) throw new Error(`Empty audio. ${asr.installHint}`);
    if (!/^audio\/[a-z0-9.+-]+$/i.test(mimeType)) throw new Error(`Invalid audio MIME type. ${asr.installHint}`);
    const endpoint = await managedEndpoint(asr, asrEndpoint, "asr", signal);
    const openAiLocalAsr = asr.kind === "local" && /\/v1\/audio\/transcriptions\/?$/.test(endpoint);
    const key = await prepare(asr, endpoint);
    validateAsrConfig(openAiLocalAsr);
    let body: Uint8Array = bytes; let contentType = mimeType;
    if (asr.kind === "cloud" || openAiLocalAsr) {
      const boundary = `pith-${crypto.randomUUID()}`;
      const encode = new TextEncoder();
      const extension = ({ "audio/mpeg": "mp3", "audio/mp4": "mp4", "audio/x-m4a": "m4a", "audio/wav": "wav", "audio/x-wav": "wav", "audio/ogg": "ogg", "audio/flac": "flac", "audio/webm": "webm" } as Record<string, string>)[mimeType.toLowerCase()] || "webm";
      const prefix = encode.encode(`--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\n${asrModel}\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="audio.${extension}"\r\nContent-Type: ${mimeType}\r\n\r\n`);
      const suffix = encode.encode(`\r\n--${boundary}--\r\n`);
      body = new Uint8Array(prefix.length + bytes.length + suffix.length); body.set(prefix); body.set(bytes, prefix.length); body.set(suffix, prefix.length + bytes.length);
      contentType = `multipart/form-data; boundary=${boundary}`;
    }
    const response = await request(asr, { url: asr.kind === "local" && !openAiLocalAsr ? `${endpoint.replace(/\/$/, "")}/transcribe` : endpoint, method: "POST", headers: { "Content-Type": contentType, ...(key ? { Authorization: `Bearer ${key}` } : {}) }, body, signal });
    const raw = response.text().trim(); const responseType = header(response.headers, "content-type").split(";")[0]!.trim().toLowerCase();
    const legacyLocal = asr.kind === "local" && !openAiLocalAsr;
    let record: Record<string, unknown> | null = null; let text = "";
    const legacyText = legacyLocal && (responseType === "" || responseType === "text/plain");
    if (responseType !== "application/json" && !legacyText) throw new Error(`Invalid transcription response content type. ${asr.installHint}`);
    if (legacyText && /^<(?:!|\?|\/?[a-z][a-z0-9:-]*(?:\s|\/?>))/i.test(raw)) throw new Error(`Invalid transcription response content type. ${asr.installHint}`);
    if (responseType === "application/json" || (legacyText && raw.startsWith("{"))) {
      let parsed: unknown;
      try { parsed = JSON.parse(raw); }
      catch {
        if (!legacyText || /^\{\s*"(?:[^"\\]|\\.)*"\s*:/.test(raw)) throw new Error(`Invalid transcription response. ${asr.installHint}`);
        text = raw;
      }
      if (parsed !== undefined) {
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(`Invalid transcription response. ${asr.installHint}`);
        record = parsed as Record<string, unknown>; text = typeof record.text === "string" ? record.text : "";
      }
    } else text = raw;
    if (!text.trim()) throw new Error(`Empty transcription. ${asr.installHint}`);
    return { text: text.trim(), providerId: config.asrProvider, ...(record && typeof record.language === "string" ? { language: record.language } : {}), ...(record && typeof record.duration === "number" ? { durationSec: record.duration } : {}) };
  }
  async function health(preset: SpeechEnginePreset, endpoint: string, signal?: AbortSignal) {
    try {
      await prepare(preset, endpoint);
      if (preset.kind === "local") {
        const url = preset.id === "kokoro-local" ? new URL("/health", endpoint).href : `${endpoint.replace(/\/$/, "")}/health`;
        await request(preset, { url, signal });
      }
      const status: SpeechHealthStatus = preset.kind === "cloud" ? "unverified" : "verified";
      return { ok: true, status, providerId: preset.id, note: preset.kind === "cloud" ? "API key configured; connection not tested" : "Connected" };
    } catch (error) { return { ok: false, status: "failed" as const, providerId: preset.id, note: error instanceof Error ? error.message : String(error) }; }
  }
  async function checkAsrHealth(signal?: AbortSignal) {
    try {
      if (signal) signal.throwIfAborted();
      validateAsrConfig();
      if (openAiLocalAsr) { await prepare(asr, asrEndpoint); return { ok: false, status: "unverified" as const, providerId: config.asrProvider, note: "配置有效；转写服务连接和模型尚未验证" }; }
      const result = await health(asr, asrEndpoint, signal);
      return { ...result, status: result.ok && asr.kind === "local" ? ("unverified" as const) : result.status, providerId: config.asrProvider, note: result.ok && asr.kind === "local" ? "健康检查通过；转写能力未验证" : result.note };
    } catch (error) { return { ok: false, status: "failed" as const, providerId: config.asrProvider, note: error instanceof Error ? error.message : String(error) }; }
  }
  return { ttsEndpoint, asrEndpoint, ttsModel, asrModel, voice, synthesizeSpeech, transcribeAudio,
    checkTtsHealth: (signal?: AbortSignal) => health(tts, ttsEndpoint, signal).then(result => ({ ...result, providerId: config.ttsProvider })),
    checkAsrHealth };
}

export class PrefetchSpeechQueue {
  private pending: { index: number; text: string; controller: AbortController; result: Promise<{ audio: SpeechSynthesisAudio } | { error: unknown }>; cleanup: () => void } | null = null;
  private readonly synthesize: (text: string, signal?: AbortSignal) => Promise<SpeechSynthesisAudio>;
  constructor(synthesize: (text: string, signal?: AbortSignal) => Promise<SpeechSynthesisAudio>) { this.synthesize = synthesize; }
  cancel(): void { if (this.pending) { this.pending.controller.abort(); this.pending.cleanup(); this.pending = null; } }
  prefetch(index: number, text: string, signal?: AbortSignal): void {
    this.cancel(); if (signal && signal.aborted) return;
    const controller = new AbortController(); const cancel = () => controller.abort();
    if (signal) signal.addEventListener("abort", cancel, { once: true });
    const cleanup = () => { if (signal) signal.removeEventListener("abort", cancel); };
    const result = this.synthesize(text, controller.signal).then(audio => ({ audio }), error => ({ error })).finally(cleanup);
    this.pending = { index, text, controller, result, cleanup };
  }
  async get(index: number, text: string, signal?: AbortSignal): Promise<SpeechSynthesisAudio> {
    if (signal) signal.throwIfAborted();
    const pending = this.pending;
    if (!pending || pending.index !== index || pending.text !== text) { this.cancel(); return this.synthesize(text, signal); }
    this.pending = null;
    const abort = () => pending.controller.abort();
    if (signal) signal.addEventListener("abort", abort, { once: true });
    try {
      const result = await new Promise<Awaited<typeof pending.result>>((resolve, reject) => {
        const cancelled = () => reject(pending.controller.signal.reason);
        if (pending.controller.signal.aborted) { cancelled(); return; }
        pending.controller.signal.addEventListener("abort", cancelled, { once: true });
        pending.result.then(resolve, reject).finally(() => pending.controller.signal.removeEventListener("abort", cancelled));
      });
      if (signal) signal.throwIfAborted(); if ("error" in result) throw result.error; return result.audio;
    }
    finally { if (signal) signal.removeEventListener("abort", abort); pending.cleanup(); }
  }
  getAndPrefetch(index: number, sentences: readonly string[], signal?: AbortSignal): Promise<SpeechSynthesisAudio> {
    const current = sentences[index];
    if (current === undefined) return Promise.reject(new Error("Sentence not found"));
    const result = this.get(index, current, signal);
    const next = sentences[index + 1];
    if (next !== undefined) this.prefetch(index + 1, next, signal);
    return result;
  }
}
