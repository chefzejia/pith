import type { GuideConversationEntry, GuideQuickAction, SelectionAnchor, TopicNote } from "../../core/index.ts";
import { displayPracticeMessage } from "../../plugins/dojo-feynman/index.ts";

export function renderGuide(guide: HTMLElement, data: { notes: readonly TopicNote[]; conversation: readonly GuideConversationEntry[]; actions: readonly GuideQuickAction[] }, tab: "chat" | "notes", anchor: SelectionAnchor | undefined, sending: boolean): void {
  const previous = guide.querySelector<HTMLTextAreaElement>("textarea"), draft = previous?.value ?? "";
  const selection = previous && guide.ownerDocument.activeElement === previous ? { start: previous.selectionStart, end: previous.selectionEnd, direction: previous.selectionDirection } : null;
  const escape = (s: string): string => s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
  const latest = data.conversation.findLast(entry => entry.role === "guide"), choices = latest?.choices ?? [];
  const conversation = data.conversation.map(entry => `<p><strong>${entry.role === "user" ? "你" : "向导"}</strong><br>${escape(displayPracticeMessage(entry.text))}</p>${entry === latest ? choices.map((choice, index) => `<button class="pith-choice-btn" data-guide-prompt="${escape(choice)}"><span>${index + 1}.</span> ${escape(choice)}</button>`).join("") : ""}`).join("");
  const quick = choices.length ? "" : `<div class="pith-quick-actions">${data.actions.map(action => `<button data-guide-prompt="${escape(action.prompt)}">${escape(action.label)}</button>`).join("")}</div>`;
  guide.innerHTML = `<div class="pith-guide-tabs"><button data-guide-tab="chat" aria-pressed="${tab === "chat"}">对话</button><button data-guide-tab="notes" aria-pressed="${tab === "notes"}">笔记 ${data.notes.length}</button></div><div class="pith-guide-content">${tab === "chat" ? conversation + quick : data.notes.map(note => note.anchor ? `<button class="pith-note-source" data-note-id="${escape(note.id)}" title="跳回原文"><strong>${escape(note.kind)}</strong><br>${escape(note.body)}</button>` : `<p><strong>${escape(note.kind)}</strong><br>${escape(note.body)}</p>`).join("")}</div><div class="pith-guide-compose"><blockquote>${anchor && anchor.quote ? escape(anchor.quote) : ""}</blockquote><textarea aria-label="消息"></textarea><div data-guide-error role="alert"></div><button data-guide-send>发送</button></div>`;
  const input = guide.querySelector<HTMLTextAreaElement>("textarea")!; input.value = draft; guide.querySelector<HTMLButtonElement>("[data-guide-send]")!.disabled = sending;
  if (selection) { input.focus({ preventScroll: true }); input.setSelectionRange(selection.start, selection.end, selection.direction); }
}
