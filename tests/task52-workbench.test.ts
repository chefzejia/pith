import { materialReadings, rememberMaterialReading, readingPositionLabel } from "../src/workbench/readingState.ts";
import { MaterialSession } from "../src/workbench/materialSession.ts";
import { testToolkits } from "./guide-tools-fixture.ts";
import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import test from "node:test";
import { DefaultAttentionEngine, DefaultWorkspaceStore, type GuideProvider } from "../src/core/index.ts";
import { NodeWorkspaceStorage } from "../src/shells/web/nodeStorage.ts";
import { IntakeSession, splitIntakeText, type IntakePorts } from "../src/workbench/intake.ts";
import { groupMaterialFiles, prepareMaterialImport, sampleMaterialText } from "../src/workbench/importMaterial.ts";
import { initialMaterialAids } from "../src/workbench/toolkitSlot.ts";
import { boardMaterials, coverCachePath } from "../src/workbench/boardMaterials.ts";
import { shadowingToolkit } from "../src/plugins/toolkit-shadowing/index.ts";
import { feynmanToolkit } from "../src/plugins/toolkit-feynman/index.ts";
import { interlineToolkit } from "../src/plugins/toolkit-interline/index.ts";
import { buildScenePrompt, quickActionsForTopic, normalizeToolkits } from "../src/plugins/guide-acp/index.ts";
import { renderFile, renderMarkdown, markdownSections } from "../src/plugins/stage-reader/index.ts";
import { coveredEpub } from "./task29-fixture.ts";
import { pdfFixture } from "./task55-pdf-fixture.ts";
import { createScopedTools } from "../src/plugins/guide-acp/tools.ts";
import { testSandbox } from "./sandbox.ts";

const file = (name: string, text = "这是中文阅读材料") => new File([text], name, { type: "text/plain" });

test("intake groups same stems and language sidecars, retaining unrelated originals", async () => {
  const files = [file("clip.en-US.vtt"), file("clip.mp4"), file("clip.zh-Hans.srt"), file("notes.md"), file("comic.CBZ")];
  assert.deepEqual(groupMaterialFiles(files).map(group => group.map(file => file.name)), [["clip.en-US.vtt", "clip.mp4", "clip.zh-Hans.srt"], ["notes.md"], ["comic.CBZ"]]);
  const comic = await prepareMaterialImport([files[4]!]); assert.equal(comic.kind, "book"); assert.deepEqual(comic.files[0]!.bytes, new TextEncoder().encode("这是中文阅读材料"));
  assert.deepEqual(splitIntakeText('比较两个仓库 "/repo with spaces" "~/other" https://example.com/post'), { goal: "比较两个仓库", repositories: ["/repo with spaces", "~/other"], urls: ["https://example.com/post"] });
  assert.deepEqual(splitIntakeText("/repo with spaces 理解事件机制"), { goal: "", repositories: ["/repo with spaces 理解事件机制"], urls: [] });
  assert.deepEqual(splitIntakeText(String.raw`"C:\Project One" "D:\Project Two" https://github.com/fixture/repository`), { goal: "", repositories: [String.raw`C:\Project One`, String.raw`D:\Project Two`, "https://github.com/fixture/repository"], urls: [] });
  assert.deepEqual([interlineToolkit.role, shadowingToolkit.role, feynmanToolkit.role], ["aid", "training", "training"]);
});

