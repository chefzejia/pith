import { DefaultAttentionEngine, DefaultWorkspaceStore, MutationQueue, PluginRuntime, type AgentProcessPort, type HostPort, type PluginsConfigFile, type SelectionAnchor, type StorageEntry, type WorkspaceStoragePort } from "../../core/index.ts";
import { builtinRegistry } from "../../plugins/all.ts";
import { PithObsidianView, type ObsidianViewActions } from "./plugin.ts";

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
  return { id: "obsidian", storage, ...(processPort ? { process: processPort } : {}) };
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
      const value = data as { preset?: unknown; persona?: unknown; plugins?: unknown };
      if ((value.preset !== "all" && value.preset !== "essentials") || (value.persona !== "sanctuary" && value.persona !== "studio") || !value.plugins || typeof value.plugins !== "object" || Array.isArray(value.plugins)) throw new Error("Invalid settings");
      this.persona = value.persona;
      this.config = { preset: value.preset, plugins: value.plugins as NonNullable<PluginsConfigFile["plugins"]> };
    }
    await this.refresh();
  }
  private async refresh(): Promise<void> {
    this.topics = null; this.materials = null;
    try { [this.topics, this.materials] = await Promise.all([this.store.listTopics(), this.store.listMaterials()]); }
    finally { this.runtime.reconcile(this.config); }
  }
  private async save(): Promise<void> {
    await MutationQueue.forStorage(this.host.storage).run(async () => {
      await this.host.storage.mkdir("_cache");
      await this.host.storage.writeText("_cache/web-settings.json", `${JSON.stringify({ preset: this.config.preset ?? "all", persona: this.persona, plugins: this.config.plugins ?? {} }, null, 2)}\n`);
    });
  }
  async openCompass() { await this.refresh(); return this.engine.compass(); }
  async openTopic(id: string) { return this.store.getTopic(id); }
  async captureHighlight(topicId: string, body: string, anchor?: SelectionAnchor) { return this.engine.captureSelection({ topicId, kind: "highlight", body, anchor }); }
  async setPersona(persona: "sanctuary" | "studio"): Promise<void> { this.persona = persona; await this.save(); }
  async setPlugins(config: PluginsConfigFile): Promise<void> { this.config = config; await this.refresh(); const available = this.runtime.statuses().some(plugin => plugin.id === "guide-acp" && plugin.state === "active"); for (const view of this.views) view.setGuideAvailable(available); await this.save(); }
  getPersona(): "sanctuary" | "studio" { return this.persona; }
  createView(root: HTMLElement, actions: ObsidianViewActions): PithObsidianView {
    const view = new PithObsidianView(root, actions);
    view.setGuideAvailable(this.runtime.statuses().some(plugin => plugin.id === "guide-acp" && plugin.state === "active"));
    this.views.add(view);
    return view;
  }
  dispose(): void { for (const view of this.views) view.dispose(); this.views.clear(); this.runtime.stop(); }
}
