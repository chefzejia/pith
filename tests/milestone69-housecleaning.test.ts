import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import {
  DefaultWorkspaceStore,
  type AgentProcessPort,
  type AgentStdioHandle,
  type EffectRecord,
  type Topic,
} from "../src/core/index.ts";
import { quickActionsForTopic } from "../src/plugins/guide-acp/index.ts";
import { feynmanToolkit } from "../src/plugins/toolkit-feynman/index.ts";
import { PithObsidianController, PithSettingTab } from "../src/shells/obsidian/index.ts";
import { createPithWebServer } from "../src/shells/web/server.ts";
import { NodeWorkspaceStorage } from "../src/shells/web/nodeStorage.ts";
import { testSandbox } from "./sandbox.ts";

class StubSettingElement {
  children: StubSettingElement[] = [];
  parentElement: StubSettingElement | null = null;
  textContent = "";
  value = "";
  disabled = false;
  hidden = false;
  innerHTML = "";
  type = "";
  autocomplete = "";
  className = "";
  id = "";
  title = "";
  onclick: (() => void) | null = null;
  onchange: (() => void) | null = null;
  ownerDocument = { createElement: () => new StubSettingElement() };
  append(...children: StubSettingElement[]) {
    for (const child of children) child.parentElement = this;
    this.children.push(...children);
  }
  replaceChildren() { this.children = []; }
  contains(node: StubSettingElement): boolean { return this === node || this.children.some(child => child.contains(node)); }
  querySelector(selector: string): StubSettingElement | null {
    if (selector === 'option[value="unconfigured"]') return this.children.find(child => child.value === "unconfigured") ?? null;
    return null;
  }
  setAttribute() {}
  addEventListener(type: string, listener: () => void) {
    if (type === "change") this.onchange = listener;
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(ok => { resolve = ok; });
  return { promise, resolve };
}

async function within<T>(promise: Promise<T>, message: string, ms = 2000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`Timed out: ${message}`)), ms); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

interface ControlledAcpHandle {
  readonly spawnIndex: number;
  readonly promptEntered: Promise<string>;
  readonly closeEntered: Promise<void>;
  readonly closed: () => boolean;
  readonly closeCount: () => number;
  readonly sawCancel: () => boolean;
  readonly readAborted: () => boolean;
  releasePrompt: (replyText?: string) => void;
  releaseClose: () => void;
}

