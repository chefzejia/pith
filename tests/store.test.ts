import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
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

class ReadOnlyStorage implements WorkspaceStoragePort {
  private root = join(process.cwd(), "workspace");
  async exists(path: string): Promise<boolean> {
    try { await stat(join(this.root, path)); return true; } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    }
  }
  async readText(path: string): Promise<string> { return readFile(join(this.root, path), "utf8"); }
  async readBinary(path: string): Promise<Uint8Array> { return readFile(join(this.root, path)); }
  async list(path: string): Promise<readonly StorageEntry[]> {
    return (await readdir(join(this.root, path), { withFileTypes: true })).filter(entry => entry.isDirectory() || entry.isFile())
      .map(entry => ({ path: `${path}/${entry.name}`, type: entry.isDirectory() ? "folder" : "file" }));
  }
  async writeText(): Promise<never> { throw new Error("Read-only"); }
  async createText(): Promise<never> { throw new Error("Read-only"); }
  async writeBinary(): Promise<never> { throw new Error("Read-only"); }
  async createBinary(): Promise<never> { throw new Error("Read-only"); }
  async processText(): Promise<never> { throw new Error("Read-only"); }
  async mkdir(): Promise<never> { throw new Error("Read-only"); }
}

test("reads the real workspace without writing to it", async () => {
  const storage = new ReadOnlyStorage();
  const store = new DefaultWorkspaceStore(storage);
  assert.equal((await store.readProfile()).markdown, await storage.readText("ME.md"));
  const topic = await store.getTopic("topic-001-architecture-foundations");
  assert.ok(topic);
  assert.equal(topic.title, "吃透 Magpie · DSH · Super-agent 的微内核与去 Session 化设计");
  assert.equal(topic.target, "彻底搞懂如何划定 Core 与 Plugin 的边界、如何用 Capability Seam 消灭特权模块、以及如何用 Engine + Effects 实现不阻塞注意力的去 Session 化向导，并能独立演进 Pith 内核。");
  assert.equal(topic.status, "exploring");
  assert.equal(topic.materialId, "material-001-magpie-dsh-anatomy");
  assert.equal(topic.nextAction, "阅读《00-course-outline.md》与《01-magpie-pragmatic-core-and-plugins.md》，跑通 InUse 保活边界实验");
  assert.deepEqual(topic.toolkits, []);
  assert.equal(topic.createdAt, "2026-11-01");
  assert.equal(topic.updatedAt, "2026-11-01");
  assert.deepEqual(topic.notes, [{
    id: "n-1", kind: "note", createdAt: "2026-11-01 21:45",
    anchor: { file: "00-course-outline.md", locator: "text:section:0;block:1;offset:0", quote: "如何在不陷入“80 个碎包过度工程”的前提下，为 Pith 打造一个主干极简、万物可插拔、去 Session 化、且一套内核通吃多端原生壳的架构？" },
    body: "之前最大的纠结在于：1）把花园/园丁的隐喻写进了内核导致频繁改名；2）不知道怎么切分 Core 和 Plugin（差点把阅读器当成特权 Core）；3）觉得 DSH 全盘插件化太重，而 Magpie 的极简 Core + Plugin 更对胃口。",
    guideRemark: "已将这三个痛点分别对应拆解为本材料包的第 01、02、03 讲。读完每一讲后请直接回答文末的 15 分钟微实验题。",
  }]);
  const material = await store.getMaterial("material-001-magpie-dsh-anatomy");
  assert.ok(material);
  assert.equal(material.title, "Magpie · DSH · Super-agent 核心机制拆解讲义");
  assert.equal(material.kind, "article");
  assert.equal(material.createdAt, "2026-11-01");
  assert.deepEqual(material.files, [
    { name: "00-course-outline.md", mimeType: "text/markdown", bytes: 3504, sha256: "d772a3ef390f2c1451b2d07835b175181ddd06b7ca5fc4c7e0f99ccc4d550856", locator: "text:section:0;block:0;offset:0", lastActiveAt: "2026-11-01T22:02:00+08:00" },
    { name: "01-magpie-pragmatic-core-and-plugins.md", mimeType: "text/markdown", bytes: 12631, sha256: "d45a7e2b17c46a350f15956bd6a70ccfb6fe838e9ecab7802003d0ac7bbbb245", locator: "text:section:0;block:0;offset:0", lastActiveAt: undefined },
    { name: "02-dsh-capability-seams-and-effects.md", mimeType: "text/markdown", bytes: 11168, sha256: "e98e555198d9be7e21e4f0bffc5457ad31444ab2e71fc767186b0b05ae7c5a3b", locator: "text:section:0;block:0;offset:0", lastActiveAt: undefined },
    { name: "03-superagent-sessionless-attention.md", mimeType: "text/markdown", bytes: 9080, sha256: "13b3afab24d76671c43493360316ab165be8efd55dcc4047c6797a6f031d9266", locator: "text:section:0;block:0;offset:0", lastActiveAt: undefined },
  ]);
  assert.equal((await store.listTopics()).length, 1);
  assert.equal((await store.listMaterials()).length, 1);
});

