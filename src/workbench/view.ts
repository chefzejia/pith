import type { DojoDiagnosisResult, DojoScaffoldStage, DojoToolkitDescriptor, GuideConversationEntry, GuideQuickAction, InterlineDisplayMode, ReaderSectionHeading, SelectionAnchor, TopicNote } from "../core/index.ts";
import { applyPaginationStyles, captureReaderPosition, navigateReaderTarget, proseTextNodes, readerPageIndex, renderTocTree, resolveEpubTarget, resolveReaderLocator, resolveResponsiveLayout, restoreReaderPosition, updateTocLocation, visibleDojoTarget, type ReaderPosition } from "../plugins/stage-reader/pagination.ts";
import { matchTextAnchor } from "../plugins/stage-reader/textAnchor.ts";
import * as readerFont from "../plugins/stage-reader/lxgwWenKaiData.ts";
import { audioContentType } from "./mediaAssets.ts";
import { effectiveToolkits, toolkitSlot } from "./toolkitSlot.ts";
import { InterlineView, preserveInterlinePosition, type InterlineViewPrepare } from "../plugins/dojo-interline/index.ts";
import { VoiceInput } from "./voiceInput.ts";
import { renderDojoAlignment } from "../plugins/dojo-shadowing/index.ts";
import { displayPracticeMessage } from "../plugins/dojo-feynman/index.ts";

export interface ObsidianAgentConfig {
  readonly agentId: "" | "dsh" | "claude" | "codex";
  readonly model: string;
  readonly effort: string;
  readonly persona: "sanctuary" | "studio";
}

