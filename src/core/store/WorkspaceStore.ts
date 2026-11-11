import type { WorkspaceStoragePort } from "../host.ts";
import type { LearnerProfile, Material, MaterialFileEntry, MaterialKind, SelectionAnchor, Topic, TopicNote } from "../types.ts";
import type { AppendNoteInput, CreateTopicInput, ImportMaterialInput, UpdateTopicPatch, WorkspaceStore } from "./contract.ts";
import { MutationQueue } from "./MutationQueue.ts";
import { parseFrontmatter, stringifyFrontmatter, type Frontmatter } from "./frontmatter.ts";

const notePattern = /^## \[(highlight|note|practice)\] ([^\n]+)\n<!-- pith-note:v1 -->\n([\s\S]*?)<!-- pith-note:end -->/gm;
const encoder = new TextEncoder();

function readableId(prefix: string, title: string, date: Date): string {
  const clean = title.replace(/\.(?:epub|cbz|pdf|md|markdown|png|jpe?g|gif|webp)$/i, "").replace(/\s*[\[(][^\])]*(?:z[- ]?lib|1lib)[^\])]*[\])]\s*$/i, "").split(/\s+=\s+/)[0]!.trim();
  const slug = clean.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24).replace(/-+$/, "");
  let hash = 0x811c9dc5;
  for (let i = 0; i < clean.length; i++) hash = Math.imul(hash ^ clean.charCodeAt(i), 0x01000193) >>> 0;
  const day = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
  const nonLatin = /(?=\p{L})\P{Script=Latin}/u.test(clean);
  return `${prefix}-${day}-${!nonLatin && slug ? slug : hash.toString(36).padStart(7, "0")}`;
}

function name(value: string): string {
  if (!value || value === "." || value === ".." || /[/\\\0]/.test(value)) throw new Error("Invalid path component");
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

function parseNotes(body: string): TopicNote[] {
  body = body.replace(/\r\n/g, "\n");
  const notes: TopicNote[] = [];
  for (const match of body.matchAll(notePattern)) {
    const content = `${match[3]!}<!-- pith-note:end -->`;
    const metadataEnd = content.indexOf("\n\n<!-- pith-note:");
    if (metadataEnd < 0) throw new Error("Invalid note metadata");
    const fields: Record<string, string> = {};
    for (const line of content.slice(0, metadataEnd).split("\n")) {
      const entry = /^- (id|file|locator): (.+)$/.exec(line);
      if (!entry || !entry[1] || !entry[2] || Object.hasOwn(fields, entry[1])) throw new Error("Invalid note metadata");
      const parsed = parseFrontmatter(`---\nvalue: ${entry[2]}\n---\n`).attributes.value;
      if (typeof parsed !== "string") throw new Error("Invalid note metadata value");
      fields[entry[1]] = parsed;
    }
    const id = required(fields, "id");
    const hasQuote = content.includes("<!-- pith-note:quote -->\n");
    const quote = hasQuote ? section(content, "quote", "body").split("\n").map(line => {
      if (line === ">") return "";
      if (!line.startsWith("> ")) throw new Error("Invalid quote");
      return line.slice(2);
    }).join("\n") : undefined;
    const hasRemark = content.includes("<!-- pith-note:remark -->\n");
    const noteBody = section(content, "body", hasRemark ? "remark" : "no-remark");
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
    } else if (!content.includes("<!-- pith-note:no-remark -->")) throw new Error("Missing note remark marker");
    let anchor: SelectionAnchor | undefined;
    if (fields.file !== undefined || fields.locator !== undefined || quote !== undefined) {
      anchor = { file: required(fields, "file"), locator: required(fields, "locator"), ...(quote !== undefined ? { quote } : {}) };
    }
    notes.push({ id, kind: match[1] as TopicNote["kind"], createdAt: match[2]!, anchor, body: noteBody, guideRemark });
  }
  if ((body.match(/<!-- pith-note:v1 -->/g) ?? []).length !== notes.length) throw new Error("Invalid note block");
  return notes;
}

function parseTopic(markdown: string): { topic: Topic; attributes: Frontmatter; body: string } {
  const { attributes: a, body } = parseFrontmatter(markdown);
  if (a.type !== "pith-topic") throw new Error("Invalid topic type");
  const status = required(a, "status");
  if (status !== "exploring" && status !== "settled") throw new Error("Invalid topic status");
  if (!Array.isArray(a.toolkits) || !a.toolkits.every(item => typeof item === "string")) throw new Error("Invalid toolkits");
  const toolkitsOrigin = optional(a, "toolkitsOrigin");
  if (toolkitsOrigin !== undefined && toolkitsOrigin !== "default" && toolkitsOrigin !== "explicit") throw new Error("Invalid toolkitsOrigin");
  const material = optional(a, "material");
  const materialId = material?.startsWith("[[") ? /^\[\[materials\/([^/]+)\/material\]\]$/.exec(material)?.[1] : material;
  if (material && !materialId) throw new Error("Invalid material link");
  if (materialId) name(materialId);
  return { attributes: a, body, topic: {
    id: name(required(a, "id")), title: required(a, "title"), target: text(a, "target"), status,
    materialId, nextAction: optional(a, "nextAction"), toolkits: a.toolkits as string[],
    ...(toolkitsOrigin ? { toolkitsOrigin } : {}),
    createdAt: required(a, "createdAt"), updatedAt: required(a, "updatedAt"), notes: parseNotes(body),
  } };
}