function createControlledAcpPort(options: {
  installed?: boolean;
  reply?: (prompt: string, spawnIndex: number) => string;
} = {}): {
  port: AgentProcessPort;
  spawns: () => number;
  prompts: string[];
  handles: ControlledAcpHandle[];
  setMode: (mode: { holdPrompt?: boolean; holdClose?: boolean }) => void;
  waitForNextHandle: () => Promise<ControlledAcpHandle>;
} {
  const installed = options.installed ?? true;
  const replyFor = options.reply ?? ((_prompt, spawnIndex) => `Action #${spawnIndex}`);
  let spawnCount = 0;
  let holdPrompt = false;
  let holdClose = false;
  const prompts: string[] = [];
  const handles: ControlledAcpHandle[] = [];
  const handleWaiters: Array<(handle: ControlledAcpHandle) => void> = [];

  const port: AgentProcessPort = {
    findExecutable: async command => (installed && command === "dsh" ? "/sandbox/dsh" : null),
    probeExecutable: async (_path, args) => (installed ? (args.includes("--help") ? "Agent Client Protocol (ACP)" : "dsh 1.0.0") : null),
    async spawnStdio(): Promise<AgentStdioHandle> {
      const spawnIndex = ++spawnCount;
      const listeners = new Set<(line: string) => void>();
      const promptGate = deferred<string>();
      const closeEnteredGate = deferred<void>();
      const closeFinishGate = deferred<void>();
      const holdThisClose = holdClose;
      const holdThisPrompt = holdPrompt;
      let isClosed = false;
      let closeCalls = 0;
      let cancelSeen = false;
      let pendingReadAborted = false;
      let pendingPrompt: { id: number | string; text: string } | null = null;

      const emit = (payload: unknown) => {
        const encoded = JSON.stringify(payload);
        for (const listener of [...listeners]) listener(encoded);
      };

      const controllerHandle: ControlledAcpHandle = {
        spawnIndex,
        promptEntered: promptGate.promise,
        closeEntered: closeEnteredGate.promise,
        closed: () => isClosed,
        closeCount: () => closeCalls,
        sawCancel: () => cancelSeen,
        readAborted: () => pendingReadAborted,
        releasePrompt(replyText?: string) {
          if (!pendingPrompt) return;
          const { id, text } = pendingPrompt;
          pendingPrompt = null;
          emit({ jsonrpc: "2.0", id, result: { text: replyText ?? replyFor(text, spawnIndex), stopReason: "end_turn" } });
        },
        releaseClose() {
          closeFinishGate.resolve();
        },
      };
      handles.push(controllerHandle);
      const waiter = handleWaiters.shift();
      if (waiter) waiter(controllerHandle);

      const handle: AgentStdioHandle & { cwd: string } = {
        cwd: "/sandbox",
        onLine(listener) {
          listeners.add(listener);
          return () => { listeners.delete(listener); };
        },
        writeLine(line) {
          const message = JSON.parse(line) as { id?: number | string; method: string; params?: { prompt?: { text: string }[] } };
          if (message.method === "session/cancel") cancelSeen = true;
          if (message.id === undefined) return;
          if (message.method === "initialize") {
            emit({ jsonrpc: "2.0", id: message.id, result: { agentCapabilities: { mcpCapabilities: { http: true } } } });
            return;
          }
          if (message.method === "session/new") {
            emit({ jsonrpc: "2.0", id: message.id, result: { sessionId: `sess-${spawnIndex}` } });
            return;
          }
          if (message.method === "session/prompt") {
            const text = message.params?.prompt?.[0]?.text ?? "";
            prompts.push(text);
            promptGate.resolve(text);
            if (holdThisPrompt) {
              pendingPrompt = { id: message.id, text };
              return;
            }
            emit({ jsonrpc: "2.0", id: message.id, result: { text: replyFor(text, spawnIndex), stopReason: "end_turn" } });
            return;
          }
          emit({ jsonrpc: "2.0", id: message.id, result: {} });
        },
        async close() {
          isClosed = true;
          closeCalls++;
          if (pendingPrompt) pendingReadAborted = true;
          closeEnteredGate.resolve();
          if (holdThisClose) await closeFinishGate.promise;
        },
      };
      return handle;
    },
  };

  return {
    port,
    spawns: () => spawnCount,
    prompts,
    handles,
    setMode(mode) {
      if (mode.holdPrompt !== undefined) holdPrompt = mode.holdPrompt;
      if (mode.holdClose !== undefined) holdClose = mode.holdClose;
    },
    waitForNextHandle: () => new Promise<ControlledAcpHandle>(resolve => { handleWaiters.push(resolve); }),
  };
}

