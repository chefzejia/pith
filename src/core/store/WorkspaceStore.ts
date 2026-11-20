import type { WorkspaceStoragePort } from "../host.ts";
import type { LearnerProfile, Material, MaterialFileEntry, MaterialKind, MaterialReading, Note, ProfileObservation, SelectionAnchor, Topic, UnreadableEntry } from "../types.ts";
import type { AppendNoteInput, CreateTopicInput, ImportMaterialInput, UpdateTopicPatch, WorkspaceStore } from "./contract.ts";
import { MutationQueue } from "./MutationQueue.ts";
import { normalizeRepositoryUrl } from "../repositoryUrl.ts";
import { latestRepositoryIds, lessonRepositoryMaterials, lessonRepositoryVersionPairs } from "../repositoryVersions.ts";
import { parseFrontmatter, stringifyFrontmatter, type Frontmatter } from "./frontmatter.ts";

const notePattern = /^## \[(highlight|note|practice)\] ([^\n]+)\n<!-- pith-note:v1 -->\n([\s\S]*?)<!-- pith-note:end -->/gm;
const encoder = new TextEncoder();
const observationsStart = "<!-- pith-observations:v1 -->";
const observationsEnd = "<!-- pith-observations:end -->";

function profileParts(markdown: string): { start: number; end: number; observations: ProfileObservation[]; spans: { start: number; end: number }[] } {
  const count = (s: string) => markdown.split(s).length - 1;
  const opens = count(observationsStart), closes = count(observationsEnd), markers = count("<!-- pith-observations:");
  if (opens > 1 || closes > 1 || markers > 2) throw new Error("Duplicate observation markers");
  if (!markers) return { start: -1, end: -1, observations: [], spans: [] };
  if (opens !== 1 || closes !== 1 || markers !== 2) throw new Error("Incomplete observation markers");
  const start = markdown.indexOf(observationsStart) + observationsStart.length, end = markdown.indexOf(observationsEnd);
  if (end < start) throw new Error("Incomplete observation markers: wrong order");
  const body = markdown.slice(start, end), observations: ProfileObservation[] = [], spans: { start: number; end: number }[] = [];
  const first = /^(?:\r?\n)/.exec(body);
  if (!first) throw new Error("Invalid observation section");
  let offset = first[0].length;
  const entry = /- id: ("(?:[^"\\]|\\.)*") · (\d{4}-\d{2}-\d{2}) · ([^\s·]+)(?: · ([^\s·]+))?\r?\n  ([^\r\n]+)(?:\r?\n)/y;
  while (offset < body.length) {
    entry.lastIndex = offset;
    const match = entry.exec(body);
    if (!match) throw new Error("Invalid observation entry");
    let id: unknown;
    try { id = JSON.parse(match[1]!); } catch { throw new Error("Invalid observation ID"); }
    if (typeof id !== "string" || !id || observations.some(item => item.id === id)) throw new Error("Invalid observation ID");
    observations.push({ id, date: match[2]!, topicId: match[3]!, ...(match[4] ? { noteId: match[4] } : {}), text: match[5]! });
    spans.push({ start: start + offset, end: start + entry.lastIndex });
    offset = entry.lastIndex;
  }
  return { start, end, observations, spans };
}

function observationText(value: string): string {
  const text = value.replace(/\s*[\r\n\u2028\u2029]+\s*/g, " ").trim();
  if (!text || Array.from(text).length > 500 || text.includes("<!-- pith-observations:")) throw new Error("Invalid observation text");
  return text;
}

function readableId(prefix: string, title: string, date: Date): string {
  const clean = title.replace(/\.(?:epub|cbz|pdf|md|markdown|png|jpe?g|gif|webp)$/i, "").replace(/\s*[\[(][^\])]*(?:z[- ]?lib|1lib)[^\])]*[\])]\s*$/i, "").split(/\s+=\s+/)[0]!.trim();
  const slug = clean.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24).replace(/-+$/, "");
  let hash = 0x811c9dc5;
  for (let i = 0; i < clean.length; i++) hash = Math.imul(hash ^ clean.charCodeAt(i), 0x01000193) >>> 0;
  const day = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
  const nonLatin = /(?=\p{L})\P{Script=Latin}/u.test(clean);
  return `${prefix}-${day}-${!nonLatin && slug ? slug : hash.toString(36).padStart(7, "0")}`;
}

const plainMaterialIdPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function name(value: string): string {
  if (!value || value === "." || value === ".." || /[/\\\0]/.test(value)) throw new Error("Invalid path component");
  return value;
}

function plainMaterialId(value: unknown): string {
  if (typeof value !== "string" || !plainMaterialIdPattern.test(value)) throw new Error("Invalid material ID");
  return value;
}

function required(data: Record<string, unknown>, key: string): string {
  const value = data[key];
  if (typeof value !== "string" || !value.trim()) throw new Error(`Invalid ${key}`);
  return value;
}

