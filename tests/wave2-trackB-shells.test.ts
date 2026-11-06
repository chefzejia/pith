import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DefaultWorkspaceStore, type AgentStdioHandle, type GuideAgentService } from "../src/core/index.ts";
import { PithObsidianController } from "../src/shells/obsidian/index.ts";
import { NodeAgentProcessPort } from "../src/shells/web/nodeProcess.ts";
import { createPithWebServer } from "../src/shells/web/server.ts";
import { NodeWorkspaceStorage } from "../src/shells/web/nodeStorage.ts";

test("shell settings connect ACP chat and effects, persist, and preserve injected providers", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pith-track-b-"));
  const original = { find: NodeAgentProcessPort.prototype.findExecutable, probe: NodeAgentProcessPort.prototype.probeExecutable, spawn: NodeAgentProcessPort.prototype.spawnStdio };
  const sessions: Record<string, unknown>[] = [];
  let closed = 0;
  NodeAgentProcessPort.prototype.findExecutable = async command => command === "dsh" ? "/fake/dsh" : null;
  NodeAgentProcessPort.prototype.probeExecutable = async (_path, args) => args.includes("--help") ? "Agent Client Protocol ACP" : "dsh 1.2.3";
  NodeAgentProcessPort.prototype.spawnStdio = async () => {
    let listener: ((line: string) => void) | undefined;
    const handle: AgentStdioHandle & { cwd: string } = {
      cwd: dir,
      onLine(callback) { listener = callback; return () => { listener = undefined; }; },
      writeLine(line) {
        const request = JSON.parse(line) as { id?: number; method: string; params: Record<string, unknown> };
        if (request.id === undefined) return;
        if (request.method === "session/new") sessions.push(request.params);
        const result = request.method === "session/new" ? { sessionId: "test" } : request.method === "session/prompt" ? { text: "阅读下一节" } : {};
        assert.ok(listener); listener(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }));
      },
      async close() { closed++; },
    };
    return handle;
  };
  const storage = new NodeWorkspaceStorage(dir);
  const store = new DefaultWorkspaceStore(storage);
  await store.createTopic({ id: "track-b", title: "Track B" });
  let server: Awaited<ReturnType<typeof createPithWebServer>> | undefined;
  const close = async () => { if (server) { const current = server; server = undefined; await new Promise<void>((resolve, reject) => current.close(error => error ? reject(error) : resolve())); } };
  try {
    server = await createPithWebServer({ workspaceDir: dir });
    let address = server.address(); assert.ok(address && typeof address !== "string");
    let base = `http://127.0.0.1:${address.port}`;
    const post = async (path: string, data: unknown) => fetch(base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data) });
    const html = await (await fetch(base)).text();
    const script = await (await fetch(base + "/app.js")).text();
    for (const id of ["simple-agent", "simple-scan", "simple-persona"]) assert.ok(script.includes(`id="${id}"`), id);
    assert.doesNotMatch(html, /data-plugin=|id="preset"/);
    const agents = await (await fetch(base + "/api/agents?force=true")).json() as { id: string; available: boolean; version: string }[];
    assert.equal(agents.find(agent => agent.id === "dsh")?.version, "dsh 1.2.3");
    assert.equal(agents.find(agent => agent.id === "claude")?.available, false);
    assert.equal((await post("/api/settings", { agentId: "invalid" })).status, 400);
    const config = { agentId: "dsh", model: "test-model", effort: "high", persona: "studio" };
    assert.equal((await post("/api/settings", config)).status, 200);
    const saved = JSON.parse(await readFile(join(dir, "_cache/web-settings.json"), "utf8"));
    for (const [key, value] of Object.entries(config)) assert.equal(saved[key], value);
    const chat = await (await post("/api/chat", { topicId: "track-b", text: "Question" })).json() as { guideEntry: { text: string } };
    assert.equal(chat.guideEntry.text, "阅读下一节");
    assert.equal(sessions[0]?.model, "test-model"); assert.equal(sessions[0]?.reasoningEffort, "high");
    assert.equal((await post("/api/notes", { topicId: "track-b", kind: "note", body: "Note" })).status, 201);
    let action: string | undefined;
    for (let i = 0; i < 1000 && action !== "阅读下一节"; i++) { await new Promise<void>(resolve => setImmediate(resolve)); action = (await store.getTopic("track-b"))?.nextAction; }
    assert.equal(action, "阅读下一节"); assert.equal(closed, 2);
    await close();
    server = await createPithWebServer({ workspaceDir: dir }); address = server.address(); assert.ok(address && typeof address !== "string"); base = `http://127.0.0.1:${address.port}`;
    const restored = await (await fetch(base + "/api/state")).json() as { settings: typeof config };
    assert.equal(restored.settings.agentId, "dsh");
    const reply = await (await post("/api/chat", { topicId: "track-b", text: "Again" })).json() as { guideEntry: { text: string } };
    assert.equal(reply.guideEntry.text, "阅读下一节");
    assert.equal((await post("/api/settings", { model: "new-model" })).status, 200);
    await post("/api/chat", { topicId: "track-b", text: "New model" });
    assert.equal(sessions[3]?.model, "new-model");
    assert.equal((await post("/api/settings", { agentId: "" })).status, 200);
    const offline = await (await post("/api/chat", { topicId: "track-b", text: "Offline" })).json() as { guideEntry?: unknown };
    assert.equal(offline.guideEntry, undefined);
    assert.equal((await post("/api/settings", { agentId: "dsh" })).status, 200);
    await close();
    server = await createPithWebServer({ workspaceDir: dir, guideProvider: { reply: async () => "mock reply" } }); address = server.address(); assert.ok(address && typeof address !== "string"); base = `http://127.0.0.1:${address.port}`;
    const mocked = await (await post("/api/chat", { topicId: "track-b", text: "Mock" })).json() as { guideEntry: { text: string } };
    assert.equal(mocked.guideEntry.text, "mock reply"); assert.equal(sessions.length, 4);
    assert.equal((await post("/api/settings", { agentId: "" })).status, 200);
  } finally {
    await close();
    NodeAgentProcessPort.prototype.findExecutable = original.find; NodeAgentProcessPort.prototype.probeExecutable = original.probe; NodeAgentProcessPort.prototype.spawnStdio = original.spawn;
    await rm(dir, { recursive: true, force: true });
  }
});