async function waitFor<T>(read: () => Promise<T>, accept: (value: T) => boolean, message: string): Promise<T> {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const value = await read();
    if (accept(value)) return value;
    await new Promise<void>(resolve => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out: ${message}`);
}

async function readEffectsFile(dir: string): Promise<EffectRecord[]> {
  return JSON.parse(await readFile(join(dir, "_cache/effects.json"), "utf8")) as EffectRecord[];
}

test("legacy web-settings.json with persona loads cleanly and omits persona when saved in both Obsidian and Web", async () => {
  const root = await testSandbox("m69-legacy-persona-");
  const obsidianDir = join(root, "obsidian");
  const webDir = join(root, "web");
  await mkdir(join(obsidianDir, "_cache"), { recursive: true });
  await mkdir(join(webDir, "_cache"), { recursive: true });
  const legacySettings = {
    preset: "all",
    persona: "sanctuary",
    plugins: {},
    agentId: "",
    agentConfigured: true,
    model: "",
    effort: "",
  };
  await writeFile(join(obsidianDir, "_cache/web-settings.json"), JSON.stringify(legacySettings, null, 2));
  await writeFile(join(webDir, "_cache/web-settings.json"), JSON.stringify({ ...legacySettings, persona: "studio" }, null, 2));

  const offlineAgent = createControlledAcpPort({ installed: false });
  const controller = new PithObsidianController({ id: "obsidian", storage: new NodeWorkspaceStorage(obsidianDir), process: offlineAgent.port });
  const server = await createPithWebServer({ workspaceDir: webDir, processPort: offlineAgent.port });
  try {
    await controller.initialize();
    assert.deepEqual(controller.getAgentConfig(), { agentId: "", model: "", effort: "" });
    assert.equal("persona" in controller.getAgentConfig(), false);
    assert.equal("setPersona" in controller, false);
    assert.equal("getPersona" in controller, false);

    // Obsidian settings UI has no «术语风格» row (using HostPort.process boundary without overriding controller methods)
    const tab = new PithSettingTab({} as never, { getWorkspacePath: () => "Pith", setWorkspacePath: async () => false } as never, controller);
    const rootEl = new StubSettingElement();
    tab.containerEl = rootEl as never;
    tab.display();
    await waitFor(async () => rootEl.children.at(-1)?.textContent ?? "", status => status === "未发现可用 Agent", "settings tab agent detection");
    assert.equal(rootEl.children.some(node => node.textContent.includes("术语风格")), false);

    // Saving any setting in Obsidian omits legacy persona
    await controller.setAgentConfig({ agentId: "dsh", model: "m1", effort: "low" });
    const obsidianSaved = JSON.parse(await readFile(join(obsidianDir, "_cache/web-settings.json"), "utf8")) as Record<string, unknown>;
    assert.equal("persona" in obsidianSaved, false);
    assert.equal(obsidianSaved.agentId, "dsh");
    assert.equal(obsidianSaved.model, "m1");
    assert.equal(obsidianSaved.effort, "low");

    // Web loads legacy persona without throwing and excludes it from /api/state and client script
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const base = `http://127.0.0.1:${address.port}`;
    const state = await (await fetch(`${base}/api/state`)).json() as { settings: Record<string, unknown> };
    assert.equal("persona" in state.settings, false);
    const script = await (await fetch(`${base}/app.js`)).text();
    assert.equal(script.includes("simple-persona"), false);
    assert.equal(script.includes("术语风格"), false);

    // Saving any setting in Web omits legacy persona
    const updated = await (await fetch(`${base}/api/settings`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "web-model" }),
    })).json() as { settings: Record<string, unknown> };
    assert.equal("persona" in updated.settings, false);
    const webSaved = JSON.parse(await readFile(join(webDir, "_cache/web-settings.json"), "utf8")) as Record<string, unknown>;
    assert.equal("persona" in webSaved, false);
    assert.equal(webSaved.model, "web-model");
  } finally {
    controller.dispose();
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await rm(root, { recursive: true, force: true });
  }
});

test("Obsidian controller triggers prepare-next-action via initialize, setAgentConfig, setPlugins, and captureHighlight", async () => {
  const root = await testSandbox("m69-obsidian-next-action-");
  const storage = new NodeWorkspaceStorage(root);
  const store = new DefaultWorkspaceStore(storage);
  await store.ensureScaffold();
  const topic = await store.createTopic({ title: "Obsidian Next Action", target: "Verify F-NEXT-ACTION wiring", materialIds: [], toolkits: ["feynman"] });
  await store.writeLesson(topic.id, "01-intro.md", "# Intro\n\nSome lesson prose.");

  const agent = createControlledAcpPort({ reply: (_prompt, index) => `Action #${index}` });
  const controller = new PithObsidianController({ id: "obsidian", storage, process: agent.port });
  try {
    await controller.initialize();

    // Offline captureHighlight leaves effect pending without spawning an agent
    await controller.captureHighlight(topic.id, "offline highlight");
    await new Promise<void>(resolve => setTimeout(resolve, 50));
    assert.equal(agent.spawns(), 0);
    assert.equal((await store.getTopic(topic.id))?.nextAction, undefined);
    const offlineEffects = await controller.engine.listEffects();
    assert.equal(offlineEffects.length, 1);
    assert.equal(offlineEffects[0]?.kind, "prepare-next-action");
    assert.equal(offlineEffects[0]?.status, "pending");

    // setAgentConfig to online drains the pending effect
    await controller.setAgentConfig({ agentId: "dsh", model: "", effort: "" });
    const afterOnline = await waitFor(
      () => store.getTopic(topic.id),
      item => item?.nextAction === "Action #1",
      "setAgentConfig draining pending effect",
    );
    assert.equal(afterOnline?.nextAction, "Action #1");
    await waitFor(() => controller.engine.listEffects(), list => list.at(-1)?.status === "completed", "setAgentConfig effect completed");

    // Online captureHighlight triggers prepare-next-action
    await controller.captureHighlight(topic.id, "online highlight");
    await waitFor(() => store.getTopic(topic.id), item => item?.nextAction === "Action #2", "captureHighlight nextAction");
    await waitFor(() => controller.engine.listEffects(), list => list.at(-1)?.status === "completed", "captureHighlight effect completed");

    // Online setPlugins drains queued effect
    await controller.engine.enqueueEffect("prepare-next-action", topic.id, { topicId: topic.id });
    await controller.setPlugins({ preset: "all", plugins: {} });
    await waitFor(() => store.getTopic(topic.id), item => item?.nextAction === "Action #3", "setPlugins draining effect");

    // Disposed controller does not trigger any further background effects
    const spawnsBeforeDispose = agent.spawns();
    controller.dispose();
    await controller.captureHighlight(topic.id, "after dispose");
    controller.processEffects();
    await new Promise<void>(resolve => setTimeout(resolve, 50));
    assert.equal(agent.spawns(), spawnsBeforeDispose);
    assert.equal((await controller.engine.listEffects()).at(-1)?.status, "pending");

    // Re-initializing a new controller on the same NodeWorkspaceStorage drains it at startup
    const restarted = new PithObsidianController({ id: "obsidian", storage, process: agent.port });
    try {
      await restarted.initialize();
      await waitFor(() => store.getTopic(topic.id), item => item?.nextAction === "Action #4", "initialize draining pending effect");
      await waitFor(() => restarted.engine.listEffects(), list => list.at(-1)?.status === "completed", "initialize effect completed");
    } finally {
      restarted.dispose();
    }
  } finally {
    controller.dispose();
    await rm(root, { recursive: true, force: true });
  }
});

