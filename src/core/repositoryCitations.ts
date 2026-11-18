export type CitationPosition = "page" | "time";

export interface CitationSource {
  readonly id: string;
  readonly files: readonly { readonly name: string; readonly position?: CitationPosition }[];
}

export function repositoryCitations<T extends CitationSource>(texts: readonly string[], sources: readonly T[], bound?: (source: T, path: string) => number | undefined) {
  const paths = new Map<string, { source: T; position?: CitationPosition }[]>();
  for (const source of sources) for (const { name, position } of source.files) {
    const matches = paths.get(name) ?? [];
    matches.push({ source, position }); paths.set(name, matches);
  }
  const boundary = /[\p{L}\p{N}_./-]/u;
  const maxLength = [...paths.keys()].reduce((max, path) => Math.max(max, path.length), 0);
  return texts.map(text => {
    const citations: { start: number; end: number; path: string; line?: number; locator?: string; ambiguous: boolean; sources: readonly T[] }[] = [];
    if (!maxLength) return citations;
    let offset = 0;
    for (const match of text.matchAll(/#(page|t)=(\d+(?::\d+)?(?:\.\d+)?)|:(\d+)/g)) {
      const position = match[1] === "page" ? "page" : match[1] === "t" ? "time" : undefined;
      const token = (match[2] ?? match[3])!;
      const minutes = /^(\d+):([0-5]\d(?:\.\d+)?)$/.exec(token);
      const value = position === "time" && minutes ? Number(minutes[1]) * 60 + Number(minutes[2]) : Number(token);
      if (position === "time" ? !Number.isSafeInteger(Math.trunc(value)) || value < 0 : !/^\d+$/.test(token) || !Number.isSafeInteger(value) || value < 1) continue;
      const colon = match.index, end = colon + match[0].length;
      if (position && /^(?:[\p{L}\p{N}_/:#=+-]|\.[\p{L}\p{N}.])/u.test(text.slice(end))) continue;
      for (let start = Math.max(offset, colon - maxLength); start < colon; start++) {
        const path = text.slice(start, colon), candidates = paths.get(path)?.filter(item => item.position === position);
        if (!candidates?.length || boundary.test([...text.slice(Math.max(0, start - 2), start)].at(-1) ?? "")) continue;
        const resolved = candidates.map(item => item.source).filter(source => !position || !bound || value <= (bound(source, path) ?? -1));
        if (resolved.length) citations.push({ start, end, path, ...(position ? { locator: `${position}:${value}` } : { line: value }), ambiguous: candidates.length > 1, sources: resolved });
        offset = end;
        break;
      }
    }
    return citations;
  });
}
