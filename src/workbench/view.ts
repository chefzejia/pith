import type { DojoDiagnosisResult, DojoScaffoldStage, DojoToolkitDescriptor, GuideConversationEntry, GuideQuickAction, InterlineDisplayMode, ReaderSectionHeading, SelectionAnchor, TopicNote } from "../core/index.ts";
import { applyPaginationStyles, captureReaderPosition, navigateReaderTarget, proseTextNodes, readerPageIndex, resolveEpubTarget, resolveReaderLocator, resolveResponsiveLayout, restoreReaderPosition, updateTocLocation, visibleDojoTarget, type CurriculumItem, type ReaderPosition } from "../plugins/stage-reader/pagination.ts";
import { pithIcon } from "./icons.ts";
import { matchTextAnchor } from "../plugins/stage-reader/textAnchor.ts";
import { createWorkbenchChrome } from "./view/toolbar.ts";
import { workbenchStyles } from "./view/styles.ts";
export { workbenchStyles } from "./view/styles.ts";
import { audioContentType, videoContentType, resolveMediaPair } from "./mediaAssets.ts";
import { effectiveToolkits, toolkitSlot } from "./toolkitSlot.ts";
import { InterlineView, preserveInterlinePosition, type InterlineViewPrepare } from "../plugins/dojo-interline/index.ts";
import { VoiceInput } from "./voiceInput.ts";
import { renderNavigation } from "./view/navigation.ts";
import { renderGuide } from "./view/guide.ts";
import { renderInlineToolkit, renderToolkitMenu } from "./view/toolkit.ts";
import { PlaybackDeck } from "./view/playback.ts";

export interface ObsidianAgentConfig {
  readonly agentId: "" | "dsh" | "claude" | "codex";
  readonly model: string;
  readonly effort: string;
  readonly persona: "sanctuary" | "studio";
}



export interface ObsidianReaderDocument {
  readonly title: string;
  readonly html: string;
  readonly files: readonly { name: string; mimeType?: string }[];
  readonly currentFile: string;
  readonly mediaFile?: string | null;
  readonly format?: "markdown" | "epub" | "pdf" | "cbz" | "image";
  readonly sections: readonly ReaderSectionHeading[];
  readonly curriculum?: readonly CurriculumItem[];
}

