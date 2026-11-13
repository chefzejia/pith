import type { GuideTurn } from "../../core/index.ts";

/** A terminal turn cannot confirm the result of a tool whose final update never arrived. */
export function recoverInterruptedToolSteps(turn: GuideTurn): GuideTurn {
  if (turn.status === "running" || !turn.steps.some(step => step.kind === "tool" && step.status === "running")) return turn;
  return { ...turn, steps: turn.steps.map(step => step.kind === "tool" && step.status === "running"
    ? { ...step, status: "failed", summary: turn.error ?? "工具结果未确认" }
    : step) };
}