function text(data: Record<string, unknown>, key: string): string {
  const value = data[key];
  if (typeof value !== "string") throw new Error(`Invalid ${key}`);
  return value;
}

function optional(data: Record<string, unknown>, key: string): string | undefined {
  const value = data[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw new Error(`Invalid ${key}`);
  return value;
}

function section(text: string, marker: string, end: string): string {
  const start = `<!-- pith-note:${marker} -->\n`;
  const stop = `\n\n<!-- pith-note:${end} -->`;
  const index = text.indexOf(start);
  const endIndex = text.indexOf(stop, index + start.length);
  if (index < 0 || endIndex < 0) throw new Error(`Invalid note ${marker}`);
  return text.slice(index + start.length, endIndex);
}

function parseNotes(body: string): Note[] {
  body = body.replace(/\r\n/g, "\n");
  const notes: Note[] = [];
  for (const match of body.matchAll(notePattern)) {
    const content = `${match[3]!}<!-- pith-note:end -->`;
    const metadataEnd = content.indexOf("\n\n<!-- pith-note:");
    if (metadataEnd < 0) throw new Error("Invalid note metadata");
    const fields: Record<string, string> = {};
    for (const line of content.slice(0, metadataEnd).split("\n")) {
      const entry = /^- (id|author|material|lesson|file|locator): (.+)$/.exec(line);
      if (!entry || !entry[1] || !entry[2] || Object.hasOwn(fields, entry[1])) throw new Error("Invalid note metadata");
      const parsed = parseFrontmatter(`---\nvalue: ${entry[2]}\n---\n`).attributes.value;
      if (entry[1] === "lesson" && parsed === true) fields.lesson = "true";
      else if (typeof parsed === "string") fields[entry[1]] = parsed;
      else throw new Error("Invalid note metadata value");
    }
    const id = required(fields, "id");
    const hasQuote = content.includes("<!-- pith-note:quote -->\n");
    const quote = hasQuote ? section(content, "quote", "body").split("\n").map(line => {
      if (line === ">") return "";
      if (!line.startsWith("> ")) throw new Error("Invalid quote");
      return line.slice(2);
    }).join("\n") : undefined;
    const hasRemark = content.includes("<!-- pith-note:remark -->\n");
    const hasResult = content.includes("<!-- pith-note:result -->\n");
    const noteBody = section(content, "body", hasResult ? "result" : hasRemark ? "remark" : "end");
    let result: Readonly<Record<string, unknown>> | undefined;
    if (hasResult) {
      const parsed: unknown = JSON.parse(section(content, "result", hasRemark ? "remark" : "end"));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || match[1] !== "practice") throw new Error("Invalid note result");
      result = parsed as Readonly<Record<string, unknown>>;
    }
    let guideRemark: string | undefined;
    if (hasRemark) {
      const raw = section(content, "remark", "end");
      const lines = raw.split("\n");
      if (!lines[0]?.startsWith("> [guide] ")) throw new Error("Invalid guide remark");
      guideRemark = [lines[0].slice(10), ...lines.slice(1).map(line => {
        if (line === ">") return "";
        if (!line.startsWith("> ")) throw new Error("Invalid guide remark");
        return line.slice(2);
      })].join("\n");
    }
    let anchor: SelectionAnchor | undefined;
    if (fields.file !== undefined || fields.locator !== undefined || quote !== undefined || fields.material !== undefined || fields.lesson !== undefined) {
      if ((fields.material !== undefined) === (fields.lesson !== undefined)) throw new Error("Invalid note source");
      const source = fields.material !== undefined ? { kind: "material" as const, materialId: name(fields.material) } : { kind: "lesson" as const };
      anchor = { source, file: required(fields, "file"), locator: required(fields, "locator"), ...(quote !== undefined ? { quote } : {}) };
    }
    const author = required(fields, "author");
    if (author !== "user" && author !== "guide") throw new Error("Invalid note author");
    notes.push({ id, kind: match[1] as Note["kind"], author, createdAt: match[2]!, anchor, body: noteBody, guideRemark, result });
  }
  if ((body.match(/<!-- pith-note:v1 -->/g) ?? []).length !== notes.length) throw new Error("Invalid note block");
  return notes;
}

