import { test } from "node:test";
import assert from "node:assert/strict";
import { DefaultWorkspaceStore, parseFrontmatter, stringifyFrontmatter } from "../src/core/index.ts";
import type { StorageEntry, WorkspaceStoragePort } from "../src/core/host.ts";

class MemoryStorage implements WorkspaceStoragePort {
  readonly mutationIdentity: object;
  readonly files: Map<string, Uint8Array>;
  readonly dirs: Set<string>;
  constructor(shared?: MemoryStorage) {
    this.mutationIdentity = shared?.mutationIdentity ?? {};
    this.files = shared?.files ?? new Map();
    this.dirs = shared?.dirs ?? new Set();
  }
  async exists(path: string): Promise<boolean> { return this.files.has(path) || this.dirs.has(path); }
  async readText(path: string): Promise<string> { return new TextDecoder().decode(await this.readBinary(path)); }
  async readBinary(path: string): Promise<Uint8Array> {
    const value = this.files.get(path);
    if (!value) throw new Error(`Not found: ${path}`);
    return value.slice();
  }
  async writeText(path: string, data: string): Promise<void> { await this.writeBinary(path, new TextEncoder().encode(data)); }
  async createText(path: string, data: string): Promise<void> { await this.createBinary(path, new TextEncoder().encode(data)); }
  async writeBinary(path: string, data: Uint8Array): Promise<void> { this.files.set(path, data.slice()); }
  async createBinary(path: string, data: Uint8Array): Promise<void> {
    if (await this.exists(path)) throw new Error("Already exists");
    await this.writeBinary(path, data);
  }
  async copy(from: string, to: string): Promise<void> { await this.createBinary(to, await this.readBinary(from)); }
  async processText(path: string, update: (current: string) => string): Promise<string> {
    const result = update(await this.readText(path)); await this.writeText(path, result); return result;
  }
  async mkdir(path: string): Promise<void> { this.dirs.add(path); }
  async list(path: string): Promise<readonly StorageEntry[]> {
    const prefix = `${path}/`;
    return [...this.dirs, ...this.files.keys()].filter(entry => entry.startsWith(prefix) && !entry.slice(prefix.length).includes("/"))
      .map(entry => ({ path: entry, type: this.dirs.has(entry) ? "folder" : "file" }));
  }
}

test("legacy ledgers are isolated without modifying their bytes", async () => {
  const storage = new MemoryStorage(), store = new DefaultWorkspaceStore(storage);
  const topic = '---\ntype: pith-topic\nid: topic-old\ntitle: Old\ntarget: Learn\nstatus: exploring\nmaterialId: material-old\ntoolkits: []\ncreatedAt: today\nupdatedAt: today\n---\n';
  const material = '---\ntype: pith-material\nid: material-old\ntitle: Old\nkind: article\nfiles: []\ncreatedAt: today\n---\n';
  await storage.mkdir("topics"); await storage.mkdir("topics/topic-old"); await storage.writeText("topics/topic-old/topic.md", topic);
  await storage.mkdir("materials"); await storage.mkdir("materials/material-old"); await storage.writeText("materials/material-old/material.md", material);
  assert.deepEqual(await store.listTopics(), []); assert.deepEqual(await store.listMaterials(), []);
  const unreadable = await store.listUnreadable();
  assert.ok(unreadable.some(item => item.id === "topic-old"));
  assert.ok(unreadable.some(item => item.id === "material-old"));
  assert.equal(await storage.readText("topics/topic-old/topic.md"), topic);
  assert.equal(await storage.readText("materials/material-old/material.md"), material);
});

