import type { GuideTurn, GuideQuickAction, SelectionAnchor, TopicNote } from "../../core/index.ts";
import { renderMarkdown } from "../../plugins/stage-reader/index.ts";

const escape = (s: string): string => s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
function toolLabel(name: string, preview: string): string {
  const labels: Record<string, string> = { pith_read_material: "读取", pith_read_lesson: "读取讲义", pith_list_material: "查看材料", pith_write_lesson: "写入讲义", pith_save_note: "记录笔记", pith_settle_topic: "结题", pith_offer_choices: "准备选项", pith_ingest_external: "导入材料", pith_fetch_media_corpus: "导入材料", pith_search_media: "搜索媒体", pith_configure_toolkits: "配置工具" };
  let object = "";
  try { const input: unknown = JSON.parse(preview); if (input && typeof input === "object") { const record = input as Record<string, unknown>; const value = record.fileName ?? record.file ?? record.url; if (typeof value === "string") object = value; } } catch { /* Previews may be truncated. */ }
  return `${labels[name] ?? name}${object ? ` ${object}` : ""}`;
}

export function renderGuide(guide: HTMLElement, data: { notes: readonly TopicNote[]; conversation: readonly GuideTurn[]; actions: readonly GuideQuickAction[]; observations?: readonly string[] }, tab: "chat" | "notes", anchor: SelectionAnchor | undefined, sending: boolean, pending?: { readonly text: string; readonly from: number }, error = ""): void {
  const previous = guide.querySelector<HTMLTextAreaElement>("textarea"), draft = previous?.value ?? "";
  const shown = guide.querySelector<HTMLElement>(".pith-guide-content"), sameTab = shown?.dataset.guideContent === tab;
  const scrollTop = sameTab ? shown!.scrollTop : 0, follow = !sameTab || shown!.scrollHeight - shown!.clientHeight - scrollTop < 32;
  const open = new Map(Array.from(guide.querySelectorAll<HTMLDetailsElement>("details[data-process]"), node => [node.dataset.process!, { open: node.open, status: node.closest<HTMLElement>("[data-turn-status]")?.dataset.turnStatus }]));
  const latest = data.conversation.at(-1), choices = sending ? [] : latest?.choices ?? [];
  const conversation = data.conversation.map(entry => {
    const parts: string[] = [`<div class="pith-guide-user">${escape(entry.user.text)}</div>`];
    let process: typeof entry.steps[number][] = [], group = 0;
    const flush = () => {
      if (!process.length) return;
      const key = `${entry.id}:${group++}`, previousState = open.get(key), expanded = previousState?.status === entry.status ? previousState.open : entry.status !== "completed";
      const rows = process.map(step => step.kind === "thought" ? `<details class="pith-guide-thought"><summary>思考</summary><div>${escape(step.text)}</div></details>` : step.kind === "tool" ? `<div class="pith-guide-step" data-step-status="${step.status}">${escape(toolLabel(step.name, step.inputPreview))}${step.summary && step.status === "failed" ? ` · ${escape(step.summary)}` : ""}${step.status === "running" ? " · 进行中" : step.status === "failed" ? " · 失败" : " · 完成"}</div>${step.effects.filter(effect => effect.kind !== "observation").map(effect => effect.kind === "lesson" ? `<button data-guide-lesson="${escape(effect.fileName)}">讲义《${escape(effect.fileName)}》</button>` : effect.kind === "note" ? `<button data-note-id="${escape(effect.noteId)}">笔记</button>` : effect.kind === "material" ? `<button data-guide-material="${escape(effect.materialId)}">材料</button>` : "").join("")}` : "").join("");
      const count = process.filter(step => step.kind === "tool").length;
      const reads = process.filter(step => step.kind === "tool" && step.status === "completed" && step.name.startsWith("pith_read_")).length;
      const lessons = process.filter(step => step.kind === "tool" && step.status === "completed" && step.effects.some(effect => effect.kind === "lesson")).length;
      const summary = [reads ? `读取 ${reads} 次` : "", lessons ? `写入 ${lessons} 份讲义` : ""].filter(Boolean).join("，") || `${count} 个工具步骤`;
      parts.push(`<details class="pith-guide-process" data-process="${escape(key)}" ${expanded ? "open" : ""}><summary aria-expanded="${expanded}">${entry.status === "completed" ? `已完成 · ${summary}` : "过程"}</summary>${rows}</details>`);
      for (const step of process) if (step.kind === "tool") for (const effect of step.effects) if (effect.kind === "observation") parts.push(`<div class="pith-guide-observation">记入画像：${escape(effect.text)} ${data.observations?.includes(effect.observationId) ? `<button data-guide-undo="${escape(effect.observationId)}">撤销</button>` : "已撤销"}</div>`);
      process = [];
    };
    entry.steps.forEach((step, index) => {
      if (step.kind !== "reply") { process.push(step); return; }
      flush(); if (step.markdown.trim()) parts.push(`<div class="pith-guide-reply">${renderMarkdown(step.markdown)}<button data-guide-copy="${escape(entry.id)}" data-guide-copy-index="${index}">复制</button></div>`);
    });
    flush();
    if (entry.status === "running") { const current = [...entry.steps].reverse().find(step => step.kind === "tool" && step.status === "running"); parts.push(`<div class="pith-guide-pending" role="status" data-started="${escape(entry.startedAt)}">${current && current.kind === "tool" ? escape(toolLabel(current.name, current.inputPreview)) : "向导正在回应"} · <span data-guide-elapsed></span></div>`); }
    if (entry.status === "failed") parts.push(`<div class="pith-guide-failure" role="alert">${escape(entry.error ?? "向导请求失败")} <button data-guide-retry="${escape(entry.id)}">重新请求</button></div>`);
    if (entry.status === "stopped") parts.push(`<div class="pith-guide-stopped">已停止 <button data-guide-retry="${escape(entry.id)}">重新请求</button></div>`);
    if (entry === latest) parts.push(...choices.map((choice, index) => `<button class="pith-choice-btn" data-guide-prompt="${escape(choice)}" data-guide-choice><span>${index + 1}.</span> ${escape(choice)}</button>`));
    return `<section class="pith-guide-turn" data-turn-status="${entry.status}">${parts.join("")}</section>`;
  }).join("");
  const fresh = pending ? data.conversation.slice(pending.from) : [];
  const waiting = pending && sending && !fresh.length && !data.conversation.some(turn => turn.status === "running") ? `${pending.text ? `<div class="pith-guide-user">${escape(pending.text)}</div>` : ""}<div class="pith-guide-pending" role="status">向导正在回应</div>` : "";
  const quick = sending || choices.length ? "" : `<div class="pith-quick-actions">${data.actions.map(action => `<button data-guide-prompt="${escape(action.prompt)}">${escape(action.label)}</button>`).join("")}</div>`;
  const markup = `<div class="pith-guide-tabs"><button data-guide-tab="chat" aria-pressed="${tab === "chat"}">对话</button><button data-guide-tab="notes" aria-pressed="${tab === "notes"}">笔记 ${data.notes.length}</button></div><div class="pith-guide-content" data-guide-content="${tab}">${tab === "chat" ? conversation + waiting + quick : data.notes.map(note => note.anchor ? `<button class="pith-note-source" data-note-id="${escape(note.id)}" title="跳回原文"><strong>${escape(note.kind)}</strong><br>${escape(note.body)}</button>` : `<p><strong>${escape(note.kind)}</strong><br>${escape(note.body)}</p>`).join("")}</div><button data-guide-bottom ${follow ? "hidden" : ""}>回到底部</button><div class="pith-guide-compose"><blockquote>${anchor?.quote ? escape(anchor.quote) : ""}</blockquote><textarea aria-label="消息" placeholder="给向导发消息"></textarea><div data-guide-error role="alert">${escape(error)}</div>${sending ? '<button data-guide-stop>停止</button>' : '<button data-guide-send>发送</button>'}</div>`;
  const compose = guide.querySelector<HTMLElement>(".pith-guide-compose");
  if (compose && previous) {
    const next = guide.ownerDocument.createElement("div"); next.innerHTML = markup;
    for (const selector of [".pith-guide-tabs", ".pith-guide-content", "[data-guide-bottom]"]) guide.querySelector(selector)!.replaceWith(next.querySelector(selector)!);
    compose.querySelector("blockquote")!.textContent = anchor?.quote ?? "";
    compose.querySelector("[data-guide-error]")!.textContent = error;
    const oldButton = compose.querySelector<HTMLButtonElement>("[data-guide-send],[data-guide-stop]")!, newButton = next.querySelector<HTMLButtonElement>("[data-guide-send],[data-guide-stop]")!;
    if (oldButton.hasAttribute("data-guide-send") !== newButton.hasAttribute("data-guide-send")) oldButton.replaceWith(newButton);
  } else guide.innerHTML = markup;
  const input = guide.querySelector<HTMLTextAreaElement>("textarea")!; if (!previous) input.value = draft;
  const content = guide.querySelector<HTMLElement>(".pith-guide-content")!;
  content.scrollTop = follow ? content.scrollHeight : scrollTop;
}
