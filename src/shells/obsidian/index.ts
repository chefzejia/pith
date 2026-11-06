import { DefaultAttentionEngine, DefaultWorkspaceStore, MutationQueue, PluginRuntime, type AgentProcessPort, type DojoToolkitDescriptor, type GuideAgentService, type GuideProvider, type HostPort, type InterlineService, type InterlineTranslator, type PluginsConfigFile, type SelectionAnchor, type SpeechAsrService, type SpeechTtsService, type StageTimelineService, type StageReaderService, type StorageEntry, type WorkspaceStoragePort, type ImportMaterialInput } from "../../core/index.ts";
import { lstat, realpath, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { builtinRegistry } from "../../plugins/all.ts";
import { LocalAcpGuideProvider, buildScenePrompt } from "../../plugins/guide-acp/index.ts";
import { practiceMessage } from "../dojoView.ts";
import { NodeAgentProcessPort } from "../web/nodeProcess.ts";
import { NodeHttpPort } from "../web/nodeHttp.ts";
import { obsidianStyles, PithObsidianView, type ObsidianAgentConfig, type ObsidianViewActions } from "./plugin.ts";
import { audioContentType } from "../mediaAssets.ts";
import { migrateLegacySpeech, speechMode, switchSpeechMode, validSpeechProfiles, type SpeechMode, type SpeechProfiles } from "../speechSettings.ts";
import { topicUsesToolkit } from "../toolkitSlot.ts";
import { agentInterlineTranslator, InterlineSession, type InterlineUnitInput } from "../interline.ts";
import { renderAcpSelect } from "../acpSettings.ts";
import { NodeManagedSpeechRuntime } from "../speechRuntime.ts";

interface ObsidianLeaf {
  view?: ObsidianItemViewBase;
  detach(): void;
  setViewState(state: { type: string; active: boolean }): Promise<void>;
}
interface ObsidianWorkspace {
  leftSplit?: { collapse(): void };
  rightSplit?: { collapse(): void; expand(): void };
  getRightLeaf?(split: boolean): ObsidianLeaf | null;
  getLeavesOfType(type: string): ObsidianLeaf[];
  getLeaf(type?: "tab" | boolean): ObsidianLeaf;
  revealLeaf(leaf: ObsidianLeaf): Promise<void>;
  detachLeavesOfType(type: string): void;
}
interface ObsidianPluginBase {
  app: { vault: { adapter: ObsidianVaultAdapter }; workspace: ObsidianWorkspace; secretStorage?: ObsidianSecretStorage; setting?: { open(): void; openTabById(id: string): void } };
  registerView(type: string, factory: (leaf: ObsidianLeaf) => ObsidianItemViewBase): void;
  addRibbonIcon(icon: string, title: string, callback: () => void): HTMLElement;
  addCommand(command: { id: string; name: string; callback: () => void }): void;
  addSettingTab?(tab: ObsidianSettingTabBase): void;
  loadData?(): Promise<unknown>;
  saveData?(data: unknown): Promise<void>;
}
export interface ObsidianSecretStorage { getSecret(id: string): string | null; setSecret(id: string, value: string): void; isEncryptionAvailable?(): boolean }
const secretIds: Record<string, string> = { OPENAI_API_KEY: "pith-openai-api-key", AZURE_SPEECH_KEY: "pith-azure-speech-key" };
export function saveObsidianSecret(storage: ObsidianSecretStorage | undefined, key: string, value: string): void {
  const id = secretIds[key];
  if (!id || typeof process === "undefined" || !["darwin", "win32"].includes(process.platform) || !storage || typeof storage.setSecret !== "function" || typeof storage.isEncryptionAvailable !== "function" || !storage.isEncryptionAvailable()) throw new Error("安全密钥存储不可用，未保存密钥");
  storage.setSecret(id, value);
}
export function createObsidianSecretAccess(getStorage: () => ObsidianSecretStorage | undefined) {
  const session = new Map<string, string>();
  return {
    getSecret(key: string): string | null {
      const current = session.get(key); if (current) return current;
      try { const id = secretIds[key], storage = id ? getStorage() : undefined; const saved = storage && id ? storage.getSecret(id) : null; if (saved) return saved; } catch { /* environment remains available when secret storage fails */ }
      return typeof process !== "undefined" ? process.env[key] ?? null : null;
    },
    setSecret(key: string, value: string): "encrypted" | "session" {
      if (!secretIds[key]) throw new Error("未知密钥");
      try { saveObsidianSecret(getStorage(), key, value); session.delete(key); return "encrypted"; }
      catch { session.set(key, value); return "session"; }
    },
  };
}
type ObsidianSecretAccess = ReturnType<typeof createObsidianSecretAccess>;
interface ObsidianItemViewBase { contentEl: HTMLElement }
interface ObsidianSettingTabBase { containerEl: HTMLElement }
type ObsidianApi = {
  Plugin: new (...args: never[]) => ObsidianPluginBase;
  ItemView: new (leaf: ObsidianLeaf) => ObsidianItemViewBase;
  Notice: new (message: string) => unknown;
  PluginSettingTab?: new (app: ObsidianPluginBase["app"], plugin: ObsidianPluginBase) => ObsidianSettingTabBase;
  FileSystemAdapter?: new (...args: never[]) => ObsidianVaultAdapter;
};
// Obsidian supplies this module at runtime; plain Node imports keep the controller usable.
const obsidian: ObsidianApi = typeof require === "function" ? require("obsidian") as ObsidianApi : {
  Plugin: class { constructor() { throw new Error("Obsidian host required"); } } as unknown as ObsidianApi["Plugin"],
  ItemView: class { constructor() { throw new Error("Obsidian host required"); } } as unknown as ObsidianApi["ItemView"],
  Notice: class { constructor() { throw new Error("Obsidian host required"); } },
};

export interface ObsidianVaultAdapter {
  getFullPath?(path: string): string;
  exists(path: string): Promise<boolean>;
  read(path: string): Promise<string>;
  readBinary(path: string): Promise<ArrayBuffer>;
  write(path: string, data: string): Promise<void>;
  writeBinary(path: string, data: ArrayBuffer): Promise<void>;
  mkdir(path: string): Promise<void>;
  list(path: string): Promise<{ files: string[]; folders: string[] }>;
}

async function assertNoVaultSymlinks(vault: ObsidianVaultAdapter, path: string): Promise<void> {
  if (!vault.getFullPath) return;
  let current = "";
  for (const part of path.split("/")) {
    current = current ? `${current}/${part}` : part;
    try { if ((await lstat(vault.getFullPath(current))).isSymbolicLink()) throw new Error("Symbolic links are not allowed in workspace paths"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
  }
}

export function validateWorkspacePath(value: string): string {
  if (!value || value !== value.trim() || value.includes("\\") || value.includes(":") || value.startsWith("/") || value.split("/").some(part => !part || part === "." || part === "..")) throw new Error("Invalid workspace root");
  return value;
}

export function createObsidianHostPort(vault: ObsidianVaultAdapter, workspacePath = "Pith", processPort?: AgentProcessPort, fileSystem?: ObsidianVaultAdapter, secrets?: ObsidianSecretStorage, secretAccess?: ObsidianSecretAccess): HostPort {
  if (!fileSystem && obsidian.FileSystemAdapter && vault instanceof obsidian.FileSystemAdapter) fileSystem = vault;
  if (fileSystem && fileSystem !== vault) throw new Error("Filesystem adapter must match the vault adapter");
  const root = validateWorkspacePath(workspacePath);
  const path = (value: string): string => {
    if (!value || value.startsWith("/") || value.includes("\\") || value.split("/").some(part => !part || part === "." || part === "..")) throw new Error("Invalid workspace path");
    return `${root}/${value}`;
  };
  const checked = async (value: string): Promise<string> => { const target = path(value); await assertNoVaultSymlinks(vault, target); return target; };
  const create = async (value: string, data: string | Uint8Array): Promise<void> => {
    const target = await checked(value);
    if (!fileSystem || !fileSystem.getFullPath) throw new Error("Atomic exclusive creation requires a filesystem-backed Obsidian adapter");
    const rootReal = await realpath(fileSystem.getFullPath(root));
    const fullTarget = fileSystem.getFullPath(target);
    const parentReal = await realpath(dirname(fullTarget));
    if (parentReal !== rootReal && !parentReal.startsWith(`${rootReal}${sep}`)) {
      throw new Error("Symbolic links are not allowed in workspace paths");
    }
    await writeFile(fullTarget, data, { flag: "wx" });
    try {
      const checkParent = await realpath(dirname(fullTarget));
      if (checkParent !== rootReal && !checkParent.startsWith(`${rootReal}${sep}`)) {
        await unlink(fullTarget).catch(() => {});
        throw new Error("Symbolic links are not allowed in workspace paths");
      }
    } catch (error) {
      await unlink(fullTarget).catch(() => {});
      throw error;
    }
  };
  const ensureRoot = async (): Promise<void> => { let current = ""; for (const part of root.split("/")) { current = current ? `${current}/${part}` : part; await assertNoVaultSymlinks(vault, current); if (!await vault.exists(current)) await vault.mkdir(current); } };
  const storage: WorkspaceStoragePort = {
    mutationIdentity: vault,
    exists: async value => vault.exists(await checked(value)),
    readText: async value => vault.read(await checked(value)),
    readBinary: async value => new Uint8Array(await vault.readBinary(await checked(value))),
    writeText: async (value, data) => vault.write(await checked(value), data),
    createText: (value, data) => create(value, data),
    writeBinary: async (value, data) => vault.writeBinary(await checked(value), new Uint8Array(data).buffer),
    createBinary: (value, data) => create(value, data),
    processText: async (value, update) => { const target = await checked(value); const result = update(await vault.read(target)); await vault.write(target, result); return result; },
    mkdir: async value => { const target = await checked(value); await ensureRoot(); if (!await vault.exists(target)) await vault.mkdir(target); },
    list: async value => {
      const result = await vault.list(await checked(value));
      const relative = (entry: string): string => root && entry.startsWith(`${root}/`) ? entry.slice(root.length + 1) : entry;
      return [...result.folders.map(entry => ({ path: relative(entry), type: "folder" as const })), ...result.files.map(entry => ({ path: relative(entry), type: "file" as const }))] satisfies StorageEntry[];
    },
  };
  const access = secretAccess ?? createObsidianSecretAccess(() => secrets);
  const speechRuntime = processPort && vault.getFullPath ? new NodeManagedSpeechRuntime({ protectedRoot: vault.getFullPath("") }) : undefined;
  return { id: "obsidian", storage, http: new NodeHttpPort(), secrets: { getSecret: key => access.getSecret(key) }, ...(processPort ? { process: processPort } : {}), ...(speechRuntime ? { speechRuntime } : {}) };
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
  readonly guideVisibility = new Map<string, boolean>();
  private readonly host: HostPort;
  private readonly interlineTranslator: InterlineTranslator | undefined;
  private config: PluginsConfigFile = { preset: "all" };
  private persona: "sanctuary" | "studio" = "sanctuary";
  private agentId: ObsidianAgentConfig["agentId"] = "";
  private agentConfigured = false;
  private model = "";
  private effort = "";
  private speechConfig: Record<string, string> = {};
  private speechProfiles: SpeechProfiles = {};
  private topics: Awaited<ReturnType<DefaultWorkspaceStore["listTopics"]>> | null = null;
  private materials: Awaited<ReturnType<DefaultWorkspaceStore["listMaterials"]>> | null = null;
  private readonly views = new Set<PithObsidianView>();

  constructor(host: HostPort, interlineTranslator?: InterlineTranslator) {
    this.host = host;
    this.interlineTranslator = interlineTranslator;
    this.store = new DefaultWorkspaceStore(host.storage);
    let provider: GuideProvider | undefined;
    this.engine = new DefaultAttentionEngine(this.store, host.storage, () => this.agentId ? provider : undefined);
    const manifests = builtinRegistry.list().map(manifest => {
      if (!["stage-reader", "stage-timeline", "dojo-shadowing", "dojo-feynman", "dojo-interline"].includes(manifest.id)) return manifest;
      return { ...manifest, inUse: () => {
        if (!this.topics || !this.materials) throw new Error("Workspace snapshot unavailable");
        if (manifest.id === "stage-reader") return this.materials.filter(item => item.kind === "book" || item.kind === "article").length;
        if (manifest.id === "stage-timeline") return this.materials.filter(item => item.kind === "media").length;
        const id = manifest.id.slice("dojo-".length);
        return this.topics.filter(topic => topicUsesToolkit(topic, this.materials!, id)).length;
      } };
    });
    this.runtime = new PluginRuntime(manifests, { host, store: this.store, engine: this.engine, window: {} });
    if (host.process) provider = new LocalAcpGuideProvider({ processPort: host.process, store: this.store, getAgentConfig: () => ({ agentId: this.agentId, model: this.model, effort: this.effort }), resolveDescriptor: async id => (await this.detectAgents()).find(item => item.id === id) ?? null, buildScenePrompt });
  }
  async initialize(): Promise<void> {
    await this.store.ensureScaffold();
    if (await this.host.storage.exists("_cache/web-settings.json")) {
      const data: unknown = JSON.parse(await this.host.storage.readText("_cache/web-settings.json"));
      if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Invalid settings");
      const value = data as { preset?: unknown; persona?: unknown; plugins?: unknown; agentId?: unknown; agentConfigured?: unknown; model?: unknown; effort?: unknown; speech?: unknown; speechProfiles?: unknown; speechSettingsVersion?: unknown };
      if (value.agentConfigured !== undefined && typeof value.agentConfigured !== "boolean") throw new Error("Invalid agent configuration state");
      if ((value.preset !== "all" && value.preset !== "essentials") || (value.persona !== "sanctuary" && value.persona !== "studio") || !value.plugins || typeof value.plugins !== "object" || Array.isArray(value.plugins) || (value.agentId !== undefined && (typeof value.agentId !== "string" || !["", "dsh", "claude", "codex"].includes(value.agentId))) || (value.model !== undefined && typeof value.model !== "string") || (value.effort !== undefined && typeof value.effort !== "string")) throw new Error("Invalid settings");
      this.persona = value.persona;
      this.agentId = (value.agentId ?? "") as ObsidianAgentConfig["agentId"];
      this.agentConfigured = value.agentConfigured ?? value.agentId !== undefined;
      this.model = (value.model ?? "") as string;
      this.effort = (value.effort ?? "") as string;
      if (value.speechSettingsVersion !== undefined && value.speechSettingsVersion !== 1) throw new Error("Invalid speech settings version");
      if (value.speech !== undefined) { if (!value.speech || typeof value.speech !== "object" || Array.isArray(value.speech) || Object.values(value.speech).some(item => typeof item !== "string")) throw new Error("Invalid speech settings"); this.speechConfig = migrateLegacySpeech(value.speech as Record<string, string>, value.speechSettingsVersion, value.speechProfiles); }
      if (value.speechProfiles !== undefined) { if (!validSpeechProfiles(value.speechProfiles)) throw new Error("Invalid speech profiles"); this.speechProfiles = value.speechProfiles; }
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
      this.runtime.reconcile(config);
    }
  }
  private async save(fields: Partial<ObsidianAgentConfig> & { preset?: PluginsConfigFile["preset"]; plugins?: PluginsConfigFile["plugins"]; speech?: Record<string, string>; speechProfiles?: SpeechProfiles; speechSettingsVersion?: 1 }): Promise<void> {
    await MutationQueue.forStorage(this.host.storage).run(async () => {
      await this.host.storage.mkdir("_cache");
      const path = "_cache/web-settings.json";
      const saved: unknown = await this.host.storage.exists(path) ? JSON.parse(await this.host.storage.readText(path)) : {};
      if (!saved || typeof saved !== "object" || Array.isArray(saved)) throw new Error("Invalid settings");
      await this.host.storage.writeText(path, `${JSON.stringify({ preset: "all", persona: "sanctuary", plugins: {}, agentId: "", model: "", effort: "", ...saved, ...fields, agentConfigured: this.agentConfigured }, null, 2)}\n`);
    });
  }
  async openCompass() { await this.refresh(); return this.engine.compass(); }
  async openTopic(id: string) { return this.store.getTopic(id); }
  createInterlineSession(materialId: string, file: string, units: readonly InterlineUnitInput[]): InterlineSession {
    const service = this.runtime.getService<InterlineService>("dojo.interline");
    if (!service) throw new Error("行间双语工具不可用");
    const process = this.host.process;
    const translator = this.interlineTranslator ?? (process ? agentInterlineTranslator({ process, resolveAgent: async () => {
      if (!this.agentId) throw new Error("请先配置向导 Agent");
      const descriptor = (await this.detectAgents()).find(item => item.id === this.agentId);
      if (!descriptor || !descriptor.available) throw new Error("向导 Agent 不可用");
      return { descriptor, model: this.model, effort: this.effort };
    } }) : async () => { throw new Error("请先配置向导 Agent"); });
    return new InterlineSession(service, this.host.storage, translator, materialId, file, units);
  }
  async importMaterial(input: ImportMaterialInput, topicId?: string) { if (topicId) { const topic = await this.store.getTopic(topicId); if (!topic) throw new Error("Topic not found"); if (topic.materialId) throw new Error("课题已有材料，无法替换"); } const material = await this.store.importMaterial(input); if (topicId) await this.store.updateTopic(topicId, { materialId: material.id }); await this.refresh(); return material; }
  async setSpeechConfig(config: Record<string, string>): Promise<void> {
    if (Object.entries(config).some(([key, value]) => !["ttsProvider", "ttsEndpoint", "ttsModel", "ttsVoice", "azureRegion", "asrProvider", "asrLoopbackUrl", "asrModel"].includes(key) || typeof value !== "string")) throw new Error("Invalid speech settings");
    this.speechConfig = { ...config }; await this.refresh(); await this.save({ speech: this.speechConfig, speechSettingsVersion: 1 });
  }
  async setSpeechMode(mode: SpeechMode): Promise<void> {
    const next = switchSpeechMode(this.speechConfig, this.speechProfiles, mode);
    this.speechConfig = next.speech; this.speechProfiles = next.profiles;
    await this.refresh(); await this.save({ speech: this.speechConfig, speechProfiles: this.speechProfiles, speechSettingsVersion: 1 });
  }
  async readAudioAsset(materialId: string, name: string): Promise<Uint8Array> { const material = await this.store.getMaterial(materialId); const entry = material && material.files.find(file => file.name === name); if (!entry || !audioContentType(entry)) throw new Error("音频文件不存在"); return this.host.storage.readBinary(`materials/${materialId}/files/${entry.name}`); }
  async renderMaterialFile(materialId: string, name: string) {
    const material = await this.store.getMaterial(materialId); const file = material && material.files.find(entry => entry.name === name);
    if (!material || !file) throw new Error("材料文件不存在");
    const bytes = await this.host.storage.readBinary(`materials/${material.id}/files/${file.name}`);
    if (/\.(vtt|srt)$/i.test(name) || audioContentType(file) || file.mimeType.startsWith("video/")) {
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
  async probeAgentOptions(id: string, force = false) { const guide = this.runtime.getService<GuideAgentService>("guide.agent"); if (!guide || !guide.probeAgentOptions) throw new Error("Guide service unavailable"); return guide.probeAgentOptions(id, force); }
  async setAgentConfig(config: ObsidianAgentConfig): Promise<void> {
    if (!["", "dsh", "claude", "codex"].includes(config.agentId) || typeof config.model !== "string" || typeof config.effort !== "string" || (config.persona !== "sanctuary" && config.persona !== "studio")) throw new Error("Invalid agent config");
    this.agentId = config.agentId; this.agentConfigured = true; this.model = config.model; this.effort = config.effort; this.persona = config.persona;
    await this.refresh(); await this.save(config);
  }
  async setPlugins(config: PluginsConfigFile): Promise<void> { this.config = config; await this.refresh(); const available = this.runtime.statuses().some(plugin => plugin.id === "guide-acp" && plugin.state === "active"); for (const view of this.views) view.setGuideAvailable(available); await this.save({ preset: config.preset ?? "all", plugins: config.plugins ?? {} }); }
  getPersona(): "sanctuary" | "studio" { return this.persona; }
  getAgentConfig(): ObsidianAgentConfig { return { agentId: this.agentId, model: this.model, effort: this.effort, persona: this.persona }; }
  isAgentConfigured(): boolean { return this.agentConfigured; }
  getSpeechConfig(): Record<string, string> { return { ...this.speechConfig }; }
  async speechRuntimeState() { return this.host.speechRuntime ? this.host.speechRuntime.getState() : { supported: false, status: "not-installed" as const, note: "本宿主不支持托管本机语音" }; }
  async speechRuntimeAction(action: "install" | "ensureRunning" | "stop" | "remove") { const runtime = this.host.speechRuntime; if (!runtime || !runtime[action]) throw new Error("本宿主不支持该操作"); return runtime[action](); }
  createView(root: HTMLElement, actions: ObsidianViewActions): PithObsidianView {
    const view = new PithObsidianView(root, actions);
    view.setGuideAvailable(this.runtime.statuses().some(plugin => plugin.id === "guide-acp" && plugin.state === "active"));
    this.views.add(view);
    return view;
  }
  releaseView(view: PithObsidianView): void { if (this.views.delete(view)) view.dispose(); }
  dispose(): void { for (const view of this.views) view.dispose(); this.views.clear(); this.runtime.stop(); if (this.host.speechRuntime && this.host.speechRuntime.stop) void this.host.speechRuntime.stop().catch(error => console.error("Speech runtime stop failed:", error)); }
}

const PITH_VIEW_TYPE = "pith-reader";
export const PITH_GUIDE_VIEW_TYPE = "pith-guide";

export class PithGuideView extends obsidian.ItemView {
  private closeHandler: (() => void) | null = null;
  getViewType(): string { return PITH_GUIDE_VIEW_TYPE; }
  getDisplayText(): string { return "Pith 向导"; }
  getIcon(): string { return "help-circle"; }
  mount(element: HTMLElement, closeHandler?: () => void): void { if (this.contentEl.firstChild !== element && this.closeHandler) this.closeHandler(); this.closeHandler = closeHandler ?? null; this.contentEl.replaceChildren(element); }
  async onClose(): Promise<void> { const close = this.closeHandler; this.closeHandler = null; if (close) close(); }
}

export class PithWorkspaceView extends obsidian.ItemView {
  private view: PithObsidianView | null = null;
  private generation = 0;
  private homeRequest = 0;
  private guideRequest = 0;
  private guideDesiredVisible = false;
  private guideOpening: Promise<ObsidianLeaf> | null = null;
  private guideOpeningLeaf: ObsidianLeaf | null = null;
  private readonly controller: PithObsidianController;
  private readonly workspace: ObsidianWorkspace | undefined;
  private readonly guideByTopic: Map<string, boolean>;
  private readonly openSettings: (() => void) | undefined;
  constructor(leaf: ObsidianLeaf, controller: PithObsidianController, _host: HostPort, workspace?: ObsidianWorkspace, openSettings?: () => void) { super(leaf); this.controller = controller; this.workspace = workspace; this.guideByTopic = controller.guideVisibility; this.openSettings = openSettings; }
  getViewType(): string { return PITH_VIEW_TYPE; }
  getDisplayText(): string { return "Pith"; }
  getIcon(): string { return "sprout"; }

  async onOpen(): Promise<void> {
    if (this.workspace && this.workspace.leftSplit) this.workspace.leftSplit.collapse();
    const previousGeneration = this.generation, request = ++this.homeRequest;
    const compass = await this.controller.openCompass();
    if (previousGeneration !== this.generation || request !== this.homeRequest) return;
    const generation = ++this.generation;
    if (this.view) { this.controller.releaseView(this.view); this.view = null; }
    const root = this.contentEl, doc = root.ownerDocument;
    const escape = (s: string): string => s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
    root.classList.add("pith-view");
    root.innerHTML = `<style>${obsidianStyles}</style><header class="pith-view-header"><strong>Pith</strong></header><div class="pith-home-scroll"><main class="pith-home"><h1>注意力罗盘</h1><div class="pith-home-actions"><button data-home-new>新建课题</button><button data-home-import>导入材料</button><input type="file" accept=".epub,.pdf,.cbz,.md,.markdown" multiple hidden></div><form class="pith-home-form" hidden><label>课题名称<input name="title" required></label><label>探索目标<input name="target"></label><label>下一步行动<input name="nextAction"></label><button>创建课题</button></form><div class="pith-home-status" role="status"></div><section class="pith-focus">${compass.focusRecommendation ? `<div><span class="pith-topic-status">下一步 · 15 分钟</span><br><strong>${escape(compass.focusRecommendation.nextAction)}</strong><br>${escape(compass.focusRecommendation.title)}</div><button data-topic="${escape(compass.focusRecommendation.topicId)}">继续探索</button>` : "选择一个课题，开始今天的探索。"}</section>${[["探索中", compass.exploring], ["已沉淀", compass.settled]].map(([label, topics]) => `<section><div class="pith-home-heading"><h2>${label}</h2><span>${(topics as typeof compass.exploring).length}</span></div><div class="pith-topic-grid">${(topics as typeof compass.exploring).map(topic => `<button class="pith-topic-card" data-topic="${escape(topic.id)}"><span class="pith-topic-status ${topic.status === "settled" ? "settled" : ""}">${label}</span><strong>${escape(topic.title)}</strong><span>${escape(topic.nextAction || topic.target || "尚未设置下一步")}</span></button>`).join("")}</div></section>`).join("")}</main></div>`;
    const input = root.querySelector<HTMLInputElement>('input[type="file"]');
    const form = root.querySelector<HTMLFormElement>("form");
    const status = root.querySelector<HTMLElement>(".pith-home-status");
    if (!input || !form || !status) throw new Error("首页初始化失败");
    let importTopic: string | undefined;
    root.querySelector<HTMLButtonElement>("[data-home-new]")!.onclick = () => { form.hidden = !form.hidden; };
    root.querySelector<HTMLButtonElement>("[data-home-import]")!.onclick = () => { importTopic = undefined; input.click(); };
    for (const button of root.querySelectorAll<HTMLButtonElement>("[data-topic]")) button.onclick = () => { const id = button.dataset.topic; if (!id) return; void (async () => { const topic = await this.controller.openTopic(id); if (generation !== this.generation) return; if (!topic) throw new Error("课题不存在"); if (!topic.materialId) { importTopic = id; status.textContent = "选择材料以打开此课题"; input.click(); return; } await this.openTopic(id); })().catch(error => this.report(error)); };
    form.onsubmit = event => { event.preventDefault(); void (async () => { const data = new FormData(form); const title = String(data.get("title") || "").trim(); if (!title) throw new Error("请输入课题名称"); await this.controller.store.createTopic({ title, target: String(data.get("target") || ""), nextAction: String(data.get("nextAction") || "") }); if (generation === this.generation) await this.onOpen(); })().catch(error => this.report(error)); };
    input.onchange = () => { void (async () => { const files = Array.from(input.files || []); if (!files.length) return; if (files.some(file => !/\.(epub|pdf|cbz|md|markdown)$/i.test(file.name))) throw new Error("仅支持 EPUB、PDF、CBZ 和 Markdown 文件"); const entries = await Promise.all(files.map(async file => ({ name: file.name, mimeType: file.type || "application/octet-stream", bytes: new Uint8Array(await file.arrayBuffer()) }))); if (generation !== this.generation) return; const first = files[0]!; const kind = files.some(file => /\.(epub|pdf|cbz)$/i.test(file.name)) ? "book" : "article"; const material = await this.controller.importMaterial({ title: first.name, kind, files: entries }, importTopic); if (!importTopic) { const topic = await this.controller.store.createTopic({ title: first.name.replace(/\.[^.]+$/, ""), materialId: material.id }); importTopic = topic.id; } if (generation === this.generation) await this.openTopic(importTopic); })().catch(error => this.report(error)).finally(() => { input.value = ""; }); };
  }

  async onClose(): Promise<void> { this.generation++; if (this.view) { this.controller.releaseView(this.view); this.view = null; } }

  private report(error: unknown): void { new obsidian.Notice(error instanceof Error ? error.message : String(error)); }
  private async showNativeGuide(visible: boolean, view: PithObsidianView, topicId?: string): Promise<void> {
    const workspace = this.workspace;
    if (!workspace || !workspace.rightSplit || !workspace.getRightLeaf) throw new Error("宿主右侧边栏不可用");
    const request = ++this.guideRequest;
    this.guideDesiredVisible = visible;
    if (!visible) { for (const leaf of workspace.getLeavesOfType(PITH_GUIDE_VIEW_TYPE)) if (leaf !== this.guideOpeningLeaf) leaf.detach(); return; }
    let leaf = this.guideOpening ? undefined : workspace.getLeavesOfType(PITH_GUIDE_VIEW_TYPE)[0];
    let created = false;
    if (!leaf) {
      if (!this.guideOpening) { const right = workspace.getRightLeaf(false); if (!right) throw new Error("无法打开右侧边栏"); created = true; this.guideOpeningLeaf = right; this.guideOpening = right.setViewState({ type: PITH_GUIDE_VIEW_TYPE, active: true }).then(() => right); }
      const opening = this.guideOpening;
      try { leaf = await opening; } catch (error) { if (created && !this.guideDesiredVisible && this.guideOpeningLeaf && this.guideOpeningLeaf.view instanceof PithGuideView) this.guideOpeningLeaf.detach(); throw error; } finally { if (this.guideOpening === opening) { this.guideOpening = null; this.guideOpeningLeaf = null; } }
    }
    if (this.view !== view || request !== this.guideRequest) { if (created && (request === this.guideRequest || !this.guideDesiredVisible) && leaf.view instanceof PithGuideView) leaf.detach(); return; }
    if (!(leaf.view instanceof PithGuideView)) throw new Error("向导视图未就绪");
    leaf.view.mount(view.guideElement(), () => { if (this.view === view) { view.setGuideVisible(false); if (topicId) this.guideByTopic.set(topicId, false); } });
    workspace.rightSplit.expand();
    await workspace.revealLeaf(leaf);
    if (this.view === view && request === this.guideRequest) view.focusQuotedGuide();
  }
  private async openTopic(id: string): Promise<void> {
    const generation = ++this.generation;
    const topic = await this.controller.openTopic(id);
    if (generation !== this.generation) return;
    if (!topic || !topic.materialId) throw new Error("课题没有关联材料");
    const material = await this.controller.store.getMaterial(topic.materialId);
    if (generation !== this.generation) return;
    if (!material || !material.files.length) throw new Error("材料没有可读取的文件");
    let currentFile = material.files[0]!.name;
    let interlineSession: { file: string; signature: string; session: InterlineSession } | undefined;
    let renderGeneration = 0;
    const dojos = (): DojoToolkitDescriptor[] => ["shadowing", "feynman", "interline"].flatMap(id => { const service = this.controller.runtime.getService<DojoToolkitDescriptor>(`dojo.${id}`); return service ? [service] : []; });
    const render = async (name: string): Promise<void> => {
      const request = ++renderGeneration;
      const document = await this.controller.renderMaterialFile(material.id, name);
      if (generation === this.generation && request === renderGeneration && this.view) { currentFile = name; this.view.render({ title: topic.title, html: document.html, files: material.files, currentFile: name, sections: document.sections, ...("format" in document ? { format: document.format } : {}) }); }
    };
    if (this.view) this.controller.releaseView(this.view);
    let originatingView: PithObsidianView;
    originatingView = this.controller.createView(this.contentEl, {
      guideVisibilityChanged: visible => { this.guideByTopic.set(topic.id, visible); if (this.workspace) void this.showNativeGuide(visible, originatingView, topic.id).catch(error => this.report(error)); },
      home: () => this.onOpen(),
      openSettings: () => { if (!this.openSettings) throw new Error("设置面板不可用"); this.openSettings(); },
      openFile: render,
      loadAudio: name => this.controller.readAudioAsset(material.id, name),
      transcribeAudio: async (bytes, mimeType, signal) => { const asr = this.controller.runtime.getService<SpeechAsrService>("speech.asr"); if (!asr || !asr.transcribeAudio) throw new Error("请先在设置中配置语音识别服务"); return asr.transcribeAudio(bytes, mimeType, signal); },
      prepareInterline: async (units, index, mode) => { const current = await this.controller.store.getTopic(topic.id); if (!current || current.materialId !== material.id || !topicUsesToolkit(current, [], "interline")) throw new Error("行间双语未挂载"); if (generation !== this.generation || this.view !== originatingView) throw new Error("课题已切换"); const signature = JSON.stringify(units); if (!interlineSession || interlineSession.file !== currentFile || interlineSession.signature !== signature) interlineSession = { file: currentFile, signature, session: this.controller.createInterlineSession(material.id, currentFile, units) }; return interlineSession.session.render(index, mode); },
      synthesizeSpeech: async (text, signal) => { const tts = this.controller.runtime.getService<SpeechTtsService>("speech.tts"); if (!tts || !tts.synthesizeSpeech) throw new Error("未连接可用的语音服务，请先启动本地语音服务或在设置中配置云端 TTS"); try { return await tts.synthesizeSpeech(text, signal); } catch (error) { throw new Error("未连接可用的语音服务，请先启动本地语音服务或在设置中配置云端 TTS", { cause: error }); } },
      openDojo: (text, locator) => { if (this.view) this.view.openDojo(dojos(), text, { file: currentFile, locator: locator || "text:offset:0", quote: text }); },
      selection: (action, text, locator) => { const anchor = { file: currentFile, locator: locator || "text:offset:0", quote: text }; if (action === "ask" || action === "note") { if (this.view) this.view.quoteSelection(anchor, action === "ask" ? "chat" : "notes"); return; } void this.controller.engine.captureSelection({ topicId: topic.id, kind: action, body: text, anchor }).then(async () => { if (this.view) await this.view.refreshGuide(); }).catch(error => this.report(error)); },
      guideData: async () => { await this.controller.openCompass(); const updated = await this.controller.store.getTopic(topic.id); if (!updated) throw new Error("课题不存在"); const guide = this.controller.runtime.getService<GuideAgentService>("guide.agent"); return { notes: updated.notes, toolkits: updated.toolkits, conversation: await this.controller.engine.getConversation(topic.id), actions: guide && guide.quickActionsForTopic ? guide.quickActionsForTopic(updated, dojos()) : [] }; },
      sendGuide: async (text, anchor, saveAsNote) => { await this.controller.engine.sendMessage({ topicId: topic.id, text, anchor, saveAsNote }); },
      savePractice: async (body, anchor) => { await this.controller.engine.captureSelection({ topicId: topic.id, kind: "practice", body, anchor }); },
      submitPractice: async (body, anchor, toolkit) => {
        if (!toolkit.evaluationRubric || toolkit.evalMode !== "guide-rubric") throw new Error("实训评价规程不可用");
        await this.controller.engine.captureSelection({ topicId: topic.id, kind: "practice", body, anchor });
        if (!this.controller.getAgentConfig().agentId) return { guided: false };
        try { await this.controller.engine.sendMessage({ topicId: topic.id, text: practiceMessage(body, toolkit.label, toolkit.evaluationRubric), anchor }); return { guided: true }; }
        catch (error) { return { guided: false, guideError: error instanceof Error ? error.message : String(error) }; }
      },
      mountDojo: async id => { const current = await this.controller.store.getTopic(topic.id); if (generation !== this.generation || this.view !== originatingView) throw new Error("课题已切换"); if (!current) throw new Error("课题不存在"); const updated = current.toolkits.includes(id) || current.toolkits.includes(`dojo-${id}`) ? current : await this.controller.store.updateTopic(topic.id, { toolkits: [...current.toolkits.filter(item => item !== "none"), id] }); if (generation !== this.generation || this.view !== originatingView) throw new Error("课题已切换"); originatingView.setToolkits(updated.toolkits); },
    });
    this.view = originatingView;
    const guideVisible = this.guideByTopic.get(topic.id) ?? false;
    this.view.setGuideVisible(guideVisible);
    if (this.workspace) await this.showNativeGuide(guideVisible, this.view, topic.id);
    this.view.setToolkits(topic.toolkits);
    await render(material.files[0]!.name);
    if (generation === this.generation && this.view) await this.view.refreshGuide();
  }
}

const SettingTabBase = obsidian.PluginSettingTab || class { containerEl!: HTMLElement; constructor(_app: ObsidianPluginBase["app"], _plugin: ObsidianPluginBase) {} };
export class PithSettingTab extends SettingTabBase {
  private readonly controller: PithObsidianController;
  private readonly plugin: PithObsidianPlugin;
  private pending = Promise.resolve();
  private agentIntent: ObsidianAgentConfig["agentId"] | undefined;
  constructor(app: ObsidianPluginBase["app"], plugin: PithObsidianPlugin, controller: PithObsidianController) { super(app, plugin); this.plugin = plugin; this.controller = controller; }
  display(): void {
    const root = this.containerEl; root.replaceChildren(); const doc = root.ownerDocument;
    const styles = doc.createElement("style"); styles.textContent = ".pith-setting-row{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:10px 0;border-bottom:1px solid var(--background-modifier-border)}.pith-setting-row input,.pith-setting-row select{max-width:55%}"; root.append(styles);
    const heading = (text: string) => { const node = doc.createElement("h3"); node.textContent = text; root.append(node); };
    const row = (parent: HTMLElement, label: string, control: HTMLElement) => { const node = doc.createElement("label"); node.className = "pith-setting-row"; node.textContent = label; node.append(control); parent.append(node); return node; };
    const select = (options: readonly (readonly [string, string])[], value: string) => { const node = doc.createElement("select"); for (const [id, label] of options) { const option = doc.createElement("option"); option.value = id; option.textContent = label; node.append(option); } node.value = value; return node; };
    const input = (parent: HTMLElement, label: string, value: string) => { const node = doc.createElement("input"); node.value = value; row(parent, label, node); return node; };
    const status = doc.createElement("p"); status.setAttribute("role", "status");
    const enqueue = (operation: () => Promise<void>) => { this.pending = this.pending.then(operation).catch(error => { status.textContent = String(error); }); return this.pending; };
    heading("工作区与向导 Agent");
    const path = input(root, "Pith 数据目录（相对于 Vault）", this.plugin.getWorkspacePath());
    path.addEventListener("change", () => { const value = path.value; void enqueue(async () => { validateWorkspacePath(value); const changed = await this.plugin.setWorkspacePath(value); status.textContent = changed ? "目录已保存，重载插件后生效" : "设置已保存"; }); });
    const config = this.controller.getAgentConfig();
    const agent = select([...(this.controller.isAgentConfigured() ? [] : [["unconfigured", "未配置"] as const]), ["", "离线"], ["dsh", "dsh"], ["claude", "claude"], ["codex", "codex"]], this.agentIntent !== undefined ? this.agentIntent : this.controller.isAgentConfigured() ? config.agentId : "unconfigured"); const agentRow = row(root, "本机 Agent", agent);
    const unconfigured = agent.querySelector<HTMLOptionElement>('option[value="unconfigured"]'); if (unconfigured) unconfigured.disabled = true;
    const scan = doc.createElement("button"); scan.textContent = "重新检测"; scan.type = "button"; agentRow.append(scan);
    const model = select([], ""), effort = select([], ""); row(root, "模型（Model）", model); row(root, "推理强度（Effort）", effort);
    const persona = select([["sanctuary", "花园 / 园丁"], ["studio", "工作区 / 向导"]], config.persona); row(root, "术语风格", persona);
    const saveAgent = () => { const agentId = agent.value as ObsidianAgentConfig["agentId"], value = persona.value as ObsidianAgentConfig["persona"]; void enqueue(async () => { await this.controller.setAgentConfig({ ...this.controller.getAgentConfig(), agentId, persona: value }); status.textContent = "设置已保存"; }); };
    let probeGeneration = 0;
    const probe = (force = false) => { const id = agent.value, generation = ++probeGeneration; model.disabled = !id || id === "unconfigured"; effort.disabled = true; const current = this.controller.getAgentConfig(); renderAcpSelect(model, undefined, current.model); renderAcpSelect(effort, undefined, current.effort); if (model.disabled) return; void this.controller.probeAgentOptions(id, force).then(options => { if (generation !== probeGeneration || !root.contains(agent) || agent.value !== id) return; renderAcpSelect(model, options.find(item => item.id === "model"), model.value); renderAcpSelect(effort, options.find(item => item.id === "reasoning_effort" || item.id === "effort" || item.category === "thought_level"), effort.value); effort.disabled = false; }).catch(error => { if (generation === probeGeneration && root.contains(agent)) status.textContent = error instanceof Error ? error.message : String(error); }); };
    const saveOption = (name: "model" | "effort", value: string) => { void enqueue(async () => { await this.controller.setAgentConfig({ ...this.controller.getAgentConfig(), [name]: value }); status.textContent = "设置已保存"; }); };
    model.addEventListener("change", () => saveOption("model", model.value)); effort.addEventListener("change", () => saveOption("effort", effort.value));
    agent.addEventListener("change", () => { this.agentIntent = agent.value as ObsidianAgentConfig["agentId"]; saveAgent(); probe(); }); persona.addEventListener("change", () => { const value = persona.value as ObsidianAgentConfig["persona"]; void enqueue(async () => { await this.controller.setPersona(value); status.textContent = "设置已保存"; }); });
    const detect = () => { scan.disabled = true; void this.controller.detectAgents(true).then(agents => { const available = ["dsh", "claude", "codex"].map(id => agents.find(item => item.id === id && item.available)).find(Boolean); if (this.agentIntent === undefined && root.contains(agent) && !this.controller.isAgentConfigured() && available) { agent.value = available.id; saveAgent(); probe(); } else if (!available) status.textContent = "未发现可用 Agent"; }).catch(error => { status.textContent = String(error); }).finally(() => { scan.disabled = false; }); }; scan.onclick = () => { detect(); probe(true); };
    heading("语音服务"); const speech = this.controller.getSpeechConfig();
    const currentMode = speechMode(speech);
    const mode = select([...(currentMode === "legacy" ? [["legacy", "现有旧配置（保留）"] as const] : []), ["local", "本机语音服务（免配置自动连接）"], ["cloud", "云端语音服务（OpenAI 标准协议）"]], currentMode); row(root, "语音服务模式", mode);
    const runtimePanel = doc.createElement("div"), runtimeStatus = doc.createElement("p"); runtimePanel.append(runtimeStatus); root.append(runtimePanel);
    const runtimeButtons = ([['install', '安装/启用本机语音引擎'], ['ensureRunning', '启动/检测'], ['stop', '释放'], ['remove', '卸载引擎']] as const).map(([action, label]) => { const button = doc.createElement("button"); button.type = "button"; button.textContent = label; button.onclick = () => { for (const item of runtimeButtons) item.disabled = true; runtimeStatus.textContent = action === "install" ? "正在安装本机语音引擎" : "处理中"; void this.controller.speechRuntimeAction(action).then(state => { runtimeStatus.textContent = state.note; }).catch(error => { runtimeStatus.textContent = String(error); }).finally(() => { for (const item of runtimeButtons) item.disabled = false; }); }; runtimePanel.append(button); return button; });
    void this.controller.speechRuntimeState().then(state => { if (root.contains(runtimePanel)) { runtimeStatus.textContent = state.note; if (!state.supported) for (const item of runtimeButtons) item.disabled = true; } }).catch(error => { if (root.contains(runtimePanel)) runtimeStatus.textContent = String(error); });
    if (currentMode === "legacy") { const legacy = mode.querySelector<HTMLOptionElement>('option[value="legacy"]'); if (legacy) legacy.disabled = true; status.textContent = "现有语音配置保持不变；选择模式可切换标准协议"; }
    const key = input(root, "API Key", ""); key.type = "password"; key.autocomplete = "new-password"; const keyRow = key.parentElement!;
    const health = doc.createElement("button"); health.textContent = "检测连接"; health.type = "button"; root.append(health);
    const details = doc.createElement("details"), summary = doc.createElement("summary"); summary.textContent = "高级自定义端点与模型（可选）"; details.append(summary); root.append(details);
    const fields = [["ttsEndpoint", "TTS 端点 URL"], ["ttsModel", "TTS 模型"], ["ttsVoice", "音色"], ["asrLoopbackUrl", "ASR 端点 URL"], ["asrModel", "ASR 模型"]] as const;
    const controls = new Map<string, HTMLInputElement>();
    for (const [name, label] of fields) { const control = input(details, label, speech[name] || ""); controls.set(name, control); control.addEventListener("change", () => { const value = control.value; void enqueue(async () => { await this.controller.setSpeechConfig({ ...this.controller.getSpeechConfig(), [name]: value }); status.textContent = "设置已保存"; }); }); }
    const visibility = () => { keyRow.hidden = mode.value !== "cloud"; health.hidden = mode.value !== "cloud"; runtimePanel.hidden = mode.value !== "local"; }; visibility();
    mode.addEventListener("change", () => { visibility(); const selected = mode.value as SpeechMode; void enqueue(async () => { await this.controller.setSpeechMode(selected); if (mode.value === selected) { const current = this.controller.getSpeechConfig(); for (const [name, control] of controls) control.value = current[name] || ""; } status.textContent = "设置已保存"; }); });
    key.addEventListener("change", () => { try { if (key.value) { const result = this.plugin.saveSpeechSecret(key.value); key.value = ""; status.textContent = result === "encrypted" ? "密钥已保存" : "密钥仅保存在本次运行的内存中，重启后需重新配置"; } } catch (error) { status.textContent = String(error); } });
    health.onclick = () => { health.disabled = true; void this.pending.then(async () => { const tts = this.controller.runtime.getService<SpeechTtsService>("speech.tts"), asr = this.controller.runtime.getService<SpeechAsrService>("speech.asr"); const check = async (service: SpeechTtsService | SpeechAsrService | undefined) => { if (!service || !service.checkHealth) return "未验证：服务不可用"; const result = await service.checkHealth(); return `${result.status === "verified" ? "已验证" : result.status === "failed" ? "不可用" : "未验证"}：${result.note}`; }; status.textContent = `TTS ${await check(tts)}；ASR ${await check(asr)}`; }).catch(error => { status.textContent = String(error); }).finally(() => { health.disabled = false; }); };
    root.append(status); detect(); probe();
  }
}

export default class PithObsidianPlugin extends obsidian.Plugin {
  private readonly secretAccess = createObsidianSecretAccess(() => this.app.secretStorage);
  saveSpeechSecret(value: string): "encrypted" | "session" { return this.secretAccess.setSecret("OPENAI_API_KEY", value); }
  private controller: PithObsidianController | null = null;
  private workspacePath = "Pith";
  private pluginData: Record<string, unknown> = {};

  getWorkspacePath(): string { return this.workspacePath; }
  async setWorkspacePath(value: string): Promise<boolean> {
    const path = validateWorkspacePath(value);
    if (path === this.workspacePath) return false;
    if (!this.saveData) throw new Error("无法保存工作区路径");
    let current = "";
    for (const part of path.split("/")) { current = current ? `${current}/${part}` : part; await assertNoVaultSymlinks(this.app.vault.adapter, current); if (await this.app.vault.adapter.exists(current)) await this.app.vault.adapter.list(current); }
    const next = { ...this.pluginData, workspacePath: path };
    await this.saveData(next);
    this.pluginData = next;
    this.workspacePath = path;
    return true;
  }

  async onload(): Promise<void> {
    const saved = this.loadData ? await this.loadData() : null;
    if (saved !== null && (typeof saved !== "object" || Array.isArray(saved))) throw new Error("Invalid plugin settings");
    this.pluginData = saved ? { ...saved as Record<string, unknown> } : {};
    const configured = saved && "workspacePath" in saved ? (saved as { workspacePath: unknown }).workspacePath : "Pith";
    if (typeof configured !== "string") throw new Error("Invalid workspace root");
    this.workspacePath = validateWorkspacePath(configured);
    const host = createObsidianHostPort(this.app.vault.adapter, this.workspacePath, new NodeAgentProcessPort(), undefined, undefined, this.secretAccess);
    const controller = new PithObsidianController(host);
    this.controller = controller;
    try {
      await controller.initialize();
      this.registerView(PITH_VIEW_TYPE, leaf => new PithWorkspaceView(leaf, controller, host, this.app.workspace, () => { const setting = this.app.setting; if (!setting) throw new Error("设置面板不可用"); setting.open(); setting.openTabById("pith"); }));
      this.registerView(PITH_GUIDE_VIEW_TYPE, leaf => new PithGuideView(leaf));
      if (this.addSettingTab && obsidian.PluginSettingTab) this.addSettingTab(new PithSettingTab(this.app, this, controller));
      const open = (): void => { void this.openView().catch(error => new obsidian.Notice(error instanceof Error ? error.message : String(error))); };
      this.addRibbonIcon("sprout", "打开 Pith", open);
      this.addCommand({ id: "open-pith", name: "打开 Pith", callback: open });
    } catch (error) {
      controller.dispose();
      this.controller = null;
      throw error;
    }
  }

  onunload(): void {
    this.app.workspace.detachLeavesOfType(PITH_VIEW_TYPE);
    this.app.workspace.detachLeavesOfType(PITH_GUIDE_VIEW_TYPE);
    if (this.controller) { this.controller.dispose(); this.controller = null; }
  }

  private async openView(): Promise<void> {
    const workspace = this.app.workspace;
    if (workspace.leftSplit) workspace.leftSplit.collapse();
    const existing = workspace.getLeavesOfType(PITH_VIEW_TYPE)[0];
    const leaf = existing ?? (() => {
      try {
        return workspace.getLeaf("tab");
      } catch {
        return workspace.getLeaf(false);
      }
    })();
    if (!existing) await leaf.setViewState({ type: PITH_VIEW_TYPE, active: true });
    await workspace.revealLeaf(leaf);
  }
}
