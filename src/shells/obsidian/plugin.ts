export interface ObsidianAgentConfig {
  readonly agentId: "" | "dsh" | "claude" | "codex";
  readonly model: string;
  readonly effort: string;
  readonly persona: "sanctuary" | "studio";
}

export const obsidianStyles = `
.pith-view{position:relative;height:100%;display:flex;flex-direction:column;background:var(--background-primary);color:var(--text-normal);font-family:var(--font-interface)}
.pith-view *{box-sizing:border-box}.pith-view [hidden]{display:none!important}
.pith-view-header{display:flex;align-items:center;gap:12px;padding:8px;border-bottom:1px solid var(--background-modifier-border)}
.pith-view-header .pith-guide-toggle{margin-left:auto}.pith-view button{color:var(--text-normal);font:inherit;cursor:pointer}.pith-icon{border:0;background:none;padding:8px}.pith-icon:hover{background:var(--background-modifier-hover)}.pith-icon svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.7}
.pith-layout{display:grid;grid-template-columns:minmax(0,1fr) 320px;flex:1;min-height:0}.pith-layout.pith-guide-closed{grid-template-columns:minmax(0,1fr)}.pith-stage{position:relative;min-width:0;min-height:0}.pith-reader{height:100%;overflow:auto;overscroll-behavior:contain}.pith-article{max-width:850px;margin:auto;padding:32px 48px 120px;line-height:1.9;overflow-wrap:anywhere}.pith-article>:first-child{margin-top:0}.pith-article pre{overflow:auto;background:var(--background-secondary);padding:16px}
.pith-teaching-block{margin:1.5em 0;padding:1em 1.25em;background:var(--background-secondary);border:1px solid var(--background-modifier-border);border-left:3px solid var(--text-accent)}.pith-teaching-block h3{color:var(--text-accent);margin-top:0}.pith-teaching-block p:last-child{margin-bottom:0}.pith-fixed-page{margin:1.5em 0;padding:1em;background:var(--background-secondary);border:1px solid var(--background-modifier-border);text-align:center}.pith-fixed-page img{display:block;max-width:100%;max-height:80vh;width:auto;height:auto;object-fit:contain;margin:auto}.pith-fixed-page p{text-align:left;white-space:pre-wrap}
.pith-guide{background:var(--background-secondary);border-left:1px solid var(--background-modifier-border);overflow:auto}.pith-left-drawer{position:absolute;left:0;top:0;bottom:0;width:min(340px,100%);z-index:5;overflow:auto;background:var(--background-secondary);border-right:1px solid var(--background-modifier-border);padding:16px}.pith-left-drawer button{display:block;width:100%;text-align:left;border:0;background:none;padding:8px}.pith-left-drawer button:hover,.pith-left-drawer button[aria-current=true]{background:var(--background-modifier-hover)}.pith-left-drawer h2{font-size:14px;color:var(--text-muted)}
.pith-dock-zone{position:absolute;bottom:0;left:0;right:0;display:flex;justify-content:center;padding:30px 12px 16px}.pith-bottom-dock{display:flex;gap:4px;background:var(--background-secondary);border:1px solid var(--background-modifier-border);border-radius:24px;padding:5px;opacity:.15;transition:opacity .2s}.pith-dock-zone:hover .pith-bottom-dock,.pith-bottom-dock:focus-within,.pith-bottom-dock.active{opacity:1}.pith-bottom-dock button,.pith-selection button{border:0;background:none;padding:8px}
.pith-selection{position:fixed;z-index:8;display:flex;flex-wrap:wrap;max-width:calc(100vw - 16px);background:var(--background-secondary);border:1px solid var(--background-modifier-border);border-radius:5px}.pith-speech-active{background:var(--background-modifier-hover);text-decoration:underline;text-decoration-color:var(--text-accent);text-underline-offset:4px;animation:pith-speech-breathe 2.4s ease-in-out infinite}@keyframes pith-speech-breathe{50%{background:transparent}}.pith-toast-tip{position:absolute;bottom:80px;left:50%;transform:translateX(-50%);z-index:9;background:var(--background-secondary);border:1px solid var(--background-modifier-border);border-radius:5px;padding:8px 12px;color:var(--text-normal)}
.pith-timeline-stage{max-width:100%}.pith-cue{padding:10px 8px;border-bottom:1px solid var(--background-modifier-border);cursor:pointer;white-space:pre-wrap}.pith-cue:hover{background:var(--background-modifier-hover)}.pith-cue time{color:var(--text-muted);font-size:12px;margin-right:12px}
@media(max-width:700px){.pith-layout{grid-template-columns:minmax(0,1fr)}.pith-guide{position:absolute;right:0;top:50px;bottom:0;width:min(320px,100%);z-index:4}.pith-article{padding:24px 20px 110px}}
@media(prefers-reduced-motion:reduce){.pith-bottom-dock{transition:none}.pith-speech-active{animation:none}}
`;

