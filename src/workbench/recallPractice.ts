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
  private readonly pending: Promise<void>;
  private readonly abort = new AbortController();
  private readonly source: string;
  private readonly anchor: SelectionAnchor;
  private readonly ports: RecallPracticePorts;
  private readonly changed: () => void;
  constructor(source: string, anchor: SelectionAnchor, ports: RecallPracticePorts, changed: () => void = () => {}) {
    this.source = source; this.anchor = anchor; this.ports = ports; this.changed = changed;
    this.pending = this.prepare();
  }
  private async prepare(): Promise<void> {
    try { this.points = await this.ports.prepare(this.source, this.abort.signal); this.preparation = "ready"; }
    catch (error) { this.preparation = "failed"; this.error = error instanceof Error ? error.message : String(error); }
    if (!this.abort.signal.aborted) this.changed();
  }
  async submit(produced: string): Promise<void> {
    if (this.abort.signal.aborted || this.busy || this.result || !produced.trim()) return;
    const retryExtraction = this.saved && this.preparation === "failed";
    this.busy = true; this.saved = false; this.produced = produced; this.changed();
    try {
      await this.pending;
      // A retry after failed extraction is another attempt, with a fresh request.
      if (retryExtraction && !this.abort.signal.aborted) await this.prepare();
      let result: RecallResult | undefined;
      if (this.preparation === "ready") {
        try { result = await this.ports.compare(this.source, this.points, produced, this.abort.signal); this.error = ""; }
        catch (error) { this.error = error instanceof Error ? error.message : String(error); }
      }
      const note = await this.ports.capture(produced, this.anchor, result);
      this.result = result;
      this.recordId = note.id;
      this.saved = true;
    } finally { this.busy = false; if (!this.abort.signal.aborted) this.changed(); }
  }
  repeat(): boolean {
    if (this.busy || !this.result) return false;
    this.result = undefined; this.recordId = undefined; this.saved = false; this.produced = "";
    return true;
  }
  dispose(): void { this.abort.abort(); }
}