test("Obsidian controller.dispose() cancels in-flight prepare-next-action, ignores late replies, keeps pending, and drains on restart", async () => {
  const root = await testSandbox("m69-obsidian-dispose-inflight-");
  const storage = new NodeWorkspaceStorage(root);
  const store = new DefaultWorkspaceStore(storage);
  await store.ensureScaffold();
  const topic = await store.createTopic({ title: "Dispose In-Flight", target: "Cancel background prompt on dispose", materialIds: [], toolkits: ["feynman"] });
  await store.writeLesson(topic.id, "01-intro.md", "# Intro\n\nProse.");

  const agent = createControlledAcpPort({ reply: (_prompt, index) => `Recovered #${index}` });
  const controller = new PithObsidianController({ id: "obsidian", storage, process: agent.port });
  try {
    await controller.initialize();
    await controller.setAgentConfig({ agentId: "dsh", model: "", effort: "" });

    agent.setMode({ holdPrompt: true });
    const nextHandle = agent.waitForNextHandle();
    await controller.captureHighlight(topic.id, "trigger while online");
    const activeHandle = await within(nextHandle, "next ACP handle on dispose test");
    await within(activeHandle.promptEntered, "session/prompt entered on dispose test");

    // Dispose while ACP session/prompt is still suspended
    controller.dispose();
    await within(activeHandle.closeEntered, "handle.close() called on controller.dispose()");
    assert.equal(activeHandle.closed(), true);
    assert.equal(activeHandle.readAborted(), true);

    const afterDisposeEffects = await waitFor(
      () => readEffectsFile(root),
      list => list.length === 1 && list[0]?.status === "pending",
      "effect reset to pending after dispose",
    );
    assert.equal(afterDisposeEffects[0]?.attempts, 0);
    assert.equal(afterDisposeEffects[0]?.lastError, undefined);

    // Releasing late ACP reply must never write nextAction or mark completed
    activeHandle.releasePrompt("LATE REPLY AFTER DISPOSE");
    await new Promise<void>(resolve => setTimeout(resolve, 60));
    assert.equal((await store.getTopic(topic.id))?.nextAction, undefined);
    const persisted = await readEffectsFile(root);
    assert.equal(persisted.length, 1);
    assert.equal(persisted[0]?.status, "pending");
    assert.equal(persisted[0]?.attempts, 0);

    // Re-initializing a fresh controller on the same NodeWorkspaceStorage drains the pending effect
    agent.setMode({ holdPrompt: false });
    const restarted = new PithObsidianController({ id: "obsidian", storage, process: agent.port });
    try {
      await restarted.initialize();
      const updated = await waitFor(
        () => store.getTopic(topic.id),
        item => item?.nextAction === "Recovered #2",
        "restarted controller draining pending effect",
      );
      assert.equal(updated?.nextAction, "Recovered #2");
      await waitFor(() => readEffectsFile(root), list => list[0]?.status === "completed", "restarted controller effect completed");
    } finally {
      restarted.dispose();
    }
  } finally {
    controller.dispose();
    await rm(root, { recursive: true, force: true });
  }
});

