import type { AttentionCompassSnapshot } from "../core/index.ts";
import { cleanMaterialTitle } from "../plugins/stage-reader/epub.ts";
import type { BoardMaterial } from "./boardMaterials.ts";
import { workbenchStyles } from "./view.ts";

export interface CompassActions {
  open(id: string): void;
  create(data: { title: string; files: File[]; repoPath: string; guide: boolean }): Promise<void> | void;
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
  root.innerHTML = `<style>${workbenchStyles}</style><header class="pith-view-header"><strong>Pith</strong>${actions.settings ? '<button class="pith-icon" data-home-settings aria-label="设置" title="设置">⚙</button>' : ""}</header><div class="pith-home-scroll"><main class="pith-home"><h1>课题看板</h1><form class="pith-intake-box"><input name="title" aria-label="课题名称" placeholder="输入想探索的课题（如：深入理解 DSH 架构），或直接添加文件 / 绑定代码仓…"><div class="pith-intake-actions"><button type="button" data-intake-files>＋ 添加文件</button><input type="file" multiple hidden><button type="button" data-intake-repo aria-expanded="false">📁 绑定本地 Git 仓库</button><span data-intake-selected></span></div><input name="repoPath" aria-label="本地 Git 仓库绝对路径" placeholder="本地 Git 仓库绝对路径" hidden><div class="pith-intake-actions"><button type="submit" data-intake-open>直接开启 →</button><button type="button" data-intake-guide>✨ 请向导拆解立项</button></div><div class="pith-home-status" role="status"></div></form><section class="pith-focus">${compass.focusRecommendation ? `<div><span class="pith-topic-status">下一步 · 15 分钟</span><br><strong>${escape(compass.focusRecommendation.nextAction)}</strong><br>${escape(cleanMaterialTitle(compass.focusRecommendation.title))}</div><button data-topic="${escape(compass.focusRecommendation.topicId)}">继续探索</button>` : "选择一个课题，开始今天的探索。"}</section><section><div class="pith-home-heading"><h2>探索中</h2><span>${compass.exploring.length}</span></div><div class="pith-topic-grid">${compass.exploring.map(card).join("")}</div></section><section><div class="pith-home-heading"><h2>已沉淀</h2><span>${compass.settled.length}</span></div><div class="pith-settled-list">${compass.settled.map(settled).join("")}</div></section></main></div>`;
  const form = root.querySelector<HTMLFormElement>(".pith-intake-box")!;
  const files = form.querySelector<HTMLInputElement>('input[type="file"]')!;
  const repo = form.querySelector<HTMLInputElement>('[name="repoPath"]')!;
  const status = form.querySelector<HTMLElement>(".pith-home-status")!;
  form.querySelector<HTMLButtonElement>("[data-intake-files]")!.onclick = () => files.click();
  files.onchange = () => { form.querySelector<HTMLElement>("[data-intake-selected]")!.textContent = Array.from(files.files || []).map(file => file.name).join("、"); };
  form.querySelector<HTMLButtonElement>("[data-intake-repo]")!.onclick = event => { repo.hidden = !repo.hidden; (event.currentTarget as HTMLButtonElement).setAttribute("aria-expanded", String(!repo.hidden)); };
  const submit = async (guide: boolean) => { const title = (form.elements.namedItem("title") as HTMLInputElement).value.trim(), selected = Array.from(files.files || []), repoPath = repo.hidden ? "" : repo.value.trim(); if (!title && !selected.length && !repoPath) { status.textContent = "请输入课题或添加材料"; return; } if (selected.length && repoPath) { status.textContent = "请选择文件或代码仓库"; return; } const buttons = Array.from(form.querySelectorAll<HTMLButtonElement>("button")); buttons.forEach(button => button.disabled = true); status.textContent = ""; try { await actions.create({ title, files: selected, repoPath, guide }); } catch (error) { status.textContent = error instanceof Error ? error.message : String(error); } finally { buttons.forEach(button => button.disabled = false); } };
  form.onsubmit = event => { event.preventDefault(); void submit(false); };
  form.querySelector<HTMLButtonElement>("[data-intake-guide]")!.onclick = () => { void submit(true); };
  const settings = root.querySelector<HTMLButtonElement>("[data-home-settings]");
  if (settings && actions.settings) settings.onclick = actions.settings;
  for (const button of root.querySelectorAll<HTMLButtonElement>("[data-topic]")) button.onclick = () => { if (button.dataset.topic) actions.open(button.dataset.topic); };
}
