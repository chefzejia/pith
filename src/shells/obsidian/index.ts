import { materialReadings, rememberMaterialReading } from "../../workbench/readingState.ts";
import { GUIDE_UNAVAILABLE_REASON } from "../../workbench/guideAvailability.ts";
import { toolkitCatalog, trainingToolkits } from "../web/toolkits.ts";
import { DefaultAttentionEngine, DefaultWorkspaceStore, MutationQueue, PluginRuntime, type AnchorSource, type AgentProcessPort, type ToolkitDescriptor, type GuideAgentService, type GuideProvider, type HostPort, type InterlineService, type InterlineTranslator, type Material, type PluginsConfigFile, type SelectionAnchor, type SpeechAsrService, type SpeechTtsService, type StageTimelineService, type StageReaderService, type StorageEntry, type WorkspaceStoragePort, type ImportMaterialInput } from "../../core/index.ts";
import { lstat, realpath, unlink, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import { homedir } from "node:os";
import { builtinRegistry } from "../../plugins/all.ts";
import { LocalAcpGuideProvider, buildScenePrompt, normalizeToolkits } from "../../plugins/guide-acp/index.ts";
import { recoverInterruptedToolSteps } from "../../plugins/guide-acp/turnRecovery.ts";
import { NodeAgentProcessPort } from "../web/nodeProcess.ts";
import { NodeToolServerPort } from "../web/nodeToolServer.ts";
import { NodeRepositoryPort } from "../web/nodeRepository.ts";
import { NodeHttpPort } from "../web/nodeHttp.ts";
import { NodeMediaCorpusPort } from "../web/nodeMediaCorpus.ts";
import { obsidianStyles, PithObsidianView, type ObsidianAgentConfig, type ObsidianViewActions } from "./plugin.ts";
import { audioContentType, videoContentType, isMediaFile, isSourceTextFile, resolveMediaPair } from "../../workbench/mediaAssets.ts";
import { migrateLegacySpeech, speechMode, switchSpeechMode, validSpeechProfiles, type SpeechMode, type SpeechProfiles } from "../speech/speechSettings.ts";
import { initialMaterialAids } from "../../workbench/toolkitSlot.ts";
import { agentInterlineTranslator } from "../../plugins/toolkit-interline/index.ts";
import type { FeynmanContrast } from "../../plugins/toolkit-feynman/index.ts";
import type { AgentPromptService, GuideTurn, SelectionAnchor as GuideAnchor } from "../../core/index.ts";
import { InterlineSession, type InterlineUnitInput } from "../../plugins/toolkit-interline/index.ts";
import { renderAcpSelect } from "../../workbench/acpSettings.ts";
import { renderCompass } from "../../workbench/compass.ts";
import { pithIcon } from "../../workbench/icons.ts";
import { checkRepositoryUpdate, renderRepositoryText } from "../../workbench/repositoryIntake.ts";
import { readLessonVersions, readSessionRepositoryFiles, useRepositoryVersion } from "../../workbench/lessonVersions.ts";
import { MaterialSession, type SessionState } from "../../workbench/materialSession.ts";
import { boardMaterials, cacheMaterialCover } from "../../workbench/boardMaterials.ts";
import { topicObservations, undoTopicObservation } from "../../workbench/observations.ts";
import { prepareMaterialImport, sampleMaterialText } from "../../workbench/importMaterial.ts";
import { ingestExternalUrl } from "../../plugins/guide-acp/externalIngest.ts";
import { MaterialWorkbench } from "../../workbench/materialWorkbench.ts";
import { openMaterialPicker } from "../../workbench/materialPicker.ts";
import type { IntakeActions, IntakePorts } from "../../workbench/intake.ts";
import { resolveRepositoryIntake } from "../../workbench/repositoryIntake.ts";
import { NodeManagedSpeechRuntime } from "../speech/speechRuntime.ts";
import { renderSpeechRuntimeSettings } from "../../workbench/speechRuntimeSettings.ts";
import { renderSpeechVoiceSettings, type VoiceOptions } from "../../workbench/speechVoiceSettings.ts";

interface ObsidianLeaf {
  view?: ObsidianItemViewBase;
  detach(): void;
  setViewState(state: { type: string; active: boolean }): Promise<void>;
}
interface ObsidianLayoutNode {
  type: string;
  children?: ObsidianLayoutNode[];
  currentTab?: number;
  state?: { type?: string };
}
interface ObsidianWorkspace {
  leftSplit?: { collapse(): void };
  rightSplit?: { collapsed?: boolean; collapse(): void; expand(): void };
  getLayout?(): { right?: ObsidianLayoutNode };
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
    copy: async (from, to) => { const bytes = await vault.readBinary(await checked(from)); await create(to, new Uint8Array(bytes)); },
    processText: async (value, update) => { const target = await checked(value); const result = update(await vault.read(target)); await vault.write(target, result); return result; },
    mkdir: async value => { const target = await checked(value); await ensureRoot(); if (!await vault.exists(target)) await vault.mkdir(target); },
    list: async value => {
      const result = await vault.list(await checked(value));
      const relative = (entry: string): string => root && entry.startsWith(`${root}/`) ? entry.slice(root.length + 1) : entry;
      return [...result.folders.map(entry => ({ path: relative(entry), type: "folder" as const })), ...result.files.map(entry => ({ path: relative(entry), type: "file" as const }))] satisfies StorageEntry[];
    },
  };
  const access = secretAccess ?? createObsidianSecretAccess(() => secrets);
  let protectedRoot: string | undefined;
  let rootError: string | undefined;
  if (vault.getFullPath) {
    try { const path = vault.getFullPath(""); if (!path || !isAbsolute(path)) throw new Error("Vault 路径不是绝对路径"); protectedRoot = path; }
    catch (error) { rootError = `无法确认 Vault 路径：${error instanceof Error ? error.message : String(error)}`; }
  }
  const unavailable = rootError;
  const speechRuntime = unavailable ? { getState: async () => ({ supported: false, status: "not-installed" as const, note: unavailable }) } : new NodeManagedSpeechRuntime(protectedRoot ? { protectedRoot } : { home: join(homedir(), "Library", "Application Support", "pith", "speech") });
  return { id: "obsidian", storage, repository: new NodeRepositoryPort(), http: new NodeHttpPort(), mediaCorpus: new NodeMediaCorpusPort(), toolServer: new NodeToolServerPort(), secrets: { getSecret: key => access.getSecret(key) }, ...(processPort ? { process: processPort } : {}), ...(speechRuntime ? { speechRuntime } : {}) };
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
  private readonly injectedGuide: boolean;
  private config: PluginsConfigFile = { preset: "all" };
  private persona: "sanctuary" | "studio" = "sanctuary";
  private agentId: ObsidianAgentConfig["agentId"] = "";
  private agentConfigured = false;
  private model = "";
  private effort = "";
  private agentTimeoutSetting: unknown;
  private speechConfig: Record<string, string> = {};
  private speechProfiles: SpeechProfiles = {};
  private topics: Awaited<ReturnType<DefaultWorkspaceStore["listTopics"]>> | null = null;
  private materials: Awaited<ReturnType<DefaultWorkspaceStore["listMaterials"]>> | null = null;
  private readonly views = new Set<PithObsidianView>();
  private readonly guideAvailabilityListeners = new Set<(available: boolean) => void>();
  private readonly guideTurns = new Map<string, AbortController>();

  async runGuide(topicId: string, input: { text: string; anchor?: GuideAnchor } | { turnId: string }, onUpdate?: (turn: GuideTurn) => void): Promise<GuideTurn> {
    if (!this.hasGuideProvider()) throw new Error(GUIDE_UNAVAILABLE_REASON);
    if (this.guideTurns.has(topicId)) throw new Error("Topic already has a running turn");
    const controller = new AbortController(); this.guideTurns.set(topicId, controller);
    try { return "turnId" in input ? await this.engine.retryTurn(topicId, input.turnId, { signal: controller.signal, onUpdate }) : await this.engine.runTurn({ topicId, ...input }, { signal: controller.signal, onUpdate }); }
    finally { this.guideTurns.delete(topicId); }
  }
  stopGuide(topicId: string): void { this.guideTurns.get(topicId)?.abort(); }

  constructor(host: HostPort, interlineTranslator?: InterlineTranslator, guideProvider?: GuideProvider) {
    this.host = host;
    this.interlineTranslator = interlineTranslator;
    this.injectedGuide = Boolean(guideProvider);
    this.store = new DefaultWorkspaceStore(host.storage);
    let provider: GuideProvider | undefined = guideProvider;
    this.engine = new DefaultAttentionEngine(this.store, host.storage, () => guideProvider || (this.agentId ? provider : undefined));
    const manifests = builtinRegistry.list().map(manifest => {
      if (!["stage-reader", "stage-timeline", "toolkit-shadowing", "toolkit-feynman", "toolkit-interline"].includes(manifest.id)) return manifest;
      return { ...manifest, inUse: () => {
        if (!this.topics || !this.materials) throw new Error("Workspace snapshot unavailable");
        if (manifest.id === "stage-reader") return this.materials.filter(item => item.kind === "book" || item.kind === "article").length;
        if (manifest.id === "stage-timeline") return this.materials.filter(item => item.kind === "media").length;
        const id = manifest.id.slice("toolkit-".length);
        return id === "interline" ? this.materials.filter(material => material.aids.includes(id)).length : this.topics.filter(topic => topic.toolkits.includes(id)).length;
      } };
    });
    this.runtime = new PluginRuntime(manifests, { host, store: this.store, engine: this.engine, window: {}, "toolkit.catalog": toolkitCatalog });
    if (host.mediaCorpus instanceof NodeMediaCorpusPort) host.mediaCorpus.setTranscriber(async (bytes, mimeType, signal) => { const asr = this.runtime.getService<SpeechAsrService>("speech.asr"); if (!asr?.transcribeAudio) throw new Error("语音识别服务不可用"); return asr.transcribeAudio(bytes, mimeType, signal); });
    if (!provider && host.process) provider = new LocalAcpGuideProvider({ processPort: host.process, toolServer: host.toolServer, store: this.store, engine: this.engine, storage: host.storage, http: host.http, repository: host.repository, mediaCorpus: host.mediaCorpus, getReader: () => this.runtime.getService<StageReaderService>("stage.reader"), getToolkits: () => trainingToolkits, getAgentConfig: () => ({ agentId: this.agentId, model: this.model, effort: this.effort, timeoutMs: this.agentTimeoutMs() }), resolveDescriptor: async id => (await this.detectAgents()).find(item => item.id === id) ?? null, buildScenePrompt });
  }
  async initialize(): Promise<void> {
    await this.store.ensureScaffold();
    if (await this.host.storage.exists("_cache/web-settings.json")) {
      const data: unknown = JSON.parse(await this.host.storage.readText("_cache/web-settings.json"));
      if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Invalid settings");
      const value = data as { preset?: unknown; persona?: unknown; plugins?: unknown; agentId?: unknown; agentConfigured?: unknown; model?: unknown; effort?: unknown; speech?: unknown; speechProfiles?: unknown; speechSettingsVersion?: unknown; agentTimeoutMs?: unknown };
      if (value.agentConfigured !== undefined && typeof value.agentConfigured !== "boolean") throw new Error("Invalid agent configuration state");
      if ((value.preset !== "all" && value.preset !== "essentials") || (value.persona !== "sanctuary" && value.persona !== "studio") || !value.plugins || typeof value.plugins !== "object" || Array.isArray(value.plugins) || (value.agentId !== undefined && (typeof value.agentId !== "string" || !["", "dsh", "claude", "codex"].includes(value.agentId))) || (value.model !== undefined && typeof value.model !== "string") || (value.effort !== undefined && typeof value.effort !== "string")) throw new Error("Invalid settings");
      this.persona = value.persona;
      this.agentId = (value.agentId ?? "") as ObsidianAgentConfig["agentId"];
      this.agentConfigured = value.agentConfigured ?? value.agentId !== undefined;
      this.model = (value.model ?? "") as string;
      this.effort = (value.effort ?? "") as string;
      this.agentTimeoutSetting = value.agentTimeoutMs;
      if (value.speechSettingsVersion !== undefined && value.speechSettingsVersion !== 1) throw new Error("Invalid speech settings version");
      if (value.speech !== undefined) { if (!value.speech || typeof value.speech !== "object" || Array.isArray(value.speech) || Object.values(value.speech).some(item => typeof item !== "string")) throw new Error("Invalid speech settings"); this.speechConfig = migrateLegacySpeech(value.speech as Record<string, string>, value.speechSettingsVersion, value.speechProfiles); }
      if (value.speechProfiles !== undefined) { if (!validSpeechProfiles(value.speechProfiles)) throw new Error("Invalid speech profiles"); this.speechProfiles = value.speechProfiles; }
      this.config = { preset: value.preset, plugins: value.plugins as NonNullable<PluginsConfigFile["plugins"]> };
    }
    await this.refresh();
  }
  trainingToolkits(): readonly ToolkitDescriptor[] { return trainingToolkits; }
  hasGuideProvider(): boolean { return (this.injectedGuide || Boolean(this.agentId && this.host.process)) && this.runtime.statuses().some(plugin => plugin.id === "guide-acp" && plugin.state === "active"); }
  onGuideAvailabilityChange(listener: (available: boolean) => void): () => void { this.guideAvailabilityListeners.add(listener); return () => { this.guideAvailabilityListeners.delete(listener); }; }
  private async updateGuideAvailability(): Promise<void> {
    const available = this.hasGuideProvider();
    for (const view of this.views) view.setGuideAvailable(available);
    for (const listener of this.guideAvailabilityListeners) listener(available);
    await Promise.all([...this.views].map(view => view.refreshGuide()));
  }
  private agentTimeoutMs(): number { const guide = this.runtime.getService<GuideAgentService>("guide.agent"); if (!guide) throw new Error("Guide service unavailable"); return guide.timeoutMs; }
  private async refresh(): Promise<void> {
    this.topics = null; this.materials = null;
    try { [this.topics, this.materials] = await Promise.all([this.store.listTopics(), this.store.listMaterials()]); }
    finally {
      const guideConfig = { agentId: this.agentId, model: this.model, effort: this.effort, persona: this.persona, ...(this.agentTimeoutSetting === undefined ? {} : { timeoutMs: this.agentTimeoutSetting }) };
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
  async openBoardMaterials() { return boardMaterials(this.host.storage, await this.store.listMaterials()); }
  async openTopic(id: string) { return this.store.getTopic(id); }
  createInterlineSession(materialId: string, file: string, units: readonly InterlineUnitInput[]): InterlineSession {
    const service = this.runtime.getService<InterlineService>("toolkit.interline");
    if (!service) throw new Error("行间工具不可用");
    const translator = this.interlineTranslator ?? agentInterlineTranslator({ prompt: async (text, options) => { const prompt = this.runtime.getService<AgentPromptService>("guide.prompt"); if (!prompt) throw new Error("请先配置向导 Agent"); return prompt.prompt(text, options); } });
    return new InterlineSession(service, this.host.storage, translator, materialId, file, units);
  }
  async importMaterial(input: ImportMaterialInput, topicId?: string) { if (topicId && !await this.store.getTopic(topicId)) throw new Error("Topic not found"); const material = await this.store.importMaterial({ ...input, aids: input.aids ?? initialMaterialAids(await sampleMaterialText(input.files)) }); if (topicId) await this.store.attachMaterial(topicId, material.id); await this.refresh(); return material; }
  async setMaterialAids(id: string, aids: readonly string[]) { const material = await this.store.setMaterialAids(id, aids); await this.refresh(); return material; }
  async checkRepositoryUpdate(id: string) { if (!this.host.repository) throw new Error("Repository unavailable"); const result = await checkRepositoryUpdate(this.store, this.host.repository, id); await this.refresh(); return result; }
  useRepositoryVersion(topicId: string, id: string) { return useRepositoryVersion(this.store, this.host.repository, topicId, id); }
  async rememberReading(materialId: string, file: string, locator?: string): Promise<void> {
    const material = await this.store.getMaterial(materialId); if (!material) throw new Error("材料不存在");
    if (locator && material.kind !== "repo") await this.store.updateReadingLocator(materialId, file, locator);
    await rememberMaterialReading(this.store, materialId, file, locator);
  }
  async topicSession(topicId?: string, materialId?: string): Promise<SessionState> {
    const topic = topicId ? await this.store.getTopic(topicId) : null; if (topicId && !topic) throw new Error("Topic not found");
    const materials = await Promise.all((materialId ? [materialId] : topic!.materialIds).map(async id => { const material = await this.store.getMaterial(id); if (!material) throw new Error(`Material not found: ${id}`); return material; }));
    const repositoryFiles = await readSessionRepositoryFiles(this.host.repository, materials, materialId ? null : topic);
    const lessonVersions = topic ? await readLessonVersions(this.store, this.host.repository, topic, materials, repositoryFiles) : undefined;
    return { topic, materials, libraryMaterials: await this.store.listMaterials(), repositoryFiles, lessonVersions, readings: materialReadings(materials) };
  }
  async renderTopicFile(topicId: string | undefined, source: AnchorSource, name: string) {
    if (source.kind === "lesson") { if (!topicId) throw new Error("课题不存在"); const text = await this.store.readLesson(topicId, name), reader = this.runtime.getService<StageReaderService>("stage.reader"); if (!reader) throw new Error("阅读器不可用"); return { text, html: reader.render(text), sections: reader.sections(text), format: "markdown" as const }; }
    const topic = topicId ? await this.store.getTopic(topicId) : null, material = await this.store.getMaterial(source.materialId);
    if ((topicId && !topic?.materialIds.includes(source.materialId)) || !material) throw new Error("材料不属于课题");
    if (material.kind !== "repo") return this.renderMaterialFile(material.id, name);
    const repository = this.host.repository; if (!repository || !material.externalPath || !material.commitSha) throw new Error("Repository unavailable");
    const parts: string[] = []; let startLine = 1;
    for (;;) { const page = await repository.readFile(material.externalPath, material.commitSha, name, startLine, 1000); parts.push(page.text); if (!page.truncated) break; startLine = page.endLine + 1; }
    const text = parts.join("\n"); return { text, ...renderRepositoryText(material.commitSha, name, text) };
  }
  async setSpeechConfig(config: Record<string, string>): Promise<void> {
    if (Object.entries(config).some(([key, value]) => !["ttsProvider", "ttsEndpoint", "ttsModel", "ttsVoice", "azureRegion", "asrProvider", "asrLoopbackUrl", "asrModel"].includes(key) || typeof value !== "string")) throw new Error("Invalid speech settings");
    this.speechConfig = { ...config }; await this.refresh(); await this.save({ speech: this.speechConfig, speechSettingsVersion: 1 });
  }
  async setSpeechMode(mode: SpeechMode): Promise<void> {
    const next = switchSpeechMode(this.speechConfig, this.speechProfiles, mode);
    this.speechConfig = next.speech; this.speechProfiles = next.profiles;
    await this.refresh(); await this.save({ speech: this.speechConfig, speechProfiles: this.speechProfiles, speechSettingsVersion: 1 });
  }
  async readAudioAsset(materialId: string, name: string): Promise<Uint8Array> { const material = await this.store.getMaterial(materialId); const entry = material && material.files.find(file => file.name === name); if (!entry || !(audioContentType(entry) || videoContentType(entry))) throw new Error("音视频文件不存在"); return this.host.storage.readBinary(`materials/${materialId}/files/${entry.name}`); }
  async readCitationFile(topicId: string, materialId: string, name: string, signal: AbortSignal): Promise<Uint8Array> {
    const topic = await this.store.getTopic(topicId);
    signal.throwIfAborted();
    if (!topic?.materialIds.includes(materialId)) throw new Error("材料不属于课题");
    const material = await this.store.getMaterial(materialId), file = material?.files.find(entry => entry.name === name);
    signal.throwIfAborted();
    if (!file) throw new Error("材料文件不存在");
    return this.host.storage.readBinary(`materials/${materialId}/files/${file.name}`);
  }
  async renderMaterialFile(materialId: string, name: string) {
    const material = await this.store.getMaterial(materialId); const file = material && material.files.find(entry => entry.name === name);
    if (!material || !file) throw new Error("材料文件不存在");
    const bytes = await this.host.storage.readBinary(`materials/${material.id}/files/${file.name}`);
    if (isMediaFile(file)) {
      const timeline = this.runtime.getService<StageTimelineService>("stage.timeline"); if (!timeline) throw new Error("时间轴不可用");
      const pair = resolveMediaPair(material.files, name);
      const transcript = pair.transcript ? pair.transcript.name === name ? bytes : await this.host.storage.readBinary(`materials/${material.id}/files/${pair.transcript.name}`) : new Uint8Array();
      const cues = timeline.parseTranscript(new TextDecoder().decode(transcript));
      const escape = (value: string) => value.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
      const mediaKind = pair.media && videoContentType(pair.media) ? "video" : "audio";
      const html = timeline.renderTimelineView ? timeline.renderTimelineView({ title: material.title, cues, mediaKind }) : `<section class="pith-timeline-stage"><h1>${escape(material.title)}</h1>${cues.map(cue => `<div class="pith-cue" data-cue-id="${escape(cue.id)}" data-locator="time:${cue.startSec}" data-prose="true"><time>${timeline.formatTimestamp(cue.startSec)}</time> ${escape(cue.text)}</div>`).join("")}</section>`;
      return { title: material.title, html, sections: [], mediaFile: pair.media?.name ?? null };
    }
    const reader = this.runtime.getService<StageReaderService>("stage.reader"); if (!reader || !reader.renderFile) throw new Error("阅读器不可用");
    return reader.renderFile(isSourceTextFile(file.name) ? { ...file, mimeType: "text/plain" } : file, bytes);
  }
  async captureHighlight(topicId: string, body: string, anchor?: SelectionAnchor) { return this.engine.capture({ owner: { topicId }, kind: "highlight", body, anchor }); }
  async setPersona(persona: "sanctuary" | "studio"): Promise<void> { this.persona = persona; await this.refresh(); await this.save({ persona }); }
  async detectAgents(force = false) { const guide = this.runtime.getService<GuideAgentService>("guide.agent"); if (!guide || !guide.detectAgents) throw new Error("Guide service unavailable"); return guide.detectAgents(force); }
  async probeAgentOptions(id: string, force = false) { const guide = this.runtime.getService<GuideAgentService>("guide.agent"); if (!guide || !guide.probeAgentOptions) throw new Error("Guide service unavailable"); return guide.probeAgentOptions(id, force); }
  async setAgentConfig(config: ObsidianAgentConfig): Promise<void> {
    if (!["", "dsh", "claude", "codex"].includes(config.agentId) || typeof config.model !== "string" || typeof config.effort !== "string" || (config.persona !== "sanctuary" && config.persona !== "studio")) throw new Error("Invalid agent config");
    const previous = this.hasGuideProvider();
    this.agentId = config.agentId; this.agentConfigured = true; this.model = config.model; this.effort = config.effort; this.persona = config.persona;
    await this.refresh(); await this.save(config);
    if (previous !== this.hasGuideProvider()) await this.updateGuideAvailability();
  }
  async setPlugins(config: PluginsConfigFile): Promise<void> {
    const previous = this.hasGuideProvider(); this.config = config; await this.refresh();
    await this.save({ preset: config.preset ?? "all", plugins: config.plugins ?? {} });
    if (previous !== this.hasGuideProvider()) await this.updateGuideAvailability();
  }
  getPersona(): "sanctuary" | "studio" { return this.persona; }
  getAgentConfig(): ObsidianAgentConfig { return { agentId: this.agentId, model: this.model, effort: this.effort, persona: this.persona }; }
  isAgentConfigured(): boolean { return this.agentConfigured; }
  getSpeechConfig(): Record<string, string> { return { ...this.speechConfig }; }
  async speechRuntimeState() { return this.host.speechRuntime ? this.host.speechRuntime.getState() : { supported: false, status: "not-installed" as const, note: "无法确认 Vault 路径，本机语音不可用" }; }
  async speechRuntimeVoices(): Promise<VoiceOptions> { const runtime = this.host.speechRuntime; if (!runtime || !("getVoices" in runtime) || typeof runtime.getVoices !== "function") throw new Error("本宿主不支持音色读取"); return runtime.getVoices() as Promise<VoiceOptions>; }
  async speechRuntimeAction(action: "install" | "ensureRunning" | "stop" | "remove") { const runtime = this.host.speechRuntime; if (!runtime || !runtime[action]) throw new Error("本宿主不支持该操作"); return runtime[action](); }
  createView(root: HTMLElement, actions: ObsidianViewActions): PithObsidianView {
    const view = new PithObsidianView(root, actions);
    view.setGuideAvailable(this.hasGuideProvider());
    this.views.add(view);
    return view;
  }
  releaseView(view: PithObsidianView): void { if (this.views.delete(view)) view.dispose(); }
  dispose(): void { for (const view of this.views) view.dispose(); this.views.clear(); this.guideAvailabilityListeners.clear(); this.runtime.stop(); if (this.host.speechRuntime && this.host.speechRuntime.stop) void this.host.speechRuntime.stop().catch(error => console.error("Speech runtime stop failed:", error)); }
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
  private guideExpandedSplit: ObsidianWorkspace["rightSplit"];
  private compassView: ReturnType<typeof renderCompass> | undefined;
  private materialView: MaterialWorkbench | undefined;
  private picker: ReturnType<typeof openMaterialPicker> | undefined;
  private readonly controller: PithObsidianController;
  private readonly workspace: ObsidianWorkspace | undefined;
  private readonly host: HostPort;
  private readonly guideByTopic: Map<string, boolean>;
  private readonly openSettings: (() => void) | undefined;
  private readonly unsubscribeGuide: () => void;
  constructor(leaf: ObsidianLeaf, controller: PithObsidianController, host: HostPort, workspace?: ObsidianWorkspace, openSettings?: () => void) { super(leaf); this.controller = controller; this.host = host; this.workspace = workspace; this.guideByTopic = controller.guideVisibility; this.openSettings = openSettings; this.unsubscribeGuide = controller.onGuideAvailabilityChange(available => { this.compassView?.setGuideAvailable(available); this.materialView?.setGuideAvailable(available); }); }
  getViewType(): string { return PITH_VIEW_TYPE; }
  getDisplayText(): string { return "Pith"; }
  getIcon(): string { return "sprout"; }

  async onOpen(): Promise<void> {
    if (this.workspace && this.workspace.leftSplit) this.workspace.leftSplit.collapse();
    const previousGeneration = this.generation, request = ++this.homeRequest;
    const compass = await this.controller.openCompass();
    const materials = await this.controller.openBoardMaterials();
    if (previousGeneration !== this.generation || request !== this.homeRequest) return;
    const generation = ++this.generation;
    await this.releaseReaderView();
    if (generation !== this.generation) return;
    const root = this.contentEl;
    this.disposeScenes();
    this.compassView = renderCompass(root, compass, {
      materials, intake: this.intakeActions(),
      checkUpdate: async id => { const result = await this.controller.checkRepositoryUpdate(id); return { snapshot: await this.controller.openCompass(), covers: await this.controller.openBoardMaterials(), message: result.added ? `已导入 @${result.material.commitSha?.slice(0, 7)}` : "已是最新版本" }; },
      ...(this.openSettings ? { settings: this.openSettings } : {}),
      open: id => { void this.openTopic(id).catch(error => this.report(error)); },
      openMaterial: id => { void this.openMaterial(id).catch(error => this.report(error)); },
      setStatus: async (id, status) => { if (status === "shelved") await this.controller.store.updateTopic(id, { status: "shelved" }); else await this.controller.store.updateTopic(id, { status: "exploring" }); await this.onOpen(); },
    });
    const current = this.compassView;
    void this.prepareCovers().then(async () => { if (this.compassView === current && generation === this.generation) current.library(await this.controller.openCompass(), await this.controller.openBoardMaterials()); }).catch(error => this.report(error));
  }
  private disposeScenes(): void { this.compassView?.dispose(); this.compassView = undefined; this.materialView?.dispose(); this.materialView = undefined; this.picker?.dispose(); this.picker = undefined; }
  private async releaseReaderView(): Promise<void> {
    const view = this.view;
    if (!view) return;
    this.view = null;
    try { if (this.workspace) await this.showNativeGuide(false, view); }
    finally { this.controller.releaseView(view); }
  }
  private async prepareCovers(): Promise<void> { for (const material of await this.controller.store.listMaterials()) await cacheMaterialCover(this.host.storage, material, this.contentEl.ownerDocument).catch(() => {}); }
  private intakePorts(): IntakePorts {
    const cache = async (material: Material) => { await cacheMaterialCover(this.host.storage, material, this.contentEl.ownerDocument).catch(() => {}); return material; };
    return {
      importFiles: async files => { const prepared = await prepareMaterialImport(files); return cache(await this.controller.importMaterial({ title: prepared.title, kind: prepared.kind, files: prepared.files })); },
      importUrl: async (url, signal) => { const bundle = await ingestExternalUrl({ url }, this.host.http, signal); signal?.throwIfAborted(); return cache(await this.controller.importMaterial({ title: bundle.title, kind: bundle.kind, files: bundle.files })); },
      importRepository: async (path, signal) => { if (!this.host.repository) throw new Error("本宿主不支持代码仓库"); const { info, description } = await resolveRepositoryIntake(path, this.host.repository, signal); signal?.throwIfAborted(); return { material: await this.controller.importMaterial({ title: info.title, kind: "repo", files: [], externalPath: info.externalPath, commitSha: info.commitSha, remoteUrl: info.remoteUrl }), description }; },
      intake: (input, options) => this.controller.engine.intake(input, options),
    };
  }
  private intakeActions(): IntakeActions {
    return { ports: this.intakePorts(), guideAvailable: this.controller.hasGuideProvider(), settings: this.openSettings,
      topic: topic => this.openTopic(topic.id, true), fed: async materials => { if (materials.length === 1) await this.openMaterial(materials[0]!.id); else { await this.onOpen(); this.compassView?.library(await this.controller.openCompass(), await this.controller.openBoardMaterials(), materials.map(material => material.id)); } },
      changed: async () => { this.compassView?.library(await this.controller.openCompass(), await this.controller.openBoardMaterials()); },
    };
  }
  private async openMaterial(id: string): Promise<void> {
    const generation = ++this.generation, state = await this.controller.topicSession(undefined, id); if (generation !== this.generation) return;
    await this.releaseReaderView();
    if (generation !== this.generation) return;
    this.disposeScenes();
    let interline: { signature: string; session: InterlineSession } | undefined;
    const source = { kind: "material" as const, materialId: id };
    const instance: MaterialWorkbench = new MaterialWorkbench({ root: this.contentEl, state,
      loadState: () => this.controller.topicSession(undefined, id), readFile: name => this.controller.renderTopicFile(undefined, source, name),
      capture: (kind, body, anchor) => this.controller.engine.capture({ owner: { materialId: id }, kind, body, anchor }),
      setAids: aids => this.controller.setMaterialAids(id, aids), saveLocator: (file, locator) => this.controller.rememberReading(id, file, locator), opened: file => this.controller.rememberReading(id, file),
      home: () => this.onOpen(), settings: () => this.openSettings?.(), report: error => this.report(error), intake: this.intakeActions(),
      speech: {
        loadAudio: name => this.controller.readAudioAsset(id, name),
        synthesizeSpeech: async (text, signal) => { const tts = this.controller.runtime.getService<SpeechTtsService>("speech.tts"); if (!tts?.synthesizeSpeech) throw new Error("语音服务不可用"); return tts.synthesizeSpeech(text, signal); },
        prepareInterline: async (units, index, mode) => { const material = await this.controller.store.getMaterial(id); if (!material?.aids.includes("interline")) throw new Error("行间未开启"); const signature = JSON.stringify([instance.session.file, units]); if (!interline || interline.signature !== signature) interline = { signature, session: this.controller.createInterlineSession(id, instance.session.file, units) }; return interline.session.render(index, mode); },
      },
    });
    this.materialView = instance; await instance.open();
  }

  async onClose(): Promise<void> { this.unsubscribeGuide?.(); this.generation++; this.disposeScenes(); await this.releaseReaderView(); }

  private report(error: unknown): void { new obsidian.Notice(error instanceof Error ? error.message : String(error)); }
  private restoreGuideSplit(): void {
    const split = this.guideExpandedSplit;
    this.guideExpandedSplit = undefined;
    if (!split || split !== this.workspace?.rightSplit) return;
    // Inspect selection before detach: afterwards Obsidian selects a default tab.
    // A user-selected host tab, or a sidebar that was already open, stays open.
    const guideSelected = (node: ObsidianLayoutNode): boolean => {
      if (node.type === "leaf") return node.state?.type === PITH_GUIDE_VIEW_TYPE;
      const children = node.children ?? [];
      if (node.type === "tabs") { const active = children[node.currentTab ?? 0]; return !!active && guideSelected(active); }
      return children.length > 0 && children.every(guideSelected);
    };
    const right = this.workspace?.getLayout?.().right;
    if (right && guideSelected(right)) split.collapse();
  }
  private async showNativeGuide(visible: boolean, view: PithObsidianView, topicId?: string): Promise<void> {
    const workspace = this.workspace;
    if (!workspace || !workspace.rightSplit || !workspace.getRightLeaf) throw new Error("宿主右侧边栏不可用");
    const request = ++this.guideRequest;
    this.guideDesiredVisible = visible;
    if (!visible) { if (!this.guideOpening) this.restoreGuideSplit(); for (const leaf of workspace.getLeavesOfType(PITH_GUIDE_VIEW_TYPE)) if (leaf !== this.guideOpeningLeaf) leaf.detach(); return; }
    if (workspace.rightSplit.collapsed === true) this.guideExpandedSplit = workspace.rightSplit;
    let leaf = this.guideOpening ? undefined : workspace.getLeavesOfType(PITH_GUIDE_VIEW_TYPE)[0];
    let created = false;
    if (!leaf) {
      if (!this.guideOpening) { const right = workspace.getRightLeaf(false); if (!right) throw new Error("无法打开右侧边栏"); created = true; this.guideOpeningLeaf = right; this.guideOpening = right.setViewState({ type: PITH_GUIDE_VIEW_TYPE, active: true }).then(() => right); }
      const opening = this.guideOpening;
      try { leaf = await opening; } catch (error) { if (created && !this.guideDesiredVisible && this.guideOpeningLeaf && this.guideOpeningLeaf.view instanceof PithGuideView) { this.restoreGuideSplit(); this.guideOpeningLeaf.detach(); } throw error; } finally { if (this.guideOpening === opening) { this.guideOpening = null; this.guideOpeningLeaf = null; } }
    }
    if (this.view !== view || request !== this.guideRequest) { if (created && (request === this.guideRequest || !this.guideDesiredVisible) && leaf.view instanceof PithGuideView) { this.restoreGuideSplit(); leaf.detach(); } return; }
    if (!(leaf.view instanceof PithGuideView)) throw new Error("向导视图未就绪");
    leaf.view.mount(view.guideElement(), () => { if (this.view === view) { view.setGuideVisible(false); if (topicId) this.guideByTopic.set(topicId, false); } });
    workspace.rightSplit.expand();
    await workspace.revealLeaf(leaf);
    if (this.view === view && request === this.guideRequest) view.focusQuotedGuide();
  }
  private async openTopic(id: string, guide = false, prompt = ""): Promise<void> {
    const generation = ++this.generation; this.disposeScenes();
    const topic = await this.controller.openTopic(id);
    if (generation !== this.generation) return;
    if (!topic) throw new Error("课题不存在");
    const sessionState = await this.controller.topicSession(id);
    if (generation !== this.generation) return;
    let interlineSession: { file: string; signature: string; session: InterlineSession } | undefined;
    let session: MaterialSession;
    const toolkits = () => trainingToolkits;
    await this.releaseReaderView();
    if (generation !== this.generation) return;
    let originatingView: PithObsidianView;
    originatingView = this.controller.createView(this.contentEl, {
      guideAvailable: this.controller.hasGuideProvider(),
      readOnly: topic.status === "settled",
      importMaterial: topic.status === "settled" ? undefined : () => { this.picker?.dispose(); this.picker = openMaterialPicker(this.contentEl, { ports: this.intakePorts(), library: () => this.controller.store.listMaterials(), referenced: async () => (await this.controller.store.getTopic(topic.id))!.materialIds, attach: async id => { await this.controller.store.attachMaterial(topic.id, id); }, added: async id => { await session.refresh(); await session.openMaterial(id); } }); },
      guideVisibilityChanged: visible => { this.guideByTopic.set(topic.id, visible); return this.workspace ? this.showNativeGuide(visible, originatingView, topic.id).catch(error => this.report(error)) : undefined; },
      home: () => this.onOpen(),
      openSettings: () => { if (!this.openSettings) throw new Error("设置面板不可用"); this.openSettings(); },
      openFile: (name, source) => session.openFile(name, source),
      generateLesson: async (name, title) => {
        if (!this.controller.hasGuideProvider()) throw new Error("向导不可用，无法生成讲义");
        await session.generateLesson(name, title);
      },
      loadAudio: name => { if (!session.material) throw new Error("材料不存在"); return this.controller.readAudioAsset(session.material.id, name); },
      readCitationFile: (materialId, name, signal) => this.controller.readCitationFile(topic.id, materialId, name, signal),
      transcribeAudio: async (bytes, mimeType, signal) => { const asr = this.controller.runtime.getService<SpeechAsrService>("speech.asr"); if (!asr || !asr.transcribeAudio) throw new Error("请先在设置中配置语音识别服务"); return asr.transcribeAudio(bytes, mimeType, signal); },
      setMaterialAids: async aids => { if (!session.material) throw new Error("材料不存在"); await this.controller.setMaterialAids(session.material.id, aids); await session.refresh(); },
      saveLocator: async locator => { if (session.source?.kind === "lesson") await this.controller.store.updateLessonLocator(topic.id, session.file, locator); else if (session.material) await this.controller.rememberReading(session.material.id, session.file, locator); },
      prepareInterline: async (units, index, mode) => { const current = await this.controller.store.getTopic(topic.id), material = session.material, currentFile = session.file; if (!material || !current || !current.materialIds.includes(material.id) || !(await this.controller.store.getMaterial(material.id))?.aids.includes("interline")) throw new Error("行间未挂载"); if (generation !== this.generation || this.view !== originatingView) throw new Error("课题已切换"); const signature = JSON.stringify([material.id, units]); if (!interlineSession || interlineSession.file !== currentFile || interlineSession.signature !== signature) interlineSession = { file: currentFile, signature, session: this.controller.createInterlineSession(material.id, currentFile, units) }; return interlineSession.session.render(index, mode); },
      synthesizeSpeech: async (text, signal) => { const tts = this.controller.runtime.getService<SpeechTtsService>("speech.tts"); if (!tts || !tts.synthesizeSpeech) throw new Error("未连接可用的语音服务，请先启动本地语音服务或在设置中配置云端 TTS"); try { return await tts.synthesizeSpeech(text, signal); } catch (error) { throw new Error("未连接可用的语音服务，请先启动本地语音服务或在设置中配置云端 TTS", { cause: error }); } },
      openToolkit: (text, locator) => { if (this.view) this.view.openToolkit(toolkits(), text, text === undefined || !session.source ? undefined : { source: session.source, file: session.file, locator: locator || "text:offset:0", quote: text }); },
      selection: (action, text, locator) => { if (!session.source) throw new Error("文件来源不存在"); const anchor = { source: session.source, file: session.file, locator: locator || "text:offset:0", quote: text }; if (action === "ask" || action === "note") { if (this.view) this.view.quoteSelection(anchor, action === "ask" ? "chat" : "notes"); return; } void this.controller.engine.capture({ owner: { topicId: topic.id }, kind: action, body: text, anchor }).then(async () => { if (this.view) await this.view.refreshGuide(); }).catch(error => this.report(error)); },
      guideData: async () => { await this.controller.openCompass(); const updated = await this.controller.store.getTopic(topic.id); if (!updated) throw new Error("课题不存在"); const guide = this.controller.runtime.getService<GuideAgentService>("guide.agent"); return { notes: updated.notes, toolkits: updated.toolkits, conversation: (await this.controller.engine.getConversation(topic.id)).map(recoverInterruptedToolSteps), observations: await topicObservations(this.controller.store, topic.id), actions: this.controller.hasGuideProvider() && guide && guide.quickActionsForTopic ? guide.quickActionsForTopic(updated, toolkits()) : [], readOnly: updated.status === "settled" }; },
      undoObservation: id => undoTopicObservation(this.controller.store, this.controller.engine, topic.id, id),
      openMaterial: async id => { await session.refresh(); await session.openMaterial(id); },
      sendGuide: async (text, anchor, saveAsNote) => { if (saveAsNote) { await this.controller.engine.capture({ owner: { topicId: topic.id }, kind: "note", body: text, anchor }); return; } await this.controller.runGuide(topic.id, { text, anchor }, turn => originatingView.updateGuideTurn(turn)); await session.refresh(); },
      checkRepositoryUpdate: async id => { const result = await this.controller.checkRepositoryUpdate(id); await session.refresh(); return result.added ? `已导入 @${result.material.commitSha?.slice(0, 7)}` : "已是最新版本"; },
      useRepositoryVersion: async id => { await session.refresh(await this.controller.useRepositoryVersion(topic.id, id)); },
      stopGuide: async () => { this.controller.stopGuide(topic.id); },
      retryGuide: async turnId => { await this.controller.runGuide(topic.id, { turnId }, turn => originatingView.updateGuideTurn(turn)); await session.refresh(); },
      toggleToolkit: async (id, enabled) => { normalizeToolkits([id], toolkits()); const current = await this.controller.store.getTopic(topic.id); if (!current || generation !== this.generation) throw new Error("课题已切换"); const selected = current.toolkits.filter(item => item !== id); if (enabled) selected.push(id); const updated = await this.controller.store.updateTopic(topic.id, { toolkits: normalizeToolkits(selected, this.controller.trainingToolkits()) }); if (generation === this.generation) originatingView.setToolkits(updated.toolkits); },
      savePractice: (body, anchor, result) => this.controller.engine.capture({ owner: { topicId: topic.id }, kind: "practice", body, anchor, result }),
      prepareRecall: async (source, signal) => { const service = this.controller.runtime.getService<FeynmanContrast>("feynman.contrast"); if (!this.controller.hasGuideProvider() || !service) throw new Error("向导未连接，费曼对照不可用"); return service.prepare(source, signal); },
      compareRecall: async (source, points, produced, signal) => { const service = this.controller.runtime.getService<FeynmanContrast>("feynman.contrast"); if (!this.controller.hasGuideProvider() || !service) throw new Error("向导未连接，费曼对照不可用"); return service.compare(source, points, produced, signal); },
      mountToolkit: async id => { normalizeToolkits([id], toolkits()); const current = await this.controller.store.getTopic(topic.id); if (generation !== this.generation || this.view !== originatingView) throw new Error("课题已切换"); if (!current) throw new Error("课题不存在"); const present = current.toolkits.includes(id); const updated = present ? current : await this.controller.store.updateTopic(topic.id, { toolkits: normalizeToolkits([...current.toolkits, id], toolkits()) }); if (generation !== this.generation || this.view !== originatingView) throw new Error("课题已切换"); originatingView.setToolkits(updated.toolkits); },
    });
    this.view = originatingView;
    session = new MaterialSession(sessionState, {
      title: topic.title, active: () => generation === this.generation && this.view === originatingView,
      loadState: () => this.controller.topicSession(topic.id),
      readFile: (source, name) => this.controller.renderTopicFile(topic.id, source, name),
      readOutline: async () => { const updated = await this.controller.store.getTopic(topic.id); return updated?.lessons.some(lesson => lesson.name === "00-课程大纲.md") ? this.controller.store.readLesson(topic.id, "00-课程大纲.md") : undefined; },
      render: document => originatingView.render(document), updateNavigation: (files, curriculum, groups) => originatingView.updateMaterialNavigation(files, curriculum, groups),
      beforeLesson: async title => { originatingView.showLessonLoading(title); originatingView.setGuideVisible(true); this.guideByTopic.set(topic.id, true); if (this.workspace) await this.showNativeGuide(true, originatingView, topic.id); },
      sendLesson: async (name, title) => { const text = `请按照《00-课程大纲.md》的规划，结合我的学习者画像与源码/材料依据，撰写《${name}》（${title}）的完整讲义并调用 pith_write_lesson 保存。`; await originatingView.guideTurn(text, () => this.controller.runGuide(topic.id, { text }, turn => originatingView.updateGuideTurn(turn))); },
      afterLesson: () => originatingView.refreshGuide(), afterOpen: async () => { if (session.material) await this.controller.rememberReading(session.material.id, session.file); await originatingView.refreshGuide(); },
    });
    const guideVisible = this.guideByTopic.get(topic.id) ?? false;
    this.view.setGuideVisible(guideVisible);
    if (this.workspace) await this.showNativeGuide(guideVisible, this.view, topic.id);
    this.view.setToolkits(topic.toolkits);
    await session.open();
    if (generation === this.generation && this.view) await this.view.refreshGuide();
    if (guide && this.controller.hasGuideProvider() && generation === this.generation && this.view) { this.view.setGuideVisible(true); this.guideByTopic.set(topic.id, true); if (this.workspace) await this.showNativeGuide(true, this.view, topic.id); }
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
    const hiddenStyles = doc.createElement("style"); hiddenStyles.textContent = ".pith-cloud-health[hidden]{display:none!important}"; root.append(hiddenStyles);
    const styles = doc.createElement("style"); styles.textContent = ".pith-setting-row{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:10px 0;border-bottom:1px solid var(--background-modifier-border)}.pith-setting-row[hidden]{display:none}.pith-setting-row input,.pith-setting-row select{max-width:55%}.pith-setting-control{display:inline-flex;align-items:center;justify-content:flex-end;gap:8px}.pith-setting-control select{max-width:100%}.pith-runtime-title{display:flex;flex-direction:column;gap:4px}.pith-runtime-title small{color:var(--text-muted)}#pith-runtime{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;padding:10px 0}#pith-runtime[hidden]{display:none}"; root.append(styles);
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
    const agent = select([...(this.controller.isAgentConfigured() ? [] : [["unconfigured", "未配置"] as const]), ["", "离线"], ["dsh", "dsh"], ["claude", "claude"], ["codex", "codex"]], this.agentIntent !== undefined ? this.agentIntent : this.controller.isAgentConfigured() ? config.agentId : "unconfigured"); const agentControls = doc.createElement("span"); agentControls.className = "pith-setting-control"; agentControls.append(agent); row(root, "本机 Agent", agentControls);
    const unconfigured = agent.querySelector<HTMLOptionElement>('option[value="unconfigured"]'); if (unconfigured) unconfigured.disabled = true;
    const scan = doc.createElement("button"); scan.innerHTML = pithIcon("rotate-cw"); scan.type = "button"; scan.setAttribute("aria-label", "刷新本机 Agent"); scan.title = "刷新本机 Agent"; agentControls.append(scan);
    const model = select([], ""), effort = select([], ""); row(root, "模型（Model）", model); row(root, "推理强度（Effort）", effort);
    const persona = select([["sanctuary", "花园 / 园丁"], ["studio", "工作区 / 向导"]], config.persona); row(root, "术语风格", persona);
    const saveAgent = () => { const agentId = agent.value as ObsidianAgentConfig["agentId"], value = persona.value as ObsidianAgentConfig["persona"]; void enqueue(async () => { await this.controller.setAgentConfig({ ...this.controller.getAgentConfig(), agentId, persona: value }); status.textContent = "设置已保存"; }); };
    let probeGeneration = 0;
    const probe = (force = false) => { const id = agent.value, generation = ++probeGeneration; model.disabled = !id || id === "unconfigured"; effort.disabled = true; const current = this.controller.getAgentConfig(); renderAcpSelect(model, undefined, current.model); renderAcpSelect(effort, undefined, current.effort); if (model.disabled) return; void this.controller.probeAgentOptions(id, force).then(options => { if (generation !== probeGeneration || !root.contains(agent) || agent.value !== id) return; renderAcpSelect(model, options.find(item => item.id === "model"), model.value); renderAcpSelect(effort, options.find(item => item.id === "reasoning_effort" || item.id === "effort" || item.category === "thought_level"), effort.value); effort.disabled = false; }).catch(error => { if (generation === probeGeneration && root.contains(agent)) status.textContent = error instanceof Error ? error.message : String(error); }); };
    const saveOption = (name: "model" | "effort", value: string) => { void enqueue(async () => { await this.controller.setAgentConfig({ ...this.controller.getAgentConfig(), [name]: value }); status.textContent = "设置已保存"; }); };
    model.addEventListener("change", () => saveOption("model", model.value)); effort.addEventListener("change", () => saveOption("effort", effort.value));
    agent.addEventListener("change", () => { this.agentIntent = agent.value as ObsidianAgentConfig["agentId"]; saveAgent(); probe(); }); persona.addEventListener("change", () => { const value = persona.value as ObsidianAgentConfig["persona"]; void enqueue(async () => { await this.controller.setPersona(value); status.textContent = "设置已保存"; }); });
    const detect = () => { scan.disabled = true; scan.textContent = "…"; void this.controller.detectAgents(true).then(agents => { const available = ["dsh", "claude", "codex"].map(id => agents.find(item => item.id === id && item.available)).find(Boolean); if (this.agentIntent === undefined && root.contains(agent) && !this.controller.isAgentConfigured() && available) { agent.value = available.id; saveAgent(); probe(); } else if (!available) status.textContent = "未发现可用 Agent"; }).catch(error => { status.textContent = String(error); }).finally(() => { scan.disabled = false; scan.innerHTML = pithIcon("rotate-cw"); }); }; scan.onclick = () => { detect(); probe(true); };
    heading("语音服务"); const speech = this.controller.getSpeechConfig();
    const currentMode = speechMode(speech);
    const mode = select([...(currentMode === "legacy" ? [["legacy", "现有旧配置（保留）"] as const] : []), ["local", "本机语音服务（免配置自动连接）"], ["cloud", "云端语音服务（OpenAI 标准协议）"]], currentMode); row(root, "语音服务模式", mode);
    const runtimePanel = doc.createElement("div"); runtimePanel.id = "pith-runtime"; root.append(runtimePanel);
    const voiceRoot = doc.createElement("div"); voiceRoot.id = "pith-voices"; root.append(voiceRoot);
    let voiceRevision = 0; const fieldRevisions = new WeakMap<HTMLInputElement, number>();
    const voices = renderSpeechVoiceSettings(voiceRoot, () => this.controller.speechRuntimeVoices(), voice => { voiceRevision++; void enqueue(async () => { await this.controller.setSpeechConfig({ ...this.controller.getSpeechConfig(), ttsVoice: voice }); status.textContent = "设置已保存"; }); }, () => root.contains(voiceRoot));
    voices.setMode(mode.value, speech.ttsVoice || "");
    renderSpeechRuntimeSettings(runtimePanel, () => this.controller.speechRuntimeState(), action => this.controller.speechRuntimeAction(action), () => root.contains(runtimePanel), info => voices.setRuntimeState(info));
    if (currentMode === "legacy") { const legacy = mode.querySelector<HTMLOptionElement>('option[value="legacy"]'); if (legacy) legacy.disabled = true; status.textContent = "现有语音配置保持不变；选择模式可切换标准协议"; }
    const key = input(root, "API Key", ""); key.type = "password"; key.autocomplete = "new-password"; const keyRow = key.parentElement!;
    const health = doc.createElement("button"); health.textContent = "检测连接"; health.type = "button"; health.className = "pith-cloud-health";
    const cloudFields = doc.createElement("div"); root.append(cloudFields);
    const fields = [["ttsEndpoint", "TTS 端点 URL"], ["ttsModel", "TTS 模型"], ["ttsVoice", "音色"], ["asrLoopbackUrl", "ASR 端点 URL"], ["asrModel", "ASR 模型"]] as const;
    const controls = new Map<string, HTMLInputElement>();
    for (const [name, label] of fields) { const control = input(cloudFields, label, speech[name] || ""); controls.set(name, control); control.addEventListener("input", () => fieldRevisions.set(control, (fieldRevisions.get(control) ?? 0) + 1)); control.addEventListener("change", () => { if (mode.value !== "cloud") return; const value = control.value; void enqueue(async () => { await this.controller.setSpeechConfig({ ...this.controller.getSpeechConfig(), [name]: value }); status.textContent = "设置已保存"; }); }); }
    root.append(health);
    const visibility = () => { keyRow.hidden = mode.value !== "cloud"; cloudFields.hidden = mode.value !== "cloud"; health.hidden = mode.value !== "cloud"; runtimePanel.hidden = mode.value !== "local"; }; visibility();
    mode.addEventListener("change", () => { visibility(); const selected = mode.value as SpeechMode; voices.setMode(selected, ""); const revision = voiceRevision, revisions = new Map([...controls.values()].map(control => [control, fieldRevisions.get(control) ?? 0])); void enqueue(async () => { await this.controller.setSpeechMode(selected); if (mode.value === selected) { const current = this.controller.getSpeechConfig(); if (voiceRevision === revision) voices.setValue(current.ttsVoice || ""); for (const [name, control] of controls) if ((fieldRevisions.get(control) ?? 0) === revisions.get(control)) control.value = current[name] || ""; } status.textContent = "设置已保存"; }); });
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
    const adapter = this.app.vault.adapter;
    const processPort = adapter.getFullPath ? new NodeAgentProcessPort({ workspaceRoot: adapter.getFullPath(this.workspacePath) }) : undefined;
    const host = createObsidianHostPort(adapter, this.workspacePath, processPort, undefined, undefined, this.secretAccess);
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