test("serializes concurrent mutations across adapters sharing an identity", async () => {
  const storage = new MemoryStorage();
  const store = new DefaultWorkspaceStore(storage);
  const other = new DefaultWorkspaceStore(new MemoryStorage(storage));
  await store.ensureScaffold();
  await store.writeProfile("# Existing profile\n");
  await other.ensureScaffold();
  assert.equal((await store.readProfile()).markdown, "# Existing profile\n");
  await store.createTopic({ id: "topic-one", title: "Title" });
  const noteRequests = Array.from({ length: 5 }, (_, index) => (index % 2 ? store : other).appendNote("topic-one", {
    kind: "highlight", body: `line ${index}\n\nlast\n`, anchor: { file: "x.md", locator: "page:1", quote: `first\n\nlast ${index}` }, guideRemark: "first\n\nlast\n",
  }));
  const [notes] = await Promise.all([Promise.all(noteRequests), other.updateTopic("topic-one", { title: "Updated", materialId: "material-one", toolkits: ["x"] })]);
  const topic = await store.getTopic("topic-one");
  assert.ok(topic);
  assert.equal(topic.title, "Updated");
  assert.equal(topic.materialId, "material-one");
  assert.deepEqual(topic.notes, notes);
  assert.match(await storage.readText("topics/topic-one/topic.md"), /\[\[materials\/material-one\/material\]\]/);
  await assert.rejects(store.updateTopic("topic-one", { title: "" }));
  assert.equal((await other.updateTopic("topic-one", { title: "Recovered" })).title, "Recovered");
});

test("preserves real topic and material bodies while changing their metadata", async () => {
  const source = new ReadOnlyStorage();
  const storage = new MemoryStorage();
  const store = new DefaultWorkspaceStore(storage);
  const topicPath = "topics/topic-001-architecture-foundations/topic.md";
  const materialPath = "materials/material-001-magpie-dsh-anatomy/material.md";
  await storage.writeText(topicPath, await source.readText(topicPath));
  await storage.writeText(materialPath, await source.readText(materialPath));
  const originalTopic = await store.getTopic("topic-001-architecture-foundations");
  const originalTopicBody = parseFrontmatter(await storage.readText(topicPath)).body;
  const originalMaterialBody = parseFrontmatter(await storage.readText(materialPath)).body;
  await store.updateTopic("topic-001-architecture-foundations", { status: "settled" });
  assert.deepEqual((await store.getTopic("topic-001-architecture-foundations"))?.notes, originalTopic?.notes);
  assert.equal(parseFrontmatter(await storage.readText(topicPath)).body, originalTopicBody);
  await store.updateReadingLocator("material-001-magpie-dsh-anatomy", "00-course-outline.md", "page:5");
  assert.equal(parseFrontmatter(await storage.readText(materialPath)).body, originalMaterialBody);
});

