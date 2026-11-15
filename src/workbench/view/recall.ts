import type { RecallResult, RecallStatus } from "../../plugins/toolkit-feynman/index.ts";

const labels: Record<RecallStatus, string> = { covered: "已说到", missing: "未提及", contradicted: "与原文相反", unverified: "未能核对" };
const escape = (text: string): string => text.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
export function renderRecallResult(result: Readonly<Record<string, unknown>> | undefined): string {
  if (result?.toolkit !== "feynman" || !Array.isArray(result.points)) return "";
  return `<div class="pith-recall-results">${(result as RecallResult).points.map(point => `<section data-recall-status="${escape(point.status)}"><strong>${labels[point.status]}</strong><p>${escape(point.claim)}</p><blockquote><small>原文</small><br>${escape(point.sourceQuote)}</blockquote>${point.quote ? `<blockquote><small>你的原话</small><br>${escape(point.quote)}</blockquote>` : ""}</section>`).join("")}</div>`;
}
