import type { GuideTurn, TurnStep } from "./contract.ts";

const priorCall = "previous-attempt:";

/** Receipts retain their original outcome; they are never calls in the new attempt. */
export function isPreviousAttempt(step: TurnStep): boolean {
  return step.kind === "tool" && step.callId.startsWith(priorCall);
}

export function retryReceipts(turn: GuideTurn): TurnStep[] {
  return turn.steps.flatMap(step => {
    if (step.kind !== "tool" || !step.effects.length) return [];
    if (isPreviousAttempt(step)) return [step];
    return [{ ...step, callId: `${priorCall}${turn.startedAt}:${step.callId}`,
      status: step.status === "running" ? "failed" as const : step.status,
      summary: [turn.error, step.summary].filter(Boolean).join("；") || undefined }];
  });
}
