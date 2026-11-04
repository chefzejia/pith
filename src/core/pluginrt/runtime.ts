/**
 * Pith Plugin Runtime (modeled after magpie's `internal/pluginrt/pluginrt.go`).
 *
 * Core guarantees:
 * 1. Dependency-ordered topological activation (`requires` / `provides`).
 * 2. Reverse-order cascading disposal (`newest first`) when a plugin or a
 *    service it depends on is turned off.
 * 3. Fault isolation: a plugin whose `apply()` throws has its partial
 *    registrations undone (`onDispose` in reverse), is marked `failed`, and
 *    never stops other plugins from running.
 * 4. `inUse` guard (with transitive requirement propagation): a plugin whose
 *    `inUse()` returns > 0 (or throws) stays enabled even under `essentials`
 *    or explicit off, and automatically pulls in the providers of services it
 *    `requires` so active Topics never stall in `pending`.
 * 5. Service stacking: `provide(name, svc)` pushes onto a per-service stack
 *    (top-of-stack serves); disposing removes that exact instance and falls
 *    back cleanly to any earlier provider underneath. Synchronous `apply(ctx)`
 *    eliminates registration races; slow I/O belongs in lazy service methods.
 */

import {
  compileSettingsSchema,
  type SettingsSchema,
  type ValidatedSettingsSchema,
} from "./schema.ts";

export const HOST_API_VERSION = "1.0";

export const CORE_SERVICES = ["host", "store", "engine", "window"] as const;

export type PluginState = "off" | "pending" | "active" | "failed" | "disposed";

export type ConfigSource = "default" | "preset" | "user" | "in-use";

export interface PluginPart {
  readonly slot: "stage" | "dojo" | "guide" | "toolbar" | "nav.page" | "settings.section";
  readonly key: string;
}

export interface PluginManifest {
  readonly id: string;
  /** Caret range of the host API this plugin targets, e.g. "^1" or "^1.0". */
  readonly api?: string;
  readonly requires?: readonly string[];
  readonly provides?: readonly string[];
  /** Whether this plugin remains on under the "essentials" preset. */
  readonly essential?: boolean;
  readonly name: string;
  readonly description: string;
  /** Human-readable template for 1 or {n} items in use. */
  readonly oneInUse?: string;
  readonly manyInUse?: string;
  /**
   * Returns how many user entities (e.g. active Topics or Materials) currently
   * depend on this plugin. If > 0 (or if it throws), the plugin stays on.
   */
  readonly inUse?: () => number;
  readonly parts?: readonly PluginPart[];
  readonly settings?: SettingsSchema;
  readonly apply?: (ctx: PluginContext) => void;
}

export interface PluginStatus {
  readonly id: string;
  readonly state: PluginState;
  readonly why?: string;
  readonly parts: readonly PluginPart[];
  readonly source?: ConfigSource;
  readonly inUseCount?: number;
}

export interface PluginsConfigFile {
  readonly preset?: "essentials" | "all";
  readonly plugins?: Readonly<
    Record<
      string,
      {
        readonly enabled?: boolean;
        readonly config?: Readonly<Record<string, unknown>>;
      }
    >
  >;
}

export interface ComposedPluginPlan {
  readonly id: string;
  readonly enabled: boolean;
  readonly chosenByUser: boolean;
  readonly source: ConfigSource;
  readonly inUseCount: number;
  readonly config: Record<string, boolean | number | string>;
}

export class PluginContext {
  readonly id: string;
  readonly config: Readonly<Record<string, boolean | number | string>>;
  private readonly rt: PluginRuntime;
  private readonly disposes: Array<() => void> = [];
  private readonly contributedParts: PluginPart[] = [];
  private readonly providedServices: string[] = [];

  constructor(
    id: string,
    config: Readonly<Record<string, boolean | number | string>>,
    rt: PluginRuntime,
    initialParts: readonly PluginPart[] = [],
  ) {
    this.id = id;
    this.config = { ...config };
    this.rt = rt;
    this.contributedParts.push(...initialParts);
  }

