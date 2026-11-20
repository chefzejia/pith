import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import {
  DefaultWorkspaceStore,
  type AgentProcessPort,
  type AgentStdioHandle,
  type Note,
  type Topic,
} from "../src/core/index.ts";
import { quickActionsForTopic } from "../src/plugins/guide-acp/index.ts";
import { feynmanToolkit } from "../src/plugins/toolkit-feynman/index.ts";
import { PithObsidianController, PithSettingTab, PithWorkspaceView } from "../src/shells/obsidian/index.ts";
import type { ObsidianViewActions } from "../src/shells/obsidian/plugin.ts";
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

function createFakeAcpPort(nextActionReply: (prompt: string, spawnIndex: number) => string): {
  port: AgentProcessPort;
  spawns: () => number;
  prompts: string[];
} {
  let spawnCount = 0;
  const prompts: string[] = [];
  const port: AgentProcessPort = {
    findExecutable: async command => command === "dsh" ? "/sandbox/dsh" : null,
    probeExecutable: async (_path, args) => args.includes("--help") ? "Agent Client Protocol (ACP)" : "dsh 1.0.0",
    async spawnStdio(): Promise<AgentStdioHandle> {
      const spawnIndex = ++spawnCount;
      const listeners = new Set<(line: string) => void>();
      const handle: AgentStdioHandle & { cwd: string } = {
        cwd: "/sandbox",
        onLine(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
        writeLine(line) {
          const message = JSON.parse(line) as { id?: number; method: string; params?: { prompt?: { text: string }[] } };
          if (message.id === undefined) return;
          let result: unknown = {};
          if (message.method === "initialize") result = { agentCapabilities: { mcpCapabilities: { http: true } } };
          else if (message.method === "session/new") result = { sessionId: `sess-${spawnIndex}` };
          else if (message.method === "session/prompt") {
            const text = message.params?.prompt?.[0]?.text ?? "";
            prompts.push(text);
            result = { text: nextActionReply(text, spawnIndex), stopReason: "end_turn" };
          }
          for (const listener of listeners) listener(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }));
        },
        async close() {},
      };
      return handle;
    },
  };
  return { port, spawns: () => spawnCount, prompts };
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

function createStubWorkspace(controller: PithObsidianController): {
  workspace: PithWorkspaceView;
  actions: () => ObsidianViewActions;
} {
  let captured: ObsidianViewActions | undefined;
  const createView = controller.createView.bind(controller);
  controller.createView = (_root, actions) => {
    captured = actions;
    return {
      setGuideAvailable() {},
      setGuideVisible() {},
      setToolkits() {},
      updateMaterialNavigation() {},
      render() {},
      refreshGuide: async () => {},
      dispose() {},
      guideElement: () => ({} as never),
      focusQuotedGuide() {},
      quoteSelection() {},
      showLessonLoading() {},
      guideTurn: async () => {},
      updateGuideTurn() {},
    } as never;
  };
  const workspace = Object.create(PithWorkspaceView.prototype) as PithWorkspaceView;
  Object.assign(workspace, {
    generation: 0,
    homeRequest: 0,
    guideRequest: 0,
    guideDesiredVisible: false,
    guideOpening: null,
    guideOpeningLeaf: null,
    view: null,
    contentEl: {},
    controller,
    host: (controller as unknown as { host: unknown }).host,
    guideByTopic: controller.guideVisibility,
    report(error: unknown) { throw error; },
  });
  // Keep reference to createView so controller remains valid for typecheck without warnings
  void createView;
  return {
    workspace,
    actions: () => {
      assert.ok(captured, "expected PithWorkspaceView to create a view");
      return captured;
    },
  };
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

  const controller = new PithObsidianController({ id: "obsidian", storage: new NodeWorkspaceStorage(obsidianDir) });
  const server = await createPithWebServer({ workspaceDir: webDir });
  try {
    await controller.initialize();
    assert.deepEqual(controller.getAgentConfig(), { agentId: "", model: "", effort: "" });
    assert.equal("persona" in controller.getAgentConfig(), false);
    assert.equal("setPersona" in controller, false);
    assert.equal("getPersona" in controller, false);

    // Obsidian settings UI has no «术语风格» row
    const tab = new PithSettingTab({} as never, { getWorkspacePath: () => "Pith", setWorkspacePath: async () => false } as never, controller);
    const rootEl = new StubSettingElement();
    tab.containerEl = rootEl as never;
    controller.detectAgents = async () => [];
    tab.display();
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
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await rm(root, { recursive: true, force: true });
  }
});

