import type { ProseBlock, ReaderSectionHeading, RenderedDocumentView } from "../../core/index.ts";
import { directoryOf as dir, escapeHtml as escape, imageDataUrl, resolveEpubPath as resolve, sanitizeDeclarations, sanitizeStylesheet } from "./epubResources.ts";

const LIMIT = 16 * 1024 * 1024;
const BOOK_LIMIT = 64 * 1024 * 1024;
const decoder = new TextDecoder("utf-8", { fatal: true });

class HtmlWriter {
  private parts: string[] = [];
  private pending = "";
  private error: string;
  remaining = BOOK_LIMIT;
  constructor(error: string) { this.error = error; }
  ensure(length: number): void { if (length > this.remaining) throw new Error(this.error); }
  append(value: string): void {
    this.ensure(value.length);
    this.remaining -= value.length;
    if (value.length >= 16 * 1024) {
      if (this.pending) { this.parts.push(this.pending); this.pending = ""; }
      this.parts.push(value);
    } else {
      this.pending += value;
      if (this.pending.length >= 16 * 1024) { this.parts.push(this.pending); this.pending = ""; }
    }
  }
  escaped(value: string): void {
    let length = value.length;
    for (const match of value.matchAll(/[&<>"']/g)) length += match[0] === "&" ? 4 : match[0] === "'" ? 4 : match[0] === '"' ? 5 : 3;
    this.ensure(length);
    this.append(escape(value));
  }
  finish(): string { if (this.pending) this.parts.push(this.pending); return this.parts.join(""); }
}

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
  has(name: string): boolean { return this.entries.has(name); }
  size(name: string): number { return this.entries.get(name)!.size; }
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
const dropped = new Set(["script", "style", "nav", "head", "iframe", "object", "embed", "form", "input", "button", "link", "meta", "audio", "video", "foreignobject", "use"]);
function rawContent(node: XmlNode): string {
  if (dropped.has(local(node.name))) return "";
  return node.children.map(child => typeof child === "string" ? child : rawContent(child)).join("");
}
function content(node: XmlNode): string { return rawContent(node).replace(/\s+/g, " ").trim(); }

function safeFragmentId(id: string): boolean { return !!id && !/[\u0000-\u0020\u007f]/.test(id); }

function safeSvgValue(key: string, value: string): boolean {
  if (/[\\<>\u0000-\u001f\u007f]|\/\*|\*\/|(?:javascript|data)\s*:|(?:var|env|attr|expression|image(?:-set)?)\s*\(/i.test(value)) return false;
  if (/url\s*\(/i.test(value)) return /^(fill|stroke|clip-path|mask|filter)$/.test(key) && /^url\(\s*#[\w.-]+\s*\)$/i.test(value.trim());
  return true;
}

function safeSvgStyle(style: string, ids: ReadonlyMap<string, string>): string {
  return style.split(";").flatMap(declaration => {
    const colon = declaration.indexOf(":");
    if (colon < 0) return [];
    const key = declaration.slice(0, colon).trim().toLowerCase(), value = declaration.slice(colon + 1).trim();
    if (!/^(fill|fill-opacity|fill-rule|stroke|stroke-width|stroke-opacity|stroke-linecap|stroke-linejoin|stroke-dasharray|opacity|stop-color|stop-opacity|clip-path|mask)$/.test(key) || !value || (!/^url\(/i.test(value) && !/^[\w\s#.,%()+\-]*$/.test(value)) || /(?:expression|var|attr|image)\s*\(/i.test(value)) return [];
    const mapped = svgValue(key, value, ids);
    return mapped === null ? [] : [`${key}: ${mapped}`];
  }).join("; ");
}

const svgTags = new Set(["svg", "g", "defs", "lineargradient", "radialgradient", "stop", "clippath", "mask", "pattern", "use", "image", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon", "title", "desc"]);
const svgNames: Record<string, string> = { lineargradient: "linearGradient", radialgradient: "radialGradient", clippath: "clipPath", viewbox: "viewBox", preserveaspectratio: "preserveAspectRatio", gradientunits: "gradientUnits", gradienttransform: "gradientTransform", spreadmethod: "spreadMethod", patternunits: "patternUnits", patterncontentunits: "patternContentUnits", patterntransform: "patternTransform", clippathunits: "clipPathUnits", maskunits: "maskUnits", maskcontentunits: "maskContentUnits" };
function svgValue(key: string, value: string, ids: ReadonlyMap<string, string>): string | null {
  const match = /^url\(\s*#([^\s\\"'()#]+)\s*\)$/i.exec(value.trim());
  if (match) {
    if (!/^(fill|stroke|clip-path|mask|filter)$/.test(key)) return null;
    const target = svgReference(match[1]!, ids);
    return target ? `url(#${target})` : null;
  }
  if (!safeSvgValue(key, value)) return null;
  return value;
}

function svgReference(fragment: string, ids: ReadonlyMap<string, string>): string | null {
  try {
    const target = ids.get(decodeURIComponent(fragment));
    return target ? encodeURIComponent(target).replace(/[!'()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`) : null;
  } catch { return null; }
}

async function renderSvg(root: XmlNode, resource: (href: string) => Promise<string | null>, writer: HtmlWriter, prefix = "", rootAttributes = ""): Promise<void> {
  const ids = new Map<string, string>();
  const collectIds = (node: XmlNode): void => {
    if (!svgTags.has(local(node.name))) return;
    const id = node.attrs["id"];
    if (id && safeFragmentId(id)) ids.set(id, `${prefix}${id}`);
    for (const child of node.children) if (typeof child !== "string") collectIds(child);
  };
  collectIds(root);
  const render = async (node: XmlNode | string): Promise<void> => {
    if (typeof node === "string") { writer.escaped(node); return; }
    const tag = local(node.name);
    if (!svgTags.has(tag)) return;
    const outputTag = svgNames[tag] ?? tag;
    writer.append(`<${outputTag}`);
    const attribute = (name: string, value: string): void => {
      writer.append(` ${name}="`); writer.escaped(value); writer.append('"');
    };
    for (const [name, value] of Object.entries(node.attrs)) {
      const key = name.toLowerCase();
      if ((key === "href" || key === "xlink:href") && tag === "image") {
        const url = await resource(value);
        if (url) attribute(key, url);
      } else if ((key === "href" || key === "xlink:href") && ["use", "lineargradient", "radialgradient", "pattern"].includes(tag) && /^#[^\s\\"'()#]+$/.test(value)) {
        const target = svgReference(value.slice(1), ids);
        if (target) attribute(key, `#${target}`);
      }
      else if (key === "style") {
        const style = safeSvgStyle(value, ids);
        if (style) attribute("style", style);
      }
      else if (/^(xmlns|xmlns:xlink|id|viewbox|preserveaspectratio|width|height|x|y|x1|x2|y1|y2|cx|cy|r|rx|ry|fx|fy|fr|d|points|fill|fill-opacity|fill-rule|stroke|stroke-width|stroke-opacity|stroke-linecap|stroke-linejoin|stroke-dasharray|transform|opacity|offset|stop-color|stop-opacity|gradientunits|gradienttransform|spreadmethod|patternunits|patterncontentunits|patterntransform|clippathunits|clip-path|mask|maskunits|maskcontentunits)$/.test(key)) {
        if ((key === "xmlns" && value !== "http://www.w3.org/2000/svg") || (key === "xmlns:xlink" && value !== "http://www.w3.org/1999/xlink")) continue;
        const mapped = key === "id" ? ids.get(value) ?? null : svgValue(key, value, ids);
        if (mapped !== null) {
          attribute(svgNames[key] ?? key, mapped);
          if (key === "id" && prefix) attribute("data-epub-fragment", value);
        }
      }
    }
    if (node === root) writer.append(rootAttributes);
    writer.append(">");
    for (const child of node.children) await render(child);
    writer.append(`</${outputTag}>`);
  };
  await render(root);
}

async function safeSvg(bytes: Uint8Array, resource: (href: string) => Promise<string | null>): Promise<Uint8Array> {
  const doc = xml(decoder.decode(bytes));
  const root = doc.children.find(child => typeof child !== "string" && local(child.name) === "svg");
  if (!root || typeof root === "string") throw new Error("Invalid SVG image");
  const writer = new HtmlWriter("EPUB intermediate output budget exceeded");
  await renderSvg(root, resource, writer);
  return new TextEncoder().encode(writer.finish());
}
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
  const linkTarget = (base: string, href: string): { chapter: number; fragment: string } | null => {
    try {
      if (!href || /[?\u0000-\u0020\u007f]/.test(href) || href.indexOf("#") !== href.lastIndexOf("#")) return null;
      const hash = href.indexOf("#"), file = hash < 0 ? href : href.slice(0, hash);
      const fragment = hash < 0 ? "" : decodeURIComponent(href.slice(hash + 1));
      if (/[\u0000-\u001f\u007f]/.test(fragment)) return null;
      const target = file ? resolve(dir(base), file) : base;
      const chapter = spine.indexOf(target);
      return chapter < 0 ? null : { chapter, fragment };
    } catch { return null; }
  };
  const blocks: ProseBlock[] = [], sections: ReaderSectionHeading[] = [];
  const html = new HtmlWriter("EPUB output budget exceeded");
  const locations = new Map<string, string>();
  let resourceBudget = 64 * 1024 * 1024, intermediateBudget = 64 * 1024 * 1024;
  const resourceCache = new Map<string, Promise<string | null>>();
  for (const [chapter, path] of spine.entries()) {
    const doc = xml(await zip.text(path));
    const body = descendants(doc, "body")[0];
    if (!body) throw new Error(`EPUB chapter body missing: ${path}`);
    let number = 0, svgSequence = 0;
    const locator = (): string => `text:section:${chapter};block:${number}`;
    const addBlock = (text: string, prose: boolean): string => {
      const value = locator(); number++;
      blocks.push({ index: blocks.length, locator: value, text, isProse: prose });
      if (!locations.has(path)) locations.set(path, value);
      return ` data-locator="${value}" data-prose="${prose}"`;
    };
    const allowed = new Set(["body", "div", "section", "article", "aside", "header", "footer", "p", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "ul", "ol", "li", "dl", "dt", "dd", "table", "thead", "tbody", "tfoot", "tr", "td", "th", "caption", "figure", "figcaption", "img", "svg", "image", "g", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon", "title", "desc", "pre", "code", "math", "span", "font", "strong", "em", "b", "i", "u", "s", "sup", "sub", "a", "br", "hr"]);
    const blockTags = /^(div|section|article|aside|header|footer|p|h[1-6]|blockquote|ul|ol|li|dl|dt|dd|table|figure|figcaption|pre|math|hr)$/;
    const nonProse = /^(pre|code|table|math|img|svg|hr)$/;
    const proseTags = /^(p|h[1-6]|li|blockquote|figcaption|dt|dd)$/;
    const inlineOnly = (node: XmlNode): boolean => node.children.every(child => typeof child === "string" || (!dropped.has(local(child.name)) && !blockTags.test(local(child.name)) && !nonProse.test(local(child.name)) && inlineOnly(child)));
    const loadResource = async (base: string, href: string, ancestors: ReadonlySet<string>): Promise<string | null> => {
      let target: string;
      try { target = resolve(dir(base), href); } catch { return null; }
      if (!zip.has(target) || ancestors.has(target)) return null;
      if (ancestors.size >= 4) throw new Error(`EPUB image nesting limit exceeded: ${target}`);
      const key = target.toLowerCase().endsWith(".svg") ? `${target}\0${[...ancestors].sort().join("\0")}` : target;
      let pending = resourceCache.get(key);
      if (!pending) {
        const size = zip.size(target);
        if (size > resourceBudget) throw new Error(`EPUB resource budget exceeded: ${target}`);
        resourceBudget -= size;
        const next = new Set(ancestors); next.add(target);
        pending = imageDataUrl(target, name => zip.read(name), data => safeSvg(data, nested => loadResource(target, nested, next)), length => {
          if (length > resourceBudget) throw new Error(`EPUB resource budget exceeded: ${target}`);
          if (ancestors.size) {
            if (length > intermediateBudget) throw new Error(`EPUB intermediate output budget exceeded: ${target}`);
          } else html.ensure(length);
          resourceBudget -= length;
        });
        resourceCache.set(key, pending);
      }
      const url = await pending;
      if (!url) return null;
      if (ancestors.size) {
        if (url.length > intermediateBudget) throw new Error(`EPUB intermediate output budget exceeded: ${target}`);
        intermediateBudget -= url.length;
      } else {
        html.ensure(url.length);
      }
      return url;
    };
    const resource = (href: string): Promise<string | null> => loadResource(path, href, new Set());
    const attribute = (name: string, value: string): void => {
      html.append(` ${name}="`); html.escaped(value); html.append('"');
    };
    const attributes = async (node: XmlNode, tag: string): Promise<void> => {
      for (const [name, value] of Object.entries(node.attrs)) {
        const key = name.toLowerCase();
        if ((tag === "img" && key === "src") || (tag === "image" && (key === "href" || key === "xlink:href"))) {
          const url = await resource(value);
          if (url) attribute(key, url);
        } else if (key === "style") {
          const style = sanitizeDeclarations(value);
          if (style) attribute("style", style);
        } else if (tag === "font" && key === "color" && sanitizeDeclarations(`color: ${value}`)) {
          attribute("color", value);
        } else if (key === "href" && tag === "a") {
          const target = linkTarget(path, value);
          attribute("data-epub-target", target ? JSON.stringify(target) : "");
          attribute("role", "link"); attribute("tabindex", "0");
        }
        else if (key === "id") {
          if (safeFragmentId(value)) attribute("id", value);
        }
        else if (key === "class") {
          const safeClass = value.split(/\s+/).filter(token => token && !/^pith-/i.test(token)).join(" ");
          if (safeClass && safeSvgValue("class", safeClass)) attribute("class", safeClass);
        }
        else if (/^(title|alt|lang|dir|width|height|colspan|rowspan|viewbox|preserveaspectratio|x|y|x1|x2|y1|y2|cx|cy|r|rx|ry|d|points|fill|stroke|stroke-width|transform|xmlns|xmlns:xlink)$/.test(key) && safeSvgValue(key, value)) {
          const outputName = key === "viewbox" ? "viewBox" : key === "preserveaspectratio" ? "preserveAspectRatio" : key;
          attribute(outputName, value);
        }
      }
    };
    const markIds = (element: XmlNode): void => {
      if (dropped.has(local(element.name))) return;
      if (element.attrs["id"]) locations.set(`${path}#${element.attrs["id"]}`, locator());
      for (const child of element.children) if (typeof child !== "string") markIds(child);
    };
    const serialize = async (node: XmlNode | string, plain = false): Promise<void> => {
      if (typeof node === "string") { html.escaped(node); return; }
      const tag = local(node.name);
      if (dropped.has(tag)) return;
      if (node.attrs["id"] && !locations.has(`${path}#${node.attrs["id"]}`)) locations.set(`${path}#${node.attrs["id"]}`, locator());
      if (!allowed.has(tag)) {
        const id = node.attrs["id"];
        const marker = !!id && safeFragmentId(id), wrap = marker && inlineOnly(node);
        if (marker) { html.append("<span"); attribute("id", id); html.append(wrap ? ">" : "></span>"); }
        for (const child of node.children) await serialize(child, plain);
        if (wrap) html.append("</span>");
        return;
      }
      if (plain && tag === "svg") { await renderSvg(node, resource, html, `pith-svg-${chapter}-${svgSequence++}-`); return; }
      const writeElement = async (extra: string): Promise<void> => {
        html.append(`<${tag}`); await attributes(node, tag); html.append(`${extra}>`);
        for (const child of node.children) await serialize(child, true);
        html.append(`</${tag}>`);
      };
      if (plain) { await writeElement(""); return; }
      if (nonProse.test(tag)) {
        markIds(node);
        if (tag === "svg") {
          const prefix = `pith-svg-${chapter}-${svgSequence++}-`;
          const block = addBlock(rawContent(node), false);
          await renderSvg(node, resource, html, prefix, block);
          return;
        }
        const block = addBlock(rawContent(node), false);
        await writeElement(block);
        return;
      }
      if (proseTags.test(tag) && inlineOnly(node)) {
        const text = rawContent(node), prose = /[\p{L}\p{N}]/u.test(text);
        markIds(node);
        const block = addBlock(text, prose);
        await writeElement(block);
        return;
      }
      if (tag !== "body") { html.append(`<${tag}`); await attributes(node, tag); html.append(">"); }
      let pending: (XmlNode | string)[] = [];
      const flush = async (): Promise<void> => {
        if (!pending.length) return;
        const text = pending.map(child => typeof child === "string" ? child : rawContent(child)).join("");
        const prose = !!text && /[\p{L}\p{N}]/u.test(text);
        if (prose) {
          for (const child of pending) if (typeof child !== "string") markIds(child);
          html.append(`<span${addBlock(text, true)}>`);
        }
        for (const child of pending) await serialize(child, true);
        if (prose) html.append("</span>");
        pending = [];
      };
      for (const child of node.children) {
        if (typeof child === "string" || (!dropped.has(local(child.name)) && !blockTags.test(local(child.name)) && !nonProse.test(local(child.name)) && inlineOnly(child))) pending.push(child);
        else { await flush(); await serialize(child); }
      }
      await flush();
      if (tag !== "body") html.append(`</${tag}>`);
    };
    const rawBodyClass = body.attrs["class"] ? body.attrs["class"].split(/\s+/).filter(token => token && !/^pith-/i.test(token)).join(" ") : "";
    const bodyClass = rawBodyClass ? ` ${rawBodyClass}` : "";
    const bodyStyle = body.attrs["style"] ? sanitizeDeclarations(body.attrs["style"]) : "";
    html.append(`<section class="pith-epub-chapter pith-epub-chapter-${chapter}`);
    html.escaped(bodyClass); html.append('"');
    if (body.attrs["id"] && safeFragmentId(body.attrs["id"])) attribute("id", body.attrs["id"]);
    if (bodyStyle) attribute("style", bodyStyle);
    html.append(` data-epub-chapter="${chapter}" data-locator="text:section:${chapter};block:0">`);
    const writeStyle = (css: string): void => {
      const style = sanitizeStylesheet(css, chapter, Math.max(0, html.remaining - 15));
      if (style) { html.append("<style>"); html.append(style); html.append("</style>"); }
    };
    for (const style of descendants(doc, "style")) writeStyle(style.children.filter((child): child is string => typeof child === "string").join(""));
    for (const link of descendants(doc, "link")) {
      if (!(link.attrs["rel"] ?? "").toLowerCase().split(/\s+/).includes("stylesheet") || !link.attrs["href"]) continue;
      let cssPath: string;
      try { cssPath = resolve(dir(path), link.attrs["href"]); } catch { continue; }
      if (zip.has(cssPath) && [...manifest.values()].some(item => item.path === cssPath && item.media === "text/css")) writeStyle(await zip.text(cssPath));
    }
    await serialize(body);
    html.append("</section>");
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
        const target = linkTarget(nav.path, node.attrs["href"]);
        sections.push({ title: content(node), level: Math.max(1, level), line: target ? target.chapter : 0, locator: target ? `epub:${JSON.stringify(target)}` : "epub:missing" });
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
          const target = linkTarget(ncx.path, src);
          sections.push({ title: content(label), level, line: target ? target.chapter : 0, locator: target ? `epub:${JSON.stringify(target)}` : "epub:missing" });
        }
      }
      for (const child of node.children) if (typeof child !== "string") walk(child, level + (local(child.name) === "navpoint" ? 1 : 0));
    };
    walk(doc, 0);
  }
  if (!sections.length) for (const [index, path] of spine.entries()) sections.push({ title: path.split("/").at(-1)!.replace(/\.[^.]+$/, ""), level: 1, line: index, locator: locations.get(path) ?? `text:section:${index};block:0` });
  return { format: "epub", title: content(descendants(opf, "title")[0] ?? { name: "", attrs: {}, children: [] }) || "Untitled EPUB", html: html.finish(), sections, blocks, totalUnits: spine.length };
}