function parseMaterial(markdown: string): { material: Material; attributes: Frontmatter; body: string } {
  const { attributes: a, body } = parseFrontmatter(markdown);
  if (a.type !== "pith-material") throw new Error("Invalid material type");
  const kind = required(a, "kind");
  if (!["book", "article", "media", "discussion", "repo"].includes(kind)) throw new Error("Invalid material kind");
  if (!Array.isArray(a.files)) throw new Error("Invalid material files");
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
  return { attributes: a, body, material: { id: name(required(a, "id")), title: required(a, "title"), kind: kind as MaterialKind,
    createdAt: required(a, "createdAt"), files, externalPath: optional(a, "externalPath"), commitSha: optional(a, "commitSha") } };
}

function noteMarkdown(note: TopicNote): string {
  for (const value of [note.body, note.anchor?.quote, note.guideRemark]) {
    if (value && /^<!-- pith-note:(?:v1|quote|body|remark|no-remark|end) -->$/m.test(value)) throw new Error("Reserved note marker");
  }
  const lines = [`## [${note.kind}] ${note.createdAt}`, "<!-- pith-note:v1 -->", `- id: ${JSON.stringify(note.id)}`];
  if (note.anchor) lines.push(`- file: ${JSON.stringify(note.anchor.file)}`, `- locator: ${JSON.stringify(note.anchor.locator)}`);
  if (note.anchor?.quote !== undefined) lines.push("", "<!-- pith-note:quote -->", ...note.anchor.quote.split("\n").map(line => `> ${line}`));
  lines.push("", "<!-- pith-note:body -->", note.body, "");
  if (note.guideRemark !== undefined) {
    const [first, ...rest] = note.guideRemark.split("\n");
    lines.push("<!-- pith-note:remark -->", `> [guide] ${first ?? ""}`, ...rest.map(line => `> ${line}`), "");
  } else lines.push("<!-- pith-note:no-remark -->", "");
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
  async readProfile(): Promise<LearnerProfile> { return { markdown: await this.storage.readText("ME.md") }; }
  writeProfile(markdown: string): Promise<void> { return this.queue.run(async () => { await this.scaffold(); await this.storage.writeText("ME.md", markdown); }); }

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
    return topic;
  }
  createTopic(input: CreateTopicInput): Promise<Topic> {
    return this.queue.run(async () => {
      await this.scaffold();
      const id = name(input.id ?? await this.uniqueId("topic", input.title));
      const path = `topics/${id}/topic.md`;
      if (await this.storage.exists(path)) throw new Error("Topic already exists");
      const now = new Date().toISOString();
      const a: Frontmatter = { type: "pith-topic", id, title: input.title, target: input.target ?? "", status: "exploring", toolkits: [...(input.toolkits ?? [])], createdAt: now, updatedAt: now };
      if (input.toolkitsOrigin !== undefined) a.toolkitsOrigin = input.toolkitsOrigin;
      if (input.materialId !== undefined) a.material = `[[materials/${name(input.materialId)}/material]]`;
      if (input.nextAction !== undefined) a.nextAction = input.nextAction;
      const markdown = stringifyFrontmatter(a, "\n");
      const topic = parseTopic(markdown).topic;
      await this.storage.mkdir(`topics/${id}`);
      await this.storage.createText(path, markdown);
      return topic;
    });
  }
  updateTopic(topicId: string, patch: UpdateTopicPatch): Promise<Topic> {
    return this.patchTopic(topicId, patch).then(topic => { if (!topic) throw new Error("Topic update failed"); return topic; });
  }
  updateTopicIfUnchanged(topicId: string, expected: Pick<Topic, "materialId" | "toolkits" | "toolkitsOrigin">, patch: UpdateTopicPatch): Promise<Topic | null> {
    return this.patchTopic(topicId, patch, expected);
  }
  private patchTopic(topicId: string, patch: UpdateTopicPatch, expected?: Pick<Topic, "materialId" | "toolkits" | "toolkitsOrigin">): Promise<Topic | null> {
    return this.queue.run(async () => {
      const path = `topics/${name(topicId)}/topic.md`;
      const { attributes: a, body, topic } = parseTopic(await this.storage.readText(path));
      if (topic.id !== topicId) throw new Error("Topic id does not match path");
      if (expected && (topic.materialId !== expected.materialId || topic.toolkitsOrigin !== expected.toolkitsOrigin || topic.toolkits.length !== expected.toolkits.length || topic.toolkits.some((id, index) => id !== expected.toolkits[index]))) return null;
      for (const key of ["title", "target", "status", "nextAction"] as const) if (patch[key] !== undefined) a[key] = patch[key]!;
      if (patch.toolkits !== undefined) {
        a.toolkits = [...patch.toolkits];
        if (patch.toolkitsOrigin === undefined) delete a.toolkitsOrigin;
      }
      if (patch.toolkitsOrigin === null) delete a.toolkitsOrigin;
      else if (patch.toolkitsOrigin !== undefined) a.toolkitsOrigin = patch.toolkitsOrigin;
      if (patch.materialId !== undefined) a.material = `[[materials/${name(patch.materialId)}/material]]`;
      a.updatedAt = new Date().toISOString();
      const markdown = stringifyFrontmatter(a, body);
      const updated = parseTopic(markdown).topic;
      await this.storage.writeText(path, markdown);
      return updated;
    });
  }
  appendNote(topicId: string, input: AppendNoteInput): Promise<TopicNote> {
    return this.queue.run(async () => {
      const path = `topics/${name(topicId)}/topic.md`;
      const { attributes, body, topic } = parseTopic(await this.storage.readText(path));
      if (topic.id !== topicId) throw new Error("Topic id does not match path");
      const note: TopicNote = { ...input, id: `n-${crypto.randomUUID()}`, createdAt: new Date().toISOString() };
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
      const id = name(input.id ?? await this.uniqueId("material", input.title));
      const dir = `materials/${id}`;
      if (await this.storage.exists(dir)) throw new Error("Material already exists");
      const filenames = input.files.map(file => name(file.name));
      if (new Set(filenames).size !== filenames.length) throw new Error("Duplicate file name");
      const files = await Promise.all(input.files.map(file => fileEntry(file.name, file.mimeType ?? "application/octet-stream", file.bytes)));
      const a: Frontmatter = {
        type: "pith-material", id, title: input.title, kind: input.kind, createdAt: new Date().toISOString(),
        ...(input.externalPath !== undefined ? { externalPath: input.externalPath } : {}),
        ...(input.commitSha !== undefined ? { commitSha: input.commitSha } : {}),
        files: files.map(file => fileFields(file)),
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
  appendMaterialFiles(materialId: string, files: readonly { readonly name: string; readonly mimeType?: string; readonly bytes: Uint8Array }[]): Promise<Material> {
    return this.queue.run(async () => {
      const dir = `materials/${name(materialId)}`, path = `${dir}/material.md`;
      const parsed = parseMaterial(await this.storage.readText(path));
      if (parsed.material.id !== materialId) throw new Error("Material id does not match path");
      if (!files.length) return parsed.material;
      const filenames = files.map(file => name(file.name));
      if (new Set(filenames).size !== filenames.length) throw new Error("Duplicate file name");
      const existingNames = new Set(parsed.material.files.map(file => file.name));
      for (const fileName of filenames) {
        if (existingNames.has(fileName) || await this.storage.exists(`${dir}/files/${fileName}`)) throw new Error("Cannot overwrite existing material file");
      }
      const entries = parsed.attributes.files as Record<string, string | number | boolean | null>[];
      const added = await Promise.all(files.map(file => fileEntry(file.name, file.mimeType ?? "application/octet-stream", file.bytes)));
      for (const item of added) entries.push(fileFields(item));
      const markdown = stringifyFrontmatter(parsed.attributes, parsed.body);
      const updated = parseMaterial(markdown).material;
      await this.storage.mkdir(`${dir}/files`);
      for (const file of files) await this.storage.createBinary(`${dir}/files/${file.name}`, file.bytes);
      await this.storage.writeText(path, markdown);
      return updated;
    });
  }
  writeGeneratedFile(materialId: string, fileName: string, markdown: string): Promise<Material> {
    return this.queue.run(async () => {
      name(fileName);
      if (!fileName.endsWith(".md")) throw new Error("Generated file must be Markdown");
      const dir = `materials/${name(materialId)}`;
      const path = `${dir}/material.md`;
      const parsed = parseMaterial(await this.storage.readText(path));
      if (parsed.material.id !== materialId) throw new Error("Material id does not match path");
      const entries = parsed.attributes.files as Record<string, string | number | boolean | null>[];
      const index = parsed.material.files.findIndex(file => file.name === fileName);
      const filePath = `${dir}/files/${fileName}`;
      if ((index >= 0 && entries[index]?.generated !== true) || (index < 0 && await this.storage.exists(filePath))) throw new Error("Cannot overwrite original material");
      const file = await fileEntry(fileName, "text/markdown", encoder.encode(markdown));
      const existing = index >= 0 ? parsed.material.files[index] : undefined;
      const entry = fileFields({ ...file, locator: existing?.locator, lastActiveAt: existing?.lastActiveAt }, { ...(entries[index] ?? {}), generated: true });
      if (index >= 0) entries[index] = entry; else entries.push(entry);
      await this.storage.mkdir(`${dir}/files`);
      if (index >= 0) await this.storage.writeText(filePath, markdown); else await this.storage.createText(filePath, markdown);
      await this.storage.writeText(path, stringifyFrontmatter(parsed.attributes, parsed.body));
      return parseMaterial(stringifyFrontmatter(parsed.attributes, parsed.body)).material;
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
}
