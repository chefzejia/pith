export type SpeechMode = "local" | "cloud";
export type SpeechProfiles = Partial<Record<SpeechMode | "legacy", Record<string, string>>>;

export function migrateLegacySpeech(speech: Record<string, string>, version: unknown, profiles: unknown): Record<string, string> {
  if (version === undefined && profiles === undefined && speech.asrProvider === "openai-whisper" && speech.asrLoopbackUrl && isLoopbackSafe(speech.asrLoopbackUrl)) return { ...speech, asrLoopbackUrl: "" };
  return { ...speech };
}

export function speechMode(speech: Record<string, string>): SpeechMode | "legacy" {
  if (speech.ttsProvider === "azure-neural") return "legacy";
  const ttsCloud = speech.ttsProvider === "openai-tts";
  const asrCloud = speech.asrProvider === "openai-whisper";
  return ttsCloud !== asrCloud ? "legacy" : ttsCloud ? "cloud" : "local";
}

export function switchSpeechMode(speech: Record<string, string>, profiles: SpeechProfiles, mode: SpeechMode): { speech: Record<string, string>; profiles: SpeechProfiles } {
  const current = speechMode(speech);
  if (current === mode) return { speech: { ...speech }, profiles: { ...profiles } };
  const archived = { ...profiles, [current]: { ...speech } };
  const target = profiles[mode];
  return { profiles: archived, speech: target ? { ...target } : { ttsProvider: mode === "cloud" ? "openai-tts" : "kokoro-local", asrProvider: mode === "cloud" ? "openai-whisper" : "whisper-local" } };
}

export function validSpeechProfiles(value: unknown): value is SpeechProfiles {
  const keys = ["ttsProvider", "ttsEndpoint", "ttsModel", "ttsVoice", "azureRegion", "asrProvider", "asrLoopbackUrl", "asrModel"];
  return !!value && typeof value === "object" && !Array.isArray(value) && Object.entries(value).every(([mode, profile]) =>
    (mode === "local" || mode === "cloud" || mode === "legacy") && !!profile && typeof profile === "object" && !Array.isArray(profile) && Object.entries(profile).every(([key, item]) => keys.includes(key) && typeof item === "string"));
}
import { isLoopbackSafe } from "../../plugins/speech-service/index.ts";
