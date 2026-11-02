import { DefaultAttentionEngine, DefaultWorkspaceStore, MutationQueue, PluginRuntime, type AgentProcessPort, type GuideAgentService, type HostPort, type PluginsConfigFile, type SelectionAnchor, type SpeechTtsService, type StageTimelineService, type StageReaderService, type StorageEntry, type WorkspaceStoragePort, type ImportMaterialInput } from "../../core/index.ts";
import { builtinRegistry } from "../../plugins/all.ts";
import { NodeAgentProcessPort } from "../web/nodeProcess.ts";
import { NodeHttpPort } from "../web/nodeHttp.ts";
import { PithObsidianView, type ObsidianAgentConfig, type ObsidianViewActions } from "./plugin.ts";

interface ObsidianLeaf {
  setViewState(state: { type: string; active: boolean }): Promise<void>;
}
interface ObsidianWorkspace {
  getLeavesOfType(type: string): ObsidianLeaf[];
  getLeaf(type: "tab"): ObsidianLeaf;
  revealLeaf(leaf: ObsidianLeaf): Promise<void>;
  detachLeavesOfType(type: string): void;
}
interface ObsidianPluginBase {
  app: { vault: { adapter: ObsidianVaultAdapter }; workspace: ObsidianWorkspace };
  registerView(type: string, factory: (leaf: ObsidianLeaf) => ObsidianItemViewBase): void;
  addRibbonIcon(icon: string, title: string, callback: () => void): HTMLElement;
  addCommand(command: { id: string; name: string; callback: () => void }): void;
}
interface ObsidianItemViewBase { contentEl: HTMLElement }
type ObsidianApi = {
  Plugin: new (...args: never[]) => ObsidianPluginBase;
  ItemView: new (leaf: ObsidianLeaf) => ObsidianItemViewBase;
  Notice: new (message: string) => unknown;
};
// Obsidian supplies this module at runtime; plain Node imports keep the controller usable.
const obsidian: ObsidianApi = typeof require === "function" ? require("obsidian") as ObsidianApi : {
  Plugin: class { constructor() { throw new Error("Obsidian host required"); } } as unknown as ObsidianApi["Plugin"],
  ItemView: class { constructor() { throw new Error("Obsidian host required"); } } as unknown as ObsidianApi["ItemView"],
  Notice: class { constructor() { throw new Error("Obsidian host required"); } },
};

export interface ObsidianVaultAdapter {
  exists(path: string): Promise<boolean>;
  read(path: string): Promise<string>;
  readBinary(path: string): Promise<ArrayBuffer>;
  write(path: string, data: string): Promise<void>;
  writeBinary(path: string, data: ArrayBuffer): Promise<void>;
  mkdir(path: string): Promise<void>;
  list(path: string): Promise<{ files: string[]; folders: string[] }>;
}

export function createObsidianHostPort(vault: ObsidianVaultAdapter, workspacePath = "", processPort?: AgentProcessPort): HostPort {
  const root = workspacePath.replace(/\/$/, "");
  const path = (value: string): string => {
    if (!value || value.startsWith("/") || value.includes("\\") || value.split("/").some(part => !part || part === "." || part === "..")) throw new Error("Invalid workspace path");
    return root ? `${root}/${value}` : value;
  };
  if (root && (root.startsWith("/") || root.includes("\\") || root.split("/").some(part => !part || part === "." || part === ".."))) throw new Error("Invalid workspace root");
  const storage: WorkspaceStoragePort = {
    mutationIdentity: vault,
    exists: value => vault.exists(path(value)),
    readText: value => vault.read(path(value)),
    readBinary: async value => new Uint8Array(await vault.readBinary(path(value))),
    writeText: (value, data) => vault.write(path(value), data),
    createText: async (value, data) => { const target = path(value); if (await vault.exists(target)) throw new Error("File exists"); await vault.write(target, data); },
    writeBinary: (value, data) => vault.writeBinary(path(value), new Uint8Array(data).buffer),
    createBinary: async (value, data) => { const target = path(value); if (await vault.exists(target)) throw new Error("File exists"); await vault.writeBinary(target, new Uint8Array(data).buffer); },
    processText: async (value, update) => { const target = path(value); const result = update(await vault.read(target)); await vault.write(target, result); return result; },
    mkdir: async value => { const target = path(value); if (!await vault.exists(target)) await vault.mkdir(target); },
    list: async value => {
      const result = await vault.list(path(value));
      const relative = (entry: string): string => root && entry.startsWith(`${root}/`) ? entry.slice(root.length + 1) : entry;
      return [...result.folders.map(entry => ({ path: relative(entry), type: "folder" as const })), ...result.files.map(entry => ({ path: relative(entry), type: "file" as const }))] satisfies StorageEntry[];
    },
  };
  return { id: "obsidian", storage, http: new NodeHttpPort(), secrets: { getSecret: key => typeof process !== "undefined" ? process.env[key] ?? null : null }, ...(processPort ? { process: processPort } : {}) };
}