  onDispose(fn: () => void): void {
    this.disposes.push(fn);
  }

  contribute(slot: PluginPart["slot"], key: string): void {
    this.contributedParts.push({ slot, key });
  }

  provide<T>(name: string, service: T): void {
    this.rt.setService(name, service);
    this.providedServices.push(name);
    this.onDispose(() => {
      this.rt.deleteService(name, service);
    });
  }

  service<T = unknown>(name: string): T | undefined {
    return this.rt.getService<T>(name);
  }

  /** Internal runtime accessors */
  getParts(): readonly PluginPart[] {
    return [...this.contributedParts];
  }

  getProvidedServices(): readonly string[] {
    return [...this.providedServices];
  }

  undo(): void {
    for (let i = this.disposes.length - 1; i >= 0; i -= 1) {
      const dispose = this.disposes[i]!;
      try {
        dispose();
      } catch (err) {
        console.warn(`pluginrt: ${this.id}: disposing threw:`, err);
      }
    }
    this.disposes.length = 0;
  }
}

interface RunningPlugin {
  readonly manifest: PluginManifest;
  readonly schema: ValidatedSettingsSchema | null;
  state: PluginState;
  why: string;
  ctx: PluginContext | null;
  wanted: boolean;
  source: ConfigSource;
  inUseCount: number;
  attemptedConfig: Readonly<Record<string, boolean | number | string>> | null;
  activationRank: number | null;
}

export class PluginRegistry {
  private readonly entries = new Map<string, { manifest: PluginManifest; schema: ValidatedSettingsSchema | null }>();

  register(manifest: PluginManifest): void {
    const id = manifest.id.trim();
    if (!id) {
      throw new Error("pluginrt: a plugin with no id");
    }
    if (this.entries.has(id)) {
      throw new Error(`pluginrt: two plugins "${id}"`);
    }
    const schema = manifest.settings ? compileSettingsSchema(id, manifest.settings) : null;
    this.entries.set(id, { manifest: { ...manifest, id }, schema });
  }

  list(): PluginManifest[] {
    return [...this.entries.values()]
      .map((item) => item.manifest)
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  getSchema(id: string): ValidatedSettingsSchema | null {
    return this.entries.get(id)?.schema ?? null;
  }
}

export const builtinRegistry = new PluginRegistry();

export function registerPlugin(manifest: PluginManifest): void {
  builtinRegistry.register(manifest);
}

export class PluginRuntime {
  private readonly plugins = new Map<string, RunningPlugin>();
  private readonly order: string[] = [];
  private readonly services = new Map<string, unknown[]>();
  private nextActivationRank = 0;

  constructor(
    manifests: readonly PluginManifest[],
    coreServices: Readonly<Record<string, unknown>> = {},
  ) {
    for (const name of CORE_SERVICES) {
      this.services.set(name, [coreServices[name] ?? {}]);
    }
    for (const [name, svc] of Object.entries(coreServices)) {
      this.services.set(name, [svc]);
    }
    for (const manifest of manifests) {
      const schema = manifest.settings ? compileSettingsSchema(manifest.id, manifest.settings) : null;
      this.plugins.set(manifest.id, {
        manifest,
        schema,
        state: "off",
        why: "",
        ctx: null,
        wanted: false,
        source: "default",
        inUseCount: 0,
        attemptedConfig: null,
        activationRank: null,
      });
    }
  }

