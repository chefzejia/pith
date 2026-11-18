import type { AnchorSource, ToolkitDiagnosis, ToolkitStage, ToolkitDescriptor, GuideTurn, GuideQuickAction, InterlineDisplayMode, ReaderSectionHeading, SelectionAnchor, Note } from "../core/index.ts";
import { applyPaginationStyles, captureReaderPosition, navigateReaderTarget, proseTextNodes, readerPageIndex, readingLocator, resolveEpubTarget, resolveReaderLocator, resolveResponsiveLayout, restoreReaderPosition, restoreReadingLocator, updateTocLocation, visibleToolkitTarget, type CurriculumItem, type ReaderPosition } from "../plugins/stage-reader/pagination.ts";
import { pithIcon } from "./icons.ts";
import { matchTextAnchor } from "../plugins/stage-reader/textAnchor.ts";
import { createWorkbenchChrome } from "./view/toolbar.ts";
import { workbenchStyles } from "./view/styles.ts";
export { workbenchStyles } from "./view/styles.ts";
import { audioContentType, videoContentType, resolveMediaPair } from "./mediaAssets.ts";
import { toolkitSlot } from "./toolkitSlot.ts";
import { InterlineView, preserveInterlinePosition, type InterlineViewPrepare } from "../plugins/toolkit-interline/index.ts";
import { VoiceInput } from "./voiceInput.ts";
import { renderNavigation, type NavigationMaterial, type NavigationLesson } from "./view/navigation.ts";
import { noteEntries, renderGuide, type MaterialNotes } from "./view/guide.ts";
import { GUIDE_UNAVAILABLE_REASON } from "./guideAvailability.ts";
import { renderInlineToolkit, renderToolkitMenu } from "./view/toolkit.ts";
import { previousRecall } from "./view/recall.ts";
import { PlaybackDeck } from "./view/playback.ts";
import { RecallPractice } from "./recallPractice.ts";
import type { FeynmanContrast, RecallResult } from "../plugins/toolkit-feynman/index.ts";
import { fixedPageCount, fixedPageFormat } from "../plugins/stage-reader/fixedPage.ts";
import { mediaDuration, probeMediaDuration } from "../plugins/stage-timeline/index.ts";
import { repositoryCitations, type CitationPosition } from "../core/repositoryCitations.ts";

export interface ObsidianAgentConfig {
  readonly agentId: "" | "dsh" | "claude" | "codex";
  readonly model: string;
  readonly effort: string;
  readonly persona: "sanctuary" | "studio";
}



export interface ObsidianReaderDocument {
  readonly title: string;
  readonly materialAids?: readonly string[];
  readonly materialNotes?: MaterialNotes;
  readonly locator?: string;
  readonly html: string;
  readonly files: readonly (NavigationLesson & { mimeType?: string })[];
  readonly mediaFiles?: readonly { name: string; mimeType?: string }[];
  readonly currentFile: string;
  readonly mediaFile?: string | null;
  readonly format?: "markdown" | "epub" | "pdf" | "cbz" | "image";
  readonly sections: readonly ReaderSectionHeading[];
  readonly curriculum?: readonly CurriculumItem[];
  readonly source?: AnchorSource;
  readonly materialGroups?: readonly NavigationMaterial[];
}

export interface ObsidianViewActions {
  scene?: "material" | "topic";
  guideAvailable?: boolean;
  startIntake?(): void;
  setMaterialAids?(aids: readonly string[]): Promise<void>;
  saveLocator?(locator: string): Promise<void>;
  openFile(name: string, source?: AnchorSource): void | Promise<void>;
  generateLesson?(fileName: string, title: string): Promise<void>;
  home?(): void | Promise<void>;
  openToolkit(text?: string, locator?: string): void;
  selection(action: "highlight" | "note" | "ask", text: string, locator?: string): void;
  synthesizeSpeech?(text: string, signal: AbortSignal): Promise<{ readonly bytes: Uint8Array; readonly mimeType: string }>;
  transcribeAudio?(bytes: Uint8Array, mimeType: string, signal?: AbortSignal): Promise<{ readonly text: string }>;
  loadAudio?(name: string): Promise<Uint8Array>;
  readCitationFile?(materialId: string, name: string, signal: AbortSignal): Promise<Uint8Array>;
  prepareInterline?: InterlineViewPrepare;
  guideData?(): Promise<{ notes: readonly Note[]; conversation: readonly GuideTurn[]; actions: readonly GuideQuickAction[]; toolkits: readonly string[]; observations?: readonly string[]; readOnly?: boolean }>;
  undoObservation?(id: string): Promise<void>;
  openMaterial?(id: string): Promise<void>;
  sendGuide?(text: string, anchor: SelectionAnchor | undefined, saveAsNote: boolean): Promise<void>;
  stopGuide?(): Promise<void>;
  retryGuide?(turnId: string): Promise<void>;
  savePractice?(body: string, anchor: SelectionAnchor | undefined, result?: RecallResult): Promise<Note>;
  prepareRecall?: FeynmanContrast["prepare"];
  compareRecall?: FeynmanContrast["compare"];
  mountToolkit?(id: string): Promise<void>;
  toggleToolkit?(id: string, enabled: boolean): Promise<void>;
  guideVisibilityChanged?(visible: boolean): void | Promise<void>;
  openSettings?(): void;
  importMaterial?(): void;
  checkRepositoryUpdate?(id: string): Promise<string>;
  useRepositoryVersion?(id: string): Promise<void>;
}

function sameSource(a: AnchorSource | undefined, b: AnchorSource | undefined): boolean {
  return a?.kind === b?.kind && (a?.kind !== "material" || (b?.kind === "material" && a.materialId === b.materialId));
}

export function pageDirectionForKey(key: string): -1 | 0 | 1 {
  if (key === "ArrowUp" || key === "ArrowLeft" || key === "PageUp") return -1;
  if (key === "ArrowDown" || key === "ArrowRight" || key === "PageDown") return 1;
  return 0;
}

export function speechChapterRoot(article: HTMLElement, reader: HTMLElement, selected: Element | null, paged: boolean): Element | null {
  const chapters = Array.from(article.querySelectorAll<HTMLElement>(".pith-epub-chapter"));
  if (!chapters.length) return article;
  if (selected) { const chapter = selected.closest(".pith-epub-chapter"); return chapter && article.contains(chapter) ? chapter : null; }
  const viewport = reader.getBoundingClientRect();
  let best: { chapter: Element; primary: number; secondary: number } | null = null;
  for (const chapter of chapters) for (const rect of Array.from(chapter.getClientRects())) {
    if (rect.right <= viewport.left || rect.left >= viewport.right || rect.bottom <= viewport.top || rect.top >= viewport.bottom) continue;
    const primary = paged ? Math.max(rect.left, viewport.left) : Math.max(rect.top, viewport.top);
    const secondary = paged ? Math.max(rect.top, viewport.top) : Math.max(rect.left, viewport.left);
    if (!best || primary < best.primary || (primary === best.primary && secondary < best.secondary)) best = { chapter, primary, secondary };
  }
  return best ? best.chapter : null;
}

function visibleProse(block: Element, reader: HTMLElement): boolean {
  const viewport = reader.getBoundingClientRect(), doc = block.ownerDocument;
  const range = doc.createRange();
  for (const node of proseTextNodes(block)) {
    const text = (node as Text).data;
    for (const match of text.matchAll(/[\p{L}\p{N}]+/gu)) {
      range.setStart(node, match.index); range.setEnd(node, match.index + match[0].length);
      if (Array.from(range.getClientRects()).some(rect => rect.right > viewport.left && rect.left < viewport.right && rect.bottom > viewport.top && rect.top < viewport.bottom)) return true;
    }
  }
  return false;
}

function speechPageChapter(article: HTMLElement, reader: HTMLElement): Element | null {
  const chapters = Array.from(article.querySelectorAll(".pith-epub-chapter"));
  return (chapters.length ? chapters : [article]).find(chapter => Array.from(chapter.querySelectorAll("[data-prose=true]")).some(block => visibleProse(block, reader))) ?? null;
}

export class WheelPageGate {
  private last = -Infinity;
  accept(delta: number, now: number): -1 | 0 | 1 {
    if (Math.abs(delta) < 2 || now - this.last < 500) return 0;
    this.last = now;
    return delta < 0 ? -1 : 1;
  }
}

type Rgb = readonly [number, number, number];
const activeReader = new WeakMap<Document, PithWorkbenchView>();

