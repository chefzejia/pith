import type { AttentionEngine, GuideMcpToolSpec, HttpPort, SelectionAnchor, WorkspaceStoragePort, WorkspaceStore } from "../../core/index.ts";
import { ingestExternalUrl } from "./externalIngest.ts";

export function normalizeToolkits(value: readonly unknown[]): string[] {
  if (!Array.isArray(value) || !value.every(item => typeof item === "string" && /^[a-z][a-z0-9-]*$/.test(item))) throw new Error("Invalid toolkit IDs");
  return [...new Set(value as readonly string[])];
}

const field = { type: "string", minLength: 1 };
const schema = (properties: Record<string, unknown>, required: string[]) => ({ type: "object", properties, required, additionalProperties: false });

function keys(input: Readonly<Record<string, unknown>>, allowed: readonly string[]): void {
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some(key => !allowed.includes(key))) throw new Error("Invalid tool arguments");
}

function text(input: Readonly<Record<string, unknown>>, key: string, max = 4000): string {
  const value = input[key];
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new Error(`Invalid ${key}`);
  return value.trim();
}

function anchorValue(value: unknown): SelectionAnchor {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid anchor");
  const anchor = value as Record<string, unknown>;
  keys(anchor, ["file", "locator", "quote"]);
  return { file: text(anchor, "file", 500), locator: text(anchor, "locator", 300), ...(anchor.quote === undefined ? {} : { quote: text(anchor, "quote") }) };
}

