import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { DefaultAttentionEngine, DefaultWorkspaceStore, type TurnStep } from "../src/core/index.ts";
import { openTurnTools } from "../src/plugins/guide-acp/mcpTools.ts";
import { createScopedTools } from "../src/plugins/guide-acp/tools.ts";
import { renderFile } from "../src/plugins/stage-reader/index.ts";
import { createDshPluginBundle } from "../src/shells/dsh/index.ts";
import { NodeWorkspaceStorage } from "../src/shells/web/nodeStorage.ts";
import { NodeToolServerPort } from "../src/shells/web/nodeToolServer.ts";
import { undoTopicObservation } from "../src/workbench/observations.ts";
import { testSandbox } from "./sandbox.ts";

async function setup() {
  const root = await testSandbox("audit-four-");
  const storage = new NodeWorkspaceStorage(root), store = new DefaultWorkspaceStore(storage);
  await store.ensureScaffold();
  const topic = await store.createTopic({ id: "topic-audit", title: "Audit" });
  const note = await store.appendNote(topic.id, { kind: "note", body: "Evidence" });
  return { root, storage, store, topic, note };
}

test("settlement failure reports persisted effects, permits undo and identifies backups across write stages", async () => {
  for (const [operation, occurrence, after] of [
    ["copy", 1, false], ["copy", 1, true], ["profile", 1, false], ["profile", 1, true],
    ["copy", 2, false], ["copy", 2, true], ["profile", 2, false], ["profile", 2, true],
    ["copy", 3, false], ["copy", 3, true], ["profile", 3, false], ["profile", 3, true],
    ["topic", 1, false], ["topic", 1, true], ["topic", 2, false], ["topic", 2, true],
  ] as const) {
    const f = await setup();
    try {
      const old = await f.store.addObservation({ topicId: f.topic.id, text: "existing", noteId: f.note.id });
      const oldProfile = await readFile(join(f.root, "ME.md"));
      const copy = f.storage.copy.bind(f.storage), write = f.storage.writeText.bind(f.storage);
      let count = 0;
      const inject = async (matches: boolean, task: () => Promise<void>) => {
        if (matches && ++count === occurrence) { if (after) await task(); throw new Error("injected failure"); }
        await task();
      };
      f.storage.copy = (from, to) => inject(operation === "copy", () => copy(from, to));
      f.storage.writeText = (path, data) => inject(operation === "profile" ? path === "ME.md" : operation === "topic" && path === `topics/${f.topic.id}/topic.md`, () => write(path, data));
      const tools = createScopedTools({ topicId: f.topic.id, store: f.store, storage: f.storage, onChoices() {} });
      const engine = new DefaultAttentionEngine(f.store, f.storage, () => ({ async run(_input, options) {
        let index = 0;
        const server = await openTurnTools(new NodeToolServerPort(), tools, options.signal, options.onStep, () => index++);
        try {
          const response = await fetch(server.endpoint.url, { method: "POST", headers: Object.fromEntries(server.endpoint.headers.map(h => [h.name, h.value])), body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "pith_settle_topic", arguments: { verificationSummary: "Understood", removeObservationIds: [old.id], observations: [{ text: "first" }, { text: "second" }] } } }) });
          assert.equal((await response.json()).result.isError, true);
          return { status: "completed" as const };
        } finally { await server.drain(); await server.endpoint.close(); }
      } }));
      const turn = await engine.runTurn({ topicId: f.topic.id, text: "settle" });
      const step = turn.steps.find(item => item.kind === "tool"); assert.ok(step && step.kind === "tool");
      assert.equal(step.status, "failed", `${operation} ${occurrence} ${after}`);
      assert.match(step.summary!, /injected failure/);
      const actual = await f.store.readProfile(), added = actual.observations.filter(item => item.id !== old.id);
      assert.deepEqual(step.effects.filter(item => item.kind === "observation").map(item => item.observationId).sort(), added.map(item => item.id).sort());
      if (added.length) { assert.match(step.summary!, /history\/ME-/); for (const item of added) assert.ok(step.summary!.includes(item.id)); }
      assert.match(step.summary!, new RegExp(`课题状态：${(await f.store.getTopic(f.topic.id))!.status}`));
      if (!actual.observations.some(item => item.id === old.id)) {
        assert.match(step.summary!, new RegExp(old.id));
        assert.match(step.summary!, /history\/ME-/);
        const backups = await Promise.all((await readdir(join(f.root, "history"))).map(name => readFile(join(f.root, "history", name))));
        assert.ok(backups.some(bytes => bytes.equals(oldProfile)));
      }
      f.storage.copy = copy; f.storage.writeText = write;
      for (const observation of added) await undoTopicObservation(f.store, engine, f.topic.id, observation.id);
      assert.ok((await f.store.readProfile()).observations.every(item => !added.some(a => a.id === item.id)));
    } finally { await rm(f.root, { recursive: true, force: true }); }
  }
});

