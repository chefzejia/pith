import type { GuideTurn } from "../../core/index.ts";

export const HISTORY_MAX_ENTRIES = 16;
export const HISTORY_MAX_ENTRY_CHARS = 2_000;
export const HISTORY_MAX_TOTAL_CHARS = 12_000;
export const HISTORY_ELISION = "\n…（中间省略）…\n";

export interface GuideHistoryTurn { readonly role: "user" | "guide"; readonly text: string }

function clip(text: string, limit: number): string {
  const points = Array.from(text);
  if (points.length <= limit) return text;
  const room = limit - Array.from(HISTORY_ELISION).length, head = Math.floor(room * 0.3);
  return points.slice(0, head).join("") + HISTORY_ELISION + points.slice(points.length - (room - head)).join("");
}

export function selectConversationHistory(conversation: readonly GuideTurn[]): GuideHistoryTurn[] {
  const entries: GuideHistoryTurn[] = [];
  const latest = conversation.length - 1;
  for (const [index, turn] of conversation.entries()) {
    entries.push({ role: "user", text: turn.user.text });
    const reply = turn.steps.flatMap(step => step.kind === "reply" ? [step.markdown] : []).join("");
    const choices = index === latest && turn.choices.length ? `\n（当时给出的选项：${turn.choices.join("；")}）` : "";
    if (reply || choices) entries.push({ role: "guide", text: reply + choices });
  }
  const selected: GuideHistoryTurn[] = [];
  let total = 0;
  for (let index = entries.length - 1; index >= 0 && selected.length < HISTORY_MAX_ENTRIES; index--) {
    const entry = entries[index]!;
    const text = clip(entry.text.trim(), HISTORY_MAX_ENTRY_CHARS);
    if (!text) continue;
    const size = Array.from(text).length;
    if (total + size > HISTORY_MAX_TOTAL_CHARS) break;
    total += size;
    selected.unshift({ role: entry.role, text });
  }
  return selected;
}
