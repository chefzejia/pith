import type { MaterialFileEntry } from "../core/index.ts";

const AUDIO_TYPES: Readonly<Record<string, string>> = {
  mp3: "audio/mpeg", m4a: "audio/mp4", wav: "audio/wav", ogg: "audio/ogg", aac: "audio/aac", flac: "audio/flac",
};

export function isSourceTextFile(name: string): boolean {
  return /\.(?:md|markdown|txt|ts|tsx|js|jsx|mjs|cjs|py|rs|go|java|c|h|cc|cpp|hpp|cs|swift|kt|json|jsonl|yaml|yml|toml|sh|bash|zsh|css|html|xml|sql|rb|php|lua|r|abc)$/i.test(name);
}

export function isMediaFile(file: { name: string; mimeType?: string }): boolean {
  return /\.(?:vtt|srt|mp3|m4a|wav|ogg|aac|flac|mp4|webm|mov)$/i.test(file.name) || (!isSourceTextFile(file.name) && /^(?:audio|video)\//i.test(file.mimeType || ""));
}

export function importedMaterialKind(files: readonly { name: string; mimeType?: string }[]): "media" | "book" | "article" {
  return files.some(isMediaFile) ? "media" : files.some(file => /\.(?:epub|pdf|cbz|png|jpe?g|gif|webp|avif)$/i.test(file.name)) ? "book" : "article";
}

export function audioContentType(file: Pick<MaterialFileEntry, "name" | "mimeType">): string | null {
  if (isSourceTextFile(file.name)) return null;
  if (/^audio\/[a-z0-9.+-]+$/i.test(file.mimeType)) return file.mimeType.toLowerCase();
  const extension = /\.([a-z0-9]+)$/i.exec(file.name);
  return extension ? AUDIO_TYPES[extension[1]!.toLowerCase()] ?? null : null;
}
