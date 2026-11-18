import type { ExternalIngestBundle, ExternalIngestInput, HttpPort, HttpRequestSpec, HttpResponseData } from "../../core/index.ts";
import { normalizeRepositoryUrl } from "../../core/index.ts";
import { withHttpDeadline } from "../../core/host.ts";

// The transport resolves and pins only public addresses, rejects redirects, and enforces the byte limit while streaming.
export interface PublicHttpPort extends HttpPort {
  requestPublic(spec: HttpRequestSpec, maxBytes: number, responseLimit?: (headers: HttpResponseData["headers"]) => number): Promise<HttpResponseData>;
}

export function isPublicHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) return false;
    const host = url.hostname.toLowerCase().replace(/\.$/, "");
    if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".test") || host.endsWith(".invalid") || host.endsWith(".example") || !host.includes(".") || host.includes(":")) return false;
    const parts = host.split(".");
    if (parts.length === 4 && parts.every(part => /^\d+$/.test(part))) {
      const [a, b, c] = parts.map(Number) as [number, number, number, number];
      return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0 || b === 2 || (b === 88 && c === 99))) || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) || (a === 203 && b === 0 && c === 113));
    }
    return true;
  } catch { return false; }
}

function htmlElementContents(html: string, name: string): string | undefined {
  const tags = /<!--[\s\S]*?-->|<\/?[a-z][\w-]*(?:\s+(?:[^>"']|"[^"]*"|'[^']*')*)?\s*\/?\s*>/gi;
  let start = -1, depth = 0;
  for (const match of html.matchAll(tags)) {
    const tag = new RegExp(`^<(/?)${name}(?=[\\s/>])`, "i").exec(match[0]);
    if (!tag) continue;
    if (tag[1]) {
      if (depth > 0 && --depth === 0) return html.slice(start, match.index);
    } else if (!/\/\s*>$/.test(match[0])) {
      if (depth++ === 0) start = match.index! + match[0].length;
    }
  }
  return undefined;
}

const decode = (value: string) => value.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (entity, key: string) => { const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " }; if (key[0] !== "#") return named[key.toLowerCase()] ?? entity; const n = Number.parseInt(key.slice(key[1]?.toLowerCase() === "x" ? 2 : 1), key[1]?.toLowerCase() === "x" ? 16 : 10); return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : "\ufffd"; });
const htmlTokens = /<!--[\s\S]*?-->|<\/?[a-z][\w-]*(?=[\s/>])(?:[^>"']|"[^"]*"|'[^']*')*>|[^<]+|</gi;

function extractHtmlTitleAndMarkdown(html: string, fallbackTitle: string, onLink?: (href: string) => void): { title: string; markdown: string } {
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const documentTitle = decode((titleMatch?.[1] ?? fallbackTitle).replace(/<[^>]*>/g, " ")).replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 200) || fallbackTitle;
  const visibleHtml = html.replace(/<(script|style|iframe|object|embed|form|head|noscript|svg|math|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ");
  if (onLink) for (const [tag] of visibleHtml.matchAll(htmlTokens)) {
    if (!/^<a\s/i.test(tag)) continue;
    for (const [, name, double, single, bare] of tag.slice(2, -1).matchAll(/([^\s=/"'<>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>\x60]+)))?/g)) {
      if (name!.toLowerCase() !== "href") continue;
      onLink(decode(double ?? single ?? bare ?? ""));
      break;
    }
  }
  const safeHtml = visibleHtml.replace(/<(nav|footer)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ");
  const cleaned = htmlElementContents(safeHtml, "article") ?? htmlElementContents(safeHtml, "main") ?? htmlElementContents(safeHtml, "body") ?? safeHtml;
  let fenceLength = 3;
  for (const match of cleaned.matchAll(/`+/g)) { fenceLength = Math.max(fenceLength, match[0].length + 1); if (fenceLength > 128) throw new Error("HTML code fence exceeds limit"); }
  const fence = "`".repeat(fenceLength);
  let output = "", code = false, quote = 0, lineStart = true;
  const boundary = () => { if (output && !output.endsWith("\n\n")) output += output.endsWith("\n") ? "\n" : "\n\n"; lineStart = true; };
  const prefix = (value = "") => { if (lineStart) { output += "> ".repeat(quote) + value; lineStart = false; } };
  for (const [token] of cleaned.matchAll(htmlTokens)) {
    if (!token.startsWith("<") || token === "<") { const text = decode(token).replace(/\u0000/g, ""); if (code) output += text.replace(/\n/g, `\n${"> ".repeat(quote)}`); else if (text.trim()) { prefix(); output += text.replace(/\s+/g, " "); } continue; }
    const tag = /^<\s*(\/?)\s*([\w-]+)/.exec(token); if (!tag) continue;
    const end = !!tag[1], name = tag[2]!.toLowerCase();
    if (name === "pre") { if (end) { output += `\n${"> ".repeat(quote)}${fence}`; code = false; boundary(); } else { boundary(); prefix(fence); output += `\n${"> ".repeat(quote)}`; code = true; } continue; }
    if (code) continue;
    if (name === "blockquote") { boundary(); quote = Math.max(0, quote + (end ? -1 : 1)); continue; }
    if (/^h[1-6]$/.test(name)) { boundary(); if (!end) prefix(`${"#".repeat(Number(name[1]))} `); }
    else if (["p", "div", "section", "li"].includes(name)) { boundary(); if (!end && name === "li") prefix("- "); }
    else if (name === "br") { output += "\n"; lineStart = true; }
  }
  return { title: documentTitle, markdown: output.trim() };
}
const encoder = new TextEncoder();
const MIB = 1024 * 1024, WEB_LIMIT = 4 * MIB, PDF_LIMIT = 32 * MIB, BATCH_LIMIT = 128 * MIB;
export const EXTERNAL_DOCUMENT_COUNT = 20;
const MARKDOWN_LIMIT = 24000, LINK_LIMIT = 200, URL_LIMIT = 4096;
const responseType = (headers: HttpResponseData["headers"]): string =>
  (Object.entries(headers).find(([key]) => key.toLowerCase() === "content-type")?.[1] ?? "").split(";")[0]!.trim().toLowerCase();
const isHtml = (type: string): boolean => type === "text/html" || type === "application/xhtml+xml";
const isWebDocument = (type: string): boolean => isHtml(type) || type === "text/markdown" || type === "text/plain";
function safeMarkdown(value: string): string {
  return value.replace(/<[^>]*>/g, "").replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/\u0000/g, "").trim();
}

function publicUrl(value: string): URL {
  if (normalizeRepositoryUrl(value)) throw new Error("代码仓库请用户从立项框或添加材料导入");
  if (value.length > URL_LIMIT || !isPublicHttpUrl(value)) throw new Error("External URL is not public HTTP(S) or exceeds the URL length limit");
  return new URL(value);
}

async function fetchPublic(url: URL, http: HttpPort | undefined, accept: string, limit: number, signal?: AbortSignal, responseLimit?: (headers: HttpResponseData["headers"]) => number): Promise<HttpResponseData> {
  if (!http || !("requestPublic" in http) || typeof http.requestPublic !== "function") throw new Error("Safe public HTTP transport unavailable: DNS pinning and redirect protection required");
  const transport = http as PublicHttpPort;
  const spec: HttpRequestSpec = { url: url.href, headers: { Accept: accept, "Accept-Encoding": "identity" }, signal };
  const response = await withHttpDeadline(spec, requestSignal => transport.requestPublic({ ...spec, signal: requestSignal }, limit, responseLimit));
  if (response.status < 200 || response.status >= 300) throw new Error(`Public HTTP request rejected: ${response.status}`);
  if (response.bytes.byteLength === 0) throw new Error("External response is empty");
  if (response.bytes.byteLength > Math.min(limit, responseLimit?.(response.headers) ?? limit)) throw new Error("External response exceeds size limit");
  return response;
}

const WEB_ACCEPT = "text/html, application/xhtml+xml, text/markdown, text/plain";

function urlBasename(url: URL): string {
  const segment = url.pathname.split("/").filter(Boolean).at(-1) ?? url.hostname;
  try { return decodeURIComponent(segment); } catch { return segment; }
}

function clipDocument(response: HttpResponseData, fallbackTitle: string, onLink?: (href: string) => void) {
  const type = responseType(response.headers);
  if (!isWebDocument(type)) throw new Error("Unsupported web document type");
  const text = new TextDecoder("utf-8", { fatal: true }).decode(response.bytes);
  if (isHtml(type)) return extractHtmlTitleAndMarkdown(text, fallbackTitle, onLink);
  if (onLink && type === "text/markdown") for (const match of text.matchAll(/(?<!\!)\[[^\]\n]*\]\(([^\s)]+)\)/g)) onLink(match[1]!);
  return { title: fallbackTitle, markdown: safeMarkdown(text) };
}

export async function readExternal(urlText: string, http: HttpPort, signal?: AbortSignal) {
  const url = publicUrl(urlText);
  const response = await fetchPublic(url, http, WEB_ACCEPT, WEB_LIMIT, signal);
  const links = new Set<string>();
  let linksTruncated = false;
  const { title, markdown } = clipDocument(response, url.hostname, href => {
    if (!href || href.startsWith("#")) return;
    let target: string;
    try { target = new URL(href, url).href; } catch { return; }
    if (!isPublicHttpUrl(target) || links.has(target)) return;
    if (links.size >= LINK_LIMIT || target.length > URL_LIMIT) { linksTruncated = true; return; }
    links.add(target);
  });
  const end = /[\uD800-\uDBFF]/.test(markdown[MARKDOWN_LIMIT - 1] ?? "") ? MARKDOWN_LIMIT - 1 : MARKDOWN_LIMIT;
  return { title, markdown: markdown.slice(0, end), links: [...links], truncated: markdown.length > end || linksTruncated };
}

function documentName(url: URL, pdf: boolean, used: Set<string>): string {
  const basename = urlBasename(url).normalize("NFC").replace(/[^\p{L}\p{N}\p{M} ._-]/gu, "_").replace(/^[ .]+|[ .]+$/g, "");
  const dot = pdf ? basename.lastIndexOf(".") : -1;
  const prefix = (value: string, maxBytes: number) => {
    let result = "", size = 0;
    for (const char of value) {
      size += encoder.encode(char).length;
      if (size > maxBytes) break;
      result += char;
    }
    return result;
  };
  const extension = pdf ? (dot > 0 ? prefix(basename.slice(dot), 40) : "") : ".md";
  const stem = (dot > 0 ? basename.slice(0, dot) : basename) || "document";
  const named = (suffix: string) => prefix(stem, 240 - suffix.length - encoder.encode(extension).length).trimEnd() + suffix + extension;
  let name = named("");
  for (let n = 2; used.has(name.toLowerCase()); n++) name = named(`-${n}`);
  used.add(name.toLowerCase());
  return name;
}

export async function ingestExternalDocuments(input: { title: string; urls: readonly string[]; kind?: "article" | "discussion" }, http: HttpPort, signal?: AbortSignal): Promise<ExternalIngestBundle> {
  if (input.urls.length < 1 || input.urls.length > EXTERNAL_DOCUMENT_COUNT) throw new Error("Expected 1 to 20 external URLs");
  const urls = input.urls.map((value, index) => {
    try { return publicUrl(value); } catch (error) { throw new Error(`Link ${index + 1}: ${(error as Error).message}`, { cause: error }); }
  });
  const files: ExternalIngestBundle["files"][number][] = [], names = new Set<string>();
  let received = 0, stored = 0;
  for (const [index, url] of urls.entries()) {
    try {
      const remaining = BATCH_LIMIT - received;
      if (!remaining) throw new Error("Batch exceeds 128 MB size limit");
      const cap = (headers: HttpResponseData["headers"]) => {
        const type = responseType(headers);
        if (type === "application/pdf") return PDF_LIMIT;
        if (isWebDocument(type)) return WEB_LIMIT;
        throw new Error("Unsupported document type");
      };
      const response = await fetchPublic(url, http, `${WEB_ACCEPT}, application/pdf`, Math.min(PDF_LIMIT, remaining), signal, cap);
      const pdf = responseType(response.headers) === "application/pdf";
      const markdown = pdf ? undefined : clipDocument(response, url.hostname).markdown;
      if (markdown === "") throw new Error("External document is empty");
      if (pdf && !new TextDecoder().decode(response.bytes.subarray(0, 1024)).includes("%PDF-")) throw new Error("External document is not a PDF");
      const bytes = markdown === undefined ? response.bytes : encoder.encode(markdown);
      received += response.bytes.byteLength;
      stored += bytes.byteLength;
      if (stored > BATCH_LIMIT || (!pdf && bytes.byteLength > WEB_LIMIT)) throw new Error("Clipped documents exceed size limit");
      files.push({ name: documentName(url, pdf, names), mimeType: pdf ? "application/pdf" : "text/markdown", bytes });
    } catch (error) {
      throw new Error(`Link ${index + 1} (${url.hostname}${url.pathname}): ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    }
  }
  const kind = input.kind ?? "article";
  return { title: input.title, kind, files, warnings: kind === "discussion" ? ["Discussion may be incomplete"] : [] };
}

export async function ingestExternalUrl(input: ExternalIngestInput, http: HttpPort | undefined, signal?: AbortSignal): Promise<ExternalIngestBundle> {
  const url = publicUrl(input.url);
  const kind = input.kind ?? "article";
  if (kind !== "article" && kind !== "discussion" && kind !== "media") throw new Error("Invalid external material kind");
  if (input.transcriptMarkdown && (kind !== "media" || encoder.encode(input.transcriptMarkdown).length > 4 * 1024 * 1024)) throw new Error("Invalid transcript");
  const response = await fetchPublic(url, http, kind === "media" ? "audio/*, video/*" : WEB_ACCEPT, kind === "media" ? 64 * MIB : WEB_LIMIT, signal);
  const type = responseType(response.headers);
  const title = urlBasename(url).replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 200) || url.hostname;
  if (kind === "media") {
    const extensions: Record<string, string> = { "audio/mpeg": "mp3", "audio/wav": "wav", "audio/ogg": "ogg", "audio/mp4": "m4a", "audio/webm": "webm", "video/mp4": "mp4", "video/webm": "webm", "video/ogg": "ogv" };
    const extension = extensions[type];
    if (!extension) throw new Error("Unsupported media type");
    return { title, kind, files: [{ name: `media.${extension}`, mimeType: type, bytes: response.bytes }, ...(input.transcriptMarkdown ? [{ name: "transcript.md", mimeType: "text/markdown", bytes: encoder.encode(safeMarkdown(input.transcriptMarkdown)) }] : [])], warnings: [] };
  }
  const clipped = clipDocument(response, title);
  if (!clipped.markdown) throw new Error("External document is empty");
  return { title: clipped.title, kind, files: [{ name: "article.md", mimeType: "text/markdown", bytes: encoder.encode(clipped.markdown) }], warnings: kind === "discussion" ? ["Discussion may be incomplete"] : [] };
}
