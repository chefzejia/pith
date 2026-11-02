import type { FixedPageEntry, MaterialFileEntry, ProseBlock, ReaderSectionHeading, RenderedDocumentView } from "../../core/index.ts";
import { readZipEntries } from "./epub.ts";

const imageTypes: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif", svg: "image/svg+xml" };
const escape = (text: string): string => text.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);

function imageMime(name: string): string | undefined {
  const extension = /\.([^.\/]+)$/.exec(name);
  return extension ? imageTypes[extension[1]!.toLowerCase()] : undefined;
}

function naturalCompare(left: string, right: string): number {
  const a = left.match(/\d+|\D+/g) ?? [], b = right.match(/\d+|\D+/g) ?? [];
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const x = a[i]!, y = b[i]!;
    if (/^\d+$/.test(x) && /^\d+$/.test(y)) {
      const nx = x.replace(/^0+/, "") || "0", ny = y.replace(/^0+/, "") || "0";
      if (nx.length !== ny.length) return nx.length - ny.length;
      if (nx !== ny) return nx < ny ? -1 : 1;
    } else {
      const difference = x.toLowerCase().localeCompare(y.toLowerCase());
      if (difference) return difference;
    }
  }
  return a.length - b.length || left.localeCompare(right);
}

function dataUrl(bytes: Uint8Array, mimeType: string): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${mimeType};base64,${btoa(binary)}`;
}

function fixedView(file: MaterialFileEntry, format: "cbz" | "image" | "pdf", pages: FixedPageEntry[], blocks: ProseBlock[] = []): RenderedDocumentView {
  const sections: ReaderSectionHeading[] = pages.map(page => ({ title: page.label, level: 1, line: page.page - 1, locator: `page:${page.page}` }));
  const html = pages.map(page => {
    const content = page.bytes && format !== "pdf"
      ? `<img alt="${page.label}" data-page="${page.page}" src="${dataUrl(page.bytes, page.mimeType)}">`
      : page.text ? `<p data-locator="page:${page.page}" data-prose="true">${escape(page.text)}</p>` : "";
    return `<figure class="pith-fixed-page" data-locator="page:${page.page}" data-prose="false">${content}</figure>`;
  }).join("");
  return { format, layout: "fixed-page", title: file.name, html, sections, pages, blocks, totalUnits: pages.length };
}

export async function renderCbz(file: MaterialFileEntry, bytes: Uint8Array): Promise<RenderedDocumentView> {
  const entries = await readZipEntries(bytes, name => !name.endsWith("/") && imageMime(name) !== undefined);
  const names = [...entries.keys()].sort(naturalCompare);
  if (!names.length) throw new Error("CBZ 中没有图片页");
  const pages = names.map((name, index) => ({ page: index + 1, label: `第 ${index + 1} 页`, mimeType: imageMime(name)!, bytes: entries.get(name)! }));
  return fixedView(file, "cbz", pages);
}

export function renderImage(file: MaterialFileEntry, bytes: Uint8Array): RenderedDocumentView {
  const mimeType = imageMime(file.name) ?? (Object.values(imageTypes).includes(file.mimeType) ? file.mimeType : undefined);
  if (!mimeType || mimeType === "image/svg+xml") throw new Error(`Unsupported image format: ${file.name}`);
  return fixedView(file, "image", [{ page: 1, label: "第 1 页", mimeType, bytes }]);
}

function binaryString(bytes: Uint8Array): string {
  let result = "";
  for (let i = 0; i < bytes.length; i += 0x8000) result += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return result;
}

function pdfString(raw: string): string {
  const decoded = raw.replace(/\\(?:([0-7]{1,3})|\r\n|[\r\n]|(.))/gs, (_, octal: string | undefined, escaped: string | undefined) => {
    if (octal) return String.fromCharCode(parseInt(octal, 8) & 255);
    if (!escaped) return "";
    return ({ n: "\n", r: "\r", t: "\t", b: "\b", f: "\f" } as Record<string, string>)[escaped] ?? escaped;
  });
  if (decoded.startsWith("\xfe\xff")) {
    let text = "";
    for (let i = 2; i + 1 < decoded.length; i += 2) text += String.fromCharCode(decoded.charCodeAt(i) * 256 + decoded.charCodeAt(i + 1));
    return text;
  }
  return decoded;
}

function extractPdfText(content: string): string {
  const lines: string[] = [];
  for (const group of content.matchAll(/\bBT\b([\s\S]*?)\bET\b/g)) {
    const text = group[1]!;
    let current = "";
    for (let i = 0; i < text.length; i++) {
      if (text[i] !== "(") continue;
      let depth = 1, raw = "", j = i + 1;
      for (; j < text.length && depth; j++) {
        const char = text[j]!;
        if (char === "\\" && j + 1 < text.length) {
          raw += char + text[++j]!;
          if (text[j] === "\r" && text[j + 1] === "\n") raw += text[++j]!;
        } else if (char === "(") { depth++; raw += char; }
        else if (char === ")") { depth--; if (depth) raw += char; }
        else raw += char;
      }
      if (depth) throw new Error("Invalid PDF text string");
      current += pdfString(raw);
      const next = text.slice(j).match(/^\s*(?:Tj|TJ|'|")/);
      if (next && current.trim()) { lines.push(current.trim()); current = ""; }
      i = j - 1;
    }
    if (current.trim()) lines.push(current.trim());
  }
  return lines.join("\n");
}

async function pdfContent(object: string, objects: ReadonlyMap<string, string>): Promise<string> {
  const stream = /\bstream\r?\n/.exec(object);
  if (!stream) return object;
  const header = object.slice(0, stream.index);
  const start = stream.index + stream[0].length;
  const length = /\/Length\s+(\d+)\b(?:\s+(\d+)\s+R\b)?/.exec(header);
  let size: number | undefined;
  if (length) {
    if (length[2] !== undefined) {
      const referenced = objects.get(`${length[1]} ${length[2]}`);
      if (!referenced || !/^\s*\d+\s*$/.test(referenced)) throw new Error("Invalid PDF stream length reference");
      size = Number(referenced.trim());
    } else size = Number(length[1]);
  }
  const end = size === undefined ? object.indexOf("endstream", start) : start + size;
  if (end < start || end > object.length) throw new Error("Invalid PDF stream length");
  let data = Uint8Array.from(object.slice(start, end), char => char.charCodeAt(0));
  if (/\/Filter\b/.test(header)) {
    if (!/\/Filter\s*(?:\/FlateDecode\b(?!\s*\[)|\[\s*\/FlateDecode\s*\])/.test(header)) throw new Error("Unsupported PDF stream filter");
    const reader = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate")).getReader();
    const chunks: Uint8Array[] = []; let size = 0;
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.length;
        if (size > 16 * 1024 * 1024) { await reader.cancel(); throw new Error("PDF stream exceeds size limit"); }
        chunks.push(part.value);
      }
    } finally { reader.releaseLock(); }
    data = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.length; }
  }
  return binaryString(data);
}

export async function renderPdf(file: MaterialFileEntry, bytes: Uint8Array): Promise<RenderedDocumentView> {
  const source = binaryString(bytes);
  if (!source.startsWith("%PDF-")) throw new Error("Invalid PDF header");
  if (/\/Encrypt\b/.test(source)) throw new Error("Encrypted PDF is unsupported");
  if (/\/Type\s*\/ObjStm\b/.test(source)) throw new Error("PDF object streams are unsupported");
  const objects = new Map<string, string>();
  for (const match of source.matchAll(/(?:^|[\r\n])\s*(\d+)\s+(\d+)\s+obj\b([\s\S]*?)\bendobj\b/g)) objects.set(`${match[1]} ${match[2]}`, match[3]!);
  const pageObjects = [...objects.entries()].filter(([, value]) => /\/Type\s*\/Page\b/.test(value));
  if (!pageObjects.length) throw new Error("PDF has no readable pages");
  const ordered: string[] = [], visited = new Set<string>();
  const visit = (id: string): void => {
    if (visited.has(id)) throw new Error("Invalid PDF page tree");
    visited.add(id);
    const object = objects.get(id);
    if (!object) throw new Error("Missing PDF page object");
    if (/\/Type\s*\/Page\b/.test(object)) { ordered.push(id); return; }
    const kids = /\/Kids\s*\[([^\]]*)\]/.exec(object);
    if (!kids) throw new Error("Invalid PDF page tree");
    for (const ref of kids[1]!.matchAll(/(\d+)\s+(\d+)\s+R\b/g)) visit(`${ref[1]} ${ref[2]}`);
  };
  const catalog = [...objects.values()].find(value => /\/Type\s*\/Catalog\b/.test(value));
  const root = catalog && /\/Pages\s+(\d+)\s+(\d+)\s+R\b/.exec(catalog);
  if (root) visit(`${root[1]} ${root[2]}`);
  else ordered.push(...pageObjects.map(([id]) => id));
  if (!ordered.length) throw new Error("PDF has no readable pages");
  const pages: FixedPageEntry[] = [], blocks: ProseBlock[] = [];
  for (const id of ordered) {
    const object = objects.get(id)!;
    const contents = /\/Contents\s*(\[[^\]]*\]|\d+\s+\d+\s+R)/.exec(object);
    let text = "";
    if (contents) {
      const texts: string[] = [];
      for (const ref of contents[1]!.matchAll(/(\d+)\s+(\d+)\s+R\b/g)) {
        const stream = objects.get(`${ref[1]} ${ref[2]}`);
        if (!stream) throw new Error("Missing PDF content stream");
        texts.push(extractPdfText(await pdfContent(stream, objects)));
      }
      text = texts.filter(Boolean).join("\n");
    } else text = extractPdfText(object);
    const page = pages.length + 1, locator = `page:${page}`;
    pages.push({ page, label: `第 ${page} 页`, mimeType: "application/pdf", text });
    if (text) blocks.push({ index: blocks.length, locator, text, isProse: true });
  }
  return fixedView(file, "pdf", pages, blocks);
}
