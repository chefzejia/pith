import type { AttentionCompassSnapshot } from "../core/index.ts";
import { cleanMaterialTitle } from "../plugins/stage-reader/epub.ts";
import type { BoardMaterial } from "./boardMaterials.ts";
import { workbenchStyles } from "./view.ts";
import { pithIcon } from "./icons.ts";

export interface CompassActions {
  open(id: string): void;
  create(data: { title: string; files: File[]; repoPath: string; repoPaths: string[]; url: string; guide: boolean }): Promise<void> | void;
  setStatus?(id: string, status: "exploring" | "shelved"): Promise<void>;
  settings?(): void;
  materials?: readonly BoardMaterial[];
}

export function intakeGuidePrompt(title: string, files: readonly File[]): string {
  return files.length || !title ? title : `学习目标：${title}\n请结合学习目标规划课程，生成《00-课程大纲.md》和第一讲讲义。`;
}

export function renderCompass(root: HTMLElement, compass: AttentionCompassSnapshot, actions: CompassActions): void {
  const escape = (value: string): string => value.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
  const materialFor = (id: string | undefined) => actions.materials?.find(item => item.id === id);
  const date = (value: string) => { const parsed = new Date(value); return Number.isNaN(parsed.getTime()) ? "" : `${parsed.getFullYear()}/${parsed.getMonth() + 1}/${parsed.getDate()}`; };
  const toolkit = (id: string) => ({ interline: "行间", shadowing: "影子跟读", feynman: "费曼练习" } as Record<string, string>)[id] ?? id;
  const card = (topic: AttentionCompassSnapshot["exploring"][number]) => {
    const material = materialFor(topic.materialIds[0]), count = topic.notes.length;
    return `<button class="pith-topic-card" data-topic="${escape(topic.id)}"><span class="pith-card-top"><span class="pith-topic-status">探索中${topic.toolkits.length ? ` · ${escape(topic.toolkits.map(toolkit).join(" / "))}` : ""}</span><time>${escape(date(topic.updatedAt))}</time></span><span class="pith-card-body"><span class="pith-card-copy"><strong title="${escape(topic.title)}">${escape(cleanMaterialTitle(topic.title))}</strong>${material ? `<span class="pith-card-material" title="${escape(material.fileName ?? material.title)}">材料：${escape(material.fileName ?? material.title)}</span>` : ""}</span>${material?.coverUrl ? `<img class="pith-card-cover" src="${escape(material.coverUrl)}" alt="">` : ""}</span><span class="pith-card-suggestion">${escape(topic.nextAction || topic.target || "点进材料，框选文字即可高亮、记笔记或问向导")}</span><span class="pith-card-foot"><span>${count ? `已收 ${count} 条笔记/高亮` : "暂无笔记"}</span><span>进入阅读 ${pithIcon("chevron-right")}</span></span></button>`;
  };
  const settled = (topic: AttentionCompassSnapshot["settled"][number]) => { const material = materialFor(topic.materialIds[0]); return `<button class="pith-settled-row" data-topic="${escape(topic.id)}"><span><strong title="${escape(topic.title)}">${escape(cleanMaterialTitle(topic.title))}</strong><small>${material ? `材料：${escape(material.fileName ?? material.title)} · ` : ""}共归档 ${topic.notes.length} 条核心笔记</small></span><span class="pith-topic-status settled">已沉淀</span></button>`; };
  const unreadable = compass.unreadable.length ? `<section class="pith-unreadable" aria-label="无法读取"><div class="pith-home-heading"><h2>无法读取（${compass.unreadable.length}）</h2></div><ul class="pith-unreadable-list">${compass.unreadable.map(entry => `<li><span class="pith-unreadable-kind">${entry.kind === "topic" ? "课题" : "材料"}</span><code>${escape(entry.path)}</code><p>${escape(entry.error)}</p></li>`).join("")}</ul></section>` : "";
  root.classList.add("pith-view");
  root.innerHTML = `<style>${workbenchStyles}</style><header class="pith-view-header"><strong>Pith</strong>${actions.settings ? `<button class="pith-icon" data-home-settings aria-label="设置" title="设置">${pithIcon("settings")}</button>` : ""}</header><div class="pith-home-scroll"><main class="pith-home"><h1>课题看板</h1><form class="pith-intake-box"><div class="pith-intake-row"><button type="button" data-intake-files aria-label="添加文件" title="添加文件">${pithIcon("plus")}</button><input type="file" multiple hidden><input name="title" aria-label="课题或仓库路径" placeholder="输入想探索的问题，可附带带引号的仓库路径…"><button type="submit" data-intake-open aria-label="开启课题" title="开启课题">${pithIcon("arrow-up")}</button></div><div data-intake-selected class="pith-intake-selected"></div><div class="pith-home-status" role="status"></div></form><section class="pith-focus">${compass.focusRecommendation ? `<div><span class="pith-topic-status">下一步 · 15 分钟</span><br><strong>${escape(compass.focusRecommendation.nextAction)}</strong><br>${escape(cleanMaterialTitle(compass.focusRecommendation.title))}</div><button data-topic="${escape(compass.focusRecommendation.topicId)}">继续探索</button>` : "选择一个课题，开始今天的探索。"}</section><section><div class="pith-home-heading"><h2>探索中</h2><span>${compass.exploring.length}</span></div><div class="pith-topic-grid">${compass.exploring.map(card).join("")}</div></section><section><div class="pith-home-heading"><h2>已沉淀</h2><span>${compass.settled.length}</span></div><div class="pith-settled-list">${compass.settled.map(settled).join("")}</div></section>${unreadable}</main></div>`;
  if (actions.setStatus) {
    for (const button of root.querySelectorAll<HTMLButtonElement>(".pith-topic-card")) {
      const id = button.dataset.topic; if (!id) continue;
      const control = document.createElement("button"); control.type = "button"; control.textContent = "搁置"; control.onclick = () => { void actions.setStatus!(id, "shelved"); }; button.after(control);
    }
    if (compass.shelved.length) {
      const section = document.createElement("section"), heading = document.createElement("h2"); heading.textContent = `搁置（${compass.shelved.length}）`; section.append(heading);
      for (const topic of compass.shelved) { const row = document.createElement("div"), open = document.createElement("button"), restore = document.createElement("button"); open.textContent = topic.title; open.onclick = () => actions.open(topic.id); restore.textContent = "恢复"; restore.onclick = () => { void actions.setStatus!(topic.id, "exploring"); }; row.append(open, restore); section.append(row); }
      root.querySelector(".pith-home")!.append(section);
    }
  }
  const form = root.querySelector<HTMLFormElement>(".pith-intake-box")!;
  const files = form.querySelector<HTMLInputElement>('input[type="file"]')!;
  const status = form.querySelector<HTMLElement>(".pith-home-status")!;
  let selected: File[] = [];
  const renderFiles = () => { const container = form.querySelector<HTMLElement>("[data-intake-selected]")!; container.replaceChildren(); selected.forEach((file, index) => { const chip = document.createElement("span"); chip.className = "pith-intake-chip"; chip.append(document.createTextNode(file.name)); const remove = document.createElement("button"); remove.type = "button"; remove.setAttribute("aria-label", `移除 ${file.name}`); remove.innerHTML = pithIcon("close"); remove.onclick = () => { selected.splice(index, 1); renderFiles(); }; chip.append(remove); container.append(chip); }); };
  const addFiles = (list: FileList | null) => { if (list) selected.push(...Array.from(list)); renderFiles(); };
  form.querySelector<HTMLButtonElement>("[data-intake-files]")!.onclick = () => files.click();
  files.onchange = () => { addFiles(files.files); files.value = ""; };
  form.ondragover = event => { event.preventDefault(); };
  form.ondrop = event => { event.preventDefault(); addFiles(event.dataTransfer?.files ?? null); };
  form.onsubmit = event => { event.preventDefault(); const input = (form.elements.namedItem("title") as HTMLInputElement).value.trim(); const repoPaths: string[] = []; const title = input.replace(/"((?:[^"\\]|\\["\\])+)"/g, (match, path: string) => { const decoded = path.replace(/\\(["\\])/g, "$1"); if (!/^(?:\/|~\/|[a-z]:[\\/])/i.test(decoded)) return match; repoPaths.push(decoded); return " "; }).replace(/\s+/g, " ").trim(); const repoPath = !selected.length && !repoPaths.length && /^(?:\/|~\/|[a-z]:[\\/])/i.test(input) ? input : ""; const url = !selected.length && !repoPaths.length && /^https?:\/\/\S+$/i.test(input) ? input : ""; if (!input && !selected.length) { status.textContent = "请输入课题或添加材料"; return; } const buttons = Array.from(form.querySelectorAll<HTMLButtonElement>("button")); buttons.forEach(button => button.disabled = true); status.textContent = ""; void Promise.resolve().then(() => actions.create({ title: repoPath || url ? "" : title, files: [...selected], repoPath, repoPaths: [...new Set(repoPaths)], url, guide: !!input && !url })).catch(error => { status.textContent = error instanceof Error ? error.message : String(error); }).finally(() => { buttons.forEach(button => button.disabled = false); }); };
  const settings = root.querySelector<HTMLButtonElement>("[data-home-settings]");
  if (settings && actions.settings) settings.onclick = actions.settings;
  for (const button of root.querySelectorAll<HTMLButtonElement>("[data-topic]")) button.onclick = () => { if (button.dataset.topic) actions.open(button.dataset.topic); };
}
