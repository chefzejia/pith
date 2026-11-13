import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { request, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { DefaultWorkspaceStore, type AgentProcessPort, type AgentStdioHandle, type DiscoveredAgentDescriptor } from "../src/core/index.ts";
import { AGENT_HANDSHAKE_TIMEOUT_MS, AGENT_REQUEST_TIMEOUT_MS, runOneShotAcpPrompt } from "../src/plugins/guide-acp/index.ts";
import { agentInterlineTranslator } from "../src/plugins/toolkit-interline/index.ts";
import { PithObsidianController, createObsidianHostPort, type ObsidianVaultAdapter } from "../src/shells/obsidian/index.ts";
import { NodeWorkspaceStorage } from "../src/shells/web/nodeStorage.ts";
import { createPithWebServer } from "../src/shells/web/server.ts";

const descriptor: DiscoveredAgentDescriptor = { id: "dsh", label: "fixture", command: "/fixture/dsh", args: [], available: true, version: null, note: "fixture" };
const LONGEST_DEADLINE_MS = 600_000;
const settingsCases: readonly (readonly [Record<string, unknown>, number])[] = [
  [{ agentTimeoutMs: 7000 }, 7000], [{}, AGENT_REQUEST_TIMEOUT_MS], [{ agentTimeoutMs: 12 }, AGENT_REQUEST_TIMEOUT_MS],
  [{ agentTimeoutMs: 600001 }, AGENT_REQUEST_TIMEOUT_MS], [{ agentTimeoutMs: "7000" }, AGENT_REQUEST_TIMEOUT_MS],
];
const savedSettings = (extra: Record<string, unknown>): string => JSON.stringify({ preset: "all", persona: "sanctuary", plugins: {}, agentId: "dsh", ...extra });
const units = [{ html: '<p data-locator="p:0" data-prose="true">Hello</p>', segments: [{ locator: "p:0", blockIndex: 0, sourceText: "Hello", sourceHash: "" }] }];

/** ACP agent at the process boundary that answers every request except `silent`, which it leaves pending. */
function silentAgent(silent: string): { port: AgentProcessPort; reached(): Promise<void> } {
  let arrived = 0;
  const waiters: Array<() => void> = [];
  const port: AgentProcessPort = {
    findExecutable: async command => command === "dsh" ? "/fixture/dsh" : null,
    probeExecutable: async (_path, args) => args.includes("--help") ? "Agent Client Protocol (ACP)" : "dsh 1.0.0",
    async spawnStdio(): Promise<AgentStdioHandle> {
      const listeners = new Set<(line: string) => void>();
      const handle: AgentStdioHandle & { cwd: string } = {
        cwd: "/sandbox",
        onLine(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
        writeLine(line) {
          const message = JSON.parse(line) as { id?: number; method: string };
          if (message.id === undefined) return;
          if (message.method === silent) { const waiter = waiters.shift(); if (waiter) waiter(); else arrived++; return; }
          const result = message.method === "session/new" ? { sessionId: "fixture" } : message.method === "initialize" ? { agentCapabilities: { mcpCapabilities: { http: true } } } : {};
          for (const listener of listeners) listener(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }));
        },
        async close() {},
      };
      return handle;
    },
  };
  return { port, reached: () => { if (arrived > 0) { arrived--; return Promise.resolve(); } return new Promise<void>(resolve => waiters.push(resolve)); } };
}

/** Whether `promise` has settled once every already-queued microtask has run. */
async function settled(promise: Promise<unknown>): Promise<boolean> {
  let done = false;
  promise.then(() => { done = true; }, () => { done = true; });
  await new Promise<void>(resolve => setImmediate(resolve));
  return done;
}

