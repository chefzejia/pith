import type { SelectionAnchor, ToolkitDescriptor } from "../core/index.ts";
import type { FeynmanContrast, RecallPoint, RecallResult } from "../plugins/toolkit-feynman/index.ts";

export interface RecallPracticePorts extends FeynmanContrast {
  capture(body: string, anchor: SelectionAnchor, result?: RecallResult): Promise<unknown>;
  followUp(message: string, instruction: string, anchor: SelectionAnchor): Promise<void>;
}
export class RecallPractice {
  points: readonly RecallPoint[] = [];
  result: RecallResult | undefined;
  preparation: "loading" | "ready" | "failed" = "loading";
  error = "";
  followUpError = "";
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
  async submit(produced: string, toolkit: ToolkitDescriptor): Promise<void> {
    if (this.abort.signal.aborted || this.busy || !produced.trim()) return;
    const retryExtraction = this.saved && this.preparation === "failed";
    this.busy = true; this.saved = false; this.result = undefined; this.followUpError = ""; this.produced = produced; this.changed();
    try {
      await this.pending;
      // A retry after failed extraction is another attempt, with a fresh request.
      if (retryExtraction && !this.abort.signal.aborted) await this.prepare();
      if (this.preparation === "ready") {
        try { this.result = await this.ports.compare(this.source, this.points, produced, this.abort.signal); this.error = ""; }
        catch (error) { this.error = error instanceof Error ? error.message : String(error); }
      }
      await this.ports.capture(produced, this.anchor, this.result);
      this.saved = true;
      const instruction = this.result && toolkit.followUp?.(this.result);
      if (instruction && !this.abort.signal.aborted) {
        try { await this.ports.followUp(produced, instruction, this.anchor); }
        catch (error) { this.followUpError = error instanceof Error ? error.message : String(error); }
      }
    } finally { this.busy = false; if (!this.abort.signal.aborted) this.changed(); }
  }
  dispose(): void { this.abort.abort(); }
}
