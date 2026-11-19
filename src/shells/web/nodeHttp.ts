import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import { BlockList, isIP } from "node:net";
import type { HttpPort, HttpRequestSpec, HttpResponseData } from "../../core/index.ts";
import { isPublicHttpUrl, type PublicHttpPort } from "../../plugins/guide-acp/externalIngest.ts";
import { withHttpDeadline } from "../../core/host.ts";

export interface PublicHttpResponse extends HttpResponseData { readonly finalUrl: string }
export type PublicRedirectPolicy = (target: URL) => boolean | void;
export interface PublicHttpPortOptions {
  readonly resolve?: (hostname: string) => Promise<readonly { readonly address: string; readonly family: number }[]>;
  readonly send?: (url: URL, address: { readonly address: string; readonly family: number }, spec: HttpRequestSpec, maxBytes: number, responseLimit: (headers: HttpResponseData["headers"]) => number, signal?: AbortSignal) => Promise<HttpResponseData>;
}

const MAX_REDIRECTS = 5;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

const globalV6 = new BlockList();
globalV6.addSubnet("2000::", 3, "ipv6");
const reservedV6 = new BlockList();
for (const [address, prefix] of [["2001::", 23], ["2001:db8::", 32], ["2002::", 16], ["3fff::", 20]] as const) reservedV6.addSubnet(address, prefix, "ipv6");
export function publicAddress(address: string, family: number): boolean {
  if (family === 4 && isIP(address) === 4) return isPublicHttpUrl(`http://${address}`);
  return family === 6 && isIP(address) === 6 && globalV6.check(address, "ipv6") && !reservedV6.check(address, "ipv6");
}

function publicTarget(url: URL): boolean {
  if (url.username || url.password || (url.protocol !== "http:" && url.protocol !== "https:")) return false;
  const hostname = url.hostname.startsWith("[") ? url.hostname.slice(1, -1) : url.hostname;
  return isIP(hostname) === 6 ? publicAddress(hostname, 6) : isPublicHttpUrl(url.href);
}

export class NodeHttpPort implements HttpPort, PublicHttpPort {
  private readonly resolveAddresses: NonNullable<PublicHttpPortOptions["resolve"]>;
  private readonly sendPublic: NonNullable<PublicHttpPortOptions["send"]>;

  constructor(options: PublicHttpPortOptions = {}) {
    this.resolveAddresses = options.resolve ?? (hostname => dns.promises.lookup(hostname, { all: true, verbatim: true }));
    this.sendPublic = options.send ?? ((url, address, spec, maxBytes, responseLimit, signal) => this.sendPinned(url, address, spec, maxBytes, responseLimit, signal));
  }