export interface ObsidianReaderDocument {
  readonly title: string;
  readonly html: string;
  readonly files: readonly { name: string }[];
  readonly currentFile: string;
  readonly sections: readonly { title: string; line: number; level: number; locator: string }[];
}

export interface ObsidianViewActions {
  openFile(name: string): void | Promise<void>;
  openDojo(text?: string, locator?: string): void;
  selection(action: "highlight" | "note" | "ask", text: string): void;
  synthesizeSpeech?(text: string, signal: AbortSignal): Promise<{ readonly bytes: Uint8Array; readonly mimeType: string }>;
}

export function pageDirectionForKey(key: string): -1 | 0 | 1 {
  if (key === "ArrowUp" || key === "ArrowLeft" || key === "PageUp") return -1;
  if (key === "ArrowDown" || key === "ArrowRight" || key === "PageDown") return 1;
  return 0;
}

export class WheelPageGate {
  private last = -Infinity;
  accept(delta: number, now: number): -1 | 0 | 1 {
    if (Math.abs(delta) < 2 || now - this.last < 500) return 0;
    this.last = now;
    return delta < 0 ? -1 : 1;
  }
}

export class PithObsidianView {
  private readonly root: HTMLElement;
  private readonly actions: ObsidianViewActions;
  private readonly events = new AbortController();
  private readonly doc: Document;
  private readonly win: Window;
  private readonly reader: HTMLElement;
  private readonly article: HTMLElement;
  private readonly navigation: HTMLElement;
  private readonly guide: HTMLElement;
  private readonly layout: HTMLElement;
  private readonly dock: HTMLElement;
  private readonly toast: HTMLElement;
  private readonly popover: HTMLElement;
  private readonly navigationButton: HTMLButtonElement;
  private readonly guideButton: HTMLButtonElement;
  private selectionRange: Range | null = null;
  private toastTimer: number | undefined;
  private generation = 0;
  private readonly wheelGate = new WheelPageGate();
  private speaking = false;
  private speechAbort: AbortController | null = null;
  private speechAudio: HTMLAudioElement | null = null;
  private speechUrl: string | null = null;
  private dojoActive = false;

