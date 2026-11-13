import { DefaultWorkspaceStore, builtinRegistry, type StageReaderService, type AttentionEngine, type GuideMcpToolSpec, type HttpPort, type MediaCorpusPort, type RepositoryPort, type SelectionAnchor, type WorkspaceStoragePort, type WorkspaceStore } from "../../core/index.ts";
import { ingestExternalUrl } from "./externalIngest.ts";
import { ToolExecutionFailure, type TurnTool } from "./mcpTools.ts";

export function normalizeToolkits(value: readonly unknown[]): string[] {
  const registered = new Set(builtinRegistry.list().filter(manifest => manifest.id.startsWith("toolkit-")).map(manifest => manifest.id.slice("toolkit-".length)));
  if (!Array.isArray(value) || !value.every(item => typeof item === "string" && registered.has(item))) throw new Error("Invalid toolkit IDs");
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
  keys(anchor, ["file", "locator", "quote"]);
  return { file: text(anchor, "file", 500), locator: text(anchor, "locator", 300), ...(anchor.quote === undefined ? {} : { quote: text(anchor, "quote") }) };
}

function workspaceToolImplementations(store: WorkspaceStore, engine: AttentionEngine | undefined, storage?: WorkspaceStoragePort, http?: HttpPort, repository?: RepositoryPort, mediaCorpus?: MediaCorpusPort, activeTopicId?: string, signal?: AbortSignal): readonly GuideMcpToolSpec[] {
  const integer = (input: Readonly<Record<string, unknown>>, name: string): number | undefined => {
    const value = input[name];
    if (value === undefined) return undefined;
    if (typeof value !== "number" || !Number.isSafeInteger(value)) throw new Error(`Invalid ${name}`);
    return value;
  };
  return [
    ...(mediaCorpus ? [{ name: "pith_search_media", description: "Search public audio and video for listening practice.", inputSchema: schema({ query: field, limit: { type: "integer", minimum: 1, maximum: 10 } }, ["query"]), async execute(input: Readonly<Record<string, unknown>>) {
      keys(input, ["query", "limit"]); return mediaCorpus.searchMedia(text(input, "query", 500), integer(input, "limit"), signal);
    } }, { name: "pith_fetch_media_corpus", description: "Import public audio and subtitles into the current topic and enable shadowing.", inputSchema: schema({ topicId: field, url: field, lang: field }, ["topicId", "url"]), async execute(input: Readonly<Record<string, unknown>>) {
      keys(input, ["topicId", "url", "lang"]); const topicId = text(input, "topicId", 200); if (activeTopicId && topicId !== activeTopicId) throw new Error("Topic does not match current session"); const topic = await store.getTopic(topicId); if (!topic) throw new Error("Topic not found");
      const bundle = await mediaCorpus.fetchMediaCorpus(text(input, "url", 4096), input.lang === undefined ? {} : { lang: text(input, "lang", 40) }, signal); signal?.throwIfAborted();
      const current = await store.getTopic(topicId); if (!current || current.materialId !== topic.materialId) throw new Error("Topic material changed");
      let material; if (current.materialId) { if (!store.appendMaterialFiles) throw new Error("Material append unavailable"); material = await store.appendMaterialFiles(current.materialId, bundle.files); } else { material = await store.importMaterial({ title: bundle.title, kind: "media", files: bundle.files }); }
      if (bundle.slices?.length) { if (!store.writeGeneratedFile) throw new Error("Generated lesson unavailable"); const sections = bundle.slices.map(slice => `## ${slice.title}\n\n${slice.text.replace(/\s+/g, " ").slice(0, 300)}\n\n跟读建议：先听原声，再逐句跟读。`); material = await store.writeGeneratedFile(material.id, "00-跟读切片导读.md", `# 跟读切片导读\n\n${sections.join("\n\n")}\n`); }
      const latest = await store.getTopic(topicId); if (!latest || latest.materialId !== current.materialId) throw new Error("Topic material changed");
      const toolkits = [...new Set([...latest.toolkits, "shadowing"])]; await store.updateTopic(topicId, { ...(latest.materialId ? {} : { materialId: material.id }), toolkits });
      return { material, slices: bundle.slices ?? [], warnings: bundle.warnings ?? [] };
    } }] : []),
    ...(http ? [{ name: "pith_ingest_external", description: "Import a public external document or media into the workspace.", inputSchema: schema({ url: field, kind: { enum: ["article", "discussion", "media"] }, transcriptMarkdown: field, topicId: field }, ["url"]), async execute(input: Readonly<Record<string, unknown>>) {
      keys(input, ["url", "kind", "transcriptMarkdown", "topicId"]);
      const kind = input.kind;
      if (kind !== undefined && kind !== "article" && kind !== "discussion" && kind !== "media") throw new Error("Invalid kind");
      const topicId = input.topicId === undefined ? undefined : text(input, "topicId", 200);
      const initialTopic = topicId ? await store.getTopic(topicId) : null;
      if (topicId && !initialTopic) throw new Error("Topic not found");
      const bundle = await ingestExternalUrl({ url: text(input, "url", 4096), kind, ...(input.transcriptMarkdown === undefined ? {} : { transcriptMarkdown: text(input, "transcriptMarkdown", 4000000) }) }, http, signal);
      signal?.throwIfAborted();
      const material = await store.importMaterial({ title: bundle.title, kind: bundle.kind, files: bundle.files });
      if (topicId) {
        if (!store.updateTopicIfUnchanged) throw new Error("Conditional topic update unavailable");
        const markdown = bundle.files.filter(file => /\.md$/i.test(file.name)).map(file => new TextDecoder("utf-8", { fatal: true }).decode(file.bytes)).join(" ");
        const chars = Array.from(markdown).filter(char => !/\s/u.test(char)); const foreign = chars.filter(char => /\p{L}/u.test(char) && !/\p{Script=Han}/u.test(char)).length;
        let updated = false;
        for (let attempt = 0; attempt < 5 && !updated; attempt++) {
          const topic = await store.getTopic(topicId); if (!topic) throw new Error("Topic not found"); if (topic.materialId !== initialTopic?.materialId) throw new Error("Topic material changed");
          const provisional = !topic.materialId && topic.toolkitsOrigin === "default" && topic.toolkits.length === 1 && topic.toolkits[0] === "feynman";
          const toolkits = chars.length && foreign / chars.length >= .5 ? [...new Set([...(provisional ? [] : topic.toolkits), "interline"])] : topic.toolkits;
          updated = !!await store.updateTopicIfUnchanged(topicId, topic, { materialId: material.id, toolkits, ...(provisional ? { toolkitsOrigin: "default" } : topic.toolkitsOrigin ? { toolkitsOrigin: topic.toolkitsOrigin } : {}) });
        }
        if (!updated) throw new Error("Topic changed during import");
      }
      return { material, warnings: bundle.warnings };
    } }] : []),
    { name: "pith_save_note", description: "Append a learner note to a topic.", inputSchema: schema({ topicId: field, body: field, kind: { enum: ["note", "highlight", "practice"] }, guideRemark: field, anchor: { type: "object" } }, ["topicId", "body"]), async execute(input) {
      keys(input, ["topicId", "body", "kind", "guideRemark", "anchor"]);
      const kind = input.kind === undefined ? "note" : input.kind;
      if (kind !== "note" && kind !== "highlight" && kind !== "practice") throw new Error("Invalid note kind");
      return store.appendNote(text(input, "topicId", 200), { kind, body: text(input, "body"), ...(input.guideRemark === undefined ? {} : { guideRemark: text(input, "guideRemark", 1000) }), ...(input.anchor === undefined ? {} : { anchor: anchorValue(input.anchor) }) });
    } },
    { name: "pith_write_lesson", description: "Write a generated Markdown lesson; create a material for a topic without one.", inputSchema: schema({ topicId: field, materialId: field, fileName: field, markdown: field }, ["fileName", "markdown"]), async execute(input) {
      keys(input, ["topicId", "materialId", "fileName", "markdown"]);
      const fileName = text(input, "fileName", 200), markdown = text(input, "markdown", 100000);
      if (!fileName.endsWith(".md") || /[/\\\0]/.test(fileName)) throw new Error("Invalid lesson file name");
      let materialId = input.materialId === undefined ? undefined : text(input, "materialId", 200);
      if (input.topicId !== undefined) {
        const topic = await store.getTopic(text(input, "topicId", 200));
        if (!topic) throw new Error("Topic not found");
        if (materialId && topic.materialId !== materialId) throw new Error("Material does not belong to topic");
        materialId = topic.materialId;
        if (!materialId) { const material = await store.importMaterial({ title: topic.title, kind: "article", files: [] }); await store.updateTopic(topic.id, { materialId: material.id }); materialId = material.id; }
      }
      if (!materialId) throw new Error("Topic or material required");
      return store.writeGeneratedFile(materialId, fileName, markdown);
    } },
    { name: "pith_configure_toolkits", description: "Configure topic toolkits.", inputSchema: schema({ topicId: field, toolkits: { type: "array", items: field } }, ["topicId", "toolkits"]), async execute(input) {
      keys(input, ["topicId", "toolkits"]);
      if (!Array.isArray(input.toolkits)) throw new Error("Invalid toolkits");
      const topicId = text(input, "topicId", 200), toolkits = normalizeToolkits(input.toolkits); return store.updateTopic(topicId, { toolkits });
    } },
    { name: "pith_settle_topic", description: "Settle an exploring topic after a verified explanation, optionally adding or removing observations.", inputSchema: schema({ topicId: field, verificationSummary: field, observations: { type: "array", items: schema({ text: field, noteId: field }, ["text"]) }, removeObservationIds: { type: "array", items: field } }, ["topicId", "verificationSummary"]), async execute(input) {
      keys(input, ["topicId", "verificationSummary", "observations", "removeObservationIds"]);
      const topicId = text(input, "topicId", 200);
      const summary = text(input, "verificationSummary");
      if (/^<!-- pith-note:(?:v1|quote|body|remark|no-remark|end) -->$/m.test(summary)) throw new Error("Reserved note marker");
      const topic = await store.getTopic(topicId);
      if (!topic) throw new Error("Topic not found");
      if (topic.status !== "exploring") throw new Error("Topic is not exploring");
      if (topic.notes.length === 0) throw new Error("Settlement requires a learner note");
      if (input.observations !== undefined && !Array.isArray(input.observations)) throw new Error("Invalid observations");
      const observations = (input.observations ?? []) as unknown[];
      const additions = observations.map(value => {
        if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid observation");
        const entry = value as Readonly<Record<string, unknown>>; keys(entry, ["text", "noteId"]);
        const valueText = text(entry, "text", 4000).replace(/\s*[\r\n\u2028\u2029]+\s*/g, " ").trim();
        if (Array.from(valueText).length > 500 || valueText.includes("<!-- pith-observations:")) throw new Error("Invalid observation text");
        const noteId = entry.noteId === undefined ? undefined : text(entry, "noteId", 200);
        if (noteId !== undefined && !topic.notes.some(note => note.id === noteId)) throw new Error("Note does not belong to topic");
        return { text: valueText, ...(noteId === undefined ? {} : { noteId }) };
      });
      if (input.removeObservationIds !== undefined && (!Array.isArray(input.removeObservationIds) || !input.removeObservationIds.every(id => typeof id === "string" && id.trim()))) throw new Error("Invalid observation IDs");
      const removals = (input.removeObservationIds ?? []) as string[];
      if (new Set(removals).size !== removals.length) throw new Error("Duplicate observation ID");
      if (removals.length) { const existing = (await store.readProfile()).observations; if (removals.some(id => !existing.some(item => item.id === id))) throw new Error("Observation not found"); }
      for (const id of removals) await store.removeObservation(id);
      for (const addition of additions) await store.addObservation({ topicId, ...addition });
      await store.appendNote(topicId, { kind: "note", body: `## 核心认知总结\n\n${summary}` });
      return store.updateTopic(topicId, { status: "settled" });
    } },
  ];
}