  /**
   * Compose each plugin's desired enabled state and validated config across the
   * 4 Magpie layers: default -> preset -> user -> in-use.
   */
  compose(file: PluginsConfigFile = {}): ComposedPluginPlan[] {
    const preset = file.preset ?? "all";
    const planById = new Map<string, ComposedPluginPlan>();
    const sortedIds = [...this.plugins.keys()].sort();

    for (const id of sortedIds) {
      const entry = this.plugins.get(id)!;
      const m = entry.manifest;

      // Layer 1: default (every plugin on)
      let enabled = true;
      let source: ConfigSource = "default";

      // Layer 2: preset (essentials leaves non-essential plugins off)
      if (preset === "essentials" && !m.essential) {
        enabled = false;
        source = "preset";
      }

      // Layer 3: user row in plugins.yml
      const userRow = file.plugins?.[id];
      if (userRow?.enabled !== undefined) {
        enabled = userRow.enabled;
        source = "user";
      }
      const chosenByUser = enabled;

      // Layer 4: inUse guard (unknown/error counts as in-use -> stays on)
      let inUseCount = 0;
      if (m.inUse) {
        try {
          inUseCount = Math.max(0, Math.floor(m.inUse()));
        } catch {
          inUseCount = 1;
        }
      }
      if (inUseCount > 0 && !enabled) {
        enabled = true;
        source = "in-use";
      }

      const config = entry.schema ? entry.schema.composeConfig(userRow?.config) : {};
      planById.set(id, {
        id,
        enabled,
        chosenByUser,
        source,
        inUseCount,
        config,
      });
    }

    // Layer 4b: Transitive requirement propagation — if an enabled plugin requires
    // a service not yet provided by Core or any enabled plugin, pull in its provider.
    while (true) {
      let promoted = false;
      for (const id of sortedIds) {
        const plan = planById.get(id)!;
        if (!plan.enabled) continue;
        const manifest = this.plugins.get(id)!.manifest;
        for (const req of manifest.requires ?? []) {
          if (this.isCoreOrSatisfiedByEnabled(req, planById)) continue;
          const providerId = sortedIds.find((candidateId) =>
            this.plugins.get(candidateId)!.manifest.provides?.includes(req),
          );
          if (providerId) {
            const target = planById.get(providerId)!;
            planById.set(providerId, {
              ...target,
              enabled: true,
              source: "in-use",
            });
            promoted = true;
          }
        }
      }
      if (!promoted) break;
    }

    return sortedIds.map((id) => planById.get(id)!);
  }