function rgba(value: string): readonly [number, number, number, number] | null {
  const match = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+))?\s*\)$/i.exec(value);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3]), match[4] === undefined ? 1 : Number(match[4])] : null;
}
function composite(front: readonly [number, number, number, number], back: Rgb): Rgb {
  return [0, 1, 2].map(i => front[i]! * front[3] + back[i]! * (1 - front[3])) as unknown as Rgb;
}
function luminance(color: Rgb): number {
  const linear = color.map(channel => { const value = channel / 255; return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * linear[0]! + 0.7152 * linear[1]! + 0.0722 * linear[2]!;
}
function contrast(a: Rgb, b: Rgb): number { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
function readableColor(foreground: readonly [number, number, number, number], background: Rgb): Rgb | null {
  const original = composite(foreground, background);
  if (contrast(original, background) >= 4.5) return null;
  const target = contrast([255, 255, 255], background) >= contrast([0, 0, 0], background) ? 255 : 0;
  let low = 0, high = 1;
  for (let i = 0; i < 16; i++) {
    const amount = (low + high) / 2;
    const color = original.map(channel => channel + (target - channel) * amount) as unknown as Rgb;
    if (contrast(color, background) >= 4.55) high = amount; else low = amount;
  }
  return original.map(channel => Math.round(channel + (target - channel) * high)) as unknown as Rgb;
}

export class PithWorkbenchView {
  private readonly root: HTMLElement;
  private readonly actions: ObsidianViewActions;
  private readonly events = new AbortController();
  private readonly doc: Document;
  private readonly win: Window;
  private themeObserver: MutationObserver | null = null;
  private readonly reader: HTMLElement;
  private readonly article: HTMLElement;
  private readonly navigation: HTMLElement;
  private readonly guide: HTMLElement;
  private readonly layout: HTMLElement;
  private readonly dock: HTMLElement;
  private readonly toast: HTMLElement;
  private readonly popover: HTMLElement;
  private readonly mediaDeck: HTMLElement;
  private readonly assetControls: HTMLElement;
  private readonly playback: PlaybackDeck;
  private assetAudio: HTMLMediaElement | null = null;
  private assetUrl: string | null = null;
  private assetSource: { name: string; type: string } | null = null;
  private assetGeneration = 0;
  private assetPending: Promise<void> | undefined;
  private citationAbort = new AbortController();
  private readonly citationBounds = new Map<string, number>();
  private readonly navigationButton: HTMLButtonElement;
  private readonly guideButton: HTMLButtonElement;
  private selectionRange: Range | null = null;
  private pendingToolkitSelection: { anchor: Node; focus: Node; anchorOffset: number; focusOffset: number } | null = null;
  private toastTimer: number | undefined;
  private generation = 0;
  private disposed = false;
  private readonly wheelGate = new WheelPageGate();
  private readonly mediaLoaded = (): void => { if (!this.disposed && this.paged) this.applyPageMode(this.readerPosition); };
  private speaking = false;
  private speechResult = false;
  private speechAbort: AbortController | null = null;
  private speechAudio: HTMLAudioElement | null = null;
  private speechUrl: string | null = null;
  private speechRate = 1;
  private toolkitActive = false;
  private readonly toolkit: HTMLElement;
  private inlineToolkit: HTMLElement | null = null;
  private toolkitBlock: HTMLElement | null = null;
  private toolkitLenses: HTMLElement | null = null;
  private toolkitSource: HTMLElement | null = null;
  private toolkitDisplay: HTMLElement | null = null;
  private requestedToolkitBlock: HTMLElement | null = null;
  private toolkitReveal = false;
  private interline: InterlineView | null = null;
  private materialAids: readonly string[] = [];
  private guideAvailable = true;
  private locatorTimer: number | undefined;
  private interlineMode: InterlineDisplayMode = "original";
  private currentFile = "";
  private currentSource: AnchorSource | undefined;
  private pageMode: "single" | "double" | "triple" = "single";
  private readerPosition: ReaderPosition | null = null;
  private restoredScrollLeft: number | null = null;
  private paged = false;
  private readonly resizeObserver: ResizeObserver | null;
  private guideTab: "chat" | "notes" = "chat";
  private guideGeneration = 0;
  private pendingAnchor: SelectionAnchor | undefined;
  private materialNotes: MaterialNotes | undefined;
  private guideData: { notes: readonly Note[]; conversation: readonly GuideTurn[]; actions: readonly GuideQuickAction[]; observations?: readonly string[]; readOnly?: boolean } = { notes: [], conversation: [], actions: [] };
  private navigationDocument: Pick<ObsidianReaderDocument, "files" | "curriculum" | "sections" | "currentFile" | "source" | "materialGroups"> | null = null;
  private guideSending = false;
  private guideClock: number | undefined;
  private guidePending: { readonly text: string; readonly from: number } | undefined;
  private guideError = "";
  private toolkits: readonly ToolkitDescriptor[] = [];
  private mountedToolkits: readonly string[] = [];
  private configuredToolkits: readonly string[] = [];
  private toolkitId = "";
  private toolkitStage: ToolkitStage = "listen-decompose";
  private toolkitTarget = "";
  private toolkitProduced = "";
  private readonly toolkitDrafts = new Map<string, { text: string }>();
  private readonly recallSubmissions = new Map<string, { text: string } | undefined>();
  private toolkitAnchor: SelectionAnchor | undefined;
  private toolkitResult: ToolkitDiagnosis | null = null;
  private recall: RecallPractice | undefined;
  private toolkitStatus = "";
  private toolkitVersion = 0;
  private cueGeneration = 0;
  private cueRange: { start: number; end: number; loop: boolean; audio: HTMLMediaElement } | null = null;
  private cueFrame: number | null = null;
  private cueAbort: AbortController | null = null;
  private cuePlayer: HTMLAudioElement | null = null;
  private cueUrl: string | null = null;
  private cueLoop = false;
  private cuePlaying = false;
  private recordedUrl: string | null = null;
  private recordedPlayer: HTMLAudioElement | null = null;
  private readonly voice: VoiceInput;

  constructor(root: HTMLElement, actions: ObsidianViewActions) {
    this.root = root; this.actions = actions; this.guideAvailable = actions.guideAvailable ?? true; this.guideTab = actions.scene === "material" ? "notes" : "chat"; root.dataset.scene = actions.scene ?? "topic";
    this.doc = root.ownerDocument;
    const win = this.doc.defaultView;
    if (!win) throw new Error("View requires a window");
    this.win = win;
    this.voice = new VoiceInput(win as Window & typeof globalThis, (bytes, mime, signal) => {
      if (!this.actions.transcribeAudio) throw new Error("请先在设置中配置语音识别服务");
      return this.actions.transcribeAudio(bytes, mime, signal);
    }, (target, phase) => {
      const host = target === "guide" ? this.guide : this.inlineToolkit;
      if (!host) return;
      const button = host.querySelector<HTMLButtonElement>("[data-voice]");
      if (button) { const shadowing = target === "toolkit" && this.toolkitId === "shadowing"; button.innerHTML = phase === "recording" ? (shadowing ? `<span class="pith-mic-wave" aria-hidden="true"><i></i><i></i><i></i></span> 停止跟读` : `${pithIcon("stop")} 停止录音`) : phase === "permission" ? "取消录音" : phase === "transcribing" ? "识别中…" : `${pithIcon("mic")} ${shadowing ? "开口跟读" : "语音输入"}`; button.disabled = phase === "transcribing"; button.setAttribute("aria-pressed", String(phase === "recording")); }
      if (target === "toolkit" && phase === "recording" && this.toolkitId === "shadowing" && this.toolkitStage === "guided-follow" && this.nativeCueRange()) void this.playCue(false);
      if (target === "toolkit" && (phase === "transcribing" || phase === "idle")) this.stopCuePlayback();
    }, (target, text) => {
      const input = target === "guide" ? this.guide.querySelector<HTMLTextAreaElement>("textarea") : this.inlineToolkit?.querySelector<HTMLTextAreaElement>("[data-toolkit-produced]");
      if (input) { input.value = input.value ? `${input.value} ${text}` : text; input.dispatchEvent(new (this.win as Window & typeof globalThis).Event("input", { bubbles: true })); input.focus(); if (target === "toolkit") this.toolkitProduced = input.value; }
      if (target === "toolkit" && this.toolkitId === "shadowing" && text.trim()) { this.toolkitProduced = text.trim(); const toolkit = this.toolkits.find(item => item.id === "shadowing"); if (toolkit?.diagnose) { this.toolkitResult = toolkit.diagnose(this.toolkitTarget, this.toolkitProduced); this.renderToolkit(); } }
    }, message => this.tip(message), url => { this.stopRecordedPlayback(); this.recordedUrl = url; const button = this.inlineToolkit?.querySelector<HTMLButtonElement>("[data-toolkit-play-recorded]"), save = this.inlineToolkit?.querySelector<HTMLButtonElement>("[data-toolkit-save]"); if (button) { button.disabled = !url; button.hidden = !url; } if (save) save.hidden = !url; if (url) this.toolkitDisplay?.querySelector(".pith-blind-mask")?.classList.add("pith-blind-revealed"); });
    const required = createWorkbenchChrome(root, actions);
    this.reader = required(".pith-reader"); this.article = required(".pith-article"); this.navigation = required(".pith-left-drawer"); this.guide = this.doc.createElement("aside"); this.guide.className = "pith-guide"; this.guide.hidden = true; this.layout = required(".pith-layout"); this.dock = required(".pith-bottom-dock"); this.toast = required(".pith-toast-tip"); this.popover = required(".pith-selection"); this.navigationButton = required(".pith-nav-toggle"); this.guideButton = required(".pith-guide-toggle");
    this.dock.append(required(".pith-typography-popover"));
    this.playback = new PlaybackDeck(this.doc, required(".pith-speech-controls"), this.article, () => ({ duration: this.assetAudio?.duration, otherPlayback: Boolean(this.speaking || this.cuePlayer || this.recordedPlayer) })); this.mediaDeck = this.playback.deck; this.assetControls = this.playback.controls; required(".pith-stage").append(this.mediaDeck);
    this.toolkit = this.doc.createElement("section"); this.toolkit.className = "pith-toolkit-panel"; this.toolkit.hidden = true; this.dock.append(this.toolkit);
    const Resize = (this.win as Window & typeof globalThis).ResizeObserver; this.resizeObserver = Resize ? new Resize(() => this.applyPageMode(this.readerPosition)) : null; if (this.resizeObserver) this.resizeObserver.observe(this.reader);
    const options = { signal: this.events.signal };
    root.addEventListener("focusin", () => activeReader.set(this.doc, this), options);
    root.addEventListener("pointerdown", () => activeReader.set(this.doc, this), options);
    const Mutation = (this.win as Window & typeof globalThis).MutationObserver;
    if (Mutation) {
      this.themeObserver = new Mutation(() => this.adaptEpubColors());
      this.themeObserver.observe(this.doc.documentElement, { attributes: true, attributeFilter: ["class", "style"] });
      if (this.doc.body) this.themeObserver.observe(this.doc.body, { attributes: true, attributeFilter: ["class", "style"] });
    }
    if (typeof this.win.matchMedia === "function") this.win.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => this.adaptEpubColors(), options);
    root.addEventListener("pointerdown", event => {
      const target = event.target;
      this.pendingToolkitSelection = null;
      if (!(target instanceof (this.win as Window & typeof globalThis).Element) || !target.closest('[data-toolkit-close],[data-command="toolkit"],[data-toolkit-choose]') || !this.toolkitSource) return;
      const selection = this.win.getSelection(), anchor = selection?.anchorNode, focus = selection?.focusNode;
      if (selection && anchor && focus && !selection.isCollapsed && this.toolkitSource.contains(anchor) && this.toolkitSource.contains(focus)) this.pendingToolkitSelection = { anchor, focus, anchorOffset: selection.anchorOffset, focusOffset: selection.focusOffset };
    }, options);
    root.addEventListener("click", event => { const target = event.target; if (target instanceof (this.win as Window & typeof globalThis).Node && this.guide.contains(target)) return; void this.click(event); }, options);
    this.guide.addEventListener("click", event => { void this.click(event); }, options);
    this.guide.addEventListener("keydown", event => { if (event.target instanceof (this.win as Window & typeof globalThis).HTMLTextAreaElement && event.key === "Enter" && !event.shiftKey && !event.isComposing && !this.guideSending) { event.preventDefault(); this.guide.querySelector<HTMLButtonElement>("[data-guide-send]")?.click(); } }, options);
    this.guide.addEventListener("scroll", event => { const content = event.target as HTMLElement; if (!content.classList.contains("pith-guide-content")) return; const bottom = this.guide.querySelector<HTMLButtonElement>("[data-guide-bottom]"); if (bottom) bottom.hidden = content.scrollHeight - content.clientHeight - content.scrollTop < 32; }, { ...options, capture: true });
    this.guide.addEventListener("toggle", event => { const details = event.target as HTMLDetailsElement; if (details.matches("details[data-process]")) details.querySelector("summary")?.setAttribute("aria-expanded", String(details.open)); }, { ...options, capture: true });
    this.doc.addEventListener("click", event => { const target = event.target as Node | null; const menu = required<HTMLElement>(".pith-typography-popover"); const toggle = required<HTMLButtonElement>('[data-command="typography"]'); if (target && !menu.contains(target) && !toggle.contains(target)) { menu.hidden = true; toggle.setAttribute("aria-expanded", "false"); } if (target && !this.navigation.contains(target) && !this.navigationButton.contains(target)) this.closeNavigation(); }, options);
    this.doc.addEventListener("keydown", event => { if (event.key === "Escape") { required<HTMLElement>(".pith-typography-popover").hidden = true; required<HTMLButtonElement>('[data-command="typography"]').setAttribute("aria-expanded", "false"); if (this.toolkitMenuOpen()) this.toolkit.hidden = true; this.closeNavigation(); } }, options);
    // The tool menu is a popover: its button toggles it, Escape and a press outside it close it. The interline mode bar and the tool chooser of a clicked passage share the panel and keep their own lifetime.
    const toolkitToggle = required<HTMLButtonElement>("#open-toolkit");
    this.doc.addEventListener("pointerdown", event => { const target = event.target as Node | null; if (this.toolkitMenuOpen() && target && !this.toolkit.contains(target) && !toolkitToggle.contains(target)) this.toolkit.hidden = true; }, options);
    this.reader.addEventListener("wheel", event => { if (!this.paged || event.ctrlKey || Math.abs(event.deltaY) < 2) return; event.preventDefault(); const direction = this.wheelGate.accept(event.deltaY, this.win.performance.now()); if (direction) this.turnPage(direction); }, { ...options, passive: false });
    this.reader.addEventListener("scroll", () => { this.updatePageCount(); const restored = this.restoredScrollLeft === this.reader.scrollLeft; this.restoredScrollLeft = null; const layoutCurrent = parseFloat(this.article.style.width) === this.reader.clientWidth && parseFloat(this.article.style.height) === this.reader.clientHeight; if (this.paged && !restored && layoutCurrent) this.readerPosition = captureReaderPosition(this.reader, this.article); if (this.interline) this.interline.activate(); this.scheduleLocator(); }, options);
    root.addEventListener("keydown", event => { const target = event.target as Element | null; const link = target && target.closest<HTMLElement>("a[data-epub-target]"); if (link && this.article.contains(link) && event.key === "Enter") { event.preventDefault(); this.openEpubLink(link); } }, options);
    this.doc.addEventListener("keydown", event => { const target = event.target as Element | null; if (!this.root.isConnected || !this.paged || !target || typeof target.closest !== "function" || target.closest("input,textarea,select,button,[contenteditable]:not([contenteditable=false]),.pith-guide,.pith-left-drawer") || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.defaultPrevented) return; if (!this.root.contains(target) && (target !== this.doc.body || activeReader.get(this.doc) !== this)) return; const amount = pageDirectionForKey(event.key); if (amount) { event.preventDefault(); this.turnPage(amount); } }, options);
    this.article.addEventListener("mouseup", () => this.showSelection(), options);
    this.article.addEventListener("input", event => {
      const field = this.inlineToolkit?.querySelector<HTMLTextAreaElement>("[data-toolkit-produced]");
      if (!field || event.target !== field || !this.recall) return;
      this.readToolkit();
      this.updateRecallSubmit();
    }, options);
    this.assetControls.addEventListener("input", event => { const input = event.target as HTMLInputElement; if (input.classList.contains("pith-media-seek")) { const player = this.speaking ? this.speechAudio : this.cuePlayer ?? this.recordedPlayer; if (player) { player.currentTime = Number(input.value); this.updateAssetControls(); } else this.seekMedia(Number(input.value)); } }, options);
  }

  render(document: ObsidianReaderDocument): void {
    this.closeInlineToolkit();
    this.toolkitVersion++; this.toolkitTarget = ""; this.toolkitAnchor = undefined; this.requestedToolkitBlock = null; this.toolkitResult = null; this.toolkitStatus = ""; this.toolkit.hidden = true; this.setToolkitActive(false);
    this.voice.cancel();
    if (this.interline) this.interline.dispose(); this.interline = null; this.interlineMode = "original";
    this.readerPosition = null;
    this.currentFile = document.currentFile;
    this.currentSource = document.source;
    const previousMaterialNotes = this.materialNotes;
    this.materialNotes = this.actions.scene !== "material" && document.source?.kind === "material" && document.materialNotes?.materialId === document.source.materialId ? document.materialNotes : undefined;
    this.materialAids = document.materialAids ?? [];
    this.setToolkits(this.configuredToolkits);
    this.paged = document.format ? ["epub", "pdf", "cbz"].includes(document.format) : /\.(epub|pdf|cbz)$/i.test(document.currentFile);
    this.stopSpeech(); this.selectionRange = null; this.popover.hidden = true;
    this.clearAudioAsset(); this.assetSource = null;
    const title = this.root.querySelector(".pith-title"); if (title) title.textContent = document.title;
    this.citationAbort.abort(); this.citationAbort = new AbortController();
    this.article.innerHTML = document.html;
    this.reader.scrollTo({ left: 0, top: 0, behavior: "instant" });
    if (document.source?.kind === "lesson") {
      const basis = document.files.find(file => file.name === document.currentFile)?.basedOn;
      this.renderCitations((document.materialGroups ?? []).filter(group => group.kind !== "repo" || basis?.includes(group.id)));
    }
    this.adaptEpubColors();
    if (this.actions.prepareInterline) this.interline = new InterlineView(this.reader, this.article, this.actions.prepareInterline, change => {
      if (this.speaking) this.stopSpeech();
      preserveInterlinePosition(this.reader, this.article, this.paged, () => {
        change(); this.restoreRecallOverlay(); this.markExisting();
      }, position => this.applyPageMode(position), captureReaderPosition, proseTextNodes);
    }, message => this.tip(message), proseTextNodes);
    this.navigationDocument = document;
    this.renderNavigation(document);
    this.closeNavigation();
    if (this.materialNotes || previousMaterialNotes) this.renderGuide();
    this.markExisting(); this.applyPageMode();
    this.updateReadingAids();
    if (document.locator) { restoreReadingLocator(this.reader, this.article, document.locator, this.paged); this.readerPosition = this.paged ? captureReaderPosition(this.reader, this.article) : null; this.updatePageCount(); }
    this.scheduleLocator();
    const active = this.doc.activeElement;
    if (this.root.isConnected && active && (active === this.doc.body || this.root.contains(active)) && !active.closest("input,textarea,select,button,[contenteditable]:not([contenteditable=false]),.pith-guide,.pith-left-drawer")) this.reader.focus({ preventScroll: true });
    const typeOf = (file: ObsidianReaderDocument["files"][number]) => videoContentType({ name: file.name, mimeType: file.mimeType ?? "" }) ?? audioContentType({ name: file.name, mimeType: file.mimeType ?? "" });
    const mediaFiles = document.mediaFiles ?? document.files;
    const asset = document.mediaFile === undefined ? resolveMediaPair(mediaFiles, document.currentFile).media : mediaFiles.find(file => file.name === document.mediaFile) ?? null;
    const video = this.article.querySelector<HTMLVideoElement>(".pith-timeline-video"); if (video) video.removeAttribute("src");
    if (asset && this.actions.loadAudio) { const type = typeOf(asset); if (type) { this.assetSource = { name: asset.name, type }; this.assetPending = this.loadAsset(); } }
  }

  private renderCitations(groups: NonNullable<ObsidianReaderDocument["materialGroups"]>): void {
    if (!groups.length) return;
    const signal = this.citationAbort.signal, read = this.actions.readCitationFile;
    const sources = groups.map(group => ({
      id: group.id, title: group.title, files: group.files.flatMap<{ name: string; position?: CitationPosition; page?: ReturnType<typeof fixedPageFormat>; media?: string }>(file => {
        const name = file.name;
        if (group.kind === "repo") return [{ name }];
        const page = fixedPageFormat(file);
        const media = videoContentType({ name, mimeType: file.mimeType ?? "" }) ?? audioContentType({ name, mimeType: file.mimeType ?? "" });
        const position: CitationPosition | undefined = page ? "page" : media ? "time" : undefined;
        return position ? [{ name, position, page, media: media ?? undefined }] : [];
      }),
    }));
    const textNodes = () => {
      const walker = this.doc.createTreeWalker(this.article, 4), nodes: Text[] = [];
      let node: Node | null;
      while ((node = walker.nextNode())) if (!node.parentElement?.closest("pre,a,button")) nodes.push(node as Text);
      return nodes;
    };
    const key = (id: string, path: string) => JSON.stringify([id, path]);
    const bound = (source: typeof sources[number], path: string) => this.citationBounds.get(key(source.id, path));
    const nodes = textNodes();
    const candidates = repositoryCitations(nodes.map(text => text.data), sources);
    const pending = new Map<string, () => Promise<void>>();
    if (read) for (const matches of candidates) for (const match of matches) {
      if (!match.locator) continue;
      for (const source of match.sources) {
        const path = match.path, id = key(source.id, path);
        if (this.citationBounds.has(id) || pending.has(id)) continue;
        const file = source.files.find(item => item.name === path)!;
        pending.set(id, async () => {
          try {
            const bytes = await read(source.id, path, signal);
            if (signal.aborted) return;
            const limit = file.page ? await fixedPageCount(file.page, bytes) : file.media ? await probeMediaDuration(this.doc, bytes, file.media, signal) : undefined;
            if (limit !== undefined && !signal.aborted) this.citationBounds.set(id, limit);
          } catch { /* Unreadable bounds leave the source as plain text. */ }
        });
      }
    }
    if (!pending.size) { this.markCitations(nodes, repositoryCitations(nodes.map(text => text.data), sources, bound)); return; }
    void (async () => {
      for (const load of pending.values()) { if (signal.aborted) return; await load(); }
      if (signal.aborted) return;
      const current = textNodes();
      this.markCitations(current, repositoryCitations(current.map(text => text.data), sources, bound));
    })();
  }

  private markCitations(nodes: readonly Text[], citations: ReturnType<typeof repositoryCitations<{ id: string; title: string; files: readonly { name: string }[] }>>): void {
    for (const [textIndex, text] of nodes.entries()) {
      const value = text.data, matches = citations[textIndex]!; if (!matches.length) continue;
      const fragment = this.doc.createDocumentFragment(); let offset = 0;
      for (const { start, end, path, line, locator, ambiguous, sources } of matches) {
        fragment.append(this.doc.createTextNode(value.slice(offset, start)));
        const label = value.slice(start, end);
        for (const [index, candidate] of sources.entries()) {
          if (index) fragment.append(this.doc.createTextNode(" / "));
          const button = this.doc.createElement("button"); button.type = "button"; button.className = "pith-source-citation";
          button.dataset.citationPath = path; button.dataset.citationMaterial = candidate.id;
          if (locator) button.dataset.citationLocator = locator;
          else button.dataset.citationLine = String(line);
          button.textContent = ambiguous ? `${label} (${candidate.title})` : label; fragment.append(button);
        }
        offset = end;
      }
      fragment.append(this.doc.createTextNode(value.slice(offset))); text.replaceWith(fragment);
    }
  }

  private async openCitation(button: HTMLButtonElement): Promise<void> {
    const { citationPath: path, citationMaterial: materialId, citationLine: line, citationLocator: locator } = button.dataset;
    if (!path || !materialId) return;
    const source: AnchorSource = { kind: "material", materialId };
    await this.actions.openFile(path, source);
    if (this.disposed || this.currentFile !== path || !sameSource(this.currentSource, source)) return;
    if (locator?.startsWith("time:")) {
      const signal = this.citationAbort.signal;
      await this.assetPending;
      const media = this.assetAudio;
      const limit = media ? await mediaDuration(media, signal) : undefined, time = Number(locator.slice(5));
      if (signal.aborted) return;
      if (!media || limit === undefined || time > limit) { this.tip("无法定位原文"); return; }
      media.pause();
      this.seekMedia(time);
      return;
    }
    const suffix = `#L${line}-L${line}`;
    const target = Array.from(this.article.querySelectorAll<HTMLElement>("[data-locator]")).find(item => locator ? item.dataset.locator === locator : item.dataset.locator?.endsWith(suffix));
    if (!target) { this.tip("无法定位原文"); return; }
    if (this.paged) {
      navigateReaderTarget(this.reader, target, true);
      this.readerPosition = captureReaderPosition(this.reader, this.article);
      this.updatePageCount();
    } else target.scrollIntoView({ block: "center" });
    this.scheduleLocator();
  }

  updateMaterialNavigation(files: ObsidianReaderDocument["files"], curriculum: ObsidianReaderDocument["curriculum"], materialGroups?: ObsidianReaderDocument["materialGroups"]): void {
    if (!this.navigationDocument || this.disposed) return;
    this.navigationDocument = { ...this.navigationDocument, files, curriculum, materialGroups };
    this.renderNavigation(this.navigationDocument);
  }

  private renderNavigation(document: Pick<ObsidianReaderDocument, "files" | "curriculum" | "sections" | "currentFile" | "source" | "materialGroups">): void {
    const navigate = (locator: string) => { this.closeNavigation(); const target = resolveReaderLocator(this.article, locator); if (target) { if (this.speechResult) this.stopSpeech(); navigateReaderTarget(this.reader, target, this.paged); if (this.paged) { this.readerPosition = captureReaderPosition(this.reader, this.article); this.updatePageCount(); } } else this.tip("无法定位书内目标"); };
    renderNavigation(this.navigation, document, navigate);
    this.updateGuideActions();
  }

  guideElement(): HTMLElement { return this.guide; }
  showLessonLoading(title: string): void { this.citationAbort.abort(); this.closeInlineToolkit(); this.voice.cancel(); this.stopSpeech(); this.clearAudioAsset(); this.closeNavigation(); const section = this.doc.createElement("section"), heading = this.doc.createElement("h1"), status = this.doc.createElement("p"); section.className = "pith-lesson-loading"; heading.textContent = title; status.textContent = "向导正在结合课程大纲与源码为你撰写本讲讲义…"; status.setAttribute("role", "status"); section.append(heading, status); this.article.replaceChildren(section); }
  focusQuotedGuide(): void { if (this.pendingAnchor) { const input = this.guide.querySelector<HTMLTextAreaElement>("textarea"); if (input) input.focus(); } }
  setGuideVisible(visible: boolean): void { if (!visible) this.voice.cancel("guide"); this.guide.hidden = !visible; this.guideButton.setAttribute("aria-pressed", String(visible)); if (this.guide.parentElement === this.layout) this.layout.classList.toggle("pith-guide-closed", !visible); }
  setGuideAvailable(available: boolean): void {
    this.guideAvailable = available; this.guideButton.hidden = false; this.updateReadingAids(); this.updateGuideActions();
    if (this.recall && this.recall.available !== available) {
      this.readToolkit();
      this.recall.setAvailable(available);
      this.renderToolkit();
    }
    if (this.guide.querySelector(".pith-guide-compose")) this.renderGuide();
  }
  private updateGuideActions(): void {
    for (const button of this.root.querySelectorAll<HTMLButtonElement>('[data-selection="ask"],[data-planned-lesson]')) {
      button.disabled = !this.guideAvailable;
      button.title = this.guideAvailable ? "" : GUIDE_UNAVAILABLE_REASON;
    }
    const unavailable = this.guideData.readOnly ? "课题已沉淀" : !this.guideAvailable || !this.actions.sendGuide ? GUIDE_UNAVAILABLE_REASON : this.guideSending ? "向导正在回应上一条消息" : "";
    for (const button of this.navigation.querySelectorAll<HTMLButtonElement>("[data-rewrite-lesson]")) {
      const reason = button.nextElementSibling as HTMLElement;
      button.disabled = Boolean(unavailable); button.title = unavailable;
      reason.hidden = !unavailable; reason.textContent = unavailable;
    }
  }
  private updateReadingAids(): void {
    const controls = this.root.querySelector<HTMLElement>("[data-reading-aids]"); if (!controls) return;
    controls.hidden = this.currentSource?.kind !== "material";
    if (!this.guideAvailable) this.interlineMode = "original";
    else if (this.interlineMode !== "subtitle-primary") this.interlineMode = this.materialAids.includes("interline") ? "bilingual" : "original";
    this.interline?.setMode(this.interlineMode);
    controls.querySelectorAll<HTMLButtonElement>("[data-interline-mode]").forEach(button => { button.setAttribute("aria-pressed", String(button.dataset.interlineMode === this.interlineMode)); button.disabled = button.dataset.interlineMode !== "original" && (!this.guideAvailable || !this.actions.prepareInterline); });
    controls.querySelector<HTMLElement>("[data-interline-reason]")!.textContent = !this.guideAvailable ? "向导未连接，暂时只显示原文" : !this.actions.prepareInterline ? "行间服务不可用" : "";
  }
  private scheduleLocator(): void {
    if (!this.actions.saveLocator || !this.currentFile) return;
    if (this.locatorTimer !== undefined) this.win.clearTimeout(this.locatorTimer);
    const file = this.currentFile, source = this.currentSource;
    this.locatorTimer = this.win.setTimeout(() => {
      if (file !== this.currentFile || !sameSource(source, this.currentSource)) return;
      void this.persistLocator().catch(error => this.tip(String(error)));
    }, 200);
  }
  private async persistLocator(): Promise<void> {
    if (this.locatorTimer !== undefined) { this.win.clearTimeout(this.locatorTimer); this.locatorTimer = undefined; }
    if (!this.actions.saveLocator || !this.currentFile) return;
    const position = captureReaderPosition(this.reader, this.article);
    if (position) await this.actions.saveLocator(readingLocator(position));
  }
  setToolkitActive(active: boolean): void { this.toolkitActive = active; this.dock.classList.toggle("active", active || this.speaking); }
  setToolkits(toolkits: readonly string[]): void { this.configuredToolkits = this.actions.scene === "material" ? [] : toolkits.filter(id => id !== "interline"); const previous = this.toolkitId; const slot = toolkitSlot(this.configuredToolkits, previous, Object.fromEntries(this.toolkits.map(item => [item.id, item.label]))); this.mountedToolkits = slot.ids; this.toolkitId = slot.active; if (previous && !slot.ids.includes(previous)) this.closeInlineToolkit(); const button = this.dock.querySelector<HTMLButtonElement>("#open-toolkit"); if (!button) return; button.hidden = this.actions.scene === "material"; button.innerHTML = `${pithIcon("sliders")}<span class="pith-toolkit-label"></span>`; button.querySelector("span")!.textContent = slot.text; button.classList.toggle("pith-toolkit-add", !slot.ids.length); button.title = slot.ids.length ? `打开实训工具：${slot.text}` : "打开实训工具"; button.setAttribute("aria-label", button.title); }
  turnPage(direction: number): void { if (!this.paged) return; if (this.speechResult) this.stopSpeech(); this.reader.scrollTo({ left: Math.max(0, readerPageIndex(this.reader) + direction) * this.reader.clientWidth, behavior: "instant" }); this.readerPosition = captureReaderPosition(this.reader, this.article); this.updatePageCount(); this.scheduleLocator(); }
  private updatePageCount(): void { const counter = this.root.querySelector<HTMLElement>("[data-page-count]"); if (!counter) return; const width = Math.max(1, this.reader.clientWidth); const total = Math.max(1, Math.ceil(this.reader.scrollWidth / width)); counter.textContent = `${readerPageIndex(this.reader) + 1} / ${total}`; }
  private adaptEpubColors(): void {
    const chapters = this.article.querySelectorAll<HTMLElement>(".pith-epub-chapter[data-epub-chapter]");
    if (!chapters.length) return;
    for (const element of this.article.querySelectorAll<HTMLElement>("[data-pith-readable]")) { element.removeAttribute("data-pith-readable"); element.style.removeProperty("--pith-readable-color"); }
    const body = this.doc.body;
    const dark = body.classList.contains("theme-dark") || (!body.classList.contains("theme-light") && typeof this.win.matchMedia === "function" && this.win.matchMedia("(prefers-color-scheme: dark)").matches);
    const backgrounds = new Map<Element, Rgb>();
    const background = (element: Element | null): Rgb => {
      if (!element) return [255, 255, 255];
      const cached = backgrounds.get(element); if (cached) return cached;
      const parent = background(element.parentElement), value = rgba(this.win.getComputedStyle(element).backgroundColor);
      const result = value ? composite(value, parent) : parent; backgrounds.set(element, result); return result;
    };
    for (const chapter of chapters) {
      const painted = new Map<Element, boolean>();
      // Descendants must inherit the corrected color before their own contrast is measured.
      for (const element of [chapter, ...chapter.querySelectorAll<HTMLElement>("*")]) {
        if (element.tagName === "STYLE" || element.closest("svg")) continue;
        const style = this.win.getComputedStyle(element);
        const layer = rgba(style.backgroundColor);
        const localBackground = Boolean(layer && layer[3] > 0) || (element !== chapter && painted.get(element.parentElement!) === true);
        painted.set(element, localBackground);
        if (!dark && !localBackground) continue;
        const color = rgba(style.color);
        if (!color) continue;
        const adjusted = readableColor(color, background(element));
        if (adjusted) { element.style.setProperty("--pith-readable-color", `rgb(${adjusted.join(", ")})`); element.setAttribute("data-pith-readable", ""); }
      }
    }
  }
  dispose(): void { this.disposed = true; this.citationAbort.abort(); this.recall?.dispose(); this.recall = undefined; this.stopCuePlayback(); this.voice.dispose(); this.stopRecordedPlayback(); if (this.interline) this.interline.dispose(); this.stopSpeech(); this.clearAudioAsset(); if (this.locatorTimer !== undefined) this.win.clearTimeout(this.locatorTimer); this.events.abort(); if (this.resizeObserver) this.resizeObserver.disconnect(); if (this.themeObserver) this.themeObserver.disconnect(); if (activeReader.get(this.doc) === this) activeReader.delete(this.doc); if (this.toastTimer !== undefined) this.win.clearTimeout(this.toastTimer); if (this.guideClock !== undefined) this.win.clearInterval(this.guideClock); this.guide.remove(); this.root.replaceChildren(); this.root.classList.remove("pith-view"); }

  private clearAudioAsset(): void { this.assetGeneration++; this.assetPending = undefined; const media = this.assetAudio; this.assetAudio = null; if (media) { media.pause(); media.removeAttribute("src"); media.load(); } if (this.assetUrl) URL.revokeObjectURL(this.assetUrl); this.assetUrl = null; this.assetControls.hidden = true; this.mediaDeck.hidden = !this.speaking; this.playback.renderCueMarkers(); }
  private async loadAsset(): Promise<void> {
    const source = this.assetSource, load = this.actions.loadAudio; if (!source || !load) return; const generation = ++this.assetGeneration;
    try { const bytes = await load(source.name); if (this.disposed || generation !== this.assetGeneration) return;
      this.assetUrl = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: source.type })); let media: HTMLMediaElement;
      if (source.type.startsWith("video/")) { const existing = this.article.querySelector<HTMLVideoElement>(".pith-timeline-video"), element = existing ?? this.doc.createElement("video"); if (!existing) { element.className = "pith-timeline-video"; element.playsInline = true; element.preload = "metadata"; this.article.querySelector(".pith-timeline-stage")?.prepend(element); } media = element; } else { this.article.querySelector(".pith-timeline-video")?.remove(); media = this.doc.createElement("audio"); }
      this.assetAudio = media; media.src = this.assetUrl; media.playbackRate = this.speechRate; media.addEventListener("timeupdate", () => this.updateAssetControls()); media.addEventListener("loadedmetadata", () => { this.playback.renderCueMarkers(); this.updateAssetControls(); }); media.addEventListener("play", () => this.updateAssetControls()); media.addEventListener("pause", () => { if (media.paused && this.cueRange?.audio === media) this.stopCuePlayback(); this.updateAssetControls(); }); media.addEventListener("ended", () => { if (this.cueRange?.audio === media) this.stopCuePlayback(); }); media.addEventListener("error", () => { if (this.assetAudio === media) this.tip("音视频播放失败"); }); this.assetControls.hidden = false; this.mediaDeck.hidden = false; this.playback.renderCueMarkers(); this.updateAssetControls();
    } catch (error) { if (!this.disposed && generation === this.assetGeneration) this.tip(error instanceof Error ? error.message : String(error)); }
  }
  private seekMedia(value: number): void {
    const media = this.assetAudio; if (!media || !Number.isFinite(value)) return; this.stopCuePlayback(); media.currentTime = Math.max(0, Math.min(Number.isFinite(media.duration) ? media.duration : value, value));
    const cues = Array.from(this.article.querySelectorAll<HTMLElement>('.pith-cue[data-locator^="time:"]')); const cue = cues.find((item, i) => { const start = Number(item.dataset.locator!.slice(5)), end = item.dataset.endSec === undefined ? (cues[i + 1] ? Number(cues[i + 1]!.dataset.locator!.slice(5)) : Infinity) : Number(item.dataset.endSec); return media.currentTime >= start && media.currentTime < end; });
    if (cue) { if (this.inlineToolkit && this.toolkitId === "shadowing" && cue !== this.toolkitBlock) { const playing = !media.paused, copy = cue.cloneNode(true) as HTMLElement; copy.querySelector("time")?.remove(); const text = (copy.textContent ?? "").trim(); this.closeInlineToolkit(); this.toolkitTarget = text; this.toolkitAnchor = this.currentSource ? { source: this.currentSource, file: this.currentFile, locator: cue.dataset.locator!, quote: text } : undefined; this.requestedToolkitBlock = cue; this.toolkitResult = null; this.toolkitStatus = ""; this.renderToolkit(); if (playing) void media.play().catch(error => this.tip(error instanceof Error ? error.message : String(error))); } cue.scrollIntoView({ block: "nearest" }); }
    this.updateAssetControls();
  }
  private updateAssetControls(): void { const audio = this.speaking ? this.speechAudio : this.cuePlayer ?? this.recordedPlayer ?? this.assetAudio; if (!audio) return; const cue = this.cueRange; if (!this.speaking && cue && cue.audio === audio && audio.currentTime >= cue.end) { if (cue.loop) audio.currentTime = cue.start; else { this.stopCuePlayback(); audio.currentTime = cue.end; } } const format = (value: number): string => { const n = Number.isFinite(value) ? Math.floor(value) : 0; return `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`; }; const time = this.assetControls.querySelector<HTMLElement>("[data-media-time]"); if (time) time.textContent = `${format(audio.currentTime)} / ${format(audio.duration)}`; const seek = this.assetControls.querySelector<HTMLInputElement>(".pith-media-seek"); if (seek) { seek.max = String(Number.isFinite(audio.duration) ? audio.duration : 0); seek.value = String(audio.currentTime); } const play = this.assetControls.querySelector<HTMLButtonElement>('[data-media="play"]'); if (play) { play.innerHTML = pithIcon(audio.paused ? "play" : "pause"); play.setAttribute("aria-label", audio.paused ? "播放" : "暂停"); } if (this.speaking || this.cuePlayer || this.recordedPlayer) return; const cues = Array.from(this.article.querySelectorAll<HTMLElement>('.pith-cue[data-locator^="time:"]')); for (let i = 0; i < cues.length; i++) { const item = cues[i]!; const start = Number(item.dataset.locator!.slice(5)), end = item.dataset.endSec !== undefined ? Number(item.dataset.endSec) : cues[i + 1] ? Number(cues[i + 1]!.dataset.locator!.slice(5)) : Infinity; item.classList.toggle("pith-speech-active", audio.currentTime >= start && audio.currentTime < end); } }

  private applyPageMode(position: ReaderPosition | null = null): void { const decision = resolveResponsiveLayout({ width: this.root.clientWidth, height: this.root.clientHeight, readerWidthPx: this.reader.clientWidth, guideOpen: false, preferredColumns: this.pageMode, coarsePointer: typeof this.win.matchMedia === "function" && this.win.matchMedia("(pointer: coarse)").matches }); this.root.dataset.formFactor = decision.formFactor; this.root.dataset.sheetMode = decision.sheetMode; this.root.dataset.hitTarget = String(decision.hitTargetPx); const double = this.root.querySelector<HTMLButtonElement>('[data-mode="double"]'), triple = this.root.querySelector<HTMLButtonElement>('[data-mode="triple"]'); if (double) double.disabled = decision.maxColumns < 2; if (triple) triple.disabled = decision.maxColumns < 3; const controls = this.root.querySelector<HTMLElement>("[data-pages]"); if (controls) controls.hidden = !this.paged; const modes = this.root.querySelector<HTMLElement>("[data-page-modes]"); if (modes) modes.hidden = !this.paged; this.reader.classList.toggle("pith-paged", this.paged); if (this.paged) { applyPaginationStyles(this.reader, this.article, decision.effectiveColumns === 3 ? "triple" : decision.effectiveColumns === 2 ? "double" : "single", this.mediaLoaded); restoreReaderPosition(this.reader, this.article, position); this.restoredScrollLeft = position ? this.reader.scrollLeft : null; this.readerPosition = position ?? captureReaderPosition(this.reader, this.article); this.updatePageCount(); } else { for (const property of ["box-sizing", "width", "height", "padding", "column-width", "column-gap", "column-fill", "--pith-page-height"]) this.article.style.removeProperty(property); this.reader.style.removeProperty("overflow-x"); this.reader.style.removeProperty("overflow-y"); } if (this.interline) this.interline.activate(); }
  private markExisting(): void { for (const mark of this.article.querySelectorAll("mark[data-pith-note]")) mark.replaceWith(...mark.childNodes); this.article.normalize(); for (const { note, owner } of noteEntries(this.guideData.notes, this.materialNotes)) { const anchor = note.anchor; if (note.kind === "practice" || !anchor || anchor.file !== this.currentFile || !sameSource(anchor.source, this.currentSource) || !anchor.quote) continue; const page = /^page:\d+$/.test(anchor.locator) ? Array.from(this.article.querySelectorAll<HTMLElement>(".pith-pdf-text[data-locator]")).find(item => item.dataset.locator === anchor.locator) : undefined; if (/^page:\d+$/.test(anchor.locator) && this.article.querySelector(".pith-pdf-text") && !page) continue; const walker = this.doc.createTreeWalker(page ?? this.article, 4); const nodes: { node: Text; start: number }[] = []; let node: Node | null, text = ""; while ((node = walker.nextNode())) { const part = node as Text; if (part.parentElement && part.parentElement.closest(".pith-interline-subtitle,.pith-inline-toolkit,[data-toolkit-display]")) continue; nodes.push({ node: part, start: text.length }); text += part.data; } const match = matchTextAnchor(text, anchor); if (!match) continue; for (const part of nodes) { const start = Math.max(0, match.startOffset - part.start), end = Math.min(part.node.length, match.endOffset - part.start); if (start >= end) continue; const range = this.doc.createRange(); range.setStart(part.node, start); range.setEnd(part.node, end); const mark = this.doc.createElement("mark"); mark.dataset.pithNote = note.id; mark.dataset.noteOwner = owner; range.surroundContents(mark); } } }
  async refreshGuide(): Promise<void> { if (!this.actions.guideData || this.disposed) return; const generation = ++this.guideGeneration; const data = await this.actions.guideData(); if (this.disposed || generation !== this.guideGeneration) return; const position = this.readerPosition; this.guideData = data; this.setToolkits(data.toolkits); this.renderGuide(); this.markExisting(); if (this.paged && position) { restoreReaderPosition(this.reader, this.article, position); this.readerPosition = captureReaderPosition(this.reader, this.article); } }
  updateGuideTurn(turn: GuideTurn): void { const conversation = [...this.guideData.conversation]; const index = conversation.findIndex(item => item.id === turn.id); if (index < 0) conversation.push(turn); else conversation[index] = turn; this.guideData = { ...this.guideData, conversation }; if (!this.disposed) this.renderGuide(); }
  /**
   * Runs one guide turn. Until `run` settles the guide panel shows `text` as sent with a waiting status, and no second turn starts.
   * A failure stays visible in the panel until the next turn starts and reaches the caller unchanged.
   */
  async guideTurn<T>(text: string, run: () => Promise<T>): Promise<T> {
    if (this.guideData.readOnly) throw new Error("已沉淀的课题不可发送消息");
    if (!this.guideAvailable) throw new Error(GUIDE_UNAVAILABLE_REASON);
    if (this.guideSending) throw new Error("向导正在回应上一条消息");
    this.guideSending = true; this.guideError = ""; this.guidePending = { text, from: this.guideData.conversation.length }; this.guideTab = "chat"; this.renderGuide();
    try { const value = await run(); await this.refreshGuide(); return value; }
    catch (error) { this.guideError = error instanceof Error ? error.message : String(error); throw error; }
    finally { this.guideSending = false; this.guidePending = undefined; if (!this.disposed) this.renderGuide(); }
  }
  quoteSelection(anchor: SelectionAnchor, tab: "chat" | "notes"): void { if (tab === "chat" && !this.guideAvailable) { this.tip(GUIDE_UNAVAILABLE_REASON); return; } this.pendingAnchor = anchor; this.guideTab = tab; this.setGuideVisible(true); if (this.actions.guideVisibilityChanged) this.actions.guideVisibilityChanged(true); this.renderGuide(); this.guide.querySelector<HTMLTextAreaElement>("textarea")?.focus(); }
  private renderGuide(): void {
    this.voice.cancel("guide");
    renderGuide(this.guide, { ...this.guideData, materialNotes: this.materialNotes, guideAvailable: this.guideAvailable }, this.guideTab, this.pendingAnchor, this.guideSending, this.guidePending, this.guideError, this.actions.scene === "material");
    this.updateGuideActions();
    if (this.guideClock !== undefined) this.win.clearInterval(this.guideClock);
    const update = () => { for (const node of this.guide.querySelectorAll<HTMLElement>("[data-started]")) { const elapsed = node.querySelector<HTMLElement>("[data-guide-elapsed]"); if (elapsed) elapsed.textContent = `已用 ${Math.max(0, Math.floor((Date.now() - Date.parse(node.dataset.started!)) / 1000))} 秒`; } };
    update(); this.guideClock = this.guide.querySelector("[data-started]") ? this.win.setInterval(update, 1000) : undefined;
  }
  openToolkit(toolkits: readonly ToolkitDescriptor[], text?: string, anchor?: SelectionAnchor): void {
    if (this.actions.scene === "material") return;
    toolkits = toolkits.filter(item => item.role === "training");
    this.toolkits = toolkits;
    const mounted = toolkits.filter(item => this.mountedToolkits.includes(item.id));
    if (text === undefined && this.actions.toggleToolkit) {
      const explicit = this.requestedToolkitBlock && this.article.contains(this.requestedToolkitBlock) ? this.requestedToolkitBlock : this.toolkitBlock;
      if (this.inlineToolkit) this.closeInlineToolkit();
      if (explicit && this.article.contains(explicit) && this.toolkitAnchor?.file === this.currentFile && this.toolkitTarget) this.requestedToolkitBlock = explicit;
      else { this.requestedToolkitBlock = null; const current = visibleToolkitTarget(this.article, this.reader, this.currentFile); if (current && this.currentSource) { this.toolkitTarget = current.quote; this.toolkitAnchor = { ...current, source: this.currentSource }; } }
      this.popover.hidden = true; renderToolkitMenu(this.toolkit, toolkits, this.mountedToolkits);
      return;
    }
    if (!mounted.length) { this.tip("没有已挂载的实训工具"); return; }
    this.popover.hidden = true;
    if (this.inlineToolkit) this.closeInlineToolkit();
    if (text !== undefined) { this.toolkitTarget = text; this.toolkitAnchor = anchor; }
    else {
      const current = visibleToolkitTarget(this.article, this.reader, this.currentFile);
      if (current && this.currentSource) { this.toolkitTarget = current.quote; this.toolkitAnchor = { ...current, source: this.currentSource }; }
    }
    this.toolkitResult = null; this.toolkitStatus = ""; this.toolkitVersion++;
    if (mounted.length > 1) {
      this.toolkit.hidden = false; this.toolkit.innerHTML = "";
      for (const item of mounted) { const button = this.doc.createElement("button"); button.dataset.toolkitChoose = item.id; button.textContent = item.label; this.toolkit.append(button); }
      return;
    }
    this.toolkitId = mounted[0]!.id; this.renderToolkit();
  }
  private nativeCueRange(): { audio: HTMLMediaElement; start: number; end: number } | null {
    const audio = this.assetAudio, block = this.toolkitBlock, locator = block?.dataset.locator;
    if (!audio || !block || !locator?.startsWith("time:") || block.dataset.endSec === undefined) return null;
    const start = Number(locator.slice(5)), end = Number(block.dataset.endSec);
    return Number.isFinite(start) && Number.isFinite(end) && start >= 0 && end > start ? { audio, start, end } : null;
  }
  private updateCueButtons(): void {
    const play = this.inlineToolkit?.querySelector<HTMLButtonElement>("[data-toolkit-play-cue]"), loop = this.inlineToolkit?.querySelector<HTMLButtonElement>("[data-toolkit-loop-cue]");
    if (play) { play.innerHTML = this.cuePlaying && !this.cueLoop ? `${pithIcon("stop")} 停止原声` : `${pithIcon("play")} 原声${this.toolkitStage === "listen-decompose" ? " 0.75x" : ""}`; play.setAttribute("aria-pressed", String(this.cuePlaying && !this.cueLoop)); }
    if (loop) loop.setAttribute("aria-pressed", String(this.cuePlaying && this.cueLoop));
  }
  private stopRecordedPlayback(): void { if (this.recordedPlayer) { const player = this.recordedPlayer; this.recordedPlayer = null; player.pause(); player.removeAttribute("src"); player.load(); this.assetControls.hidden = !this.assetAudio && !this.speaking && !this.cuePlayer; this.mediaDeck.hidden = this.assetControls.hidden; this.playback.renderCueMarkers(); this.updateAssetControls(); } }
  private stopCuePlayback(): void {
    this.cueGeneration++;
    if (this.cueAbort) this.cueAbort.abort(); this.cueAbort = null;
    if (typeof this.cueFrame === "number") this.win.cancelAnimationFrame(this.cueFrame); this.cueFrame = null;
    const range = this.cueRange; this.cueRange = null;
    if (range) { range.audio.pause(); range.audio.playbackRate = this.speechRate; }
    if (this.cuePlayer) { const player = this.cuePlayer; this.cuePlayer = null; player.pause(); player.removeAttribute("src"); player.load(); this.assetControls.hidden = !this.assetAudio && !this.speaking; this.mediaDeck.hidden = this.assetControls.hidden; this.playback.renderCueMarkers(); this.updateAssetControls(); }
    if (this.cueUrl) URL.revokeObjectURL(this.cueUrl); this.cueUrl = null;
    this.cuePlaying = false; this.cueLoop = false; this.updateCueButtons();
  }
  private async playCue(loop: boolean): Promise<void> {
    this.stopCuePlayback(); this.stopRecordedPlayback();
    const generation = this.cueGeneration;
    this.cuePlaying = true; this.cueLoop = loop; this.updateCueButtons();
    try {
      if (!this.assetAudio && this.assetSource) await this.loadAsset();
      if (generation !== this.cueGeneration) return;
      const range = this.nativeCueRange();
      if (range) {
        this.stopSpeech(); this.cueRange = { ...range, loop }; range.audio.currentTime = range.start; range.audio.playbackRate = this.toolkitStage === "listen-decompose" ? .75 : this.speechRate;
        await range.audio.play();
        if (generation !== this.cueGeneration) return;
        const tick = () => { if (generation !== this.cueGeneration || !this.cueRange) return; this.updateAssetControls(); if (this.cueRange) this.cueFrame = this.win.requestAnimationFrame(tick); };
        this.cueFrame = this.win.requestAnimationFrame(tick);
      } else {
        const synthesize = this.actions.synthesizeSpeech; if (!synthesize) throw new Error("未连接可用的语音服务");
        if (this.assetAudio) this.assetAudio.pause(); if (this.speaking) this.stopSpeech();
        const abort = new AbortController(); this.cueAbort = abort;
        const speech = await synthesize(this.toolkitTarget, abort.signal); if (generation !== this.cueGeneration || abort.signal.aborted) return;
        if (!speech.bytes.byteLength) throw new Error("语音引擎返回空音频");
        this.cueUrl = URL.createObjectURL(new Blob([new Uint8Array(speech.bytes)], { type: speech.mimeType }));
        const audio = this.doc.createElement("audio"); this.cuePlayer = audio; audio.src = this.cueUrl; audio.playbackRate = this.toolkitStage === "listen-decompose" ? .75 : this.speechRate; this.assetControls.hidden = false; this.mediaDeck.hidden = false; this.playback.renderCueMarkers(); for (const event of ["loadedmetadata", "timeupdate", "play", "pause"]) audio.addEventListener(event, () => { if (this.cuePlayer === audio) this.updateAssetControls(); });
        audio.onended = () => { if (generation !== this.cueGeneration) return; if (loop) { audio.currentTime = 0; void audio.play().catch(error => { if (generation === this.cueGeneration) { this.stopCuePlayback(); this.tip(error instanceof Error ? error.message : String(error)); } }); } else this.stopCuePlayback(); };
        audio.onerror = () => { if (generation === this.cueGeneration) { this.stopCuePlayback(); this.tip("播放失败：音频不可用"); } };
        await audio.play();
      }
    } catch (error) { if (generation !== this.cueGeneration) return; this.stopCuePlayback(); if (!(error instanceof DOMException && error.name === "AbortError")) this.tip(`播放失败：${error instanceof Error ? error.message : String(error)}`); }
  }
  private async playRecording(): Promise<void> {
    if (!this.recordedUrl) return;
    this.stopCuePlayback(); this.stopRecordedPlayback(); if (this.assetAudio) this.assetAudio.pause(); if (this.speaking) this.stopSpeech();
    const player = this.doc.createElement("audio"); this.recordedPlayer = player; player.src = this.recordedUrl; this.assetControls.hidden = false; this.mediaDeck.hidden = false; this.playback.renderCueMarkers(); for (const event of ["loadedmetadata", "timeupdate", "play", "pause"]) player.addEventListener(event, () => { if (this.recordedPlayer === player) this.updateAssetControls(); }); player.onended = () => { if (this.recordedPlayer === player) this.stopRecordedPlayback(); };
    try { await player.play(); } catch (error) { if (this.recordedPlayer !== player) return; this.stopRecordedPlayback(); if (!(error instanceof DOMException && error.name === "AbortError")) this.tip(`播放录音失败：${error instanceof Error ? error.message : String(error)}`); }
  }
  private closeInlineToolkit(): void {
    this.popover.hidden = true;
    this.readToolkit();
    this.recall?.dispose(); this.recall = undefined;
    this.toolkitVersion++; this.voice.cancel("toolkit"); this.stopCuePlayback(); this.voice.clearRecording(); this.stopRecordedPlayback();
    if (this.toolkitSource && this.toolkitBlock) { const source = this.toolkitSource; this.preserveMovedSelection(source, () => source.replaceWith(...Array.from(source.childNodes))); }
    this.toolkitBlock?.classList.remove("pith-shadowing-spotlight"); this.toolkitLenses?.remove(); this.toolkitDisplay?.remove(); this.inlineToolkit?.remove();
    this.toolkitLenses = null; this.inlineToolkit = null; this.toolkitBlock = null; this.toolkitSource = null; this.toolkitDisplay = null;
    this.setToolkitActive(false);
  }
  private preserveMovedSelection(container: HTMLElement, move: () => void): void {
    const selection = this.win.getSelection();
    const anchor = selection?.anchorNode, focus = selection?.focusNode;
    const saved = selection && anchor && focus && !selection.isCollapsed && container.contains(anchor) && container.contains(focus)
      ? { anchor, focus, anchorOffset: selection.anchorOffset, focusOffset: selection.focusOffset }
      : selection?.isCollapsed && this.pendingToolkitSelection && container.contains(this.pendingToolkitSelection.anchor) && container.contains(this.pendingToolkitSelection.focus) ? this.pendingToolkitSelection : null;
    this.pendingToolkitSelection = null;
    move();
    const validOffset = (node: Node, offset: number): boolean => offset <= (node.nodeType === 3 ? (node as Text).length : node.childNodes.length);
    if (selection && saved && saved.anchor.isConnected && saved.focus.isConnected && validOffset(saved.anchor, saved.anchorOffset) && validOffset(saved.focus, saved.focusOffset)) {
      selection.setBaseAndExtent(saved.anchor, saved.anchorOffset, saved.focus, saved.focusOffset);
      this.selectionRange = selection.getRangeAt(0).cloneRange();
    }
  }
  private restoreRecallOverlay(): void {
    const { toolkitBlock: block, toolkitSource: source, toolkitDisplay: display, inlineToolkit: inline } = this;
    if (!this.recall || !block || !source || !display || !inline || this.article.contains(source)) return;
    // A line or an entire EPUB unit may have been replaced by the reading aid.
    const target = this.article.contains(block) ? block : resolveReaderLocator(this.article, block.dataset.locator ?? "");
    if (!target) return;
    this.preserveMovedSelection(target, () => {
      source.replaceChildren(...Array.from(target.childNodes));
      target.append(source, display);
    });
    if (inline.previousElementSibling !== target) target.insertAdjacentElement("afterend", inline);
    this.toolkitBlock = target;
  }
  private mountInlineToolkit(): boolean {
    const requested = this.requestedToolkitBlock;
    const anchor = this.toolkitAnchor;
    const block = requested && this.article.contains(requested) ? requested : anchor ? resolveReaderLocator(this.article, anchor.locator) : null;
    const target = block ?? Array.from(this.article.querySelectorAll<HTMLElement>('[data-prose="true"],.pith-cue')).find(item => (item.textContent ?? "").includes(this.toolkitTarget)) ?? null;
    this.requestedToolkitBlock = null;
    if (!target || !this.toolkitTarget || !anchor) { this.tip("当前页面没有可用原文"); return false; }
    if (this.toolkitBlock !== target) {
      this.closeInlineToolkit(); this.toolkitBlock = target;
      const source = this.doc.createElement("span"); source.className = "pith-toolkit-source";
      this.preserveMovedSelection(target, () => { const time = target.classList.contains("pith-cue") ? target.querySelector(":scope > time") : null; for (const node of Array.from(target.childNodes)) if (node !== time) source.append(node); target.append(source); });
      const display = this.doc.createElement("span"); display.dataset.toolkitDisplay = ""; display.dataset.prose = "false";
      target.append(display); this.toolkitSource = source; this.toolkitDisplay = display;
      const inline = this.doc.createElement("section"); inline.className = "pith-inline-toolkit"; inline.dataset.prose = "false"; target.insertAdjacentElement("afterend", inline); this.inlineToolkit = inline;
    }
    if (this.assetAudio) this.assetAudio.pause();
    if (this.speaking) this.stopSpeech();
    this.toolkitProduced = this.toolkitDrafts.get(this.toolkitDraftKey())?.text ?? "";
    this.toolkitReveal = false; this.setToolkitActive(true); return true;
  }
  private renderToolkit(): void {
    this.voice.cancel("toolkit"); const toolkit = this.toolkits.find(item => item.id === this.toolkitId); if (!toolkit) return;
    this.setToolkits(this.configuredToolkits);

    this.toolkit.hidden = true;
    if (!this.inlineToolkit && !this.mountInlineToolkit()) return;
    if (!toolkit.stages.includes(this.toolkitStage)) this.toolkitStage = toolkit.stages[0]!;
    if (this.toolkitLenses) this.toolkitLenses.remove();
    if (toolkit.id === "feynman" && !this.recall) {
      const key = this.toolkitDraftKey();
      const recall = new RecallPractice(this.toolkitTarget, this.toolkitAnchor!, {
        prepare: (source, signal) => { if (!this.actions.prepareRecall) return Promise.reject(new Error("对照服务不可用")); return this.actions.prepareRecall(source, signal); },
        compare: (source, points, produced, signal) => { if (!this.actions.compareRecall) return Promise.reject(new Error("对照服务不可用")); return this.actions.compareRecall(source, points, produced, signal); },
        capture: async (body, anchor, result) => {
          if (!this.actions.savePractice) throw new Error("实训保存不可用");
          const note = await this.actions.savePractice(body, anchor, result);
          this.consumeRecallDraft(key, recall);
          await this.refreshGuide().catch(error => { if (!this.disposed) this.tip(error instanceof Error ? error.message : String(error)); });
          return note;
        },
      }, () => { if (!this.disposed && this.recall === recall && this.inlineToolkit) { this.readToolkit(); this.renderToolkit(); } }, this.guideAvailable);
      this.recall = recall;
    }
    const recall = this.recall;
    const previous = recall?.result && recall.recordId ? previousRecall(this.guideData.notes, recall.recordId, recall.result.passage) : undefined;
    this.toolkitLenses = renderInlineToolkit({ block: this.toolkitBlock!, inline: this.inlineToolkit!, source: this.toolkitSource!, display: this.toolkitDisplay!, toolkit, stage: this.toolkitStage, target: this.toolkitTarget, reveal: this.toolkitReveal, recorded: Boolean(this.recordedUrl), result: this.toolkitResult, produced: this.toolkitProduced, status: this.toolkitStatus, recall, previous, recallSubmitting: Boolean(recall && this.recallSubmissions.has(this.toolkitDraftKey())) });
    this.updateCueButtons();
  }
  private toolkitDraftKey(): string { return JSON.stringify([this.toolkitId, this.toolkitAnchor?.file, this.toolkitAnchor?.locator, this.toolkitAnchor?.quote]); }
  private readToolkit(): void {
    const field = this.inlineToolkit?.querySelector<HTMLTextAreaElement>("[data-toolkit-produced]");
    if (!field) return;
    const changed = field.value !== this.toolkitProduced;
    if (changed) { this.toolkitResult = null; this.toolkitStatus = ""; }
    this.toolkitProduced = field.value;
    const key = this.toolkitDraftKey();
    if (!this.recall) this.toolkitDrafts.set(key, { text: field.value });
    else if (changed) {
      if (!field.value.trim() || (this.recall.saved && this.recall.produced.trim() === field.value.trim())) this.toolkitDrafts.delete(key);
      else this.toolkitDrafts.set(key, { text: field.value });
    }
  }
  private consumeRecallDraft(key: string, origin: RecallPractice): void {
    const submitted = this.recallSubmissions.get(key);
    if (!submitted) return;
    const active = !this.disposed && this.recall && this.toolkitDraftKey() === key;
    if (active) this.readToolkit();
    // Only the submitted revision is consumed, even if a later edit has the same text.
    if (this.toolkitDrafts.get(key) !== submitted) return;
    this.toolkitDrafts.delete(key);
    if (active && this.recall !== origin) {
      this.toolkitProduced = "";
      const field = this.inlineToolkit?.querySelector<HTMLTextAreaElement>("[data-toolkit-produced]");
      if (field) field.value = "";
    }
  }
  private updateRecallSubmit(): void {
    const submit = this.inlineToolkit?.querySelector<HTMLButtonElement>("[data-toolkit-submit]");
    if (this.recall && submit) submit.disabled = this.recallSubmissions.has(this.toolkitDraftKey()) || this.recall.busy || (!this.recall.available && !this.recall.canSubmit(this.toolkitProduced));
  }

  private closeNavigation(): void { this.navigation.hidden = true; this.navigationButton.setAttribute("aria-expanded", "false"); }
  private toolkitMenuOpen(): boolean { return !this.toolkit.hidden && this.toolkit.querySelector(".pith-toolkit-group") !== null; }
  private openEpubLink(link: HTMLElement): void { const target = resolveEpubTarget(this.article, link.dataset.epubTarget ?? ""); if (target) { if (this.speechResult) this.stopSpeech(); navigateReaderTarget(this.reader, target, this.paged); if (this.paged) { this.readerPosition = captureReaderPosition(this.reader, this.article); this.updatePageCount(); } } else this.tip("无法定位书内目标"); }
  private tip(text: string, speechSettings = false): void { this.toast.textContent = text; if (speechSettings && this.actions.openSettings) { const button = this.doc.createElement("button"); button.textContent = "配置语音"; button.onclick = () => { this.toast.hidden = true; this.actions.openSettings!(); }; this.toast.append(" ", button); } this.toast.hidden = false; if (this.toastTimer !== undefined) this.win.clearTimeout(this.toastTimer); this.toastTimer = this.win.setTimeout(() => { this.toast.hidden = true; }, speechSettings ? 5000 : 2000); }
  private async click(event: MouseEvent): Promise<void> {
    const target = event.target as Element | null; if (!target || typeof target.closest !== "function") return; const link = target.closest<HTMLElement>("a[data-epub-target]"); if (link && this.article.contains(link)) { event.preventDefault(); this.openEpubLink(link); return; } const button = target.closest<HTMLButtonElement>("button");
    const cue = target.closest<HTMLElement>(".pith-cue");
    if (cue && cue !== this.toolkitBlock && this.article.contains(cue) && !button) { if (this.assetAudio && cue.dataset.locator?.startsWith("time:")) { const position = Number(cue.dataset.locator.slice(5)); if (Number.isFinite(position)) this.assetAudio.currentTime = position; } const available = this.mountedToolkits.filter(id => id === "shadowing" || id === "feynman"); if (!available.length) return; if (!available.some(id => id === this.toolkitId)) this.toolkitId = available[0]!; const copy = cue.cloneNode(true) as HTMLElement; const time = copy.querySelector("time"); if (time) time.remove(); this.requestedToolkitBlock = cue; this.actions.openToolkit((copy.textContent ?? "").trim(), cue.dataset.locator); return; }
    const prose = target.closest<HTMLElement>('[data-prose="true"],[data-trainable="true"]');
    if (!button && prose && prose !== this.toolkitBlock && this.article.contains(prose) && this.mountedToolkits.some(id => id === "shadowing" || id === "feynman")) { const selection = this.win.getSelection(); if (selection && !selection.isCollapsed) return; this.requestedToolkitBlock = prose; const range = this.doc.createRange(); range.selectNodeContents(this.article); range.setEndBefore(prose); this.actions.openToolkit(proseTextNodes(prose).map(node => node.data).join("").trim(), prose.dataset.locator || `text:offset:${range.toString().length}`); return; }
    if (!button || button.disabled) return;
    if (!this.root.contains(button) && !this.guide.contains(button)) return;
    if (button.dataset.checkRepository && this.actions.checkRepositoryUpdate) {
      button.disabled = true; button.textContent = "正在检查…";
      try { this.tip(await this.actions.checkRepositoryUpdate(button.dataset.checkRepository)); } catch (error) { this.tip(error instanceof Error ? error.message : String(error)); }
      finally { button.disabled = false; button.textContent = "检查更新"; } return;
    }
    if (button.dataset.useVersion && this.actions.useRepositoryVersion) {
      button.disabled = true;
      try { await this.actions.useRepositoryVersion(button.dataset.useVersion); this.tip("已引用新版本，原有讲义与笔记保留"); } catch (error) { button.disabled = false; this.tip(error instanceof Error ? error.message : String(error)); } return;
    }
    if (button.dataset.rewriteLesson) {
      const lesson = this.navigationDocument?.files.find(file => file.name === button.dataset.rewriteLesson && file.outdated);
      if (!lesson || button.disabled || !this.guideAvailable || !this.actions.sendGuide || this.guideSending || this.guideData.readOnly) return;
      this.closeNavigation(); this.pendingAnchor = undefined; this.guideTab = "chat"; this.setGuideVisible(true); this.renderGuide();
      const input = this.guide.querySelector<HTMLTextAreaElement>("textarea");
      if (input) input.value = [`请按新版本重写《${lesson.name}》，只处理这一讲。`, ...lessonVersionDetails(lesson.versions ?? [])].join("\n");
      await this.actions.guideVisibilityChanged?.(true);
      this.guide.querySelector<HTMLTextAreaElement>("textarea")?.focus();
      return;
    }
    if (button.dataset.file || button.dataset.guideLesson || button.dataset.guideMaterial || button.dataset.noteId || button.dataset.citationPath || button.dataset.command === "home") {
      try { await this.persistLocator(); } catch (error) { this.tip(error instanceof Error ? error.message : String(error)); return; }
    }
    if (button.dataset.cueStart !== undefined) { this.seekMedia(Number(button.dataset.cueStart)); return; }
    if (button.dataset.voice) { if (button.dataset.voice === "toolkit") { this.stopCuePlayback(); this.stopRecordedPlayback(); } void this.voice.toggle(button.dataset.voice); return; }
    if (button.hasAttribute("data-toolkit-play-cue")) { if (this.cuePlaying && !this.cueLoop) this.stopCuePlayback(); else void this.playCue(false); return; }
    if (button.hasAttribute("data-toolkit-loop-cue")) { if (this.cuePlaying && this.cueLoop) this.stopCuePlayback(); else void this.playCue(true); return; }
    if (button.hasAttribute("data-toolkit-play-recorded")) { void this.playRecording(); return; }
    if (button.dataset.interlineMode === "original" || button.dataset.interlineMode === "bilingual" || button.dataset.interlineMode === "subtitle-primary") {
      if (!this.currentSource || this.currentSource.kind !== "material" || !this.actions.setMaterialAids) return;
      const mode = button.dataset.interlineMode;
      button.disabled = true;
      try { const aids = mode === "original" ? this.materialAids.filter(id => id !== "interline") : [...new Set([...this.materialAids, "interline"])]; await this.actions.setMaterialAids(aids); this.materialAids = aids; this.interlineMode = mode; this.updateReadingAids(); }
      catch (error) { this.tip(error instanceof Error ? error.message : String(error)); this.updateReadingAids(); }
      return;
    }
    if (this.paged && (button.dataset.media === "close" || button.dataset.command === "read" || button.dataset.command === "speech-close")) this.readerPosition = captureReaderPosition(this.reader, this.article);
    if (button.dataset.media) { const speech = this.speaking, cuePlayer = this.cuePlayer, recordedPlayer = this.recordedPlayer, generation = this.generation, audio = speech ? this.speechAudio : cuePlayer ?? recordedPlayer ?? this.assetAudio; if (button.dataset.media === "close") { if (speech || this.speechResult) this.stopSpeech(); else { this.stopCuePlayback(); this.stopRecordedPlayback(); this.clearAudioAsset(); this.mediaDeck.hidden = true; } return; } if (!audio) return; if (!cuePlayer) this.stopCuePlayback(); if (!recordedPlayer) this.stopRecordedPlayback(); if (button.dataset.media === "play") { try { if (audio.paused) { button.disabled = true; await audio.play(); button.disabled = false; } else audio.pause(); } catch (error) { button.disabled = false; if (speech && generation === this.generation) this.finishSpeech(error); else if (!(error instanceof DOMException && error.name === "AbortError")) this.tip(error instanceof Error ? error.message : String(error)); } } else if (button.dataset.media === "back" || button.dataset.media === "forward") { const next = audio.currentTime + (button.dataset.media === "back" ? -15 : 15); if (speech || cuePlayer || recordedPlayer) audio.currentTime = Math.max(0, Math.min(Number.isFinite(audio.duration) ? audio.duration : next, next)); else this.seekMedia(next); } else if (button.dataset.media === "rate") { const rates = [.75, 1, 1.25, 1.5, 2]; this.speechRate = rates[(rates.indexOf(this.speechRate) + 1) % rates.length]!; audio.playbackRate = this.speechRate; button.textContent = `${this.speechRate.toFixed(2).replace(/0$/, "")}x`; } this.updateAssetControls(); return; }
    if (button.dataset.command === "typography") { const menu = this.root.querySelector<HTMLElement>(".pith-typography-popover")!; menu.hidden = !menu.hidden; button.setAttribute("aria-expanded", String(!menu.hidden)); return; }
    if (button.dataset.size) { const position = this.paged ? captureReaderPosition(this.reader, this.article) : null; this.article.style.setProperty("--pith-reader-size", `${button.dataset.size}px`); if (this.paged) { this.applyPageMode(position); this.readerPosition = captureReaderPosition(this.reader, this.article); } for (const item of this.root.querySelectorAll<HTMLButtonElement>("[data-size]")) item.setAttribute("aria-pressed", String(item === button)); return; }
    if (button.dataset.mode === "single" || button.dataset.mode === "double" || button.dataset.mode === "triple") { const position = captureReaderPosition(this.reader, this.article); this.pageMode = button.dataset.mode; this.applyPageMode(position); this.readerPosition = captureReaderPosition(this.reader, this.article); for (const item of this.root.querySelectorAll<HTMLButtonElement>("[data-mode]")) item.setAttribute("aria-pressed", String(item === button)); return; }
    if (button.dataset.page) { this.turnPage(button.dataset.page === "previous" ? -1 : 1); return; }
    if (button.dataset.toolkitChoose || button.dataset.toolkitRemove) {
      const id = button.dataset.toolkitChoose || button.dataset.toolkitRemove!;
      const remove = Boolean(button.dataset.toolkitRemove), mounted = this.mountedToolkits.includes(id);
      if (!this.toolkits.some(item => item.id === id) || (remove && !mounted)) return;
      if (remove || !mounted) {
        if (!this.actions.toggleToolkit) return;
        const buttons = Array.from(this.toolkit.querySelectorAll<HTMLButtonElement>("button"));
        buttons.forEach(item => { item.disabled = true; });
        try { await this.actions.toggleToolkit(id, !remove); }
        catch (error) { if (!this.disposed && button.isConnected && !this.toolkit.hidden) { buttons.forEach(item => { item.disabled = false; }); this.tip(error instanceof Error ? error.message : String(error)); } return; }
        if (this.disposed || !button.isConnected || this.toolkit.hidden) return;
        if (remove) { this.openToolkit(this.toolkits); return; }
        if (!this.mountedToolkits.includes(id)) return;
      }
      this.closeInlineToolkit(); this.toolkitResult = null; this.toolkitStatus = ""; this.toolkitId = id; this.renderToolkit(); return;
    }
    if (button.hasAttribute("data-toolkit-close")) { this.closeInlineToolkit(); return; }
    if (button.hasAttribute("data-toolkit-reveal")) { this.readToolkit(); this.toolkitReveal = !this.toolkitReveal; this.renderToolkit(); return; }
    if (button.hasAttribute("data-toolkit-repeat")) {
      if (!this.recall?.repeat()) return;
      this.toolkitReveal = false; this.toolkitProduced = ""; this.toolkitStatus = "";
      this.toolkitDrafts.delete(this.toolkitDraftKey());
      this.renderToolkit();
      this.inlineToolkit?.querySelector<HTMLTextAreaElement>("[data-toolkit-produced]")?.focus();
      return;
    }
    if (button.dataset.citationPath) { try { await this.openCitation(button); } catch (error) { this.tip(error instanceof Error ? error.message : String(error)); } return; }
    if (button.dataset.noteId) { const owner = button.dataset.noteOwner ?? "primary", note = noteEntries(this.guideData.notes, this.materialNotes).find(item => item.owner === owner && item.note.id === button.dataset.noteId)?.note; if (!note || !note.anchor) return; try { const anchor = note.anchor; if (anchor.file !== this.currentFile || !sameSource(anchor.source, this.currentSource)) await this.actions.openFile(anchor.file, anchor.source); const mark = Array.from(this.article.querySelectorAll<HTMLElement>("mark[data-pith-note]")).find(item => item.dataset.noteOwner === owner && item.dataset.pithNote === note.id); const target = mark || Array.from(this.article.querySelectorAll<HTMLElement>("[data-locator]")).find(item => item.dataset.locator === anchor.locator); if (target) { if (this.paged) { navigateReaderTarget(this.reader, target, true); this.readerPosition = captureReaderPosition(this.reader, this.article); this.updatePageCount(); } else target.scrollIntoView({ block: "center" }); } else this.tip("无法定位原文"); } catch (error) { this.tip(error instanceof Error ? error.message : String(error)); } return; }
    if (button.dataset.guideLesson) { try { await this.actions.openFile(button.dataset.guideLesson, { kind: "lesson" }); } catch (error) { this.tip(error instanceof Error ? error.message : String(error)); } return; }
    if (button.dataset.guideMaterial && this.actions.openMaterial) { try { await this.actions.openMaterial(button.dataset.guideMaterial); } catch (error) { this.tip(error instanceof Error ? error.message : String(error)); } return; }
    if (button.dataset.guideUndo && this.actions.undoObservation) { try { button.disabled = true; await this.actions.undoObservation(button.dataset.guideUndo); await this.refreshGuide(); } catch (error) { button.disabled = false; this.tip(error instanceof Error ? error.message : String(error)); } return; }
    if (button.dataset.guideCopy) { const turn = this.guideData.conversation.find(item => item.id === button.dataset.guideCopy), step = turn?.steps[Number(button.dataset.guideCopyIndex)]; if (step?.kind === "reply") { try { await this.win.navigator.clipboard.writeText(step.markdown); } catch (error) { this.tip(error instanceof Error ? error.message : String(error)); } } return; }
    if (button.hasAttribute("data-guide-bottom")) { const content = this.guide.querySelector<HTMLElement>(".pith-guide-content"); if (content) content.scrollTop = content.scrollHeight; button.hidden = true; return; }
    if (button.dataset.guideTab === "chat" || button.dataset.guideTab === "notes") { this.guideTab = button.dataset.guideTab; this.renderGuide(); return; }
    if (button.dataset.guidePrompt) { const input = this.guide.querySelector<HTMLTextAreaElement>("textarea"); if (input && this.guideAvailable && !this.guideSending && !this.guideData.readOnly) { input.value = button.dataset.guidePrompt; if (button.hasAttribute("data-guide-choice")) this.guide.querySelector<HTMLButtonElement>("[data-guide-send]")?.click(); else input.focus(); } return; }
    if (button.hasAttribute("data-guide-stop")) { if (this.actions.stopGuide) await this.actions.stopGuide(); return; }
    if (button.dataset.guideRetry) { if (this.guideAvailable && this.actions.retryGuide && !this.guideSending && !this.guideData.readOnly) await this.guideTurn("", () => this.actions.retryGuide!(button.dataset.guideRetry!)); return; }
    if (button.hasAttribute("data-guide-send")) {
      const input = this.guide.querySelector<HTMLTextAreaElement>("textarea"), sendGuide = this.actions.sendGuide;
      if (!input || !input.value.trim() || !sendGuide || this.guideSending || this.guideData.readOnly) return;
      const message = input.value, anchor = this.pendingAnchor, asNote = this.guideTab === "notes";
      if (!asNote && !this.guideAvailable) return;
      input.value = ""; this.pendingAnchor = undefined;
      try {
        // A note is captured without a guide turn; a chat message is one guide turn.
        if (asNote) { this.guideError = ""; this.guideSending = true; button.disabled = true; try { await sendGuide(message.trim(), anchor, true); } finally { this.guideSending = false; button.disabled = false; } await this.refreshGuide(); }
        else await this.guideTurn(message.trim(), () => sendGuide(message.trim(), anchor, false));
      } catch (error) {
        if (asNote) this.guideError = error instanceof Error ? error.message : String(error);
        const current = this.guide.querySelector<HTMLTextAreaElement>("textarea");
        if (current && !current.value) { current.value = message; this.pendingAnchor = anchor; }
      } finally { if (!this.disposed) this.renderGuide(); }
      return;
    }
    if (button.dataset.toolkitStage || button.hasAttribute("data-toolkit-save") || button.hasAttribute("data-toolkit-submit")) {
      try {
        this.readToolkit(); const toolkit = this.toolkits.find(item => item.id === this.toolkitId); if (!toolkit) throw new Error("工坊不可用");
        if (button.dataset.toolkitStage) { this.stopCuePlayback(); this.toolkitStage = button.dataset.toolkitStage as ToolkitStage; this.toolkitVersion++; this.toolkitResult = null; this.toolkitStatus = ""; this.renderToolkit(); return; }
        if (!this.toolkitTarget.trim() || !this.toolkitAnchor) throw new Error("当前页面没有可用原文");
        if (!this.toolkitProduced.trim()) throw new Error("请输入复述文本");
        const version = ++this.toolkitVersion; button.disabled = true;
        if (button.hasAttribute("data-toolkit-save") && this.toolkitResult && this.actions.savePractice) {
          await this.actions.savePractice(this.toolkitResult.summaryMarkdown, this.toolkitAnchor);
          if (this.disposed || version !== this.toolkitVersion) return;
          this.toolkitStatus = "已记入实训账本"; this.toolkitResult = null; await this.refreshGuide();
        } else if (this.recall) {
          const recall = this.recall;
          const key = this.toolkitDraftKey(), retry = button.hasAttribute("data-toolkit-retry");
          if (this.recallSubmissions.has(key) || !recall.canSubmit(this.toolkitProduced, retry)) { this.renderToolkit(); return; }
          this.toolkitStatus = "";
          this.recallSubmissions.set(key, this.toolkitDrafts.get(key));
          try { await recall.submit(this.toolkitProduced, retry); }
          finally {
            this.recallSubmissions.delete(key);
            if (!this.disposed && this.toolkitDraftKey() === key) this.updateRecallSubmit();
          }
          if (this.disposed || this.recall !== recall) return;
          if (recall.result) this.toolkitReveal = true;
        }
        if (!this.disposed && version === this.toolkitVersion) this.renderToolkit();
      } catch (error) { this.tip(error instanceof Error ? error.message : String(error)); if (button.isConnected) button.disabled = false; }
      return;
    }
    if (button.dataset.command === "speech-close") this.stopSpeech();
    else if (button.dataset.command === "speech-follow") { const active = this.article.querySelector<HTMLElement>(".pith-speech-active"); if (active) active.scrollIntoView({ block: "center", inline: "center" }); }
    else if (button.dataset.command === "home") { this.voice.cancel(); if (this.actions.home) { try { await this.actions.home(); } catch (error) { this.tip(error instanceof Error ? error.message : String(error)); } } }
    else if (button.dataset.command === "intake") { this.setGuideVisible(true); this.actions.startIntake?.(); }
    else if (button.dataset.command === "settings" && this.actions.openSettings) this.actions.openSettings();
    else if (button.dataset.command === "import" && this.actions.importMaterial) this.actions.importMaterial();
    else if (button === this.navigationButton) { this.navigation.hidden = !this.navigation.hidden; button.setAttribute("aria-expanded", String(!this.navigation.hidden)); if (!this.navigation.hidden) updateTocLocation(this.navigation, this.article, this.reader, this.paged); }
    else if (button === this.guideButton) { const visible = this.guide.hidden; this.setGuideVisible(visible); if (this.actions.guideVisibilityChanged) this.actions.guideVisibilityChanged(visible); }
    else if (button.dataset.plannedLesson) { this.closeNavigation(); if (!this.guideAvailable || !this.actions.generateLesson) { this.tip(GUIDE_UNAVAILABLE_REASON); return; } if (this.guideSending) { this.tip("向导正在回应上一条消息"); return; } try { await this.actions.generateLesson(button.dataset.plannedLesson, button.dataset.plannedTitle || button.dataset.plannedLesson); } catch (error) { this.tip(error instanceof Error ? error.message : String(error)); } }
    else if (button.dataset.file) { this.closeNavigation(); try { await this.actions.openFile(button.dataset.file, button.dataset.materialId ? { kind: "material", materialId: button.dataset.materialId } : button.hasAttribute("data-lesson") ? { kind: "lesson" } : undefined); } catch (error) { this.tip(error instanceof Error ? error.message : String(error)); } }
    else if (button.dataset.locator) { this.closeNavigation(); const heading = Array.from(this.article.querySelectorAll<HTMLElement>("[data-locator]")).find(node => node.dataset.locator === button.dataset.locator); if (heading) heading.scrollIntoView({ block: "start" }); }
    else if (button.dataset.command === "toolkit") { if (this.toolkitMenuOpen()) { this.toolkit.hidden = true; return; } const selected = this.readerSelection(); if (this.toolkit.hidden && selected) { this.requestedToolkitBlock = selected.block; this.actions.openToolkit(selected.quote, selected.locator); } else this.actions.openToolkit(); }
    else if (button.dataset.command === "read") { this.stopCuePlayback(); this.stopRecordedPlayback(); if (this.speaking) this.stopSpeech(); else if (this.assetSource && !this.assetAudio) await this.loadAsset(); else if (this.assetAudio && this.mediaDeck.hidden) this.mediaDeck.hidden = false; else this.startSpeech(); }
    else if (button.dataset.selection && this.selectionRange) { const selected = this.readerSelection(); if (!selected) { this.popover.hidden = true; return; } if (button.dataset.selection === "copy") { try { await this.win.navigator.clipboard.writeText(selected.quote); } catch { this.tip("复制失败"); } } else if (button.dataset.selection === "highlight" || button.dataset.selection === "note" || button.dataset.selection === "ask") { const startPage = this.selectionRange.startContainer.parentElement?.closest<HTMLElement>(".pith-pdf-text[data-locator]"), endPage = this.selectionRange.endContainer.parentElement?.closest<HTMLElement>(".pith-pdf-text[data-locator]"); if ((startPage || endPage) && startPage !== endPage) { this.tip("请选择同一页的文字"); this.popover.hidden = true; return; } this.actions.selection(button.dataset.selection, selected.quote, startPage?.dataset.locator || selected.locator); } this.popover.hidden = true; }
  }
  private readerSelection(): { quote: string; locator: string; block: HTMLElement | null } | null {
    const saved = this.selectionRange;
    if (!saved || saved.collapsed || !this.article.contains(saved.startContainer) || !this.article.contains(saved.endContainer)) return null;
    const element = (node: Node): Element | null => node.nodeType === 1 ? node as Element : node.parentElement;
    const start = element(saved.startContainer), end = element(saved.endContainer);
    if ([start, end].some(node => node?.closest('.pith-inline-toolkit,.pith-interline-subtitle,input,textarea,button,select,[contenteditable="true"]'))) return null;
    const range = saved.cloneRange();
    const fromDisplay = start?.closest("[data-toolkit-display]"), toDisplay = end?.closest("[data-toolkit-display]");
    // A transformed display has no character mapping; selecting it selects its original block.
    if (fromDisplay || toDisplay) {
      if (!this.toolkitSource || (fromDisplay && fromDisplay !== this.toolkitDisplay) || (toDisplay && toDisplay !== this.toolkitDisplay)) return null;
      if (fromDisplay) range.setStart(this.toolkitSource, 0);
      if (toDisplay) range.setEnd(this.toolkitSource, this.toolkitSource.childNodes.length);
    }
    let offset = 0, firstOffset = 0; const parts: string[] = [];
    const walker = this.doc.createTreeWalker(this.article, 4); let next: Node | null;
    while ((next = walker.nextNode())) {
      const node = next as Text, parent = node.parentElement, owner = parent?.closest<HTMLElement>('[data-prose],[data-trainable]');
      if (parent?.closest('.pith-inline-toolkit,.pith-interline-subtitle,[data-toolkit-display]') || (owner?.dataset.prose === "false" && owner.dataset.trainable !== "true")) continue;
      if (range.intersectsNode(node)) {
        const a = range.startContainer === node ? range.startOffset : 0, b = range.endContainer === node ? range.endOffset : node.length;
        if (b > a) { if (!parts.length) firstOffset = offset + a; parts.push(node.data.slice(a, b)); }
      }
      offset += node.length;
    }
    const text = parts.join(""), quote = text.trim(); if (!quote) return null;
    const block = element(range.startContainer)?.closest<HTMLElement>('[data-prose="true"],[data-trainable="true"],.pith-cue') ?? null;
    const fullBlock = (fromDisplay || toDisplay) && block && proseTextNodes(block).map(node => node.data).join("").trim() === quote;
    return { quote, block, locator: fullBlock && block.dataset.locator ? block.dataset.locator : `text:offset:${firstOffset + text.length - text.trimStart().length}` };
  }
  private showSelection(): void {
    const selection = this.win.getSelection(); if (!selection || selection.isCollapsed || !selection.toString().trim() || !selection.anchorNode || !selection.focusNode || !this.article.contains(selection.anchorNode) || !this.article.contains(selection.focusNode)) { this.selectionRange = null; this.popover.hidden = true; return; }
    this.selectionRange = selection.getRangeAt(0).cloneRange(); if (!this.readerSelection()) { this.selectionRange = null; this.popover.hidden = true; return; } const rect = this.selectionRange.getBoundingClientRect(); this.popover.hidden = false; for (const item of this.popover.querySelectorAll<HTMLButtonElement>("button")) item.hidden = this.actions.scene === "material" && item.dataset.selection === "ask"; this.popover.style.left = `${Math.max(8, Math.min(this.win.innerWidth - this.popover.offsetWidth - 8, rect.left))}px`; this.popover.style.top = `${Math.max(8, rect.top - this.popover.offsetHeight - 8)}px`;
  }
  private clearSpeechMark(): void { for (const mark of this.article.querySelectorAll('[data-speech-active="true"]')) { const parent = mark.parentNode; mark.replaceWith(...mark.childNodes); if (parent) parent.normalize(); } }
  private stopSpeech(): void { this.generation++; if (this.speechAbort) this.speechAbort.abort(); this.speechAbort = null; if (this.speechAudio) { this.speechAudio.pause(); this.speechAudio.removeAttribute("src"); this.speechAudio.load(); this.speechAudio = null; } if (this.speechUrl) URL.revokeObjectURL(this.speechUrl); this.speechUrl = null; this.speaking = false; this.speechResult = false; this.clearSpeechMark(); this.dock.classList.toggle("active", this.toolkitActive); for (const item of this.mediaDeck.querySelectorAll("[data-speech-control]")) item.remove(); this.assetControls.hidden = !this.assetAudio; this.mediaDeck.hidden = !this.assetAudio; const play = this.assetControls.querySelector<HTMLButtonElement>('[data-media="play"]'); if (play) play.disabled = false; this.playback.renderCueMarkers(); this.updateAssetControls(); const button = this.dock.querySelector("[data-command=read]"); if (button) button.innerHTML = pithIcon("headphones"); }
  private finishSpeech(error?: unknown): void {
    this.stopSpeech(); this.speechResult = true; this.mediaDeck.hidden = false;
    const controls = this.mediaDeck.querySelector<HTMLElement>(".pith-speech-controls"); if (!controls) return;
    const status = this.doc.createElement("span"); status.dataset.speechControl = ""; status.setAttribute("role", error === undefined ? "status" : "alert"); status.textContent = error === undefined ? "本章听读完成" : `听读失败：${error instanceof Error ? error.message : String(error)}`; controls.append(status);
    if (error !== undefined && this.actions.openSettings) { const settings = this.doc.createElement("button"); settings.dataset.speechControl = ""; settings.textContent = "配置语音"; settings.onclick = () => { this.stopSpeech(); this.actions.openSettings!(); }; controls.append(settings); }
    const close = this.doc.createElement("button"); close.dataset.speechControl = ""; close.dataset.command = "speech-close"; close.setAttribute("aria-label", "关闭听读"); close.innerHTML = pithIcon("close"); controls.append(close);
  }
  private startSpeech(): void {
    const synthesize = this.actions.synthesizeSpeech;
    const chapter = this.paged ? speechPageChapter(this.article, this.reader) : speechChapterRoot(this.article, this.reader, null, false); if (!chapter) { this.tip("当前页面没有可朗读的正文段落"); return; }
    this.stopSpeech(); const queue: { block: Element; start: number; end: number; text: string }[] = []; const segmenter = new Intl.Segmenter(undefined, { granularity: "sentence" });
    for (const block of chapter.querySelectorAll("[data-prose=true]")) for (const part of segmenter.segment(proseTextNodes(block).map(node => node.data).join(""))) { const text = part.segment.trim(); if (/[\p{L}\p{N}]/u.test(text)) { const start = part.index + part.segment.length - part.segment.trimStart().length; queue.push({ block, start, end: start + text.length, text }); } }
    let index = 0; if (!queue.length) { this.tip("当前页面没有可朗读的正文段落"); return; }
    if (!synthesize) { this.finishSpeech(new Error("未连接可用的语音服务，请先启动本地语音服务或在设置中配置云端 TTS")); return; }
    if (this.assetAudio) this.assetAudio.pause(); for (const cue of this.article.querySelectorAll(".pith-cue.pith-speech-active")) cue.classList.remove("pith-speech-active"); this.assetControls.hidden = false; this.mediaDeck.hidden = false; this.speaking = true; const generation = ++this.generation; this.dock.classList.add("active"); this.playback.renderCueMarkers(); const play = this.assetControls.querySelector<HTMLButtonElement>('[data-media="play"]'); if (play) play.disabled = true;
    this.speechAbort = new AbortController(); const signal = this.speechAbort.signal;
    const run = async (): Promise<void> => {
      let pending = synthesize(queue[index]!.text, signal);
      while (index < queue.length) {
        const audio = await pending; if (signal.aborted) return;
        if (!audio.bytes.byteLength) throw new Error("语音引擎返回空音频");
        const item = queue[index++]!;
        if (index < queue.length) { pending = synthesize(queue[index]!.text, signal); void pending.catch(() => {}); }
        this.clearSpeechMark(); const nodes: { node: Text; start: number }[] = []; let offset = 0;
        for (const text of proseTextNodes(item.block)) { nodes.push({ node: text, start: offset }); offset += text.length; }
        for (const part of nodes) { const a = Math.max(0, item.start - part.start), b = Math.min(part.node.length, item.end - part.start); if (a >= b) continue; const range = this.doc.createRange(); range.setStart(part.node, a); range.setEnd(part.node, b); const mark = this.doc.createElement("span"); mark.className = "pith-speech-active"; mark.dataset.speechActive = "true"; range.surroundContents(mark); }
        const active = item.block.querySelector(".pith-speech-active"); if (active) { const reader = this.reader.getBoundingClientRect(), rect = active.getBoundingClientRect(); if (this.paged) { if (rect.left < reader.left || rect.right > reader.right) this.reader.scrollLeft += Math.floor((rect.left - reader.left) / this.reader.clientWidth) * this.reader.clientWidth; } else if (rect.top < reader.top || rect.bottom > reader.bottom) this.reader.scrollTop += rect.top - reader.top - 32; }
        this.speechUrl = URL.createObjectURL(new Blob([new Uint8Array(audio.bytes)], { type: audio.mimeType }));
        const player = this.doc.createElement("audio"); this.speechAudio = player; player.src = this.speechUrl; player.playbackRate = this.speechRate; player.ontimeupdate = player.onloadedmetadata = player.onplay = player.onpause = () => this.updateAssetControls(); if (play) play.disabled = true;
        await new Promise<void>((resolve, reject) => { player.onended = () => resolve(); player.onerror = () => reject(new Error("音频播放失败")); signal.addEventListener("abort", () => resolve(), { once: true }); void player.play().then(() => { if (generation === this.generation && this.speechAudio === player && play) { play.disabled = false; this.updateAssetControls(); } }, reject); });
        if (signal.aborted || generation !== this.generation) return;
        if (this.speechUrl) URL.revokeObjectURL(this.speechUrl); this.speechUrl = null; this.speechAudio = null;
      }
      if (generation === this.generation) this.finishSpeech();
    };
    void run().catch(error => { if (generation === this.generation) this.finishSpeech(error); });
  }
}

export { PithWorkbenchView as PithObsidianView, workbenchStyles as obsidianStyles };

export function mountPithWorkbench(root: HTMLElement, actions: ObsidianViewActions): PithWorkbenchView {
  const view = new PithWorkbenchView(root, actions);
  const layout = root.querySelector<HTMLElement>(".pith-layout");
  if (!layout) { view.dispose(); throw new Error("工作台布局不可用"); }
  layout.append(view.guideElement());
  return view;
}
import { lessonVersionDetails } from "./lessonVersions.ts";
