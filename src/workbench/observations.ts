import type { AttentionEngine, WorkspaceStore } from "../core/index.ts";

export async function topicObservations(store: WorkspaceStore, topicId: string): Promise<readonly string[]> {
  return (await store.readProfile()).observations.filter(item => item.topicId === topicId).map(item => item.id);
}

export async function undoTopicObservation(store: WorkspaceStore, engine: AttentionEngine, topicId: string, observationId: string): Promise<void> {
  const conversation = await engine.getConversation(topicId);
  const recorded = conversation.some(turn => turn.steps.some(step => step.kind === "tool" && step.name === "pith_settle_topic" && step.effects.some(effect => effect.kind === "observation" && effect.observationId === observationId)));
  if (!recorded || !(await topicObservations(store, topicId)).includes(observationId)) throw new Error("画像观察不存在或已撤销");
  await store.removeObservation(observationId);
}
