/**
 * Pith View Kernel (modeled after magpie's `internal/gui/assets/kernel.js`).
 *
 * Isolates UI slot contributions (`stage`, `dojo`, `guide`, `toolbar`, `nav.page`)
 * behind an error boundary: if a plugin's `mount` or hook throws or rejects,
 * only that slot shows an error state with a `retry()` handle while the rest
 * of the application continues unaffected.
 */

export type ViewSlotName = "stage" | "dojo" | "guide" | "toolbar" | "nav.page";

export interface ViewSlotPart<State = unknown> {
  readonly key: string;
  readonly slot: ViewSlotName;
  readonly title: string;
  mount?(state?: State): void | Promise<void>;
  render?(state: State): void | Promise<void>;
  unmount?(): void;
}

export interface BrokenSlotState {
  readonly pluginId: string;
  readonly key: string;
  readonly hook: string;
  readonly message: string;
  retry(): Promise<void>;
}

interface RegisteredSlotPart {
  readonly pluginId: string;
  readonly part: ViewSlotPart<unknown>;
  mounted: boolean;
  broken: {
    hook: "mount" | "render";
    arg: unknown;
    message: string;
  } | null;
}

export class ViewKernel {
  private readonly parts = new Map<string, RegisteredSlotPart>();
  private started = false;

  add<State = unknown>(pluginId: string, part: ViewSlotPart<State>): () => void {
    if (!/^[a-z][a-z0-9-]*$/.test(part.key) || this.parts.has(part.key)) {
      throw new Error(`kernel: slot part "${part.key}" is invalid or already taken`);
    }
    const entry: RegisteredSlotPart = {
      pluginId,
      part: part as ViewSlotPart<unknown>,
      mounted: false,
      broken: null,
    };
    this.parts.set(part.key, entry);
    if (this.started) {
      void this.runHook(entry, "mount", undefined);
    }
    return () => {
      const current = this.parts.get(part.key);
      if (current !== entry) return;
      this.parts.delete(part.key);
      if (entry.mounted) {
        try {
          entry.part.unmount?.();
        } catch {
          // Unmount errors are swallowed during disposal so teardown continues.
        }
      }
    };
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    for (const entry of this.parts.values()) {
      await this.runHook(entry, "mount", undefined);
    }
  }

  async call(key: string, hook: "mount" | "render", state?: unknown): Promise<void> {
    const entry = this.parts.get(key);
    if (!entry) return;
    await this.runHook(entry, hook, state);
  }

  status(key: string): BrokenSlotState | null {
    const entry = this.parts.get(key);
    if (!entry || !entry.broken) return null;
    const broken = entry.broken;
    return {
      pluginId: entry.pluginId,
      key: entry.part.key,
      hook: broken.hook,
      message: broken.message,
      retry: async () => {
        entry.broken = null;
        entry.mounted = false;
        if (broken.hook !== "mount") {
          await this.runHook(entry, "mount", undefined);
        }
        if (!entry.broken) {
          await this.runHook(entry, broken.hook, broken.arg);
        }
      },
    };
  }

  listBySlot(slot: ViewSlotName): readonly string[] {
    const keys: string[] = [];
    for (const [key, entry] of this.parts) {
      if (entry.part.slot === slot) keys.push(key);
    }
    return keys;
  }

  private async runHook(
    entry: RegisteredSlotPart,
    hook: "mount" | "render",
    arg: unknown,
  ): Promise<void> {
    if (entry.broken) return;
    if (hook === "mount") {
      if (entry.mounted) return;
      entry.mounted = true;
    } else if (!entry.mounted && this.started) {
      await this.runHook(entry, "mount", undefined);
      if (entry.broken) return;
    }
    const fn = entry.part[hook];
    if (typeof fn !== "function") return;
    try {
      await fn.call(entry.part, arg);
    } catch (err) {
      entry.broken = {
        hook,
        arg,
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
