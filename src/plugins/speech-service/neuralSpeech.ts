import type { AsrTranscriptionResult, CuratedAsrProviderId, CuratedTtsProviderId, HostPort, SpeechEnginePreset, SpeechSynthesisAudio } from "../../core/index.ts";

export const CURATED_TTS_PRESETS: readonly SpeechEnginePreset<CuratedTtsProviderId>[] = [
  { id: "kokoro-local", label: "Kokoro-82M (本机开源引擎)", kind: "local", defaultEndpoint: "http://127.0.0.1:8880/v1/audio/speech", defaultVoice: "af_heart", installHint: "在终端运行 Kokoro OpenAI 兼容服务（如 docker run -p 8880:8880 ghcr.io/remsky/kokoro-fastapi-cpu:latest 或 mlx-audio）" },
  { id: "openai-tts", label: "OpenAI gpt-4o-mini-tts (云端)", kind: "cloud", defaultEndpoint: "https://api.openai.com/v1/audio/speech", defaultVoice: "alloy", installHint: "需配置 OPENAI_API_KEY" },
  { id: "azure-neural", label: "Azure Neural TTS (微软神经网络音色)", kind: "cloud", defaultEndpoint: "https://{region}.tts.speech.microsoft.com/cognitiveservices/v1", defaultVoice: "zh-CN-XiaoxiaoNeural", installHint: "需配置 AZURE_SPEECH_KEY 与区域" },
];
export const CURATED_ASR_PRESETS: readonly SpeechEnginePreset<CuratedAsrProviderId>[] = [
  { id: "whisper-local", label: "MLX / Faster Whisper (本机回环)", kind: "local", defaultEndpoint: "http://localhost:8765", installHint: "在本机启动 Whisper 回环服务监听 8765 端口" },
  { id: "sensevoice-local", label: "SenseVoice-Small (本机极速多语种)", kind: "local", defaultEndpoint: "http://127.0.0.1:8766", installHint: "在本机启动 SenseVoice HTTP 服务监听 8766 端口" },
  { id: "openai-whisper", label: "Whisper-large-v3-turbo (云端 API)", kind: "cloud", defaultEndpoint: "https://api.openai.com/v1/audio/transcriptions", installHint: "需配置 OPENAI_API_KEY" },
];

export interface NeuralSpeechConfig {
  readonly ttsProvider: CuratedTtsProviderId; readonly ttsEndpoint: string; readonly ttsVoice: string;
  readonly azureRegion: string; readonly asrProvider: CuratedAsrProviderId; readonly asrLoopbackUrl: string; readonly rate: number;
}
const xml = (text: string): string => text.replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[ch]!);
const header = (headers: Readonly<Record<string, string>>, name: string): string => Object.entries(headers).find(([key]) => key.toLowerCase() === name)?.[1] ?? "";