export function createGuideWorkspaceTools(store: WorkspaceStore, engine: AttentionEngine | undefined, storage?: WorkspaceStoragePort, http?: HttpPort): readonly GuideMcpToolSpec[] {
  return [
    ...(http ? [{ name: "pith_ingest_external", description: "Import a public external document or media into the workspace.", inputSchema: schema({ url: field, kind: { enum: ["article", "discussion", "media"] }, transcriptMarkdown: field, topicId: field }, ["url"]), async execute(input: Readonly<Record<string, unknown>>) {
      keys(input, ["url", "kind", "transcriptMarkdown", "topicId"]);
      const kind = input.kind;
      if (kind !== undefined && kind !== "article" && kind !== "discussion" && kind !== "media") throw new Error("Invalid kind");
      const topicId = input.topicId === undefined ? undefined : text(input, "topicId", 200);
      if (topicId && !await store.getTopic(topicId)) throw new Error("Topic not found");
      const bundle = await ingestExternalUrl({ url: text(input, "url", 4096), kind, ...(input.transcriptMarkdown === undefined ? {} : { transcriptMarkdown: text(input, "transcriptMarkdown", 4000000) }) }, http);
      const material = await store.importMaterial({ title: bundle.title, kind: bundle.kind, files: bundle.files });
      if (topicId) await store.updateTopic(topicId, { materialId: material.id });
      return { material, warnings: bundle.warnings };
    } }] : []),
    { name: "pith_get_context", description: "Read the learner profile, compass and optional topic.", inputSchema: schema({ topicId: field }, []), async execute(input) {
      keys(input, ["topicId"]);
      if (!engine) throw new Error("Attention engine unavailable");
      const topic = input.topicId === undefined ? null : await store.getTopic(text(input, "topicId", 200));
      if (input.topicId !== undefined && !topic) throw new Error("Topic not found");
      return { profile: await store.readProfile(), compass: await engine.compass(), topic };
    } },
    { name: "pith_read_material_section", description: "Read a bounded excerpt of a text material, optionally around text:line:N (zero-based).", inputSchema: schema({ materialId: field, file: field, locator: field }, ["materialId", "file"]), async execute(input) {
      keys(input, ["materialId", "file", "locator"]);
      const materialId = text(input, "materialId", 200);
      const file = text(input, "file", 500);
      const material = await store.getMaterial(materialId);
      if (!material) throw new Error("Material not found");
      const entry = material.files.find(candidate => candidate.name === file);
      if (!entry) throw new Error("Material file not found");
      if (!entry.mimeType.startsWith("text/") && !/\.(?:md|markdown|txt|html|htm|json|csv|xml|ya?ml)$/i.test(file)) throw new Error("Material is not text");
      if (!storage) throw new Error("Material storage unavailable");
      if (/[\\/\0]/.test(materialId) || /[\\/\0]/.test(file) || materialId === "." || materialId === ".." || file === "." || file === "..") throw new Error("Invalid material path");
      let line = 0;
      if (input.locator !== undefined) {
        const match = /^text:line:(0|[1-9]\d*)$/.exec(text(input, "locator", 300));
        if (!match) throw new Error("Invalid text locator");
        line = Number(match[1]);
        if (!Number.isSafeInteger(line)) throw new Error("Invalid text locator");
      }
      const lines = (await storage.readText(`materials/${materialId}/files/${file}`)).split(/\r?\n/);
      if (line >= lines.length) throw new Error("Text locator not found");
      const startLine = input.locator === undefined ? 0 : Math.max(0, line - 10);
      const endLine = Math.min(lines.length, input.locator === undefined ? 40 : line + 11);
      const excerpt = lines.slice(startLine, endLine).join("\n");
      return { materialId, file, startLine, endLine, text: excerpt.slice(0, 12000), truncated: endLine < lines.length || excerpt.length > 12000 };
    } },
    { name: "pith_save_note", description: "Append a learner note to a topic.", inputSchema: schema({ topicId: field, body: field, kind: { enum: ["note", "highlight", "practice"] }, guideRemark: field, anchor: { type: "object" } }, ["topicId", "body"]), async execute(input) {
      keys(input, ["topicId", "body", "kind", "guideRemark", "anchor"]);
      const kind = input.kind === undefined ? "note" : input.kind;
      if (kind !== "note" && kind !== "highlight" && kind !== "practice") throw new Error("Invalid note kind");
      return store.appendNote(text(input, "topicId", 200), { kind, body: text(input, "body"), ...(input.guideRemark === undefined ? {} : { guideRemark: text(input, "guideRemark", 1000) }), ...(input.anchor === undefined ? {} : { anchor: anchorValue(input.anchor) }) });
    } },
    { name: "pith_write_lesson", description: "Write a generated Markdown lesson without overwriting imported material.", inputSchema: schema({ materialId: field, fileName: field, markdown: field }, ["materialId", "fileName", "markdown"]), async execute(input) {
      keys(input, ["materialId", "fileName", "markdown"]);
      return store.writeGeneratedFile(text(input, "materialId", 200), text(input, "fileName", 200), text(input, "markdown", 100000));
    } },
    { name: "pith_configure_toolkits", description: "Configure topic toolkits.", inputSchema: schema({ topicId: field, toolkits: { type: "array", items: field } }, ["topicId", "toolkits"]), async execute(input) {
      keys(input, ["topicId", "toolkits"]);
      if (!Array.isArray(input.toolkits)) throw new Error("Invalid toolkits");
      return store.updateTopic(text(input, "topicId", 200), { toolkits: normalizeToolkits(input.toolkits) });
    } },
    { name: "pith_settle_topic", description: "Settle an exploring topic after recording a verification summary and requiring an existing learner note; optionally replace the learner profile.", inputSchema: schema({ topicId: field, verificationSummary: field, profilePatchMarkdown: { type: "string", minLength: 1, maxLength: 100000 } }, ["topicId", "verificationSummary"]), async execute(input) {
      keys(input, ["topicId", "verificationSummary", "profilePatchMarkdown"]);
      const topicId = text(input, "topicId", 200);
      const summary = text(input, "verificationSummary");
      const profile = input.profilePatchMarkdown === undefined ? undefined : text(input, "profilePatchMarkdown", 100000);
      if (/^<!-- pith-note:(?:v1|quote|body|remark|no-remark|end) -->$/m.test(summary)) throw new Error("Reserved note marker");
      const topic = await store.getTopic(topicId);
      if (!topic) throw new Error("Topic not found");
      if (topic.status !== "exploring") throw new Error("Topic is not exploring");
      if (topic.notes.length === 0) throw new Error("Settlement requires a learner note");
      if (profile !== undefined) await store.writeProfile(profile);
      await store.appendNote(topicId, { kind: "note", body: `## 核心认知总结\n\n${summary}` });
      return store.updateTopic(topicId, { status: "settled" });
    } },
  ];
}