export function bootObsidianShell(host: HostPort, config: PluginsConfigFile = {}): PluginRuntime {
  const runtime = new PluginRuntime(builtinRegistry.list(), { host, store: host.storage, engine: {}, window: {} });
  runtime.reconcile(config);
  return runtime;
}

export class PithObsidianController {
  readonly store: DefaultWorkspaceStore;
  readonly engine: DefaultAttentionEngine;
  readonly runtime: PluginRuntime;
  private readonly host: HostPort;
  private config: PluginsConfigFile = { preset: "all" };
  private persona: "sanctuary" | "studio" = "sanctuary";
  private agentId: ObsidianAgentConfig["agentId"] = "";
  private model = "";
  private effort = "";
  private appliedGuideConfig = "";
  private speechConfig: Record<string, string> = {};
  private appliedSpeechConfig = "";
  private topics: Awaited<ReturnType<DefaultWorkspaceStore["listTopics"]>> | null = null;
  private materials: Awaited<ReturnType<DefaultWorkspaceStore["listMaterials"]>> | null = null;
  private readonly views = new Set<PithObsidianView>();

  constructor(host: HostPort) {
    this.host = host;
    this.store = new DefaultWorkspaceStore(host.storage);
    this.engine = new DefaultAttentionEngine(this.store, host.storage);
    const manifests = builtinRegistry.list().map(manifest => {
      if (!["stage-reader", "stage-timeline", "dojo-shadowing"].includes(manifest.id)) return manifest;
      return { ...manifest, inUse: () => {
        if (!this.topics || !this.materials) throw new Error("Workspace snapshot unavailable");
        if (manifest.id === "stage-reader") return this.materials.filter(item => item.kind === "book" || item.kind === "article").length;
        if (manifest.id === "stage-timeline") return this.materials.filter(item => item.kind === "media").length;
        return this.topics.filter(topic => topic.toolkits.includes("shadowing") || topic.toolkits.includes("dojo-shadowing")).length;
      } };
    });
    this.runtime = new PluginRuntime(manifests, { host, store: this.store, engine: this.engine, window: {} });
  }
  async initialize(): Promise<void> {
    await this.store.ensureScaffold();
    if (await this.host.storage.exists("_cache/web-settings.json")) {
      const data: unknown = JSON.parse(await this.host.storage.readText("_cache/web-settings.json"));
      if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Invalid settings");
      const value = data as { preset?: unknown; persona?: unknown; plugins?: unknown; agentId?: unknown; model?: unknown; effort?: unknown; speech?: unknown };
      if ((value.preset !== "all" && value.preset !== "essentials") || (value.persona !== "sanctuary" && value.persona !== "studio") || !value.plugins || typeof value.plugins !== "object" || Array.isArray(value.plugins) || (value.agentId !== undefined && (typeof value.agentId !== "string" || !["", "dsh", "claude", "codex"].includes(value.agentId))) || (value.model !== undefined && typeof value.model !== "string") || (value.effort !== undefined && typeof value.effort !== "string")) throw new Error("Invalid settings");
      this.persona = value.persona;
      this.agentId = (value.agentId ?? "") as ObsidianAgentConfig["agentId"];
      this.model = (value.model ?? "") as string;
      this.effort = (value.effort ?? "") as string;
      if (value.speech !== undefined) { if (!value.speech || typeof value.speech !== "object" || Array.isArray(value.speech) || Object.values(value.speech).some(item => typeof item !== "string")) throw new Error("Invalid speech settings"); this.speechConfig = value.speech as Record<string, string>; }
      this.config = { preset: value.preset, plugins: value.plugins as NonNullable<PluginsConfigFile["plugins"]> };
    }
    await this.refresh();
  }
  private async refresh(): Promise<void> {
    this.topics = null; this.materials = null;
    try { [this.topics, this.materials] = await Promise.all([this.store.listTopics(), this.store.listMaterials()]); }
    finally {
      const guideConfig = { agentId: this.agentId, model: this.model, effort: this.effort, persona: this.persona };
      const config: PluginsConfigFile = { ...this.config, plugins: { ...this.config.plugins, "speech-service": { ...this.config.plugins?.["speech-service"], config: this.speechConfig }, "guide-acp": { ...this.config.plugins?.["guide-acp"], config: guideConfig } } };
      const signature = JSON.stringify(guideConfig);
      if (this.appliedGuideConfig && this.appliedGuideConfig !== signature) this.runtime.reconcile({ ...config, plugins: { ...config.plugins, "guide-acp": { enabled: false } } });
      const speechSignature = JSON.stringify(this.speechConfig);
      if (this.appliedSpeechConfig && this.appliedSpeechConfig !== speechSignature) this.runtime.reconcile(Object.fromEntries(this.runtime.statuses().map(plugin => [plugin.id, plugin.id !== "speech-service" && plugin.state === "active"])));
      this.runtime.reconcile(config);
      this.appliedGuideConfig = signature;
      this.appliedSpeechConfig = speechSignature;
    }
  }
  private async save(fields: Partial<ObsidianAgentConfig> & { preset?: PluginsConfigFile["preset"]; plugins?: PluginsConfigFile["plugins"]; speech?: Record<string, string> }): Promise<void> {
    await MutationQueue.forStorage(this.host.storage).run(async () => {
      await this.host.storage.mkdir("_cache");
      const path = "_cache/web-settings.json";
      const saved: unknown = await this.host.storage.exists(path) ? JSON.parse(await this.host.storage.readText(path)) : {};
      if (!saved || typeof saved !== "object" || Array.isArray(saved)) throw new Error("Invalid settings");
      await this.host.storage.writeText(path, `${JSON.stringify({ preset: "all", persona: "sanctuary", plugins: {}, agentId: "", model: "", effort: "", ...saved, ...fields }, null, 2)}\n`);
    });
  }
  async openCompass() { await this.refresh(); return this.engine.compass(); }
  async openTopic(id: string) { return this.store.getTopic(id); }
  async importMaterial(input: ImportMaterialInput, topicId?: string) { if (topicId && !await this.store.getTopic(topicId)) throw new Error("Topic not found"); const material = await this.store.importMaterial(input); if (topicId) await this.store.updateTopic(topicId, { materialId: material.id }); await this.refresh(); return material; }
  async setSpeechConfig(config: Record<string, string>): Promise<void> {
    if (Object.entries(config).some(([key, value]) => !["ttsProvider", "ttsEndpoint", "ttsVoice", "azureRegion", "asrProvider", "asrLoopbackUrl"].includes(key) || typeof value !== "string")) throw new Error("Invalid speech settings");
    this.speechConfig = { ...config }; await this.refresh(); await this.save({ speech: this.speechConfig });
  }
  async renderMaterialFile(materialId: string, name: string) {
    const material = await this.store.getMaterial(materialId); const file = material && material.files.find(entry => entry.name === name);
    if (!material || !file) throw new Error("材料文件不存在");
    const bytes = await this.host.storage.readBinary(`materials/${material.id}/files/${file.name}`);
    if (material.kind === "media" || /\.(vtt|srt)$/i.test(name)) {
      const timeline = this.runtime.getService<StageTimelineService>("stage.timeline"); if (!timeline) throw new Error("时间轴不可用");
      const transcript = /\.(vtt|srt)$/i.test(name) ? bytes : await (async () => { const entry = material.files.find(item => /\.(vtt|srt)$/i.test(item.name)); return entry ? this.host.storage.readBinary(`materials/${material.id}/files/${entry.name}`) : new Uint8Array(); })();
      const cues = timeline.parseTranscript(new TextDecoder().decode(transcript));
      const escape = (value: string) => value.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
      const html = timeline.renderTimelineView ? timeline.renderTimelineView({ title: material.title, cues }) : `<section class="pith-timeline-stage"><h1>${escape(material.title)}</h1>${cues.map(cue => `<div class="pith-cue" data-cue-id="${escape(cue.id)}" data-locator="time:${cue.startSec}" data-prose="true"><time>${timeline.formatTimestamp(cue.startSec)}</time> ${escape(cue.text)}</div>`).join("")}</section>`;
      return { title: material.title, html, sections: [] };
    }
    const reader = this.runtime.getService<StageReaderService>("stage.reader"); if (!reader || !reader.renderFile) throw new Error("阅读器不可用");
    return reader.renderFile(file, bytes);
  }
  async captureHighlight(topicId: string, body: string, anchor?: SelectionAnchor) { return this.engine.captureSelection({ topicId, kind: "highlight", body, anchor }); }
  async setPersona(persona: "sanctuary" | "studio"): Promise<void> { this.persona = persona; await this.refresh(); await this.save({ persona }); }
  async detectAgents(force = false) { const guide = this.runtime.getService<GuideAgentService>("guide.agent"); if (!guide || !guide.detectAgents) throw new Error("Guide service unavailable"); return guide.detectAgents(force); }
  async setAgentConfig(config: ObsidianAgentConfig): Promise<void> {
    if (!["", "dsh", "claude", "codex"].includes(config.agentId) || typeof config.model !== "string" || typeof config.effort !== "string" || (config.persona !== "sanctuary" && config.persona !== "studio")) throw new Error("Invalid agent config");
    this.agentId = config.agentId; this.model = config.model; this.effort = config.effort; this.persona = config.persona;
    await this.refresh(); await this.save(config);
  }
  async setPlugins(config: PluginsConfigFile): Promise<void> { this.config = config; await this.refresh(); const available = this.runtime.statuses().some(plugin => plugin.id === "guide-acp" && plugin.state === "active"); for (const view of this.views) view.setGuideAvailable(available); await this.save({ preset: config.preset ?? "all", plugins: config.plugins ?? {} }); }
  getPersona(): "sanctuary" | "studio" { return this.persona; }
  createView(root: HTMLElement, actions: ObsidianViewActions): PithObsidianView {
    const view = new PithObsidianView(root, actions);
    view.setGuideAvailable(this.runtime.statuses().some(plugin => plugin.id === "guide-acp" && plugin.state === "active"));
    this.views.add(view);
    return view;
  }
  releaseView(view: PithObsidianView): void { if (this.views.delete(view)) view.dispose(); }
  dispose(): void { for (const view of this.views) view.dispose(); this.views.clear(); this.runtime.stop(); }
}

