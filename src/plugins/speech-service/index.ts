import { registerPlugin, type CuratedAsrProviderId, type CuratedTtsProviderId, type HostPort, type ProseBlock, type SpeechSentenceSegment, type SpeechAsrService, type SpeechTtsService } from "../../core/index.ts";
import { createNeuralSpeech, CURATED_ASR_PRESETS, CURATED_TTS_PRESETS } from "./neuralSpeech.ts";
export { createNeuralSpeech, CURATED_ASR_PRESETS, CURATED_TTS_PRESETS, PrefetchSpeechQueue } from "./neuralSpeech.ts";

export function splitSentences(text: string): { text: string; offset: number }[] {
  const segmenter = new Intl.Segmenter(undefined, { granularity: "sentence" });
  return Array.from(segmenter.segment(text), segment => {
    const leading = segment.segment.length - segment.segment.trimStart().length;
    return { text: segment.segment.trim(), offset: segment.index + leading };
  }).filter(segment => segment.text.length > 0);
}

export function filterProseOnly(blocks: readonly ProseBlock[]): readonly SpeechSentenceSegment[] {
  return blocks.flatMap(block => block.isProse ? splitSentences(block.text).filter(segment => /[\p{L}\p{N}]/u.test(segment.text)).map(segment => ({ ...segment, blockIndex: block.index, locator: `${block.locator};offset:${segment.offset}` })) : []);
}

export type ReadAloudSession =
  | { readonly started: false; readonly reason: "not-prose"; readonly tip: "此处非正文段落，无法伴读" }
  | { readonly started: false; readonly reason: "not-found" | "empty" }
  | { readonly started: true; readonly sentences: readonly SpeechSentenceSegment[]; current(): SpeechSentenceSegment; next(): SpeechSentenceSegment | null; previous(): SpeechSentenceSegment | null; onLocatorChange(callback: (locator: string) => void): () => void };

export function createReadAloudSession(blocks: readonly ProseBlock[], startLocator?: string): ReadAloudSession {
  const sentences = filterProseOnly(blocks);
  let cursor = 0;
  if (startLocator !== undefined) {
    const match = /^(.*);offset:(\d+)$/.exec(startLocator);
    const locator = match ? match[1]! : startLocator;
    const block = blocks.find(item => item.locator === locator);
    if (block && !block.isProse) return { started: false, reason: "not-prose", tip: "此处非正文段落，无法伴读" };
    if (block) {
      const offset = match ? Number(match[2]) : 0;
      const candidates = sentences.map((sentence, index) => ({ sentence, index })).filter(item => item.sentence.blockIndex === block.index);
      if (candidates.length === 0) return { started: false, reason: "not-found" };
      cursor = candidates[0]!.index;
      for (const candidate of candidates) { if (candidate.sentence.offset <= offset) cursor = candidate.index; else break; }
    } else {
      cursor = sentences.findIndex(sentence => sentence.text.includes(startLocator));
      if (cursor < 0) {
        if (startLocator && blocks.some(item => !item.isProse && item.text.includes(startLocator))) return { started: false, reason: "not-prose", tip: "此处非正文段落，无法伴读" };
        return { started: false, reason: "not-found" };
      }
    }
  }
  if (sentences.length === 0) return { started: false, reason: "empty" };
  const listeners = new Set<(locator: string) => void>();
  const move = (next: number): SpeechSentenceSegment | null => {
    if (next < 0 || next >= sentences.length) return null;
    cursor = next;
    const sentence = sentences[cursor]!;
    for (const listener of listeners) listener(sentence.locator!);
    return sentence;
  };
  return { started: true, sentences, current: () => sentences[cursor]!, next: () => move(cursor + 1), previous: () => move(cursor - 1), onLocatorChange(callback) { listeners.add(callback); callback(sentences[cursor]!.locator!); return () => { listeners.delete(callback); }; } };
}

