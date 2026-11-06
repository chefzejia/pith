import type { MaterialFileEntry } from "../../core/index.ts";

const AUDIO_TYPES: Readonly<Record<string, string>> = {
  mp3: "audio/mpeg", m4a: "audio/mp4", wav: "audio/wav", ogg: "audio/ogg", aac: "audio/aac", flac: "audio/flac",
};

export function audioContentType(file: Pick<MaterialFileEntry, "name" | "mimeType">): string | null {
  if (/^audio\/[a-z0-9.+-]+$/i.test(file.mimeType)) return file.mimeType.toLowerCase();
  const extension = /\.([a-z0-9]+)$/i.exec(file.name);
  return extension ? AUDIO_TYPES[extension[1]!.toLowerCase()] ?? null : null;
}
