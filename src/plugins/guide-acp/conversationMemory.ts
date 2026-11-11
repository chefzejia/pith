import type { GuideConversationEntry } from "../../core/index.ts";

export const HISTORY_MAX_ENTRIES = 16;
export const HISTORY_MAX_ENTRY_CHARS = 2_000;
export const HISTORY_MAX_TOTAL_CHARS = 12_000;
export const HISTORY_ELISION = "\n…（中间省略）…\n";

export interface PracticePayload { readonly id: "feynman"; readonly label: string; readonly rubric: string; readonly text: string }
export interface GuideHistoryTurn { readonly role: "user" | "guide"; readonly text: string }

/** Decodes a `PITH_PRACTICE:` conversation entry; ordinary messages and malformed payloads yield null. */
export function parsePracticePayload(text: string): PracticePayload | null {
  if (!text.startsWith("PITH_PRACTICE:")) return null;
  let value: unknown;
  try { value = JSON.parse(text.slice("PITH_PRACTICE:".length)); } catch { return null; }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.id !== "feynman" || typeof record.text !== "string" || typeof record.label !== "string" || typeof record.rubric !== "string") return null;
  return { id: record.id, label: record.label, rubric: record.rubric, text: record.text };
}

/** Keeps the head and the tail of an over-long turn; the tail gets the larger share because a guide reply ends with its question. */
function clip(text: string, limit: number): string {
  const points = Array.from(text);
  if (points.length <= limit) return text;
  const room = limit - Array.from(HISTORY_ELISION).length, head = Math.floor(room * 0.3);
  return points.slice(0, head).join("") + HISTORY_ELISION + points.slice(points.length - (room - head)).join("");
}

/**
 * The turns before `current`, oldest first, for the guide prompt.
 * Selection walks back from the newest turn and stops at the first one that exceeds a budget, so the kept turns are contiguous.
 * Lengths count code points. The latest guide turn carries the choices it offered, so "the second option" stays resolvable.
 * Alternative considered: one long-lived agent session per topic. Rejected: agent sessions stay disposable (docs/PRODUCT.md),
 * and a replayed prompt keeps every turn independent of process lifetime and of the agent in use.
 */
export function selectConversationHistory(conversation: readonly GuideConversationEntry[], current: GuideConversationEntry | undefined): GuideHistoryTurn[] {
  const end = current ? conversation.lastIndexOf(current) : -1;
  const prior = end < 0 ? conversation : conversation.slice(0, end);
  const latestGuide = prior.findLastIndex(entry => entry.role === "guide");
  const turns: GuideHistoryTurn[] = [];
  let total = 0;
  for (let index = prior.length - 1; index >= 0 && turns.length < HISTORY_MAX_ENTRIES; index--) {
    const entry = prior[index]!;
    const practice = entry.role === "user" ? parsePracticePayload(entry.text) : null;
    const choices = index === latestGuide && entry.choices && entry.choices.length ? `\n（当时给出的选项：${entry.choices.join("；")}）` : "";
    const text = clip(`${(practice ? practice.text : entry.text).trim()}${choices}`, HISTORY_MAX_ENTRY_CHARS);
    if (!text) continue;
    const size = Array.from(text).length;
    if (total + size > HISTORY_MAX_TOTAL_CHARS) break;
    total += size;
    turns.unshift({ role: entry.role, text });
  }
  return turns;
}
