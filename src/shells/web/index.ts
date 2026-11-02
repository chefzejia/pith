/**
 * Standalone Web / Desktop Shell entrypoint (`pith web` / Tauri shell).
 * Boots Pith Core + Built-in Plugins over a HostPort without Obsidian or any third-party host.
 */

import { PluginRuntime, type AttentionEngine, type GuideProvider, type HostPort, type Material, type PluginsConfigFile, type Topic, type WorkspaceStore } from "../../core/index.ts";
import { builtinRegistry } from "../../plugins/all.ts";
import { readerInUse } from "../../plugins/stage-reader/index.ts";
import { timelineInUse } from "../../plugins/stage-timeline/index.ts";
import { shadowingInUse } from "../../plugins/dojo-shadowing/index.ts";

export interface WorkspaceSnapshot { topics: readonly Topic[]; materials: readonly Material[]; known: boolean }

export function bootStandaloneShell(host: HostPort, config: PluginsConfigFile = {}, options?: { store: WorkspaceStore; engine: AttentionEngine; snapshot: WorkspaceSnapshot; provider?: GuideProvider }): PluginRuntime {
  const manifests = builtinRegistry.list().map(manifest => {
    if (!options) return manifest;
    const snapshot = options.snapshot;
    const count = manifest.id === "stage-reader" ? () => readerInUse(snapshot.materials)
      : manifest.id === "stage-timeline" ? () => timelineInUse(snapshot.materials)
      : manifest.id === "dojo-shadowing" ? () => shadowingInUse(snapshot.topics)
      : manifest.id === "dojo-feynman" ? () => snapshot.topics.filter(topic => topic.toolkits.includes("feynman") || topic.toolkits.includes("dojo-feynman")).length : undefined;
    return count ? { ...manifest, inUse: () => { if (!snapshot.known) throw new Error("Workspace snapshot unavailable"); return count(); } } : manifest;
  });
  const runtime = new PluginRuntime(manifests, {
    host,
    store: options ? options.store : host.storage,
    engine: options ? options.engine : {},
    window: {},
    ...(options && options.provider ? { "guide.provider": options.provider } : {}),
  });
  runtime.reconcile(config);
  return runtime;
}
