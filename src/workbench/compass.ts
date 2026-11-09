import type { AttentionCompassSnapshot } from "../core/index.ts";
import { cleanMaterialTitle } from "../plugins/stage-reader/epub.ts";
import type { BoardMaterial } from "./boardMaterials.ts";
import { workbenchStyles } from "./view.ts";

export interface CompassActions {
  open(id: string): void;
  create(data: { title: string; target: string; nextAction: string; materialId?: string }): void;
  import(): void;
  settings?(): void;
  materials?: readonly BoardMaterial[];
}

export function renderCompass(root: HTMLElement, compass: AttentionCompassSnapshot, actions: CompassActions): void {
  const escape = (value: string): string => value.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
  const materialFor = (id: string | undefined) => actions.materials?.find(item => item.id === id);
  const date = (value: string) => { const parsed = new Date(value); return Number.isNaN(parsed.getTime()) ? "" : `${parsed.getFullYear()}/${parsed.getMonth() + 1}/${parsed.getDate()}`; };
  const toolkit = (id: string) => ({ interline: "行间双语", shadowing: "影子跟读", feynman: "费曼练习" } as Record<string, string>)[id] ?? id;
  const card = (topic: AttentionCompassSnapshot["exploring"][number]) => {
    const material = materialFor(topic.materialId), count = topic.notes.length;
    return `<button class="pith-topic-card" data-topic="${escape(topic.id)}"><span class="pith-card-top"><span class="pith-topic-status">探索中${topic.toolkits.length ? ` · ${escape(topic.toolkits.map(toolkit).join(" / "))}` : ""}</span><time>${escape(date(topic.updatedAt))}</time></span><span class="pith-card-body"><span class="pith-card-copy"><strong title="${escape(topic.title)}">${escape(cleanMaterialTitle(topic.title))}</strong>${material ? `<span class="pith-card-material" title="${escape(material.fileName ?? material.title)}">材料：${escape(material.fileName ?? material.title)}</span>` : ""}</span>${material?.coverUrl ? `<img class="pith-card-cover" src="${escape(material.coverUrl)}" alt="">` : ""}</span><span class="pith-card-suggestion">${escape(topic.nextAction || topic.target || "点进材料，框选文字即可高亮、记笔记或问向导")}</span><span class="pith-card-foot"><span>${count ? `已收 ${count} 条笔记/高亮` : "暂无笔记"}</span><span>进入阅读 →</span></span></button>`;
  };
  const settled = (topic: AttentionCompassSnapshot["settled"][number]) => { const material = materialFor(topic.materialId); return `<button class="pith-settled-row" data-topic="${escape(topic.id)}"><span><strong title="${escape(topic.title)}">${escape(cleanMaterialTitle(topic.title))}</strong><small>${material ? `材料：${escape(material.fileName ?? material.title)} · ` : ""}共归档 ${topic.notes.length} 条核心笔记</small></span><span class="pith-topic-status settled">已沉淀</span></button>`; };
  root.classList.add("pith-view");
  root.innerHTML = `<style>${workbenchStyles}</style><header class="pith-view-header"><strong>Pith</strong>${actions.settings ? '<button class="pith-icon" data-home-settings aria-label="设置" title="设置">⚙</button>' : ""}</header><div class="pith-home-scroll"><main class="pith-home"><h1>课题看板</h1><div class="pith-home-actions"><button data-home-new>新建课题</button><button data-home-import>导入材料</button></div><form class="pith-home-form" hidden><label>课题名称<input name="title" required></label><label>探索目标<input name="target"></label><label>下一步行动<input name="nextAction"></label>${actions.materials ? `<label>关联材料<select name="materialId"><option value="">不关联材料</option>${actions.materials.map(item => `<option value="${escape(item.id)}">${escape(item.title)}</option>`).join("")}</select></label>` : ""}<button>创建课题</button></form><div class="pith-home-status" role="status"></div><section class="pith-focus">${compass.focusRecommendation ? `<div><span class="pith-topic-status">下一步 · 15 分钟</span><br><strong>${escape(compass.focusRecommendation.nextAction)}</strong><br>${escape(cleanMaterialTitle(compass.focusRecommendation.title))}</div><button data-topic="${escape(compass.focusRecommendation.topicId)}">继续探索</button>` : "选择一个课题，开始今天的探索。"}</section><section><div class="pith-home-heading"><h2>探索中</h2><span>${compass.exploring.length}</span></div><div class="pith-topic-grid">${compass.exploring.map(card).join("")}</div></section><section><div class="pith-home-heading"><h2>已沉淀</h2><span>${compass.settled.length}</span></div><div class="pith-settled-list">${compass.settled.map(settled).join("")}</div></section></main></div>`;
  const form = root.querySelector<HTMLFormElement>(".pith-home-form");
  const add = root.querySelector<HTMLButtonElement>("[data-home-new]");
  const importer = root.querySelector<HTMLButtonElement>("[data-home-import]");
  if (!form || !add || !importer) throw new Error("首页初始化失败");
  add.onclick = () => { form.hidden = !form.hidden; };
  importer.onclick = () => actions.import();
  const settings = root.querySelector<HTMLButtonElement>("[data-home-settings]");
  if (settings && actions.settings) settings.onclick = actions.settings;
  for (const button of root.querySelectorAll<HTMLButtonElement>("[data-topic]")) button.onclick = () => { if (button.dataset.topic) actions.open(button.dataset.topic); };
  form.onsubmit = event => { event.preventDefault(); const data = new FormData(form); const title = String(data.get("title") || "").trim(); if (!title) return; const materialId = String(data.get("materialId") || ""); actions.create({ title, target: String(data.get("target") || ""), nextAction: String(data.get("nextAction") || ""), ...(materialId ? { materialId } : {}) }); };
}