  /**
   * Reconcile running plugins to match `wanted` and `configs` (or a `PluginsConfigFile`).
   */
  reconcile(
    wantedOrFile: Readonly<Record<string, boolean>> | PluginsConfigFile,
    configs?: Readonly<Record<string, Readonly<Record<string, unknown>>>>,
  ): void {
    let wantedMap: Record<string, boolean> = {};
    let configMap: Record<string, Record<string, boolean | number | string>> = {};

    if (isConfigFile(wantedOrFile, configs)) {
      const plans = this.compose(wantedOrFile);
      for (const plan of plans) {
        wantedMap[plan.id] = plan.enabled;
        configMap[plan.id] = plan.config;
        const p = this.plugins.get(plan.id);
        if (p) {
          p.source = plan.source;
          p.inUseCount = plan.inUseCount;
        }
      }
    } else {
      const rawWanted = wantedOrFile as Readonly<Record<string, boolean>>;
      for (const [id, p] of this.plugins) {
        wantedMap[id] = Boolean(rawWanted[id]);
        configMap[id] = p.schema ? p.schema.composeConfig(configs?.[id]) : {};
      }
    }

    for (const [id, p] of this.plugins) {
      p.wanted = Boolean(wantedMap[id]);
    }

    // Step 1: Off first — every plugin no longer wanted, and every active plugin
    // that requires a service provided by one going off, disposed newest first.
    const going = new Set<string>();
    const reconfiguring = new Set<string>();
    for (const [id, p] of this.plugins) {
      const applied = p.ctx ? p.ctx.config : p.state === "failed" ? p.attemptedConfig : null;
      if (!applied || !p.wanted) continue;
      const next = configMap[id] ?? {};
      const keys = Object.keys(applied);
      if (keys.length !== Object.keys(next).length || keys.some(key => applied[key] !== next[key])) reconfiguring.add(id);
    }
    while (true) {
      let more = false;
      const services = new Set([...reconfiguring].flatMap(id => {
        const p = this.plugins.get(id)!;
        return [...(p.manifest.provides ?? []), ...(p.ctx ? p.ctx.getProvidedServices() : [])];
      }));
      for (const id of this.order) {
        if (reconfiguring.has(id)) continue;
        const p = this.plugins.get(id)!;
        if ((p.manifest.requires ?? []).some(req => services.has(req)) || p.ctx!.getProvidedServices().some(service => services.has(service))) {
          reconfiguring.add(id);
          more = true;
        }
      }
      if (!more) break;
    }
    while (true) {
      let more = false;
      for (const id of this.order) {
        if (going.has(id)) continue;
        const p = this.plugins.get(id)!;
        if (!p.wanted || reconfiguring.has(id) || this.needsGoing(p, going)) {
          going.add(id);
          more = true;
        }
      }
      if (!more) break;
    }

    for (let i = this.order.length - 1; i >= 0; i -= 1) {
      const id = this.order[i]!;
      if (going.has(id)) {
        this.disposePlugin(this.plugins.get(id)!);
        if (!reconfiguring.has(id)) this.plugins.get(id)!.activationRank = null;
      }
    }
    for (const id of reconfiguring) {
      const p = this.plugins.get(id)!;
      if (p.state === "failed") { p.state = "pending"; p.why = ""; }
    }

    // Step 2: On next — apply wanted plugins once their required services exist.
    const ids = [...this.plugins.keys()].sort((a, b) => (this.plugins.get(a)!.activationRank ?? Infinity) - (this.plugins.get(b)!.activationRank ?? Infinity) || a.localeCompare(b));
    while (true) {
      let appliedAny = false;
      for (const id of ids) {
        const p = this.plugins.get(id)!;
        if (!p.wanted || p.state === "active" || p.state === "failed") {
          continue;
        }
        const wantApi = p.manifest.api ?? "^1";
        if (!isApiCompatible(wantApi)) {
          p.state = "failed";
          p.why = `written for host API ${wantApi}, this is ${HOST_API_VERSION}`;
          continue;
        }
        const missing = this.missingServices(p.manifest);
        if (missing.length > 0) {
          p.state = "pending";
          p.why = `waiting for ${missing.join(", ")}`;
          continue;
        }
        const appliedOk = this.applyPlugin(p, configMap[id] ?? {});
        if (appliedOk) {
          appliedAny = true;
        }
      }
      if (!appliedAny) break;
    }

    for (const p of this.plugins.values()) {
      if (!p.wanted && p.state !== "disposed") {
        p.state = "off";
        p.why = "";
      }
    }
  }

  stop(): void {
    while (this.order.length > 0) {
      const newestId = this.order[this.order.length - 1]!;
      this.disposePlugin(this.plugins.get(newestId)!);
    }
  }

  active(id: string): boolean {
    return this.plugins.get(id)?.state === "active";
  }

