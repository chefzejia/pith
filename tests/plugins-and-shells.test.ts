import assert from "node:assert/strict";
import test from "node:test";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { markdownSections } from "../src/plugins/stage-reader/index.ts";
import { findCueAt, formatTimestamp, parseTranscript } from "../src/plugins/stage-timeline/index.ts";
import { isLoopbackSafe, splitSentences } from "../src/plugins/speech-service/index.ts";
import { diagnose, shadowingToolkit, transformCue } from "../src/plugins/dojo-shadowing/index.ts";
import { buildScenePrompt, quickActionsForTopic } from "../src/plugins/guide-acp/index.ts";
import { DefaultWorkspaceStore, type Topic } from "../src/core/index.ts";
import { createPithWebServer } from "../src/shells/web/server.ts";
import { NodeWorkspaceStorage } from "../src/shells/web/nodeStorage.ts";
import { createObsidianHostPort, PithObsidianController, type ObsidianVaultAdapter } from "../src/shells/obsidian/index.ts";
import { createDshPluginBundle } from "../src/shells/dsh/index.ts";

test("reader headings and subtitle timelines preserve intrinsic positions", () => {
  assert.deepEqual(markdownSections("# First\n```\n# Not a heading\n```\n## Second"), [
    { title: "First", level: 1, line: 0, locator: "text:line:0" },
    { title: "Second", level: 2, line: 4, locator: "text:line:4" },
  ]);
  const srt = parseTranscript("1\n00:00:01,250 --> 00:00:03,000\nHello.\n\n2\n00:00:04,000 --> 00:00:06,000\nWorld!\n");
  assert.equal(srt.length, 2);
  assert.equal(srt[0]?.startSec, 1.25);
  assert.equal(findCueAt(srt, 2)?.text, "Hello.");
  assert.equal(findCueAt(srt, 3), null);
  const vtt = parseTranscript("WEBVTT\n\n00:01.000 --> 00:02.500 align:start\n<v Ada>Hello there</v>\n");
  assert.equal(vtt[0]?.speaker, "Ada");
  assert.equal(vtt[0]?.text, "Hello there");
  const timed = parseTranscript("[01:02] Alpha\n[01:08] Beta");
  assert.equal(findCueAt(timed, 65)?.text, "Alpha");
  assert.equal(timed[0]?.endSec, 68);
  assert.equal(formatTimestamp(3661), "01:01:01");
  assert.equal(formatTimestamp(61), "01:01");
});

test("speech segmentation and loopback validation are deterministic and fail closed", () => {
  const input = "  Hello world!  你好。 Next?";
  const segments = splitSentences(input);
  assert.ok(segments.length >= 3);
  for (const part of segments) assert.equal(input.slice(part.offset, part.offset + part.text.length), part.text);
  for (const url of ["http://localhost:8765/asr", "https://127.2.3.4:443/asr", "http://[::1]:99/"]) assert.equal(isLoopbackSafe(url), true, url);
  for (const url of ["http://localhost.evil/asr", "http://user@localhost/", "http://localhost/?x=1", "http://localhost/#x", "file://localhost/x", "http://127.01.0.1/", "http://127.1/", "http://[::ffff:127.0.0.1]/", "http://127.0.0.1.evil/"]) assert.equal(isLoopbackSafe(url), false, url);
});

