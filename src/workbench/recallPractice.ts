import type { Note, SelectionAnchor } from "../core/index.ts";
import type { FeynmanContrast, RecallPoint, RecallResult } from "../plugins/toolkit-feynman/index.ts";

export interface RecallPracticePorts extends FeynmanContrast {
  capture(body: string, anchor: SelectionAnchor, result?: RecallResult): Promise<Note>;
}
export class RecallPractice {
  points: readonly RecallPoint[] = [];
  result: RecallResult | undefined;
  preparation: "loading" | "ready" | "failed" = "loading";
  error = "";
  recordId: string | undefined;
  busy = false;
  saved = false;
  produced = "";
  private pending?: Promise<void>;
  private connection?: AbortController;
  private disposed = false;
  private readonly source: string;
  private readonly anchor: SelectionAnchor;
  private readonly ports: RecallPracticePorts;
  private readonly changed: () => void;
  constructor(source: string, anchor: SelectionAnchor, ports: RecallPracticePorts, changed: () => void = () => {}, available = true) {
    this.source = source; this.anchor = anchor; this.ports = ports; this.changed = changed;
    this.setAvailable(available);
  }
  get available(): boolean { return this.connection !== undefined; }
  setAvailable(available: boolean): void {
    if (this.disposed || this.available === available) return;
    this.connection?.abort();
    this.connection = available ? new AbortController() : undefined;
    this.pending = this.connection && this.preparation !== "ready" ? this.prepare(this.connection.signal) : undefined;
  }
  private async prepare(signal: AbortSignal): Promise<void> {
    this.preparation = "loading";
    try {
      const points = await this.ports.prepare(this.source, signal);
      if (signal.aborted) return;
      this.points = points; this.preparation = "ready"; this.error = "";
    } catch (error) {
      if (signal.aborted) return;
      this.preparation = "failed"; this.error = error instanceof Error ? error.message : String(error);
    }
    this.changed();
  }
  canSubmit(produced: string, retry = false): boolean {
    if (this.disposed || this.busy || !produced.trim() || (retry && !this.available)) return false;
    return !this.saved || this.produced.trim() !== produced.trim() || (this.available && !this.result);
  }
  async submit(produced: string, retry = false): Promise<void> {
    if (!this.canSubmit(produced, retry)) return;
    const connection = this.connection;
    const retryExtraction = this.saved && this.preparation === "failed";
    this.busy = true; this.saved = false; this.result = undefined; this.recordId = undefined; this.produced = produced; this.changed();
    try {
      let result: RecallResult | undefined;
      if (connection) {
        await this.pending;
        if (retryExtraction && !connection.signal.aborted) await this.prepare(connection.signal);
        if (!connection.signal.aborted && this.preparation === "ready") {
          try { result = await this.ports.compare(this.source, this.points, produced, connection.signal); this.error = ""; }
          catch (error) { if (this.connection === connection) this.error = error instanceof Error ? error.message : String(error); }
        }
      }
      if (this.connection !== connection) result = undefined;
      const note = await this.ports.capture(produced, this.anchor, result);
      this.result = result;
      this.recordId = note.id;
      this.saved = true;
    } finally { this.busy = false; if (!this.disposed) this.changed(); }
  }
  repeat(): boolean {
    if (!this.available || this.busy || !this.result) return false;
    this.result = undefined; this.recordId = undefined; this.saved = false; this.produced = "";
    return true;
  }
  dispose(): void { this.disposed = true; this.connection?.abort(); }
}
