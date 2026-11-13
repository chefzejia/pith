import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import test from "node:test";
import { DefaultWorkspaceStore } from "../src/core/index.ts";
import { NodeWorkspaceStorage } from "../src/shells/web/nodeStorage.ts";
import { MaterialSession } from "../src/workbench/materialSession.ts";
import { testSandbox } from "./sandbox.ts";

test("shared material session preserves reading while a generated lesson arrives", async () => {
  const root = await testSandbox("task40-session-"); const storage = new NodeWorkspaceStorage(root), store = new DefaultWorkspaceStore(storage);
  let release!: () => void, started!: () => void; const held = new Promise<void>(resolve => { release = resolve; }), ready = new Promise<void>(resolve => { started = resolve; });
  try {
    const material = await store.importMaterial({ title: "材料一", kind: "article", files: [{ name: "01.md", bytes: new TextEncoder().encode("第一份") }] });
    const second = await store.importMaterial({ title: "材料二", kind: "article", files: [{ name: "01.md", bytes: new TextEncoder().encode("第二份") }] });
    const topic = await store.createTopic({ title: "课程", target: "理解材料", materialIds: [material.id, second.id], toolkits: [] });
    const shown: string[] = [], navigation: string[][] = []; let active = true;
    const loadState = async () => ({ topic: (await store.getTopic(topic.id))!, materials: [material, second], repositoryFiles: {} });
    const session = new MaterialSession(await loadState(), {
      title: topic.title, active: () => active,
      loadState,
      readFile: async (source, name) => ({ html: source.kind === "lesson" ? await store.readLesson(topic.id, name) : await storage.readText(`materials/${source.materialId}/files/${name}`), sections: [] }),
      readOutline: async () => undefined,
      render: document => { shown.push(document.html); }, updateNavigation: files => { navigation.push(files.map(file => file.name)); },
      beforeLesson: async () => {}, sendLesson: async name => { started(); await held; await store.writeLesson(topic.id, name, "# 第二讲\n实际落盘"); },
    });
    await session.open(); assert.deepEqual(shown, ["第一份"]); await session.refresh(); assert.deepEqual(shown, ["第一份"]);
    const generating = session.generateLesson("02.md", "第二讲"); await ready; await session.openMaterial(second.id); release(); await generating;
    assert.equal(session.file, "01.md"); assert.deepEqual(session.source, { kind: "material", materialId: second.id });
    assert.deepEqual(shown, ["第一份", "第二份"]); assert.ok(navigation.at(-1)?.includes("02.md")); assert.match(await store.readLesson(topic.id, "02.md"), /实际落盘/);
    active = false; await session.open(); assert.equal(shown.at(-1), "第二份"); session.dispose();
  } finally { release(); await rm(root, { recursive: true, force: true }); }
});