function parseTopic(markdown: string): { topic: Topic; attributes: Frontmatter; body: string } {
  const { attributes: a, body } = parseFrontmatter(markdown);
  if (a.type !== "pith-topic") throw new Error("Invalid topic type");
  const status = required(a, "status");
  if (status !== "exploring" && status !== "shelved" && status !== "settled") throw new Error("Invalid topic status");
  if (!Array.isArray(a.toolkits) || !a.toolkits.every(item => typeof item === "string")) throw new Error("Invalid toolkits");
  if (!Array.isArray(a.materials)) throw new Error("Invalid materials");
  const materialIds = a.materials.map(plainMaterialId);
  if (new Set(materialIds).size !== materialIds.length) throw new Error("Duplicate material ID");
  if (!Array.isArray(a.lessons)) throw new Error("Invalid lessons");
  const lessons = a.lessons.map(item => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("Invalid lesson");
    const fileName = name(required(item, "name"));
    if (!fileName.endsWith(".md")) throw new Error("Invalid lesson name");
    let basedOn: string[] | undefined;
    if (Object.hasOwn(item, "basedOn")) {
      const value = required(item, "basedOn"); basedOn = value.split(",").map(name);
      if (new Set(basedOn).size !== basedOn.length || basedOn.some(id => !materialIds.includes(id))) throw new Error("Invalid lesson basedOn");
    }
    return { name: fileName, locator: optional(item, "locator"), lastActiveAt: optional(item, "lastActiveAt"), ...(basedOn ? { basedOn } : {}) };
  });
  if (new Set(lessons.map(lesson => lesson.name)).size !== lessons.length) throw new Error("Duplicate lesson");
  return { attributes: a, body, topic: {
    id: name(required(a, "id")), title: required(a, "title"), target: required(a, "target"), status,
    materialIds, lessons, nextAction: optional(a, "nextAction"), toolkits: a.toolkits as string[],
    createdAt: required(a, "createdAt"), updatedAt: required(a, "updatedAt"), notes: parseNotes(body),
  } };
}

function readingFile(file: string, kind: string, files: readonly MaterialFileEntry[]): string {
  if (!file.trim() || file.includes("\0")) throw new Error("Invalid readingFile");
  if (kind === "repo") {
    if (file.startsWith("/") || /\\/.test(file) || /^[a-z]:\//i.test(file) || file.split("/").includes("..")) throw new Error("Invalid repository readingFile path");
  } else if (!files.some(entry => entry.name === name(file))) throw new Error("Reading file not found in material files");
  return file;
}

function readingLocator(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || /[\u0000-\u001f\u007f]/.test(value)) throw new Error("Invalid readingLocator");
  return value;
}

function parseMaterial(markdown: string): { material: Material; attributes: Frontmatter; body: string } {
  const { attributes: a, body } = parseFrontmatter(markdown);
  if (a.type !== "pith-material") throw new Error("Invalid material type");
  const kind = required(a, "kind");
  if (!["book", "article", "media", "discussion", "repo"].includes(kind)) throw new Error("Invalid material kind");
  const remoteUrl = optional(a, "remoteUrl");
  if (remoteUrl !== undefined && (kind !== "repo" || normalizeRepositoryUrl(remoteUrl) !== remoteUrl)) throw new Error("Invalid remoteUrl");
  if (!Array.isArray(a.files)) throw new Error("Invalid material files");
  if (!Array.isArray(a.aids) || !a.aids.every(item => typeof item === "string")) throw new Error("Invalid material aids");
  const files = a.files.map(item => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("Invalid material file");
    const bytes = item.bytes;
    if (typeof bytes !== "number" || !Number.isSafeInteger(bytes) || bytes < 0) throw new Error("Invalid file size");
    const sha256 = required(item, "sha256");
    if (!/^[a-f0-9]{64}$/i.test(sha256)) throw new Error("Invalid sha256");
    return { name: name(required(item, "name")), mimeType: required(item, "mimeType"), bytes, sha256,
      locator: optional(item, "locator"), lastActiveAt: optional(item, "lastActiveAt") };
  });
  if (new Set(files.map(file => file.name)).size !== files.length) throw new Error("Duplicate material file");
  let reading: MaterialReading | undefined;
  const hasFile = Object.hasOwn(a, "readingFile"), hasOpenedAt = Object.hasOwn(a, "readingOpenedAt");
  if (hasFile !== hasOpenedAt || (Object.hasOwn(a, "readingLocator") && !hasFile)) throw new Error("Invalid reading: readingFile and readingOpenedAt must appear together");
  if (hasFile) {
    const file = readingFile(required(a, "readingFile"), kind, files), openedAt = required(a, "readingOpenedAt");
    if (!/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(openedAt) || !Number.isFinite(Date.parse(openedAt)) || new Date(`${openedAt.slice(0, 10)}T00:00:00Z`).toISOString().slice(0, 10) !== openedAt.slice(0, 10)) throw new Error("Invalid readingOpenedAt ISO timestamp");
    reading = { file, openedAt, ...(Object.hasOwn(a, "readingLocator") ? { locator: readingLocator(a.readingLocator) } : {}) };
  }
  const id = name(required(a, "id")), notes = parseNotes(body);
  if (notes.some(note => note.author !== "user" || note.kind === "practice" || (note.anchor && (note.anchor.source.kind !== "material" || note.anchor.source.materialId !== id)))) throw new Error("Invalid material note");
  return { attributes: a, body, material: { id, title: required(a, "title"), kind: kind as MaterialKind,
    createdAt: required(a, "createdAt"), files, aids: a.aids as string[], notes, ...(reading ? { reading } : {}), externalPath: optional(a, "externalPath"), commitSha: optional(a, "commitSha"), ...(remoteUrl !== undefined ? { remoteUrl } : {}) } };
}