  async requestPublic(spec: HttpRequestSpec, maxBytes: number, responseLimit?: (headers: HttpResponseData["headers"]) => number, redirectPolicy?: PublicRedirectPolicy): Promise<PublicHttpResponse> {
    if (spec.method !== undefined && spec.method !== "GET") throw new Error("Invalid public request");
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new Error("Invalid public response limit");
    return withHttpDeadline(spec, signal => this.requestPublicWithSignal(spec, maxBytes, signal, responseLimit, redirectPolicy));
  }
  async requestPublicSpeech(spec: HttpRequestSpec): Promise<HttpResponseData> {
    const url = new URL(spec.url);
    const authority = /^https:\/\/([^/?#]*)/i.exec(spec.url);
    if (!authority || authority[1]!.includes("@") || /[?#]/.test(spec.url) || url.protocol !== "https:" || url.username || url.password || spec.method !== "POST") throw new Error("Invalid public speech request");
    return withHttpDeadline(spec, async signal => {
      const url = new URL(spec.url);
      const address = await this.resolvePublicAddress(url, signal);
      const response = await this.sendPinned(url, address, spec, 64 * 1024 * 1024, () => 64 * 1024 * 1024, signal);
      if (response.status < 200 || response.status >= 300) throw new Error(`Public HTTP request rejected: ${response.status}`);
      return response;
    });
  }

  private async requestPublicWithSignal(spec: HttpRequestSpec, maxBytes: number, signal: AbortSignal | undefined, responseLimit?: (headers: HttpResponseData["headers"]) => number, redirectPolicy?: PublicRedirectPolicy): Promise<PublicHttpResponse> {
    let url: URL;
    try { url = new URL(spec.url); } catch { throw new Error(`Public request rejected at ${spec.url}: invalid URL`); }
    let redirects = 0;
    while (true) {
      if (!publicTarget(url)) throw new Error(`Public request rejected at ${url.href}: target is not public HTTP(S)`);
      const address = await this.resolvePublicAddress(url, signal);
      if (signal) signal.throwIfAborted();
      const response = await this.sendPublic(url, address, { ...spec, url: url.href }, maxBytes, headers => Math.min(maxBytes, responseLimit?.(headers) ?? maxBytes), signal);
      const status = response.status;
      const location = response.headers.location ?? response.headers.Location;
      if (!REDIRECT_STATUSES.has(status) || !location) {
        if (status < 200 || status >= 300) throw new Error(`Public HTTP request rejected: ${status}`);
        if (response.bytes.byteLength === 0) throw new Error("External response is empty");
        const limit = Math.min(maxBytes, responseLimit?.(response.headers) ?? maxBytes);
        if (response.bytes.byteLength > limit) throw new Error("External response exceeds size limit");
        return { ...response, finalUrl: url.href };
      }
      let target: URL;
      try { target = new URL(location, url); }
      catch { throw new Error(`Public redirect rejected at ${location}: invalid Location`); }
      if (url.protocol === "https:" && target.protocol === "http:") throw new Error(`Public redirect rejected at ${target.href}: HTTPS to HTTP downgrade is not allowed`);
      if (!publicTarget(target)) throw new Error(`Public redirect rejected at ${target.href}: target is not public HTTP(S)`);
      if (redirectPolicy) {
        let allowed: boolean | void;
        try { allowed = redirectPolicy(target); }
        catch (error) { throw new Error(`Public redirect rejected at ${target.href}: ${error instanceof Error ? error.message : String(error)}`); }
        if (allowed === false) throw new Error(`Public redirect rejected at ${target.href}: destination is not allowed`);
      }
      if (redirects >= MAX_REDIRECTS) throw new Error(`Public redirect rejected at ${target.href}: exceeded ${MAX_REDIRECTS} redirects`);
      redirects++;
      url = target;
    }
  }

  private async resolvePublicAddress(url: URL, signal?: AbortSignal): Promise<{ readonly address: string; readonly family: number }> {
    const hostname = url.hostname.startsWith("[") ? url.hostname.slice(1, -1) : url.hostname;
    const literalFamily = isIP(hostname);
    if (!publicTarget(url)) throw new Error(`Public request rejected at ${url.href}: target is not public HTTP(S)`);
    let addresses: readonly { readonly address: string; readonly family: number }[];
    try { addresses = literalFamily ? [{ address: hostname, family: literalFamily }] : await this.resolveAddresses(hostname); }
    catch (error) { throw new Error(`Public request rejected at ${url.href}: DNS lookup failed: ${error instanceof Error ? error.message : String(error)}`); }
    if (signal) signal.throwIfAborted();
    if (
      !addresses.length ||
      addresses.some(({ address, family }) => !publicAddress(address, family))
    ) {
      throw new Error(`Public request rejected at ${url.href}: DNS resolved to a non-public address`);
    }
    return addresses[0]!;
  }

  private sendPinned(url: URL, selected: { readonly address: string; readonly family: number }, spec: HttpRequestSpec, maxBytes: number, responseLimit: (headers: HttpResponseData["headers"]) => number, signal?: AbortSignal): Promise<HttpResponseData> {
    return new Promise((resolve, reject) => {
      const request = (url.protocol === "https:" ? https.request : http.request)(
        url,
        {
          method: spec.method ?? "GET",
          headers: spec.headers,
          signal,
          agent: false,
          family: selected.family,
          lookup: (_hostname, _options, callback) => callback(null, selected.address, selected.family),
        },
        (response) => {
          const status = response.statusCode ?? 0;
          const headers: Record<string, string> = {};
          for (const [key, value] of Object.entries(response.headers)) {
            if (typeof value === "string") headers[key.toLowerCase()] = value;
            else if (Array.isArray(value)) headers[key.toLowerCase()] = value.join(", ");
          }
          if (REDIRECT_STATUSES.has(status) && headers.location) {
            response.destroy();
            resolve({ status, headers, bytes: new Uint8Array(), text: () => "" });
            return;
          }
          let limit: number;
          try { limit = Math.min(maxBytes, responseLimit(headers)); }
          catch (error) { response.destroy(); reject(error); return; }
          if (Number(headers["content-length"]) > limit) {
            response.destroy(); reject(new Error("Public response exceeds limit")); return;
          }
          const chunks: Uint8Array[] = [];
          let size = 0;
          response.on("data", (chunk: Buffer) => {
            size += chunk.length;
            if (size > limit) response.destroy(new Error("Public response exceeds limit"));
            else chunks.push(chunk);
          });
          response.on("error", reject);
          response.on("aborted", () => reject(new Error("Public response aborted")));
          response.on("end", () => {
            const bytes = new Uint8Array(Buffer.concat(chunks));
            resolve({ status, headers, bytes, text: () => new TextDecoder().decode(bytes) });
          });
        },
      );
      if (spec.timeoutMs === undefined) request.setTimeout(15000, () => request.destroy(new Error("Public request timed out")));
      request.on("error", reject);
      if (spec.body !== undefined) request.write(typeof spec.body === "string" ? spec.body : Buffer.from(spec.body));
      request.end();
    });
  }
  async request(spec: HttpRequestSpec): Promise<HttpResponseData> {
    if (spec.signal?.aborted) throw new Error("HTTP request aborted");
    const url = new URL(spec.url);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error(`Unsupported HTTP protocol: ${url.protocol}`);
    }
    const transport = url.protocol === "https:" ? https.request : http.request;

    return withHttpDeadline(spec, signal => new Promise<HttpResponseData>((resolve, reject) => {
      const req = transport(
        url,
        {
          method: spec.method ?? "GET",
          headers: spec.headers ? { ...spec.headers } : {},
          signal,
        },
        (res) => {
          const chunks: Buffer[] = [];
          let total = 0;
          const maxBytes = 64 * 1024 * 1024;
          res.on("data", (chunk: Buffer) => {
            total += chunk.length;
            if (total > maxBytes) {
              req.destroy(new Error("HTTP response exceeded 64MB safety cap"));
              return;
            }
            chunks.push(chunk);
          });
          res.on("error", reject);
          res.on("end", () => {
            const bytes = new Uint8Array(Buffer.concat(chunks));
            const headers: Record<string, string> = {};
            for (const [k, v] of Object.entries(res.headers)) {
              if (typeof v === "string") headers[k.toLowerCase()] = v;
              else if (Array.isArray(v)) headers[k.toLowerCase()] = v.join(", ");
            }
            resolve({
              status: res.statusCode ?? 0,
              headers,
              bytes,
              text: () => new TextDecoder().decode(bytes),
            });
          });
        },
      );
      if (spec.timeoutMs === undefined) req.setTimeout(30_000, () => req.destroy(new Error("HTTP request timed out")));
      req.on("error", reject);
      if (spec.body !== undefined) {
        req.write(typeof spec.body === "string" ? spec.body : Buffer.from(spec.body));
      }
      req.end();
    }));
  }
}