test("Obsidian switching offline via setAgentConfig cancels in-flight prepare-next-action, ignores late replies, and drains when re-enabled", async () => {
  const root = await testSandbox("m69-obsidian-offline-inflight-");
  const storage = new NodeWorkspaceStorage(root);
  const store = new DefaultWorkspaceStore(storage);
  await store.ensureScaffold();
  const topic = await store.createTopic({ title: "Offline In-Flight", target: "Cancel background prompt on offline switch", materialIds: [], toolkits: ["feynman"] });
  await store.writeLesson(topic.id, "01-intro.md", "# Intro\n\nProse.");

  const agent = createControlledAcpPort({ reply: (_prompt, index) => `Online Again #${index}` });
  const controller = new PithObsidianController({ id: "obsidian", storage, process: agent.port });
  try {
    await controller.initialize();
    await controller.setAgentConfig({ agentId: "dsh", model: "", effort: "" });

    agent.setMode({ holdPrompt: true });
    const nextHandle = agent.waitForNextHandle();
    await controller.captureHighlight(topic.id, "trigger before offline");
    const activeHandle = await within(nextHandle, "next ACP handle on offline test");
    await within(activeHandle.promptEntered, "session/prompt entered on offline test");

    // Switch offline while ACP prompt is in flight
    await controller.setAgentConfig({ agentId: "", model: "", effort: "" });
    await within(activeHandle.closeEntered, "handle.close() called on setAgentConfig offline switch");
    assert.equal(activeHandle.closed(), true);
    assert.equal(activeHandle.readAborted(), true);

    const afterOfflineEffects = await waitFor(
      () => readEffectsFile(root),
      list => list.length === 1 && list[0]?.status === "pending",
      "effect reset to pending after switching offline",
    );
    assert.equal(afterOfflineEffects[0]?.attempts, 0);
    assert.equal(afterOfflineEffects[0]?.lastError, undefined);

    // Late ACP reply after going offline must not write nextAction
    activeHandle.releasePrompt("LATE REPLY AFTER OFFLINE");
    await new Promise<void>(resolve => setTimeout(resolve, 60));
    assert.equal((await store.getTopic(topic.id))?.nextAction, undefined);
    assert.equal((await readEffectsFile(root))[0]?.status, "pending");

    // Re-enabling agent drains the pending effect
    agent.setMode({ holdPrompt: false });
    await controller.setAgentConfig({ agentId: "dsh", model: "", effort: "" });
    const updated = await waitFor(
      () => store.getTopic(topic.id),
      item => item?.nextAction === "Online Again #2",
      "draining pending effect after returning online",
    );
    assert.equal(updated?.nextAction, "Online Again #2");
    await waitFor(() => readEffectsFile(root), list => list[0]?.status === "completed", "re-enabled online effect completed");
  } finally {
    controller.dispose();
    await rm(root, { recursive: true, force: true });
  }
});

test("Obsidian abort during handle.close() after prompt reply refuses to write nextAction to topic.md", async () => {
  const root = await testSandbox("m69-obsidian-close-race-");
  const storage = new NodeWorkspaceStorage(root);
  const store = new DefaultWorkspaceStore(storage);
  await store.ensureScaffold();
  const topic = await store.createTopic({ title: "Close Race", target: "Guard updateTopic against late abort", materialIds: [], toolkits: ["feynman"] });
  await store.writeLesson(topic.id, "01-intro.md", "# Intro\n\nProse.");

  const agent = createControlledAcpPort({ reply: () => "SHOULD NOT WRITE ON ABORT" });
  const controller = new PithObsidianController({ id: "obsidian", storage, process: agent.port });
  try {
    await controller.initialize();
    await controller.setAgentConfig({ agentId: "dsh", model: "", effort: "" });

    agent.setMode({ holdPrompt: false, holdClose: true });
    const nextHandle = agent.waitForNextHandle();
    await controller.captureHighlight(topic.id, "trigger close race");
    const activeHandle = await within(nextHandle, "next ACP handle on close race test");
    await within(activeHandle.closeEntered, "handle.close() entered on close race test");

    // Prompt already returned its text, and runOneShotAcpPrompt is awaiting handle.close(); dispose now
    controller.dispose();
    activeHandle.releaseClose();

    const effects = await waitFor(
      () => readEffectsFile(root),
      list => list.length === 1 && list[0]?.status === "pending",
      "effect reset to pending when aborted during close",
    );
    assert.equal(effects[0]?.attempts, 0);
    assert.equal((await store.getTopic(topic.id))?.nextAction, undefined);
  } finally {
    controller.dispose();
    await rm(root, { recursive: true, force: true });
  }
});

