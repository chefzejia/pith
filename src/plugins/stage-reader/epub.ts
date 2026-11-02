import type { ProseBlock, ReaderSectionHeading, RenderedDocumentView } from "../../core/index.ts";

const LIMIT = 16 * 1024 * 1024;
const BOOK_LIMIT = 64 * 1024 * 1024;
const decoder = new TextDecoder("utf-8", { fatal: true });
const escape = (s: string): string => s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

interface Entry { offset: number; compressed: number; size: number; method: number }

class Zip {
  private entries = new Map<string, Entry>();
  private view: DataView;
  constructor(privateData: Uint8Array) {
    this.data = privateData;
    this.view = new DataView(privateData.buffer, privateData.byteOffset, privateData.byteLength);
    const v = this.view;
    let end = -1;
    for (let i = privateData.length - 22; i >= Math.max(0, privateData.length - 65557); i--) {
      if (v.getUint32(i, true) === 0x06054b50 && i + 22 + v.getUint16(i + 20, true) === privateData.length) { end = i; break; }
    }
    if (end < 0) throw new Error("Invalid ZIP directory");
    const count = v.getUint16(end + 10, true), start = v.getUint32(end + 16, true), size = v.getUint32(end + 12, true);
    if (v.getUint16(end + 4, true) || v.getUint16(end + 6, true) || count === 0xffff || start + size > end || count !== v.getUint16(end + 8, true)) throw new Error("Unsupported ZIP directory");
    let pos = start, total = 0;
    for (let i = 0; i < count; i++) {
      if (pos + 46 > start + size || v.getUint32(pos, true) !== 0x02014b50) throw new Error("Invalid ZIP entry");
      const flags = v.getUint16(pos + 8, true), method = v.getUint16(pos + 10, true);
      const compressed = v.getUint32(pos + 20, true), unpacked = v.getUint32(pos + 24, true);
      const nameLength = v.getUint16(pos + 28, true), extra = v.getUint16(pos + 30, true), comment = v.getUint16(pos + 32, true);
      const offset = v.getUint32(pos + 42, true), next = pos + 46 + nameLength + extra + comment;
      if (next > start + size || flags & 1 || (method !== 0 && method !== 8) || unpacked > LIMIT || compressed > LIMIT || offset === 0xffffffff) throw new Error("Unsupported ZIP entry");
      total += unpacked;
      if (total > BOOK_LIMIT) throw new Error("EPUB exceeds size limit");
      const name = decoder.decode(privateData.subarray(pos + 46, pos + 46 + nameLength));
      if (this.entries.has(name)) throw new Error("Duplicate ZIP entry");
      this.entries.set(name, { offset, compressed, size: unpacked, method });
      pos = next;
    }
  }
  private data: Uint8Array;
  async text(name: string): Promise<string> {
    return decoder.decode(await this.read(name));
  }
  names(): string[] { return [...this.entries.keys()]; }
  async read(name: string): Promise<Uint8Array> {
    const entry = this.entries.get(name);
    if (!entry) throw new Error(`Missing EPUB entry: ${name}`);
    const { offset, compressed, size, method } = entry, v = this.view;
    if (offset + 30 > this.data.length || v.getUint32(offset, true) !== 0x04034b50) throw new Error("Invalid ZIP local header");
    const start = offset + 30 + v.getUint16(offset + 26, true) + v.getUint16(offset + 28, true);
    if (start + compressed > this.data.length) throw new Error("Truncated ZIP entry");
    let bytes = this.data.slice(start, start + compressed);
    if (method === 8) {
      const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw")).getReader();
      const chunks: Uint8Array[] = []; let length = 0;
      try {
        while (true) {
          const result = await reader.read();
          if (result.done) break;
          length += result.value.length;
          if (length > size || length > LIMIT) { await reader.cancel(); throw new Error("EPUB entry exceeds size limit"); }
          chunks.push(result.value);
        }
      } finally { reader.releaseLock(); }
      bytes = new Uint8Array(length); let at = 0;
      for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.length; }
    }
    if (bytes.length !== size) throw new Error("Invalid ZIP entry size");
    return bytes;
  }
}

export async function readZipEntries(bytes: Uint8Array, include: (name: string) => boolean): Promise<Map<string, Uint8Array>> {
  const zip = new Zip(bytes);
  const entries = new Map<string, Uint8Array>();
  for (const name of zip.names()) if (include(name)) entries.set(name, await zip.read(name));
  return entries;
}

