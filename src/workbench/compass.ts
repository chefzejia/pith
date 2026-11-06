import type { AttentionCompassSnapshot } from "../core/index.ts";
import { workbenchStyles } from "./view.ts";

export interface CompassActions {
  open(id: string): void;
  create(data: { title: string; target: string; nextAction: string; materialId?: string }): void;
  import(): void;
  settings?(): void;
  materials?: readonly { id: string; title: string }[];
}

export function renderCompass(root: HTMLElement, compass: AttentionCompassSnapshot, actions: CompassActions): void {
  const escape = (value: string): string => value.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
  root.classList.add("pith-view");
  root.innerHTML = `<style>${workbenchStyles}</style><header class="pith-view-header"><strong>Pith</strong>${actions.settings ? '<button data-home-settings aria-label="设置" title="设置">⚙</button>' : ""}</header><div class="pith-home-scroll"><main class="pith-home"><h1>注意力罗盘</h1><div class="pith-home-actions"><button data-home-new>新建课题</button><button data-home-import>导入材料</button></div><form class="pith-home-form" hidden><label>课题名称<input name="title" required></label><label>探索目标<input name="target"></label><label>下一步行动<input name="nextAction"></label>${actions.materials ? `<label>关联材料<select name="materialId"><option value="">不关联材料</option>${actions.materials.map(item => `<option value="${escape(item.id)}">${escape(item.title)}</option>`).join("")}</select></label>` : ""}<button>创建课题</button></form><div class="pith-home-status" role="status"></div><section class="pith-focus">${compass.focusRecommendation ? `<div><span class="pith-topic-status">下一步 · 15 分钟</span><br><strong>${escape(compass.focusRecommendation.nextAction)}</strong><br>${escape(compass.focusRecommendation.title)}</div><button data-topic="${escape(compass.focusRecommendation.topicId)}">继续探索</button>` : "选择一个课题，开始今天的探索。"}</section>${([["探索中", compass.exploring], ["已沉淀", compass.settled]] as const).map(([label, topics]) => `<section><div class="pith-home-heading"><h2>${label}</h2><span>${topics.length}</span></div><div class="pith-topic-grid">${topics.map(topic => `<button class="pith-topic-card" data-topic="${escape(topic.id)}"><span class="pith-topic-status ${topic.status === "settled" ? "settled" : ""}">${label}</span><strong>${escape(topic.title)}</strong><span>${escape(topic.nextAction || topic.target || "尚未设置下一步")}</span></button>`).join("")}</div></section>`).join("")}</main></div>`;
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
