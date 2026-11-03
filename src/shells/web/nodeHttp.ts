import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import type { HttpPort, HttpRequestSpec, HttpResponseData } from "../../core/index.ts";
import { isPublicHttpUrl, type PublicHttpPort } from "../../plugins/guide-acp/externalIngest.ts";
import { withHttpDeadline } from "../httpDeadline.ts";

export class NodeHttpPort implements HttpPort, PublicHttpPort {
  async requestPublic(spec: HttpRequestSpec, maxBytes: number): Promise<HttpResponseData> {
    return withHttpDeadline(spec, signal => this.requestPublicWithSignal(spec, maxBytes, signal));
  }
  private async requestPublicWithSignal(spec: HttpRequestSpec, maxBytes: number, signal: AbortSignal | undefined): Promise<HttpResponseData> {
    if (!isPublicHttpUrl(spec.url) || (spec.method !== undefined && spec.method !== "GET")) {
      throw new Error("Invalid public request");
    }
    const url = new URL(spec.url);
    const addresses = await dns.promises.lookup(url.hostname, { all: true, verbatim: true });
    if (signal) signal.throwIfAborted();
    if (
      !addresses.length ||
      addresses.some(({ address, family }) =>
        family === 4
          ? !isPublicHttpUrl(`http://${address}`)
          : !/^(?:2[0-9a-f]{3}|3[0-9a-f]{3}):/i.test(address) || /^(?:2001|2002|3fff):/i.test(address),
      )
    ) {
      throw new Error("DNS resolved to a non-public address");
    }
    const selected = addresses[0]!;
    return new Promise((resolve, reject) => {
      const request = (url.protocol === "https:" ? https.request : http.request)(
        url,
        {
          method: "GET",
          headers: spec.headers,
          signal,
          agent: false,
          family: selected.family,
          lookup: (_hostname, _options, callback) => callback(null, selected.address, selected.family),
        },
        (response) => {
          const status = response.statusCode ?? 0;
          if (status < 200 || status >= 300) {
            request.destroy();
            response.destroy();
            reject(new Error(`Public HTTP request rejected: ${status}`));
            return;
          }
          const chunks: Uint8Array[] = [];
          let size = 0;
          response.on("data", (chunk: Buffer) => {
            size += chunk.length;
            if (size > maxBytes) response.destroy(new Error("Public response exceeds limit"));
            else chunks.push(chunk);
          });
          response.on("error", reject);
          response.on("aborted", () => reject(new Error("Public response aborted")));
          response.on("end", () => {
            const bytes = new Uint8Array(Buffer.concat(chunks));
            const headers: Record<string, string> = {};
            for (const [key, value] of Object.entries(response.headers)) {
              if (typeof value === "string") headers[key.toLowerCase()] = value;
              else if (Array.isArray(value)) headers[key.toLowerCase()] = value.join(", ");
            }
            resolve({ status, headers, bytes, text: () => new TextDecoder().decode(bytes) });
          });
        },
      );
      if (spec.timeoutMs === undefined) request.setTimeout(15000, () => request.destroy(new Error("Public request timed out")));
      request.on("error", reject);
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
