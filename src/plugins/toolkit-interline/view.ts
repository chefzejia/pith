type InterlinePosition = { node: Text; locator: string; block: HTMLElement; offset: number; textOffset: number } | { node: Element; locator: string; block: HTMLElement };
import type { InterlineDisplayMode, InterlineSourceSegment } from "../../core/index.ts";


export function preserveInterlinePosition(reader: HTMLElement, article: HTMLElement, paged: boolean, change: () => void, repaginate: (position: InterlinePosition | null) => void, captureReaderPosition: (reader: HTMLElement, article: HTMLElement) => InterlinePosition | null, proseTextNodes: (block: Element) => Text[]): void {
  const position = captureReaderPosition(reader, article);
  let top = 0;
  if (!paged && position) {
    if ("textOffset" in position) { const range = article.ownerDocument.createRange(); range.setStart(position.node, position.offset); range.collapse(true); top = range.getBoundingClientRect().top; }
    else top = position.node.getBoundingClientRect().top;
  }
  change();
  if (paged) { repaginate(position); return; }
  if (!position) return;
  const block = Array.from(article.querySelectorAll<HTMLElement>("[data-locator]")).find(element => element.dataset.locator === position.locator);
  if (!block) return;
  let newTop = block.getBoundingClientRect().top;
  if ("textOffset" in position) {
    let offset = position.textOffset;
    for (const node of proseTextNodes(block)) { if (offset < node.length) { const range = article.ownerDocument.createRange(); range.setStart(node, offset); range.collapse(true); newTop = range.getBoundingClientRect().top; break; } offset -= node.length; }
  }
  reader.scrollTop += newTop - top;
}

export interface InterlineViewUnit { html: string; segments: InterlineSourceSegment[] }
export type InterlineViewPrepare = (units: readonly InterlineViewUnit[], index: number, mode: InterlineDisplayMode) => Promise<{ html: string; status: string; error?: string }>;

export class InterlineView {
  private readonly reader: HTMLElement;
  private readonly article: HTMLElement;
  private readonly prepare: InterlineViewPrepare;
  private readonly update: (change: () => void) => void;
  private readonly report: (message: string) => void;
  private readonly elements: HTMLElement[];
  private readonly units: InterlineViewUnit[];
  private readonly outer: boolean[];
  private readonly pageSubtitles = new WeakMap<HTMLElement, Element>();
  private mode: InterlineDisplayMode = "original";
  private version = 0;
  private processingVersion: number | null = null;
  private readonly requested = new Set<string>();
  private disposed = false;
  constructor(reader: HTMLElement, article: HTMLElement, prepare: InterlineViewPrepare, update: (change: () => void) => void, report: (message: string) => void, proseTextNodes: (block: Element) => Text[]) {
    this.reader = reader; this.article = article; this.prepare = prepare; this.update = update; this.report = report;
    const chapters = Array.from(article.children).filter(element => element.matches(".pith-epub-chapter")) as HTMLElement[];
    const roots = chapters.length ? chapters : [article];
    const entries = roots.flatMap(root => {
      const blocks = Array.from(root.querySelectorAll<HTMLElement>('[data-prose="true"][data-locator]')).filter(block => !block.parentElement?.closest('[data-prose="true"][data-locator]'));
      const size = blocks.reduce((sum, block) => sum + proseTextNodes(block).reduce((length, text) => length + text.length, 0), 0);
      return chapters.length && size <= 1200 ? [{ element: root, outer: false }] : blocks.map(element => ({ element, outer: true }));
    });
    this.elements = entries.map(entry => entry.element); this.outer = entries.map(entry => entry.outer);
    this.units = entries.map(({ element, outer }) => ({ html: outer ? element.outerHTML : element.innerHTML, segments: (outer ? [element] : Array.from(element.querySelectorAll<HTMLElement>('[data-prose="true"][data-locator]'))).map((block, blockIndex) => ({ locator: block.dataset.locator!, blockIndex, sourceText: proseTextNodes(block).map(text => text.data).join(""), sourceHash: "" })).filter(segment => segment.sourceText.trim()) }));
  }
  private apply(index: number, html: string): void {
    const element = this.elements[index]!;
    if (!this.outer[index]) { element.innerHTML = html; return; }
    const template = this.article.ownerDocument.createElement("template"); template.innerHTML = html;
    const rendered = template.content.firstElementChild;
    if (!rendered) throw new Error("行间内容无效");
    const page = element.matches(".pith-pdf-text") ? element.closest("figure.pith-fixed-page") : null;
    if (page) {
      // The PDF text layer is an absolute, transparent selection surface over the image.
      this.pageSubtitles.get(element)?.remove();
      this.pageSubtitles.delete(element);
      const subtitle = rendered.querySelector(":scope > .pith-interline-subtitle");
      if (subtitle) {
        page.after(subtitle);
        this.pageSubtitles.set(element, subtitle);
      }
      return;
    }
    element.innerHTML = rendered.innerHTML;
    const mode = rendered.getAttribute("data-interline-mode"); if (mode === null) element.removeAttribute("data-interline-mode"); else element.setAttribute("data-interline-mode", mode);
  }
  dispose(): void { this.disposed = true; this.version++; }
  setMode(mode: InterlineDisplayMode): void {
    this.mode = mode; this.version++; this.requested.clear();
    this.update(() => { for (let i = 0; i < this.elements.length; i++) this.apply(i, this.units[i]!.html); });
    if (mode !== "original") this.activate();
  }
  activate(): void {
    if (this.disposed || this.mode === "original" || this.processingVersion === this.version) return;
    const viewport = this.reader.getBoundingClientRect();
    const visible: Array<{ index: number; left: number; top: number }> = [];
    for (let i = 0; i < this.elements.length; i++) for (const rect of Array.from(this.elements[i]!.getClientRects())) {
      if (rect.right <= viewport.left || rect.left >= viewport.right || rect.bottom <= viewport.top || rect.top >= viewport.bottom) continue;
      visible.push({ index: i, left: Math.max(rect.left, viewport.left), top: Math.max(rect.top, viewport.top) });
      break;
    }
    visible.sort((a, b) => a.left - b.left || a.top - b.top);
    for (const { index } of visible) {
      if (!this.units[index]!.segments.length) continue;
      const key = `${this.mode}:${index}`;
      if (this.requested.has(key)) continue;
      this.requested.add(key);
      const version = this.version, mode = this.mode;
      this.processingVersion = version;
      void this.prepare(this.units, index, mode).then(result => {
        if (this.disposed || !this.article.isConnected || version !== this.version) return;
        if (result.status !== "ready" && result.status !== "partial") { this.report(result.error || "翻译暂不可用"); return; }
        this.update(() => { this.apply(index, result.html); });
        if (result.status === "partial") this.report(result.error || "部分翻译不可用");
      }).catch(error => { if (!this.disposed && version === this.version) this.report(error instanceof Error ? error.message : String(error)); }).finally(() => {
        if (this.processingVersion === version) this.processingVersion = null;
        if (version === this.version) this.activate();
      });
      break;
    }
  }
}