test("four-stage scaffolding, Unicode LCS, and contextual guide actions", () => {
  const text = "It's in the book, that's on the table.";
  const cloze = transformCue(text, "scaffold-cloze");
  assert.match(cloze, /It's ___ ___ book/);
  assert.match(cloze, /that's ___ ___ table/);
  assert.equal(transformCue(text, "guided-follow"), text);
  assert.match(transformCue(text, "listen-decompose"), /book, \/ /);
  assert.notEqual(transformCue(text, "blind-produce"), text);
  const result = diagnose("Café × and it's a good day", "Cafe\u0301 and it's day");
  assert.deepEqual(result.missedTokens, ["a", "good"]);
  assert.deepEqual(result.matchedTokens, ["Café", "and", "it's", "day"]);
  assert.equal(result.accuracyScore, 4 / 6);
  assert.match(result.summaryMarkdown, /漏词/);
  assert.throws(() => diagnose("× ÷ !", ""), /没有可对齐/);
  const topic: Topic = { id: "t", title: "Title", target: "Understand", status: "exploring", toolkits: ["shadowing"], notes: [{ id: "n", kind: "note", body: "reflection", createdAt: "today" }], createdAt: "today", updatedAt: "today" };
  assert.deepEqual(quickActionsForTopic(topic, [shadowingToolkit]).map(action => action.label), ["导读这一节", "考考我 / 下一步", "总结沉淀", "分析跟读"]);
  const prompt = buildScenePrompt({ profileMarkdown: "# Profile", topic, userMessage: "Why?", anchor: { file: "lesson.md", locator: "page:2", quote: "Example" } });
  for (const item of ["# Profile", "Understand", "reflection", "Example", "Why?", "Settlement Gate", "深水区"]) assert.ok(prompt.includes(item));
});

test("Web, Obsidian adapter and DSH tools share a temporary workspace", async () => {
  const root = await mkdtemp(join(tmpdir(), "pith-three-shells-"));
  const workspace = join(root, "Pith");
  await cp(join(process.cwd(), "workspace"), workspace, { recursive: true });
  const storage = new NodeWorkspaceStorage(workspace);
  const vaultStorage = new NodeWorkspaceStorage(root);
  const vault: ObsidianVaultAdapter = {
    getFullPath: path => join(root, path),
    exists: path => vaultStorage.exists(path), read: path => vaultStorage.readText(path),
    readBinary: async path => new Uint8Array(await vaultStorage.readBinary(path)).buffer,
    write: (path, data) => vaultStorage.writeText(path, data), writeBinary: (path, data) => vaultStorage.writeBinary(path, new Uint8Array(data)),
    mkdir: path => vaultStorage.mkdir(path), list: async path => {
      const entries = await vaultStorage.list(path);
      return { files: entries.filter(entry => entry.type === "file").map(entry => entry.path), folders: entries.filter(entry => entry.type === "folder").map(entry => entry.path) };
    },
  };
  const controller = new PithObsidianController(createObsidianHostPort(vault, "Pith", undefined, vault));
  await controller.initialize();
  const server = await createPithWebServer({ workspaceDir: workspace });
  try {
    const address = server.address(); assert.ok(address && typeof address !== "string");
    const base = `http://127.0.0.1:${address.port}`;
    const post = async (path: string, value: unknown) => {
      const response = await fetch(base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(value) });
      assert.ok(response.ok, await response.clone().text());
      return response.json() as Promise<any>;
    };
    const topicId = "topic-001-architecture-foundations";
    const before = (await controller.openTopic(topicId))!.notes.length;
    const blocked = await fetch(base + "/api/dojo/diagnose", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ topicId, targetText: "hello", producedText: "hello" }) });
    assert.equal(blocked.status, 403);
    await post(`/api/topics/${topicId}/toolkits`, { toolkits: ["shadowing"] });
    const transformed = await post("/api/dojo/transform", { topicId, targetText: "It's in the book", stage: "scaffold-cloze" });
    assert.equal(transformed.text, "It's ___ ___ book");
    const diagnosis = await post("/api/dojo/diagnose", { topicId, file: "00-course-outline.md", locator: "text:line:1", targetText: "The green book", producedText: "The book", saveNote: true });
    assert.deepEqual(diagnosis.missedTokens, ["green"]);
    assert.equal(diagnosis.note.kind, "practice");
    assert.equal((await controller.openTopic(topicId))!.notes.length, before + 1);
    await controller.captureHighlight(topicId, "Obsidian highlight", { file: "00-course-outline.md", locator: "text:line:1", quote: "Obsidian highlight" });
    const tools = createDshPluginBundle({ storage }).tools;
    const tool = (name: string) => { const found = tools.find(item => item.name === name); assert.ok(found); return found; };
    await tool("pith_capture_note").execute({ topicId, body: "DSH note" });
    const dshTopic = await tool("pith_read_topic").execute({ topicId }) as Topic;
    assert.equal(dshTopic.notes.length, before + 3);
    const response = await fetch(base + "/api/state");
    const state = await response.json() as { compass: { exploring: Topic[]; pendingEffectsCount: number } };
    assert.equal(state.compass.exploring[0]!.notes.length, before + 3);
    assert.equal(state.compass.pendingEffectsCount, 1);
    await tool("pith_write_lesson").execute({ materialId: dshTopic.materialId, fileName: "new-lesson.md", markdown: "# New lesson" });
    assert.ok((await new DefaultWorkspaceStore(storage).getMaterial(dshTopic.materialId!))!.files.some(file => file.name === "new-lesson.md"));
    await tool("pith_update_profile").execute({ markdown: "# Updated profile" });
    assert.equal((await controller.store.readProfile()).markdown, "# Updated profile");
    assert.equal((await controller.openCompass()).exploring[0]?.id, topicId);
    await controller.setPersona("studio");
    assert.equal(controller.getPersona(), "studio");
    const switched = await (await fetch(base + "/api/state")).json() as { settings: { persona: string } };
    assert.equal(switched.settings.persona, "studio");
    await controller.setPlugins({ preset: "essentials", plugins: { "dojo-shadowing": { enabled: false } } });
    assert.equal(controller.runtime.statuses().find(item => item.id === "dojo-shadowing")?.state, "active");
  } finally {
    controller.dispose();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await rm(root, { recursive: true, force: true });
  }
});