interface XmlNode { name: string; attrs: Record<string, string>; children: (XmlNode | string)[] }
const local = (name: string): string => name.split(":").at(-1)!.toLowerCase();
function decode(value: string): string {
  return value.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, entity: string) => {
    const predefined: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
    if (entity[0] !== "#") return predefined[entity.toLowerCase()]!;
    const value = entity[1]?.toLowerCase() === "x" ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
    if (!Number.isInteger(value) || value <= 0 || value > 0x10ffff || (value >= 0xd800 && value <= 0xdfff)) throw new Error("Invalid XML entity");
    return String.fromCodePoint(value);
  });
}
function xml(source: string): XmlNode {
  if (/<!ENTITY/i.test(source)) throw new Error("XML entities are unsupported");
  const root: XmlNode = { name: "#document", attrs: {}, children: [] }, stack = [root];
  const tokens = source.match(/<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<[^>]*>|[^<]+/gi) ?? [];
  if (tokens.join("") !== source) throw new Error("Invalid XML");
  for (const token of tokens) {
    const parent = stack[stack.length - 1]!;
    if (token.startsWith("<!--") || token.startsWith("<?") || /^<!DOCTYPE/i.test(token)) continue;
    if (token.startsWith("<![CDATA[")) { parent.children.push(token.slice(9, -3)); continue; }
    if (token.startsWith("</")) {
      if (stack.length === 1 || token.slice(2, -1).trim() !== parent.name) throw new Error("Mismatched XML tag");
      stack.pop(); continue;
    }
    if (token.startsWith("<")) {
      const match = /^<([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>$/.exec(token);
      if (!match) throw new Error("Invalid XML tag");
      const attrs: Record<string, string> = Object.create(null) as Record<string, string>;
      for (const attr of match[2]!.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[attr[1]!] = decode(attr[2] ?? attr[3] ?? "");
      const node: XmlNode = { name: match[1]!, attrs, children: [] };
      parent.children.push(node); if (!match[3]) stack.push(node); continue;
    }
    parent.children.push(decode(token));
  }
  if (stack.length !== 1) throw new Error("Unclosed XML tag");
  return root;
}
function descendants(node: XmlNode, name: string): XmlNode[] {
  return node.children.flatMap(child => typeof child === "string" ? [] : [...(local(child.name) === name.toLowerCase() ? [child] : []), ...descendants(child, name)]);
}
function content(node: XmlNode): string {
  if (["script", "style"].includes(local(node.name))) return "";
  return node.children.map(child => typeof child === "string" ? child : content(child)).join("").replace(/\s+/g, " ").trim();
}
function resolve(base: string, href: string): string {
  const raw = decodeURIComponent(href.split("#")[0]!.split("?")[0]!);
  if (!raw || raw.startsWith("/") || raw.includes("\\") || /^[a-z][a-z\d+.-]*:/i.test(raw)) throw new Error("Invalid EPUB path");
  const parts = base ? base.split("/") : [];
  for (const part of raw.split("/")) { if (!part || part === ".") continue; if (part === "..") { if (!parts.length) throw new Error("EPUB path traversal"); parts.pop(); } else parts.push(part); }
  return parts.join("/");
}
const dir = (path: string): string => path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";

export async function renderEpub(bytes: Uint8Array): Promise<RenderedDocumentView> {
  const zip = new Zip(bytes);
  const container = xml(await zip.text("META-INF/container.xml"));
  const rootPath = descendants(container, "rootfile")[0]?.attrs["full-path"];
  if (!rootPath) throw new Error("EPUB rootfile missing");
  const opfPath = resolve("", rootPath), opf = xml(await zip.text(opfPath));
  const manifest = new Map<string, { path: string; properties: string; media: string }>();
  for (const item of descendants(opf, "item")) {
    const id = item.attrs["id"], href = item.attrs["href"];
    if (id && href) manifest.set(id, { path: resolve(dir(opfPath), href), properties: item.attrs["properties"] ?? "", media: item.attrs["media-type"] ?? "" });
  }
  const spine = descendants(opf, "itemref").filter(item => item.attrs["linear"] !== "no").map(item => {
    const entry = manifest.get(item.attrs["idref"] ?? "");
    if (!entry) throw new Error("EPUB spine item missing");
    return entry.path;
  });
  if (!spine.length) throw new Error("EPUB spine is empty");
  const blocks: ProseBlock[] = [], html: string[] = [], sections: ReaderSectionHeading[] = [];
  const locations = new Map<string, string>();
  for (const [chapter, path] of spine.entries()) {
    const doc = xml(await zip.text(path));
    const body = descendants(doc, "body")[0];
    if (!body) throw new Error(`EPUB chapter body missing: ${path}`);
    let number = 0;
    const blockTags = /^(p|h[1-6]|li|blockquote|pre|table|math)$/;
    const hasBlocks = (node: XmlNode): boolean => node.children.some(child => typeof child !== "string" && (blockTags.test(local(child.name)) || hasBlocks(child)));
    const emit = (tag: string, text: string, id?: string): void => {
      if (!text) return;
      const prose = !["pre", "table", "math"].includes(tag) && /[\p{L}\p{N}]/u.test(text);
      const locator = `text:section:${chapter};block:${number++}`;
      blocks.push({ index: blocks.length, locator, text, isProse: prose });
      if (id) locations.set(`${path}#${id}`, locator);
      if (!locations.has(path)) locations.set(path, locator);
      const htmlTag = prose ? (tag === "li" ? "p" : tag) : "pre";
      html.push(`<${htmlTag} data-locator="${locator}" data-prose="${prose}">${escape(text)}</${htmlTag}>`);
    };
    const visit = (node: XmlNode): void => {
      const tag = local(node.name);
      if (["script", "style", "nav", "head"].includes(tag)) return;
      if (blockTags.test(tag) && (["pre", "table", "math"].includes(tag) || !hasBlocks(node))) {
        emit(tag, content(node), node.attrs["id"]);
        return;
      }
      if (node.attrs["id"]) locations.set(`${path}#${node.attrs["id"]}`, `text:section:${chapter};block:${number}`);
      let pending = "";
      const flush = (): void => { emit("p", pending.replace(/\s+/g, " ").trim()); pending = ""; };
      for (const child of node.children) {
        if (typeof child === "string") { if (blockTags.test(tag)) pending += child; }
        else if (blockTags.test(tag) && !blockTags.test(local(child.name)) && !hasBlocks(child) && !["ul", "ol"].includes(local(child.name))) pending += content(child);
        else { flush(); visit(child); }
      }
      flush();
    };
    visit(body);
  }
  const nav = [...manifest.values()].find(item => item.properties.split(/\s+/).includes("nav"));
  const ncx = [...manifest.values()].find(item => item.media === "application/x-dtbncx+xml");
  if (nav) {
    const doc = xml(await zip.text(nav.path));
    const navs = descendants(doc, "nav");
    const toc = navs.find(node => (node.attrs["epub:type"] ?? "").split(/\s+/).includes("toc")) ?? (navs.length === 1 ? navs[0] : undefined);
    const walk = (node: XmlNode, level: number): void => {
      const tag = local(node.name);
      if (tag === "a" && node.attrs["href"]) {
        const href = node.attrs["href"], path = resolve(dir(nav.path), href), chapter = spine.indexOf(path);
        const fragment = href.includes("#") ? decodeURIComponent(href.slice(href.indexOf("#") + 1)) : "";
        if (chapter >= 0) sections.push({ title: content(node), level: Math.max(1, level), line: chapter, locator: locations.get(fragment ? `${path}#${fragment}` : path) ?? `text:section:${chapter};block:0` });
      }
      for (const child of node.children) if (typeof child !== "string") walk(child, level + (local(child.name) === "ol" ? 1 : 0));
    };
    if (toc) walk(toc, 0);
  } else if (ncx) {
    const doc = xml(await zip.text(ncx.path));
    const walk = (node: XmlNode, level: number): void => {
      if (local(node.name) === "navpoint") {
        const src = descendants(node, "content")[0]?.attrs["src"], label = descendants(node, "navlabel")[0];
        if (src && label) {
          const path = resolve(dir(ncx.path), src), chapter = spine.indexOf(path), fragment = src.includes("#") ? decodeURIComponent(src.slice(src.indexOf("#") + 1)) : "";
          if (chapter >= 0) sections.push({ title: content(label), level, line: chapter, locator: locations.get(fragment ? `${path}#${fragment}` : path) ?? `text:section:${chapter};block:0` });
        }
      }
      for (const child of node.children) if (typeof child !== "string") walk(child, level + (local(child.name) === "navpoint" ? 1 : 0));
    };
    walk(doc, 0);
  }
  if (!sections.length) for (const [index, path] of spine.entries()) sections.push({ title: path.split("/").at(-1)!.replace(/\.[^.]+$/, ""), level: 1, line: index, locator: locations.get(path) ?? `text:section:${index};block:0` });
  return { format: "epub", title: content(descendants(opf, "title")[0] ?? { name: "", attrs: {}, children: [] }) || "Untitled EPUB", html: html.join(""), sections, blocks, totalUnits: spine.length };
}