export function isLoopbackSafe(value: string): boolean {
  try {
    const match = /^https?:\/\/(localhost|127(?:\.\d{1,3}){3}|\[::1\])(?::\d{1,5})?(?:\/[^?#\x00-\x20\x7f]*)?$/i.exec(value);
    if (!match) return false;
    if (match[1]!.startsWith("127.") && !match[1]!.split(".").every(part => /^(?:0|[1-9]\d{0,2})$/.test(part) && Number(part) <= 255)) return false;
    const url = new URL(value);
    if (url.username || url.password || url.search || url.hash) return false;
    if (url.hostname === "localhost" || url.hostname === "[::1]") return true;
    const parts = url.hostname.split(".");
    return parts.length === 4 && parts[0] === "127" && parts.every(part => /^(?:0|[1-9]\d{0,2})$/.test(part) && Number(part) <= 255);
  } catch { return false; }
}

registerPlugin({
  id: "speech-service",
  api: "^1",
  requires: ["host"],
  provides: ["speech.tts", "speech.asr"],
  essential: false,
  name: "Speech Read-Aloud & ASR",
  description: "Chapter-level continuous read-aloud (TTS) and loopback Whisper transcription (ASR)",
  parts: [{ slot: "toolbar", key: "read-aloud" }],
  settings: {
    ttsProvider: { type: "string", title: "TTS provider", default: "kokoro-local", enum: ["openai-compatible-local", "kokoro-local", "openai-tts", "azure-neural"] },
    ttsEndpoint: { type: "string", title: "TTS endpoint", default: "" },
    ttsModel: { type: "string", title: "TTS model", default: "" },
    ttsVoice: { type: "string", title: "TTS voice", default: "" },
    azureRegion: { type: "string", title: "Azure region", default: "" },
    asrProvider: { type: "string", title: "ASR provider", default: "whisper-local", enum: ["whisper-local", "sensevoice-local", "openai-whisper"] },
    asrModel: { type: "string", title: "ASR model", default: "" },
    rate: {
      type: "number",
      title: "Playback speed",
      default: 1,
      minimum: 0.5,
      maximum: 2,
    },
    asrLoopbackUrl: {
      type: "string",
      title: "Local Whisper loopback URL",
      default: "http://localhost:8765",
    },
  },
  apply(ctx) {
    const rate = ctx.config["rate"];
    const url = ctx.config["asrLoopbackUrl"];
    if (typeof rate !== "number" || typeof url !== "string" || !isLoopbackSafe(url)) throw new Error("Unsafe speech configuration");
    const ttsProvider = ctx.config["ttsProvider"] as CuratedTtsProviderId;
    const asrProvider = ctx.config["asrProvider"] as CuratedAsrProviderId;
    const neural = createNeuralSpeech(ctx.service<HostPort>("host"), { rate, asrLoopbackUrl: url, ttsProvider, asrProvider, ttsEndpoint: String(ctx.config["ttsEndpoint"] ?? ""), ttsModel: String(ctx.config["ttsModel"] ?? ""), ttsVoice: String(ctx.config["ttsVoice"] ?? ""), azureRegion: String(ctx.config["azureRegion"] ?? ""), asrModel: String(ctx.config["asrModel"] ?? "") }, isLoopbackSafe);
    const tts: SpeechTtsService & { createReadAloudSession: typeof createReadAloudSession } = { rate, splitSentences, filterProseOnly, createReadAloudSession, providerId: ttsProvider, endpoint: neural.ttsEndpoint, model: neural.ttsModel, voice: neural.voice, listPresets: () => CURATED_TTS_PRESETS, checkHealth: neural.checkTtsHealth, synthesizeSpeech: neural.synthesizeSpeech };
    const asr: SpeechAsrService = { url: neural.asrEndpoint, model: neural.asrModel, providerId: asrProvider, isLoopbackSafe, listPresets: () => CURATED_ASR_PRESETS, checkHealth: neural.checkAsrHealth, transcribeAudio: neural.transcribeAudio };
    ctx.provide("speech.tts", tts);
    ctx.provide("speech.asr", asr);
  },
});
