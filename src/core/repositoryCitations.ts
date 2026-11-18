export interface CitationSource {
  readonly id: string;
  readonly files: readonly { readonly name: string }[];
}

export function repositoryCitations<T extends CitationSource>(texts: readonly string[], sources: readonly T[]) {
  const paths = new Map<string, T[]>();
  for (const source of sources) for (const { name } of source.files) {
    const matches = paths.get(name) ?? [];
    matches.push(source); paths.set(name, matches);
  }
  const boundary = /[\p{L}\p{N}_./-]/u;
  const maxLength = [...paths.keys()].reduce((max, path) => Math.max(max, path.length), 0);
  return texts.map(text => {
    const citations: { start: number; end: number; path: string; line: number; sources: readonly T[] }[] = [];
    if (!maxLength) return citations;
    let offset = 0;
    for (const match of text.matchAll(/:(\d+)/g)) {
      const line = Number(match[1]);
      if (!Number.isSafeInteger(line) || line < 1) continue;
      const colon = match.index, end = colon + match[0].length;
      for (let start = Math.max(offset, colon - maxLength); start < colon; start++) {
        const path = text.slice(start, colon), candidates = paths.get(path);
        if (!candidates || boundary.test([...text.slice(Math.max(0, start - 2), start)].at(-1) ?? "")) continue;
        citations.push({ start, end, path, line, sources: candidates });
        offset = end;
        break;
      }
    }
    return citations;
  });
}
