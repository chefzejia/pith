import { registerPlugin, type Material, type MaterialFileEntry, type ProseBlock, type ReaderSectionHeading, type RenderedDocumentView, type StageReaderService } from "../../core/index.ts";
import { renderEpub } from "./epub.ts";
import { renderCbz, renderImage, renderPdf } from "./fixedPage.ts";
import { computePagination, resolveResponsiveLayout } from "./pagination.ts";
import { extractTeachingBlocks, teachingBlockRanges } from "./teachingBlocks.ts";
import { matchTextAnchor } from "./textAnchor.ts";
import type { TeachingBlockSpec } from "../../core/index.ts";

export { computePagination, resolveResponsiveLayout, extractTeachingBlocks, matchTextAnchor };
export { installReaderFont, READER_SANS_STACK, READER_SERIF_STACK } from "./fontData.ts";

export function readerInUse(materials: readonly Material[]): number {
  return materials.filter(material => material.kind === "book" || material.kind === "article").length;
}

const escape = (text: string): string => text.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
const inline = (text: string): string => {
  const source = text.replace(/\$(?:\\rightarrow|\\to)\$/g, "→");
  const pattern = /`([^`]+)`|\[([^\]]+)\]\(([^\s)]+)\)|\*\*([^*]+)\*\*|\*([^*]+)\*/g;
  let result = "", offset = 0;
  for (const match of source.matchAll(pattern)) {
    result += escape(source.slice(offset, match.index));
    if (match[1] !== undefined) result += `<code>${escape(match[1])}</code>`;
    else if (match[2] !== undefined && match[3] !== undefined) {
      const label = escape(match[2]), url = match[3];
      result += /^https?:\/\//i.test(url) ? `<a href="${escape(url)}" target="_blank" rel="noopener noreferrer">${label}</a>` : label;
    } else if (match[4] !== undefined) result += `<strong>${escape(match[4])}</strong>`;
    else result += `<em>${escape(match[5]!)}</em>`;
    offset = match.index + match[0].length;
  }
  return result + escape(source.slice(offset));
};

interface MarkdownBlock extends ProseBlock { kind: "heading" | "quote" | "paragraph" | "list" | "code" | "table" | "meta" | "rule" | "math" | "teaching"; level?: number; display?: string; ordered?: boolean; start?: number; teaching?: TeachingBlockSpec }

function markdownBlocks(markdown: string): MarkdownBlock[] {
  const lines = markdown.split(/\r?\n/);
  const blocks: MarkdownBlock[] = [];
  const teaching = new Map(teachingBlockRanges(markdown).map(range => [range.start, range]));
  const add = (line: number, text: string, kind: MarkdownBlock["kind"], isProse: boolean, level?: number, display?: string) => {
    blocks.push({ index: blocks.length, locator: `text:line:${line}`, text, isProse, kind, level, display });
  };
  let i = 0;
  if (lines[0]?.trim() === "---") {
    const end = lines.findIndex((line, n) => n > 0 && /^(---|\.\.\.)\s*$/.test(line));
    if (end >= 0) { add(0, lines.slice(0, end + 1).join("\n"), "meta", false); i = end + 1; }
  }
  while (i < lines.length) {
    const line = lines[i]!;
    if (!line.trim()) { i++; continue; }
    const range = teaching.get(i);
    if (range) {
      blocks.push({ index: blocks.length, locator: range.spec.locator, text: lines.slice(i, range.end).join("\n"), isProse: false, kind: "teaching", teaching: range.spec });
      i = range.end;
      continue;
    }
    const quotedFence = /^((?: {0,3}> ?)+)(`{3,}|~{3,})/.exec(line);
    if (quotedFence) {
      const start = i++, depth = (quotedFence[1]!.match(/>/g) ?? []).length, marker = quotedFence[2]!, body: string[] = [];
      while (i < lines.length) {
        let text = lines[i]!, prefixes = 0;
        while (prefixes < depth) { const prefix = /^ {0,3}> ?/.exec(text); if (!prefix) break; text = text.slice(prefix[0].length); prefixes++; }
        if (prefixes !== depth) break;
        i++;
        if (new RegExp(`^\\s{0,3}${marker[0]}{${marker.length},}\\s*$`).test(text)) break;
        body.push(text);
      }
      add(start, lines.slice(start, i).join("\n"), "code", false, depth, body.join("\n")); continue;
    }
    const fence = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (fence) {
      const start = i++;
      while (i < lines.length && !new RegExp(`^\\s{0,3}${fence[1]![0]}{${fence[1]!.length},}\\s*$`).test(lines[i]!)) i++;
      const body = lines.slice(start + 1, i).join("\n"); if (i < lines.length) i++;
      add(start, lines.slice(start, i).join("\n"), "code", false, undefined, body); continue;
    }
    if (/^\s*\$\$/.test(line)) {
      const start = i++;
      if (!/^\s*\$\$.+\$\$\s*$/.test(line)) { while (i < lines.length && !/^\s*\$\$\s*$/.test(lines[i]!)) i++; if (i < lines.length) i++; }
      add(start, lines.slice(start, i).join("\n"), "math", false); continue;
    }
    const listItem = /^( *)([-+*]|\d+[.)])\s+(.+)$/.exec(line);
    if (listItem && (listItem[1]!.length < 4 || (blocks.at(-1)?.kind === "list" && blocks.at(-1)?.locator === `text:line:${i - 1}`))) {
      const text = listItem[3]!, clean = text.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/[`*_~]/g, "").trim();
      const ordered = /^\d/.test(listItem[2]!);
      blocks.push({ index: blocks.length, locator: `text:line:${i++}`, text: clean, isProse: /[\p{L}\p{N}]/u.test(clean), kind: "list", level: listItem[1]!.length, ordered, ...(ordered ? { start: Number.parseInt(listItem[2]!, 10) } : {}), display: text });
      continue;
    }
    if (/^ {4}|^\t/.test(line)) {
      const start = i++;
      while (i < lines.length && /^( {4}|\t)/.test(lines[i]!)) i++;
      add(start, lines.slice(start, i).join("\n"), "code", false); continue;
    }
    const tableDivider = /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/;
    if (line.includes("|") && i + 1 < lines.length && tableDivider.test(lines[i + 1]!)) {
      const start = i; i += 2;
      while (i < lines.length && lines[i]!.trim() && lines[i]!.includes("|")) i++;
      add(start, lines.slice(start, i).join("\n"), "table", false); continue;
    }
    if (/^\s{0,3}(?:(?:\*\s*){3,}|(?:-\s*){3,}|(?:_\s*){3,})$/.test(line) || tableDivider.test(line)) { add(i++, line, "rule", false); continue; }
    const heading = /^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading) { add(i++, heading[2]!, "heading", true, heading[1]!.length); continue; }
    const quote = /^((?: {0,3}> ?)+)(.*)$/.exec(line);
    const list = /^\s*(?:[-+*]|\d+[.)])\s+(.+)$/.exec(line);
    const text = quote ? quote[2]! : list ? list[1]! : line.trim();
    const clean = text.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/[`*_~]/g, "").trim();
    const isProse = /[\p{L}\p{N}]/u.test(clean) && !/^\s*\$.*\$\s*$/.test(text) && !/^\s*<[^>]+>/.test(text);
    add(i++, clean, quote ? "quote" : "paragraph", isProse, quote ? (quote[1]!.match(/>/g) ?? []).length : undefined, text);
  }
  return blocks;
}