test("Obsidian detects and persists agent configuration and reloads the guide", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pith-obsidian-agent-"));
  const storage = new NodeWorkspaceStorage(dir);
  const process = new NodeAgentProcessPort({ searchPaths: [] });
  process.findExecutable = async command => command === "dsh" ? "/fake/dsh" : null;
  process.probeExecutable = async (_path, args) => args.includes("--help") ? "ACP" : "dsh 1.0";
  const controller = new PithObsidianController({ id: "obsidian", storage, process });
  try {
    await controller.initialize();
    assert.equal((await controller.detectAgents(true)).find(agent => agent.id === "dsh")?.available, true);
    await controller.setAgentConfig({ agentId: "dsh", model: "m", effort: "high", persona: "studio" });
    const guide = controller.runtime.getService<GuideAgentService>("guide.agent"); assert.ok(guide);
    assert.deepEqual(guide.persona, (await import("../src/core/index.ts")).DEFAULT_PERSONAS.studio);
    const saved = JSON.parse(await storage.readText("_cache/web-settings.json"));
    assert.deepEqual([saved.agentId, saved.model, saved.effort, saved.persona], ["dsh", "m", "high", "studio"]);
    await controller.setPersona("sanctuary");
    const updated = JSON.parse(await storage.readText("_cache/web-settings.json"));
    assert.equal(updated.agentId, "dsh"); assert.equal(updated.persona, "sanctuary");
  } finally { controller.dispose(); await rm(dir, { recursive: true, force: true }); }
});
