import { pithIcon } from "../icons.ts";

export class PlaybackDeck {
  readonly deck: HTMLElement;
  readonly controls: HTMLElement;
  private readonly article: HTMLElement;
  private readonly state: () => { duration: number | undefined; otherPlayback: boolean };
  constructor(doc: Document, speechControls: HTMLElement, article: HTMLElement, state: () => { duration: number | undefined; otherPlayback: boolean }) {
  const deck = doc.createElement("section"), controls = doc.createElement("div");
  deck.className = "pith-media-deck"; deck.hidden = true; deck.setAttribute("aria-label", "音频播放控制");
  controls.className = "pith-asset-controls"; controls.hidden = true;
  controls.innerHTML = `<button data-media="play" aria-label="播放">${pithIcon("play")}</button><span data-media-time>00:00 / 00:00</span><span class="pith-deck-track"><input class="pith-media-seek" type="range" min="0" max="0" value="0" step="0.1" aria-label="播放进度"></span><button data-media="back" aria-label="后退15秒">${pithIcon("rotate-ccw")} 15</button><button data-media="forward" aria-label="前进15秒">${pithIcon("rotate-cw")} 15</button><button data-media="rate" aria-label="播放倍速">1.0x</button><button data-media="close" aria-label="关闭播放控制">${pithIcon("close")}</button>`;
  deck.append(controls, speechControls); this.deck = deck; this.controls = controls; this.article = article; this.state = state;
  }
  renderCueMarkers(): void {
  const { duration, otherPlayback } = this.state(), article = this.article;
  const track = this.controls.querySelector<HTMLElement>(".pith-deck-track"); if (!track) return; track.querySelectorAll(".pith-deck-marker").forEach(node => node.remove());
  if (otherPlayback || !duration || !Number.isFinite(duration)) return;
  for (const cue of article.querySelectorAll<HTMLElement>('.pith-cue[data-locator^="time:"]')) { const start = Number(cue.dataset.locator!.slice(5)); if (!Number.isFinite(start) || start < 0 || start > duration) continue; const marker = article.ownerDocument.createElement("button"); marker.type = "button"; marker.className = "pith-deck-marker"; marker.dataset.cueStart = String(start); marker.style.left = `${start / duration * 100}%`; marker.title = `跳转至 ${start} 秒`; marker.setAttribute("aria-label", marker.title); track.append(marker); }
}
}