function noteMarkdown(note: Note): string {
  for (const value of [note.body, note.anchor?.quote, note.guideRemark]) {
    if (value && /^<!-- pith-note:(?:v1|quote|body|remark|result|end) -->$/m.test(value)) throw new Error("Reserved note marker");
  }
  const lines = [`## [${note.kind}] ${note.createdAt}`, "<!-- pith-note:v1 -->", `- id: ${JSON.stringify(note.id)}`, `- author: ${JSON.stringify(note.author)}`];
  if (note.anchor) lines.push(note.anchor.source.kind === "material" ? `- material: ${JSON.stringify(name(note.anchor.source.materialId))}` : "- lesson: true", `- file: ${JSON.stringify(note.anchor.file)}`, `- locator: ${JSON.stringify(note.anchor.locator)}`);
  if (note.anchor?.quote !== undefined) lines.push("", "<!-- pith-note:quote -->", ...note.anchor.quote.split("\n").map(line => `> ${line}`));
  lines.push("", "<!-- pith-note:body -->", note.body, "");
  if (note.result !== undefined) {
    if (note.kind !== "practice") throw new Error("Result requires practice note");
    lines.push("<!-- pith-note:result -->", JSON.stringify(note.result), "");
  }
  if (note.guideRemark !== undefined) {
    const [first, ...rest] = note.guideRemark.split("\n");
    lines.push("<!-- pith-note:remark -->", `> [guide] ${first ?? ""}`, ...rest.map(line => `> ${line}`), "");
  }
  lines.push("<!-- pith-note:end -->");
  return lines.join("\n");
}

async function fileEntry(fileName: string, mimeType: string, bytes: Uint8Array): Promise<MaterialFileEntry> {
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes).buffer);
  return { name: fileName, mimeType, bytes: bytes.byteLength, sha256: Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("") };
}

function fileFields(file: MaterialFileEntry, extra: Record<string, string | number | boolean | null> = {}): Record<string, string | number | boolean | null> {
  return { ...extra, name: file.name, mimeType: file.mimeType, bytes: file.bytes, sha256: file.sha256,
    ...(file.locator !== undefined ? { locator: file.locator } : {}), ...(file.lastActiveAt !== undefined ? { lastActiveAt: file.lastActiveAt } : {}) };
}

const rebase = Symbol("rebaseLesson");
type ComparedBasis = { readonly markdown: string; readonly from: readonly string[]; readonly to: readonly string[] };

export function rebaseComparedLesson(store: DefaultWorkspaceStore, topicId: string, fileName: string, compared: ComparedBasis): Promise<Topic> {
  return store[rebase](topicId, fileName, compared);
}

export class DefaultWorkspaceStore implements WorkspaceStore {
  private readonly queue: MutationQueue;
  private readonly storage: WorkspaceStoragePort;
  constructor(storage: WorkspaceStoragePort) { this.storage = storage; this.queue = MutationQueue.forStorage(storage); }

  private async uniqueId(prefix: "topic" | "material", title: string): Promise<string> {
    const base = readableId(prefix, title, new Date()), directory = prefix === "topic" ? "topics" : "materials";
    let id = base, suffix = 2;
    while (await this.storage.exists(`${directory}/${id}`)) id = `${base}-${suffix++}`;
    return id;
  }

  private async scaffold(): Promise<void> {
    for (const dir of ["topics", "materials", "_cache"]) await this.storage.mkdir(dir);
    if (!await this.storage.exists("ME.md")) await this.storage.createText("ME.md", "# 学习者画像（ME.md）\n");
  }
  ensureScaffold(): Promise<void> { return this.queue.run(() => this.scaffold()); }
  async readProfile(): Promise<LearnerProfile> {
    const markdown = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(await this.storage.readBinary("ME.md"));
    return { markdown, observations: profileParts(markdown).observations };
  }

  private async saveProfile(markdown: string): Promise<void> {
    await this.storage.mkdir("history");
    const timestamp = Date.now();
    for (let offset = 0; offset < 1000; offset++) {
      const path = `history/ME-${new Date(timestamp + offset).toISOString().replace(/[-:.]/g, "")}.md`;
      if (await this.storage.exists(path)) continue;
      await this.storage.copy("ME.md", path);
      await this.storage.writeText("ME.md", markdown);
      return;
    }
    throw new Error("Profile backup timestamp exhausted");
  }

