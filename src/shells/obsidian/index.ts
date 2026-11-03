import { DefaultAttentionEngine, DefaultWorkspaceStore, MutationQueue, PluginRuntime, type AgentProcessPort, type DojoToolkitDescriptor, type GuideAgentService, type GuideProvider, type HostPort, type PluginsConfigFile, type SelectionAnchor, type SpeechTtsService, type StageTimelineService, type StageReaderService, type StorageEntry, type WorkspaceStoragePort, type ImportMaterialInput } from "../../core/index.ts";
import { lstat, realpath, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { builtinRegistry } from "../../plugins/all.ts";
import { LocalAcpGuideProvider, buildScenePrompt } from "../../plugins/guide-acp/index.ts";
import { NodeAgentProcessPort } from "../web/nodeProcess.ts";
import { NodeHttpPort } from "../web/nodeHttp.ts";
import { obsidianStyles, PithObsidianView, type ObsidianAgentConfig, type ObsidianViewActions } from "./plugin.ts";
import { audioContentType } from "../mediaAssets.ts";

interface ObsidianLeaf {
  setViewState(state: { type: string; active: boolean }): Promise<void>;
}
interface ObsidianWorkspace {
  leftSplit?: { collapse(): void };
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
  addSettingTab?(tab: ObsidianSettingTabBase): void;
  loadData?(): Promise<unknown>;
  saveData?(data: unknown): Promise<void>;
}
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

export function createObsidianHostPort(vault: ObsidianVaultAdapter, workspacePath = "Pith", processPort?: AgentProcessPort, fileSystem?: ObsidianVaultAdapter): HostPort {
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
  readonly guideVisibility = new Map<string, boolean>();
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
    let provider: GuideProvider | undefined;
    this.engine = new DefaultAttentionEngine(this.store, host.storage, () => this.agentId ? provider : undefined);
    const manifests = builtinRegistry.list().map(manifest => {
      if (!["stage-reader", "stage-timeline", "dojo-shadowing", "dojo-feynman"].includes(manifest.id)) return manifest;
      return { ...manifest, inUse: () => {
        if (!this.topics || !this.materials) throw new Error("Workspace snapshot unavailable");
        if (manifest.id === "stage-reader") return this.materials.filter(item => item.kind === "book" || item.kind === "article").length;
        if (manifest.id === "stage-timeline") return this.materials.filter(item => item.kind === "media").length;
        const id = manifest.id === "dojo-feynman" ? "feynman" : "shadowing";
        return this.topics.filter(topic => topic.toolkits.includes(id) || topic.toolkits.includes(`dojo-${id}`)).length;
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
  async importMaterial(input: ImportMaterialInput, topicId?: string) { if (topicId) { const topic = await this.store.getTopic(topicId); if (!topic) throw new Error("Topic not found"); if (topic.materialId) throw new Error("课题已有材料，无法替换"); } const material = await this.store.importMaterial(input); if (topicId) await this.store.updateTopic(topicId, { materialId: material.id }); await this.refresh(); return material; }
  async setSpeechConfig(config: Record<string, string>): Promise<void> {
    if (Object.entries(config).some(([key, value]) => !["ttsProvider", "ttsEndpoint", "ttsModel", "ttsVoice", "azureRegion", "asrProvider", "asrLoopbackUrl", "asrModel"].includes(key) || typeof value !== "string")) throw new Error("Invalid speech settings");
    this.speechConfig = { ...config }; await this.refresh(); await this.save({ speech: this.speechConfig });
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
  async setAgentConfig(config: ObsidianAgentConfig): Promise<void> {
    if (!["", "dsh", "claude", "codex"].includes(config.agentId) || typeof config.model !== "string" || typeof config.effort !== "string" || (config.persona !== "sanctuary" && config.persona !== "studio")) throw new Error("Invalid agent config");
    this.agentId = config.agentId; this.model = config.model; this.effort = config.effort; this.persona = config.persona;
    await this.refresh(); await this.save(config);
  }
  async setPlugins(config: PluginsConfigFile): Promise<void> { this.config = config; await this.refresh(); const available = this.runtime.statuses().some(plugin => plugin.id === "guide-acp" && plugin.state === "active"); for (const view of this.views) view.setGuideAvailable(available); await this.save({ preset: config.preset ?? "all", plugins: config.plugins ?? {} }); }
  getPersona(): "sanctuary" | "studio" { return this.persona; }
  getAgentConfig(): ObsidianAgentConfig { return { agentId: this.agentId, model: this.model, effort: this.effort, persona: this.persona }; }
  getSpeechConfig(): Record<string, string> { return { ...this.speechConfig }; }
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

export class PithWorkspaceView extends obsidian.ItemView {
  private view: PithObsidianView | null = null;
  private generation = 0;
  private homeRequest = 0;
  private readonly controller: PithObsidianController;
  private readonly workspace: ObsidianWorkspace | undefined;
  private readonly guideByTopic: Map<string, boolean>;
  constructor(leaf: ObsidianLeaf, controller: PithObsidianController, _host: HostPort, workspace?: ObsidianWorkspace) { super(leaf); this.controller = controller; this.workspace = workspace; this.guideByTopic = controller.guideVisibility; }
  getViewType(): string { return PITH_VIEW_TYPE; }
  getDisplayText(): string { return "Pith"; }
  getIcon(): string { return "book-open"; }

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
    root.innerHTML = `<style>${obsidianStyles}</style><header class="pith-view-header"><strong>Pith</strong></header><div class="pith-home-scroll"><main class="pith-home"><h1>注意力罗盘</h1><div class="pith-home-actions"><button data-home-new>新建课题</button><button data-home-import>导入材料</button><input type="file" accept=".epub,.pdf,.md,.markdown" multiple hidden></div><form class="pith-home-form" hidden><label>课题名称<input name="title" required></label><label>探索目标<input name="target"></label><label>下一步行动<input name="nextAction"></label><button>创建课题</button></form><div class="pith-home-status" role="status"></div><section class="pith-focus">${compass.focusRecommendation ? `<div><span class="pith-topic-status">下一步 · 15 分钟</span><br><strong>${escape(compass.focusRecommendation.nextAction)}</strong><br>${escape(compass.focusRecommendation.title)}</div><button data-topic="${escape(compass.focusRecommendation.topicId)}">继续探索</button>` : "选择一个课题，开始今天的探索。"}</section>${[["探索中", compass.exploring], ["已沉淀", compass.settled]].map(([label, topics]) => `<section><div class="pith-home-heading"><h2>${label}</h2><span>${(topics as typeof compass.exploring).length}</span></div><div class="pith-topic-grid">${(topics as typeof compass.exploring).map(topic => `<button class="pith-topic-card" data-topic="${escape(topic.id)}"><span class="pith-topic-status ${topic.status === "settled" ? "settled" : ""}">${label}</span><strong>${escape(topic.title)}</strong><span>${escape(topic.nextAction || topic.target || "尚未设置下一步")}</span></button>`).join("")}</div></section>`).join("")}</main></div>`;
    const input = root.querySelector<HTMLInputElement>('input[type="file"]');
    const form = root.querySelector<HTMLFormElement>("form");
    const status = root.querySelector<HTMLElement>(".pith-home-status");
    if (!input || !form || !status) throw new Error("首页初始化失败");
    let importTopic: string | undefined;
    root.querySelector<HTMLButtonElement>("[data-home-new]")!.onclick = () => { form.hidden = !form.hidden; };
    root.querySelector<HTMLButtonElement>("[data-home-import]")!.onclick = () => { importTopic = undefined; input.click(); };
    for (const button of root.querySelectorAll<HTMLButtonElement>("[data-topic]")) button.onclick = () => { const id = button.dataset.topic; if (!id) return; void (async () => { const topic = await this.controller.openTopic(id); if (generation !== this.generation) return; if (!topic) throw new Error("课题不存在"); if (!topic.materialId) { importTopic = id; status.textContent = "选择材料以打开此课题"; input.click(); return; } await this.openTopic(id); })().catch(error => this.report(error)); };
    form.onsubmit = event => { event.preventDefault(); void (async () => { const data = new FormData(form); const title = String(data.get("title") || "").trim(); if (!title) throw new Error("请输入课题名称"); await this.controller.store.createTopic({ title, target: String(data.get("target") || ""), nextAction: String(data.get("nextAction") || "") }); if (generation === this.generation) await this.onOpen(); })().catch(error => this.report(error)); };
    input.onchange = () => { void (async () => { const files = Array.from(input.files || []); if (!files.length) return; if (files.some(file => !/\.(epub|pdf|md|markdown)$/i.test(file.name))) throw new Error("仅支持 EPUB、PDF 和 Markdown 文件"); const entries = await Promise.all(files.map(async file => ({ name: file.name, mimeType: file.type || "application/octet-stream", bytes: new Uint8Array(await file.arrayBuffer()) }))); if (generation !== this.generation) return; const first = files[0]!; const kind = files.some(file => /\.(epub|pdf)$/i.test(file.name)) ? "book" : "article"; const material = await this.controller.importMaterial({ title: first.name, kind, files: entries }, importTopic); if (!importTopic) { const topic = await this.controller.store.createTopic({ title: first.name.replace(/\.[^.]+$/, ""), materialId: material.id }); importTopic = topic.id; } if (generation === this.generation) await this.openTopic(importTopic); })().catch(error => this.report(error)).finally(() => { input.value = ""; }); };
  }

  async onClose(): Promise<void> { this.generation++; if (this.view) { this.controller.releaseView(this.view); this.view = null; } }

  private report(error: unknown): void { new obsidian.Notice(error instanceof Error ? error.message : String(error)); }
  private async openTopic(id: string): Promise<void> {
    const generation = ++this.generation;
    const topic = await this.controller.openTopic(id);
    if (generation !== this.generation) return;
    if (!topic || !topic.materialId) throw new Error("课题没有关联材料");
    const material = await this.controller.store.getMaterial(topic.materialId);
    if (generation !== this.generation) return;
    if (!material || !material.files.length) throw new Error("材料没有可读取的文件");
    let currentFile = material.files[0]!.name;
    let renderGeneration = 0;
    const dojos = (): DojoToolkitDescriptor[] => ["shadowing", "feynman"].flatMap(id => { const service = this.controller.runtime.getService<DojoToolkitDescriptor>(`dojo.${id}`); return service ? [service] : []; });
    const render = async (name: string): Promise<void> => {
      const request = ++renderGeneration;
      const document = await this.controller.renderMaterialFile(material.id, name);
      if (generation === this.generation && request === renderGeneration && this.view) { currentFile = name; this.view.render({ title: topic.title, html: document.html, files: material.files, currentFile: name, sections: document.sections }); }
    };
    if (this.view) this.controller.releaseView(this.view);
    let originatingView: PithObsidianView;
    originatingView = this.controller.createView(this.contentEl, {
      guideVisibilityChanged: visible => { this.guideByTopic.set(topic.id, visible); },
      home: () => this.onOpen(),
      openFile: render,
      loadAudio: name => this.controller.readAudioAsset(material.id, name),
      synthesizeSpeech: async (text, signal) => { const tts = this.controller.runtime.getService<SpeechTtsService>("speech.tts"); if (!tts || !tts.synthesizeSpeech) throw new Error("未连接高品质语音引擎，请在设置中配置 Kokoro 或云端语音"); return tts.synthesizeSpeech(text, signal); },
      openDojo: (text, locator) => { if (this.view) this.view.openDojo(dojos(), text, { file: currentFile, locator: locator || "text:offset:0", quote: text }); },
      selection: (action, text, locator) => { const anchor = { file: currentFile, locator: locator || "text:offset:0", quote: text }; if (action === "ask" || action === "note") { if (this.view) this.view.quoteSelection(anchor, action === "ask" ? "chat" : "notes"); return; } void this.controller.engine.captureSelection({ topicId: topic.id, kind: action, body: text, anchor }).then(async () => { if (this.view) await this.view.refreshGuide(); }).catch(error => this.report(error)); },
      guideData: async () => { const updated = await this.controller.store.getTopic(topic.id); if (!updated) throw new Error("课题不存在"); const guide = this.controller.runtime.getService<GuideAgentService>("guide.agent"); return { notes: updated.notes, toolkits: updated.toolkits, conversation: await this.controller.engine.getConversation(topic.id), actions: guide && guide.quickActionsForTopic ? guide.quickActionsForTopic(updated, dojos()) : [] }; },
      sendGuide: async (text, anchor, saveAsNote) => { await this.controller.engine.sendMessage({ topicId: topic.id, text, anchor, saveAsNote }); },
      savePractice: async (body, anchor) => { await this.controller.engine.captureSelection({ topicId: topic.id, kind: "practice", body, anchor }); },
      mountDojo: async id => { const current = await this.controller.store.getTopic(topic.id); if (generation !== this.generation || this.view !== originatingView) throw new Error("课题已切换"); if (!current) throw new Error("课题不存在"); const updated = current.toolkits.includes(id) || current.toolkits.includes(`dojo-${id}`) ? current : await this.controller.store.updateTopic(topic.id, { toolkits: [...current.toolkits, id] }); if (generation !== this.generation || this.view !== originatingView) throw new Error("课题已切换"); originatingView.setToolkits(updated.toolkits); },
    });
    this.view = originatingView;
    this.view.setGuideVisible(this.guideByTopic.get(topic.id) ?? false);
    this.view.setToolkits(topic.toolkits);
    await render(material.files[0]!.name);
    if (generation === this.generation && this.view) await this.view.refreshGuide();
  }
}

const SettingTabBase = obsidian.PluginSettingTab || class { containerEl!: HTMLElement; constructor(_app: ObsidianPluginBase["app"], _plugin: ObsidianPluginBase) {} };
export class PithSettingTab extends SettingTabBase {
  private readonly controller: PithObsidianController;
  private readonly plugin: PithObsidianPlugin;
  constructor(app: ObsidianPluginBase["app"], plugin: PithObsidianPlugin, controller: PithObsidianController) { super(app, plugin); this.plugin = plugin; this.controller = controller; }
  display(): void {
    const root = this.containerEl; root.replaceChildren();
    const doc = root.ownerDocument;
    const addSelect = (label: string, choices: readonly (readonly [string, string])[], value: string): HTMLSelectElement => { const row = doc.createElement("label"); row.textContent = label; const select = doc.createElement("select"); for (const [id, title] of choices) { const option = doc.createElement("option"); option.value = id; option.textContent = title; select.append(option); } select.value = value; row.append(select); root.append(row); return select; };
    const config = this.controller.getAgentConfig(), speech = this.controller.getSpeechConfig();
    const pathLabel = doc.createElement("label"); pathLabel.textContent = "Pith 数据目录（相对于 Vault）"; const pathInput = doc.createElement("input"); pathInput.value = this.plugin.getWorkspacePath(); pathLabel.append(pathInput); root.append(pathLabel);
    const agent = addSelect("本机 Agent", [["", "离线"], ["dsh", "dsh"], ["claude", "claude"], ["codex", "codex"]], config.agentId);
    const persona = addSelect("术语风格", [["sanctuary", "花园 / 园丁"], ["studio", "工作区 / 向导"]], config.persona);
    const tts = addSelect("TTS", [["kokoro-local", "Kokoro 本机"], ["openai-tts", "OpenAI TTS"], ["azure-neural", "Azure Neural"]], speech.ttsProvider || "kokoro-local");
    const asr = addSelect("ASR", [["whisper-local", "Whisper 本机"], ["sensevoice-local", "SenseVoice 本机"], ["openai-whisper", "OpenAI Whisper"]], speech.asrProvider || "whisper-local");
    const status = doc.createElement("p"); status.setAttribute("role", "status"); const scan = doc.createElement("button"); scan.textContent = "扫描并配置本机 Agent"; scan.onclick = () => { scan.disabled = true; void this.controller.detectAgents(true).then(async agents => { const available = agents.find(item => item.available && ["dsh", "claude", "codex"].includes(item.id)); if (!available) { status.textContent = "未发现可用 Agent"; return; } agent.value = available.id; await this.controller.setAgentConfig({ ...config, agentId: available.id as ObsidianAgentConfig["agentId"], persona: persona.value as ObsidianAgentConfig["persona"] }); status.textContent = `已配置 ${available.label}`; }).catch(error => { status.textContent = String(error); }).finally(() => { scan.disabled = false; }); };
    const save = doc.createElement("button"); save.textContent = "保存设置"; save.onclick = () => { void (async () => { validateWorkspacePath(pathInput.value); await this.controller.setAgentConfig({ ...config, agentId: agent.value as ObsidianAgentConfig["agentId"], persona: persona.value as ObsidianAgentConfig["persona"] }); await this.controller.setSpeechConfig({ ...speech, ttsProvider: tts.value, asrProvider: asr.value }); const changed = await this.plugin.setWorkspacePath(pathInput.value); status.textContent = changed ? "目录已保存，重载插件后生效；原目录未更改" : "设置已保存"; })().catch(error => { status.textContent = String(error); }); }; root.append(scan, save, status);
  }
}

export default class PithObsidianPlugin extends obsidian.Plugin {
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
    const host = createObsidianHostPort(this.app.vault.adapter, this.workspacePath, new NodeAgentProcessPort());
    const controller = new PithObsidianController(host);
    this.controller = controller;
    try {
      await controller.initialize();
      this.registerView(PITH_VIEW_TYPE, leaf => new PithWorkspaceView(leaf, controller, host, this.app.workspace));
      if (this.addSettingTab && obsidian.PluginSettingTab) this.addSettingTab(new PithSettingTab(this.app, this, controller));
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
    if (workspace.leftSplit) workspace.leftSplit.collapse();
    const existing = workspace.getLeavesOfType(PITH_VIEW_TYPE)[0];
    const leaf = existing ?? workspace.getLeaf("tab");
    if (!existing) await leaf.setViewState({ type: PITH_VIEW_TYPE, active: true });
    await workspace.revealLeaf(leaf);
  }
}
