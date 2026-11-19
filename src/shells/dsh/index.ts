import { shadowingToolkit } from "../../plugins/toolkit-shadowing/index.ts";
import { feynmanToolkit } from "../../plugins/toolkit-feynman/index.ts";
import "../../plugins/all.ts";
import { DefaultAttentionEngine, DefaultWorkspaceStore, type HttpPort, type WorkspaceStoragePort } from "../../core/index.ts";
import { createScopedTools } from "../../plugins/guide-acp/tools.ts";
import { markdownSections, renderFile, renderMarkdown } from "../../plugins/stage-reader/index.ts";
import { NodeRepositoryPort } from "../web/nodeRepository.ts";
import { NodeHttpPort } from "../web/nodeHttp.ts";
export { mountPithWorkbench, PithWorkbenchView, renderCompass, workbenchStyles } from "../../workbench/index.ts";

export interface DshTool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
  execute(input: Readonly<Record<string, unknown>>): Promise<unknown>;
}
export interface DshBundleOptions { readonly storage: WorkspaceStoragePort; readonly http?: HttpPort }

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
  const reader = { formats: ["markdown", "epub", "pdf", "cbz", "image"] as const, sections: markdownSections, render: renderMarkdown, renderFile };
  const repository = new NodeRepositoryPort();
  const scoped = (topicId: string) => createScopedTools({ toolkits: [shadowingToolkit, feynmanToolkit], topicId, store, engine, storage: options.storage, http: options.http ?? new NodeHttpPort(), repository, reader, onChoices: () => {} });
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
