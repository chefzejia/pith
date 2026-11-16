import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import test from "node:test";
import { DefaultAttentionEngine, DefaultWorkspaceStore, type GuideProvider } from "../src/core/index.ts";
import { PithObsidianController } from "../src/shells/obsidian/index.ts";
import { createPithWebServer } from "../src/shells/web/server.ts";
import { NodeWorkspaceStorage } from "../src/shells/web/nodeStorage.ts";
import { NodeAgentProcessPort } from "../src/shells/web/nodeProcess.ts";
import { testSandbox } from "./sandbox.ts";

async function history(storage: NodeWorkspaceStorage) {
  const store = new DefaultWorkspaceStore(storage);
  const topic = await store.createTopic({ title: "离线门禁", target: "解释准入边界", materialIds: [], toolkits: [] });
  const engine = new DefaultAttentionEngine(store, storage);
  const failed = await engine.runTurn({ topicId: topic.id, text: "保留失败历史" });
  const abort = new AbortController(); abort.abort();
  const stopped = await engine.runTurn({ topicId: topic.id, text: "保留停止历史" }, { signal: abort.signal });
  assert.equal(failed.status, "failed"); assert.equal(stopped.status, "stopped");
  const path = `topics/${topic.id}/conversation.json`;
  return { store, topic, failed, stopped, path, before: await storage.readText(path) };
}

test("Web refuses offline new and retry turns before writing conversation, while notes and status remain usable", async () => {
  const root = await testSandbox("task54-offline-web-");
  const storage = new NodeWorkspaceStorage(root), seeded = await history(storage);
  const server = await createPithWebServer({ workspaceDir: root });
  try {
    const address = server.address(); assert.ok(address && typeof address !== "string");
    const base = `http://127.0.0.1:${address.port}`;
    const post = (path: string, data: unknown, accept = "application/json") => fetch(base + path, { method: "POST", headers: { "content-type": "application/json", accept }, body: JSON.stringify(data) });
    const profile = await storage.readText("ME.md");
    for (const accept of ["application/json", "text/event-stream"]) {
      for (const input of [{ text: "不得离线结题" }, { turnId: seeded.failed.id }, { turnId: seeded.stopped.id }]) {
        const response = await post("/api/chat", { topicId: seeded.topic.id, ...input }, accept);
        assert.equal(response.status, 503, "offline chat must fail before stream headers or engine admission");
        assert.match((await response.json() as { error: string }).error, /向导未连接/);
        assert.equal(await storage.readText(seeded.path), seeded.before, "offline admission must not append or replace a durable turn");
      }
    }
    assert.deepEqual(await (await fetch(`${base}/api/topics/${seeded.topic.id}/actions`)).json(), []);
    const note = await post("/api/notes", { topicId: seeded.topic.id, kind: "note", body: "离线笔记" });
    assert.equal(note.status, 201);
    for (const status of ["shelved", "exploring"]) {
      const response = await post(`/api/topics/${seeded.topic.id}/status`, { status });
      assert.equal(response.status, 200); assert.equal((await response.json() as { status: string }).status, status);
    }
    assert.equal((await seeded.store.getTopic(seeded.topic.id))?.notes.at(-1)?.body, "离线笔记");
    assert.equal(await storage.readText("ME.md"), profile);
    assert.equal(await storage.readText(seeded.path), seeded.before);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await rm(root, { recursive: true, force: true });
  }
});