export interface ObsidianViewActions {
  autoInterline?: boolean;
  openFile(name: string): void | Promise<void>;
  generateLesson?(fileName: string, title: string): Promise<void>;
  home?(): void | Promise<void>;
  openDojo(text?: string, locator?: string): void;
  selection(action: "highlight" | "note" | "ask", text: string, locator?: string): void;
  synthesizeSpeech?(text: string, signal: AbortSignal): Promise<{ readonly bytes: Uint8Array; readonly mimeType: string }>;
  transcribeAudio?(bytes: Uint8Array, mimeType: string, signal?: AbortSignal): Promise<{ readonly text: string }>;
  loadAudio?(name: string): Promise<Uint8Array>;
  prepareInterline?: InterlineViewPrepare;
  guideData?(): Promise<{ notes: readonly TopicNote[]; conversation: readonly GuideConversationEntry[]; actions: readonly GuideQuickAction[]; toolkits: readonly string[] }>;
  sendGuide?(text: string, anchor: SelectionAnchor | undefined, saveAsNote: boolean): Promise<void>;
  savePractice?(body: string, anchor: SelectionAnchor | undefined): Promise<void>;
  submitPractice?(body: string, anchor: SelectionAnchor, toolkit: DojoToolkitDescriptor): Promise<{ guided: boolean; guideError?: string }>;
  mountDojo?(id: string): Promise<void>;
  toggleToolkit?(id: string, enabled: boolean): Promise<void>;
  guideVisibilityChanged?(visible: boolean): void;
  openSettings?(): void;
  importMaterial?(): void;
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
  private readonly navigationButton: HTMLButtonElement;
  private readonly guideButton: HTMLButtonElement;
  private selectionRange: Range | null = null;
  private pendingDojoSelection: { anchor: Node; focus: Node; anchorOffset: number; focusOffset: number } | null = null;
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
  private dojoActive = false;
  private readonly dojo: HTMLElement;
  private inlineDojo: HTMLElement | null = null;
  private dojoBlock: HTMLElement | null = null;
  private dojoLenses: HTMLElement | null = null;
  private dojoSource: HTMLElement | null = null;
  private dojoDisplay: HTMLElement | null = null;
  private requestedDojoBlock: HTMLElement | null = null;
  private dojoReveal = false;
  private interline: InterlineView | null = null;
  private interlineMode: InterlineDisplayMode = "original";
  private currentFile = "";
  private pageMode: "single" | "double" | "triple" = "single";
  private readerPosition: ReaderPosition | null = null;
  private restoredScrollLeft: number | null = null;
  private paged = false;
  private readonly resizeObserver: ResizeObserver | null;
  private guideTab: "chat" | "notes" = "chat";
  private guideGeneration = 0;
  private pendingAnchor: SelectionAnchor | undefined;
  private guideData: { notes: readonly TopicNote[]; conversation: readonly GuideConversationEntry[]; actions: readonly GuideQuickAction[] } = { notes: [], conversation: [], actions: [] };
  private navigationDocument: Pick<ObsidianReaderDocument, "files" | "curriculum" | "sections" | "currentFile"> | null = null;
  private guideSending = false;
  private dojos: readonly DojoToolkitDescriptor[] = [];
  private mountedToolkits: readonly string[] = [];
  private configuredToolkits: readonly string[] = [];
  private dojoId = "";
  private dojoStage: DojoScaffoldStage = "listen-decompose";
  private dojoTarget = "";
  private dojoProduced = "";
  private readonly dojoDrafts = new Map<string, string>();
  private dojoAnchor: SelectionAnchor | undefined;
  private dojoResult: DojoDiagnosisResult | null = null;
  private dojoStatus = "";
  private dojoVersion = 0;
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
    this.root = root; this.actions = actions;
    this.doc = root.ownerDocument;
    const win = this.doc.defaultView;
    if (!win) throw new Error("View requires a window");
    this.win = win;
    this.voice = new VoiceInput(win as Window & typeof globalThis, (bytes, mime, signal) => {
      if (!this.actions.transcribeAudio) throw new Error("请先在设置中配置语音识别服务");
      return this.actions.transcribeAudio(bytes, mime, signal);
    }, (target, phase) => {
      const host = target === "guide" ? this.guide : this.inlineDojo;
      if (!host) return;
      const button = host.querySelector<HTMLButtonElement>("[data-voice]");
      if (button) { const shadowing = target === "dojo" && this.dojoId === "shadowing"; button.innerHTML = phase === "recording" ? (shadowing ? `<span class="pith-mic-wave" aria-hidden="true"><i></i><i></i><i></i></span> 停止跟读` : `${pithIcon("stop")} 停止录音`) : phase === "permission" ? "取消录音" : phase === "transcribing" ? "识别中…" : `${pithIcon("mic")} ${shadowing ? "开口跟读" : "语音输入"}`; button.disabled = phase === "transcribing"; button.setAttribute("aria-pressed", String(phase === "recording")); }
      if (target === "dojo" && phase === "recording" && this.dojoId === "shadowing" && this.dojoStage === "guided-follow" && this.nativeCueRange()) void this.playCue(false);
      if (target === "dojo" && (phase === "transcribing" || phase === "idle")) this.stopCuePlayback();
    }, (target, text) => {
      const input = target === "guide" ? this.guide.querySelector<HTMLTextAreaElement>("textarea") : this.inlineDojo?.querySelector<HTMLTextAreaElement>("[data-dojo-produced]");
      if (input) { input.value = input.value ? `${input.value} ${text}` : text; input.dispatchEvent(new (this.win as Window & typeof globalThis).Event("input", { bubbles: true })); input.focus(); if (target === "dojo") this.dojoProduced = input.value; }
      if (target === "dojo" && this.dojoId === "shadowing" && text.trim()) { this.dojoProduced = text.trim(); const toolkit = this.dojos.find(item => item.id === "shadowing"); if (toolkit) { this.dojoResult = toolkit.diagnose(this.dojoTarget, this.dojoProduced); this.renderDojo(); } }
    }, message => this.tip(message), url => { this.stopRecordedPlayback(); this.recordedUrl = url; const button = this.inlineDojo?.querySelector<HTMLButtonElement>("[data-dojo-play-recorded]"), save = this.inlineDojo?.querySelector<HTMLButtonElement>("[data-dojo-save]"); if (button) { button.disabled = !url; button.hidden = !url; } if (save) save.hidden = !url; if (url) this.dojoDisplay?.querySelector(".pith-blind-mask")?.classList.add("pith-blind-revealed"); });
    const required = createWorkbenchChrome(root, actions);
    this.reader = required(".pith-reader"); this.article = required(".pith-article"); this.navigation = required(".pith-left-drawer"); this.guide = this.doc.createElement("aside"); this.guide.className = "pith-guide"; this.guide.hidden = true; this.layout = required(".pith-layout"); this.dock = required(".pith-bottom-dock"); this.toast = required(".pith-toast-tip"); this.popover = required(".pith-selection"); this.navigationButton = required(".pith-nav-toggle"); this.guideButton = required(".pith-guide-toggle");
    this.dock.append(required(".pith-typography-popover"));
    this.playback = new PlaybackDeck(this.doc, required(".pith-speech-controls"), this.article, () => ({ duration: this.assetAudio?.duration, otherPlayback: Boolean(this.speaking || this.cuePlayer || this.recordedPlayer) })); this.mediaDeck = this.playback.deck; this.assetControls = this.playback.controls; required(".pith-stage").append(this.mediaDeck);
    this.dojo = this.doc.createElement("section"); this.dojo.className = "pith-dojo-panel"; this.dojo.hidden = true; this.dock.append(this.dojo);
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
      this.pendingDojoSelection = null;
      if (!(target instanceof (this.win as Window & typeof globalThis).Element) || !target.closest('[data-dojo-close],[data-command="dojo"],[data-dojo-choose]') || !this.dojoSource) return;
      const selection = this.win.getSelection(), anchor = selection?.anchorNode, focus = selection?.focusNode;
      if (selection && anchor && focus && !selection.isCollapsed && this.dojoSource.contains(anchor) && this.dojoSource.contains(focus)) this.pendingDojoSelection = { anchor, focus, anchorOffset: selection.anchorOffset, focusOffset: selection.focusOffset };
    }, options);
    root.addEventListener("click", event => { const target = event.target; if (target instanceof (this.win as Window & typeof globalThis).Node && this.guide.contains(target)) return; void this.click(event); }, options);
    this.guide.addEventListener("click", event => { void this.click(event); }, options);
    this.doc.addEventListener("click", event => { const target = event.target as Node | null; const menu = required<HTMLElement>(".pith-typography-popover"); const toggle = required<HTMLButtonElement>('[data-command="typography"]'); if (target && !menu.contains(target) && !toggle.contains(target)) { menu.hidden = true; toggle.setAttribute("aria-expanded", "false"); } if (target && !this.navigation.contains(target) && !this.navigationButton.contains(target)) this.closeNavigation(); }, options);
    this.doc.addEventListener("keydown", event => { if (event.key === "Escape") { required<HTMLElement>(".pith-typography-popover").hidden = true; required<HTMLButtonElement>('[data-command="typography"]').setAttribute("aria-expanded", "false"); this.closeNavigation(); } }, options);
    this.reader.addEventListener("wheel", event => { if (!this.paged || event.ctrlKey || Math.abs(event.deltaY) < 2) return; event.preventDefault(); const direction = this.wheelGate.accept(event.deltaY, this.win.performance.now()); if (direction) this.turnPage(direction); }, { ...options, passive: false });
    this.reader.addEventListener("scroll", () => { this.updatePageCount(); const restored = this.restoredScrollLeft === this.reader.scrollLeft; this.restoredScrollLeft = null; if (this.paged && !restored) this.readerPosition = captureReaderPosition(this.reader, this.article); if (this.interline) this.interline.activate(); }, options);
    root.addEventListener("keydown", event => { const target = event.target as Element | null; const link = target && target.closest<HTMLElement>("a[data-epub-target]"); if (link && this.article.contains(link) && event.key === "Enter") { event.preventDefault(); this.openEpubLink(link); } }, options);
    this.doc.addEventListener("keydown", event => { const target = event.target as Element | null; if (!this.root.isConnected || !this.paged || !target || typeof target.closest !== "function" || target.closest("input,textarea,select,button,[contenteditable]:not([contenteditable=false]),.pith-guide,.pith-left-drawer") || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.defaultPrevented) return; if (!this.root.contains(target) && (target !== this.doc.body || activeReader.get(this.doc) !== this)) return; const amount = pageDirectionForKey(event.key); if (amount) { event.preventDefault(); this.turnPage(amount); } }, options);
    this.article.addEventListener("mouseup", event => { const target = event.target; if (target instanceof (this.win as Window & typeof globalThis).Element && target.closest(".pith-inline-dojo")) return; this.showSelection(); }, options);
    this.assetControls.addEventListener("input", event => { const input = event.target as HTMLInputElement; if (input.classList.contains("pith-media-seek")) { const player = this.speaking ? this.speechAudio : this.cuePlayer ?? this.recordedPlayer; if (player) { player.currentTime = Number(input.value); this.updateAssetControls(); } else this.seekMedia(Number(input.value)); } }, options);
  }

  render(document: ObsidianReaderDocument): void {
    this.closeInlineDojo();
    this.dojoVersion++; this.dojoTarget = ""; this.dojoAnchor = undefined; this.requestedDojoBlock = null; this.dojoResult = null; this.dojoStatus = ""; this.dojo.hidden = true; this.setDojoActive(false);
    this.voice.cancel();
    if (this.interline) this.interline.dispose(); this.interline = null; this.interlineMode = "original";
    this.readerPosition = null;
    this.currentFile = document.currentFile;
    this.setToolkits(this.configuredToolkits);
    this.paged = document.format ? ["epub", "pdf", "cbz"].includes(document.format) : /\.(epub|pdf|cbz)$/i.test(document.currentFile);
    this.stopSpeech(); this.selectionRange = null; this.popover.hidden = true;
    this.clearAudioAsset(); this.assetSource = null;
    const title = this.root.querySelector(".pith-title"); if (title) title.textContent = document.title;
    this.article.innerHTML = document.html;
    this.adaptEpubColors();
    if (this.actions.prepareInterline) this.interline = new InterlineView(this.reader, this.article, this.actions.prepareInterline, change => { if (this.speaking) this.stopSpeech(); preserveInterlinePosition(this.reader, this.article, this.paged, () => { change(); this.markExisting(); }, position => this.applyPageMode(position), captureReaderPosition, proseTextNodes); }, message => this.tip(message), proseTextNodes);
    this.navigationDocument = document;
    this.renderNavigation(document);
    this.closeNavigation();
    this.markExisting(); this.applyPageMode();
    if (this.actions.autoInterline && this.interline && this.mountedToolkits.includes("interline")) { this.interlineMode = "bilingual"; this.interline.setMode("bilingual"); }
    const active = this.doc.activeElement;
    if (this.root.isConnected && active && (active === this.doc.body || this.root.contains(active)) && !active.closest("input,textarea,select,button,[contenteditable]:not([contenteditable=false]),.pith-guide,.pith-left-drawer")) this.reader.focus({ preventScroll: true });
    const typeOf = (file: ObsidianReaderDocument["files"][number]) => videoContentType({ name: file.name, mimeType: file.mimeType ?? "" }) ?? audioContentType({ name: file.name, mimeType: file.mimeType ?? "" });
    const asset = document.mediaFile === undefined ? resolveMediaPair(document.files, document.currentFile).media : document.files.find(file => file.name === document.mediaFile) ?? null;
    const video = this.article.querySelector<HTMLVideoElement>(".pith-timeline-video"); if (video) video.removeAttribute("src");
    if (asset && this.actions.loadAudio) { const type = typeOf(asset); if (type) { this.assetSource = { name: asset.name, type }; void this.loadAsset(); } }
  }

  updateMaterialNavigation(files: ObsidianReaderDocument["files"], curriculum: ObsidianReaderDocument["curriculum"]): void {
    if (!this.navigationDocument || this.disposed) return;
    this.navigationDocument = { ...this.navigationDocument, files, curriculum };
    this.renderNavigation(this.navigationDocument);
  }

  private renderNavigation(document: Pick<ObsidianReaderDocument, "files" | "curriculum" | "sections" | "currentFile">): void {
    const navigate = (locator: string) => { this.closeNavigation(); const target = resolveReaderLocator(this.article, locator); if (target) { if (this.speechResult) this.stopSpeech(); navigateReaderTarget(this.reader, target, this.paged); if (this.paged) { this.readerPosition = captureReaderPosition(this.reader, this.article); this.updatePageCount(); } } else this.tip("无法定位书内目标"); };
    renderNavigation(this.navigation, document, navigate);
  }

  guideElement(): HTMLElement { return this.guide; }
  showLessonLoading(title: string): void { this.closeInlineDojo(); this.voice.cancel(); this.stopSpeech(); this.clearAudioAsset(); this.closeNavigation(); const section = this.doc.createElement("section"), heading = this.doc.createElement("h1"), status = this.doc.createElement("p"); section.className = "pith-lesson-loading"; heading.textContent = title; status.textContent = "向导正在结合课程大纲与源码为你撰写本讲讲义…"; status.setAttribute("role", "status"); section.append(heading, status); this.article.replaceChildren(section); }
  focusQuotedGuide(): void { if (this.pendingAnchor) { const input = this.guide.querySelector<HTMLTextAreaElement>("textarea"); if (input) input.focus(); } }
  setGuideVisible(visible: boolean): void { if (!visible) this.voice.cancel("guide"); this.guide.hidden = !visible; this.guideButton.setAttribute("aria-pressed", String(visible)); if (this.guide.parentElement === this.layout) this.layout.classList.toggle("pith-guide-closed", !visible); }
  setGuideAvailable(available: boolean): void { this.guideButton.hidden = !available; if (!available) this.setGuideVisible(false); }
  setDojoActive(active: boolean): void { this.dojoActive = active; this.dock.classList.toggle("active", active || this.speaking); }
  setToolkits(toolkits: readonly string[]): void { this.configuredToolkits = toolkits; const previous = this.dojoId; const slot = toolkitSlot(effectiveToolkits(toolkits, this.currentFile), previous, Object.fromEntries(this.dojos.map(item => [item.id, item.label]))); if (!slot.ids.includes("interline") && this.interline && this.interlineMode !== "original") { this.interlineMode = "original"; this.interline.setMode("original"); } this.mountedToolkits = slot.ids; this.dojoId = slot.active; if (previous && !slot.ids.includes(previous)) { this.closeInlineDojo(); } const button = this.dock.querySelector<HTMLButtonElement>("#open-dojo"); if (!button) return; button.hidden = false; button.innerHTML = `${pithIcon("sliders")}<span class="pith-toolkit-label"></span>`; button.querySelector("span")!.textContent = slot.text; button.classList.toggle("pith-dojo-add", !slot.ids.length); button.title = slot.ids.length ? `打开实训工具：${slot.text}` : "打开实训工具"; button.setAttribute("aria-label", button.title); }
  turnPage(direction: number): void { if (!this.paged) return; if (this.speechResult) this.stopSpeech(); this.reader.scrollTo({ left: Math.max(0, readerPageIndex(this.reader) + direction) * this.reader.clientWidth, behavior: "instant" }); this.readerPosition = captureReaderPosition(this.reader, this.article); this.updatePageCount(); }
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
  dispose(): void { this.disposed = true; this.stopCuePlayback(); this.voice.dispose(); this.stopRecordedPlayback(); if (this.interline) this.interline.dispose(); this.stopSpeech(); this.clearAudioAsset(); this.events.abort(); if (this.resizeObserver) this.resizeObserver.disconnect(); if (this.themeObserver) this.themeObserver.disconnect(); if (activeReader.get(this.doc) === this) activeReader.delete(this.doc); if (this.toastTimer !== undefined) this.win.clearTimeout(this.toastTimer); this.guide.remove(); this.root.replaceChildren(); this.root.classList.remove("pith-view"); }

  private clearAudioAsset(): void { this.assetGeneration++; const media = this.assetAudio; this.assetAudio = null; if (media) { media.pause(); media.removeAttribute("src"); media.load(); } if (this.assetUrl) URL.revokeObjectURL(this.assetUrl); this.assetUrl = null; this.assetControls.hidden = true; this.mediaDeck.hidden = !this.speaking; this.playback.renderCueMarkers(); }
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
    if (cue) { if (this.inlineDojo && this.dojoId === "shadowing" && cue !== this.dojoBlock) { const playing = !media.paused, copy = cue.cloneNode(true) as HTMLElement; copy.querySelector("time")?.remove(); const text = (copy.textContent ?? "").trim(); this.closeInlineDojo(); this.dojoTarget = text; this.dojoAnchor = { file: this.currentFile, locator: cue.dataset.locator!, quote: text }; this.requestedDojoBlock = cue; this.dojoResult = null; this.dojoStatus = ""; this.renderDojo(); if (playing) void media.play().catch(error => this.tip(error instanceof Error ? error.message : String(error))); } cue.scrollIntoView({ block: "nearest" }); }
    this.updateAssetControls();
  }
  private updateAssetControls(): void { const audio = this.speaking ? this.speechAudio : this.cuePlayer ?? this.recordedPlayer ?? this.assetAudio; if (!audio) return; const cue = this.cueRange; if (!this.speaking && cue && cue.audio === audio && audio.currentTime >= cue.end) { if (cue.loop) audio.currentTime = cue.start; else { this.stopCuePlayback(); audio.currentTime = cue.end; } } const format = (value: number): string => { const n = Number.isFinite(value) ? Math.floor(value) : 0; return `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`; }; const time = this.assetControls.querySelector<HTMLElement>("[data-media-time]"); if (time) time.textContent = `${format(audio.currentTime)} / ${format(audio.duration)}`; const seek = this.assetControls.querySelector<HTMLInputElement>(".pith-media-seek"); if (seek) { seek.max = String(Number.isFinite(audio.duration) ? audio.duration : 0); seek.value = String(audio.currentTime); } const play = this.assetControls.querySelector<HTMLButtonElement>('[data-media="play"]'); if (play) { play.innerHTML = pithIcon(audio.paused ? "play" : "pause"); play.setAttribute("aria-label", audio.paused ? "播放" : "暂停"); } if (this.speaking || this.cuePlayer || this.recordedPlayer) return; const cues = Array.from(this.article.querySelectorAll<HTMLElement>('.pith-cue[data-locator^="time:"]')); for (let i = 0; i < cues.length; i++) { const item = cues[i]!; const start = Number(item.dataset.locator!.slice(5)), end = item.dataset.endSec !== undefined ? Number(item.dataset.endSec) : cues[i + 1] ? Number(cues[i + 1]!.dataset.locator!.slice(5)) : Infinity; item.classList.toggle("pith-speech-active", audio.currentTime >= start && audio.currentTime < end); } }

  private applyPageMode(position: ReaderPosition | null = null): void { const decision = resolveResponsiveLayout({ width: this.root.clientWidth, height: this.root.clientHeight, readerWidthPx: this.reader.clientWidth, guideOpen: false, preferredColumns: this.pageMode, coarsePointer: typeof this.win.matchMedia === "function" && this.win.matchMedia("(pointer: coarse)").matches }); this.root.dataset.formFactor = decision.formFactor; this.root.dataset.sheetMode = decision.sheetMode; this.root.dataset.hitTarget = String(decision.hitTargetPx); const double = this.root.querySelector<HTMLButtonElement>('[data-mode="double"]'), triple = this.root.querySelector<HTMLButtonElement>('[data-mode="triple"]'); if (double) double.disabled = decision.maxColumns < 2; if (triple) triple.disabled = decision.maxColumns < 3; const controls = this.root.querySelector<HTMLElement>("[data-pages]"); if (controls) controls.hidden = !this.paged; const modes = this.root.querySelector<HTMLElement>("[data-page-modes]"); if (modes) modes.hidden = !this.paged; this.reader.classList.toggle("pith-paged", this.paged); if (this.paged) { applyPaginationStyles(this.reader, this.article, decision.effectiveColumns === 3 ? "triple" : decision.effectiveColumns === 2 ? "double" : "single", this.mediaLoaded); restoreReaderPosition(this.reader, this.article, position); this.restoredScrollLeft = position ? this.reader.scrollLeft : null; this.readerPosition = position ?? captureReaderPosition(this.reader, this.article); this.updatePageCount(); } else { for (const property of ["box-sizing", "width", "height", "padding", "column-width", "column-gap", "column-fill", "--pith-page-height"]) this.article.style.removeProperty(property); this.reader.style.removeProperty("overflow-x"); this.reader.style.removeProperty("overflow-y"); } if (this.interline) this.interline.activate(); }
  private markExisting(): void { for (const mark of this.article.querySelectorAll("mark[data-pith-note]")) mark.replaceWith(...mark.childNodes); this.article.normalize(); for (const note of this.guideData.notes) { const anchor = note.anchor; if (note.kind === "practice" || !anchor || anchor.file !== this.currentFile || !anchor.quote) continue; const walker = this.doc.createTreeWalker(this.article, 4); const nodes: { node: Text; start: number }[] = []; let node: Node | null, text = ""; while ((node = walker.nextNode())) { const part = node as Text; if (part.parentElement && part.parentElement.closest(".pith-interline-subtitle,.pith-inline-dojo,[data-dojo-display]")) continue; nodes.push({ node: part, start: text.length }); text += part.data; } const match = matchTextAnchor(text, anchor); if (!match) continue; for (const part of nodes) { const start = Math.max(0, match.startOffset - part.start), end = Math.min(part.node.length, match.endOffset - part.start); if (start >= end) continue; const range = this.doc.createRange(); range.setStart(part.node, start); range.setEnd(part.node, end); const mark = this.doc.createElement("mark"); mark.dataset.pithNote = note.id; range.surroundContents(mark); } } }
  async refreshGuide(): Promise<void> { if (!this.actions.guideData || this.disposed) return; const generation = ++this.guideGeneration; const data = await this.actions.guideData(); if (this.disposed || generation !== this.guideGeneration) return; const position = this.readerPosition; this.guideData = data; this.setToolkits(data.toolkits); this.renderGuide(); this.markExisting(); if (this.paged && position) { restoreReaderPosition(this.reader, this.article, position); this.readerPosition = captureReaderPosition(this.reader, this.article); } }
  quoteSelection(anchor: SelectionAnchor, tab: "chat" | "notes"): void { this.pendingAnchor = anchor; this.guideTab = tab; this.setGuideVisible(true); if (this.actions.guideVisibilityChanged) this.actions.guideVisibilityChanged(true); this.renderGuide(); this.guide.querySelector<HTMLTextAreaElement>("textarea")?.focus(); }
  private renderGuide(): void {
    this.voice.cancel("guide");
    renderGuide(this.guide, this.guideData, this.guideTab, this.pendingAnchor, this.guideSending);
  }
  openDojo(dojos: readonly DojoToolkitDescriptor[], text?: string, anchor?: SelectionAnchor): void {
    this.dojos = dojos;
    const mounted = dojos.filter(item => this.mountedToolkits.includes(item.id));
    if (text === undefined && this.actions.toggleToolkit) {
      const explicit = this.requestedDojoBlock && this.article.contains(this.requestedDojoBlock) ? this.requestedDojoBlock : this.dojoBlock;
      if (this.inlineDojo) this.closeInlineDojo();
      if (explicit && this.article.contains(explicit) && this.dojoAnchor?.file === this.currentFile && this.dojoTarget) this.requestedDojoBlock = explicit;
      else { this.requestedDojoBlock = null; const current = visibleDojoTarget(this.article, this.reader, this.currentFile); if (current) { this.dojoTarget = current.quote; this.dojoAnchor = current; } }
      this.popover.hidden = true; renderToolkitMenu(this.dojo, dojos, this.mountedToolkits);
      return;
    }
    if (!mounted.length) { this.tip("没有已挂载的实训工具"); return; }
    this.popover.hidden = true;
    if (this.inlineDojo) this.closeInlineDojo();
    if (text !== undefined) { this.dojoTarget = text; this.dojoAnchor = anchor; }
    else {
      const current = visibleDojoTarget(this.article, this.reader, this.currentFile);
      if (current) { this.dojoTarget = current.quote; this.dojoAnchor = current; }
    }
    this.dojoResult = null; this.dojoStatus = ""; this.dojoVersion++;
    if (mounted.length > 1) {
      this.dojo.hidden = false; this.dojo.innerHTML = "";
      for (const item of mounted) { const button = this.doc.createElement("button"); button.dataset.dojoChoose = item.id; button.textContent = item.label; this.dojo.append(button); }
      return;
    }
    this.dojoId = mounted[0]!.id; this.renderDojo();
  }
  private nativeCueRange(): { audio: HTMLMediaElement; start: number; end: number } | null {
    const audio = this.assetAudio, block = this.dojoBlock, locator = block?.dataset.locator;
    if (!audio || !block || !locator?.startsWith("time:") || block.dataset.endSec === undefined) return null;
    const start = Number(locator.slice(5)), end = Number(block.dataset.endSec);
    return Number.isFinite(start) && Number.isFinite(end) && start >= 0 && end > start ? { audio, start, end } : null;
  }
  private updateCueButtons(): void {
    const play = this.inlineDojo?.querySelector<HTMLButtonElement>("[data-dojo-play-cue]"), loop = this.inlineDojo?.querySelector<HTMLButtonElement>("[data-dojo-loop-cue]");
    if (play) { play.innerHTML = this.cuePlaying && !this.cueLoop ? `${pithIcon("stop")} 停止原声` : `${pithIcon("play")} 原声${this.dojoStage === "listen-decompose" ? " 0.75x" : ""}`; play.setAttribute("aria-pressed", String(this.cuePlaying && !this.cueLoop)); }
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
        this.stopSpeech(); this.cueRange = { ...range, loop }; range.audio.currentTime = range.start; range.audio.playbackRate = this.dojoStage === "listen-decompose" ? .75 : this.speechRate;
        await range.audio.play();
        if (generation !== this.cueGeneration) return;
        const tick = () => { if (generation !== this.cueGeneration || !this.cueRange) return; this.updateAssetControls(); if (this.cueRange) this.cueFrame = this.win.requestAnimationFrame(tick); };
        this.cueFrame = this.win.requestAnimationFrame(tick);
      } else {
        const synthesize = this.actions.synthesizeSpeech; if (!synthesize) throw new Error("未连接可用的语音服务");
        if (this.assetAudio) this.assetAudio.pause(); if (this.speaking) this.stopSpeech();
        const abort = new AbortController(); this.cueAbort = abort;
        const speech = await synthesize(this.dojoTarget, abort.signal); if (generation !== this.cueGeneration || abort.signal.aborted) return;
        if (!speech.bytes.byteLength) throw new Error("语音引擎返回空音频");
        this.cueUrl = URL.createObjectURL(new Blob([new Uint8Array(speech.bytes)], { type: speech.mimeType }));
        const audio = this.doc.createElement("audio"); this.cuePlayer = audio; audio.src = this.cueUrl; audio.playbackRate = this.dojoStage === "listen-decompose" ? .75 : this.speechRate; this.assetControls.hidden = false; this.mediaDeck.hidden = false; this.playback.renderCueMarkers(); for (const event of ["loadedmetadata", "timeupdate", "play", "pause"]) audio.addEventListener(event, () => { if (this.cuePlayer === audio) this.updateAssetControls(); });
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
  private closeInlineDojo(): void {
    this.popover.hidden = true;
    this.readDojo();
    this.dojoVersion++; this.voice.cancel("dojo"); this.stopCuePlayback(); this.voice.clearRecording(); this.stopRecordedPlayback();
    if (this.dojoSource && this.dojoBlock) { const source = this.dojoSource; this.preserveMovedSelection(source, () => source.replaceWith(...Array.from(source.childNodes))); }
    this.dojoBlock?.classList.remove("pith-shadowing-spotlight"); this.dojoLenses?.remove(); this.dojoDisplay?.remove(); this.inlineDojo?.remove();
    this.dojoLenses = null; this.inlineDojo = null; this.dojoBlock = null; this.dojoSource = null; this.dojoDisplay = null;
    this.setDojoActive(false);
  }
  private preserveMovedSelection(container: HTMLElement, move: () => void): void {
    const selection = this.win.getSelection();
    const anchor = selection?.anchorNode, focus = selection?.focusNode;
    const saved = selection && anchor && focus && !selection.isCollapsed && container.contains(anchor) && container.contains(focus)
      ? { anchor, focus, anchorOffset: selection.anchorOffset, focusOffset: selection.focusOffset }
      : selection?.isCollapsed && this.pendingDojoSelection && container.contains(this.pendingDojoSelection.anchor) && container.contains(this.pendingDojoSelection.focus) ? this.pendingDojoSelection : null;
    this.pendingDojoSelection = null;
    move();
    const validOffset = (node: Node, offset: number): boolean => offset <= (node.nodeType === 3 ? (node as Text).length : node.childNodes.length);
    if (selection && saved && saved.anchor.isConnected && saved.focus.isConnected && validOffset(saved.anchor, saved.anchorOffset) && validOffset(saved.focus, saved.focusOffset)) {
      selection.setBaseAndExtent(saved.anchor, saved.anchorOffset, saved.focus, saved.focusOffset);
      this.selectionRange = selection.getRangeAt(0).cloneRange();
    }
  }
  private mountInlineDojo(): boolean {
    const requested = this.requestedDojoBlock;
    const anchor = this.dojoAnchor;
    const block = requested && this.article.contains(requested) ? requested : anchor ? resolveReaderLocator(this.article, anchor.locator) : null;
    const target = block ?? Array.from(this.article.querySelectorAll<HTMLElement>('[data-prose="true"],.pith-cue')).find(item => (item.textContent ?? "").includes(this.dojoTarget)) ?? null;
    this.requestedDojoBlock = null;
    if (!target || !this.dojoTarget || !anchor) { this.tip("当前页面没有可用原文"); return false; }
    if (this.dojoBlock !== target) {
      this.closeInlineDojo(); this.dojoBlock = target;
      const source = this.doc.createElement("span"); source.className = "pith-dojo-source";
      this.preserveMovedSelection(target, () => { const time = target.classList.contains("pith-cue") ? target.querySelector(":scope > time") : null; for (const node of Array.from(target.childNodes)) if (node !== time) source.append(node); target.append(source); });
      const display = this.doc.createElement("span"); display.dataset.dojoDisplay = ""; display.dataset.prose = "false";
      target.append(display); this.dojoSource = source; this.dojoDisplay = display;
      const inline = this.doc.createElement("section"); inline.className = "pith-inline-dojo"; inline.dataset.prose = "false"; target.insertAdjacentElement("afterend", inline); this.inlineDojo = inline;
    }
    if (this.assetAudio) this.assetAudio.pause();
    if (this.speaking) this.stopSpeech();
    this.dojoProduced = this.dojoDrafts.get(this.dojoDraftKey()) ?? "";
    this.dojoReveal = false; this.setDojoActive(true); return true;
  }
  private renderDojo(): void {
    this.voice.cancel("dojo"); const toolkit = this.dojos.find(item => item.id === this.dojoId); if (!toolkit) return;
    this.setToolkits(this.configuredToolkits);
    if (toolkit.id === "interline") { this.dojo.hidden = false; this.dojo.innerHTML = `<strong>行间</strong><div class="pith-interline-modes" role="group" aria-label="行间模式">${([["original", "原文"], ["bilingual", "行间"], ["subtitle-primary", "译文主显"]] as const).map(([mode, label]) => `<button data-interline-mode="${mode}" aria-pressed="${this.interlineMode === mode}">${label}</button>`).join("")}</div>`; return; }
    this.dojo.hidden = true;
    if (!this.inlineDojo && !this.mountInlineDojo()) return;
    if (!toolkit.stages.includes(this.dojoStage)) this.dojoStage = toolkit.stages[0]!;
    if (this.dojoLenses) this.dojoLenses.remove();
    this.dojoLenses = renderInlineToolkit({ block: this.dojoBlock!, inline: this.inlineDojo!, source: this.dojoSource!, display: this.dojoDisplay!, toolkit, stage: this.dojoStage, target: this.dojoTarget, reveal: this.dojoReveal, recorded: Boolean(this.recordedUrl), result: this.dojoResult, produced: this.dojoProduced, status: this.dojoStatus });
    this.updateCueButtons();
  }
  private dojoDraftKey(): string { return JSON.stringify([this.dojoId, this.dojoAnchor?.file, this.dojoAnchor?.locator, this.dojoAnchor?.quote]); }
  private readDojo(): void { const produced = this.inlineDojo?.querySelector<HTMLTextAreaElement>("[data-dojo-produced]"); if (produced && produced.value !== this.dojoProduced) { this.dojoResult = null; this.dojoStatus = ""; } if (produced) { this.dojoProduced = produced.value; this.dojoDrafts.set(this.dojoDraftKey(), produced.value); } }

  private closeNavigation(): void { this.navigation.hidden = true; this.navigationButton.setAttribute("aria-expanded", "false"); }
  private openEpubLink(link: HTMLElement): void { const target = resolveEpubTarget(this.article, link.dataset.epubTarget ?? ""); if (target) { if (this.speechResult) this.stopSpeech(); navigateReaderTarget(this.reader, target, this.paged); if (this.paged) { this.readerPosition = captureReaderPosition(this.reader, this.article); this.updatePageCount(); } } else this.tip("无法定位书内目标"); }
  private tip(text: string, speechSettings = false): void { this.toast.textContent = text; if (speechSettings && this.actions.openSettings) { const button = this.doc.createElement("button"); button.textContent = "配置语音"; button.onclick = () => { this.toast.hidden = true; this.actions.openSettings!(); }; this.toast.append(" ", button); } this.toast.hidden = false; if (this.toastTimer !== undefined) this.win.clearTimeout(this.toastTimer); this.toastTimer = this.win.setTimeout(() => { this.toast.hidden = true; }, speechSettings ? 5000 : 2000); }
  private async click(event: MouseEvent): Promise<void> {
    const target = event.target as Element | null; if (!target || typeof target.closest !== "function") return; const link = target.closest<HTMLElement>("a[data-epub-target]"); if (link && this.article.contains(link)) { event.preventDefault(); this.openEpubLink(link); return; } const button = target.closest<HTMLButtonElement>("button");
    const cue = target.closest<HTMLElement>(".pith-cue");
    if (cue && cue !== this.dojoBlock && this.article.contains(cue) && !button) { if (this.assetAudio && cue.dataset.locator?.startsWith("time:")) { const position = Number(cue.dataset.locator.slice(5)); if (Number.isFinite(position)) this.assetAudio.currentTime = position; } const available = this.mountedToolkits.filter(id => id === "shadowing" || id === "feynman"); if (!available.length) return; if (!available.some(id => id === this.dojoId)) this.dojoId = available[0]!; const copy = cue.cloneNode(true) as HTMLElement; const time = copy.querySelector("time"); if (time) time.remove(); this.requestedDojoBlock = cue; this.actions.openDojo((copy.textContent ?? "").trim(), cue.dataset.locator); return; }
    const prose = target.closest<HTMLElement>('[data-prose="true"],[data-trainable="true"]');
    if (!button && prose && prose !== this.dojoBlock && this.article.contains(prose) && this.mountedToolkits.some(id => id === "shadowing" || id === "feynman")) { const selection = this.win.getSelection(); if (selection && !selection.isCollapsed) return; this.requestedDojoBlock = prose; const range = this.doc.createRange(); range.selectNodeContents(this.article); range.setEndBefore(prose); this.actions.openDojo(proseTextNodes(prose).map(node => node.data).join("").trim(), prose.dataset.locator || `text:offset:${range.toString().length}`); return; }
    if (!button || button.disabled) return;
    if (!this.root.contains(button) && !this.guide.contains(button)) return;
    if (button.dataset.cueStart !== undefined) { this.seekMedia(Number(button.dataset.cueStart)); return; }
    if (button.dataset.voice) { if (button.dataset.voice === "dojo") { this.stopCuePlayback(); this.stopRecordedPlayback(); } void this.voice.toggle(button.dataset.voice); return; }
    if (button.hasAttribute("data-dojo-play-cue")) { if (this.cuePlaying && !this.cueLoop) this.stopCuePlayback(); else void this.playCue(false); return; }
    if (button.hasAttribute("data-dojo-loop-cue")) { if (this.cuePlaying && this.cueLoop) this.stopCuePlayback(); else void this.playCue(true); return; }
    if (button.hasAttribute("data-dojo-play-recorded")) { void this.playRecording(); return; }
    if ((button.dataset.interlineMode === "original" || button.dataset.interlineMode === "bilingual" || button.dataset.interlineMode === "subtitle-primary") && this.dojo.contains(button)) { this.interlineMode = button.dataset.interlineMode; if (this.interline) this.interline.setMode(this.interlineMode); else this.tip("行间不可用"); this.renderDojo(); return; }
    if (this.paged && (button.dataset.media === "close" || button.dataset.command === "read" || button.dataset.command === "speech-close")) this.readerPosition = captureReaderPosition(this.reader, this.article);
    if (button.dataset.media) { const speech = this.speaking, cuePlayer = this.cuePlayer, recordedPlayer = this.recordedPlayer, generation = this.generation, audio = speech ? this.speechAudio : cuePlayer ?? recordedPlayer ?? this.assetAudio; if (button.dataset.media === "close") { if (speech || this.speechResult) this.stopSpeech(); else { this.stopCuePlayback(); this.stopRecordedPlayback(); this.clearAudioAsset(); this.mediaDeck.hidden = true; } return; } if (!audio) return; if (!cuePlayer) this.stopCuePlayback(); if (!recordedPlayer) this.stopRecordedPlayback(); if (button.dataset.media === "play") { try { if (audio.paused) { button.disabled = true; await audio.play(); button.disabled = false; } else audio.pause(); } catch (error) { button.disabled = false; if (speech && generation === this.generation) this.finishSpeech(error); else if (!(error instanceof DOMException && error.name === "AbortError")) this.tip(error instanceof Error ? error.message : String(error)); } } else if (button.dataset.media === "back" || button.dataset.media === "forward") { const next = audio.currentTime + (button.dataset.media === "back" ? -15 : 15); if (speech || cuePlayer || recordedPlayer) audio.currentTime = Math.max(0, Math.min(Number.isFinite(audio.duration) ? audio.duration : next, next)); else this.seekMedia(next); } else if (button.dataset.media === "rate") { const rates = [.75, 1, 1.25, 1.5, 2]; this.speechRate = rates[(rates.indexOf(this.speechRate) + 1) % rates.length]!; audio.playbackRate = this.speechRate; button.textContent = `${this.speechRate.toFixed(2).replace(/0$/, "")}x`; } this.updateAssetControls(); return; }
    if (button.dataset.command === "typography") { const menu = this.root.querySelector<HTMLElement>(".pith-typography-popover")!; menu.hidden = !menu.hidden; button.setAttribute("aria-expanded", String(!menu.hidden)); return; }
    if (button.dataset.size) { const position = this.paged ? captureReaderPosition(this.reader, this.article) : null; this.article.style.setProperty("--pith-reader-size", `${button.dataset.size}px`); if (this.paged) { this.applyPageMode(position); this.readerPosition = captureReaderPosition(this.reader, this.article); } for (const item of this.root.querySelectorAll<HTMLButtonElement>("[data-size]")) item.setAttribute("aria-pressed", String(item === button)); return; }
    if (button.dataset.mode === "single" || button.dataset.mode === "double" || button.dataset.mode === "triple") { const position = captureReaderPosition(this.reader, this.article); this.pageMode = button.dataset.mode; this.applyPageMode(position); this.readerPosition = captureReaderPosition(this.reader, this.article); for (const item of this.root.querySelectorAll<HTMLButtonElement>("[data-mode]")) item.setAttribute("aria-pressed", String(item === button)); return; }
    if (button.dataset.page) { this.turnPage(button.dataset.page === "previous" ? -1 : 1); return; }
    if (button.dataset.dojoChoose || button.dataset.toolkitRemove) {
      const id = button.dataset.dojoChoose || button.dataset.toolkitRemove!;
      const remove = Boolean(button.dataset.toolkitRemove), mounted = this.mountedToolkits.includes(id);
      if (!this.dojos.some(item => item.id === id) || (remove && !mounted)) return;
      if (remove || !mounted) {
        if (!this.actions.toggleToolkit) return;
        const buttons = Array.from(this.dojo.querySelectorAll<HTMLButtonElement>("button"));
        buttons.forEach(item => { item.disabled = true; });
        try { await this.actions.toggleToolkit(id, !remove); }
        catch (error) { if (!this.disposed && button.isConnected && !this.dojo.hidden) { buttons.forEach(item => { item.disabled = false; }); this.tip(error instanceof Error ? error.message : String(error)); } return; }
        if (this.disposed || !button.isConnected || this.dojo.hidden) return;
        if (remove) { this.openDojo(this.dojos); return; }
        if (!this.mountedToolkits.includes(id)) return;
      }
      this.closeInlineDojo(); this.dojoResult = null; this.dojoStatus = ""; this.dojoId = id; this.renderDojo(); return;
    }
    if (button.hasAttribute("data-dojo-close")) { this.closeInlineDojo(); return; }
    if (button.hasAttribute("data-dojo-reveal")) { this.readDojo(); this.dojoReveal = !this.dojoReveal; this.renderDojo(); return; }
    if (button.dataset.noteId) { const note = this.guideData.notes.find(item => item.id === button.dataset.noteId); if (!note || !note.anchor) return; try { const anchor = note.anchor; if (anchor.file !== this.currentFile) await this.actions.openFile(anchor.file); const mark = Array.from(this.article.querySelectorAll<HTMLElement>("mark[data-pith-note]")).find(item => item.dataset.pithNote === note.id); const target = mark || Array.from(this.article.querySelectorAll<HTMLElement>("[data-locator]")).find(item => item.dataset.locator === anchor.locator); if (target) target.scrollIntoView({ block: "center" }); else this.tip("无法定位原文"); } catch (error) { this.tip(error instanceof Error ? error.message : String(error)); } return; }
    if (button.dataset.guideTab === "chat" || button.dataset.guideTab === "notes") { this.guideTab = button.dataset.guideTab; this.renderGuide(); return; }
    if (button.dataset.guidePrompt) { const input = this.guide.querySelector<HTMLTextAreaElement>("textarea"); if (input) { input.value = button.dataset.guidePrompt; input.focus(); } return; }
    if (button.hasAttribute("data-guide-send")) { const input = this.guide.querySelector<HTMLTextAreaElement>("textarea"), errorBox = this.guide.querySelector<HTMLElement>("[data-guide-error]"); if (!input || !input.value.trim() || !this.actions.sendGuide || this.guideSending) return; const message = input.value, anchor = this.pendingAnchor; input.value = ""; this.pendingAnchor = undefined; if (errorBox) errorBox.textContent = ""; this.guideSending = true; button.disabled = true; try { await this.actions.sendGuide(message.trim(), anchor, this.guideTab === "notes"); await this.refreshGuide(); } catch (error) { const current = this.guide.querySelector<HTMLTextAreaElement>("textarea"), currentError = this.guide.querySelector<HTMLElement>("[data-guide-error]"); if (current && !current.value) { current.value = message; this.pendingAnchor = anchor; } if (currentError) currentError.textContent = error instanceof Error ? error.message : String(error); } finally { this.guideSending = false; const send = this.guide.querySelector<HTMLButtonElement>("[data-guide-send]"); if (send) send.disabled = false; } return; }
    if (button.dataset.dojoStage || button.hasAttribute("data-dojo-diagnose") || button.hasAttribute("data-dojo-save") || button.hasAttribute("data-dojo-submit")) {
      try {
        this.readDojo(); const toolkit = this.dojos.find(item => item.id === this.dojoId); if (!toolkit) throw new Error("工坊不可用");
        if (button.dataset.dojoStage) { this.stopCuePlayback(); this.dojoStage = button.dataset.dojoStage as DojoScaffoldStage; this.dojoVersion++; this.dojoResult = null; this.dojoStatus = ""; this.renderDojo(); return; }
        if (!this.dojoTarget.trim() || !this.dojoAnchor) throw new Error("当前页面没有可用原文");
        if (!this.dojoProduced.trim()) throw new Error("请输入复述文本");
        if (button.hasAttribute("data-dojo-diagnose")) { this.dojoResult = toolkit.diagnose(this.dojoTarget, this.dojoProduced); this.renderDojo(); return; }
        const version = ++this.dojoVersion; button.disabled = true;
        if (button.hasAttribute("data-dojo-save") && this.dojoResult && this.actions.savePractice) {
          await this.actions.savePractice(this.dojoResult.summaryMarkdown, this.dojoAnchor);
          if (this.disposed || version !== this.dojoVersion) return;
          this.dojoStatus = "已记入实训账本"; this.dojoResult = null; await this.refreshGuide();
        } else if (button.hasAttribute("data-dojo-submit") && this.actions.submitPractice) {
          const result = await this.actions.submitPractice(this.dojoProduced, this.dojoAnchor, toolkit);
          if (this.disposed || version !== this.dojoVersion) return;
          this.dojoStatus = result.guided ? "已提交并记入实训账本" : result.guideError ? `已记入实训账本，向导追问失败：${result.guideError}` : "已记入实训账本。向导未配置，请对照原文检查因果链、前提和边界，并尝试举一个反例。";
          if (result.guided) { this.guideTab = "chat"; this.setGuideVisible(true); if (this.actions.guideVisibilityChanged) this.actions.guideVisibilityChanged(true); }
          await this.refreshGuide();
        }
        if (!this.disposed && version === this.dojoVersion) this.renderDojo();
      } catch (error) { this.tip(error instanceof Error ? error.message : String(error)); if (button.isConnected) button.disabled = false; }
      return;
    }
    if (button.dataset.command === "speech-close") this.stopSpeech();
    else if (button.dataset.command === "speech-follow") { const active = this.article.querySelector<HTMLElement>(".pith-speech-active"); if (active) active.scrollIntoView({ block: "center", inline: "center" }); }
    else if (button.dataset.command === "home") { this.voice.cancel(); if (this.actions.home) { try { await this.actions.home(); } catch (error) { this.tip(error instanceof Error ? error.message : String(error)); } } }
    else if (button.dataset.command === "settings" && this.actions.openSettings) this.actions.openSettings();
    else if (button.dataset.command === "import" && this.actions.importMaterial) this.actions.importMaterial();
    else if (button === this.navigationButton) { this.navigation.hidden = !this.navigation.hidden; button.setAttribute("aria-expanded", String(!this.navigation.hidden)); if (!this.navigation.hidden) updateTocLocation(this.navigation, this.article, this.reader, this.paged); }
    else if (button === this.guideButton) { const visible = this.guide.hidden; this.setGuideVisible(visible); if (this.actions.guideVisibilityChanged) this.actions.guideVisibilityChanged(visible); }
    else if (button.dataset.plannedLesson) { this.closeNavigation(); if (!this.actions.generateLesson) { this.tip("向导不可用，无法生成讲义"); return; } try { await this.actions.generateLesson(button.dataset.plannedLesson, button.dataset.plannedTitle || button.dataset.plannedLesson); } catch (error) { this.tip(error instanceof Error ? error.message : String(error)); } }
    else if (button.dataset.file) { this.closeNavigation(); try { await this.actions.openFile(button.dataset.file); } catch (error) { this.tip(error instanceof Error ? error.message : String(error)); } }
    else if (button.dataset.locator) { this.closeNavigation(); const heading = Array.from(this.article.querySelectorAll<HTMLElement>("[data-locator]")).find(node => node.dataset.locator === button.dataset.locator); if (heading) heading.scrollIntoView({ block: "start" }); }
    else if (button.dataset.command === "dojo") { const range = this.selectionRange; if (this.dojo.hidden && range && !range.collapsed && this.article.contains(range.startContainer)) { const prefix = this.doc.createRange(); prefix.selectNodeContents(this.article); prefix.setEnd(range.startContainer, range.startOffset); this.requestedDojoBlock = (range.startContainer.parentElement?.closest<HTMLElement>('[data-prose="true"],[data-trainable="true"],.pith-cue') ?? null); this.actions.openDojo(range.toString(), `text:offset:${prefix.toString().length}`); } else this.actions.openDojo(); }
    else if (button.dataset.command === "read") { this.stopCuePlayback(); this.stopRecordedPlayback(); if (this.speaking) this.stopSpeech(); else if (this.assetSource && !this.assetAudio) await this.loadAsset(); else if (this.assetAudio && this.mediaDeck.hidden) this.mediaDeck.hidden = false; else this.startSpeech(); }
    else if (button.dataset.selection && this.selectionRange) { if (button.dataset.selection === "copy") { try { await this.win.navigator.clipboard.writeText(this.selectionRange.toString()); } catch { this.tip("复制失败"); } } else if (button.dataset.selection === "highlight" || button.dataset.selection === "note" || button.dataset.selection === "ask") { const prefix = this.doc.createRange(); prefix.selectNodeContents(this.article); prefix.setEnd(this.selectionRange.startContainer, this.selectionRange.startOffset); this.actions.selection(button.dataset.selection, this.selectionRange.toString(), `text:offset:${prefix.toString().length}`); } this.popover.hidden = true; }
  }
  private showSelection(): void {
    const selection = this.win.getSelection(); if (!selection || selection.isCollapsed || !selection.toString().trim() || !selection.anchorNode || !selection.focusNode || !this.article.contains(selection.anchorNode) || !this.article.contains(selection.focusNode)) { this.selectionRange = null; this.popover.hidden = true; return; }
    this.selectionRange = selection.getRangeAt(0).cloneRange(); const rect = this.selectionRange.getBoundingClientRect(); this.popover.hidden = false; for (const item of this.popover.querySelectorAll<HTMLButtonElement>("button")) item.hidden = false; this.popover.style.left = `${Math.max(8, Math.min(this.win.innerWidth - this.popover.offsetWidth - 8, rect.left))}px`; this.popover.style.top = `${Math.max(8, rect.top - this.popover.offsetHeight - 8)}px`;
  }
  private clearSpeechMark(): void { for (const mark of this.article.querySelectorAll('[data-speech-active="true"]')) { const parent = mark.parentNode; mark.replaceWith(...mark.childNodes); if (parent) parent.normalize(); } }
  private stopSpeech(): void { this.generation++; if (this.speechAbort) this.speechAbort.abort(); this.speechAbort = null; if (this.speechAudio) { this.speechAudio.pause(); this.speechAudio.removeAttribute("src"); this.speechAudio.load(); this.speechAudio = null; } if (this.speechUrl) URL.revokeObjectURL(this.speechUrl); this.speechUrl = null; this.speaking = false; this.speechResult = false; this.clearSpeechMark(); this.dock.classList.toggle("active", this.dojoActive); for (const item of this.mediaDeck.querySelectorAll("[data-speech-control]")) item.remove(); this.assetControls.hidden = !this.assetAudio; this.mediaDeck.hidden = !this.assetAudio; const play = this.assetControls.querySelector<HTMLButtonElement>('[data-media="play"]'); if (play) play.disabled = false; this.playback.renderCueMarkers(); this.updateAssetControls(); const button = this.dock.querySelector("[data-command=read]"); if (button) button.innerHTML = pithIcon("headphones"); }
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
