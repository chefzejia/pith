import { pdfFixture } from "./task55-pdf-fixture.ts";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPithWebServer } from "../src/shells/web/server.ts";
import { NodeWorkspaceStorage } from "../src/shells/web/nodeStorage.ts";
import { DefaultAttentionEngine, DefaultWorkspaceStore } from "../src/core/index.ts";
import { bootStandaloneShell } from "../src/shells/web/index.ts";

test("web shell serves course, records notes and honors plugin in-use locks", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pith-web-"));
  const workspace = join(dir, "workspace");
  await mkdir(workspace);
  const store = new DefaultWorkspaceStore(new NodeWorkspaceStorage(workspace));
  const material = await store.importMaterial({ title: "Course", kind: "article", files: [{ name: "source.md", mimeType: "text/markdown", bytes: new TextEncoder().encode("# Magpie\nContent") }] });
  const created = await store.createTopic({ title: "Course", target: "Understand the course", materialIds: [material.id], toolkits: [] });
  const server = await createPithWebServer({ workspaceDir: workspace, port: 0 });
  try {
    const address = server.address(); assert.ok(address && typeof address !== "string");
    const base = `http://127.0.0.1:${address.port}`;
    const get = async (path: string) => { const res = await fetch(base + path); assert.equal(res.status, 200); return res.json() as Promise<any>; };
    const post = async (path: string, value: unknown) => { const res = await fetch(base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(value) }); assert.ok(res.ok, await res.clone().text()); return res.json() as Promise<any>; };
    assert.match(await (await fetch(base)).text(), /<script src="\/app\.js" defer>/);
    assert.match(await (await fetch(`${base}/app.js`)).text(), /pith-home-scroll/);
    const state = await get("/api/state");
    const topic = state.compass.exploring[0]; assert.equal(topic.id, created.id);
    const lesson = await get(`/api/materials/${material.id}/file?name=source.md`);
    assert.match(lesson.text, /Magpie/);
    assert.equal(lesson.format, "markdown");
    const pdf = Buffer.from(pdfFixture("page"));
    const book = await post("/api/materials", { title: "book", kind: "book", files: [{ name: "book.pdf", mimeType: "application/pdf", data: pdf.toString("base64") }] });
    const rawPdf = await fetch(`${base}/api/materials/${book.id}/raw?name=book.pdf`);
    assert.equal(rawPdf.headers.get("content-type"), "application/pdf");
    assert.deepEqual(Buffer.from(await rawPdf.arrayBuffer()), pdf);
    const before = await readFile(join(workspace, "materials", material.id, "files", "source.md"));
    await post("/api/notes", { topicId: topic.id, kind: "highlight", body: "选中文本", anchor: { source: { kind: "material", materialId: material.id }, file: "source.md", locator: "text:offset:1", quote: "选中文本" } });
    await post("/api/notes", { topicId: topic.id, kind: "note", body: "我的笔记" });
    const chat = await post("/api/chat", { topicId: topic.id, text: "我的问题" });
    assert.equal(chat.guideEntry, undefined);
    assert.equal((await get(`/api/chat?topicId=${topic.id}`)).length, 1);
    const settings = await post("/api/plugins", { preset: "essentials", persona: "studio" });
    assert.equal(settings.settings.persona, "studio");
    const locked = await post("/api/plugins", { id: "stage-reader", enabled: false });
    assert.equal(locked.plugins.find((p: any) => p.id === "stage-reader").source, "in-use");
    await store.updateTopic(topic.id, { toolkits: ["shadowing"] });
    const guarded = await get("/api/state");
    assert.equal(guarded.plugins.find((p: any) => p.id === "toolkit-shadowing").inUseCount, 1);
    assert.equal(guarded.plugins.find((p: any) => p.id === "toolkit-shadowing").state, "active");
    assert.equal(guarded.plugins.find((p: any) => p.id === "stage-timeline").state, "active");
    assert.equal(guarded.plugins.find((p: any) => p.id === "speech-service").state, "active");
    assert.equal((await get("/api/state")).compass.exploring[0].notes.length, topic.notes.length + 2);
    assert.deepEqual(await readFile(join(workspace, "materials", material.id, "files", "source.md")), before);
    assert.equal((await fetch(base + "/api/plugins", { method: "POST", body: "{}" })).status, 415);
    assert.equal((await fetch(base + "/api/state", { headers: { origin: "http://evil.example" } })).status, 403);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await rm(dir, { recursive: true, force: true });
  }
});

test("node storage rejects traversal and symbolic links", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pith-storage-"));
  try {
    const storage = new NodeWorkspaceStorage(dir);
    await symlink(tmpdir(), join(dir, "escape"));
    await assert.rejects(storage.readText("../outside"));
    await assert.rejects(storage.writeText("escape/outside", "bad"));
    await assert.rejects(storage.readText("/etc/passwd"));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("unknown guide providers cannot run background selection effects", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pith-guide-"));
  const storage = new NodeWorkspaceStorage(dir);
  const store = new DefaultWorkspaceStore(storage);
  const created = await store.createTopic({ title: "Guide", target: "Understand the guide", materialIds: [], toolkits: [] });
  let calls = 0;
  const provider: import("../src/core/index.ts").GuideProvider = { run: async () => { calls++; await store.appendTopicNote(created.id, { kind: "note", author: "guide", body: "不应执行" }); return { status: "completed" }; } };
  const engine = new DefaultAttentionEngine(store, storage, () => provider);
  const runtime = bootStandaloneShell({ id: "web", storage }, { preset: "all" }, { store, engine, provider, snapshot: { known: true, topics: await store.listTopics(), materials: [] } });
  try {
    await engine.capture({ owner: { topicId: created.id }, kind: "note", body: "想法" });
    assert.equal(await engine.processDueEffects(), 1);
    const topic = await store.getTopic(created.id);
    assert.equal(calls, 0);
    assert.equal(topic?.nextAction, undefined);
    assert.deepEqual(topic?.notes.map(note => note.body), ["想法"]);
    assert.equal((await engine.listEffects())[0]?.status, "failed");
  } finally {
    runtime.stop();
    await rm(dir, { recursive: true, force: true });
  }
});