test("isolates malformed topics and materials", async () => {
  const storage = new MemoryStorage();
  const store = new DefaultWorkspaceStore(storage);
  await store.createTopic({ id: "topic-good", title: "Good", target: "Learn" });
  await storage.mkdir("topics/topic-corrupt");
  await storage.writeText("topics/topic-corrupt/topic.md", "---\ntype: pith-topic\nid: bad\n---\n");
  await store.importMaterial({ id: "material-good", title: "Good", kind: "book", files: [] });
  await storage.mkdir("materials/material-corrupt");
  await storage.writeText("materials/material-corrupt/material.md", "not frontmatter");
  assert.deepEqual((await store.listTopics()).map(topic => topic.id), ["topic-good"]);
  assert.deepEqual((await store.listMaterials()).map(material => material.id), ["material-good"]);
  await assert.rejects(store.getTopic("topic-corrupt"));
});

test("imports immutable files, updates generated files and records reading progress", async () => {
  const storage = new MemoryStorage();
  const store = new DefaultWorkspaceStore(storage);
  const material = await store.importMaterial({ id: "material-one", title: "Material", kind: "article", files: [{ name: "original.md", mimeType: "text/markdown", bytes: new TextEncoder().encode("abc") }] });
  assert.equal(material.files[0]?.sha256, "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  await assert.rejects(store.writeGeneratedFile(material.id, "original.md", "overwrite"));
  assert.equal(await storage.readText("materials/material-one/files/original.md"), "abc");
  await store.writeGeneratedFile(material.id, "lesson.md", "first");
  await store.updateReadingLocator(material.id, "lesson.md", "page:3");
  const updated = await store.writeGeneratedFile(material.id, "lesson.md", "second");
  assert.equal(updated.files[1]?.bytes, 6);
  assert.equal(updated.files[1]?.locator, "page:3");
  assert.ok(updated.files[1]?.lastActiveAt);
  assert.equal(await storage.readText("materials/material-one/files/lesson.md"), "second");
  const appended = await store.appendMaterialFiles(material.id, [{ name: "clip.mp3", mimeType: "audio/mpeg", bytes: new Uint8Array([1, 2, 3]) }, { name: "clip.vtt", mimeType: "text/vtt", bytes: new TextEncoder().encode("WEBVTT\n\n00:00.000 --> 00:01.000\nhi\n") }]);
  assert.deepEqual(appended.files.map(file => file.name), ["original.md", "lesson.md", "clip.mp3", "clip.vtt"]);
  await assert.rejects(store.appendMaterialFiles(material.id, [{ name: "clip.mp3", bytes: new Uint8Array([9]) }]), /Cannot overwrite existing material file/);
  assert.equal(await storage.readText("materials/material-one/files/lesson.md"), "second");
  await assert.rejects(store.importMaterial({ id: "material-one", title: "Duplicate", kind: "book", files: [] }));
  await assert.rejects(store.writeGeneratedFile(material.id, "../escape.md", "x"));
  await assert.rejects(store.updateReadingLocator(material.id, "missing.md", "page:1"));
});

test("round-trips controlled frontmatter and preserves Markdown bodies", () => {
  const doc = { type: "pith-material", title: "A: \"quote\"\nline", files: [{ name: "x.md", bytes: 1, generated: true }], toolkits: ["a", "b"] };
  assert.deepEqual(parseFrontmatter(stringifyFrontmatter(doc, "\n# Body\n")), { attributes: doc, body: "\n# Body\n" });
  assert.deepEqual(parseFrontmatter("---\ntoolkits: [shadowing, 'a,b']\n---\n").attributes.toolkits, ["shadowing", "a,b"]);
  assert.throws(() => parseFrontmatter("---\ntype: a\ntype: b\n---\n"));
});
