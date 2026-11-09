export interface SpeechVoice { id: string; sid: number; group: string }
export interface SpeechVoices { voices: SpeechVoice[]; defaultVoice: string }

export const ZIPVOICE_DIRECTORY = "sherpa-onnx-zipvoice-distill-int8-zh-en-emilia";
export const ZIPVOICE_PRESETS = [
  { id: "中文女声", sid: 0, group: "ZipVoice · 中英双语", file: "news-female.wav", text: "各位村民, 大家新年好! 近期, 湖北省武汉市等多个地区" },
  { id: "新闻女声", sid: 1, group: "ZipVoice · 中英双语", file: "news-female-2.wav", text: "本台消息, 中共中央国务院, 近日印发关于构建数据基础制度, 更好发挥数据要素作用的意见." },
] as const;

export function getSpeechVoices(): SpeechVoices {
  return { voices: ZIPVOICE_PRESETS.map(({ id, sid, group }) => ({ id, sid, group })), defaultVoice: ZIPVOICE_PRESETS[0].id };
}
