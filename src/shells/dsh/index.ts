import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import "../../plugins/all.ts";
import { DefaultAttentionEngine, DefaultWorkspaceStore, type HttpPort, type HttpRequestSpec, type HttpResponseData, type WorkspaceStoragePort } from "../../core/index.ts";
import { createScopedTools } from "../../plugins/guide-acp/tools.ts";
import { isPublicHttpUrl, type PublicHttpPort } from "../../plugins/guide-acp/externalIngest.ts";
import { withHttpDeadline } from "../../core/host.ts";
export { mountPithWorkbench, PithWorkbenchView, renderCompass, workbenchStyles } from "../../workbench/index.ts";

export interface DshTool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
  execute(input: Readonly<Record<string, unknown>>): Promise<unknown>;
}
export interface DshBundleOptions { readonly storage: WorkspaceStoragePort; readonly http?: HttpPort }

export class DshPublicHttpPort implements PublicHttpPort {
  async request(spec: HttpRequestSpec): Promise<HttpResponseData> { return this.requestPublic(spec, 4 * 1024 * 1024); }
  async requestPublic(spec: HttpRequestSpec, maxBytes: number): Promise<HttpResponseData> {
    return withHttpDeadline(spec, signal => this.requestPublicWithSignal(spec, maxBytes, signal));
  }
  private async requestPublicWithSignal(spec: HttpRequestSpec, maxBytes: number, signal: AbortSignal | undefined): Promise<HttpResponseData> {
    if (!isPublicHttpUrl(spec.url) || (spec.method !== undefined && spec.method !== "GET")) throw new Error("Invalid public request");
    const url = new URL(spec.url);
    const addresses = await dns.promises.lookup(url.hostname, { all: true, verbatim: true });
    if (signal) signal.throwIfAborted();
    if (!addresses.length || addresses.some(({ address, family }) => family === 4 ? !isPublicHttpUrl(`http://${address}`) : !/^(?:2[0-9a-f]{3}|3[0-9a-f]{3}):/i.test(address) || /^(?:2001|2002|3fff):/i.test(address))) throw new Error("DNS resolved to a non-public address");
    const selected = addresses[0]!;
    return new Promise((resolve, reject) => {
      const request = (url.protocol === "https:" ? https.request : http.request)(url, { method: "GET", headers: spec.headers, signal, agent: false, family: selected.family, lookup: (_hostname, _options, callback) => callback(null, selected.address, selected.family) }, response => {
        const status = response.statusCode ?? 0;
        if (status < 200 || status >= 300) { request.destroy(); response.destroy(); reject(new Error(`Public HTTP request rejected: ${status}`)); return; }
        const chunks: Uint8Array[] = []; let size = 0;
        response.on("data", (chunk: Buffer) => { size += chunk.length; if (size > maxBytes) response.destroy(new Error("Public response exceeds limit")); else chunks.push(chunk); });
        response.on("error", reject);
        response.on("aborted", () => reject(new Error("Public response aborted")));
        response.on("end", () => {
          const bytes = new Uint8Array(Buffer.concat(chunks)); const headers: Record<string, string> = {};
          for (const [key, value] of Object.entries(response.headers)) if (typeof value === "string") headers[key] = value; else if (Array.isArray(value)) headers[key] = value.join(", ");
          resolve({ status, headers, bytes, text: () => new TextDecoder().decode(bytes) });
        });
      });
      if (spec.timeoutMs === undefined) request.setTimeout(15000, () => request.destroy(new Error("Public request timed out")));
      request.on("error", reject); request.end();
    });
  }
}

function string(input: Readonly<Record<string, unknown>>, key: string): string {
  const value = input[key];
  if (typeof value !== "string" || !value.trim()) throw new Error(`Invalid ${key}`);
  return value;
}

export function createDshPluginBundle(options: DshBundleOptions): { tools: readonly DshTool[] } {
  const store = new DefaultWorkspaceStore(options.storage);
  const engine = new DefaultAttentionEngine(store, options.storage);
  const field = { type: "string" };
  const tools: DshTool[] = [];
  const scoped = (topicId: string) => createScopedTools({ topicId, store, engine, storage: options.storage, http: options.http ?? new DshPublicHttpPort(), onChoices: () => {} });
  tools.push(...scoped("scope").map(tool => {
    const source = tool.inputSchema as { properties?: Record<string, unknown>; required?: string[] };
    return { name: tool.name, description: tool.description, inputSchema: { ...tool.inputSchema, properties: { ...source.properties, topicId: field }, required: [...(source.required ?? []), "topicId"] }, async execute(input: Readonly<Record<string, unknown>>) {
      const topicId = string(input, "topicId"), { topicId: _topicId, ...args } = input;
      const selected = scoped(topicId).find(item => item.name === tool.name);
      if (!selected) throw new Error("Tool unavailable");
      return selected.execute(args);
    } };
  }));
  return { tools };
}
