import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import type { HttpPort, HttpRequestSpec, HttpResponseData } from "../../core/index.ts";

export class NodeHttpPort implements HttpPort {
  async request(spec: HttpRequestSpec): Promise<HttpResponseData> {
    if (spec.signal?.aborted) throw new Error("HTTP request aborted");
    const url = new URL(spec.url);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error(`Unsupported HTTP protocol: ${url.protocol}`);
    }
    const transport = url.protocol === "https:" ? httpsRequest : httpRequest;

    return new Promise<HttpResponseData>((resolve, reject) => {
      const req = transport(
        url,
        {
          method: spec.method ?? "GET",
          headers: spec.headers ? { ...spec.headers } : {},
          signal: spec.signal,
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
      req.setTimeout(30_000, () => req.destroy(new Error("HTTP request timed out")));
      req.on("error", reject);
      if (spec.body !== undefined) {
        req.write(typeof spec.body === "string" ? spec.body : Buffer.from(spec.body));
      }
      req.end();
    });
  }
}