test("Web server.close() cancels in-flight prepare-next-action and rejects late ACP reply", async () => {
  const root = await testSandbox("m69-web-close-inflight-");
  const storage = new NodeWorkspaceStorage(root);
  const store = new DefaultWorkspaceStore(storage);
  await store.ensureScaffold();
  const topic = await store.createTopic({ title: "Web Close In-Flight", target: "Cancel background prompt on server close", materialIds: [], toolkits: ["feynman"] });
  await store.writeLesson(topic.id, "01-intro.md", "# Intro\n\nProse.");

  const agent = createControlledAcpPort({ reply: () => "LATE WEB ACTION" });
  const server = await createPithWebServer({ workspaceDir: root, processPort: agent.port });
  let closed = false;
  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const base = `http://127.0.0.1:${address.port}`;
    const settingsRes = await fetch(`${base}/api/settings`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agentId: "dsh" }),
    });
    assert.equal(settingsRes.status, 200);

    agent.setMode({ holdPrompt: true });
    const nextHandle = agent.waitForNextHandle();
    const noteRes = await fetch(`${base}/api/notes`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ topicId: topic.id, kind: "note", body: "note triggering web effect" }),
    });
    assert.equal(noteRes.status, 201);

    const activeHandle = await within(nextHandle, "next ACP handle on web close test");
    await within(activeHandle.promptEntered, "session/prompt entered on web close test");

    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    closed = true;

    await within(activeHandle.closeEntered, "handle.close() called on Web server.close()");
    assert.equal(activeHandle.closed(), true);
    assert.equal(activeHandle.readAborted(), true);

    const afterCloseEffects = await waitFor(
      () => readEffectsFile(root),
      list => list.length === 1 && list[0]?.status === "pending",
      "web effect reset to pending on server close",
    );
    assert.equal(afterCloseEffects[0]?.attempts, 0);
    assert.equal(afterCloseEffects[0]?.lastError, undefined);

    activeHandle.releasePrompt("LATE REPLY AFTER SERVER CLOSE");
    await new Promise<void>(resolve => setTimeout(resolve, 60));
    assert.equal((await store.getTopic(topic.id))?.nextAction, undefined);
    assert.equal((await readEffectsFile(root))[0]?.status, "pending");
  } finally {
    if (!closed) {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
    await rm(root, { recursive: true, force: true });
  }
});

test("feynman mounted quick actions omit feynman-coach across core and Web actions API", async () => {
  const root = await testSandbox("m69-feynman-actions-");
  const storage = new NodeWorkspaceStorage(root);
  const store = new DefaultWorkspaceStore(storage);
  const topic: Topic = await store.createTopic({
    title: "Feynman Clean",
    target: "Verify quick actions",
    materialIds: [],
    toolkits: ["feynman"],
  });
  await store.writeLesson(topic.id, "01.md", "# Lesson");
  const updated = (await store.getTopic(topic.id))!;

  assert.deepEqual(feynmanToolkit.quickActions, []);
  const coreActions = quickActionsForTopic(updated, [feynmanToolkit]);
  assert.equal(coreActions.some(action => action.id === "feynman-coach"), false);
  assert.deepEqual(coreActions.map(action => action.id), ["orient", "quiz"]);

  const agent = createControlledAcpPort({ reply: () => "Action" });
  const server = await createPithWebServer({ workspaceDir: root, processPort: agent.port });
  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const base = `http://127.0.0.1:${address.port}`;
    await fetch(`${base}/api/settings`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agentId: "dsh" }),
    });
    const actions = await (await fetch(`${base}/api/topics/${encodeURIComponent(topic.id)}/actions`)).json() as { id: string; label: string }[];
    assert.equal(actions.some(action => action.id === "feynman-coach" || action.label.includes("费曼深水区追问")), false);
    assert.deepEqual(actions.map(action => action.id), ["orient", "quiz"]);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await rm(root, { recursive: true, force: true });
  }
});