  statuses(): PluginStatus[] {
    return [...this.plugins.values()]
      .map((p) => ({
        id: p.manifest.id,
        state: p.state,
        ...(p.why ? { why: p.why } : {}),
        parts: p.ctx ? p.ctx.getParts() : [],
        source: p.source,
        inUseCount: p.inUseCount,
      }))
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  /** Internal stacked service table helpers used by PluginContext (top of stack serves). */
  setService(name: string, value: unknown): void {
    const stack = this.services.get(name);
    if (stack) {
      stack.push(value);
    } else {
      this.services.set(name, [value]);
    }
  }

  deleteService(name: string, expected: unknown): void {
    const stack = this.services.get(name);
    if (!stack) return;
    const idx = stack.lastIndexOf(expected);
    if (idx >= 0) {
      stack.splice(idx, 1);
    }
    if (stack.length === 0) {
      this.services.delete(name);
    }
  }

  getService<T = unknown>(name: string): T | undefined {
    const stack = this.services.get(name);
    if (!stack || stack.length === 0) return undefined;
    return stack[stack.length - 1] as T;
  }

  private isCoreOrSatisfiedByEnabled(
    serviceName: string,
    planById: ReadonlyMap<string, ComposedPluginPlan>,
  ): boolean {
    if ((CORE_SERVICES as readonly string[]).includes(serviceName)) return true;
    if (this.services.has(serviceName) && !this.isPluginProvided(serviceName)) return true;
    for (const [id, plan] of planById) {
      if (!plan.enabled) continue;
      if (this.plugins.get(id)!.manifest.provides?.includes(serviceName)) {
        return true;
      }
    }
    return false;
  }

  private isPluginProvided(serviceName: string): boolean {
    for (const p of this.plugins.values()) {
      if (p.manifest.provides?.includes(serviceName)) return true;
    }
    return false;
  }

  private needsGoing(p: RunningPlugin, going: ReadonlySet<string>): boolean {
    const reqs = p.manifest.requires ?? [];
    if (reqs.length === 0) return false;
    for (const req of reqs) {
      const stack = this.services.get(req);
      if (!stack || stack.length === 0) return true;
      // Check if any remaining active provider NOT in `going` still serves `req`
      let stillServed = (CORE_SERVICES as readonly string[]).includes(req);
      if (!stillServed) {
        for (const [id, other] of this.plugins) {
          if (going.has(id) || other.state !== "active" || !other.ctx) continue;
          if (other.ctx.getProvidedServices().includes(req)) {
            stillServed = true;
            break;
          }
        }
      }
      if (!stillServed) return true;
    }
    return false;
  }

  private missingServices(manifest: PluginManifest): string[] {
    const missing: string[] = [];
    for (const req of manifest.requires ?? []) {
      if (!this.services.has(req)) {
        missing.push(req);
      }
    }
    return missing;
  }

  private applyPlugin(
    p: RunningPlugin,
    config: Readonly<Record<string, boolean | number | string>>,
  ): boolean {
    const ctx = new PluginContext(p.manifest.id, config, this, p.manifest.parts ?? []);
    p.attemptedConfig = { ...config };
    if (p.activationRank === null) p.activationRank = this.nextActivationRank++;
    try {
      if (p.manifest.apply) {
        p.manifest.apply(ctx);
      }
      p.state = "active";
      p.why = "";
      p.ctx = ctx;
      this.order.push(p.manifest.id);
      return true;
    } catch (err) {
      ctx.undo();
      p.state = "failed";
      p.why = err instanceof Error ? err.message : String(err);
      p.ctx = null;
      return false;
    }
  }

  private disposePlugin(p: RunningPlugin): void {
    if (p.ctx) {
      p.ctx.undo();
    }
    p.ctx = null;
    p.state = "disposed";
    p.why = "";
    const idx = this.order.indexOf(p.manifest.id);
    if (idx >= 0) {
      this.order.splice(idx, 1);
    }
  }
}

export function isApiCompatible(wantRange = "^1"): boolean {
  const range = wantRange === "" ? "^1" : wantRange;
  if (!range.startsWith("^")) return false;
  const want = parseMajorMinor(range.slice(1));
  const host = parseMajorMinor(HOST_API_VERSION);
  if (!want || !host) return false;
  return want.major === host.major && want.minor <= host.minor;
}

function parseMajorMinor(version: string): { major: number; minor: number } | null {
  const parts = version.split(".");
  if (!parts[0] || !/^\d+$/.test(parts[0])) return null;
  const major = Number.parseInt(parts[0], 10);
  if (parts.length === 1 || parts[1] === "") {
    return { major, minor: 0 };
  }
  if (!/^\d+$/.test(parts[1]!)) return null;
  const minor = Number.parseInt(parts[1]!, 10);
  return { major, minor };
}

function isConfigFile(
  value: Readonly<Record<string, boolean>> | PluginsConfigFile,
  configs?: unknown,
): value is PluginsConfigFile {
  if (configs !== undefined) return false;
  const keys = Object.keys(value);
  if (keys.length === 0) return true;
  return keys.every((k) => k === "preset" || k === "plugins");
}
