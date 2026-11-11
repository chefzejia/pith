import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import { DefaultAttentionEngine, DefaultWorkspaceStore, type HttpPort, type HttpRequestSpec, type HttpResponseData, type SelectionAnchor, type WorkspaceStoragePort } from "../../core/index.ts";
import { normalizeToolkits } from "../../plugins/guide-acp/acpSession.ts";
import { createGuideWorkspaceTools } from "../../plugins/guide-acp/tools.ts";
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
  const schema = (properties: Record<string, unknown>, required: string[]) => ({ type: "object", properties, required, additionalProperties: false });
  const field = { type: "string" };
  const tools: DshTool[] = [
    { name: "pith_compass", description: "Read the attention compass", inputSchema: schema({}, []), execute: async () => engine.compass() },
    { name: "pith_read_topic", description: "Read a topic and its notes", inputSchema: schema({ topicId: field }, ["topicId"]), execute: async input => store.getTopic(string(input, "topicId")) },
    { name: "pith_configure_toolkits", description: "Configure topic toolkits: shadowing, feynman, or interline (bilingual reading)", inputSchema: schema({ topicId: field, toolkits: { type: "array", items: field } }, ["topicId", "toolkits"]), execute: async input => {
      if (!Array.isArray(input.toolkits)) throw new Error("Invalid toolkits");
      const topicId = string(input, "topicId"), toolkits = normalizeToolkits(input.toolkits); return store.updateTopic(topicId, { toolkits });
    } },
    { name: "pith_capture_note", description: "Capture a topic note", inputSchema: schema({ topicId: field, body: field, kind: { enum: ["note", "highlight", "practice"] }, anchor: { type: "object" } }, ["topicId", "body"]), execute: async input => {
      const kind = input.kind === undefined ? "note" : input.kind;
      if (kind !== "note" && kind !== "highlight" && kind !== "practice") throw new Error("Invalid note kind");
      let anchor: SelectionAnchor | undefined;
      if (input.anchor !== undefined) {
        if (!input.anchor || typeof input.anchor !== "object" || Array.isArray(input.anchor)) throw new Error("Invalid anchor");
        const value = input.anchor as Readonly<Record<string, unknown>>;
        if (value.quote !== undefined && typeof value.quote !== "string") throw new Error("Invalid quote");
        anchor = { file: string(value, "file"), locator: string(value, "locator"), ...(typeof value.quote === "string" ? { quote: value.quote } : {}) };
      }
      return engine.captureSelection({ topicId: string(input, "topicId"), kind, body: string(input, "body"), anchor });
    } },
    { name: "pith_write_lesson", description: "Write a generated Markdown lesson", inputSchema: schema({ materialId: field, fileName: field, markdown: field }, ["materialId", "fileName", "markdown"]), execute: async input => store.writeGeneratedFile(string(input, "materialId"), string(input, "fileName"), string(input, "markdown")) },
    { name: "pith_update_profile", description: "Update the learner profile", inputSchema: schema({ markdown: field }, ["markdown"]), execute: async input => { await store.writeProfile(string(input, "markdown")); return store.readProfile(); } },
  ];
  tools.push(...createGuideWorkspaceTools(store, engine, options.storage, options.http ?? new DshPublicHttpPort()).filter(tool => tool.name === "pith_read_material_section" || tool.name === "pith_settle_topic" || tool.name === "pith_ingest_external"));
  return { tools };
}
