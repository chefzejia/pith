import type { ExternalIngestBundle, ExternalIngestInput, HttpPort, HttpRequestSpec, HttpResponseData } from "../../core/index.ts";
import { normalizeRepositoryUrl } from "../../core/index.ts";
import { withHttpDeadline } from "../../core/host.ts";

// The transport resolves and pins only public addresses, rejects redirects, and enforces the byte limit while streaming.
export interface PublicHttpPort extends HttpPort {
  requestPublic(spec: HttpRequestSpec, maxBytes: number): Promise<HttpResponseData>;
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

function extractHtmlTitleAndMarkdown(html: string, fallbackTitle: string): { title: string; markdown: string } {
  const decode = (value: string) => value.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (entity, key: string) => { const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " }; if (key[0] !== "#") return named[key.toLowerCase()] ?? entity; const n = Number.parseInt(key.slice(key[1]?.toLowerCase() === "x" ? 2 : 1), key[1]?.toLowerCase() === "x" ? 16 : 10); return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : "\ufffd"; });
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const documentTitle = decode((titleMatch?.[1] ?? fallbackTitle).replace(/<[^>]*>/g, " ")).replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 200) || fallbackTitle;
  const safeHtml = html.replace(/<(script|style|iframe|object|embed|form|nav|footer|head|noscript|svg|math|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ");
  const cleaned = htmlElementContents(safeHtml, "article") ?? htmlElementContents(safeHtml, "main") ?? htmlElementContents(safeHtml, "body") ?? safeHtml;
  let fenceLength = 3;
  for (const match of cleaned.matchAll(/`+/g)) { fenceLength = Math.max(fenceLength, match[0].length + 1); if (fenceLength > 128) throw new Error("HTML code fence exceeds limit"); }
  const fence = "`".repeat(fenceLength);
  let output = "", code = false, quote = 0, lineStart = true;
  const boundary = () => { if (output && !output.endsWith("\n\n")) output += output.endsWith("\n") ? "\n" : "\n\n"; lineStart = true; };
  const prefix = (value = "") => { if (lineStart) { output += "> ".repeat(quote) + value; lineStart = false; } };
  for (const token of cleaned.match(/<!--[\s\S]*?-->|<[^>]*>|[^<]+|</g) ?? []) {
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
function safeMarkdown(value: string): string {
  return value.replace(/<[^>]*>/g, "").replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/\u0000/g, "").trim();
}

export async function ingestExternalUrl(input: ExternalIngestInput, http: HttpPort | undefined, signal?: AbortSignal): Promise<ExternalIngestBundle> {
  if (normalizeRepositoryUrl(input.url)) throw new Error("代码仓库请用户从立项框或添加材料导入");
  if (!isPublicHttpUrl(input.url)) throw new Error("External URL is not public HTTP(S)");
  if (!http || !("requestPublic" in http) || typeof http.requestPublic !== "function") throw new Error("Safe public HTTP transport unavailable: DNS pinning and redirect protection required");
  const kind = input.kind ?? "article";
  if (kind !== "article" && kind !== "discussion" && kind !== "media") throw new Error("Invalid external material kind");
  if (input.transcriptMarkdown && (kind !== "media" || encoder.encode(input.transcriptMarkdown).length > 4 * 1024 * 1024)) throw new Error("Invalid transcript");
  const limit = (kind === "media" ? 64 : 4) * 1024 * 1024;
  const spec: HttpRequestSpec = { url: input.url, headers: { Accept: kind === "media" ? "audio/*, video/*" : "text/html, text/markdown, text/plain", "Accept-Encoding": "identity" }, signal };
  const response = await withHttpDeadline(spec, requestSignal => (http as PublicHttpPort).requestPublic({ ...spec, signal: requestSignal }, limit));
  if (response.status < 200 || response.status >= 300 || response.bytes.byteLength > limit || response.bytes.byteLength === 0) throw new Error("External response is invalid or exceeds size limit");
  const type = (Object.entries(response.headers).find(([key]) => key.toLowerCase() === "content-type")?.[1] ?? "").split(";")[0]!.trim().toLowerCase();
  const url = new URL(input.url);
  const title = decodeURIComponent(url.pathname.split("/").filter(Boolean).pop() ?? url.hostname).replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 200) || url.hostname;
  if (kind === "media") {
    const extensions: Record<string, string> = { "audio/mpeg": "mp3", "audio/wav": "wav", "audio/ogg": "ogg", "audio/mp4": "m4a", "audio/webm": "webm", "video/mp4": "mp4", "video/webm": "webm", "video/ogg": "ogv" };
    const extension = extensions[type];
    if (!extension) throw new Error("Unsupported media type");
    return { title, kind, files: [{ name: `media.${extension}`, mimeType: type, bytes: response.bytes }, ...(input.transcriptMarkdown ? [{ name: "transcript.md", mimeType: "text/markdown", bytes: encoder.encode(safeMarkdown(input.transcriptMarkdown)) }] : [])], warnings: [] };
  }
  let text = new TextDecoder("utf-8", { fatal: true }).decode(response.bytes);
  let documentTitle = title;
  if (type === "text/html" || type === "application/xhtml+xml") {
    const parsed = extractHtmlTitleAndMarkdown(text, title);
    documentTitle = parsed.title;
    text = parsed.markdown;
  } else if (type !== "text/markdown" && type !== "text/plain") throw new Error("Unsupported document type");
  text = type === "text/html" || type === "application/xhtml+xml" ? text.trim() : safeMarkdown(text);
  if (!text) throw new Error("External document is empty");
  return { title: documentTitle, kind, files: [{ name: "article.md", mimeType: "text/markdown", bytes: encoder.encode(text) }], warnings: kind === "discussion" ? ["Discussion may be incomplete"] : [] };
}
