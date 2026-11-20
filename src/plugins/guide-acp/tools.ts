import { DefaultWorkspaceStore, libraryOverview, nonHanLetterRatio, type ToolkitDescriptor, type StageReaderService, type AttentionEngine, type GuideMcpToolSpec, type HttpPort, type MediaCorpusPort, type RepositoryPort, type SelectionAnchor, type WorkspaceStoragePort, type WorkspaceStore } from "../../core/index.ts";
import { EXTERNAL_DOCUMENT_COUNT, ingestExternalDocuments, ingestExternalUrl, readExternal } from "./externalIngest.ts";
import { ToolExecutionFailure, type TurnTool } from "./mcpTools.ts";

export function normalizeToolkits(value: readonly unknown[], toolkits: readonly Pick<ToolkitDescriptor, "id" | "role">[] = []): string[] {
  const registered = new Set(toolkits.filter(toolkit => toolkit.role === "training").map(toolkit => toolkit.id));
  if (!Array.isArray(value) || !value.every(item => typeof item === "string" && registered.has(item))) throw new Error("Invalid toolkit IDs");
  return [...new Set(value as readonly string[])];
}

async function importedAids(files: readonly { name: string; mimeType?: string; bytes: Uint8Array }[], reader?: StageReaderService): Promise<string[]> {
  let sample = files.filter(file => /\.(?:md|markdown|txt|srt|vtt|ts|js|py)$/i.test(file.name)).map(file => new TextDecoder().decode(file.bytes.subarray(0, 16384))).join("\n").slice(0, 16384);
  const book = files.find(file => /\.(?:epub|pdf)$/i.test(file.name));
  if (book && reader?.renderFile) { const rendered = await reader.renderFile({ name: book.name, mimeType: book.mimeType ?? (/\.pdf$/i.test(book.name) ? "application/pdf" : "application/epub+zip"), bytes: book.bytes.length, sha256: "" }, book.bytes); sample = (rendered.blocks ?? []).filter(block => block.isProse).map(block => block.text).join(" ").slice(0, 16384); }
  return nonHanLetterRatio(sample) >= 0.5 ? ["interline"] : [];
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

function splitsCharacter(value: string, offset: number): boolean {
  return offset > 0 && /[\uD800-\uDBFF]/.test(value[offset - 1]!) && /[\uDC00-\uDFFF]/.test(value[offset] ?? "");
}

function boundedEnd(value: string, start: number, length: number): number {
  const end = Math.min(start + length, value.length);
  return splitsCharacter(value, end) ? end - 1 : end;
}

function anchorValue(value: unknown): SelectionAnchor {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid anchor");
  const anchor = value as Record<string, unknown>;
  keys(anchor, ["source", "file", "locator", "quote"]);
  if (!anchor.source || typeof anchor.source !== "object" || Array.isArray(anchor.source)) throw new Error("Invalid anchor source");
  const source = anchor.source as Record<string, unknown>;
  if (source.kind === "lesson") keys(source, ["kind"]);
  else if (source.kind === "material") keys(source, ["kind", "materialId"]);
  else throw new Error("Invalid anchor source");
  return { source: source.kind === "lesson" ? { kind: "lesson" } : { kind: "material", materialId: text(source, "materialId", 200) }, file: text(anchor, "file", 500), locator: text(anchor, "locator", 300), ...(anchor.quote === undefined ? {} : { quote: text(anchor, "quote") }) };
}

function workspaceToolImplementations(store: WorkspaceStore, engine: AttentionEngine | undefined, storage?: WorkspaceStoragePort, http?: HttpPort, repository?: RepositoryPort, mediaCorpus?: MediaCorpusPort, activeTopicId?: string, signal?: AbortSignal, descriptors: readonly ToolkitDescriptor[] = [], reader?: StageReaderService): readonly GuideMcpToolSpec[] {
  const integer = (input: Readonly<Record<string, unknown>>, name: string): number | undefined => {
    const value = input[name];
    if (value === undefined) return undefined;
    if (typeof value !== "number" || !Number.isSafeInteger(value)) throw new Error(`Invalid ${name}`);
    return value;
  };
  return [
    ...(mediaCorpus ? [{ name: "pith_search_media", description: "Search public audio and video for listening practice.", inputSchema: schema({ query: field, limit: { type: "integer", minimum: 1, maximum: 10 } }, ["query"]), async execute(input: Readonly<Record<string, unknown>>) {
      keys(input, ["query", "limit"]); return mediaCorpus.searchMedia(text(input, "query", 500), integer(input, "limit"), signal);
    } }, { name: "pith_fetch_media_corpus", description: "Import public audio and subtitles.", inputSchema: schema({ topicId: field, url: field, lang: field }, ["url"]), async execute(input: Readonly<Record<string, unknown>>) {
      keys(input, ["topicId", "url", "lang"]); const topicId = input.topicId === undefined ? undefined : text(input, "topicId", 200); if (activeTopicId && topicId !== activeTopicId) throw new Error("Topic does not match current session");
      const bundle = await mediaCorpus.fetchMediaCorpus(text(input, "url", 4096), input.lang === undefined ? {} : { lang: text(input, "lang", 40) }, signal); signal?.throwIfAborted();
      const material = await store.importMaterial({ title: bundle.title, kind: "media", files: bundle.files, aids: await importedAids(bundle.files, reader) });
      if (topicId) {
        await store.attachMaterial(topicId, material.id);
        if (bundle.slices?.length) { const sections = bundle.slices.map(slice => `## ${slice.title}\n\n${slice.text.replace(/\s+/g, " ").slice(0, 300)}\n\n跟读建议：先听原声，再逐句跟读。`); await store.writeLesson(topicId, "00-跟读切片导读.md", `# 跟读切片导读\n\n${sections.join("\n\n")}\n`); }
      }
      return { material, slices: bundle.slices ?? [], warnings: bundle.warnings ?? [] };
    } }] : []),
    ...(http ? [{ name: "pith_read_external", description: "Read one public web page or JSON resource without importing it. Returns bounded formatted text and public links with a truncation flag. Use it to search course catalogs and browse course pages before selecting files.", inputSchema: schema({ url: { ...field, maxLength: 4096 } }, ["url"]), async execute(input: Readonly<Record<string, unknown>>) {
      keys(input, ["url"]);
      return readExternal(text(input, "url", 4096), http, signal);
    } }, { name: "pith_ingest_external", description: "Import 1 to 20 public web pages or PDFs as one material using title and urls. For media only, use kind: media and one url with an optional transcriptMarkdown.", inputSchema: {
      ...schema({ title: field, urls: { type: "array", items: { ...field, maxLength: 4096 }, minItems: 1, maxItems: EXTERNAL_DOCUMENT_COUNT }, url: field, kind: { enum: ["article", "discussion", "media"] }, transcriptMarkdown: field, topicId: field }, []),
      oneOf: [{ required: ["title", "urls"], properties: { kind: { enum: ["article", "discussion"] } }, not: { anyOf: [{ required: ["url"] }, { required: ["transcriptMarkdown"] }] } }, { required: ["kind", "url"], properties: { kind: { const: "media" } }, not: { anyOf: [{ required: ["urls"] }, { required: ["title"] }] } }],
    }, async execute(input: Readonly<Record<string, unknown>>) {
      const kind = input.kind;
      if (kind !== undefined && kind !== "article" && kind !== "discussion" && kind !== "media") throw new Error("Invalid kind");
      keys(input, kind === "media" ? ["url", "kind", "transcriptMarkdown", "topicId"] : ["title", "urls", "kind", "topicId"]);
      const topicId = input.topicId === undefined ? undefined : text(input, "topicId", 200);
      if (topicId && !await store.getTopic(topicId)) throw new Error("Topic not found");
      let bundle;
      if (kind === "media") {
        bundle = await ingestExternalUrl({ url: text(input, "url", 4096), kind, ...(input.transcriptMarkdown === undefined ? {} : { transcriptMarkdown: text(input, "transcriptMarkdown", 4000000) }) }, http, signal);
      } else {
        if (!Array.isArray(input.urls) || input.urls.length < 1 || input.urls.length > EXTERNAL_DOCUMENT_COUNT) throw new Error("Expected 1 to 20 external URLs");
        bundle = await ingestExternalDocuments({ title: text(input, "title", 200), urls: input.urls.map(url => text({ url }, "url", 4096)), kind }, http, signal);
      }
      signal?.throwIfAborted();
      const material = await store.importMaterial({ title: bundle.title, kind: bundle.kind, files: bundle.files, aids: await importedAids(bundle.files, reader) });
      if (topicId) await store.attachMaterial(topicId, material.id);
      return { material, warnings: bundle.warnings };
    } }] : []),
    { name: "pith_save_note", description: "Append a learner note to a topic.", inputSchema: schema({ topicId: field, body: field, kind: { enum: ["note", "highlight", "practice"] }, guideRemark: field, anchor: { type: "object" } }, ["topicId", "body"]), async execute(input) {
      keys(input, ["topicId", "body", "kind", "guideRemark", "anchor"]);
      const kind = input.kind === undefined ? "note" : input.kind;
      if (kind !== "note" && kind !== "highlight" && kind !== "practice") throw new Error("Invalid note kind");
      return store.appendTopicNote(text(input, "topicId", 200), { kind, author: "guide", body: text(input, "body"), ...(input.guideRemark === undefined ? {} : { guideRemark: text(input, "guideRemark", 1000) }), ...(input.anchor === undefined ? {} : { anchor: anchorValue(input.anchor) }) });
    } },
    { name: "pith_write_lesson", description: "Write a generated Markdown lesson to the topic.", inputSchema: schema({ topicId: field, fileName: field, markdown: field }, ["topicId", "fileName", "markdown"]), async execute(input) {
      keys(input, ["topicId", "fileName", "markdown"]);
      const fileName = text(input, "fileName", 200), markdown = text(input, "markdown", 100000);
      if (!fileName.endsWith(".md") || /[/\\\0]/.test(fileName)) throw new Error("Invalid lesson file name");
      return store.writeLesson(text(input, "topicId", 200), fileName, markdown);
    } },
    { name: "pith_rebase_lesson", description: "Update an unchanged lesson's repository basis to the latest referenced versions without changing its bytes.", inputSchema: schema({ topicId: field, fileName: field }, ["topicId", "fileName"]), async execute(input) {
      keys(input, ["topicId", "fileName"]);
      return store.rebaseLesson(text(input, "topicId", 200), text(input, "fileName", 200));
    } },
    { name: "pith_configure_toolkits", description: "Configure topic toolkits.", inputSchema: schema({ topicId: field, toolkits: { type: "array", items: field } }, ["topicId", "toolkits"]), async execute(input) {
      keys(input, ["topicId", "toolkits"]);
      if (!Array.isArray(input.toolkits)) throw new Error("Invalid toolkits");
      const topicId = text(input, "topicId", 200), toolkits = normalizeToolkits(input.toolkits, descriptors); return store.updateTopic(topicId, { toolkits });
    } },
    { name: "pith_settle_topic", description: "Settle an exploring topic after a verified explanation, optionally adding or removing observations.", inputSchema: schema({ topicId: field, verificationSummary: field, observations: { type: "array", items: schema({ text: field, noteId: field }, ["text"]) }, removeObservationIds: { type: "array", items: field } }, ["topicId", "verificationSummary"]), async execute(input) {
      keys(input, ["topicId", "verificationSummary", "observations", "removeObservationIds"]);
      const topicId = text(input, "topicId", 200);
      const summary = text(input, "verificationSummary");
      if (/^<!-- pith-note:(?:v1|quote|body|remark|no-remark|end) -->$/m.test(summary)) throw new Error("Reserved note marker");
      const topic = await store.getTopic(topicId);
      if (!topic) throw new Error("Topic not found");
      if (topic.status !== "exploring") throw new Error("Topic is not exploring");
      if (!topic.notes.some(note => note.author === "user" && (note.kind === "note" || note.kind === "practice"))) throw new Error("Settlement requires a learner note");
      if (input.observations !== undefined && !Array.isArray(input.observations)) throw new Error("Invalid observations");
      const observations = (input.observations ?? []) as unknown[];
      const additions = observations.map(value => {
        if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid observation");
        const entry = value as Readonly<Record<string, unknown>>; keys(entry, ["text", "noteId"]);
        const valueText = text(entry, "text", 4000).replace(/\s*[\r\n\u2028\u2029]+\s*/g, " ").trim();
        if (Array.from(valueText).length > 500 || valueText.includes("<!-- pith-observations:")) throw new Error("Invalid observation text");
        const noteId = entry.noteId === undefined ? undefined : text(entry, "noteId", 200);
        if (noteId !== undefined && !topic.notes.some(note => note.id === noteId && note.author === "user")) throw new Error("Note is not user evidence in this topic");
        return { text: valueText, ...(noteId === undefined ? {} : { noteId }) };
      });
      if (input.removeObservationIds !== undefined && (!Array.isArray(input.removeObservationIds) || !input.removeObservationIds.every(id => typeof id === "string" && id.trim()))) throw new Error("Invalid observation IDs");
      const removals = (input.removeObservationIds ?? []) as string[];
      if (new Set(removals).size !== removals.length) throw new Error("Duplicate observation ID");
      if (removals.length) { const existing = (await store.readProfile()).observations; if (removals.some(id => !existing.some(item => item.id === id))) throw new Error("Observation not found"); }
      for (const id of removals) await store.removeObservation(id);
      for (const addition of additions) await store.addObservation({ topicId, ...addition });
      await store.appendTopicNote(topicId, { kind: "note", author: "guide", body: `## 核心认知总结\n\n${summary}` });
      return store.updateTopic(topicId, { status: "settled" });
    } },
  ];
}

function guardToolWrites(storage: WorkspaceStoragePort, signal?: AbortSignal, beginWrite?: () => void): WorkspaceStoragePort {
  let started = false;
  const startWrite = () => { if (!started) { signal?.throwIfAborted(); beginWrite?.(); started = true; } };
  return {
    mutationIdentity: storage.mutationIdentity ?? storage,
    exists: path => storage.exists(path), readText: path => storage.readText(path), readBinary: path => storage.readBinary(path), list: path => storage.list(path),
    writeText: (path, data) => { startWrite(); return storage.writeText(path, data); },
    createText: (path, data) => { startWrite(); return storage.createText(path, data); },
    writeBinary: (path, data) => { startWrite(); return storage.writeBinary(path, data); },
    createBinary: (path, data) => { startWrite(); return storage.createBinary(path, data); },
    copy: (from, to) => { startWrite(); return storage.copy(from, to); },
    processText: (path, update) => { startWrite(); return storage.processText(path, update); },
    mkdir: async path => { if (await storage.exists(path)) return; startWrite(); await storage.mkdir(path); },
  };
}

export function createScopedTools(options: { topicId?: string; materialIds?: readonly string[]; store: WorkspaceStore; storage: WorkspaceStoragePort; engine?: AttentionEngine; http?: HttpPort; repository?: RepositoryPort; mediaCorpus?: MediaCorpusPort; reader?: StageReaderService; toolkits?: readonly ToolkitDescriptor[]; onChoices: (choices: readonly string[]) => void }): TurnTool[] {
  const { store, storage, engine, http, repository, mediaCorpus } = options;
  const training = options.toolkits ?? [];
  let topicId = options.topicId, creating = false;
  const original = workspaceToolImplementations(store, engine, storage, http, repository, mediaCorpus, undefined, undefined, training, options.reader);
  const tools: TurnTool[] = [];
  if (!topicId) tools.push({ name: "pith_create_topic", description: "Create one topic for this intake.", inputSchema: schema({ title: field, target: field, materialIds: { type: "array", items: field }, toolkits: { type: "array", items: field } }, ["title", "target", "materialIds", "toolkits"]), write: true, async execute(input, signal, beginWrite) {
    keys(input, ["title", "target", "materialIds", "toolkits"]);
    if (topicId || creating) throw new Error("Topic already created or being created");
    if (!Array.isArray(input.materialIds) || !input.materialIds.every(id => typeof id === "string") || !Array.isArray(input.toolkits)) throw new Error("Invalid topic arguments");
    creating = true;
    try {
      for (const id of input.materialIds) if (!await store.getMaterial(id as string)) throw new Error("Material not found");
      signal?.throwIfAborted();
      const topic = await new DefaultWorkspaceStore(guardToolWrites(storage, signal, beginWrite)).createTopic({ title: text(input, "title"), target: text(input, "target"), materialIds: input.materialIds as string[], toolkits: normalizeToolkits(input.toolkits, training) });
      topicId = topic.id;
      return topic;
    } finally { creating = false; }
  }, effects(result) { const topic = result as { id: string }; return [{ kind: "topic", topicId: topic.id }]; } });
  for (const tool of original) {
    if (!["pith_save_note", "pith_write_lesson", "pith_rebase_lesson", "pith_configure_toolkits", "pith_settle_topic", "pith_ingest_external", "pith_read_external", "pith_search_media", "pith_fetch_media_corpus"].includes(tool.name)) continue;
    const source = tool.inputSchema as { properties?: Record<string, unknown>; required?: string[] };
    const properties = { ...source.properties }; delete properties.topicId;
    const inputSchema = { ...tool.inputSchema, properties, required: (source.required ?? []).filter(name => name !== "topicId") };
    const write = !["pith_read_external", "pith_search_media"].includes(tool.name);
    tools.push({ name: tool.name, description: tool.description, inputSchema, write, async execute(input, signal, beginWrite) {
      if ("topicId" in input) throw new Error("Invalid tool arguments");
      if (!topicId && write && !["pith_ingest_external", "pith_fetch_media_corpus"].includes(tool.name)) throw new Error("先创建课题");
      const guarded = guardToolWrites(storage, signal, beginWrite);
      const currentStore = write ? new DefaultWorkspaceStore(guarded) : store;
      const current = workspaceToolImplementations(currentStore, engine, guarded, http, repository, mediaCorpus, topicId, signal, training, options.reader).find(item => item.name === tool.name)!;
      const before = tool.name === "pith_settle_topic" ? (await store.readProfile()).observations : [];
      const topicBefore = tool.name === "pith_settle_topic" && topicId ? await store.getTopic(topicId) : null;
      const historyBefore = tool.name === "pith_settle_topic" && await storage.exists("history") ? new Set((await storage.list("history")).map(item => item.path)) : new Set<string>();
      try {
        const result = await current.execute({ ...input, ...(write && topicId ? { topicId } : {}) });
        if (tool.name === "pith_settle_topic") return { topic: result, observations: (await store.readProfile()).observations.filter(item => !before.some(previous => previous.id === item.id)) };
        return result;
      } catch (cause) {
        if (tool.name !== "pith_settle_topic") throw cause;
        const message = cause instanceof Error ? cause.message : String(cause);
        try {
          const after = (await store.readProfile()).observations;
          const added = after.filter(item => item.topicId === topicId && !before.some(previous => previous.id === item.id));
          const removed = before.filter(item => !after.some(currentItem => currentItem.id === item.id));
          const topicAfter = topicId ? await store.getTopic(topicId) : null;
          const notes = topicAfter?.notes.filter(note => !topicBefore?.notes.some(previous => previous.id === note.id)) ?? [];
          const backups = await storage.exists("history") ? (await storage.list("history")).map(item => item.path).filter(path => !historyBefore.has(path)).sort() : [];
          const details = `${removed.length ? `；已撤回观察 ${removed.map(item => item.id).join(", ")}` : ""}${added.length || removed.length ? `；写前留底：${backups.join(", ") || "无法确认"}` : ""}`;
          throw new ToolExecutionFailure(`${message}；课题状态：${topicAfter?.status ?? "未知"}${added.length ? `；已写入观察：${added.map(item => `${item.id} ${item.text}`).join("；")}；对应对话若有观察行可撤销，否则请核对画像与留底` : ""}${details}`, [...notes.map(note => ({ kind: "note" as const, noteId: note.id })), ...added.map(item => ({ kind: "observation" as const, observationId: item.id, text: item.text }))]);
        } catch (reconciliation) {
          if (reconciliation instanceof ToolExecutionFailure) throw reconciliation;
          throw new ToolExecutionFailure(`${message}；无法核对画像写入，请检查 ME.md 和 history 留底`, []);
        }
      }
    }, effects(result, input) {
      const value = result as Record<string, unknown>;
      if (tool.name === "pith_save_note" && typeof value?.id === "string") return [{ kind: "note", noteId: value.id }];
      if (["pith_write_lesson", "pith_rebase_lesson"].includes(tool.name) && typeof input.fileName === "string") return [{ kind: "lesson", fileName: input.fileName }];
      if (tool.name === "pith_configure_toolkits" && Array.isArray(value?.toolkits)) return [{ kind: "toolkits", toolkits: value.toolkits as string[] }];
      if (tool.name === "pith_settle_topic" && topicId) return [{ kind: "topic", topicId }, ...((Array.isArray(value?.observations) ? value.observations : []) as { id: string; text: string }[]).map(item => ({ kind: "observation" as const, observationId: item.id, text: item.text }))];
      const material = value?.material as Record<string, unknown> | undefined;
      if (material && typeof material.id === "string") return [{ kind: "material", materialId: material.id }];
      return [];
    } });
  }
  const scopedMaterial = async (input: Readonly<Record<string, unknown>>) => {
    if (typeof input.materialId !== "string" || !input.materialId) throw new Error("Invalid materialId");
    const topic = topicId ? await store.getTopic(topicId) : null;
    if (topicId ? !topic || !topic.materialIds.includes(input.materialId) : !await store.getMaterial(input.materialId)) throw new Error("Material does not belong to scope");
    const material = await store.getMaterial(input.materialId);
    if (!material) throw new Error("Material not found");
    return material;
  };
  const checkKeys = (input: Readonly<Record<string, unknown>>, allowed: readonly string[]) => { if (Object.keys(input).some(key => !allowed.includes(key))) throw new Error("Invalid tool arguments"); };
  const number = (input: Readonly<Record<string, unknown>>, key: string) => { const value = input[key]; if (value !== undefined && (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)) throw new Error(`Invalid ${key}`); return value as number | undefined; };
  tools.push({
    name: "pith_list_library",
    description: "List workspace materials and topics with reference counts, activity, and repository versions. Optional case-insensitive keyword matches material titles and topic titles or targets. Offset and limit apply separately to each list.",
    inputSchema: schema({ keyword: field, offset: { type: "integer", minimum: 0 }, limit: { type: "integer", minimum: 1, maximum: 200, default: 50 } }, []),
    write: false,
    async execute(input, signal) {
      keys(input, ["keyword", "offset", "limit"]);
      const keyword = input.keyword === undefined ? "" : text(input, "keyword", 500).toLowerCase();
      const offset = number(input, "offset") ?? 0;
      const requested = number(input, "limit") ?? 50;
      if (requested < 1) throw new Error("Invalid limit");
      const end = offset + Math.min(requested, 200);
      const [materials, topics] = await Promise.all([store.listMaterials(), store.listTopics()]);
      signal?.throwIfAborted();
      const overview = libraryOverview(materials, topics);
      const matches = (value: string) => value.toLowerCase().includes(keyword);
      const matchingMaterials = overview.materials.filter(material => matches(material.title));
      const matchingTopics = overview.topics.filter(topic => matches(topic.title) || matches(topic.target));
      const materialTotal = matchingMaterials.length, topicTotal = matchingTopics.length;
      const truncated = end < Math.max(materialTotal, topicTotal);
      return {
        materials: matchingMaterials.slice(offset, end),
        topics: matchingTopics.slice(offset, end),
        materialTotal, topicTotal, truncated,
        ...(truncated ? { nextOffset: end } : {}),
      };
    },
  });
  tools.push({
    name: "pith_attach_material",
    description: "Reference an existing library material in this topic. In intake, first create a topic. To change a repository version already referenced, ask the user to use 改用 in the contents.",
    inputSchema: schema({ materialId: field }, ["materialId"]),
    write: true,
    async execute(input, signal, beginWrite) {
      keys(input, ["materialId"]);
      const activeTopicId = topicId;
      if (!activeTopicId) throw new Error("先创建课题");
      const materialId = text(input, "materialId", 200);
      const [material, topic] = await Promise.all([store.getMaterial(materialId), store.getTopic(activeTopicId)]);
      if (!material) throw new Error("Material not found");
      if (!topic) throw new Error("Topic not found");
      if (topic.status === "settled") throw new Error("已沉淀的课题不可添加材料");
      if (topic.materialIds.includes(materialId)) throw new Error("本课题已引用这份材料");
      if (material.kind === "repo" && material.externalPath) {
        const referenced = await Promise.all(topic.materialIds.map(id => store.getMaterial(id)));
        if (referenced.some(item => item?.kind === "repo" && item.externalPath === material.externalPath)) {
          throw new Error("同一仓库的新版本请在目录里点「改用」");
        }
      }
      signal?.throwIfAborted();
      const updated = await new DefaultWorkspaceStore(guardToolWrites(storage, signal, beginWrite)).attachMaterial(activeTopicId, materialId);
      return { topicId: updated.id, materialId };
    },
    effects(result) { return [{ kind: "topic", topicId: (result as { topicId: string }).topicId }]; },
  });
  if (options.topicId) tools.push({ name: "pith_compare_material", description: "Compare two referenced versions of the same repository. Supply path for a bounded patch; otherwise page change metadata. Start with paths cited in each lesson.", inputSchema: schema({ fromMaterialId: field, toMaterialId: field, path: field, offset: { type: "integer", minimum: 0 }, limit: { type: "integer", minimum: 1, maximum: 1000, default: 200 }, maxLines: { type: "integer", minimum: 1, maximum: 2000, default: 400 } }, ["fromMaterialId", "toMaterialId"]), write: false, async execute(input) {
    checkKeys(input, ["fromMaterialId", "toMaterialId", "path", "offset", "limit", "maxLines"]);
    const from = await scopedMaterial({ materialId: input.fromMaterialId }), to = await scopedMaterial({ materialId: input.toMaterialId });
    if (from.kind !== "repo" || to.kind !== "repo" || !from.externalPath || from.externalPath !== to.externalPath || !from.commitSha || !to.commitSha) throw new Error("Materials must be versions of the same repository");
    if (!repository) throw new Error("Repository unavailable");
    if (input.path !== undefined) {
      if (input.offset !== undefined || input.limit !== undefined) throw new Error("Pagination is only for change lists");
      return repository.readChange(from.externalPath, from.commitSha, to.commitSha, text(input, "path", 4096), number(input, "maxLines"));
    }
    if (input.maxLines !== undefined) throw new Error("maxLines requires path");
    return repository.listChanges(from.externalPath, from.commitSha, to.commitSha, number(input, "offset"), number(input, "limit"));
  } });
  tools.push({ name: "pith_search_material", description: "Search UTF-8 text in a repository material's pinned commit. Returns path, 1-based line, text (up to 300 characters) and truncated. Literal and case-insensitive by default; optional POSIX extended regex, case sensitivity and literal path prefix. Read matching lines with pith_read_material.", inputSchema: schema({ materialId: field, pattern: field, regex: { type: "boolean" }, caseSensitive: { type: "boolean" }, pathPrefix: field, limit: { type: "integer", minimum: 1, maximum: 200, default: 50 } }, ["materialId", "pattern"]), write: false, async execute(input) {
    checkKeys(input, ["materialId", "pattern", "regex", "caseSensitive", "pathPrefix", "limit"]);
    const material = await scopedMaterial(input);
    if (material.kind !== "repo") throw new Error("搜索仅支持仓库材料");
    if (!repository || !material.externalPath || !material.commitSha) throw new Error("Repository unavailable");
    if (typeof input.pattern !== "string" || !input.pattern || (input.pathPrefix !== undefined && typeof input.pathPrefix !== "string")) throw new Error("Invalid search text");
    if ((input.regex !== undefined && typeof input.regex !== "boolean") || (input.caseSensitive !== undefined && typeof input.caseSensitive !== "boolean")) throw new Error("Invalid search option");
    return repository.searchFiles(material.externalPath, material.commitSha, { pattern: input.pattern, regex: input.regex as boolean | undefined, caseSensitive: input.caseSensitive as boolean | undefined, pathPrefix: input.pathPrefix as string | undefined, limit: number(input, "limit") });
  } });
  tools.push({ name: "pith_list_material", description: "List files in the current material.", inputSchema: { type: "object", properties: { materialId: { type: "string" }, offset: { type: "integer" }, limit: { type: "integer" } }, required: ["materialId"], additionalProperties: false }, write: false, async execute(input) {
    checkKeys(input, ["materialId", "offset", "limit"]); const material = await scopedMaterial(input);
    if (material.kind === "repo") { if (!repository || !material.externalPath || !material.commitSha) throw new Error("Repository unavailable"); return repository.listFiles(material.externalPath, material.commitSha, number(input, "offset"), number(input, "limit")); }
    return { files: material.files };
  } });
  tools.push({ name: "pith_read_material", description: "Read a bounded portion of the current material. Continue using next.startLine and next.startOffset.", inputSchema: { type: "object", properties: { materialId: { type: "string" }, file: { type: "string" }, startLine: { type: "integer" }, startOffset: { type: "integer" }, maxLines: { type: "integer" } }, required: ["materialId", "file"], additionalProperties: false }, write: false, async execute(input) {
    checkKeys(input, ["materialId", "file", "startLine", "startOffset", "maxLines"]); const material = await scopedMaterial(input);
    if (typeof input.file !== "string" || !input.file) throw new Error("Invalid file");
    if (material.kind === "repo") {
      if (!repository || !material.externalPath || !material.commitSha) throw new Error("Repository unavailable");
      if (material.externalPath.length > 4096 || input.file.length > 4096 || material.commitSha.length > 64) throw new Error("Repository binding exceeds limit");
      const startLine = number(input, "startLine") ?? 1, startOffset = number(input, "startOffset") ?? 0;
      const excerpt = await repository.readFile(material.externalPath, material.commitSha, input.file, startLine, number(input, "maxLines"));
      const firstEnd = excerpt.text.indexOf("\n"), firstLength = firstEnd < 0 ? excerpt.text.length : firstEnd;
      if (startOffset > firstLength || splitsCharacter(excerpt.text, startOffset)) throw new Error("Invalid material cursor");
      const available = excerpt.text.slice(startOffset) + (excerpt.truncated ? "\n" : "");
      const end = boundedEnd(available, 0, 12000), value = available.slice(0, end);
      const lines = (value.match(/\n/g) ?? []).length, lastBreak = value.lastIndexOf("\n");
      const truncated = end < available.length || excerpt.truncated;
      const next = truncated ? { startLine: startLine + lines, startOffset: lines ? value.length - lastBreak - 1 : startOffset + value.length } : null;
      return { externalPath: material.externalPath, commitSha: material.commitSha, path: input.file, startLine, endLine: startLine + Math.max(0, lines - (value.endsWith("\n") ? 1 : 0)), text: value, truncated, next };
    }
    const file = material.files.find(item => item.name === input.file);
    if (!file || /[/\\\0]/.test(file.name) || file.name === "." || file.name === "..") throw new Error("Material file not found");
    if (!options.reader?.renderFile) throw new Error("Reader unavailable");
    const rendered = await options.reader.renderFile(file, await storage.readBinary(`materials/${material.id}/files/${file.name}`));
    const blocks = rendered.blocks ?? [];
    const offset = number(input, "startLine") ?? 0, characterOffset = number(input, "startOffset") ?? 0, limit = Math.min(number(input, "maxLines") ?? 40, 200);
    if (limit < 1 || offset > blocks.length || (offset === blocks.length && characterOffset !== 0) || (offset < blocks.length && characterOffset > blocks[offset]!.text.length)) throw new Error("Invalid material cursor");
    if (offset < blocks.length && splitsCharacter(blocks[offset]!.text, characterOffset)) throw new Error("Invalid material cursor");
    let remaining = 12000, line = offset, position = characterOffset;
    const selected: { index: number; locator: string; isProse: boolean; text: string }[] = [];
    while (line < blocks.length && selected.length < limit && remaining > 0) {
      const block = blocks[line]!;
      if (block.locator.length > 512) throw new Error("Material locator exceeds limit");
      const end = boundedEnd(block.text, position, remaining);
      const value = block.text.slice(position, end);
      selected.push({ index: block.index, locator: block.locator, isProse: block.isProse, text: value });
      remaining -= value.length; position += value.length;
      if (position < block.text.length) break;
      line++; position = 0;
    }
    return { blocks: selected, truncated: line < blocks.length, next: line < blocks.length ? { startLine: line, startOffset: position } : null };
  } });
  tools.push({ name: "pith_read_lesson", description: "Read a lesson in the current topic.", inputSchema: { type: "object", properties: { fileName: { type: "string" } }, required: ["fileName"], additionalProperties: false }, write: false, async execute(input) {
    checkKeys(input, ["fileName"]); if (typeof input.fileName !== "string" || !input.fileName || /[/\\\0]/.test(input.fileName) || input.fileName === "." || input.fileName === "..") throw new Error("Invalid file name");
    if (!topicId) throw new Error("先创建课题");
    return { text: (await store.readLesson(topicId, input.fileName)).slice(0, 12000) };
  } });
  tools.push({ name: "pith_offer_choices", description: "Offer two to four next actions.", inputSchema: { type: "object", properties: { choices: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 4 } }, required: ["choices"], additionalProperties: false }, write: false, async execute(input) {
    if (Object.keys(input).some(key => key !== "choices") || !Array.isArray(input.choices) || input.choices.length < 2 || input.choices.length > 4 || !input.choices.every(item => typeof item === "string" && item.trim())) throw new Error("Invalid choices");
    options.onChoices(input.choices as string[]); return { choices: input.choices };
  } });
  return tools;
}