test("stalled external import stops, drains and can be retried without partial import", async () => {
  const f = await setup();
  let entered!: () => void, received: AbortSignal | undefined, attempts = 0;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const http = { async request() { throw new Error("unexpected"); }, async requestPublic(spec: { signal?: AbortSignal }) {
    attempts++; received = spec.signal;
    if (attempts === 1) { entered(); return new Promise<never>(() => {}); }
    const bytes = new TextEncoder().encode("document");
    return { status: 200, headers: { "content-type": "text/plain" }, bytes, text: () => "document" };
  } };
  const controller = new AbortController();
  const engine = new DefaultAttentionEngine(f.store, f.storage, () => ({ async run(_input, options) {
    const steps: TurnStep[] = [];
    const server = await openTurnTools(new NodeToolServerPort(), createScopedTools({ topicId: f.topic.id, store: f.store, storage: f.storage, http, onChoices() {} }), options.signal, (step, index) => { steps[index] = step; options.onStep(step, index); }, () => steps.length);
    try {
      const response = await fetch(server.endpoint.url, { method: "POST", headers: Object.fromEntries(server.endpoint.headers.map(h => [h.name, h.value])), body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "pith_ingest_external", arguments: { url: "https://example.com/entry" } } }) });
      const result = await response.json();
      return options.signal.aborted ? { status: "stopped" as const } : result.result.isError ? { status: "failed" as const, error: result.result.content[0].text as string } : { status: "completed" as const };
    } finally { await server.drain(); await server.endpoint.close(); }
  } }));
  try {
    const pending = engine.runTurn({ topicId: f.topic.id, text: "import" }, { signal: controller.signal }); await started; controller.abort();
    const stopped = await Promise.race([pending, new Promise<never>((_, reject) => setTimeout(() => reject(new Error("stop did not finish")), 1500))]);
    assert.equal(stopped.status, "stopped"); assert.ok(received); assert.equal(received.aborted, true);
    assert.equal((await f.store.listMaterials()).length, 0);
    const retried = await engine.retryTurn(f.topic.id, stopped.id);
    assert.equal(retried.status, "completed"); assert.equal(retried.id, stopped.id);
    assert.equal((await f.store.listMaterials()).length, 1);
    assert.equal((await engine.getConversation(f.topic.id)).length, 1);
  } finally { controller.abort(); await rm(f.root, { recursive: true, force: true }); }
});