  addObservation(input: { text: string; topicId: string; noteId?: string }): Promise<ProfileObservation> {
    return this.queue.run(async () => {
      const text = observationText(input.text), topicId = name(input.topicId);
      if (/\s|·/.test(topicId) || (input.noteId !== undefined && /\s|·/.test(name(input.noteId)))) throw new Error("Invalid observation reference");
      const topic = await this.getTopic(topicId);
      if (!topic) throw new Error("Topic not found");
      if (input.noteId !== undefined && !topic.notes.some(note => note.id === input.noteId && note.author === "user")) throw new Error("Note is not user evidence in this topic");
      await this.scaffold();
      const { markdown } = await this.readProfile(), parts = profileParts(markdown);
      const observation: ProfileObservation = { id: `obs-${crypto.randomUUID()}`, date: new Date().toISOString().slice(0, 10), text, topicId, ...(input.noteId !== undefined ? { noteId: input.noteId } : {}) };
      const row = `- id: ${JSON.stringify(observation.id)} · ${observation.date} · ${topicId}${input.noteId !== undefined ? ` · ${input.noteId}` : ""}\n  ${text}\n`;
      const next = parts.start < 0 ? `${markdown}${markdown.endsWith("\n\n") ? "" : markdown.endsWith("\n") ? "\n" : "\n\n"}## 向导的观察\n${observationsStart}\n${row}${observationsEnd}\n` : `${markdown.slice(0, parts.end)}${row}${markdown.slice(parts.end)}`;
      await this.saveProfile(next);
      return observation;
    });
  }

  removeObservation(observationId: string): Promise<void> {
    return this.queue.run(async () => {
      const { markdown } = await this.readProfile(), parts = profileParts(markdown);
      const index = parts.observations.findIndex(item => item.id === observationId);
      if (index < 0) throw new Error("Observation not found");
      const span = parts.spans[index]!;
      await this.saveProfile(`${markdown.slice(0, span.start)}${markdown.slice(span.end)}`);
    });
  }

  async listUnreadable(): Promise<readonly UnreadableEntry[]> {
    const unreadable: UnreadableEntry[] = [];
    for (const [kind, directory] of [["topic", "topics"], ["material", "materials"]] as const) {
      if (!await this.storage.exists(directory)) continue;
      for (const entry of await this.storage.list(directory)) {
        if (entry.type !== "folder") continue;
        const id = entry.path.split("/").pop()!;
        try {
          if (kind === "topic") {
            const topic = await this.getTopic(id);
            if (topic) for (const materialId of topic.materialIds) if (!await this.storage.exists(`materials/${name(materialId)}/material.md`)) throw new Error(`Referenced material not found: ${materialId}`);
          }
          else await this.getMaterial(id);
        } catch (error) {
          unreadable.push({ kind, id, path: `${directory}/${id}/${kind}.md`, error: error instanceof Error ? error.message : String(error) });
        }
      }
    }
    return unreadable;
  }

