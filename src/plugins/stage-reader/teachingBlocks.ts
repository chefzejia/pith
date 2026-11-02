import type { TeachingBlockSpec } from "../../core/index.ts";

type TeachingKind = TeachingBlockSpec["kind"];
export interface TeachingBlockRange { readonly spec: TeachingBlockSpec; readonly start: number; readonly end: number }

function isKind(value: unknown): value is TeachingKind {
  return value === "reflection" || value === "hint" || value === "checkpoint" || value === "explanation";
}

function fenceSpec(lines: readonly string[], start: number, end: number, header: string): TeachingBlockSpec {
  const match = /^\s*(reflection|hint|checkpoint|explanation)(?:\s+(.+))?\s*$/i.exec(header);
  let kind: TeachingKind = match && isKind(match[1]!.toLowerCase()) ? match[1]!.toLowerCase() as TeachingKind : "explanation";
  let title = match?.[2]?.trim() ?? "";
  let body = lines.slice(start + 1, end).join("\n").trim();
  if (body.startsWith("{")) {
    try {
      const payload: unknown = JSON.parse(body);
      if (payload && typeof payload === "object" && !Array.isArray(payload)) {
        const object = payload as Record<string, unknown>;
        if (isKind(object.kind)) kind = object.kind;
        if (typeof object.title === "string") title = object.title;
        if (typeof object.body === "string") body = object.body;
      }
    } catch { /* Plain teaching text may begin with a brace. */ }
  } else {
    const parts = body.split("\n");
    let consumed = 0;
    for (const line of parts) {
      const field = /^(kind|title):\s*(.*?)\s*$/.exec(line);
      if (!field) break;
      if (field[1] === "kind" && isKind(field[2])) kind = field[2];
      if (field[1] === "title") title = field[2]!;
      consumed++;
    }
    if (consumed) body = parts.slice(consumed).join("\n").trim();
  }
  return { id: `teaching-line-${start}`, kind, title: title || kind, body, locator: `text:line:${start}` };
}

export function teachingBlockRanges(markdown: string): TeachingBlockRange[] {
  const lines = markdown.split(/\r?\n/);
  const ranges: TeachingBlockRange[] = [];
  let i = 0;
  if (lines[0]?.trim() === "---") {
    const end = lines.findIndex((line, n) => n > 0 && /^(---|\.\.\.)\s*$/.test(line));
    if (end >= 0) i = end + 1;
  }
  while (i < lines.length) {
    const line = lines[i]!;
    if (/^ {4}|^\t/.test(line)) { i++; continue; }
    if (/^\s*\$\$/.test(line)) {
      i++;
      if (!/^\s*\$\$.+\$\$\s*$/.test(line)) {
        while (i < lines.length && !/^\s*\$\$\s*$/.test(lines[i]!)) i++;
        if (i < lines.length) i++;
      }
      continue;
    }
    const fence = /^\s{0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (fence) {
      const start = i++;
      const close = new RegExp(`^\\s{0,3}${fence[1]![0]}{${fence[1]!.length},}\\s*$`);
      while (i < lines.length && !close.test(lines[i]!)) i++;
      const end = i;
      const teaching = /^\s*(?:pith|garden)-teaching(?:\s+(.*))?\s*$/i.exec(fence[2]!);
      if (teaching && end < lines.length) ranges.push({ start, end: end + 1, spec: fenceSpec(lines, start, end, teaching[1] ?? "") });
      if (i < lines.length) i++;
      continue;
    }
    const callout = /^\s{0,3}>\s*\[!(reflection|hint|checkpoint|explanation)\][+-]?\s*(.*)$/i.exec(line);
    if (callout) {
      const start = i++;
      const body: string[] = [];
      while (i < lines.length) {
        const quoted = /^\s{0,3}>\s?(.*)$/.exec(lines[i]!);
        if (!quoted) break;
        body.push(quoted[1]!);
        i++;
      }
      const kind = callout[1]!.toLowerCase() as TeachingKind;
      ranges.push({ start, end: i, spec: { id: `teaching-line-${start}`, kind, title: callout[2]!.trim() || kind, body: body.join("\n").trim(), locator: `text:line:${start}` } });
      continue;
    }
    i++;
  }
  return ranges;
}

export function extractTeachingBlocks(markdown: string): readonly TeachingBlockSpec[] {
  return teachingBlockRanges(markdown).map(range => range.spec);
}
