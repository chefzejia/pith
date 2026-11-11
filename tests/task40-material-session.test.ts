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
    const material = await store.importMaterial({ title: "课程", kind: "article", files: [{ name: "01.md", bytes: new TextEncoder().encode("# 第一讲\n正文") }] });
    const topic = await store.createTopic({ title: "课程", materialId: material.id });
    const shown: string[] = [], navigation: string[][] = []; let active = true;
    const session = new MaterialSession(material, {
      title: topic.title, active: () => active,
      loadMaterial: async () => { const latest = await store.getTopic(topic.id); return latest?.materialId ? (await store.getMaterial(latest.materialId)) ?? undefined : undefined; },
      readFile: async (item, name) => ({ html: await storage.readText(`materials/${item.id}/files/${name}`), sections: [] }),
      readOutline: async item => item.files.some(file => file.name === "00-课程大纲.md") ? storage.readText(`materials/${item.id}/files/00-课程大纲.md`) : undefined,
      render: document => { shown.push(document.currentFile); }, updateNavigation: files => { navigation.push(files.map(file => file.name)); },
      beforeLesson: async () => {}, sendLesson: async name => { started(); await held; await store.writeGeneratedFile(material.id, name, "# 第二讲\n实际落盘"); },
    });
    await session.open(); assert.deepEqual(shown, ["01.md"]); await session.refresh(); assert.deepEqual(shown, ["01.md"]);
    const generating = session.generateLesson("02.md", "第二讲"); await ready; await session.openFile("01.md"); release(); await generating;
    assert.equal(session.file, "01.md"); assert.deepEqual(shown, ["01.md", "01.md"]); assert.ok(navigation.at(-1)?.includes("02.md")); assert.match(await storage.readText(`materials/${material.id}/files/02.md`), /实际落盘/);
    const subtitle = new TextEncoder().encode("WEBVTT\n\n00:00.000 --> 00:01.000\nHello\n"); await store.appendMaterialFiles(material.id, [{ name: "clip.en.vtt", mimeType: "text/vtt", bytes: subtitle }]); await session.refresh();
    assert.equal(session.file, "clip.en.vtt"); assert.deepEqual(new Uint8Array(await storage.readBinary(`materials/${material.id}/files/clip.en.vtt`)), subtitle);
    active = false; await session.open(); assert.equal(shown.at(-1), "clip.en.vtt"); session.dispose();
  } finally { release(); await rm(root, { recursive: true, force: true }); }
});