test("Obsidian refuses offline new and retry turns without publishing or replacing history", async () => {
  const root = await testSandbox("task54-offline-native-");
  const storage = new NodeWorkspaceStorage(root), seeded = await history(storage);
  const controller = new PithObsidianController({ id: "obsidian", storage });
  try {
    await controller.initialize();
    let updates = 0;
    for (const input of [{ text: "不得离线结题" }, { turnId: seeded.failed.id }, { turnId: seeded.stopped.id }]) {
      await assert.rejects(controller.runGuide(seeded.topic.id, input, () => { updates++; }), /向导未连接/);
      assert.equal(await storage.readText(seeded.path), seeded.before);
    }
    assert.equal(updates, 0);
    await controller.setAgentConfig({ ...controller.getAgentConfig(), agentId: "dsh" });
    assert.equal(controller.hasGuideProvider(), false, "selection alone cannot create a provider in a host without process capability");
    await assert.rejects(controller.runGuide(seeded.topic.id, { text: "仍无 provider" }), /向导未连接/);
    await controller.engine.capture({ owner: { topicId: seeded.topic.id }, kind: "note", body: "仍可记录" });
    assert.equal((await controller.store.getTopic(seeded.topic.id))?.notes.at(-1)?.body, "仍可记录");
    assert.equal(await storage.readText(seeded.path), seeded.before);
  } finally { controller.dispose(); await rm(root, { recursive: true, force: true }); }
});

test("native agent settings publish current availability without launching an agent and release observers", async () => {
  const root = await testSandbox("task54-settings-native-");
  const processPort = new NodeAgentProcessPort({ searchPaths: [] });
  processPort.spawnStdio = async () => { throw new Error("settings must not launch an agent"); };
  const controller = new PithObsidianController({ id: "obsidian", storage: new NodeWorkspaceStorage(root), process: processPort });
  try {
    await controller.initialize();
    const values: boolean[] = [];
    const unsubscribe = controller.onGuideAvailabilityChange(available => values.push(available));
    const choose = (agentId: "" | "dsh") => controller.setAgentConfig({ ...controller.getAgentConfig(), agentId });
    await choose("dsh"); await choose("");
    await controller.setPlugins({ preset: "all" });
    await choose("dsh");
    assert.deepEqual(values, [true, false, true]);
    unsubscribe(); await choose("");
    assert.deepEqual(values, [true, false, true]);
    assert.equal(controller.hasGuideProvider(), false);
  } finally { controller.dispose(); await rm(root, { recursive: true, force: true }); }
});

test("injected providers remain online with an empty agent selection in both shells, including retry and stop", async () => {
  const root = await testSandbox("task54-injected-");
  const storage = new NodeWorkspaceStorage(root), seeded = await history(storage);
  let calls = 0, started!: () => void;
  const running = new Promise<void>(resolve => { started = resolve; });
  const provider: GuideProvider = { async run(input, options) {
    calls++;
    if (input.text === "等待停止") {
      started();
      await new Promise<void>(resolve => { if (options.signal.aborted) resolve(); else options.signal.addEventListener("abort", () => resolve(), { once: true }); });
      return { status: "stopped" };
    }
    options.onStep({ kind: "reply", markdown: "已有注入能力" }, 0);
    return { status: "completed" };
  } };
  const server = await createPithWebServer({ workspaceDir: root, guideProvider: provider });
  const controller = new PithObsidianController({ id: "obsidian", storage }, undefined, provider);
  try {
    await controller.initialize();
    const address = server.address(); assert.ok(address && typeof address !== "string");
    const base = `http://127.0.0.1:${address.port}`;
    const post = (path: string, data: unknown) => fetch(base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data) });
    assert.equal((await post("/api/settings", { agentId: "" })).status, 200);
    const response = await post("/api/chat", { topicId: seeded.topic.id, text: "明确发送" });
    assert.equal(response.status, 201); assert.equal((await response.json() as { status: string }).status, "completed");
    const retry = await post("/api/chat", { topicId: seeded.topic.id, turnId: seeded.failed.id });
    assert.equal((await retry.json() as { status: string }).status, "completed");
    await controller.setAgentConfig({ ...controller.getAgentConfig(), agentId: "" });
    assert.equal(controller.hasGuideProvider(), true, "an injected provider is an online capability even with no local selection");
    assert.equal((await controller.runGuide(seeded.topic.id, { turnId: seeded.stopped.id })).status, "completed");
    const turn = controller.runGuide(seeded.topic.id, { text: "等待停止" });
    await running; controller.stopGuide(seeded.topic.id);
    assert.equal((await turn).status, "stopped"); assert.equal(calls, 4);
  } finally {
    controller.dispose();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await rm(root, { recursive: true, force: true });
  }
});
