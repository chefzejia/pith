import { readingPositionLabel } from "./readingState.ts";
import type { AttentionCompassSnapshot } from "../core/index.ts";
import { cleanMaterialTitle } from "../plugins/stage-reader/epub.ts";
import type { BoardMaterial } from "./boardMaterials.ts";
import { workbenchStyles } from "./view.ts";
import { pithIcon } from "./icons.ts";
import { mountIntake, type IntakeActions } from "./intake.ts";

export interface CompassActions {
  open(id: string): void;
  openMaterial(id: string): void;
  intake: IntakeActions;
  setStatus?(id: string, status: "exploring" | "shelved"): Promise<void>;
  settings?(): void;
  materials?: readonly BoardMaterial[];
}
const escape = (value: string): string => value.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);

export function renderCompass(root: HTMLElement, compass: AttentionCompassSnapshot, actions: CompassActions): { dispose(): void; library(snapshot: AttentionCompassSnapshot, covers: readonly BoardMaterial[], focus?: readonly string[]): void } {
  const materialFor = (id: string | undefined) => actions.materials?.find(item => item.id === id);
  const toolkit = (id: string) => ({ shadowing: "影子跟读", feynman: "费曼复述" } as Record<string, string>)[id] ?? id;
  const card = (topic: AttentionCompassSnapshot["exploring"][number]) => {
    const material = materialFor(topic.materialIds[0]);
    return `<article class="pith-topic-entry"><button class="pith-topic-card" data-topic="${escape(topic.id)}"><span class="pith-card-top"><span class="pith-topic-status">探索中${topic.toolkits.length ? ` · ${escape(topic.toolkits.map(toolkit).join(" / "))}` : ""}</span><time>${escape(topic.updatedAt.slice(0, 10))}</time></span><span class="pith-card-body"><span class="pith-card-copy"><strong title="${escape(topic.title)}">${escape(cleanMaterialTitle(topic.title))}</strong><span class="pith-card-material">${escape(topic.target)}</span></span>${material?.coverUrl ? `<img class="pith-card-cover" src="${escape(material.coverUrl)}" width="60" height="80" alt="">` : ""}</span><span class="pith-card-suggestion">${escape(topic.nextAction || topic.target)}</span><span class="pith-card-foot"><span>${topic.materialIds.length} 份材料 · ${topic.notes.length ? `${topic.notes.length} 条记录` : "暂无笔记"}</span><span>进入课题 ${pithIcon("chevron-right")}</span></span></button>${actions.setStatus ? `<details class="pith-topic-more"><summary aria-label="课题操作">${pithIcon("more")}</summary><button data-shelve="${escape(topic.id)}">搁置</button></details>` : ""}</article>`;
  };
  const rows = (topics: AttentionCompassSnapshot["settled"]) => topics.map(topic => `<button class="pith-settled-row" data-topic="${escape(topic.id)}"><span><strong>${escape(topic.title)}</strong><small>${escape(topic.target)}</small></span><span>${topic.notes.length} 条记录</span></button>`).join("");
  root.classList.add("pith-view"); root.dataset.scene = "home";
  root.innerHTML = `<style>${workbenchStyles}</style><header class="pith-view-header"><strong>Pith</strong>${actions.settings ? `<button class="pith-icon" data-home-settings aria-label="设置">${pithIcon("settings")}</button>` : ""}</header><div class="pith-home-scroll"><main class="pith-home"><h1>从一个问题开始</h1><div data-intake-host></div><section class="pith-focus">${compass.focusRecommendation ? `<div><span class="pith-topic-status">下一步 · 15 分钟</span><br><strong>${escape(compass.focusRecommendation.nextAction)}</strong><br>${escape(cleanMaterialTitle(compass.focusRecommendation.title))}</div><button data-topic="${escape(compass.focusRecommendation.topicId)}">继续探索</button>` : "投喂材料，随时阅读。带上一个问题，再和向导一起探索。"}</section><section><div class="pith-home-heading"><h2>探索中</h2><span>${compass.exploring.length}</span></div><div class="pith-topic-grid">${compass.exploring.map(card).join("")}</div></section>${compass.shelved.length ? `<details class="pith-shelved"><summary>搁置（${compass.shelved.length}）</summary>${compass.shelved.map(topic => `<div class="pith-shelved-row"><button data-topic="${escape(topic.id)}">${escape(topic.title)}</button><button data-restore="${escape(topic.id)}">恢复</button></div>`).join("")}</details>` : ""}<section><div class="pith-home-heading"><h2>已沉淀</h2><span>${compass.settled.length}</span></div><div class="pith-settled-list">${rows(compass.settled)}</div></section><section class="pith-library" aria-label="材料库"></section>${compass.unreadable.length ? `<section class="pith-unreadable" aria-label="无法读取"><h2>无法读取（${compass.unreadable.length}）</h2><ul>${compass.unreadable.map(entry => `<li><code>${escape(entry.path)}</code><p>${escape(entry.error)}</p></li>`).join("")}</ul></section>` : ""}</main></div>`;
  const intake = mountIntake(root.querySelector<HTMLElement>("[data-intake-host]")!, actions.intake);
  root.querySelector<HTMLButtonElement>("[data-home-settings]")?.addEventListener("click", () => actions.settings?.());
  root.querySelectorAll<HTMLButtonElement>("[data-topic]").forEach(button => button.onclick = () => actions.open(button.dataset.topic!));
  for (const [selector, status] of [["[data-shelve]", "shelved"], ["[data-restore]", "exploring"]] as const) root.querySelectorAll<HTMLButtonElement>(selector).forEach(button => button.onclick = () => { button.disabled = true; void actions.setStatus?.(button.dataset.shelve ?? button.dataset.restore!, status).catch(error => { button.disabled = false; button.title = String(error); }); });
  let expanded = false;
  const library = (snapshot: AttentionCompassSnapshot, covers: readonly BoardMaterial[], focus: readonly string[] = []) => {
    const container = root.querySelector<HTMLElement>(".pith-library")!, kinds: Record<string, string> = { book: "书籍", article: "文章", media: "音视频", discussion: "讨论", repo: "仓库" };
    if (focus.length) expanded = true;
    const recent = [...snapshot.library].sort((a, b) => { const opened = (entry: typeof a) => covers.find(item => item.id === entry.material.id)?.reading?.openedAt ?? entry.material.files.reduce((latest, file) => file.lastActiveAt && file.lastActiveAt > latest ? file.lastActiveAt : latest, entry.material.createdAt); return opened(b).localeCompare(opened(a)); });
    const entries = expanded ? recent : recent.slice(0, 12);
    container.innerHTML = `<div class="pith-home-heading"><h2>材料库</h2><span>${snapshot.library.length}</span></div><div class="pith-library-grid">${entries.map(({ material, topicIds }) => {
      const board = covers.find(item => item.id === material.id), cover = board?.coverUrl, position = board?.reading ? { name: board.reading.file, locator: board.reading.locator } : material.files.filter(file => file.lastActiveAt).sort((a, b) => (b.lastActiveAt ?? "").localeCompare(a.lastActiveAt ?? ""))[0];
      return `<button class="pith-material-card${focus.includes(material.id) ? " pith-material-new" : ""}" data-material="${escape(material.id)}">${cover ? `<img src="${escape(cover)}" width="64" height="88" loading="lazy" alt="">` : `<span class="pith-material-cover" aria-hidden="true">${pithIcon(material.kind === "repo" ? "code" : "book")}</span>`}<span><strong>${escape(material.title)}</strong><small>${kinds[material.kind]} · ${topicIds.length} 个课题引用</small><small>${position ? `上次读到 ${escape(position.name)}${position.locator ? ` · ${escape(readingPositionLabel(position.locator))}` : ""}` : "尚未阅读"}</small></span></button>`;
    }).join("")}</div>${!expanded && snapshot.library.length > 12 ? '<button data-library-more>展开全部材料</button>' : !entries.length ? '<p class="pith-empty-library">文件、链接与仓库都可以直接放在这里。</p>' : ""}`;
    container.querySelectorAll<HTMLButtonElement>("[data-material]").forEach(button => button.onclick = () => actions.openMaterial(button.dataset.material!));
    container.querySelector<HTMLButtonElement>("[data-library-more]")?.addEventListener("click", () => { expanded = true; library(snapshot, covers); });
    if (focus.length) container.querySelector(".pith-material-new")?.scrollIntoView({ block: "center" });
  };
  library(compass, actions.materials ?? []);
  return { dispose: () => intake.dispose(), library };
}
