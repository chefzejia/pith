import type { InterlineDisplayMode, InterlinePreparedUnit, InterlineSourceSegment, InterlineTranslator, InterlineService, WorkspaceStoragePort } from "../../core/index.ts";
import { InterlinePreparationCoordinator } from "./coordinator.ts";
export interface InterlineUnitInput { readonly html: string; readonly segments: readonly InterlineSourceSegment[] }
export class InterlineSession {
  private readonly coordinator: InterlinePreparationCoordinator;
  private readonly pending = new Map<number, Array<(unit: InterlinePreparedUnit) => void>>();
  private readonly service: InterlineService;
  private readonly units: readonly InterlineUnitInput[];
  constructor(service: InterlineService, storage: WorkspaceStoragePort, translator: InterlineTranslator, materialId: string, file: string, units: readonly InterlineUnitInput[]) {
    this.service = service; this.units = units;
    this.coordinator = new InterlinePreparationCoordinator({ materialId, file, targetLanguage: service.defaultTargetLanguage, storage, translator, neighborhoodOnly: true, units: units.map(unit => unit.segments), onUnit: unit => {
      if (unit.status === "warming" || unit.status === "pending") return;
      for (const resolve of this.pending.get(unit.unitIndex) ?? []) resolve(unit);
      this.pending.delete(unit.unitIndex);
    } });
  }
  whenIdle(): Promise<void> { return this.coordinator.whenIdle(); }
  async render(index: number, mode: InterlineDisplayMode): Promise<{ html: string; status: InterlinePreparedUnit["status"]; error?: string }> {
    if (!Number.isInteger(index) || index < 0 || index >= this.units.length) throw new RangeError("Invalid interline unit");
    if (mode !== "original" && mode !== "bilingual" && mode !== "subtitle-primary") throw new Error("Invalid interline mode");
    if (mode === "original") return { html: this.units[index]!.html, status: "ready" };
    const ready = this.coordinator.getUnit(index);
    let result: Promise<InterlinePreparedUnit>;
    if (ready && ready.status === "ready") result = Promise.resolve(ready);
    else result = new Promise(resolve => { const listeners = this.pending.get(index) ?? []; listeners.push(resolve); this.pending.set(index, listeners); });
    await this.coordinator.activateUnit(index);
    const unit = await result;
    const translations = new Map(unit.blocks.filter(block => block.status === "ready").map(block => [block.locator, block.translation]));
    return { html: this.service.renderInterlineHtml(this.units[index]!.html, translations, mode), status: unit.status, ...(unit.error ? { error: unit.error } : {}) };
  }
}