export function createNeuralSpeech(host: HostPort | undefined, config: NeuralSpeechConfig, isLoopbackSafe: (url: string) => boolean) {
  const ttsPreset = CURATED_TTS_PRESETS.find(p => p.id === config.ttsProvider);
  const asrPreset = CURATED_ASR_PRESETS.find(p => p.id === config.asrProvider);
  if (!ttsPreset || !asrPreset) throw new Error("Invalid speech provider");
  const tts = ttsPreset; const asr = asrPreset;
  const ttsEndpoint = config.ttsEndpoint || (tts.id === "azure-neural" ? tts.defaultEndpoint.replace("{region}", config.azureRegion) : tts.defaultEndpoint);
  const asrEndpoint = asr.id === "whisper-local" ? config.asrLoopbackUrl : asr.defaultEndpoint;
  const voice = config.ttsVoice || tts.defaultVoice!;
  async function prepare(preset: SpeechEnginePreset, endpoint: string): Promise<string> {
    if (!host || !host.http) throw new Error(`HTTP unavailable. ${preset.installHint}`);
    if (preset.kind === "local") {
      if (!isLoopbackSafe(endpoint)) throw new Error(`Unsafe local endpoint. ${preset.installHint}`);
      return "";
    }
    const expected = preset.id === "azure-neural" ? /^https:\/\/[a-z0-9-]+\.tts\.speech\.microsoft\.com\/cognitiveservices\/v1$/ : /^https:\/\/api\.openai\.com\/v1\/audio\/(?:speech|transcriptions)$/;
    if (!expected.test(endpoint)) throw new Error(`Unsafe cloud endpoint. ${preset.installHint}`);
    const secret = host.secrets ? await host.secrets.getSecret(preset.id === "azure-neural" ? "AZURE_SPEECH_KEY" : "OPENAI_API_KEY") : null;
    if (!secret || !secret.trim()) throw new Error(`Missing API key. ${preset.installHint}`);
    return secret;
  }
  async function request(preset: SpeechEnginePreset, spec: Parameters<NonNullable<HostPort["http"]>["request"]>[0]) {
    try {
      const response = await host!.http!.request(spec);
      if (response.status < 200 || response.status >= 300) throw new Error(`HTTP ${response.status}`);
      return response;
    } catch (error) {
      if (spec.signal && spec.signal.aborted) spec.signal.throwIfAborted();
      throw new Error(`Speech request failed: ${error instanceof Error ? error.message : String(error)}. ${preset.installHint}`);
    }
  }
  async function synthesizeSpeech(text: string, signal?: AbortSignal): Promise<SpeechSynthesisAudio> {
    if (!text.trim()) throw new Error(`Empty speech text. ${tts.installHint}`);
    const key = await prepare(tts, ttsEndpoint);
    const azure = tts.id === "azure-neural";
    const language = /^([a-z]{2,3}-[a-z]{2})-/i.exec(voice);
    if (azure && (!language || !/^[a-z0-9-]+$/i.test(voice))) throw new Error(`Invalid Azure voice. ${tts.installHint}`);
    const response = await request(tts, { url: ttsEndpoint, method: "POST", signal, headers: azure
      ? { "Content-Type": "application/ssml+xml", "Ocp-Apim-Subscription-Key": key, "X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3" }
      : { "Content-Type": "application/json", ...(key ? { Authorization: `Bearer ${key}` } : {}) },
      body: azure ? `<speak version="1.0" xml:lang="${language![1]}"><voice name="${xml(voice)}"><prosody rate="${Math.round((config.rate - 1) * 100)}%">${xml(text)}</prosody></voice></speak>` : JSON.stringify({ model: tts.id === "kokoro-local" ? "kokoro" : "gpt-4o-mini-tts", input: text, voice, response_format: "mp3", speed: config.rate }) });
    if (!response.bytes.byteLength) throw new Error(`Empty audio response. ${tts.installHint}`);
    return { bytes: response.bytes, mimeType: header(response.headers, "content-type").split(";")[0] || "audio/mpeg", providerId: config.ttsProvider };
  }
  async function transcribeAudio(bytes: Uint8Array, mimeType = "audio/webm", signal?: AbortSignal): Promise<AsrTranscriptionResult> {
    if (!bytes.byteLength) throw new Error(`Empty audio. ${asr.installHint}`);
    if (!/^audio\/[a-z0-9.+-]+$/i.test(mimeType)) throw new Error(`Invalid audio MIME type. ${asr.installHint}`);
    const key = await prepare(asr, asrEndpoint);
    let body: Uint8Array = bytes; let contentType = mimeType;
    if (asr.kind === "cloud") {
      const boundary = `pith-${crypto.randomUUID()}`;
      const encode = new TextEncoder();
      const prefix = encode.encode(`--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\nwhisper-1\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="audio.webm"\r\nContent-Type: ${mimeType}\r\n\r\n`);
      const suffix = encode.encode(`\r\n--${boundary}--\r\n`);
      body = new Uint8Array(prefix.length + bytes.length + suffix.length); body.set(prefix); body.set(bytes, prefix.length); body.set(suffix, prefix.length + bytes.length);
      contentType = `multipart/form-data; boundary=${boundary}`;
    }
    const response = await request(asr, { url: asr.kind === "local" ? `${asrEndpoint.replace(/\/$/, "")}/transcribe` : asrEndpoint, method: "POST", headers: { "Content-Type": contentType, ...(key ? { Authorization: `Bearer ${key}` } : {}) }, body, signal });
    const raw = response.text().trim(); let result: unknown = raw;
    if (header(response.headers, "content-type").includes("json") || raw.startsWith("{")) { try { result = JSON.parse(raw); } catch { throw new Error(`Invalid transcription response. ${asr.installHint}`); } }
    const record = result && typeof result === "object" ? result as Record<string, unknown> : null;
    const text = typeof result === "string" ? result : record && typeof record.text === "string" ? record.text : "";
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
      return { ok: true, providerId: preset.id, note: preset.kind === "cloud" ? "API key configured; connection not tested" : "Connected" };
    } catch (error) { return { ok: false, providerId: preset.id, note: error instanceof Error ? error.message : String(error) }; }
  }
  return { ttsEndpoint, asrEndpoint, voice, synthesizeSpeech, transcribeAudio,
    checkTtsHealth: (signal?: AbortSignal) => health(tts, ttsEndpoint, signal).then(result => ({ ...result, providerId: config.ttsProvider })),
    checkAsrHealth: (signal?: AbortSignal) => health(asr, asrEndpoint, signal).then(result => ({ ...result, providerId: config.asrProvider })) };
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