const PITH_VIEW_TYPE = "pith-reader";

class PithWorkspaceView extends obsidian.ItemView {
  private view: PithObsidianView | null = null;
  private readonly controller: PithObsidianController;
  private readonly host: HostPort;
  constructor(leaf: ObsidianLeaf, controller: PithObsidianController, host: HostPort) { super(leaf); this.controller = controller; this.host = host; }
  getViewType(): string { return PITH_VIEW_TYPE; }
  getDisplayText(): string { return "Pith"; }
  getIcon(): string { return "book-open"; }

  async onOpen(): Promise<void> {
    const compass = await this.controller.openCompass();
    this.contentEl.replaceChildren();
    const heading = this.contentEl.ownerDocument.createElement("h2");
    heading.textContent = "Pith";
    this.contentEl.append(heading);
    for (const topic of [...compass.exploring, ...compass.settled]) {
      const button = this.contentEl.ownerDocument.createElement("button");
      button.textContent = topic.title;
      button.addEventListener("click", () => { void this.openTopic(topic.id).catch(error => this.report(error)); });
      this.contentEl.append(button);
    }
  }

  async onClose(): Promise<void> { if (this.view) { this.controller.releaseView(this.view); this.view = null; } }

  private report(error: unknown): void { new obsidian.Notice(error instanceof Error ? error.message : String(error)); }
  private async openTopic(id: string): Promise<void> {
    const topic = await this.controller.openTopic(id);
    if (!topic || !topic.materialId) throw new Error("课题没有关联材料");
    const material = await this.controller.store.getMaterial(topic.materialId);
    if (!material || !material.files.length) throw new Error("材料没有可读取的文件");
    const render = async (name: string): Promise<void> => {
      const document = await this.controller.renderMaterialFile(material.id, name);
      if (this.view) this.view.render({ title: topic.title, html: document.html, files: material.files, currentFile: name, sections: document.sections });
    };
    if (this.view) this.controller.releaseView(this.view);
    this.view = this.controller.createView(this.contentEl, {
      openFile: render,
      synthesizeSpeech: async (text, signal) => { const tts = this.controller.runtime.getService<SpeechTtsService>("speech.tts"); if (!tts || !tts.synthesizeSpeech) throw new Error("未连接高品质语音引擎，请在设置中配置 Kokoro 或云端语音"); return tts.synthesizeSpeech(text, signal); },
      openDojo: () => { new obsidian.Notice("此视图尚未提供跟读工坊"); },
      selection: (action, text) => {
        if (action === "ask") { new obsidian.Notice("此视图尚未提供向导对话"); return; }
        void this.controller.engine.captureSelection({ topicId: topic.id, kind: action, body: text }).catch(error => this.report(error));
      },
    });
    this.view.setGuideAvailable(false);
    await render(material.files[0]!.name);
  }
}