test("Obsidian controller and workspace view trigger prepare-next-action on capture when online and stay pending offline", async () => {
  const root = await testSandbox("m69-obsidian-next-action-");
  const storage = new NodeWorkspaceStorage(root);
  const store = new DefaultWorkspaceStore(storage);
  await store.ensureScaffold();
  const topic = await store.createTopic({ title: "Obsidian Next Action", target: "Verify F-NEXT-ACTION wiring", materialIds: [], toolkits: ["feynman"] });
  await store.writeLesson(topic.id, "01-intro.md", "# Intro\n\nSome lesson prose.");

  const agent = createFakeAcpPort((_prompt, index) => `Action #${index}`);
  const controller = new PithObsidianController({ id: "obsidian", storage, process: agent.port });
  try {
    await controller.initialize();
    const { workspace, actions } = createStubWorkspace(controller);
    await (workspace as unknown as { openTopic(id: string): Promise<void> }).openTopic(topic.id);

    // Offline captures: highlight, selection, note, practice -> leave pending without error or agent spawn
    await controller.captureHighlight(topic.id, "offline highlight");
    actions().selection("highlight", "offline selection", "text:offset:0");
    await waitFor(() => store.getTopic(topic.id), item => (item?.notes.length ?? 0) >= 2, "offline selection capture");
    await actions().sendGuide!("offline note", undefined, true);
    await actions().savePractice!("offline practice", undefined, { toolkit: "feynman", passage: "p1", points: [] });
    await new Promise<void>(resolve => setTimeout(resolve, 50));

    assert.equal(agent.spawns(), 0);
    assert.equal((await store.getTopic(topic.id))?.nextAction, undefined);
    const offlineEffects = await controller.engine.listEffects();
    assert.equal(offlineEffects.length, 1);
    assert.equal(offlineEffects[0]?.kind, "prepare-next-action");
    assert.equal(offlineEffects[0]?.status, "pending");

    // Switching to online drains the pending effect
    await controller.setAgentConfig({ agentId: "dsh", model: "", effort: "" });
    const afterOnline = await waitFor(
      () => store.getTopic(topic.id),
      item => item?.nextAction === "Action #1",
      "setAgentConfig draining pending effect",
    );
    assert.equal(afterOnline?.nextAction, "Action #1");
    assert.equal((await controller.engine.listEffects()).at(-1)?.status, "completed");

    // Online captureHighlight triggers prepare-next-action
    await controller.captureHighlight(topic.id, "online highlight");
    await waitFor(() => store.getTopic(topic.id), item => item?.nextAction === "Action #2", "captureHighlight nextAction");
    assert.equal((await controller.engine.listEffects()).at(-1)?.status, "completed");

    // Online selection highlight triggers prepare-next-action
    actions().selection("highlight", "online selection", "text:offset:1");
    await waitFor(() => store.getTopic(topic.id), item => item?.nextAction === "Action #3", "view selection nextAction");

    // Online sendGuide (saveAsNote) triggers prepare-next-action
    await actions().sendGuide!("online user note", undefined, true);
    await waitFor(() => store.getTopic(topic.id), item => item?.nextAction === "Action #4", "view sendGuide note nextAction");

    // Online savePractice triggers prepare-next-action
    const savedPractice: Note = await actions().savePractice!("online practice", undefined, { toolkit: "feynman", passage: "p2", points: [] });
    assert.equal(savedPractice.kind, "practice");
    await waitFor(() => store.getTopic(topic.id), item => item?.nextAction === "Action #5", "view savePractice nextAction");

    // Online setPlugins drains queued effect
    await controller.engine.enqueueEffect("prepare-next-action", topic.id, { topicId: topic.id });
    await controller.setPlugins({ preset: "all", plugins: {} });
    await waitFor(() => store.getTopic(topic.id), item => item?.nextAction === "Action #6", "setPlugins draining effect");

    // guideData actions with feynman mounted excludes retired feynman-coach
    const guide = await actions().guideData!();
    assert.equal(guide.actions.some(item => item.id === "feynman-coach" || item.label.includes("费曼深水区追问")), false);

    // Disposed controller does not trigger any further background effects
    const spawnsBeforeDispose = agent.spawns();
    controller.dispose();
    await controller.captureHighlight(topic.id, "after dispose");
    controller.processEffects();
    await new Promise<void>(resolve => setTimeout(resolve, 50));
    assert.equal(agent.spawns(), spawnsBeforeDispose);
    assert.equal((await controller.engine.listEffects()).at(-1)?.status, "pending");

    // Re-initializing a new controller with existing pending effect drains it at startup
    const restarted = new PithObsidianController({ id: "obsidian", storage, process: agent.port });
    try {
      await restarted.initialize();
      await waitFor(() => store.getTopic(topic.id), item => item?.nextAction === "Action #7", "initialize draining pending effect");
      assert.equal((await restarted.engine.listEffects()).at(-1)?.status, "completed");
    } finally {
      restarted.dispose();
    }
  } finally {
    controller.dispose();
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

  const agent = createFakeAcpPort(() => "Action");
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
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await rm(root, { recursive: true, force: true });
  }
});
