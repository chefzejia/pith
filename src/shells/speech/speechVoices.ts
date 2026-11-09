import { open } from "node:fs/promises";

export interface SpeechVoice { id: string; sid: number; group: string }
export interface SpeechVoices { voices: SpeechVoice[]; defaultVoice: string }

export async function readSpeechVoices(path: string, openFile: typeof open = open): Promise<SpeechVoices> {
  const file = await openFile(path, "r");
  try {
    const size = (await file.stat()).size;
    const read = async (position: number, length: number): Promise<Uint8Array> => {
      if (!Number.isSafeInteger(position) || !Number.isSafeInteger(length) || position < 0 || length < 0 || position + length > size) throw new Error("语音模型元数据截断");
      const data = new Uint8Array(length); let done = 0;
      while (done < length) { const result = await file.read(data, done, length - done, position + done); if (!result.bytesRead) throw new Error("语音模型元数据截断"); done += result.bytesRead; }
      return data;
    };
    let offset = 0;
    const varint = async () => { let value = 0, factor = 1; for (let i = 0; i < 10; i++) { const byte = (await read(offset++, 1))[0]!; value += (byte & 127) * factor; if (!Number.isSafeInteger(value)) throw new Error("无效的模型元数据长度"); if (!(byte & 128)) return value; factor *= 128; } throw new Error("无效的模型元数据编码"); };
    const metadata = new Map<string, string>();
    while (offset < size) {
      const tag = await varint(), field = Math.floor(tag / 8), wire = tag % 8;
      if (!field) throw new Error("无效的模型元数据字段");
      if (wire === 0) { await varint(); continue; }
      if (wire === 1 || wire === 5) { offset += wire === 1 ? 8 : 4; if (offset > size) throw new Error("语音模型元数据截断"); continue; }
      if (wire !== 2) throw new Error("不支持的模型元数据编码");
      const length = await varint(), end = offset + length;
      if (!Number.isSafeInteger(end) || end > size) throw new Error("语音模型元数据截断");
      if (field === 14) {
        if (length > 1048576) throw new Error("模型元数据过大");
        const bytes = await read(offset, length); let pos = 0;
        const number = () => { let value = 0, factor = 1; for (let i = 0; i < 10; i++) { if (pos >= bytes.length) throw new Error("语音模型元数据截断"); const byte = bytes[pos++]!; value += (byte & 127) * factor; if (!Number.isSafeInteger(value)) throw new Error("无效的模型元数据长度"); if (!(byte & 128)) return value; factor *= 128; } throw new Error("无效的模型元数据编码"); };
        const fields = new Map<number, string>();
        while (pos < bytes.length) { const key = number(), fieldNumber = Math.floor(key / 8); if (!fieldNumber || key % 8 !== 2) throw new Error("无效的模型元数据项"); const count = number(); if (count > bytes.length - pos || fields.has(fieldNumber)) throw new Error("无效的模型元数据项"); fields.set(fieldNumber, new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(pos, pos + count))); pos += count; }
        const key = fields.get(1), value = fields.get(2); if (key === undefined || value === undefined || metadata.has(key)) throw new Error("无效的模型元数据项"); metadata.set(key, value);
      }
      offset = end;
    }
    const names = metadata.get("speaker_names"), mapping = metadata.get("speaker2id");
    if (!names || !mapping) throw new Error("模型缺少音色元数据");
    const entries = mapping.split(",").map(entry => { const match = /^([a-zA-Z0-9_]+)->(\d+)$/.exec(entry.trim()); if (!match) throw new Error("无效的音色映射"); return { id: match[1]!, sid: Number(match[2]) }; });
    const orderedNames = names.split(",").map(name => name.trim());
    if (!entries.length || entries.length !== orderedNames.length || new Set(entries.map(item => item.id)).size !== entries.length || new Set(entries.map(item => item.sid)).size !== entries.length || entries.some(item => !Number.isSafeInteger(item.sid) || item.sid < 0 || item.sid >= entries.length || orderedNames[item.sid] !== item.id) || !orderedNames[48]) throw new Error("模型音色列表与映射不一致");
    const voices = entries.sort((a, b) => a.sid - b.sid).map(item => ({ ...item, group: item.id.startsWith("zf_") ? "中文女声 (zf)" : item.id.startsWith("zm_") ? "中文男声 (zm)" : /^(?:af|am|bf|bm)_/.test(item.id) ? "英文音色 (af/bf)" : "其他音色" }));
    return { voices, defaultVoice: orderedNames[48]! };
  } finally { await file.close(); }
}