/** Starts `start` under mocked timers, waits until the agent holds the silent request, then advances past every allowed deadline. */
async function afterEveryDeadline<T>(t: TestContext, agent: { reached(): Promise<void> }, start: () => Promise<T>): Promise<T | Error> {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const outcome = start().then(value => value, (error: unknown) => error instanceof Error ? error : new Error(String(error)));
    await agent.reached();
    t.mock.timers.tick(LONGEST_DEADLINE_MS);
    return await outcome;
  } finally { t.mock.timers.reset(); }
}

test("an agent prompt waits for its deadline while each handshake request fails early", async t => {
  assert.equal(AGENT_REQUEST_TIMEOUT_MS, 300_000);
  assert.equal(AGENT_HANDSHAKE_TIMEOUT_MS, 60_000);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const expires = async (silent: string, timeoutMs: number | undefined, deadlineMs: number): Promise<void> => {
    const agent = silentAgent(silent);
    const result = runOneShotAcpPrompt("hello", { descriptor, processPort: agent.port, ...(timeoutMs === undefined ? {} : { timeoutMs }) });
    await agent.reached();
    t.mock.timers.tick(deadlineMs - 1);
    assert.equal(await settled(result), false, `${silent} is pending one millisecond before ${deadlineMs}ms`);
    t.mock.timers.tick(1);
    assert.equal(await settled(result), true, `${silent} settles at ${deadlineMs}ms`);
    await assert.rejects(result, new RegExp(`${silent} timed out after ${deadlineMs}ms`));
  };
  await expires("session/prompt", undefined, AGENT_REQUEST_TIMEOUT_MS);
  await expires("session/prompt", 7_000, 7_000);
  await expires("initialize", AGENT_REQUEST_TIMEOUT_MS, AGENT_HANDSHAKE_TIMEOUT_MS);
  await expires("session/new", AGENT_REQUEST_TIMEOUT_MS, AGENT_HANDSHAKE_TIMEOUT_MS);
  await expires("initialize", 7_000, AGENT_HANDSHAKE_TIMEOUT_MS);
});

test("interline translation requests use the deadline supplied with the agent", async t => {
  for (const [timeoutMs, expected] of [[undefined, AGENT_REQUEST_TIMEOUT_MS], [7_000, 7_000]] as const) {
    const agent = silentAgent("session/prompt");
    const translate = agentInterlineTranslator({ prompt: async (text, options) => (await runOneShotAcpPrompt(text, { descriptor, processPort: agent.port, ...(timeoutMs === undefined ? {} : { timeoutMs }) }, options?.signal)).text });
    const outcome = await afterEveryDeadline(t, agent, () => translate({ materialId: "m", file: "a.md", unitIndex: 0, targetLanguage: "zh-Hans", segments: [{ locator: "p:0", blockIndex: 0, sourceText: "Hello", sourceHash: "" }] }));
    assert.ok(outcome instanceof Error);
    assert.match(outcome.message, new RegExp(`session/prompt timed out after ${expected}ms`));
  }
});

test("Obsidian translation uses persisted timeout and preserves it across settings changes", async t => {
  for (const [settings, expected] of settingsCases) {
    const dir = await mkdtemp(join(tmpdir(), "pith-agent-timeout-obsidian-")), storage = new NodeWorkspaceStorage(dir), agent = silentAgent("session/prompt");
    const adapter: ObsidianVaultAdapter = {
      getFullPath: path => join(dir, path), exists: path => storage.exists(path), read: path => storage.readText(path),
      readBinary: async path => new Uint8Array(await storage.readBinary(path)).buffer, write: (path, data) => storage.writeText(path, data),
      writeBinary: (path, data) => storage.writeBinary(path, new Uint8Array(data)), mkdir: path => storage.mkdir(path),
      list: async path => { const entries = await storage.list(path); return { files: entries.filter(entry => entry.type === "file").map(entry => entry.path), folders: entries.filter(entry => entry.type === "folder").map(entry => entry.path) }; },
    };
    const path = join(dir, "Pith/_cache/web-settings.json"); await mkdir(join(dir, "Pith/_cache"), { recursive: true }); await writeFile(path, savedSettings(settings));
    const controller = new PithObsidianController(createObsidianHostPort(adapter, "Pith", agent.port, adapter));
    try {
      await controller.initialize(); await controller.setPersona("studio");
      const saved = JSON.parse(await readFile(path, "utf8")); assert.equal(saved.persona, "studio");
      const result = await afterEveryDeadline(t, agent, () => controller.createInterlineSession("material", "a.md", units).render(0, "bilingual"));
      assert.ok(!(result instanceof Error)); assert.equal(result.status, "failed"); assert.match(result.error ?? "", new RegExp(`session/prompt timed out after ${expected}ms`));
    } finally { controller.dispose(); await rm(dir, { recursive: true, force: true }); }
  }
});

