import test from "node:test";
import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPithWebServer } from "../src/shells/web/server.ts";
import { NodeWorkspaceStorage } from "../src/shells/web/nodeStorage.ts";
import { DefaultAttentionEngine, DefaultWorkspaceStore } from "../src/core/index.ts";
import { bootStandaloneShell } from "../src/shells/web/index.ts";

test("web shell serves course, records notes and honors plugin in-use locks", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pith-web-"));
  const workspace = join(dir, "workspace");
  await cp(join(process.cwd(), "workspace"), workspace, { recursive: true });
  const server = await createPithWebServer({ workspaceDir: workspace, port: 0 });
  try {
    const address = server.address(); assert.ok(address && typeof address !== "string");
    const base = `http://127.0.0.1:${address.port}`;
    const get = async (path: string) => { const res = await fetch(base + path); assert.equal(res.status, 200); return res.json() as Promise<any>; };
    const post = async (path: string, value: unknown) => { const res = await fetch(base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(value) }); assert.ok(res.ok, await res.clone().text()); return res.json() as Promise<any>; };
    assert.match(await (await fetch(base)).text(), /注意力罗盘/);
    const state = await get("/api/state");
    const topic = state.compass.exploring[0]; assert.equal(topic.id, "topic-001-architecture-foundations");
    const lesson = await get(`/api/materials/${topic.materialId}/file?name=00-course-outline.md`);
    assert.match(lesson.text, /Magpie/);
    assert.equal(lesson.format, "markdown");
    const pdf = Buffer.from("%PDF-1.4\n1 0 obj\n<< /Type /Page /Contents 2 0 R >>\nendobj\n2 0 obj\n<< /Length 15 >>\nstream\nBT (page) Tj ET\nendstream\nendobj\n%%EOF");
    const book = await post("/api/materials", { title: "book", kind: "book", files: [{ name: "book.pdf", mimeType: "application/pdf", data: pdf.toString("base64") }] });
    assert.equal((await get(`/api/materials/${book.id}/file?name=book.pdf`)).format, "pdf");
    const before = await readFile(join(workspace, "materials", topic.materialId, "files", "00-course-outline.md"));
    await post("/api/notes", { topicId: topic.id, kind: "highlight", body: "选中文本", anchor: { file: "00-course-outline.md", locator: "text:offset:1", quote: "选中文本" } });
    await post("/api/notes", { topicId: topic.id, kind: "note", body: "我的笔记" });
    const chat = await post("/api/chat", { topicId: topic.id, text: "我的问题" });
    assert.equal(chat.guideEntry, undefined);
    assert.equal((await get(`/api/chat?topicId=${topic.id}`)).length, 1);
    const settings = await post("/api/plugins", { preset: "essentials", persona: "studio" });
    assert.equal(settings.settings.persona, "studio");
    const locked = await post("/api/plugins", { id: "stage-reader", enabled: false });
    assert.equal(locked.plugins.find((p: any) => p.id === "stage-reader").source, "in-use");
    const store = new DefaultWorkspaceStore(new NodeWorkspaceStorage(workspace));
    await store.updateTopic(topic.id, { toolkits: ["shadowing"] });
    const guarded = await get("/api/state");
    assert.equal(guarded.plugins.find((p: any) => p.id === "dojo-shadowing").inUseCount, 1);
    assert.equal(guarded.plugins.find((p: any) => p.id === "dojo-shadowing").state, "active");
    assert.equal(guarded.plugins.find((p: any) => p.id === "stage-timeline").state, "active");
    assert.equal(guarded.plugins.find((p: any) => p.id === "speech-service").state, "active");
    assert.equal((await get("/api/state")).compass.exploring[0].notes.length, topic.notes.length + 2);
    assert.deepEqual(await readFile(join(workspace, "materials", topic.materialId, "files", "00-course-outline.md")), before);
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

test("configured guide processes selection effects and updates the next action", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pith-guide-"));
  const storage = new NodeWorkspaceStorage(dir);
  const store = new DefaultWorkspaceStore(storage);
  await store.createTopic({ id: "topic-guide", title: "Guide" });
  const provider = { reply: async () => "阅读下一节" };
  const engine = new DefaultAttentionEngine(store, storage, () => provider);
  const runtime = bootStandaloneShell({ id: "web", storage }, { preset: "all" }, { store, engine, provider, snapshot: { known: true, topics: await store.listTopics(), materials: [] } });
  try {
    await engine.captureSelection({ topicId: "topic-guide", kind: "note", body: "想法" });
    assert.equal(await engine.processDueEffects(), 1);
    assert.equal((await store.getTopic("topic-guide"))?.nextAction, "阅读下一节");
  } finally {
    runtime.stop();
    await rm(dir, { recursive: true, force: true });
  }
});
