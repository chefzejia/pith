import type { Note } from "../../core/index.ts";
import type { RecallResult, RecallStatus } from "../../plugins/toolkit-feynman/index.ts";

const labels: Record<RecallStatus, string> = { covered: "已说到", missing: "未提及", contradicted: "与原文相反", unverified: "未能核对" };
const escape = (text: string): string => text.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
export function previousRecall(notes: readonly Note[], recordId: string, passage: string): ReadonlyMap<string, RecallStatus> {
  const index = notes.findIndex(note => note.id === recordId);
  const earlier = index < 0 ? notes : notes.slice(0, index);
  const prior = earlier.findLast(note => note.kind === "practice" && note.result?.toolkit === "feynman" && note.result.passage === passage);
  const statuses = new Map<string, RecallStatus>();
  if (Array.isArray(prior?.result?.points)) {
    for (const point of prior.result.points) {
      if (typeof point?.id === "string" && Object.hasOwn(labels, point.status)) statuses.set(point.id, point.status);
    }
  }
  return statuses;
}

export function renderRecallResult(result: Readonly<Record<string, unknown>> | undefined, previous?: ReadonlyMap<string, RecallStatus>): string {
  if (result?.toolkit !== "feynman" || !Array.isArray(result.points)) return "";
  return `<div class="pith-recall-results">${(result as RecallResult).points.map(point => {
    const prior = previous?.get(point.id);
    return `<section data-recall-status="${escape(point.status)}"><strong>${labels[point.status]}</strong>${prior && prior !== point.status ? ` <small>上次：${labels[prior]}</small>` : ""}<p>${escape(point.claim)}</p><blockquote><small>原文</small><br>${escape(point.sourceQuote)}</blockquote>${point.quote ? `<blockquote><small>你的原话</small><br>${escape(point.quote)}</blockquote>` : ""}</section>`;
  }).join("")}</div>`;
}