function post(port: number, path: string, value: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const outgoing = request({ host: "127.0.0.1", port, path, method: "POST", agent: false, headers: { "content-type": "application/json" } }, response => {
      let body = ""; response.setEncoding("utf8"); response.on("data", chunk => { body += chunk; }); response.on("error", reject);
      response.on("end", () => { try { resolve({ status: response.statusCode ?? 0, body: JSON.parse(body) }); } catch (error) { reject(error); } });
    });
    outgoing.on("error", reject); outgoing.end(JSON.stringify(value));
  });
}

test("Web translation uses persisted timeout and preserves it across settings changes", async t => {
  for (const [settings, expected] of settingsCases) {
    const dir = await mkdtemp(join(tmpdir(), "pith-agent-timeout-web-")), storage = new NodeWorkspaceStorage(dir), store = new DefaultWorkspaceStore(storage), agent = silentAgent("session/prompt");
    await store.ensureScaffold();
    const material = await store.importMaterial({ title: "Article", kind: "article", aids: ["interline"], files: [{ name: "a.md", mimeType: "text/markdown", bytes: new TextEncoder().encode("Hello") }] });
    const topic = await store.createTopic({ title: "Timeout", target: "Understand timeout", materialIds: [material.id], toolkits: [] });
    const path = join(dir, "_cache/web-settings.json"); await writeFile(path, savedSettings(settings));
    const server: Server = await createPithWebServer({ workspaceDir: dir, processPort: agent.port }), address = server.address(); assert.ok(address && typeof address !== "string");
    try {
      assert.equal((await post(address.port, "/api/settings", { persona: "studio" })).status, 200);
      const saved = JSON.parse(await readFile(path, "utf8")); assert.equal(saved.persona, "studio");
      const result = await afterEveryDeadline(t, agent, () => post(address.port, "/api/interline", { topicId: topic.id, materialId: material.id, file: "a.md", mode: "bilingual", index: 0, units }));
      assert.ok(!(result instanceof Error)); assert.equal(result.status, 200); assert.equal(result.body.status, "failed"); assert.match(String(result.body.error), new RegExp(`session/prompt timed out after ${expected}ms`));
    } finally { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); await rm(dir, { recursive: true, force: true }); }
  }
});


test("a foreground prompt has no deadline and cancellation waits at most five seconds", async t => {
  const agent = silentAgent("session/prompt");
  const controller = new AbortController();
  const foreground = { ...descriptor, pithToolTitlePrefix: "mcp__pith__" };
  t.mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const result = runOneShotAcpPrompt("hello", { descriptor: foreground, processPort: agent.port, timeoutMs: 7000,
      mcp: { url: "http://127.0.0.1:1/", headers: [], toolNames: [], onUpdate: () => {} } }, controller.signal);
    await agent.reached();
    t.mock.timers.tick(600001); assert.equal(await settled(result), false);
    controller.abort(); t.mock.timers.tick(4999); assert.equal(await settled(result), false);
    t.mock.timers.tick(1); await assert.rejects(result, /cancelled/);
  } finally { t.mock.timers.reset(); }
});