  async listTopics(): Promise<readonly Topic[]> {
    if (!await this.storage.exists("topics")) return [];
    const topics: Topic[] = [];
    for (const entry of await this.storage.list("topics")) {
      if (entry.type !== "folder") continue;
      try { const topic = await this.getTopic(entry.path.split("/").pop()!); if (topic) topics.push(topic); } catch { /* Isolate malformed entries. */ }
    }
    return topics;
  }
  async getTopic(topicId: string): Promise<Topic | null> {
    const path = `topics/${name(topicId)}/topic.md`;
    if (!await this.storage.exists(path)) return null;
    const topic = parseTopic(await this.storage.readText(path)).topic;
    if (topic.id !== topicId) throw new Error("Topic id does not match path");
    if (topic.lessons.some(lesson => lesson.basedOn !== undefined)) {
      const materials = (await Promise.all(topic.materialIds.map(id => this.getMaterial(id)))).filter((item): item is Material => item !== null);
      for (const lesson of topic.lessons) lessonRepositoryMaterials(lesson, materials);
    }
    return topic;
  }
  createTopic(input: CreateTopicInput): Promise<Topic> {
    return this.queue.run(async () => {
      await this.scaffold();
      const id = name(await this.uniqueId("topic", input.title));
      const path = `topics/${id}/topic.md`;
      if (await this.storage.exists(path)) throw new Error("Topic already exists");
      const now = new Date().toISOString();
      const materialIds = input.materialIds.map(plainMaterialId);
      for (const materialId of materialIds) if (!await this.getMaterial(materialId)) throw new Error("Material not found");
      const a: Frontmatter = { type: "pith-topic", id, title: input.title, target: input.target, status: "exploring", materials: materialIds, toolkits: [...input.toolkits], lessons: [], createdAt: now, updatedAt: now };
      if (input.nextAction !== undefined) a.nextAction = input.nextAction;
      const markdown = stringifyFrontmatter(a, "\n");
      const topic = parseTopic(markdown).topic;
      await this.storage.mkdir(`topics/${id}`);
      await this.storage.createText(path, markdown);
      return topic;
    });
  }
  updateTopic(topicId: string, patch: UpdateTopicPatch): Promise<Topic> {
    return this.queue.run(async () => {
      const path = `topics/${name(topicId)}/topic.md`;
      const { attributes: a, body, topic } = parseTopic(await this.storage.readText(path));
      if (topic.id !== topicId) throw new Error("Topic id does not match path");
      if (patch.status !== undefined && patch.status !== topic.status && !(topic.status === "exploring" && (patch.status === "shelved" || patch.status === "settled")) && !(topic.status === "shelved" && patch.status === "exploring")) throw new Error("Invalid topic status transition");
      for (const key of ["title", "target", "status", "nextAction"] as const) if (patch[key] !== undefined) a[key] = patch[key]!;
      if (patch.toolkits !== undefined) a.toolkits = [...patch.toolkits];
      a.updatedAt = new Date().toISOString();
      const markdown = stringifyFrontmatter(a, body);
      const updated = parseTopic(markdown).topic;
      await this.storage.writeText(path, markdown);
      return updated;
    });
  }
  attachMaterial(topicId: string, materialId: string): Promise<Topic> {
    return this.queue.run(async () => {
      const validId = plainMaterialId(materialId);
      if (!await this.getMaterial(validId)) throw new Error("Material not found");
      const path = `topics/${name(topicId)}/topic.md`, { attributes, body, topic } = parseTopic(await this.storage.readText(path));
      if (topic.id !== topicId) throw new Error("Topic id does not match path");
      if (topic.materialIds.includes(validId)) return topic;
      attributes.materials = [...topic.materialIds, validId];
      attributes.updatedAt = new Date().toISOString();
      const markdown = stringifyFrontmatter(attributes, body), updated = parseTopic(markdown).topic;
      await this.storage.writeText(path, markdown);
      return updated;
    });
  }
  appendTopicNote(topicId: string, input: AppendNoteInput): Promise<Note> {
    return this.queue.run(async () => {
      const path = `topics/${name(topicId)}/topic.md`;
      const { attributes, body, topic } = parseTopic(await this.storage.readText(path));
      if (topic.id !== topicId) throw new Error("Topic id does not match path");
      if (input.kind === "practice" && topic.status === "settled") throw new Error("已沉淀的课题不可进行实训");
      if (input.anchor?.source.kind === "material" && !topic.materialIds.includes(input.anchor.source.materialId)) throw new Error("Material not in topic");
      if (input.anchor?.source.kind === "lesson" && !topic.lessons.some(lesson => lesson.name === input.anchor!.file)) throw new Error("Lesson not in topic");
      if (input.anchor?.source.kind === "material") {
        const material = await this.getMaterial(input.anchor.source.materialId);
        if (!material) throw new Error("Material not found");
        if (material.kind !== "repo" && !material.files.some(file => file.name === name(input.anchor!.file))) throw new Error("Material file not found");
      }
      const note: Note = { ...input, id: `n-${crypto.randomUUID()}`, createdAt: new Date().toISOString() };
      const nextBody = `${body}${body.endsWith("\n\n") ? "" : body.endsWith("\n") ? "\n" : "\n\n"}${noteMarkdown(note)}\n`;
      attributes.updatedAt = note.createdAt;
      const markdown = stringifyFrontmatter(attributes, nextBody);
      parseTopic(markdown);
      await this.storage.writeText(path, markdown);
      return note;
    });
  }

