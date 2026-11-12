import { type InterlineBilingualBlock, type InterlineDisplayMode, type InterlinePreparedUnit, type InterlineSourceSegment, type InterlineTargetLanguage, type InterlineTranslator, type InterlineWarmupSnapshot, type WorkspaceStoragePort } from "../../core/index.ts";
import { computeSourceHash, planNeighborhoodOrder } from "./index.ts";

export interface InterlineCoordinatorOptions {
  readonly materialId: string;
  readonly file: string;
  readonly targetLanguage: InterlineTargetLanguage;
  readonly units: readonly (readonly InterlineSourceSegment[])[];
  readonly translator: InterlineTranslator;
  readonly storage?: WorkspaceStoragePort;
  readonly displayMode?: InterlineDisplayMode;
  readonly radius?: number;
  readonly neighborhoodOnly?: boolean;
  readonly onUnit?: (unit: InterlinePreparedUnit) => void;
  readonly onSnapshot?: (snapshot: InterlineWarmupSnapshot) => void;
}

function pathPart(value: string): string {
  return Array.from(new TextEncoder().encode(value), byte => byte.toString(16).padStart(2, "0")).join("") || "_";
}

export class InterlinePreparationCoordinator {
  private readonly options: InterlineCoordinatorOptions;
  private readonly units: readonly (readonly InterlineSourceSegment[])[];
  private readonly results = new Map<number, InterlinePreparedUnit>();
  private readonly checked = new Set<number>();
  private readonly loading = new Map<number, Promise<void>>();
  private active = 0;
  private running: number | null = null;
  private pumping = false;
  private idleResolvers: Array<() => void> = [];

  constructor(options: InterlineCoordinatorOptions) {
    this.options = options;
    this.units = options.units.map(unit => unit.map(segment => ({ ...segment, sourceHash: computeSourceHash(segment.sourceText) })));
    planNeighborhoodOrder(0, this.units.length, options.radius);
  }

  getUnit(index: number): InterlinePreparedUnit | undefined { return this.results.get(index); }

  snapshot(): InterlineWarmupSnapshot {
    const indices = [...this.results.entries()];
    return { activeUnitIndex: this.active, targetLanguage: this.options.targetLanguage, displayMode: this.options.displayMode ?? "bilingual",
      runningUnits: this.running === null ? [] : [this.running],
      readyUnits: indices.filter(([, unit]) => unit.status === "ready").map(([index]) => index).sort((a, b) => a - b),
      failedUnits: indices.filter(([, unit]) => unit.status === "failed" || unit.status === "partial").map(([index]) => index).sort((a, b) => a - b) };
  }

  async activateUnit(index: number): Promise<void> {
    if (!Number.isInteger(index) || index < 0 || index >= this.units.length) throw new RangeError("Active unit is out of range");
    this.active = index;
    const previous = this.results.get(index);
    if (previous && previous.status === "ready") this.options.onUnit?.(previous);
    else if (previous && (previous.status === "failed" || previous.status === "partial")) this.results.delete(index);
    this.emit();
    await this.loadCache(index);
    this.pump();
  }

  whenIdle(): Promise<void> {
    if (!this.pumping && this.loading.size === 0) return Promise.resolve();
    return new Promise(resolve => this.idleResolvers.push(resolve));
  }

  private emit(): void { this.options.onSnapshot?.(this.snapshot()); }
  private publish(unit: InterlinePreparedUnit): void { this.results.set(unit.unitIndex, unit); this.options.onUnit?.(unit); this.emit(); }

  private cachePath(index: number): string {
    return `_cache/interline/${pathPart(this.options.materialId)}/${pathPart(this.options.file)}.${this.options.targetLanguage}.unit-${index}.json`;
  }

  private loadCache(index: number): Promise<void> {
    if (this.checked.has(index)) return Promise.resolve();
    const existing = this.loading.get(index);
    if (existing) return existing;
    const promise = this.readCache(index).catch(error => { this.fail(index, error); }).finally(() => { this.loading.delete(index); this.checked.add(index); });
    this.loading.set(index, promise);
    return promise;
  }

