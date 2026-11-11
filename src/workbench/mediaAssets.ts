import type { MaterialFileEntry } from "../core/index.ts";

const AUDIO_TYPES: Readonly<Record<string, string>> = {
  mp3: "audio/mpeg", m4a: "audio/mp4", wav: "audio/wav", ogg: "audio/ogg", aac: "audio/aac", flac: "audio/flac",
};
const VIDEO_TYPES: Readonly<Record<string, string>> = { mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime" };

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

export function videoContentType(file: Pick<MaterialFileEntry, "name" | "mimeType">): string | null {
  if (isSourceTextFile(file.name) || /^audio\//i.test(file.mimeType)) return null;
  if (/^video\/[a-z0-9.+-]+$/i.test(file.mimeType)) return file.mimeType.toLowerCase();
  const extension = /\.([a-z0-9]+)$/i.exec(file.name);
  return extension ? VIDEO_TYPES[extension[1]!.toLowerCase()] ?? null : null;
}

export function resolveMediaPair<T extends { name: string; mimeType?: string }>(files: readonly T[], currentFile: string): { media: T | null; transcript: T | null } {
  const media = files.filter(file => audioContentType({ name: file.name, mimeType: file.mimeType ?? "" }) || videoContentType({ name: file.name, mimeType: file.mimeType ?? "" }));
  const subtitles = files.filter(file => /\.(?:vtt|srt)$/i.test(file.name));
  const stems = (name: string): string[] => {
    let stem = name.replace(/\.[^.]+$/, "").toLowerCase(); const result = [stem];
    while (/\.(?:auto|[a-z]{2,3}(?:-[a-z0-9]{2,8})*)$/i.test(stem)) { stem = stem.replace(/\.[^.]+$/, ""); result.push(stem); }
    return result;
  };
  const unique = (matches: readonly T[]): T | null => matches.length === 1 ? matches[0]! : null;
  const mediaForSubtitle = (subtitle: T): T | null => {
    for (const stem of stems(subtitle.name)) { const matches = media.filter(file => file.name.replace(/\.[^.]+$/, "").toLowerCase() === stem); if (matches.length) return unique(matches); }
    return null;
  };
  const currentMedia = media.find(file => file.name === currentFile);
  const currentSubtitle = subtitles.find(file => file.name === currentFile);
  if (currentSubtitle) return { media: mediaForSubtitle(currentSubtitle), transcript: currentSubtitle };
  if (currentMedia) {
    const stem = currentMedia.name.replace(/\.[^.]+$/, "").toLowerCase();
    const matches = subtitles.filter(file => mediaForSubtitle(file) === currentMedia).sort((a, b) => {
      const aName = a.name.toLowerCase(), bName = b.name.toLowerCase();
      const aExact = aName.replace(/\.[^.]+$/, "") === stem, bExact = bName.replace(/\.[^.]+$/, "") === stem;
      return Number(bExact) - Number(aExact) || (aName < bName ? -1 : aName > bName ? 1 : a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
    });
    return { media: currentMedia, transcript: matches[0] ?? null };
  }
  return { media: unique(media), transcript: null };
}