export function createScopedTools(options: { topicId: string; store: WorkspaceStore; storage: WorkspaceStoragePort; engine?: AttentionEngine; http?: HttpPort; repository?: RepositoryPort; mediaCorpus?: MediaCorpusPort; reader?: StageReaderService; onChoices: (choices: readonly string[]) => void }): TurnTool[] {
  const { topicId, store, storage, engine, http, repository, mediaCorpus } = options;
  const original = workspaceToolImplementations(store, engine, storage, http, repository, mediaCorpus, topicId);
  const tools: TurnTool[] = [];
  for (const tool of original) {
    if (!["pith_save_note", "pith_write_lesson", "pith_configure_toolkits", "pith_settle_topic", "pith_ingest_external", "pith_search_media", "pith_fetch_media_corpus"].includes(tool.name)) continue;
    const source = tool.inputSchema as { properties?: Record<string, unknown>; required?: string[] };
    const properties = { ...source.properties }; delete properties.topicId;
    if (tool.name === "pith_write_lesson") delete properties.materialId;
    const inputSchema = { ...tool.inputSchema, properties, required: (source.required ?? []).filter(name => name !== "topicId" && name !== "materialId") };
    const write = tool.name !== "pith_search_media";
    tools.push({ name: tool.name, description: tool.description, inputSchema, write, async execute(input, signal) {
      if ("topicId" in input || (tool.name === "pith_write_lesson" && "materialId" in input)) throw new Error("Invalid tool arguments");
      let started = false;
      const guarded: WorkspaceStoragePort = {
        mutationIdentity: storage.mutationIdentity ?? storage,
        exists: path => storage.exists(path), readText: path => storage.readText(path), readBinary: path => storage.readBinary(path), list: path => storage.list(path),
        writeText: (path, data) => { if (!started) signal?.throwIfAborted(); started = true; return storage.writeText(path, data); },
        createText: (path, data) => { if (!started) signal?.throwIfAborted(); started = true; return storage.createText(path, data); },
        writeBinary: (path, data) => { if (!started) signal?.throwIfAborted(); started = true; return storage.writeBinary(path, data); },
        createBinary: (path, data) => { if (!started) signal?.throwIfAborted(); started = true; return storage.createBinary(path, data); },
        copy: (from, to) => { if (!started) signal?.throwIfAborted(); started = true; return storage.copy(from, to); },
        processText: (path, update) => { if (!started) signal?.throwIfAborted(); started = true; return storage.processText(path, update); },
        mkdir: async path => { if (await storage.exists(path)) return; if (!started) signal?.throwIfAborted(); started = true; await storage.mkdir(path); },
      };
      const currentStore = write ? new DefaultWorkspaceStore(guarded) : store;
      const current = workspaceToolImplementations(currentStore, engine, guarded, http, repository, mediaCorpus, topicId, signal).find(item => item.name === tool.name)!;
      const before = tool.name === "pith_settle_topic" ? (await store.readProfile()).observations : [];
      const topicBefore = tool.name === "pith_settle_topic" ? await store.getTopic(topicId) : null;
      const historyBefore = tool.name === "pith_settle_topic" && await storage.exists("history") ? new Set((await storage.list("history")).map(item => item.path)) : new Set<string>();
      try {
        const result = await current.execute({ ...input, ...(tool.name === "pith_search_media" ? {} : { topicId }) });
        if (tool.name === "pith_settle_topic") return { topic: result, observations: (await store.readProfile()).observations.filter(item => !before.some(previous => previous.id === item.id)) };
        return result;
      } catch (cause) {
        if (tool.name !== "pith_settle_topic") throw cause;
        const message = cause instanceof Error ? cause.message : String(cause);
        try {
          const after = (await store.readProfile()).observations;
          const added = after.filter(item => item.topicId === topicId && !before.some(previous => previous.id === item.id));
          const removed = before.filter(item => !after.some(currentItem => currentItem.id === item.id));
          const topicAfter = await store.getTopic(topicId);
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
      if (tool.name === "pith_write_lesson" && typeof input.fileName === "string") return [{ kind: "lesson", fileName: input.fileName }];
      if (tool.name === "pith_configure_toolkits" && Array.isArray(value?.toolkits)) return [{ kind: "toolkits", toolkits: value.toolkits as string[] }];
      if (tool.name === "pith_settle_topic") return [{ kind: "topic", topicId }, ...((Array.isArray(value?.observations) ? value.observations : []) as { id: string; text: string }[]).map(item => ({ kind: "observation" as const, observationId: item.id, text: item.text }))];
      const material = value?.material as Record<string, unknown> | undefined;
      if (material && typeof material.id === "string") return [{ kind: "material", materialId: material.id }];
      return [];
    } });
  }
  const scopedMaterial = async (input: Readonly<Record<string, unknown>>) => {
    if (typeof input.materialId !== "string" || !input.materialId) throw new Error("Invalid materialId");
    const topic = await store.getTopic(topicId);
    if (!topic || topic.materialId !== input.materialId) throw new Error("Material does not belong to topic");
    const material = await store.getMaterial(input.materialId);
    if (!material) throw new Error("Material not found");
    return material;
  };
  const checkKeys = (input: Readonly<Record<string, unknown>>, allowed: readonly string[]) => { if (Object.keys(input).some(key => !allowed.includes(key))) throw new Error("Invalid tool arguments"); };
  const number = (input: Readonly<Record<string, unknown>>, key: string) => { const value = input[key]; if (value !== undefined && (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)) throw new Error(`Invalid ${key}`); return value as number | undefined; };
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
    const topic = await store.getTopic(topicId); if (!topic?.materialId) throw new Error("Lesson not found");
    const material = await store.getMaterial(topic.materialId); if (!material?.files.some(file => file.name === input.fileName)) throw new Error("Lesson not found");
    return { text: (await storage.readText(`materials/${material.id}/files/${input.fileName}`)).slice(0, 12000) };
  } });
  tools.push({ name: "pith_offer_choices", description: "Offer two to four next actions.", inputSchema: { type: "object", properties: { choices: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 4 } }, required: ["choices"], additionalProperties: false }, write: false, async execute(input) {
    if (Object.keys(input).some(key => key !== "choices") || !Array.isArray(input.choices) || input.choices.length < 2 || input.choices.length > 4 || !input.choices.every(item => typeof item === "string" && item.trim())) throw new Error("Invalid choices");
    options.onChoices(input.choices as string[]); return { choices: input.choices };
  } });
  return tools;
}