  private async readCache(index: number): Promise<void> {
    const storage = this.options.storage;
    if (!storage) return;
    const path = this.cachePath(index);
    if (!await storage.exists(path)) return;
    const text = await storage.readText(path);
    let cached: InterlinePreparedUnit;
    try { cached = JSON.parse(text) as InterlinePreparedUnit; } catch (error) { if (error instanceof SyntaxError) return; throw error; }
    const segments = this.units[index]!;
    if (!cached || cached.materialId !== this.options.materialId || cached.file !== this.options.file || cached.unitIndex !== index || cached.targetLanguage !== this.options.targetLanguage || cached.status !== "ready" || !Array.isArray(cached.blocks) || cached.blocks.length !== segments.length) return;
    if (!segments.every((segment, i) => {
      const block = cached.blocks[i];
      return block && block.locator === segment.locator && block.blockIndex === segment.blockIndex && block.sourceHash === segment.sourceHash && block.status === "ready" && typeof block.translation === "string" && Boolean(block.translation.trim());
    })) return;
    this.publish({ ...cached, blocks: cached.blocks.map((block, i) => ({ ...block, sourceText: segments[i]!.sourceText })) });
  }

  private pump(): void {
    if (this.pumping) return;
    this.pumping = true;
    void this.run().finally(() => {
      this.pumping = false;
      if (this.loading.size === 0) { for (const resolve of this.idleResolvers.splice(0)) resolve(); }
    });
  }

  private async run(): Promise<void> {
    while (true) {
      if (this.loading.size) { await Promise.all(this.loading.values()); continue; }
      const nextUnit = (): number | undefined => planNeighborhoodOrder(this.active, this.units.length, this.options.radius).find(i => !this.results.has(i) && (!this.options.neighborhoodOnly || Math.abs(i - this.active) <= (this.options.radius ?? 1)));
      const index = nextUnit();
      if (index === undefined) return;
      try {
        await this.loadCache(index);
        if (this.results.has(index)) continue;
        // A cache read may finish after the active unit changes.
        const next = nextUnit();
        if (next !== index) continue;
        await this.prepare(index);
      } catch (error) { this.fail(index, error); }
    }
  }

  private makeUnit(index: number, status: InterlinePreparedUnit["status"], blocks: readonly InterlineBilingualBlock[], error?: string): InterlinePreparedUnit {
    return { materialId: this.options.materialId, file: this.options.file, unitIndex: index, targetLanguage: this.options.targetLanguage, status, blocks, updatedAt: new Date().toISOString(), ...(error === undefined ? {} : { error }) };
  }

  private fail(index: number, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    this.publish(this.makeUnit(index, "failed", this.units[index]!.map(segment => ({ ...segment, translation: "", status: "failed" })), message));
  }

  private async prepare(index: number): Promise<void> {
    const segments = this.units[index]!;
    this.running = index;
    this.publish(this.makeUnit(index, "warming", segments.map(segment => ({ ...segment, translation: "", status: "pending" }))));
    try {
      const translations = await this.options.translator({ materialId: this.options.materialId, file: this.options.file, unitIndex: index, targetLanguage: this.options.targetLanguage, segments });
      const blocks: InterlineBilingualBlock[] = segments.map(segment => {
        const translation = translations.get(segment.locator) ?? "";
        return { ...segment, translation, status: translation.trim() ? "ready" : "failed" };
      });
      const missing = blocks.filter(block => block.status === "failed").length;
      const status = missing === 0 ? "ready" : missing === blocks.length ? "failed" : "partial";
      const unit = this.makeUnit(index, status, blocks, missing ? "Translation missing for one or more segments" : undefined);
      this.publish(unit);
      if (status === "ready" && this.options.storage) {
        const storage = this.options.storage;
        await storage.mkdir("_cache"); await storage.mkdir("_cache/interline"); await storage.mkdir(`_cache/interline/${pathPart(this.options.materialId)}`);
        await storage.writeText(this.cachePath(index), JSON.stringify(unit));
      }
    } finally { this.running = null; this.emit(); }
  }
}