test("DSH reads markdown and pinned repository through its published tools", async () => {
  const f = await setup();
  try {
    const file = await f.store.importMaterial({ title: "Document", kind: "article", files: [{ name: "document.md", bytes: new TextEncoder().encode("# Heading\n\nActual content") }] });
    await f.store.updateTopic(f.topic.id, { materialId: file.id });
    const tools = createDshPluginBundle({ storage: f.storage }).tools;
    const read = tools.find(tool => tool.name === "pith_read_material")!, list = tools.find(tool => tool.name === "pith_list_material")!;
    assert.match(JSON.stringify(await read.execute({ topicId: f.topic.id, materialId: file.id, file: "document.md" })), /Actual content/);
    const repo = join(f.root, "repository"); await mkdir(repo); await writeFile(join(repo, "file.txt"), "committed\n");
    const longText = "A".repeat(11999) + "😀HIDDENSUFFIX\nsecond line\nthird line";
    await writeFile(join(repo, "long.txt"), longText);
    const limitText = "Z".repeat(256 * 1024); await writeFile(join(repo, "at-limit.txt"), limitText);
    const gitEnv = { ...process.env }; for (const key of Object.keys(gitEnv)) if (key.startsWith("GIT_")) delete gitEnv[key];
    Object.assign(gitEnv, { GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_AUTHOR_NAME: "Test", GIT_AUTHOR_EMAIL: "test@example.invalid", GIT_COMMITTER_NAME: "Test", GIT_COMMITTER_EMAIL: "test@example.invalid" });
    const git = (...args: string[]) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", env: gitEnv }).trim();
    git("init", "-q"); git("add", "file.txt", "long.txt", "at-limit.txt"); git("commit", "-qm", "fixture"); const commitSha = git("rev-parse", "HEAD");
    await writeFile(join(repo, "file.txt"), "uncommitted\n");
    const material = await f.store.importMaterial({ title: "Repository", kind: "repo", files: [], externalPath: repo, commitSha });
    await f.store.updateTopic(f.topic.id, { materialId: material.id });
    assert.match(JSON.stringify(await list.execute({ topicId: f.topic.id, materialId: material.id })), /file\.txt/);
    const result = JSON.stringify(await read.execute({ topicId: f.topic.id, materialId: material.id, file: "file.txt" }));
    assert.match(result, /committed/); assert.doesNotMatch(result, /uncommitted/);
    for (const maxLines of [1, 2]) {
      let cursor: { startLine: number; startOffset: number } | null = { startLine: 1, startOffset: 0 }, combined = "", pages = 0;
      while (cursor) {
        assert.ok(pages++ < 8, "repository continuation must make progress");
        const page = await read.execute({ topicId: f.topic.id, materialId: material.id, file: "long.txt", maxLines, ...cursor }) as { text: string; truncated: boolean; next: { startLine: number; startOffset: number } | null };
        assert.ok(page.text.length <= 12000); assert.equal(page.truncated, page.next !== null);
        if (pages === 1) { assert.equal(page.text.length, 11999); assert.doesNotMatch(JSON.stringify(page), /HIDDENSUFFIX/); }
        combined += page.text; cursor = page.next;
      }
      assert.equal(combined, longText);
    }
    let limitCursor: { startLine: number; startOffset: number } | null = { startLine: 1, startOffset: 0 }, limitResult = "", limitPages = 0;
    while (limitCursor) {
      assert.ok(limitPages++ < 30, "maximum-size file continuation must make progress");
      const page = await read.execute({ topicId: f.topic.id, materialId: material.id, file: "at-limit.txt", ...limitCursor }) as { text: string; next: { startLine: number; startOffset: number } | null };
      assert.ok(page.text.length <= 12000); limitResult += page.text; limitCursor = page.next;
    }
    assert.equal(limitResult, limitText);
    await assert.rejects(read.execute({ topicId: f.topic.id, materialId: material.id, file: "long.txt", startOffset: 12000 }), /Invalid material cursor/);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("rendered material pages bound every field and resume within long blocks", async () => {
  const f = await setup();
  try {
    const content = "A".repeat(11999) + "😀HIDDENSUFFIX";
    const material = await f.store.importMaterial({ title: "Long", kind: "article", files: [{ name: "long.md", bytes: new TextEncoder().encode(content) }] });
    await f.store.updateTopic(f.topic.id, { materialId: material.id });
    const read = createScopedTools({ topicId: f.topic.id, store: f.store, storage: f.storage, reader: { formats: ["markdown"], sections: () => [], render: () => "", renderFile }, onChoices() {} }).find(tool => tool.name === "pith_read_material")!;
    const first = await read.execute({ materialId: material.id, file: "long.md" }) as { blocks: { text: string; [key: string]: unknown }[]; truncated: boolean; next: { startLine: number; startOffset: number } };
    assert.equal(first.truncated, true); assert.equal(first.blocks[0]!.text.length, 11999); assert.doesNotMatch(JSON.stringify(first), /HIDDENSUFFIX/);
    assert.deepEqual(Object.keys(first.blocks[0]!).sort(), ["index", "isProse", "locator", "text"]);
    const second = await read.execute({ materialId: material.id, file: "long.md", ...first.next }) as { blocks: { text: string }[]; truncated: boolean; next: null };
    assert.equal(second.blocks.length, 1, "continuation must return the rest of the same block");
    const combined = first.blocks.map(block => block.text).join("") + second.blocks.map(block => block.text).join("");
    assert.equal(second.blocks[0]!.text.startsWith("😀"), true);
    assert.equal(combined.length, content.length); assert.equal(combined, content); assert.equal(second.truncated, false); assert.equal(second.next, null);
    await assert.rejects(read.execute({ materialId: material.id, file: "long.md", startOffset: content.length + 1 }), /Invalid material cursor/);
    await assert.rejects(read.execute({ materialId: material.id, file: "long.md", startOffset: 12000 }), /Invalid material cursor/);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});