export default class PithObsidianPlugin extends obsidian.Plugin {
  private controller: PithObsidianController | null = null;

  async onload(): Promise<void> {
    const host = createObsidianHostPort(this.app.vault.adapter, "", new NodeAgentProcessPort());
    const controller = new PithObsidianController(host);
    this.controller = controller;
    try {
      await controller.initialize();
      this.registerView(PITH_VIEW_TYPE, leaf => new PithWorkspaceView(leaf, controller, host));
      const open = (): void => { void this.openView().catch(error => new obsidian.Notice(error instanceof Error ? error.message : String(error))); };
      this.addRibbonIcon("book-open", "打开 Pith", open);
      this.addCommand({ id: "open-pith", name: "打开 Pith", callback: open });
    } catch (error) {
      controller.dispose();
      this.controller = null;
      throw error;
    }
  }

  onunload(): void {
    this.app.workspace.detachLeavesOfType(PITH_VIEW_TYPE);
    if (this.controller) { this.controller.dispose(); this.controller = null; }
  }

  private async openView(): Promise<void> {
    const workspace = this.app.workspace;
    const existing = workspace.getLeavesOfType(PITH_VIEW_TYPE)[0];
    const leaf = existing ?? workspace.getLeaf("tab");
    if (!existing) await leaf.setViewState({ type: PITH_VIEW_TYPE, active: true });
    await workspace.revealLeaf(leaf);
  }
}