export const workbenchStyles = `
@font-face{font-family:"Garden LXGW WenKai";src:url(data:font/woff2;base64,${readerFont[("LXGW_WENKAI_" + "WOFF2") as keyof typeof readerFont]}) format("woff2");font-display:swap}
.pith-view{position:relative;height:100%;display:flex;flex-direction:column;background:var(--background-primary);color:var(--text-normal);font-family:var(--font-interface)}
.pith-view *{box-sizing:border-box}.pith-view [hidden]{display:none!important}
.pith-epub-chapter a[data-epub-target]{cursor:pointer;text-decoration:underline}
.pith-epub-chapter [data-pith-readable],.pith-epub-chapter[data-pith-readable]{color:var(--pith-readable-color)!important}
.pith-view-header{display:flex;align-items:center;gap:12px;padding:8px;border-bottom:1px solid var(--background-modifier-border)}
.pith-view-header .pith-guide-toggle{margin-left:auto}.pith-view button{color:var(--text-normal);font:inherit;cursor:pointer}.pith-icon{border:0;background:none;padding:8px}.pith-icon:hover{background:var(--background-modifier-hover)}.pith-icon svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.7}
.pith-layout{display:grid;grid-template-columns:minmax(0,1fr) 320px;flex:1;min-height:0}.pith-layout.pith-guide-closed{grid-template-columns:minmax(0,1fr)}.pith-stage{position:relative;min-width:0;min-height:0}.pith-reader{height:100%;overflow:auto;overscroll-behavior:contain}.pith-article{max-width:850px;margin:auto;padding:32px 48px 120px;line-height:1.9;overflow-wrap:anywhere}.pith-article>:first-child{margin-top:0}.pith-article pre{overflow:auto;background:var(--background-secondary);padding:16px}
.pith-article{-webkit-user-select:text;user-select:text}
.pith-teaching-block{margin:1.5em 0;padding:1em 1.25em;background:var(--background-secondary);border:1px solid var(--background-modifier-border);border-left:3px solid var(--text-accent)}.pith-teaching-block h3{color:var(--text-accent);margin-top:0}.pith-teaching-block p:last-child{margin-bottom:0}.pith-fixed-page{margin:1.5em 0;padding:1em;background:var(--background-secondary);border:1px solid var(--background-modifier-border);text-align:center}.pith-fixed-page img{display:block;max-width:100%;max-height:80vh;width:auto;height:auto;object-fit:contain;margin:auto}.pith-fixed-page p{text-align:left;white-space:pre-wrap}
.pith-guide{background:var(--background-secondary);border-left:1px solid var(--background-modifier-border);overflow:auto}.pith-left-drawer{position:absolute;left:0;top:0;bottom:0;width:min(340px,100%);z-index:5;overflow:auto;background:var(--background-secondary);border-right:1px solid var(--background-modifier-border);padding:16px}.pith-left-drawer button{display:block;width:100%;text-align:left;border:0;background:none;padding:8px}.pith-left-drawer button:hover,.pith-left-drawer button[aria-current=true]{background:var(--background-modifier-hover)}.pith-left-drawer h2{font-size:14px;color:var(--text-muted)}
.pith-guide{display:flex;flex-direction:column;min-height:0}.pith-guide-tabs,.pith-guide-compose{padding:12px;border-bottom:1px solid var(--background-modifier-border)}.pith-guide-content{padding:12px;overflow:auto;flex:1;white-space:pre-wrap;overflow-wrap:anywhere}.pith-guide-content button{margin:3px}.pith-guide-compose textarea{width:100%;min-height:70px;box-sizing:border-box}.pith-guide-compose blockquote{margin:4px 0;color:var(--text-muted)}.pith-dojo-panel{position:absolute;z-index:4;right:16px;bottom:76px;width:max-content;max-width:calc(100% - 16px);display:flex;align-items:center;gap:6px;max-height:70%;overflow:auto;padding:8px 10px;box-sizing:border-box;background:var(--background-secondary);border:1px solid var(--background-modifier-border);border-radius:6px}.pith-page-mode{margin-left:auto}.pith-reader.pith-paged{position:relative;overflow:hidden;scrollbar-width:none}.pith-reader.pith-paged::-webkit-scrollbar{display:none}.pith-reader.pith-paged .pith-article{max-width:none;margin:0;overflow-wrap:anywhere}
.pith-bottom-dock{position:relative;flex:none;min-width:0}.pith-bottom-dock button,.pith-selection button{border:0;background:none;padding:8px}.pith-view-header{height:44px;min-height:44px;min-width:0;max-width:100%;overflow-x:auto;scrollbar-width:none;padding:0 8px;gap:4px}.pith-view-header::-webkit-scrollbar{display:none}.pith-title{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.pith-view-header .pith-guide-toggle{margin-left:0}.pith-view-header .pith-icon{flex:none;min-width:34px;padding:6px}.pith-speech-controls:not(:empty){display:flex;align-items:center;gap:4px;padding:2px 8px;border-bottom:1px solid var(--background-modifier-border);overflow-x:auto}.pith-typography-popover{position:absolute;z-index:10;right:8px;top:100%;margin-top:4px;padding:12px;background:var(--background-secondary);border:1px solid var(--background-modifier-border);border-radius:6px}.pith-typography-popover fieldset{display:flex;gap:4px;border:0;padding:4px;margin:0}.pith-typography-popover button[aria-pressed=true]{background:var(--background-modifier-hover)}
.pith-view-header #open-dojo{max-width:100px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
@media(max-width:700px){.pith-layout{position:relative}.pith-layout .pith-guide{top:0}}
.pith-selection{position:fixed;z-index:8;display:flex;flex-wrap:wrap;max-width:calc(100vw - 16px);background:var(--background-secondary);border:1px solid var(--background-modifier-border);border-radius:5px}.pith-speech-active{background:var(--background-modifier-hover);text-decoration:underline;text-decoration-color:var(--text-accent);text-underline-offset:4px;animation:pith-speech-breathe 2.4s ease-in-out infinite}@keyframes pith-speech-breathe{50%{background:transparent}}.pith-toast-tip{position:absolute;bottom:80px;left:50%;transform:translateX(-50%);z-index:9;background:var(--background-secondary);border:1px solid var(--background-modifier-border);border-radius:5px;padding:8px 12px;color:var(--text-normal)}
.pith-timeline-stage{max-width:100%}.pith-cue{padding:10px 8px;border-bottom:1px solid var(--background-modifier-border);cursor:pointer;white-space:pre-wrap}.pith-cue:hover{background:var(--background-modifier-hover)}.pith-cue time{color:var(--text-muted);font-size:12px;margin-right:12px}
@media(max-width:700px){.pith-layout{grid-template-columns:minmax(0,1fr)}.pith-guide{position:absolute;right:0;top:50px;bottom:0;width:min(320px,100%);z-index:4}.pith-article{padding:24px 20px 110px}}
@media(prefers-reduced-motion:reduce){.pith-bottom-dock{transition:none}.pith-speech-active{animation:none}}
.pith-view{--pith-sage:#4e6a56;--pith-clay:#ad6548;--pith-serif:"Garden LXGW WenKai","LXGW WenKai","Songti SC","Noto Serif CJK SC","Source Han Serif SC","Iowan Old Style",Georgia,serif}
body.theme-dark .pith-view{--pith-sage:#9bbfa2;--pith-clay:#d88d70}
@media(prefers-color-scheme:dark){body:not(.theme-light) .pith-view{--pith-sage:#9bbfa2;--pith-clay:#d88d70}}
.pith-article{font-family:var(--pith-serif);font-size:var(--pith-reader-size,17px);line-height:1.95}.pith-article p{margin:0 0 1.15em}.pith-article img,.pith-article svg{max-width:100%;height:auto}.pith-article mark{background:rgba(235,204,102,.38);border-bottom:1.5px solid #c59b38;color:inherit}
.pith-speech-active{background:color-mix(in srgb,var(--pith-sage) 18%,transparent);text-decoration-color:var(--pith-sage)}
.pith-view button:focus-visible,.pith-view input:focus-visible,.pith-view select:focus-visible,.pith-view textarea:focus-visible{outline:2px solid var(--pith-sage);outline-offset:2px}.pith-view button:active{transform:scale(.97)}
.pith-selection,.pith-dojo-panel,.pith-typography-popover{box-shadow:0 12px 32px rgba(24,34,29,.14)}.pith-bottom-dock button:hover{background:var(--background-modifier-hover)}.pith-dojo-add{color:var(--text-muted)!important;font-size:19px!important}
.pith-home-scroll{flex:1;overflow:auto}.pith-home{max-width:1020px;margin:auto;padding:38px 44px 84px}.pith-home h1,.pith-home h2,.pith-topic-card strong{font-family:var(--pith-serif);font-weight:500}.pith-home h1{font-size:30px}.pith-home h2{font-size:20px}.pith-home-actions,.pith-focus,.pith-home-heading{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.pith-home-heading{justify-content:space-between}.pith-focus{margin:20px 0 32px;padding:16px;background:var(--background-secondary);border-radius:8px}.pith-focus button{margin-left:auto}.pith-topic-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(240px,100%),1fr));gap:12px}.pith-view .pith-topic-card{display:flex;flex-direction:column;align-items:flex-start;gap:8px;width:100%;height:auto;min-height:130px;text-align:left;white-space:normal;overflow-wrap:anywhere;padding:18px;background:var(--background-secondary);border:1px solid var(--background-modifier-border);border-radius:8px}.pith-topic-card strong{font-size:18px}.pith-topic-status{color:var(--pith-sage);font-size:12px}.pith-topic-status.settled{color:var(--pith-clay)}.pith-home-form{display:grid;gap:8px;max-width:480px;margin:12px 0}.pith-home-form input{min-width:0}.pith-home-status{color:var(--text-muted)}.pith-note-source{display:block;width:100%;height:auto;text-align:left;white-space:normal;overflow-wrap:anywhere}
.pith-view-header [data-home-settings]{margin-left:auto}.pith-home-actions button,.pith-focus button,.pith-home-form button{border:1px solid var(--background-modifier-border);border-radius:6px;padding:8px 14px;background:var(--background-secondary)}.pith-home-actions button:hover,.pith-focus button:hover,.pith-home-form button:hover{background:var(--background-modifier-hover)}.pith-home-actions [data-home-new],.pith-focus button[data-topic],.pith-home-form button{border-color:#405d48;background:#405d48;color:#fff}.pith-home-actions [data-home-new]:hover,.pith-focus button[data-topic]:hover,.pith-home-form button:hover{background:#304b38;color:#fff}.pith-home-form{padding:16px;border:1px solid var(--background-modifier-border);border-radius:6px}.pith-home-form label{display:grid;gap:4px}.pith-home-form input,.pith-home-form select{width:100%;min-width:0;border:1px solid var(--background-modifier-border);border-radius:6px;padding:8px;background:var(--background-primary);color:var(--text-normal);font:inherit}
.pith-topic-grid{grid-template-columns:repeat(auto-fill,minmax(min(280px,100%),1fr))}.pith-view .pith-topic-card{min-height:204px;gap:10px;color:var(--text-normal)}.pith-card-top,.pith-card-body,.pith-card-foot{display:flex;justify-content:space-between;gap:12px;width:100%;min-width:0}.pith-card-top{align-items:center;font-size:11px;color:var(--text-muted)}.pith-card-top .pith-topic-status{padding:3px 7px;border:1px solid currentColor;border-radius:4px}.pith-card-body{align-items:flex-start}.pith-card-copy{display:flex;flex:1;min-width:0;flex-direction:column;gap:6px}.pith-card-copy strong,.pith-settled-row strong{display:-webkit-box;overflow:hidden;-webkit-line-clamp:2;-webkit-box-orient:vertical;line-height:1.4}.pith-card-material{font-size:12px;color:var(--text-muted);overflow-wrap:anywhere}.pith-card-cover{width:56px;height:78px;object-fit:cover;border-radius:4px;flex:none;box-shadow:0 2px 5px #0003}.pith-card-suggestion{width:100%;margin-top:auto;padding-top:10px;border-top:1px dashed var(--background-modifier-border);color:var(--pith-sage);font-size:12px;line-height:1.5}.pith-card-foot{font-size:12px;color:var(--text-muted)}.pith-card-foot span:last-child{color:var(--pith-sage)}.pith-settled-list{border-top:1px solid var(--background-modifier-border)}.pith-view .pith-settled-row{display:flex;align-items:center;justify-content:space-between;gap:16px;width:100%;height:auto;padding:13px 4px;border:0;border-bottom:1px solid var(--background-modifier-border);border-radius:0;background:transparent;color:var(--text-normal);text-align:left;white-space:normal}.pith-settled-row>span:first-child{min-width:0}.pith-settled-row strong{font:500 16px var(--pith-serif)}.pith-settled-row small{display:block;margin-top:3px;color:var(--text-muted);overflow-wrap:anywhere}.pith-settled-row .settled{flex:none;padding:3px 7px;border:1px solid currentColor;border-radius:4px}
.pith-card-top .pith-topic-status,.pith-settled-row .settled{border-radius:999px}
@media(max-width:700px){.pith-home{padding:24px 20px 64px}.pith-focus button{margin-left:0}.pith-view-header{gap:4px}.pith-title{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}}
.pith-view .pith-layout{position:relative;grid-template-columns:minmax(0,1fr) 320px}.pith-view .pith-layout.pith-guide-closed{grid-template-columns:minmax(0,1fr)}
.pith-view[data-sheet-mode="overlay-drawer"] .pith-layout,.pith-view[data-sheet-mode="bottom-sheet"] .pith-layout{grid-template-columns:minmax(0,1fr)}
.pith-view[data-sheet-mode="split-right"] .pith-guide{position:static;width:auto}
.pith-view[data-sheet-mode="overlay-drawer"] .pith-guide{position:absolute;top:0;right:0;bottom:0;width:min(320px,100%);z-index:6}
.pith-view[data-sheet-mode="bottom-sheet"] .pith-guide{position:absolute;left:0;right:0;top:auto;bottom:0;width:100%;max-height:75%;z-index:10;border-radius:16px 16px 0 0;padding-bottom:env(safe-area-inset-bottom)}
.pith-view .pith-dojo-panel{top:100%;margin-top:4px;right:8px;bottom:auto;max-height:calc(100vh - 120px)}.pith-reader.pith-paged .pith-epub-chapter + .pith-epub-chapter{break-before:column}
.pith-view[data-hit-target="44"] .pith-view-header button,.pith-view[data-hit-target="44"] .pith-media-deck button{min-width:44px;min-height:44px}
.pith-view-header #open-dojo:not(.pith-dojo-add){max-width:180px;color:var(--pith-sage);background:var(--background-secondary);border-radius:6px}
.pith-stage{display:flex;flex-direction:column}.pith-reader{flex:1;min-height:0;height:auto}.pith-media-deck{flex:none;display:flex;align-items:center;gap:4px;flex-wrap:wrap;padding:4px 8px calc(4px + env(safe-area-inset-bottom));background:var(--background-secondary);border-top:1px solid var(--background-modifier-border)}.pith-media-deck input[type=range]{flex:1;min-width:80px}.pith-media-deck button{border:0;background:none;padding:6px}.pith-media-deck .pith-speech-controls{border:0;padding:0}.pith-media-deck .pith-asset-controls{display:flex;align-items:center;gap:4px;flex:1;min-width:0;flex-wrap:wrap}
.pith-guide{height:100%}.pith-guide[hidden]{display:none}.pith-reader.pith-paged .pith-fixed-page{break-inside:avoid;max-height:var(--pith-page-height);box-sizing:border-box}.pith-reader.pith-paged .pith-fixed-page img{max-height:calc(var(--pith-page-height) - 2em)}
.pith-reader.pith-paged .pith-article figure{break-inside:avoid;page-break-inside:avoid;max-width:100%}
.pith-reader.pith-paged::after{content:"";position:absolute;left:var(--pith-page-scroll-extent,0px);top:0;width:1px;height:1px;pointer-events:none}
.pith-reader.pith-paged .pith-article :is(img,svg,math){break-inside:avoid;page-break-inside:avoid;max-width:100%;max-height:var(--pith-page-media-height,var(--pith-page-height))!important;width:auto;height:auto;object-fit:contain}
.pith-guide-toggle[aria-pressed=true]{color:var(--pith-sage)!important;background:color-mix(in srgb,var(--pith-sage) 14%,transparent)}
.pith-inline-dojo{break-inside:avoid;margin:12px 0 20px;padding:14px;border-left:3px solid var(--pith-sage);background:var(--background-secondary);font:14px/1.5 var(--font-interface);display:flex;flex-wrap:wrap;align-items:center;gap:8px}.pith-inline-dojo label{width:100%}.pith-inline-dojo textarea{display:block;width:100%;min-height:80px}.pith-inline-dojo button{padding:6px 10px}.pith-inline-dojo [data-dojo-close]{margin-left:auto}.pith-inline-dojo [role=status]{width:100%;white-space:pre-wrap}
.pith-interline-subtitle{display:block;margin-top:.3em;color:var(--text-muted);font-size:.9em;line-height:1.8}.pith-article [data-interline-mode=subtitle-primary]:not(.pith-interline-subtitle){font-size:.88em;color:var(--text-muted)}.pith-article [data-interline-mode=subtitle-primary]>.pith-interline-subtitle{font-size:1.2em;color:var(--text-normal)}.pith-interline-modes{display:flex;gap:4px}.pith-interline-modes [aria-pressed=true]{background:var(--background-modifier-hover)}
.pith-toc-tree,.pith-toc-tree ul{list-style:none;padding:0 0 0 14px;margin:0}.pith-toc-tree>li>div,.pith-toc-tree li>div{display:flex;align-items:start}.pith-left-drawer .pith-toc-tree [data-toc-toggle]{width:28px;flex:none;padding:8px 4px}.pith-toc-tree [data-toc-toggle][hidden]{display:block!important;visibility:hidden}.pith-left-drawer [aria-current=location]{background:var(--background-modifier-hover);color:var(--pith-sage)}
`;

