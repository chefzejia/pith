import { pithIcon } from "../icons.ts";
import { workbenchStyles } from "./styles.ts";
import type { ObsidianViewActions } from "../view.ts";

export function createWorkbenchChrome(root: HTMLElement, actions: ObsidianViewActions): <T extends HTMLElement>(selector: string) => T {
    root.classList.add("pith-view");
    root.innerHTML = `<style>${workbenchStyles}</style><div class="pith-bottom-dock"><header class="pith-view-header"><button class="pith-icon pith-nav-toggle" title="目录和材料" aria-label="目录和材料" aria-expanded="false">${pithIcon("menu")}</button><button class="pith-icon" data-command="home" title="返回首页" aria-label="返回首页">${pithIcon("chevron-left")}</button><strong class="pith-title"></strong><span data-pages hidden><button data-page="previous" aria-label="上一页">${pithIcon("chevron-left")}</button><span data-page-count>1 / 1</span><button data-page="next" aria-label="下一页">${pithIcon("chevron-right")}</button></span><button id="open-toolkit" class="pith-icon pith-toolkit-add" data-command="toolkit" title="添加实训工具" aria-label="添加实训工具">${pithIcon("sliders")}</button><button class="pith-icon" data-command="read" title="听读本章" aria-label="听读本章">${pithIcon("headphones")}</button><button class="pith-icon" data-command="typography" title="阅读排版" aria-label="阅读排版" aria-expanded="false">${pithIcon("type")}</button><button class="pith-icon pith-guide-toggle" title="切换向导栏" aria-label="切换向导栏" aria-pressed="false">${pithIcon("compass")}</button></header><div class="pith-speech-controls"></div><div class="pith-typography-popover" hidden><fieldset data-reading-aids><legend>行间</legend><div class="pith-interline-modes" role="group" aria-label="行间模式"><button data-interline-mode="original" aria-pressed="true">原文</button><button data-interline-mode="bilingual" aria-pressed="false">行间</button><button data-interline-mode="subtitle-primary" aria-pressed="false">译文主显</button></div><small data-interline-reason></small></fieldset><fieldset><legend>字号</legend><button data-size="15" aria-pressed="false">小</button><button data-size="17" aria-pressed="true">标准</button><button data-size="20" aria-pressed="false">大</button></fieldset><fieldset data-page-modes><legend>版式</legend><button data-mode="single" aria-pressed="true">单栏</button><button data-mode="double" aria-pressed="false">双栏</button><button data-mode="triple" aria-pressed="false">三栏</button></fieldset></div></div><div class="pith-layout pith-guide-closed"><section class="pith-stage"><div class="pith-reader" tabindex="0"><article class="pith-article"></article></div><aside class="pith-left-drawer" hidden></aside><div class="pith-toast-tip" role="status" hidden></div></section></div><div class="pith-selection" hidden><button data-selection="highlight">高亮</button><button data-selection="note">记笔记</button><button data-selection="ask">问向导</button><button data-selection="copy">复制</button></div>`;
    const required = <T extends HTMLElement>(selector: string): T => { const node = root.querySelector<T>(selector); if (!node) throw new Error(`Missing ${selector}`); return node; };
    const header = required<HTMLElement>(".pith-view-header");
    for (const [command, label, icon, enabled] of [["import", "导入材料", "plus", Boolean(actions.importMaterial)], ["settings", "设置", "settings", Boolean(actions.openSettings)]] as const) {
      if (!enabled) continue;
      const button = root.ownerDocument.createElement("button"); button.className = "pith-icon"; button.dataset.command = command; button.title = label; button.setAttribute("aria-label", label); button.innerHTML = pithIcon(icon); header.append(button);
    }
  if (actions.scene === "material") {
    required("#open-toolkit").hidden = true;
    required('[data-selection="ask"]').remove();
    const notes = required<HTMLButtonElement>(".pith-guide-toggle"); notes.title = "笔记"; notes.setAttribute("aria-label", "笔记"); notes.innerHTML = pithIcon("notes");
    const start = root.ownerDocument.createElement("button"); start.dataset.command = "intake"; start.textContent = "以此立项"; header.insertBefore(start, notes);
  }
  return required;
}
