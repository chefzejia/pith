import { DefaultAttentionEngine, DefaultWorkspaceStore, type SelectionAnchor, type WorkspaceStoragePort } from "../../core/index.ts";
import { normalizeToolkits } from "../../plugins/guide-acp/acpSession.ts";
import { createGuideWorkspaceTools } from "../../plugins/guide-acp/tools.ts";

export interface DshTool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
  execute(input: Readonly<Record<string, unknown>>): Promise<unknown>;
}
export interface DshBundleOptions { readonly storage: WorkspaceStoragePort }

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
    { name: "pith_configure_toolkits", description: "Configure the toolkits mounted on a topic", inputSchema: schema({ topicId: field, toolkits: { type: "array", items: field } }, ["topicId", "toolkits"]), execute: async input => {
      if (!Array.isArray(input.toolkits)) throw new Error("Invalid toolkits");
      return store.updateTopic(string(input, "topicId"), { toolkits: normalizeToolkits(input.toolkits) });
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
  tools.push(...createGuideWorkspaceTools(store, engine, options.storage).filter(tool => tool.name === "pith_read_material_section" || tool.name === "pith_settle_topic"));
  return { tools };
}