export interface ObsidianReaderDocument {
  readonly title: string;
  readonly html: string;
  readonly files: readonly { name: string; mimeType?: string }[];
  readonly currentFile: string;
  readonly format?: "markdown" | "epub" | "pdf" | "cbz" | "image";
  readonly sections: readonly ReaderSectionHeading[];
}

export interface ObsidianViewActions {
  openFile(name: string): void | Promise<void>;
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
  private assetAudio: HTMLAudioElement | null = null;
  private assetUrl: string | null = null;
  private assetGeneration = 0;
  private loopStart: number | null = null;
  private loopEnd: number | null = null;
  private speechLoopStart: number | null = null;
  private speechLoopEnd: number | null = null;
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
      if (button) { button.textContent = phase === "recording" ? "⏹ 停止录音" : phase === "permission" ? "取消录音" : phase === "transcribing" ? "识别中…" : "🎙️ 语音输入"; button.disabled = phase === "transcribing"; button.setAttribute("aria-pressed", String(phase === "recording")); }
    }, (target, text) => {
      const input = target === "guide" ? this.guide.querySelector<HTMLTextAreaElement>("textarea") : this.inlineDojo?.querySelector<HTMLTextAreaElement>("[data-dojo-produced]");
      if (input) { input.value = input.value ? `${input.value} ${text}` : text; input.dispatchEvent(new (this.win as Window & typeof globalThis).Event("input", { bubbles: true })); input.focus(); if (target === "dojo") this.dojoProduced = input.value; }
    }, message => this.tip(message));
    root.classList.add("pith-view");
    root.innerHTML = `<style>${workbenchStyles}</style><div class="pith-bottom-dock"><header class="pith-view-header"><button class="pith-icon pith-nav-toggle" title="目录和材料" aria-label="目录和材料" aria-expanded="false">☰</button><button class="pith-icon" data-command="home" title="返回首页" aria-label="返回首页">‹</button><strong class="pith-title"></strong><span data-pages hidden><button data-page="previous" aria-label="上一页">‹</button><span data-page-count>1 / 1</span><button data-page="next" aria-label="下一页">›</button></span><button id="open-dojo" class="pith-icon pith-dojo-add" data-command="dojo" title="添加实训工具" aria-label="添加实训工具">🛠</button><button class="pith-icon" data-command="read" title="听读本章" aria-label="听读本章">🎧</button><button class="pith-icon" data-command="typography" title="阅读排版" aria-label="阅读排版" aria-expanded="false">Aa</button><button class="pith-icon pith-guide-toggle" title="切换向导栏" aria-label="切换向导栏" aria-pressed="false"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"></circle><path d="M9.5 9a2.5 2.5 0 1 1 4 2c-1 .7-1.5 1.2-1.5 2.5M12 17h.01"></path></svg></button></header><div class="pith-speech-controls"></div><div class="pith-typography-popover" hidden><fieldset><legend>字号</legend><button data-size="15" aria-pressed="false">小</button><button data-size="17" aria-pressed="true">标准</button><button data-size="20" aria-pressed="false">大</button></fieldset><fieldset data-page-modes><legend>版式</legend><button data-mode="single" aria-pressed="true">单栏</button><button data-mode="double" aria-pressed="false">双栏</button><button data-mode="triple" aria-pressed="false">三栏</button></fieldset></div></div><div class="pith-layout pith-guide-closed"><section class="pith-stage"><div class="pith-reader" tabindex="0"><article class="pith-article"></article></div><aside class="pith-left-drawer" hidden></aside><div class="pith-toast-tip" role="status" hidden></div></section></div><div class="pith-selection" hidden><button data-selection="highlight">高亮</button><button data-selection="note">记笔记</button><button data-selection="ask">问向导</button><button data-selection="copy">复制</button></div>`;
    const required = <T extends HTMLElement>(selector: string): T => { const node = root.querySelector<T>(selector); if (!node) throw new Error(`Missing ${selector}`); return node; };
    const header = required<HTMLElement>(".pith-view-header");
    for (const [command, label, icon, enabled] of [["import", "导入材料", "+", Boolean(actions.importMaterial)], ["settings", "设置", "⚙", Boolean(actions.openSettings)]] as const) {
      if (!enabled) continue;
      const button = this.doc.createElement("button"); button.className = "pith-icon"; button.dataset.command = command; button.title = label; button.setAttribute("aria-label", label); button.textContent = icon; header.append(button);
    }
    this.reader = required(".pith-reader"); this.article = required(".pith-article"); this.navigation = required(".pith-left-drawer"); this.guide = this.doc.createElement("aside"); this.guide.className = "pith-guide"; this.guide.hidden = true; this.layout = required(".pith-layout"); this.dock = required(".pith-bottom-dock"); this.toast = required(".pith-toast-tip"); this.popover = required(".pith-selection"); this.navigationButton = required(".pith-nav-toggle"); this.guideButton = required(".pith-guide-toggle");
    this.dock.append(required(".pith-typography-popover"));
    this.mediaDeck = this.doc.createElement("section"); this.mediaDeck.className = "pith-media-deck"; this.mediaDeck.hidden = true; this.mediaDeck.setAttribute("aria-label", "音频播放控制");
    this.assetControls = this.doc.createElement("div"); this.assetControls.className = "pith-asset-controls"; this.assetControls.hidden = true;
    this.assetControls.innerHTML = '<button data-media="play" aria-label="播放">▶</button><span data-media-time>00:00 / 00:00</span><input class="pith-media-seek" type="range" min="0" max="0" value="0" step="0.1" aria-label="播放进度"><button data-media="back" aria-label="后退15秒">↺15</button><button data-media="forward" aria-label="前进15秒">15↻</button><button data-media="rate" aria-label="播放倍速">1.0x</button><button data-media="loop" aria-label="设置循环区间">A-B</button><button data-media="close" aria-label="关闭播放控制">✕</button>';
    this.mediaDeck.append(this.assetControls, required(".pith-speech-controls")); required(".pith-stage").append(this.mediaDeck);
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
    this.assetControls.addEventListener("input", event => { const input = event.target as HTMLInputElement; if (input.classList.contains("pith-media-seek") && this.assetAudio) this.assetAudio.currentTime = Number(input.value); }, options);
    this.mediaDeck.addEventListener("input", event => { const input = event.target as HTMLInputElement; if (input.hasAttribute("data-speech-seek") && this.speechAudio) this.speechAudio.currentTime = Number(input.value); }, options);
  }

  render(document: ObsidianReaderDocument): void {
    this.closeInlineDojo();
    this.dojoVersion++; this.dojoTarget = ""; this.dojoAnchor = undefined; this.dojoResult = null; this.dojoStatus = ""; this.dojo.hidden = true; this.setDojoActive(false);
    this.voice.cancel();
    if (this.interline) this.interline.dispose(); this.interline = null; this.interlineMode = "original";
    this.readerPosition = null;
    this.currentFile = document.currentFile;
    this.setToolkits(this.configuredToolkits);
    this.paged = document.format ? ["epub", "pdf", "cbz"].includes(document.format) : /\.(epub|pdf|cbz)$/i.test(document.currentFile);
    this.stopSpeech(); this.selectionRange = null; this.popover.hidden = true;
    this.clearAudioAsset();
    const title = this.root.querySelector(".pith-title"); if (title) title.textContent = document.title;
    this.article.innerHTML = document.html;
    this.adaptEpubColors();
    if (this.actions.prepareInterline) this.interline = new InterlineView(this.reader, this.article, this.actions.prepareInterline, change => { if (this.speaking) this.stopSpeech(); preserveInterlinePosition(this.reader, this.article, this.paged, () => { change(); this.markExisting(); }, position => this.applyPageMode(position), captureReaderPosition, proseTextNodes); }, message => this.tip(message), proseTextNodes);
    this.navigation.replaceChildren();
    const group = (label: string): void => { const heading = this.doc.createElement("h2"); heading.textContent = label; this.navigation.append(heading); };
    group("材料"); for (const file of document.files) { const button = this.doc.createElement("button"); button.textContent = file.name; button.dataset.file = file.name; button.setAttribute("aria-current", String(file.name === document.currentFile)); this.navigation.append(button); }
    group("目录"); renderTocTree(this.navigation, document.sections, locator => { this.closeNavigation(); const target = resolveReaderLocator(this.article, locator); if (target) { if (this.speechResult) this.stopSpeech(); navigateReaderTarget(this.reader, target, this.paged); if (this.paged) { this.readerPosition = captureReaderPosition(this.reader, this.article); this.updatePageCount(); } } else this.tip("无法定位书内目标"); });
    this.closeNavigation();
    this.markExisting(); this.applyPageMode();
    const active = this.doc.activeElement;
    if (this.root.isConnected && active && (active === this.doc.body || this.root.contains(active)) && !active.closest("input,textarea,select,button,[contenteditable]:not([contenteditable=false]),.pith-guide,.pith-left-drawer")) this.reader.focus({ preventScroll: true });
    const asset = document.files.find(file => audioContentType({ name: file.name, mimeType: file.mimeType ?? "" }));
    if (asset && this.actions.loadAudio) { const generation = this.assetGeneration; const load = this.actions.loadAudio; void load(asset.name).then(bytes => { if (this.disposed || generation !== this.assetGeneration) return; const type = audioContentType({ name: asset.name, mimeType: asset.mimeType ?? "" }); if (!type) return; this.assetUrl = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type })); const audio = this.doc.createElement("audio"); this.assetAudio = audio; audio.src = this.assetUrl; audio.playbackRate = this.speechRate; audio.addEventListener("timeupdate", () => this.updateAssetControls()); audio.addEventListener("loadedmetadata", () => this.updateAssetControls()); audio.addEventListener("play", () => this.updateAssetControls()); audio.addEventListener("pause", () => this.updateAssetControls()); audio.addEventListener("error", () => this.tip("音频播放失败")); this.assetControls.hidden = false; this.mediaDeck.hidden = false; this.updateAssetControls(); }).catch(error => { if (!this.disposed && generation === this.assetGeneration) this.tip(error instanceof Error ? error.message : String(error)); }); }
  }

  guideElement(): HTMLElement { return this.guide; }
  focusQuotedGuide(): void { if (this.pendingAnchor) { const input = this.guide.querySelector<HTMLTextAreaElement>("textarea"); if (input) input.focus(); } }
  setGuideVisible(visible: boolean): void { if (!visible) this.voice.cancel("guide"); this.guide.hidden = !visible; this.guideButton.setAttribute("aria-pressed", String(visible)); if (this.guide.parentElement === this.layout) this.layout.classList.toggle("pith-guide-closed", !visible); }
  setGuideAvailable(available: boolean): void { this.guideButton.hidden = !available; if (!available) this.setGuideVisible(false); }
  setDojoActive(active: boolean): void { this.dojoActive = active; this.dock.classList.toggle("active", active || this.speaking); }
  setToolkits(toolkits: readonly string[]): void { this.configuredToolkits = toolkits; const previous = this.dojoId; const slot = toolkitSlot(effectiveToolkits(toolkits, this.currentFile), previous, Object.fromEntries(this.dojos.map(item => [item.id, item.label]))); if (!slot.ids.includes("interline") && this.interline && this.interlineMode !== "original") { this.interlineMode = "original"; this.interline.setMode("original"); } this.mountedToolkits = slot.ids; this.dojoId = slot.active; if (previous && !slot.ids.includes(previous)) { this.closeInlineDojo(); this.dojo.hidden = true; } const button = this.dock.querySelector<HTMLButtonElement>("#open-dojo"); if (!button) return; button.hidden = !slot.ids.length; button.textContent = slot.text; button.classList.toggle("pith-dojo-add", !slot.ids.length); button.title = "打开实训工具"; button.setAttribute("aria-label", button.title); }
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
  dispose(): void { this.disposed = true; this.voice.cancel(); if (this.interline) this.interline.dispose(); this.stopSpeech(); this.clearAudioAsset(); this.events.abort(); if (this.resizeObserver) this.resizeObserver.disconnect(); if (this.themeObserver) this.themeObserver.disconnect(); if (activeReader.get(this.doc) === this) activeReader.delete(this.doc); if (this.toastTimer !== undefined) this.win.clearTimeout(this.toastTimer); this.guide.remove(); this.root.replaceChildren(); this.root.classList.remove("pith-view"); }

  private clearAudioAsset(): void { this.assetGeneration++; if (this.assetAudio) { this.assetAudio.pause(); this.assetAudio.removeAttribute("src"); this.assetAudio.load(); this.assetAudio = null; } if (this.assetUrl) URL.revokeObjectURL(this.assetUrl); this.assetUrl = null; this.loopStart = null; this.loopEnd = null; this.assetControls.hidden = true; this.mediaDeck.hidden = !this.speaking; }
  private updateAssetControls(): void { const audio = this.assetAudio; if (!audio) return; if (this.loopStart !== null && this.loopEnd !== null && audio.currentTime >= this.loopEnd) audio.currentTime = this.loopStart; const format = (value: number): string => { const n = Number.isFinite(value) ? Math.floor(value) : 0; return `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`; }; const time = this.assetControls.querySelector<HTMLElement>("[data-media-time]"); if (time) time.textContent = `${format(audio.currentTime)} / ${format(audio.duration)}`; const seek = this.assetControls.querySelector<HTMLInputElement>(".pith-media-seek"); if (seek) { seek.max = String(Number.isFinite(audio.duration) ? audio.duration : 0); seek.value = String(audio.currentTime); } const play = this.assetControls.querySelector<HTMLButtonElement>('[data-media="play"]'); if (play) { play.textContent = audio.paused ? "▶" : "⏸"; play.setAttribute("aria-label", audio.paused ? "播放" : "暂停"); } const cues = Array.from(this.article.querySelectorAll<HTMLElement>('.pith-cue[data-locator^="time:"]')); for (let i = 0; i < cues.length; i++) { const cue = cues[i]!; const start = Number(cue.dataset.locator!.slice(5)), end = cue.dataset.endSec !== undefined ? Number(cue.dataset.endSec) : cues[i + 1] ? Number(cues[i + 1]!.dataset.locator!.slice(5)) : Infinity; cue.classList.toggle("pith-speech-active", audio.currentTime >= start && audio.currentTime < end); } }

  private applyPageMode(position: ReaderPosition | null = null): void { const decision = resolveResponsiveLayout({ width: this.root.clientWidth, height: this.root.clientHeight, readerWidthPx: this.reader.clientWidth, guideOpen: false, preferredColumns: this.pageMode, coarsePointer: typeof this.win.matchMedia === "function" && this.win.matchMedia("(pointer: coarse)").matches }); this.root.dataset.formFactor = decision.formFactor; this.root.dataset.sheetMode = decision.sheetMode; this.root.dataset.hitTarget = String(decision.hitTargetPx); const double = this.root.querySelector<HTMLButtonElement>('[data-mode="double"]'), triple = this.root.querySelector<HTMLButtonElement>('[data-mode="triple"]'); if (double) double.disabled = decision.maxColumns < 2; if (triple) triple.disabled = decision.maxColumns < 3; const controls = this.root.querySelector<HTMLElement>("[data-pages]"); if (controls) controls.hidden = !this.paged; const modes = this.root.querySelector<HTMLElement>("[data-page-modes]"); if (modes) modes.hidden = !this.paged; this.reader.classList.toggle("pith-paged", this.paged); if (this.paged) { applyPaginationStyles(this.reader, this.article, decision.effectiveColumns === 3 ? "triple" : decision.effectiveColumns === 2 ? "double" : "single", this.mediaLoaded); restoreReaderPosition(this.reader, this.article, position); this.restoredScrollLeft = position ? this.reader.scrollLeft : null; this.readerPosition = position ?? captureReaderPosition(this.reader, this.article); this.updatePageCount(); } else { for (const property of ["box-sizing", "width", "height", "padding", "column-width", "column-gap", "column-fill", "--pith-page-height"]) this.article.style.removeProperty(property); this.reader.style.removeProperty("overflow-x"); this.reader.style.removeProperty("overflow-y"); } if (this.interline) this.interline.activate(); }
  private markExisting(): void { for (const mark of this.article.querySelectorAll("mark[data-pith-note]")) mark.replaceWith(...mark.childNodes); this.article.normalize(); for (const note of this.guideData.notes) { const anchor = note.anchor; if (note.kind === "practice" || !anchor || anchor.file !== this.currentFile || !anchor.quote) continue; const walker = this.doc.createTreeWalker(this.article, 4); const nodes: { node: Text; start: number }[] = []; let node: Node | null, text = ""; while ((node = walker.nextNode())) { const part = node as Text; if (part.parentElement && part.parentElement.closest(".pith-interline-subtitle,.pith-inline-dojo,[data-dojo-display]")) continue; nodes.push({ node: part, start: text.length }); text += part.data; } const match = matchTextAnchor(text, anchor); if (!match) continue; for (const part of nodes) { const start = Math.max(0, match.startOffset - part.start), end = Math.min(part.node.length, match.endOffset - part.start); if (start >= end) continue; const range = this.doc.createRange(); range.setStart(part.node, start); range.setEnd(part.node, end); const mark = this.doc.createElement("mark"); mark.dataset.pithNote = note.id; range.surroundContents(mark); } } }
  async refreshGuide(): Promise<void> { if (!this.actions.guideData || this.disposed) return; const generation = ++this.guideGeneration; const data = await this.actions.guideData(); if (this.disposed || generation !== this.guideGeneration) return; const position = this.readerPosition; this.guideData = data; this.setToolkits(data.toolkits); this.renderGuide(); this.markExisting(); if (this.paged && position) { restoreReaderPosition(this.reader, this.article, position); this.readerPosition = captureReaderPosition(this.reader, this.article); } }
  quoteSelection(anchor: SelectionAnchor, tab: "chat" | "notes"): void { this.pendingAnchor = anchor; this.guideTab = tab; this.setGuideVisible(true); if (this.actions.guideVisibilityChanged) this.actions.guideVisibilityChanged(true); this.renderGuide(); this.guide.querySelector<HTMLTextAreaElement>("textarea")?.focus(); }
  private renderGuide(): void {
    this.voice.cancel("guide");
    const escape = (s: string): string => s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
    this.guide.innerHTML = `<div class="pith-guide-tabs"><button data-guide-tab="chat" aria-pressed="${this.guideTab === "chat"}">对话</button><button data-guide-tab="notes" aria-pressed="${this.guideTab === "notes"}">笔记 ${this.guideData.notes.length}</button></div><div class="pith-guide-content">${this.guideTab === "chat" ? this.guideData.conversation.map(entry => `<p><strong>${entry.role === "user" ? "你" : "向导"}</strong><br>${escape(displayPracticeMessage(entry.text))}</p>${(entry.choices ?? []).map(choice => `<button data-guide-prompt="${escape(choice)}">${escape(choice)}</button>`).join("")}`).join("") + this.guideData.actions.map(action => `<button data-guide-prompt="${escape(action.prompt)}">${escape(action.label)}</button>`).join("") : this.guideData.notes.map(note => note.anchor ? `<button class="pith-note-source" data-note-id="${escape(note.id)}" title="跳回原文"><strong>${escape(note.kind)}</strong><br>${escape(note.body)}</button>` : `<p><strong>${escape(note.kind)}</strong><br>${escape(note.body)}</p>`).join("")}</div><div class="pith-guide-compose"><blockquote>${this.pendingAnchor && this.pendingAnchor.quote ? escape(this.pendingAnchor.quote) : ""}</blockquote><textarea aria-label="消息"></textarea><button type="button" data-voice="guide" aria-pressed="false">🎙️ 语音输入</button><div data-guide-error role="alert"></div><button data-guide-send>发送</button></div>`;
  }
  openDojo(dojos: readonly DojoToolkitDescriptor[], text?: string, anchor?: SelectionAnchor): void {
    this.dojos = dojos;
    const mounted = dojos.filter(item => this.mountedToolkits.includes(item.id));
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
  private closeInlineDojo(): void {
    this.popover.hidden = true;
    this.readDojo();
    this.dojoVersion++; this.voice.cancel("dojo");
    if (this.dojoSource && this.dojoBlock) { const source = this.dojoSource; this.preserveMovedSelection(source, () => source.replaceWith(...Array.from(source.childNodes))); }
    this.dojoDisplay?.remove(); this.inlineDojo?.remove();
    this.inlineDojo = null; this.dojoBlock = null; this.dojoSource = null; this.dojoDisplay = null;
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
    if (toolkit.id === "interline") { this.dojo.hidden = false; this.dojo.innerHTML = `<strong>行间双语</strong><div class="pith-interline-modes" role="group" aria-label="行间双语模式">${([["original", "原文"], ["bilingual", "行间双语"], ["subtitle-primary", "译文主显"]] as const).map(([mode, label]) => `<button data-interline-mode="${mode}" aria-pressed="${this.interlineMode === mode}">${label}</button>`).join("")}</div>`; return; }
    this.dojo.hidden = true;
    if (!this.inlineDojo && !this.mountInlineDojo()) return;
    if (!toolkit.stages.includes(this.dojoStage)) this.dojoStage = toolkit.stages[0]!;
    const esc = (s: string): string => s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
    const labels: Record<DojoScaffoldStage, string> = { "listen-decompose": "意群拆解", "guided-follow": "原文", "scaffold-cloze": "骨干词", "blind-produce": "盲听诊断" };
    const inline = this.inlineDojo!, source = this.dojoSource!, display = this.dojoDisplay!;
    inline.dataset.dojo = toolkit.id;
    const showOriginal = this.dojoReveal || (toolkit.id === "shadowing" && this.dojoStage === "guided-follow" && !this.dojoResult);
    source.hidden = !showOriginal;
    display.hidden = showOriginal;
    display.innerHTML = this.dojoResult && toolkit.evalMode === "deterministic" ? renderDojoAlignment(this.dojoTarget, this.dojoResult.matchedTokens) : esc(toolkit.transformCue(this.dojoTarget, this.dojoStage));
    inline.innerHTML = `<strong>${esc(toolkit.label)}</strong><button data-dojo-close aria-label="收起">×</button>${toolkit.evalMode === "guide-rubric" ? `<button data-dojo-reveal>${this.dojoReveal ? "合上原文" : "查看原文"}</button>` : `<div>${toolkit.stages.map(stage => `<button data-dojo-stage="${stage}" aria-pressed="${stage === this.dojoStage}">${labels[stage]}</button>`).join("")}</div>`}<label>复述文本<textarea data-dojo-produced>${esc(this.dojoProduced)}</textarea></label><button type="button" data-voice="dojo" aria-pressed="false">🎙️ 语音输入</button>${toolkit.evalMode === "guide-rubric" ? '<button data-dojo-submit>提交复述并请向导追问</button>' : `<button data-dojo-diagnose>对齐漏词</button><button data-dojo-save ${this.dojoResult ? "" : "disabled"}>记入实训账本</button>`}<div role="status">${esc(this.dojoStatus)}</div>`;
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
    const prose = target.closest<HTMLElement>('[data-prose="true"]');
    if (!button && prose && prose !== this.dojoBlock && this.article.contains(prose) && this.mountedToolkits.some(id => id === "shadowing" || id === "feynman")) { const selection = this.win.getSelection(); if (selection && !selection.isCollapsed) return; this.requestedDojoBlock = prose; const range = this.doc.createRange(); range.selectNodeContents(this.article); range.setEndBefore(prose); this.actions.openDojo(proseTextNodes(prose).map(node => node.data).join("").trim(), prose.dataset.locator || `text:offset:${range.toString().length}`); return; }
    if (!button) return;
    if (!this.root.contains(button) && !this.guide.contains(button)) return;
    if (button.dataset.voice) { void this.voice.toggle(button.dataset.voice); return; }
    if ((button.dataset.interlineMode === "original" || button.dataset.interlineMode === "bilingual" || button.dataset.interlineMode === "subtitle-primary") && this.dojo.contains(button)) { this.interlineMode = button.dataset.interlineMode; if (this.interline) this.interline.setMode(this.interlineMode); else this.tip("行间双语不可用"); this.renderDojo(); return; }
    if (this.paged && (button.dataset.media === "close" || button.dataset.command === "read" || button.dataset.command === "speech-close")) this.readerPosition = captureReaderPosition(this.reader, this.article);
    if (button.dataset.media && this.assetAudio) { const audio = this.assetAudio; if (button.dataset.media === "play") { try { if (audio.paused) { this.stopSpeech(); await audio.play(); } else audio.pause(); } catch (error) { this.tip(error instanceof Error ? error.message : String(error)); } } else if (button.dataset.media === "back") audio.currentTime = Math.max(0, audio.currentTime - 15); else if (button.dataset.media === "forward") audio.currentTime = Math.min(Number.isFinite(audio.duration) ? audio.duration : audio.currentTime + 15, audio.currentTime + 15); else if (button.dataset.media === "rate") { const rates = [.75, 1, 1.25, 1.5, 2]; this.speechRate = rates[(rates.indexOf(this.speechRate) + 1) % rates.length]!; audio.playbackRate = this.speechRate; button.textContent = `${this.speechRate.toFixed(2).replace(/0$/, "")}x`; } else if (button.dataset.media === "loop") { if (this.loopStart === null || this.loopEnd !== null) { this.loopStart = audio.currentTime; this.loopEnd = null; button.textContent = "A…"; } else if (audio.currentTime > this.loopStart) { this.loopEnd = audio.currentTime; button.textContent = "A-B ✓"; } } else if (button.dataset.media === "close") { audio.pause(); this.mediaDeck.hidden = true; } this.updateAssetControls(); return; }
    if (button.dataset.command === "typography") { const menu = this.root.querySelector<HTMLElement>(".pith-typography-popover")!; menu.hidden = !menu.hidden; button.setAttribute("aria-expanded", String(!menu.hidden)); return; }
    if (button.dataset.size) { const position = this.paged ? captureReaderPosition(this.reader, this.article) : null; this.article.style.setProperty("--pith-reader-size", `${button.dataset.size}px`); if (this.paged) { this.applyPageMode(position); this.readerPosition = captureReaderPosition(this.reader, this.article); } for (const item of this.root.querySelectorAll<HTMLButtonElement>("[data-size]")) item.setAttribute("aria-pressed", String(item === button)); return; }
    if (button.dataset.mode === "single" || button.dataset.mode === "double" || button.dataset.mode === "triple") { const position = captureReaderPosition(this.reader, this.article); this.pageMode = button.dataset.mode; this.applyPageMode(position); this.readerPosition = captureReaderPosition(this.reader, this.article); for (const item of this.root.querySelectorAll<HTMLButtonElement>("[data-mode]")) item.setAttribute("aria-pressed", String(item === button)); return; }
    if (button.dataset.page) { this.turnPage(button.dataset.page === "previous" ? -1 : 1); return; }
    if (button.dataset.dojoChoose) { const id = button.dataset.dojoChoose; if (!this.mountedToolkits.includes(id) || !this.dojos.some(item => item.id === id)) return; this.closeInlineDojo(); this.dojoResult = null; this.dojoStatus = ""; this.dojoId = id; this.renderDojo(); return; }
    if (button.hasAttribute("data-dojo-close")) { this.closeInlineDojo(); return; }
    if (button.hasAttribute("data-dojo-reveal")) { this.readDojo(); this.dojoReveal = !this.dojoReveal; this.renderDojo(); return; }
    if (button.dataset.noteId) { const note = this.guideData.notes.find(item => item.id === button.dataset.noteId); if (!note || !note.anchor) return; try { const anchor = note.anchor; if (anchor.file !== this.currentFile) await this.actions.openFile(anchor.file); const mark = Array.from(this.article.querySelectorAll<HTMLElement>("mark[data-pith-note]")).find(item => item.dataset.pithNote === note.id); const target = mark || Array.from(this.article.querySelectorAll<HTMLElement>("[data-locator]")).find(item => item.dataset.locator === anchor.locator); if (target) target.scrollIntoView({ block: "center" }); else this.tip("无法定位原文"); } catch (error) { this.tip(error instanceof Error ? error.message : String(error)); } return; }
    if (button.dataset.guideTab === "chat" || button.dataset.guideTab === "notes") { this.guideTab = button.dataset.guideTab; this.renderGuide(); return; }
    if (button.dataset.guidePrompt) { const input = this.guide.querySelector<HTMLTextAreaElement>("textarea"); if (input) { input.value = button.dataset.guidePrompt; input.focus(); } return; }
    if (button.hasAttribute("data-guide-send")) { const input = this.guide.querySelector<HTMLTextAreaElement>("textarea"), errorBox = this.guide.querySelector<HTMLElement>("[data-guide-error]"); if (!input || !input.value.trim() || !this.actions.sendGuide) return; if (errorBox) errorBox.textContent = ""; button.disabled = true; try { await this.actions.sendGuide(input.value.trim(), this.pendingAnchor, this.guideTab === "notes"); this.pendingAnchor = undefined; await this.refreshGuide(); } catch (error) { if (errorBox && errorBox.isConnected) errorBox.textContent = error instanceof Error ? error.message : String(error); if (button.isConnected) button.disabled = false; } return; }
    if (button.dataset.dojoStage || button.hasAttribute("data-dojo-diagnose") || button.hasAttribute("data-dojo-save") || button.hasAttribute("data-dojo-submit")) {
      try {
        this.readDojo(); const toolkit = this.dojos.find(item => item.id === this.dojoId); if (!toolkit) throw new Error("工坊不可用");
        if (button.dataset.dojoStage) { this.dojoStage = button.dataset.dojoStage as DojoScaffoldStage; this.dojoVersion++; this.dojoResult = null; this.dojoStatus = ""; this.renderDojo(); return; }
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
    if (button.dataset.command === "pause") { const audio = this.speechAudio; if (!audio) return; if (audio.paused) { const generation = this.generation; button.disabled = true; try { await audio.play(); if (generation === this.generation && audio === this.speechAudio) { button.disabled = false; button.textContent = "暂停"; } } catch (error) { if (generation === this.generation) this.finishSpeech(error); } } else { audio.pause(); button.textContent = "继续"; } }
    else if (button.dataset.command === "speed") { const rates = [.75, 1, 1.25, 1.5, 2]; this.speechRate = rates[(rates.indexOf(this.speechRate) + 1) % rates.length]!; if (this.speechAudio) this.speechAudio.playbackRate = this.speechRate; button.textContent = `语速 ${this.speechRate.toFixed(2).replace(/0$/, "")}x`; }
    else if ((button.dataset.command === "speech-back" || button.dataset.command === "speech-forward") && this.speechAudio) { const audio = this.speechAudio; const offset = button.dataset.command === "speech-back" ? -15 : 15; audio.currentTime = Math.max(0, Math.min(Number.isFinite(audio.duration) ? audio.duration : audio.currentTime + 15, audio.currentTime + offset)); }
    else if (button.dataset.command === "speech-loop" && this.speechAudio) { if (this.speechLoopStart === null || this.speechLoopEnd !== null) { this.speechLoopStart = this.speechAudio.currentTime; this.speechLoopEnd = null; button.textContent = "A…"; } else if (this.speechAudio.currentTime > this.speechLoopStart) { this.speechLoopEnd = this.speechAudio.currentTime; button.textContent = "A-B ✓"; } }
    else if (button.dataset.command === "speech-close") this.stopSpeech();
    else if (button.dataset.command === "speech-follow") { const active = this.article.querySelector<HTMLElement>(".pith-speech-active"); if (active) active.scrollIntoView({ block: "center", inline: "center" }); }
    else if (button.dataset.command === "home") { this.voice.cancel(); if (this.actions.home) { try { await this.actions.home(); } catch (error) { this.tip(error instanceof Error ? error.message : String(error)); } } }
    else if (button.dataset.command === "settings" && this.actions.openSettings) this.actions.openSettings();
    else if (button.dataset.command === "import" && this.actions.importMaterial) this.actions.importMaterial();
    else if (button === this.navigationButton) { this.navigation.hidden = !this.navigation.hidden; button.setAttribute("aria-expanded", String(!this.navigation.hidden)); if (!this.navigation.hidden) updateTocLocation(this.navigation, this.article, this.reader, this.paged); }
    else if (button === this.guideButton) { const visible = this.guide.hidden; this.setGuideVisible(visible); if (this.actions.guideVisibilityChanged) this.actions.guideVisibilityChanged(visible); }
    else if (button.dataset.file) { this.closeNavigation(); try { await this.actions.openFile(button.dataset.file); } catch (error) { this.tip(error instanceof Error ? error.message : String(error)); } }
    else if (button.dataset.locator) { this.closeNavigation(); const heading = Array.from(this.article.querySelectorAll<HTMLElement>("[data-locator]")).find(node => node.dataset.locator === button.dataset.locator); if (heading) heading.scrollIntoView({ block: "start" }); }
    else if (button.dataset.command === "dojo") { const range = this.selectionRange; if (this.dojo.hidden && range && !range.collapsed && this.article.contains(range.startContainer)) { const prefix = this.doc.createRange(); prefix.selectNodeContents(this.article); prefix.setEnd(range.startContainer, range.startOffset); this.requestedDojoBlock = (range.startContainer.parentElement?.closest<HTMLElement>('[data-prose="true"],.pith-cue') ?? null); this.actions.openDojo(range.toString(), `text:offset:${prefix.toString().length}`); } else this.actions.openDojo(); }
    else if (button.dataset.command === "read") { if (this.speaking) this.stopSpeech(); else if (this.assetAudio && this.mediaDeck.hidden) this.mediaDeck.hidden = false; else this.startSpeech(); }
    else if (button.dataset.selection && this.selectionRange) { if (button.dataset.selection === "copy") { try { await this.win.navigator.clipboard.writeText(this.selectionRange.toString()); } catch { this.tip("复制失败"); } } else if (button.dataset.selection === "highlight" || button.dataset.selection === "note" || button.dataset.selection === "ask") { const prefix = this.doc.createRange(); prefix.selectNodeContents(this.article); prefix.setEnd(this.selectionRange.startContainer, this.selectionRange.startOffset); this.actions.selection(button.dataset.selection, this.selectionRange.toString(), `text:offset:${prefix.toString().length}`); } this.popover.hidden = true; }
  }
  private showSelection(): void {
    const selection = this.win.getSelection(); if (!selection || selection.isCollapsed || !selection.toString().trim() || !selection.anchorNode || !selection.focusNode || !this.article.contains(selection.anchorNode) || !this.article.contains(selection.focusNode)) { this.popover.hidden = true; return; }
    this.selectionRange = selection.getRangeAt(0).cloneRange(); const rect = this.selectionRange.getBoundingClientRect(); this.popover.hidden = false; for (const item of this.popover.querySelectorAll<HTMLButtonElement>("button")) item.hidden = false; this.popover.style.left = `${Math.max(8, Math.min(this.win.innerWidth - this.popover.offsetWidth - 8, rect.left))}px`; this.popover.style.top = `${Math.max(8, rect.top - this.popover.offsetHeight - 8)}px`;
  }
  private clearSpeechMark(): void { for (const mark of this.article.querySelectorAll('[data-speech-active="true"]')) { const parent = mark.parentNode; mark.replaceWith(...mark.childNodes); if (parent) parent.normalize(); } }
  private stopSpeech(): void { this.generation++; if (this.speechAbort) this.speechAbort.abort(); this.speechAbort = null; if (this.speechAudio) { this.speechAudio.pause(); this.speechAudio.removeAttribute("src"); this.speechAudio.load(); this.speechAudio = null; } if (this.speechUrl) URL.revokeObjectURL(this.speechUrl); this.speechUrl = null; this.speaking = false; this.speechResult = false; this.clearSpeechMark(); this.dock.classList.toggle("active", this.dojoActive); for (const item of this.mediaDeck.querySelectorAll("[data-speech-control]")) item.remove(); this.assetControls.hidden = !this.assetAudio; this.mediaDeck.hidden = !this.assetAudio; const button = this.dock.querySelector("[data-command=read]"); if (button) button.textContent = "🎧"; }
  private finishSpeech(error?: unknown): void {
    this.stopSpeech(); this.speechResult = true; this.mediaDeck.hidden = false;
    const controls = this.mediaDeck.querySelector<HTMLElement>(".pith-speech-controls"); if (!controls) return;
    const status = this.doc.createElement("span"); status.dataset.speechControl = ""; status.setAttribute("role", error === undefined ? "status" : "alert"); status.textContent = error === undefined ? "本章听读完成" : `听读失败：${error instanceof Error ? error.message : String(error)}`; controls.append(status);
    if (error !== undefined && this.actions.openSettings) { const settings = this.doc.createElement("button"); settings.dataset.speechControl = ""; settings.textContent = "配置语音"; settings.onclick = () => { this.stopSpeech(); this.actions.openSettings!(); }; controls.append(settings); }
    const close = this.doc.createElement("button"); close.dataset.speechControl = ""; close.dataset.command = "speech-close"; close.setAttribute("aria-label", "关闭听读"); close.textContent = "✕"; controls.append(close);
  }
  private startSpeech(): void {
    const synthesize = this.actions.synthesizeSpeech;
    const chapter = this.paged ? speechPageChapter(this.article, this.reader) : speechChapterRoot(this.article, this.reader, null, false); if (!chapter) { this.tip("当前页面没有可朗读的正文段落"); return; }
    this.stopSpeech(); const queue: { block: Element; start: number; end: number; text: string }[] = []; const segmenter = new Intl.Segmenter(undefined, { granularity: "sentence" });
    for (const block of chapter.querySelectorAll("[data-prose=true]")) for (const part of segmenter.segment(proseTextNodes(block).map(node => node.data).join(""))) { const text = part.segment.trim(); if (/[\p{L}\p{N}]/u.test(text)) { const start = part.index + part.segment.length - part.segment.trimStart().length; queue.push({ block, start, end: start + text.length, text }); } }
    let index = 0; if (!queue.length) { this.tip("当前页面没有可朗读的正文段落"); return; }
    if (!synthesize) { this.finishSpeech(new Error("未连接可用的语音服务，请先启动本地语音服务或在设置中配置云端 TTS")); return; }
    if (this.assetAudio) this.assetAudio.pause(); for (const cue of this.article.querySelectorAll(".pith-cue.pith-speech-active")) cue.classList.remove("pith-speech-active"); this.assetControls.hidden = true; this.mediaDeck.hidden = false; this.speaking = true; const generation = ++this.generation; this.dock.classList.add("active"); const controls = this.mediaDeck.querySelector(".pith-speech-controls"); if (controls) controls.innerHTML = `<button data-speech-control data-command="pause" disabled>暂停</button><span data-speech-control data-speech-time>00:00 / 00:00</span><input data-speech-control data-speech-seek class="pith-media-seek" type="range" min="0" max="0" value="0" step="0.1" aria-label="当前句播放进度"><button data-speech-control data-command="speech-back" aria-label="后退15秒">↺15</button><button data-speech-control data-command="speech-forward" aria-label="前进15秒">15↻</button><button data-speech-control data-command="speed">语速 ${this.speechRate.toFixed(2).replace(/0$/, "")}x</button><button data-speech-control data-command="speech-loop">A-B</button><button data-speech-control data-command="speech-follow">跳回朗读处</button><button data-speech-control data-command="speech-close" aria-label="关闭听读">✕</button><span data-speech-control role="status"></span>`;
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
        const player = this.doc.createElement("audio"); this.speechAudio = player; this.speechLoopStart = null; this.speechLoopEnd = null; player.src = this.speechUrl; player.playbackRate = this.speechRate; player.ontimeupdate = player.onloadedmetadata = () => { if (this.speechLoopStart !== null && this.speechLoopEnd !== null && player.currentTime >= this.speechLoopEnd) player.currentTime = this.speechLoopStart; const format = (v: number): string => { const n = Number.isFinite(v) ? Math.floor(v) : 0; return `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`; }; const time = this.mediaDeck.querySelector<HTMLElement>("[data-speech-time]"); if (time) time.textContent = `${format(player.currentTime)} / ${format(player.duration)}`; const seek = this.mediaDeck.querySelector<HTMLInputElement>("[data-speech-seek]"); if (seek) { seek.max = String(Number.isFinite(player.duration) ? player.duration : 0); seek.value = String(player.currentTime); } }; const pause = this.mediaDeck.querySelector<HTMLButtonElement>('[data-command="pause"]'); if (pause) { pause.disabled = true; pause.textContent = "暂停"; } const progress = this.mediaDeck.querySelector<HTMLElement>('[data-speech-control][role="status"]'); if (progress) progress.textContent = `${index} / ${queue.length}`;
        await new Promise<void>((resolve, reject) => { player.onended = () => resolve(); player.onerror = () => reject(new Error("音频播放失败")); signal.addEventListener("abort", () => resolve(), { once: true }); void player.play().then(() => { if (generation === this.generation && this.speechAudio === player && pause) pause.disabled = false; }, reject); });
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