export function extractProseBlocks(markdown: string): readonly ProseBlock[] { return markdownBlocks(markdown); }

export function markdownSections(markdown: string): ReaderSectionHeading[] {
  return markdownBlocks(markdown).filter(block => block.kind === "heading").map(block => ({ title: block.text, level: block.level!, line: Number(block.locator.slice(10)), locator: block.locator }));
}

function renderTableHtml(rawTable: string, attrs: string): string {
  const rows = rawTable.split(/\r?\n/).filter((line) => line.trim());
  const parseCells = (line: string): string[] =>
    line
      .trim()
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((cell) => inline(cell.trim()));
  if (rows.length < 2) return `<pre ${attrs}><code>${escape(rawTable)}</code></pre>`;
  const headCells = parseCells(rows[0]!);
  const bodyRows = rows.slice(2).map(parseCells);
  return `<table ${attrs}><thead><tr>${headCells.map((c) => `<th>${c}</th>`).join("")}</tr></thead><tbody>${bodyRows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
}

export function renderMarkdown(markdown: string): string {
  const blocks = markdownBlocks(markdown), output: string[] = [], lists: { indent: number; tag: "ol" | "ul" }[] = [];
  const closeList = () => { const list = lists.pop()!; output.push(`</li></${list.tag}>`); };
  for (const block of blocks) {
    const attrs = `data-locator="${block.locator}" data-prose="${block.isProse}"`;
    const line = block.locator.slice(10);
    if (block.kind === "list") {
      const indent = block.level ?? 0, tag = block.ordered ? "ol" : "ul";
      while (lists.length && lists.at(-1)!.indent > indent) closeList();
      if (lists.length && lists.at(-1)!.indent === indent && lists.at(-1)!.tag !== tag) closeList();
      if (!lists.length || lists.at(-1)!.indent < indent) { output.push(tag === "ol" && block.start !== 1 ? `<ol start="${block.start}">` : `<${tag}>`); lists.push({ indent, tag }); }
      else output.push("</li>");
      output.push(`<li ${attrs}>${inline(block.display ?? block.text)}`);
      continue;
    }
    while (lists.length) closeList();
    const rendered = (() => {
    if (block.kind === "meta") return "";
    if (block.kind === "teaching" && block.teaching) return `<section class="pith-teaching-block" data-teaching-kind="${block.teaching.kind}" ${attrs}><h3>${inline(block.teaching.title)}</h3><p>${inline(block.teaching.body).replace(/\n/g, "<br>")}</p></section>`;
    if (block.kind === "table") return renderTableHtml(block.text, attrs);
    if (block.kind === "code") { const depth = block.level ?? 0; return `${"<blockquote>".repeat(depth)}<pre ${attrs}><code>${escape(block.display ?? block.text)}</code></pre>${"</blockquote>".repeat(depth)}`; }
    if (block.kind === "math") return `<pre ${attrs}><code>${escape(block.text)}</code></pre>`;
    if (block.kind === "rule") return `<hr ${attrs}>`;
    if (block.kind === "heading") return `<h${block.level} id="line-${line}" ${attrs}>${inline(block.text)}</h${block.level}>`;
    if (block.kind === "quote") { const depth = block.level ?? 1; return `<blockquote ${attrs}>${"<blockquote>".repeat(depth - 1)}${inline(block.display ?? block.text)}${"</blockquote>".repeat(depth - 1)}</blockquote>`; }
    return `<p ${attrs}>${inline(block.display ?? block.text)}</p>`;
    })();
    output.push(rendered);
  }
  while (lists.length) closeList();
  return output.join("");
}

export async function renderFile(file: MaterialFileEntry, bytes: Uint8Array): Promise<RenderedDocumentView> {
  if (/\.epub$/i.test(file.name) || file.mimeType === "application/epub+zip") return renderEpub(bytes);
  if (/\.pdf$/i.test(file.name) || file.mimeType === "application/pdf") return renderPdf(file, bytes);
  if (/\.cbz$/i.test(file.name) || ["application/vnd.comicbook+zip", "application/x-cbz"].includes(file.mimeType)) return renderCbz(file, bytes);
  if (/\.(png|jpe?g|webp|gif)$/i.test(file.name) || ["image/png", "image/jpeg", "image/webp", "image/gif"].includes(file.mimeType)) return renderImage(file, bytes);
  let markdown: string;
  try { markdown = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { throw new Error(`Unsupported binary reader format: ${file.name}`); }
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(markdown)) throw new Error(`Unsupported binary reader format: ${file.name}`);
  if (/\.(?:md|markdown)$/i.test(file.name) || file.mimeType === "text/markdown") {
    const sections = markdownSections(markdown);
    return { format: "markdown", title: sections[0]?.title ?? file.name, html: renderMarkdown(markdown), sections, blocks: extractProseBlocks(markdown), totalUnits: markdown.split(/\r?\n/).length };
  }
  const lines = markdown.split(/\r?\n/);
  const source = /\.(?:ts|tsx|js|jsx|mjs|cjs|py|rs|go|java|c|h|cc|cpp|hpp|cs|swift|kt|json|jsonl|yaml|yml|toml|sh|bash|zsh|css|html|xml|sql|rb|php|lua|r)$/i.test(file.name);
  const blocks: ProseBlock[] = lines.map((text, index) => ({ index, locator: `text:line:${index}`, text, isProse: !source }));
  const html = source
    ? `<pre><code>${blocks.map(block => `<span data-locator="${block.locator}" data-prose="false" data-trainable="true">${escape(block.text)}</span>`).join("\n")}</code></pre>`
    : blocks.map(block => `<p data-locator="${block.locator}" data-prose="true">${escape(block.text)}</p>`).join("");
  return { format: "markdown", title: file.name, html, sections: [], blocks, totalUnits: lines.length };
}

registerPlugin({
  id: "stage-reader", api: "^1", requires: ["host", "store", "window"], provides: ["stage.reader"], essential: true,
  name: "Document & Book Stage", description: "Paginated EPUB, fixed-page PDF, and reflowable Markdown reading stage with intrinsic locators",
  settings: {
    fontScale: { type: "number", title: "Font scale", description: "Relative reading typography scale", default: 1, minimum: 0.75, maximum: 1.75 },
    columns: { type: "string", title: "Column mode", default: "auto", enum: ["auto", "single", "double"] },
  },
  apply(ctx) {
    const service: StageReaderService = { formats: ["epub", "pdf", "markdown", "cbz", "image"], sections: markdownSections, render: renderMarkdown, extractProseBlocks, extractTeachingBlocks, matchTextAnchor, computePagination, resolveResponsiveLayout, renderFile };
    ctx.provide("stage.reader", service);
  },
});

export { proseTextNodes, visibleToolkitTarget } from "./pagination.ts";