  async listMaterials(): Promise<readonly Material[]> {
    if (!await this.storage.exists("materials")) return [];
    const materials: Material[] = [];
    for (const entry of await this.storage.list("materials")) {
      if (entry.type !== "folder") continue;
      try { const material = await this.getMaterial(entry.path.split("/").pop()!); if (material) materials.push(material); } catch { /* Isolate malformed entries. */ }
    }
    return materials;
  }
  async getMaterial(materialId: string): Promise<Material | null> {
    const path = `materials/${name(materialId)}/material.md`;
    if (!await this.storage.exists(path)) return null;
    const material = parseMaterial(await this.storage.readText(path)).material;
    if (material.id !== materialId) throw new Error("Material id does not match path");
    return material;
  }
  importMaterial(input: ImportMaterialInput): Promise<Material> {
    return this.queue.run(async () => {
      await this.scaffold();
      if (input.remoteUrl !== undefined && (input.kind !== "repo" || normalizeRepositoryUrl(input.remoteUrl) !== input.remoteUrl)) throw new Error("Invalid remoteUrl");
      let createdAt = new Date().toISOString();
      if (input.kind === "repo" && input.externalPath && input.commitSha) {
        const versions = (await this.listMaterials()).filter(material => material.kind === "repo" && material.externalPath === input.externalPath);
        const existing = versions.find(material => material.commitSha === input.commitSha);
        if (existing) return existing;
        const previous = versions.map(material => material.createdAt).sort().at(-1);
        if (previous && previous >= createdAt) createdAt = new Date(Date.parse(previous) + 1).toISOString();
      }
      const id = name(await this.uniqueId("material", input.title));
      const dir = `materials/${id}`;
      if (await this.storage.exists(dir)) throw new Error("Material already exists");
      const filenames = input.files.map(file => name(file.name));
      if (new Set(filenames).size !== filenames.length) throw new Error("Duplicate file name");
      const files = await Promise.all(input.files.map(file => fileEntry(file.name, file.mimeType ?? "application/octet-stream", file.bytes)));
      const a: Frontmatter = {
        type: "pith-material", id, title: input.title, kind: input.kind, createdAt,
        ...(input.externalPath !== undefined ? { externalPath: input.externalPath } : {}),
        ...(input.commitSha !== undefined ? { commitSha: input.commitSha } : {}),
        ...(input.remoteUrl !== undefined ? { remoteUrl: input.remoteUrl } : {}),
        files: files.map(file => fileFields(file)), aids: [...(input.aids ?? [])],
      };
      const markdown = stringifyFrontmatter(a, "\n");
      const material = parseMaterial(markdown).material;
      await this.storage.mkdir(dir);
      await this.storage.mkdir(`${dir}/files`);
      for (const file of input.files) await this.storage.createBinary(`${dir}/files/${file.name}`, file.bytes);
      await this.storage.createText(`${dir}/material.md`, markdown);
      return material;
    });
  }
  writeLesson(topicId: string, fileName: string, markdown: string): Promise<Topic> {
    return this.queue.run(async () => {
      name(fileName);
      if (!fileName.endsWith(".md")) throw new Error("Lesson must be Markdown");
      const dir = `topics/${name(topicId)}`, path = `${dir}/topic.md`;
      const parsed = parseTopic(await this.storage.readText(path));
      if (parsed.topic.id !== topicId) throw new Error("Topic id does not match path");
      const filePath = `${dir}/lessons/${fileName}`, entries = parsed.attributes.lessons as Record<string, string | number | boolean | null>[];
      if (!parsed.topic.lessons.some(lesson => lesson.name === fileName)) {
        if (await this.storage.exists(filePath)) throw new Error("Untracked lesson already exists");
        entries.push({ name: fileName });
      }
      const basis = await this.lessonBasis(parsed.topic);
      const entry = entries.find(item => item.name === fileName)!;
      if (basis.length) entry.basedOn = basis.join(","); else delete entry.basedOn;
      await this.storage.mkdir(`${dir}/lessons`);
      if (await this.storage.exists(filePath)) await this.storage.writeText(filePath, markdown); else await this.storage.createText(filePath, markdown);
      parsed.attributes.updatedAt = new Date().toISOString();
      const ledger = stringifyFrontmatter(parsed.attributes, parsed.body), topic = parseTopic(ledger).topic;
      await this.storage.writeText(path, ledger);
      return topic;
    });
  }
  private async lessonBasis(topic: Topic): Promise<string[]> {
    const materials = await Promise.all(topic.materialIds.map(async id => {
      const material = await this.getMaterial(id); if (!material) throw new Error("Material not found"); return material;
    }));
    return latestRepositoryIds(materials);
  }
  rebaseLesson(topicId: string, fileName: string): Promise<Topic> { return this[rebase](topicId, fileName); }
  [rebase](topicId: string, fileName: string, compared?: ComparedBasis): Promise<Topic> {
    return this.queue.run(async () => {
      name(fileName);
      const path = `topics/${name(topicId)}/topic.md`, parsed = parseTopic(await this.storage.readText(path));
      if (parsed.topic.id !== topicId) throw new Error("Topic id does not match path");
      const entries = parsed.attributes.lessons as Record<string, string | number | boolean | null>[];
      const entry = entries.find(item => item.name === fileName);
      if (!entry || !await this.storage.exists(`topics/${topicId}/lessons/${fileName}`)) throw new Error("Lesson not found");
      let basis: readonly string[];
      if (compared) {
        // The comparison happened outside the write queue; verify its snapshot before writing.
        const materials = await Promise.all(parsed.topic.materialIds.map(async id => {
          const material = await this.getMaterial(id); if (!material) throw new Error("Material not found"); return material;
        }));
        const pairs = lessonRepositoryVersionPairs(parsed.topic.lessons.find(lesson => lesson.name === fileName)!, materials);
        const from = pairs.map(pair => pair.from.id);
        basis = pairs.map(pair => pair.to.id);
        const same = (reported: readonly string[], expected: readonly string[]) => reported.length === expected.length && expected.every(id => reported.includes(id));
        if (!same(compared.from, from) || !same(compared.to, basis) || compared.markdown !== await this.storage.readText(`topics/${topicId}/lessons/${fileName}`)) throw new Error("比较期间讲义或仓库版本已变动，未改依据");
      } else basis = await this.lessonBasis(parsed.topic);
      if (basis.length) entry.basedOn = basis.join(","); else delete entry.basedOn;
      parsed.attributes.updatedAt = new Date().toISOString();
      const ledger = stringifyFrontmatter(parsed.attributes, parsed.body), topic = parseTopic(ledger).topic;
      await this.storage.writeText(path, ledger); return topic;
    });
  }
  async readLesson(topicId: string, fileName: string): Promise<string> {
    name(fileName);
    const topic = await this.getTopic(topicId);
    if (!topic?.lessons.some(lesson => lesson.name === fileName)) throw new Error("Lesson not found");
    return this.storage.readText(`topics/${name(topicId)}/lessons/${fileName}`);
  }
  updateLessonLocator(topicId: string, fileName: string, locator: string): Promise<void> {
    return this.queue.run(async () => {
      const path = `topics/${name(topicId)}/topic.md`, parsed = parseTopic(await this.storage.readText(path));
      if (parsed.topic.id !== topicId) throw new Error("Topic id does not match path");
      const index = parsed.topic.lessons.findIndex(lesson => lesson.name === name(fileName));
      if (index < 0) throw new Error("Lesson not found");
      const entries = parsed.attributes.lessons as Record<string, string | number | boolean | null>[];
      entries[index] = { ...entries[index]!, locator, lastActiveAt: new Date().toISOString() };
      await this.storage.writeText(path, stringifyFrontmatter(parsed.attributes, parsed.body));
    });
  }
  setMaterialAids(materialId: string, aids: readonly string[]): Promise<Material> {
    return this.queue.run(async () => {
      const path = `materials/${name(materialId)}/material.md`, parsed = parseMaterial(await this.storage.readText(path));
      if (parsed.material.id !== materialId) throw new Error("Material id does not match path");
      parsed.attributes.aids = [...aids];
      const markdown = stringifyFrontmatter(parsed.attributes, parsed.body), material = parseMaterial(markdown).material;
      await this.storage.writeText(path, markdown);
      return material;
    });
  }
  appendMaterialNote(materialId: string, input: AppendNoteInput): Promise<Note> {
    return this.queue.run(async () => {
      const path = `materials/${name(materialId)}/material.md`, parsed = parseMaterial(await this.storage.readText(path));
      if (parsed.material.id !== materialId) throw new Error("Material id does not match path");
      if (input.author !== "user" || input.kind === "practice" || (input.anchor && (input.anchor.source.kind !== "material" || input.anchor.source.materialId !== materialId))) throw new Error("Invalid material note");
      if (input.anchor && parsed.material.kind !== "repo" && !parsed.material.files.some(file => file.name === name(input.anchor!.file))) throw new Error("Material file not found");
      const note: Note = { ...input, id: `n-${crypto.randomUUID()}`, createdAt: new Date().toISOString() };
      const body = `${parsed.body}${parsed.body.endsWith("\n\n") ? "" : parsed.body.endsWith("\n") ? "\n" : "\n\n"}${noteMarkdown(note)}\n`;
      const markdown = stringifyFrontmatter(parsed.attributes, body);
      parseMaterial(markdown);
      await this.storage.writeText(path, markdown);
      return note;
    });
  }
  updateReadingLocator(materialId: string, fileName: string, locator: string): Promise<void> {
    return this.queue.run(async () => {
      const path = `materials/${name(materialId)}/material.md`;
      const parsed = parseMaterial(await this.storage.readText(path));
      if (parsed.material.id !== materialId) throw new Error("Material id does not match path");
      const index = parsed.material.files.findIndex(file => file.name === name(fileName));
      if (index < 0) throw new Error("Material file not found");
      const entries = parsed.attributes.files as Record<string, string | number | boolean | null>[];
      entries[index] = { ...entries[index]!, locator, lastActiveAt: new Date().toISOString() };
      await this.storage.writeText(path, stringifyFrontmatter(parsed.attributes, parsed.body));
    });
  }
  recordReading(materialId: string, input: { file: string; locator?: string }): Promise<void> {
    return this.queue.run(async () => {
      const path = `materials/${name(materialId)}/material.md`, parsed = parseMaterial(await this.storage.readText(path));
      const material = parsed.material;
      if (material.id !== materialId) throw new Error("Material id does not match path");
      const file = readingFile(input.file, material.kind, material.files);
      // Open notifications carry no new coordinate. Keep this file's position,
      // never the previous file's; ordinary files retain per-file locators too.
      const previous = material.reading?.file === file ? material.reading.locator : undefined;
      const locator = input.locator === undefined ? previous ?? material.files.find(entry => entry.name === file)?.locator : readingLocator(input.locator);
      parsed.attributes.readingFile = file;
      parsed.attributes.readingOpenedAt = new Date().toISOString();
      if (locator === undefined) delete parsed.attributes.readingLocator;
      else parsed.attributes.readingLocator = locator;
      const markdown = stringifyFrontmatter(parsed.attributes, parsed.body);
      parseMaterial(markdown);
      await this.storage.writeText(path, markdown);
    });
  }
}