test("serializes concurrent mutations across adapters sharing an identity", async () => {
  const storage = new MemoryStorage(), store = new DefaultWorkspaceStore(storage), other = new DefaultWorkspaceStore(new MemoryStorage(storage));
  await store.ensureScaffold(); await storage.writeText("ME.md", "# Existing profile\n"); await other.ensureScaffold();
  assert.equal((await store.readProfile()).markdown, "# Existing profile\n");
  const material = await store.importMaterial({ title: "Material", kind: "article", files: [{ name: "x.md", bytes: new TextEncoder().encode("original") }] });
  const created = await store.createTopic({ title: "Title", target: "Learn", materialIds: [material.id], toolkits: [] });
  const noteRequests = Array.from({ length: 5 }, (_, index) => (index % 2 ? store : other).appendTopicNote(created.id, {
    kind: "highlight", author: "user", body: `line ${index}\n\nlast\n`, anchor: { source: { kind: "material", materialId: material.id }, file: "x.md", locator: "page:1", quote: `first\n\nlast ${index}` }, guideRemark: "first\n\nlast\n",
  }));
  const [notes] = await Promise.all([Promise.all(noteRequests), other.updateTopic(created.id, { title: "Updated", toolkits: ["feynman"] })]);
  const topic = await store.getTopic(created.id); assert.ok(topic);
  assert.equal(topic.title, "Updated"); assert.deepEqual(topic.materialIds, [material.id]); assert.deepEqual(topic.notes, notes.map(note => ({ ...note, result: undefined })));
  const topicMarkdown = await storage.readText(`topics/${created.id}/topic.md`);
  assert.deepEqual(parseFrontmatter(topicMarkdown).attributes.materials, [material.id]);
  assert.doesNotMatch(topicMarkdown, /\[\[materials\//);
  await assert.rejects(store.updateTopic(created.id, { title: "" }));
  assert.equal((await other.updateTopic(created.id, { title: "Recovered" })).title, "Recovered");
});

test("preserves topic and material bodies while changing their metadata", async () => {
  const storage = new MemoryStorage(), store = new DefaultWorkspaceStore(storage);
  const material = await store.importMaterial({ title: "Material", kind: "article", files: [{ name: "original.md", bytes: new TextEncoder().encode("original") }] });
  const topic = await store.createTopic({ title: "Topic", target: "Learn", materialIds: [material.id], toolkits: [] });
  await store.appendTopicNote(topic.id, { kind: "note", author: "user", body: "topic note" });
  await store.appendMaterialNote(material.id, { kind: "note", author: "user", body: "material note" });
  const topicPath = `topics/${topic.id}/topic.md`, materialPath = `materials/${material.id}/material.md`;
  const originalNotes = (await store.getTopic(topic.id))!.notes;
  const originalTopicBody = parseFrontmatter(await storage.readText(topicPath)).body;
  const originalMaterialBody = parseFrontmatter(await storage.readText(materialPath)).body;
  await store.updateTopic(topic.id, { status: "settled" });
  assert.deepEqual((await store.getTopic(topic.id))!.notes, originalNotes);
  assert.equal(parseFrontmatter(await storage.readText(topicPath)).body, originalTopicBody);
  await store.updateReadingLocator(material.id, "original.md", "page:5");
  assert.equal(parseFrontmatter(await storage.readText(materialPath)).body, originalMaterialBody);
});

test("isolates malformed topics and materials", async () => {
  const storage = new MemoryStorage(), store = new DefaultWorkspaceStore(storage);
  const good = await store.createTopic({ title: "Good", target: "Learn", materialIds: [], toolkits: ["feynman"] });
  await storage.mkdir("topics/topic-corrupt"); await storage.writeText("topics/topic-corrupt/topic.md", "---\ntype: pith-topic\nid: bad\n---\n");
  const material = await store.importMaterial({ title: "Good", kind: "book", files: [] });
  await storage.mkdir("materials/material-corrupt"); await storage.writeText("materials/material-corrupt/material.md", "not frontmatter");
  assert.deepEqual((await store.listTopics()).map(topic => topic.id), [good.id]);
  assert.deepEqual((await store.listMaterials()).map(item => item.id), [material.id]);
  assert.deepEqual((await store.updateTopic(good.id, { title: "Renamed" })).toolkits, ["feynman"]);
  await assert.rejects(store.getTopic("topic-corrupt"));
});

test("imports immutable files, stores lessons on topics and records independent reading progress", async () => {
  const storage = new MemoryStorage(), store = new DefaultWorkspaceStore(storage);
  const material = await store.importMaterial({ title: "Material", kind: "article", files: [{ name: "original.md", mimeType: "text/markdown", bytes: new TextEncoder().encode("abc") }] });
  assert.equal(material.files[0]?.sha256, "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  const topic = await store.createTopic({ title: "Topic", target: "Learn", materialIds: [material.id], toolkits: [] });
  await store.writeLesson(topic.id, "original.md", "first"); await store.updateLessonLocator(topic.id, "original.md", "page:3");
  const updated = await store.writeLesson(topic.id, "original.md", "second");
  assert.equal(updated.lessons[0]?.locator, "page:3"); assert.ok(updated.lessons[0]?.lastActiveAt);
  assert.equal(await store.readLesson(topic.id, "original.md"), "second");
  assert.equal(await storage.readText(`materials/${material.id}/files/original.md`), "abc");
  await store.updateReadingLocator(material.id, "original.md", "page:5");
  assert.equal((await store.getMaterial(material.id))!.files[0]!.locator, "page:5");
  await assert.rejects(store.writeLesson(topic.id, "../escape.md", "x"));
  await assert.rejects(store.updateReadingLocator(material.id, "missing.md", "page:1"));
});

test("round-trips controlled frontmatter and preserves Markdown bodies", () => {
  const doc = { type: "pith-material", title: "A: \"quote\"\nline", files: [{ name: "x.md", bytes: 1, generated: true }], toolkits: ["a", "b"] };
  assert.deepEqual(parseFrontmatter(stringifyFrontmatter(doc, "\n# Body\n")), { attributes: doc, body: "\n# Body\n" });
  assert.deepEqual(parseFrontmatter("---\ntoolkits: [shadowing, 'a,b']\n---\n").attributes.toolkits, ["shadowing", "a,b"]);
  assert.throws(() => parseFrontmatter("---\ntype: a\ntype: b\n---\n"));
  for (const materials of [[], ["material-20261120-alpha"], ["material-20261120-alpha", "material-20261120-beta"]]) {
    const serialized = stringifyFrontmatter({ type: "pith-topic", materials }, "\n");
    assert.deepEqual(parseFrontmatter(serialized).attributes.materials, materials);
  }
});

test("topics write plain material IDs and isolate legacy double-links or invalid IDs without mutating bytes", async () => {
  const storage = new MemoryStorage(), store = new DefaultWorkspaceStore(storage);
  const first = await store.importMaterial({ title: "First", kind: "article", files: [{ name: "a.md", bytes: new TextEncoder().encode("a") }] });
  const second = await store.importMaterial({ title: "Second", kind: "article", files: [{ name: "b.md", bytes: new TextEncoder().encode("b") }] });
  const topic = await store.createTopic({ title: "Plain IDs", target: "Read", materialIds: [first.id], toolkits: [] });
  assert.deepEqual(parseFrontmatter(await storage.readText(`topics/${topic.id}/topic.md`)).attributes.materials, [first.id]);
  const attached = await store.attachMaterial(topic.id, second.id);
  assert.deepEqual(attached.materialIds, [first.id, second.id]);
  const attachedRaw = await storage.readText(`topics/${topic.id}/topic.md`);
  assert.deepEqual(parseFrontmatter(attachedRaw).attributes.materials, [first.id, second.id]);
  assert.doesNotMatch(attachedRaw, /\[\[materials\//);

  for (const badId of ["Material-1", "material_1", `[[materials/${first.id}/material]]`, "../escape", "", "-leading", "trailing-", "double--dash"]) {
    await assert.rejects(store.createTopic({ title: "Bad", target: "Learn", materialIds: [badId], toolkits: [] }), /Invalid material ID/);
    await assert.rejects(store.attachMaterial(topic.id, badId), /Invalid material ID/);
  }
  await assert.rejects(store.createTopic({ title: "Dup", target: "Learn", materialIds: [first.id, first.id], toolkits: [] }), /Duplicate material ID/);

  const legacyCases = [
    { id: "topic-legacy-link", materials: [`[[materials/${first.id}/material]]`], error: /Invalid material ID/ },
    { id: "topic-bad-case", materials: ["Material-Alpha"], error: /Invalid material ID/ },
    { id: "topic-bad-underscore", materials: ["material_alpha"], error: /Invalid material ID/ },
    { id: "topic-bad-dup", materials: [first.id, first.id], error: /Duplicate material ID/ },
  ];
  for (const entry of legacyCases) {
    const raw = stringifyFrontmatter({
      type: "pith-topic", id: entry.id, title: entry.id, target: "Learn", status: "exploring",
      materials: entry.materials, toolkits: [], lessons: [], createdAt: "2026-11-20T00:00:00.000Z", updatedAt: "2026-11-20T00:00:00.000Z",
    }, "\n");
    await storage.mkdir("topics");
    await storage.mkdir(`topics/${entry.id}`);
    await storage.writeText(`topics/${entry.id}/topic.md`, raw);
    await assert.rejects(store.getTopic(entry.id), entry.error);
    await assert.rejects(store.updateTopic(entry.id, { title: "Changed" }), entry.error);
    await assert.rejects(store.attachMaterial(entry.id, second.id), entry.error);
    await assert.rejects(store.appendTopicNote(entry.id, { kind: "note", author: "user", body: "x" }), entry.error);
    await assert.rejects(store.writeLesson(entry.id, "01.md", "# x"), entry.error);
    await assert.rejects(store.rebaseLesson(entry.id, "01.md"), entry.error);
    await assert.rejects(store.updateLessonLocator(entry.id, "01.md", "text:line:0"), entry.error);
    await assert.rejects(store.addObservation({ text: "obs", topicId: entry.id }), entry.error);
    assert.equal(await storage.readText(`topics/${entry.id}/topic.md`), raw);
  }
  const readableIds = (await store.listTopics()).map(item => item.id);
  assert.deepEqual(readableIds, [topic.id]);
  const unreadable = await store.listUnreadable();
  for (const entry of legacyCases) {
    const found = unreadable.find(item => item.id === entry.id);
    assert.ok(found, `expected ${entry.id} in unreadable`);
    assert.equal(found.path, `topics/${entry.id}/topic.md`);
    assert.match(found.error, entry.error);
  }
});
