import type { ExternalIngestBundle, ExternalIngestInput, HttpPort, HttpRequestSpec, HttpResponseData } from "../../core/index.ts";

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

function extractHtmlTitleAndMarkdown(html: string, fallbackTitle: string): { title: string; markdown: string } {
  if (typeof DOMParser !== "undefined") {
    const doc = new DOMParser().parseFromString(html, "text/html");
    doc.querySelectorAll("script,style,iframe,object,embed,form,nav,footer,noscript,svg,math,template").forEach(node => node.remove());
    const root = doc.querySelector("article") ?? doc.querySelector("main") ?? doc.body;
    if (!root) throw new Error("HTML body unavailable");
    const documentTitle = (doc.title || fallbackTitle).replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 200) || fallbackTitle;
    return { title: documentTitle, markdown: root.textContent ?? "" };
  }
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const documentTitle = (titleMatch?.[1] ?? fallbackTitle).replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim().slice(0, 200) || fallbackTitle;
  const cleaned = html
    .replace(/<(script|style|iframe|object|embed|form|nav|footer|noscript|svg|math|template)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<(?:article|main|section|div|p|br|li|h[1-6])\b[^>]*>/gi, "\n")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
  return { title: documentTitle, markdown: cleaned };
}
const encoder = new TextEncoder();
function safeMarkdown(value: string): string {
  return value.replace(/<[^>]*>/g, "").replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/\u0000/g, "").trim();
}

export async function ingestExternalUrl(input: ExternalIngestInput, http: HttpPort | undefined): Promise<ExternalIngestBundle> {
  if (!isPublicHttpUrl(input.url)) throw new Error("External URL is not public HTTP(S)");
  if (!http || !("requestPublic" in http) || typeof http.requestPublic !== "function") throw new Error("Safe public HTTP transport unavailable: DNS pinning and redirect protection required");
  const kind = input.kind ?? "article";
  if (kind !== "article" && kind !== "discussion" && kind !== "media") throw new Error("Invalid external material kind");
  if (input.transcriptMarkdown && (kind !== "media" || encoder.encode(input.transcriptMarkdown).length > 4 * 1024 * 1024)) throw new Error("Invalid transcript");
  const limit = (kind === "media" ? 64 : 4) * 1024 * 1024;
  const response = await (http as PublicHttpPort).requestPublic({ url: input.url, headers: { Accept: kind === "media" ? "audio/*, video/*" : "text/html, text/markdown, text/plain", "Accept-Encoding": "identity" } }, limit);
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
  text = safeMarkdown(text);
  if (!text) throw new Error("External document is empty");
  return { title: documentTitle, kind, files: [{ name: "article.md", mimeType: "text/markdown", bytes: encoder.encode(text) }], warnings: kind === "discussion" ? ["Discussion may be incomplete"] : [] };
}