  constructor(root: HTMLElement, actions: ObsidianViewActions) {
    this.root = root; this.actions = actions;
    this.doc = root.ownerDocument;
    const win = this.doc.defaultView;
    if (!win) throw new Error("View requires a window");
    this.win = win;
    root.classList.add("pith-view");
    root.innerHTML = `<style>${obsidianStyles}</style><header class="pith-view-header"><button class="pith-icon pith-nav-toggle" title="目录和材料" aria-label="目录和材料" aria-expanded="false">☰</button><strong class="pith-title"></strong><button class="pith-icon pith-guide-toggle" title="切换向导栏" aria-label="切换向导栏" aria-pressed="true"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"></rect><path d="M15 4v16"></path></svg></button></header><div class="pith-layout"><section class="pith-stage"><div class="pith-reader" tabindex="0"><article class="pith-article"></article></div><aside class="pith-left-drawer" hidden></aside><div class="pith-dock-zone"><div class="pith-bottom-dock"><button data-command="read">🎧 伴读全文</button><button data-command="dojo">🗣 4 阶跟读工坊</button></div></div><div class="pith-toast-tip" role="status" hidden></div></section><aside class="pith-guide"></aside></div><div class="pith-selection" hidden><button data-selection="highlight">高亮</button><button data-selection="note">记笔记</button><button data-selection="ask">问向导</button><button data-selection="speak">▶ 从此句朗读</button></div>`;
    const required = <T extends HTMLElement>(selector: string): T => { const node = root.querySelector<T>(selector); if (!node) throw new Error(`Missing ${selector}`); return node; };
    this.reader = required(".pith-reader"); this.article = required(".pith-article"); this.navigation = required(".pith-left-drawer"); this.guide = required(".pith-guide"); this.layout = required(".pith-layout"); this.dock = required(".pith-bottom-dock"); this.toast = required(".pith-toast-tip"); this.popover = required(".pith-selection"); this.navigationButton = required(".pith-nav-toggle"); this.guideButton = required(".pith-guide-toggle");
    const options = { signal: this.events.signal };
    root.addEventListener("click", event => { void this.click(event); }, options);
    this.reader.addEventListener("wheel", event => { if (event.ctrlKey || Math.abs(event.deltaY) < 2) return; event.preventDefault(); const direction = this.wheelGate.accept(event.deltaY, this.win.performance.now()); if (direction) this.turnPage(direction); }, { ...options, passive: false });
    root.addEventListener("keydown", event => { const target = event.target as Element | null; if (!target || typeof target.closest !== "function" || target.closest("input,textarea,select,button,[contenteditable=true],.pith-guide,.pith-left-drawer") || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return; const amount = pageDirectionForKey(event.key); if (amount) { event.preventDefault(); this.turnPage(amount); } }, options);
    this.article.addEventListener("mouseup", () => this.showSelection(), options);
  }

  render(document: ObsidianReaderDocument): void {
    this.stopSpeech(); this.selectionRange = null; this.popover.hidden = true;
    const title = this.root.querySelector(".pith-title"); if (title) title.textContent = document.title;
    this.article.innerHTML = document.html;
    this.navigation.replaceChildren();
    const group = (label: string): void => { const heading = this.doc.createElement("h2"); heading.textContent = label; this.navigation.append(heading); };
    group("材料"); for (const file of document.files) { const button = this.doc.createElement("button"); button.textContent = file.name; button.dataset.file = file.name; button.setAttribute("aria-current", String(file.name === document.currentFile)); this.navigation.append(button); }
    group("目录"); for (const section of document.sections) { const button = this.doc.createElement("button"); button.textContent = section.title; button.dataset.locator = section.locator; button.style.paddingLeft = `${8 + Math.max(0, section.level - 1) * 12}px`; this.navigation.append(button); }
    this.closeNavigation();
  }

  guideElement(): HTMLElement { return this.guide; }
  setGuideVisible(visible: boolean): void { this.guide.hidden = !visible; this.layout.classList.toggle("pith-guide-closed", !visible); this.guideButton.setAttribute("aria-pressed", String(visible)); }
  setGuideAvailable(available: boolean): void { this.guideButton.hidden = !available; this.setGuideVisible(available); }
  setDojoActive(active: boolean): void { this.dojoActive = active; this.dock.classList.toggle("active", active || this.speaking); }
  turnPage(direction: number): void { this.reader.scrollBy({ top: direction * this.reader.clientHeight, behavior: "instant" }); }
  dispose(): void { this.stopSpeech(); this.events.abort(); if (this.toastTimer !== undefined) this.win.clearTimeout(this.toastTimer); this.root.replaceChildren(); this.root.classList.remove("pith-view"); }

  private closeNavigation(): void { this.navigation.hidden = true; this.navigationButton.setAttribute("aria-expanded", "false"); }
  private tip(text: string): void { this.toast.textContent = text; this.toast.hidden = false; if (this.toastTimer !== undefined) this.win.clearTimeout(this.toastTimer); this.toastTimer = this.win.setTimeout(() => { this.toast.hidden = true; }, 2000); }
  private async click(event: MouseEvent): Promise<void> {
    const target = event.target as Element | null; if (!target || typeof target.closest !== "function") return; const button = target.closest<HTMLButtonElement>("button");
    const cue = target.closest<HTMLElement>(".pith-cue");
    if (cue && this.article.contains(cue)) { const copy = cue.cloneNode(true) as HTMLElement; const time = copy.querySelector("time"); if (time) time.remove(); this.actions.openDojo((copy.textContent ?? "").trim(), cue.dataset.locator); return; }
    if (!button) { const selection = this.win.getSelection(); if (this.article.contains(target) && selection && selection.isCollapsed) { const range = this.doc.caretRangeFromPoint(event.clientX, event.clientY); if (range && this.article.contains(range.startContainer)) { this.selectionRange = range; this.popover.hidden = false; for (const item of this.popover.querySelectorAll<HTMLButtonElement>("button")) item.hidden = item.dataset.selection !== "speak"; this.popover.style.left = `${Math.max(8, Math.min(this.win.innerWidth - this.popover.offsetWidth - 8, event.clientX))}px`; this.popover.style.top = `${Math.max(8, event.clientY - this.popover.offsetHeight - 8)}px`; } } return; }
    if (!this.root.contains(button)) return;
    if (button === this.navigationButton) { this.navigation.hidden = !this.navigation.hidden; button.setAttribute("aria-expanded", String(!this.navigation.hidden)); }
    else if (button === this.guideButton) this.setGuideVisible(this.guide.hidden);
    else if (button.dataset.file) { this.closeNavigation(); try { await this.actions.openFile(button.dataset.file); } catch (error) { this.tip(error instanceof Error ? error.message : String(error)); } }
    else if (button.dataset.locator) { this.closeNavigation(); const heading = Array.from(this.article.querySelectorAll<HTMLElement>("[data-locator]")).find(node => node.dataset.locator === button.dataset.locator); if (heading) heading.scrollIntoView({ block: "start" }); }
    else if (button.dataset.command === "dojo") this.actions.openDojo();
    else if (button.dataset.command === "read") { if (this.speaking) this.stopSpeech(); else this.startSpeech(false); }
    else if (button.dataset.selection) { if (button.dataset.selection === "speak") this.startSpeech(true); else if (this.selectionRange && (button.dataset.selection === "highlight" || button.dataset.selection === "note" || button.dataset.selection === "ask")) this.actions.selection(button.dataset.selection, this.selectionRange.toString()); this.popover.hidden = true; }
  }
  private showSelection(): void {
    const selection = this.win.getSelection(); if (!selection || selection.isCollapsed || !selection.anchorNode || !selection.focusNode || !this.article.contains(selection.anchorNode) || !this.article.contains(selection.focusNode)) { this.popover.hidden = true; return; }
    this.selectionRange = selection.getRangeAt(0).cloneRange(); const rect = this.selectionRange.getBoundingClientRect(); this.popover.hidden = false; for (const item of this.popover.querySelectorAll<HTMLButtonElement>("button")) item.hidden = false; this.popover.style.left = `${Math.max(8, Math.min(this.win.innerWidth - this.popover.offsetWidth - 8, rect.left))}px`; this.popover.style.top = `${Math.max(8, rect.top - this.popover.offsetHeight - 8)}px`;
  }
  private clearSpeechMark(): void { for (const mark of this.article.querySelectorAll(".pith-speech-active")) { const parent = mark.parentNode; mark.replaceWith(...mark.childNodes); if (parent) parent.normalize(); } }
  private stopSpeech(): void { this.generation++; if (this.speechAbort) this.speechAbort.abort(); this.speechAbort = null; if (this.speechAudio) { this.speechAudio.pause(); this.speechAudio.removeAttribute("src"); this.speechAudio.load(); this.speechAudio = null; } if (this.speechUrl) URL.revokeObjectURL(this.speechUrl); this.speechUrl = null; this.speaking = false; this.clearSpeechMark(); this.dock.classList.toggle("active", this.dojoActive); const button = this.dock.querySelector("[data-command=read]"); if (button) button.textContent = "🎧 伴读全文"; }
  private startSpeech(fromSelection: boolean): void {
    const synthesize = this.actions.synthesizeSpeech;
    if (!synthesize) { this.tip("未连接高品质语音引擎，请在设置中配置 Kokoro 或云端语音"); return; }
    let startBlock: Element | null = null, startOffset = 0;
    if (fromSelection) { const range = this.selectionRange; if (!range) return; const node = range.startContainer; const element = node.nodeType === 1 ? node as Element : node.parentElement; startBlock = element ? element.closest("[data-prose]") : null; if (!startBlock || startBlock.getAttribute("data-prose") !== "true" || (element && element.closest("pre,code,table,math,[data-prose=false]"))) { this.tip("此处非正文段落，无法伴读"); return; } const prefix = this.doc.createRange(); prefix.selectNodeContents(startBlock); prefix.setEnd(node, range.startOffset); startOffset = prefix.toString().length; }
    this.stopSpeech(); const queue: { block: Element; start: number; end: number; text: string }[] = []; const segmenter = new Intl.Segmenter(undefined, { granularity: "sentence" });
    for (const block of this.article.querySelectorAll("[data-prose=true]")) for (const part of segmenter.segment(block.textContent ?? "")) { const text = part.segment.trim(); if (text) { const start = part.index + part.segment.length - part.segment.trimStart().length; queue.push({ block, start, end: start + text.length, text }); } }
    let index = fromSelection ? queue.findIndex(item => item.block === startBlock && item.end > startOffset) : 0; if (index < 0 || !queue.length) { this.tip("此处非正文段落，无法伴读"); return; }
    this.speaking = true; const generation = ++this.generation; this.dock.classList.add("active"); const button = this.dock.querySelector("[data-command=read]"); if (button) button.textContent = "停止伴读";
    this.speechAbort = new AbortController(); const signal = this.speechAbort.signal;
    const run = async (): Promise<void> => {
      let pending = synthesize(queue[index]!.text, signal);
      while (index < queue.length) {
        const audio = await pending; if (signal.aborted) return;
        if (!audio.bytes.byteLength) throw new Error("语音引擎返回空音频");
        const item = queue[index++]!;
        if (index < queue.length) { pending = synthesize(queue[index]!.text, signal); void pending.catch(() => {}); }
        this.clearSpeechMark(); const walker = this.doc.createTreeWalker(item.block, 4); const nodes: { node: Text; start: number }[] = []; let node: Node | null, offset = 0;
        while ((node = walker.nextNode())) { const text = node as Text; nodes.push({ node: text, start: offset }); offset += text.length; }
        for (const part of nodes) { const a = Math.max(0, item.start - part.start), b = Math.min(part.node.length, item.end - part.start); if (a >= b) continue; const range = this.doc.createRange(); range.setStart(part.node, a); range.setEnd(part.node, b); const mark = this.doc.createElement("span"); mark.className = "pith-speech-active"; mark.dataset.speechActive = "true"; range.surroundContents(mark); }
        const active = item.block.querySelector(".pith-speech-active"); if (active) { const reader = this.reader.getBoundingClientRect(), rect = active.getBoundingClientRect(); if (rect.top < reader.top || rect.bottom > reader.bottom) this.reader.scrollTop += rect.top - reader.top - 32; }
        this.speechUrl = URL.createObjectURL(new Blob([new Uint8Array(audio.bytes)], { type: audio.mimeType }));
        const player = this.doc.createElement("audio"); this.speechAudio = player; player.src = this.speechUrl;
        await new Promise<void>((resolve, reject) => { player.onended = () => resolve(); player.onerror = () => reject(new Error("音频播放失败")); signal.addEventListener("abort", () => resolve(), { once: true }); void player.play().catch(reject); });
        if (this.speechUrl) URL.revokeObjectURL(this.speechUrl); this.speechUrl = null; this.speechAudio = null;
      }
      if (generation === this.generation) this.stopSpeech();
    };
    void run().catch(error => { if (generation === this.generation) { this.stopSpeech(); this.tip(error instanceof Error ? error.message : String(error)); } });
  }
}
