import type { GuideConversationEntry, GuideQuickAction, SelectionAnchor, TopicNote } from "../../core/index.ts";
import { displayPracticeMessage } from "../../plugins/toolkit-feynman/index.ts";

export function renderGuide(guide: HTMLElement, data: { notes: readonly TopicNote[]; conversation: readonly GuideConversationEntry[]; actions: readonly GuideQuickAction[] }, tab: "chat" | "notes", anchor: SelectionAnchor | undefined, sending: boolean, pending?: { readonly text: string; readonly from: number }, error = ""): void {
  const previous = guide.querySelector<HTMLTextAreaElement>("textarea"), draft = previous?.value ?? "";
  const selection = previous && guide.ownerDocument.activeElement === previous ? { start: previous.selectionStart, end: previous.selectionEnd, direction: previous.selectionDirection } : null;
  const escape = (s: string): string => s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
  // A running turn owns the entries from `pending.from` on: its message shows once, and the waiting status lasts until its reply is among them.
  const fresh = pending ? data.conversation.slice(pending.from) : [], waiting = pending !== undefined && !fresh.some(entry => entry.role === "guide");
  const latest = data.conversation.findLast(entry => entry.role === "guide"), choices = waiting ? [] : latest?.choices ?? [];
  const conversation = data.conversation.map(entry => `<p><strong>${entry.role === "user" ? "你" : "向导"}</strong><br>${escape(displayPracticeMessage(entry.text))}</p>${entry === latest ? choices.map((choice, index) => `<button class="pith-choice-btn" data-guide-prompt="${escape(choice)}"><span>${index + 1}.</span> ${escape(choice)}</button>`).join("") : ""}`).join("");
  const turn = pending && waiting ? `${fresh.some(entry => entry.role === "user") ? "" : `<p class="pith-guide-pending-message"><strong>你</strong><br>${escape(displayPracticeMessage(pending.text))}</p>`}<p class="pith-guide-pending" role="status">向导正在回应，可能需要几分钟…</p>` : "";
  const shown = guide.querySelector<HTMLElement>(".pith-guide-content"), scrollTop = shown && shown.dataset.guideContent === tab ? shown.scrollTop : 0;
  const quick = waiting || choices.length ? "" : `<div class="pith-quick-actions">${data.actions.map(action => `<button data-guide-prompt="${escape(action.prompt)}">${escape(action.label)}</button>`).join("")}</div>`;
  guide.innerHTML = `<div class="pith-guide-tabs"><button data-guide-tab="chat" aria-pressed="${tab === "chat"}">对话</button><button data-guide-tab="notes" aria-pressed="${tab === "notes"}">笔记 ${data.notes.length}</button></div><div class="pith-guide-content" data-guide-content="${tab}">${tab === "chat" ? conversation + turn + quick : data.notes.map(note => note.anchor ? `<button class="pith-note-source" data-note-id="${escape(note.id)}" title="跳回原文"><strong>${escape(note.kind)}</strong><br>${escape(note.body)}</button>` : `<p><strong>${escape(note.kind)}</strong><br>${escape(note.body)}</p>`).join("")}</div><div class="pith-guide-compose"><blockquote>${anchor && anchor.quote ? escape(anchor.quote) : ""}</blockquote><textarea aria-label="消息"></textarea><div data-guide-error role="alert">${escape(error)}</div><button data-guide-send>发送</button></div>`;
  const input = guide.querySelector<HTMLTextAreaElement>("textarea")!; input.value = draft; guide.querySelector<HTMLButtonElement>("[data-guide-send]")!.disabled = sending;
  // The list keeps its scroll position across renders of one tab; a waiting turn brings its status into view.
  const content = guide.querySelector<HTMLElement>(".pith-guide-content")!, status = content.querySelector<HTMLElement>(".pith-guide-pending");
  content.scrollTop = scrollTop; if (status) status.scrollIntoView({ block: "nearest" });
  if (selection) { input.focus({ preventScroll: true }); input.setSelectionRange(selection.start, selection.end, selection.direction); }
}
