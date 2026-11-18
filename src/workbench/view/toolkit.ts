import type { ToolkitDiagnosis, ToolkitStage, ToolkitDescriptor } from "../../core/index.ts";
import { renderToolkitAlignment } from "../../plugins/toolkit-shadowing/index.ts";
import { pithIcon } from "../icons.ts";
import type { RecallStatus } from "../../plugins/toolkit-feynman/index.ts";
import type { RecallPractice } from "../recallPractice.ts";
import { renderRecallResult } from "./recall.ts";

export function renderToolkitMenu(panel: HTMLElement, toolkits: readonly ToolkitDescriptor[], mounted: readonly string[]): void {
  const doc = panel.ownerDocument; panel.hidden = false; panel.replaceChildren();
  for (const item of toolkits) {
    const group = doc.createElement("div"), button = doc.createElement("button"); group.className = "pith-toolkit-group"; button.dataset.toolkitChoose = item.id; button.textContent = item.label; group.append(button);
    if (mounted.includes(item.id)) { const remove = doc.createElement("button"); remove.className = "pith-toolkit-remove"; remove.dataset.toolkitRemove = item.id; remove.title = `移除${item.label}`; remove.setAttribute("aria-label", remove.title); remove.innerHTML = pithIcon("close"); group.append(remove); }
    panel.append(group);
  }
}

export function renderInlineToolkit(input: { block: HTMLElement; inline: HTMLElement; source: HTMLElement; display: HTMLElement; toolkit: ToolkitDescriptor; stage: ToolkitStage; target: string; reveal: boolean; recorded: boolean; result: ToolkitDiagnosis | null; produced: string; status: string; recall?: RecallPractice; previous?: ReadonlyMap<string, RecallStatus> }): HTMLElement | null {
  const { block, inline, source, display, toolkit, stage, target, reveal, recorded, result, produced, status } = input;
  const esc = (s: string): string => s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
  const labels: Record<ToolkitStage, string> = { "listen-decompose": "韵律", "guided-follow": "原文", "scaffold-cloze": "骨干", "blind-produce": "盲听" };
  inline.dataset.toolkit = toolkit.id; const shadowing = toolkit.id === "shadowing"; block.classList.toggle("pith-shadowing-spotlight", shadowing);
  let lenses: HTMLElement | null = null;
  if (shadowing) { lenses = block.ownerDocument.createElement("div"); lenses.className = "pith-shadowing-lenses"; lenses.dataset.prose = "false"; lenses.innerHTML = `${toolkit.stages.map(item => `<button data-toolkit-stage="${item}" aria-pressed="${item === stage}">${labels[item]}</button>`).join("")}<button data-toolkit-close aria-label="收起">${pithIcon("close")}</button>`; block.insertAdjacentElement("beforebegin", lenses); }
  const showOriginal = !shadowing && reveal; source.hidden = !showOriginal; display.hidden = showOriginal;
  let transformed = esc(toolkit.transformCue(target, stage));
  if (shadowing && stage === "listen-decompose") transformed = transformed.replace(/ \/(?=\s)/g, ' <span class="pith-chunk-slash">/</span>');
  if (shadowing && stage === "scaffold-cloze") transformed = transformed.replace(/___/g, '<span class="pith-cloze-slot">___</span>');
  if (shadowing && stage === "blind-produce" && !result) transformed = `<span class="pith-blind-mask${recorded ? " pith-blind-revealed" : ""}" tabindex="0">${transformed}</span>`;
  display.innerHTML = result && toolkit.diagnose ? renderToolkitAlignment(target, result.matchedTokens) : transformed;
  const recall = input.recall;
  const recallStatus = recall?.busy ? "正在处理，请稍候…" :
    recall?.saved && recall.produced === produced ? recall.result ? "本次复述已保存。" :
      `本次复述已保存，对照不可用：${recall.error}。重试对照会记录一次新的尝试。` :
    recall?.preparation === "loading" ? "正在从原文抽取要点…" :
    recall?.preparation === "failed" ? `对照不可用：${recall.error}。复述仍可保存。` : "要点已准备，请用自己的话复述。";
  inline.innerHTML = shadowing ? `<div class="pith-shadowing-dock"><button type="button" data-toolkit-play-cue aria-pressed="false">${pithIcon("play")} 原声${stage === "listen-decompose" ? " 0.75x" : ""}</button><button type="button" data-toolkit-loop-cue aria-pressed="false">${pithIcon("repeat")} 循环</button><button type="button" data-voice="toolkit" aria-pressed="false">${pithIcon("mic")} 开口跟读</button><button type="button" data-toolkit-play-recorded ${recorded ? "" : "hidden disabled"}>${pithIcon("volume")} 回听对比</button><button data-toolkit-save ${recorded ? "" : "hidden"} ${result ? "" : "disabled"}>${pithIcon("check")} 记入账本</button>${result ? `<div class="pith-shadowing-feedback">识别：${esc(produced)} · 准确度 ${Math.round(result.accuracyScore * 100)}%</div>` : ""}<div role="status">${esc(status)}</div></div>` : `<strong>${esc(toolkit.label)}</strong><button data-toolkit-close aria-label="收起">${pithIcon("close")}</button><button data-toolkit-reveal>${reveal ? "合上原文" : "查看原文"}</button><label>复述文本<textarea data-toolkit-produced ${recall?.busy ? "disabled" : recall?.result ? "readonly" : ""}>${esc(produced)}</textarea></label>${recall?.result ? "" : `<button data-toolkit-submit ${recall?.busy ? "disabled" : ""}>${recall?.saved && recall.produced === produced ? "重试对照（新尝试）" : "提交对照"}</button>`}${renderRecallResult(recall?.result, input.previous)}<div role="status">${esc(status || recallStatus)}</div>${recall?.result ? `<button data-toolkit-repeat>${pithIcon("repeat")} 再复述一次</button>` : ""}`;
  return lenses;
}