test("intake retains imports through a question, failure and stop without duplicating bytes or a topic", async () => {
  const root = await testSandbox("task52-retention-");
  try {
    const storage = new NodeWorkspaceStorage(root), store = new DefaultWorkspaceStore(storage); await store.ensureScaffold();
    let calls = 0, saved = 0, mode: "question" | "fail" | "stop" | "create" = "question";
    const provider: GuideProvider = { async run(input, options) {
      calls++; assert.equal(input.scope.kind, "intake"); if (input.scope.kind !== "intake") throw new Error("scope");
      assert.equal(input.scope.materialIds.length, 1);
      if (mode === "fail") throw new Error("provider disconnected");
      if (mode === "stop") { await new Promise<void>(resolve => options.signal.addEventListener("abort", () => resolve(), { once: true })); return { status: "stopped" }; }
      if (mode === "question") { options.onStep({ kind: "reply", markdown: "你想解释哪个机制？" }, 0); return { status: "completed" }; }
      assert.ok(input.history.some(turn => turn.steps.some(step => step.kind === "reply" && step.markdown.includes("哪个机制"))));
      const create = createScopedTools({ toolkits: testToolkits, store, storage, materialIds: input.scope.materialIds, onChoices() {} }).find(tool => tool.name === "pith_create_topic")!;
      const args = { title: "事件机制", target: input.text, materialIds: input.scope.materialIds, toolkits: [] }, topic = await create.execute(args);
      options.onStep({ kind: "tool", callId: "created", name: create.name, inputPreview: "{}", status: "completed", effects: await create.effects!(topic, args) }, 0); return { status: "completed" };
    } };
    const engine = new DefaultAttentionEngine(store, storage, () => provider);
    const ports: IntakePorts = { importFiles: async files => { saved++; const input = await prepareMaterialImport(files); return store.importMaterial({ ...input, aids: initialMaterialAids(await sampleMaterialText(input.files)) }); }, importUrl: async () => { throw new Error("unused"); }, importRepository: async () => { throw new Error("unused"); }, intake: (input, options) => engine.intake(input, options) };
    const session = new IntakeSession(ports), original = file("events.md");
    const goal = await session.prepare("解释事件机制", [original], async () => {}); assert.equal(saved, 1); assert.equal(calls, 0);
    const question = await session.ask(goal, {}); assert.equal(question.topic, null); assert.equal(session.previous.length, 1);
    mode = "fail"; assert.equal((await session.ask(goal, {})).turn.status, "failed");
    mode = "stop"; const abort = new AbortController(); const stop = session.ask(goal, { signal: abort.signal }); await new Promise<void>(resolve => setImmediate(resolve)); abort.abort(); assert.equal((await stop).turn.status, "stopped");
    await session.prepare("解释事件机制", [original], async () => {}); assert.equal(saved, 1); assert.equal((await store.listMaterials()).length, 1); assert.equal((await store.listTopics()).length, 0);
    const material = [...session.materials.values()][0]!; assert.deepEqual(new Uint8Array(await storage.readBinary(`materials/${material.id}/files/events.md`)), new TextEncoder().encode("这是中文阅读材料"));
    mode = "create"; const result = await session.ask("解释事件传播", {}); assert.ok(result.topic); assert.deepEqual(result.topic.materialIds, [material.id]); assert.deepEqual((await engine.getConversation(result.topic.id)).map(turn => turn.user.text), [goal, "解释事件传播"]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("board reads only cached thumbnails and material capture remains visible to topic guide", async () => {
  const root = await testSandbox("task52-ownership-");
  try {
    const storage = new NodeWorkspaceStorage(root), store = new DefaultWorkspaceStore(storage); await store.ensureScaffold();
    const material = await store.importMaterial({ title: "English article", kind: "article", files: [{ name: "article.md", bytes: new TextEncoder().encode("An original paragraph.") }], aids: ["interline"] });
    const engine = new DefaultAttentionEngine(store, storage);
    const anchor = { source: { kind: "material" as const, materialId: material.id }, file: "article.md", locator: "text:line:0", quote: "An original paragraph." };
    await engine.capture({ owner: { materialId: material.id }, kind: "note", body: "先理解条件", anchor });
    const topic = await store.createTopic({ title: "条件", target: "什么条件保证结论成立", materialIds: [material.id], toolkits: [] });
    assert.equal((await store.getMaterial(material.id))!.notes[0]!.author, "user"); assert.deepEqual((await store.getTopic(topic.id))!.notes, []);
    await assert.rejects(engine.capture({ owner: { materialId: material.id }, kind: "practice", body: "不能归材料", anchor }));
    await store.setMaterialAids(material.id, []); assert.deepEqual((await store.getTopic(topic.id))!.toolkits, []);
    const png = "data:image/png;base64,iVBORw0KGgo="; await storage.mkdir("_cache/covers"); await storage.writeText(coverCachePath(material.id), JSON.stringify({ url: png }));
    let originals = 0; const onlyCache = Object.assign(Object.create(storage), { readText: (path: string) => { if (!path.startsWith("_cache/covers/")) throw new Error("not a cover"); return storage.readText(path); }, readBinary: async () => { originals++; throw new Error("board must not read originals"); } });
    assert.equal((await boardMaterials(onlyCache, [material]))[0]!.coverUrl, png); assert.equal(originals, 0);
    assert.equal((await engine.compass()).library[0]!.topicIds[0], topic.id);
  } finally { await rm(root, { recursive: true, force: true }); }
});


test("only registered training roles can be created, configured or offered to the guide", async () => {
  const root = await testSandbox("task52-training-roles-");
  try {
    const storage = new NodeWorkspaceStorage(root), store = new DefaultWorkspaceStore(storage); await store.ensureScaffold();
    assert.deepEqual(normalizeToolkits(["feynman", "shadowing", "feynman"], testToolkits), ["feynman", "shadowing"]);
    assert.throws(() => normalizeToolkits(["interline"], testToolkits), /Invalid/);
    assert.throws(() => normalizeToolkits(["unregistered"], testToolkits), /Invalid/);
    const tools = createScopedTools({ store, storage, toolkits: testToolkits, onChoices() {} });
    const create = tools.find(tool => tool.name === "pith_create_topic")!;
    const args = { title: "因果", target: "辨析前提", materialIds: [], toolkits: ["interline"] };
    await assert.rejects(create.execute(args), /Invalid toolkit/); assert.deepEqual(await store.listTopics(), []);
    const topic = await create.execute({ ...args, toolkits: ["feynman"] }) as import("../src/core/index.ts").Topic;
    const configure = tools.find(tool => tool.name === "pith_configure_toolkits")!;
    await assert.rejects(configure.execute({ toolkits: ["interline"] }), /Invalid toolkit/);
    assert.deepEqual((await store.getTopic(topic.id))!.toolkits, ["feynman"]);
    const prompt = buildScenePrompt({ profileMarkdown: "", topic, materials: [], userMessage: "继续", availableToolkits: testToolkits });
    const available = JSON.parse(prompt.split("# 可用训练工具\n")[1]!.split("\n\n")[0]!);
    assert.deepEqual(available.map((tool: any) => tool.id).sort(), ["feynman", "shadowing"]);
    const aid = { ...interlineToolkit, quickActions: [{ id: "aid", label: "Aid", prompt: "must not appear" }] };
    assert.equal(quickActionsForTopic({ ...topic, toolkits: ["interline"] }, [aid]).some(action => action.id === "aid"), false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("Agent imports initialize material aids from the same readable sample without mounting training", async () => {
  const root = await testSandbox("task52-agent-import-");
  try {
    const storage = new NodeWorkspaceStorage(root), store = new DefaultWorkspaceStore(storage); await store.ensureScaffold();
    const topic = await store.createTopic({ title: "材料证据", target: "理解前提", materialIds: [], toolkits: ["feynman"] });
    const reader = { formats: ["markdown", "epub", "pdf"] as const, render: renderMarkdown, sections: markdownSections, renderFile };
    const samples = [
      { name: "english.md", mimeType: "text/markdown", bytes: new TextEncoder().encode("An explanation of necessary conditions and causal mechanisms.") },
      { name: "中文.md", mimeType: "text/markdown", bytes: new TextEncoder().encode("因果机制需要核对前提和条件，不能把相关性直接当作因果。") },
      { name: "book.epub", mimeType: "application/epub+zip", bytes: coveredEpub() },
      { name: "paper.pdf", mimeType: "application/pdf", bytes: pdfFixture("Necessary conditions and causal evidence") },
    ];
    for (const sample of samples) {
      const expected = initialMaterialAids(await sampleMaterialText([sample]));
      const tools = createScopedTools({ store, storage, topicId: topic.id, toolkits: testToolkits, reader, mediaCorpus: { async searchMedia() { return []; }, async fetchMediaCorpus() { return { title: sample.name, sourceUrl: "https://example.com/source", files: [sample] }; } }, onChoices() {} });
      const result = await tools.find(tool => tool.name === "pith_fetch_media_corpus")!.execute({ url: "https://example.com/source" }) as { material: import("../src/core/index.ts").Material };
      assert.deepEqual(result.material.aids, expected, sample.name); assert.deepEqual((await store.getTopic(topic.id))!.toolkits, ["feynman"]);
      if (sample.name === "english.md") assert.deepEqual(expected, ["interline"]);
      if (sample.name === "中文.md") assert.deepEqual(expected, []);
    }
    await store.updateTopic(topic.id, { toolkits: [] });
    const http = { async request() { throw new Error("unused"); }, async requestPublic() { return { status: 200, headers: { "content-type": "text/markdown" }, bytes: samples[0]!.bytes }; } };
    const external = createScopedTools({ store, storage, topicId: topic.id, toolkits: testToolkits, http, reader, onChoices() {} }).find(tool => tool.name === "pith_ingest_external")!;
    const result = await external.execute({ title: "Document", urls: ["https://example.com/document"] }) as { material: import("../src/core/index.ts").Material };
    assert.deepEqual(result.material.aids, ["interline"]); assert.deepEqual((await store.getTopic(topic.id))!.toolkits, []);
  } finally { await rm(root, { recursive: true, force: true }); }
});


test("repository reading resumes from its material ledger without changing its file collection", async () => {
  const root = await testSandbox("task52-repo-resume-");
  try {
    const storage = new NodeWorkspaceStorage(root), store = new DefaultWorkspaceStore(storage); await store.ensureScaffold();
    const material = await store.importMaterial({ title: "Pinned code", kind: "repo", externalPath: "/fixture/repo", commitSha: "a".repeat(40), files: [] });
    const locator = `repo:${material.commitSha}:src/index.ts#L2-L2`;
    await rememberMaterialReading(store, material.id, "src/index.ts", locator);
    await rememberMaterialReading(store, material.id, "src/index.ts");
    const updated = (await store.getMaterial(material.id))!;
    const readings = materialReadings([updated]); assert.equal(readings[material.id]!.locator, locator); assert.equal(readingPositionLabel(locator), "第 2 行");
    const state = { topic: null, materials: [material], repositoryFiles: { [material.id]: ["README.md", "src/index.ts"] }, readings };
    let document: any;
    const session = new MaterialSession(state, { title: material.title, active: () => true, loadState: async () => state, readFile: async (_source, name) => ({ html: name, sections: [] }), readOutline: async () => undefined, render: value => { document = value; }, updateNavigation() {}, beforeLesson: async () => {}, sendLesson: async () => {} });
    await session.open(); assert.equal(session.file, "src/index.ts"); assert.equal(document.locator, locator);
    assert.equal((await boardMaterials(storage, [updated]))[0]!.reading!.file, "src/index.ts");
    assert.deepEqual(updated.files, []);
    await storage.mkdir("_cache/reading");
    await storage.writeText(`_cache/reading/${material.id}.json`, "broken"); assert.deepEqual(materialReadings([updated]), readings);
    session.dispose();
  } finally { await rm(root, { recursive: true, force: true }); }
});
