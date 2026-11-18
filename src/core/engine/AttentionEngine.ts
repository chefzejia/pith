import type { WorkspaceStoragePort } from "../host.ts";
import type { WorkspaceStore } from "../store/contract.ts";
import { MutationQueue } from "../store/MutationQueue.ts";
import { retryReceipts } from "./retryRecovery.ts";
import type { AttentionCompassSnapshot, AttentionEngine, EffectHandler, EffectKind, EffectRecord, GuideProvider, GuideTurn, TurnOptions, TurnStep } from "./contract.ts";

const recovered = new WeakSet<object>();

const runningTopics = new WeakMap<object, Set<string>>();

function component(value: string): string {
  if (!value || value === "." || value === ".." || /[/\\\0]/.test(value)) throw new Error("Invalid topic id");
  return value;
}

function turnUser({ text, anchor }: GuideTurn["user"]): GuideTurn["user"] {
  return { text, ...(anchor ? { anchor } : {}) };
}

function conversationTurn(turn: GuideTurn): GuideTurn {
  return { ...turn, user: turnUser(turn.user) };
}

export class DefaultAttentionEngine implements AttentionEngine {
  private readonly store: WorkspaceStore;
  private readonly storage: WorkspaceStoragePort;
  private readonly queue: MutationQueue;
  private readonly handlers = new Map<EffectKind, EffectHandler>();
  private readonly provider: (() => GuideProvider | undefined) | undefined;

  constructor(store: WorkspaceStore, storage: WorkspaceStoragePort, provider?: () => GuideProvider | undefined) {
    this.store = store;
    this.storage = storage;
    this.queue = MutationQueue.forStorage(storage);
    this.provider = provider;
  }

  private async readArray<T>(path: string): Promise<T[]> {
    if (!await this.storage.exists(path)) return [];
    const parsed: unknown = JSON.parse(await this.storage.readText(path));
    if (!Array.isArray(parsed)) throw new Error(`Invalid cache: ${path}`);
    return parsed as T[];
  }
  private async writeArray(path: string, value: readonly unknown[]): Promise<void> {
    await this.storage.mkdir("_cache");
    await this.storage.writeText(path, `${JSON.stringify(value, null, 2)}\n`);
  }
  async compass(): Promise<AttentionCompassSnapshot> {
    const [topics, materials, effects, unreadable] = await Promise.all([this.store.listTopics(), this.store.listMaterials(), this.listEffects(), this.store.listUnreadable()]);
    const exploring = topics.filter(topic => topic.status === "exploring");
    const shelved = topics.filter(topic => topic.status === "shelved");
    const settled = topics.filter(topic => topic.status === "settled");
    const library = materials.map(material => ({ material, topicIds: topics.filter(topic => topic.materialIds.includes(material.id)).map(topic => topic.id) }));
    const focus = exploring.find(topic => Boolean(topic.nextAction));
    return { exploring, shelved, settled, library, unreadable, focusRecommendation: focus && focus.nextAction ? { topicId: focus.id, title: focus.title, nextAction: focus.nextAction } : null,
      pendingEffectsCount: effects.filter(effect => effect.status === "pending" || effect.status === "running").length };
  }
  async capture(input: Parameters<AttentionEngine["capture"]>[0]): ReturnType<AttentionEngine["capture"]> {
    const data = { kind: input.kind, author: "user" as const, body: input.body, anchor: input.anchor, result: input.result };
    if ("materialId" in input.owner) return this.store.appendMaterialNote(input.owner.materialId, data);
    const note = await this.store.appendTopicNote(input.owner.topicId, data);
    await this.enqueueEffect("prepare-next-action", input.owner.topicId, { topicId: input.owner.topicId, noteId: note.id });
    return note;
  }
  async intake(input: Parameters<AttentionEngine["intake"]>[0], options?: TurnOptions): ReturnType<AttentionEngine["intake"]> {
    const provider = this.provider?.();
    if (!provider) throw new Error("向导不可用");
    if (!input.text.trim()) throw new Error("Message is empty");
    const controller = new AbortController(), abort = () => controller.abort(options?.signal?.reason);
    if (options?.signal?.aborted) abort(); else options?.signal?.addEventListener("abort", abort, { once: true });
    let turn: GuideTurn = { id: crypto.randomUUID(), status: "running", startedAt: new Date().toISOString(), user: { text: input.text }, steps: [], choices: [] };
    let topicId: string | undefined, pending = Promise.resolve();
    const publish = (next: GuideTurn) => {
      turn = next; options?.onUpdate?.(next);
      const found = next.steps.flatMap(step => step.kind === "tool" ? step.effects : []).find(effect => effect.kind === "topic");
      if (found?.kind === "topic") topicId = found.topicId;
      if (topicId) {
        const id = component(topicId);
        pending = pending.then(() => this.queue.run(async () => {
          await this.storage.writeText(`topics/${id}/conversation.json`, `${JSON.stringify([...(input.previous ?? []), next], null, 2)}\n`);
        }));
      }
    };
    options?.onUpdate?.(turn);
    try {
      let result: Awaited<ReturnType<GuideProvider["run"]>>;
      try { result = await provider.run({ scope: { kind: "intake", materialIds: input.materialIds }, text: input.text, history: input.previous ?? [] }, {
        signal: controller.signal,
        onStep: (step, index) => { const steps = [...turn.steps]; if (index < 0 || index > steps.length) throw new Error("Invalid step index"); steps[index] = step; publish({ ...turn, steps }); },
        onChoices: choices => publish({ ...turn, choices: [...choices] }),
      }); } catch (error) { result = controller.signal.aborted ? { status: "stopped" } : { status: "failed", error: error instanceof Error ? error.message : String(error) }; }
      const status = controller.signal.aborted ? "stopped" : result.status;
      publish({ ...turn, status, endedAt: new Date().toISOString(), ...(status === "failed" && result.status === "failed" ? { error: result.error } : status === "stopped" ? { error: "已停止" } : {}) });
      await pending;
      return { topic: topicId ? await this.store.getTopic(topicId) : null, turn };
    } finally { options?.signal?.removeEventListener("abort", abort); }
  }
  getConversation(topicId: string): Promise<readonly GuideTurn[]> {
    const id = component(topicId), path = `topics/${id}/conversation.json`;
    return this.queue.run(async () => {
      const turns = await this.readArray<GuideTurn>(path);
      const active = runningTopics.get(this.storage.mutationIdentity ?? this.storage);
      return turns.map(conversationTurn).map(turn => turn.status === "running" && !active?.has(id) ? { ...turn, status: "stopped", error: "进程中断" } : turn);
    });
  }
  runTurn(input: Parameters<AttentionEngine["runTurn"]>[0], options?: TurnOptions): Promise<GuideTurn> {
    if (!input.text.trim()) throw new Error("Message is empty");
    return this.executeTurn(input.topicId, turnUser(input), undefined, options);
  }
  async retryTurn(topicId: string, turnId: string, options?: TurnOptions): Promise<GuideTurn> {
    const prior = (await this.getConversation(topicId)).find(turn => turn.id === turnId);
    if (!prior || (prior.status !== "failed" && prior.status !== "stopped")) throw new Error("Turn cannot be retried");
    return this.executeTurn(topicId, prior.user, turnId, options);
  }
  private async executeTurn(topicId: string, user: GuideTurn["user"], replaceId: string | undefined, options?: TurnOptions): Promise<GuideTurn> {
    const id = component(topicId), path = `topics/${id}/conversation.json`, identity = this.storage.mutationIdentity ?? this.storage;
    let active = runningTopics.get(identity);
    if (!active) { active = new Set(); runningTopics.set(identity, active); }
    if (active.has(id)) throw new Error("Topic already has a running turn");
    active.add(id);
    const controller = new AbortController();
    const abort = () => controller.abort(options?.signal?.reason);
    if (options?.signal?.aborted) abort(); else options?.signal?.addEventListener("abort", abort, { once: true });
    try {
      if (!await this.store.getTopic(id)) throw new Error("Topic not found");
      let turn: GuideTurn = { id: replaceId ?? crypto.randomUUID(), status: "running", startedAt: new Date().toISOString(), user, steps: [], choices: [] };
      let history: GuideTurn[] = [];
      let receipts: TurnStep[] = [];
      await this.queue.run(async () => {
        const turns = await this.readArray<GuideTurn>(path);
        const index = replaceId === undefined ? -1 : turns.findIndex(item => item.id === replaceId);
        if (replaceId !== undefined && (index < 0 || !["stopped", "failed", "running"].includes(turns[index]!.status))) throw new Error("Turn cannot be retried");
        if (index >= 0) { receipts = retryReceipts(turns[index]!); turn = { ...turn, steps: receipts }; }
        history = (index < 0 ? turns : turns.slice(0, index)).map(conversationTurn);
        if (index < 0) turns.push(turn); else turns[index] = turn;
        await this.storage.writeText(path, `${JSON.stringify(turns, null, 2)}\n`);
      });
      options?.onUpdate?.(turn);
      let pending = Promise.resolve();
      const publish = (next: GuideTurn) => {
        turn = next;
        options?.onUpdate?.(next);
        pending = pending.then(() => this.queue.run(async () => {
          const turns = await this.readArray<GuideTurn>(path), index = turns.findIndex(item => item.id === next.id);
          if (index < 0) throw new Error("Running turn is missing");
          turns[index] = next;
          await this.storage.writeText(path, `${JSON.stringify(turns, null, 2)}\n`);
        }));
      };
      let result: Awaited<ReturnType<GuideProvider["run"]>>;
      try {
        const provider = this.provider?.();
        if (!provider) throw new Error("向导不可用");
        result = await provider.run({ scope: { kind: "topic", topicId: id }, ...user, history }, {
          signal: controller.signal,
          onStep: (step: TurnStep, index: number) => { const steps = turn.steps.slice(receipts.length); if (index < 0 || index > steps.length) throw new Error("Invalid step index"); steps[index] = step; publish({ ...turn, steps: [...receipts, ...steps] }); },
          onChoices: choices => publish({ ...turn, choices: [...choices] }),
        });
      } catch (error) { result = controller.signal.aborted ? { status: "stopped" } : { status: "failed", error: error instanceof Error ? error.message : String(error) }; }
      const status = controller.signal.aborted ? "stopped" : result.status;
      publish({ ...turn, status, endedAt: new Date().toISOString(), ...(status === "failed" && result.status === "failed" ? { error: result.error } : status === "stopped" ? { error: "已停止" } : {}) });
      await pending;
      return turn;
    } finally {
      options?.signal?.removeEventListener("abort", abort);
      active.delete(id);
    }
  }
  enqueueEffect(kind: EffectKind, key: string, payload: Readonly<Record<string, unknown>>): Promise<EffectRecord> {
    if (!key) throw new Error("Effect key is empty");
    return this.queue.run(async () => {
      const effects = await this.readArray<EffectRecord>("_cache/effects.json");
      const now = new Date().toISOString();
      const index = effects.findIndex(effect => effect.kind === kind && effect.key === key && effect.status === "pending");
      const record: EffectRecord = { kind, key, payload, status: "pending", attempts: index < 0 ? 0 : effects[index]!.attempts, dueAt: now, updatedAt: now };
      if (index < 0) effects.push(record); else effects[index] = record;
      await this.writeArray("_cache/effects.json", effects);
      return record;
    });
  }
  listEffects(): Promise<readonly EffectRecord[]> { return this.queue.run(() => this.readArray<EffectRecord>("_cache/effects.json")); }
  registerEffectHandler(kind: EffectKind, handler: EffectHandler): () => void {
    this.handlers.set(kind, handler);
    return () => { if (this.handlers.get(kind) === handler) this.handlers.delete(kind); };
  }
  async processDueEffects(): Promise<number> {
    await this.queue.run(async () => {
      const identity = this.storage.mutationIdentity ?? this.storage;
      if (recovered.has(identity)) return;
      const effects = await this.readArray<EffectRecord>("_cache/effects.json");
      if (effects.some(effect => effect.status === "running")) {
        await this.writeArray("_cache/effects.json", effects.map(effect => effect.status === "running" ? { ...effect, status: "pending", updatedAt: new Date().toISOString() } : effect));
      }
      recovered.add(identity);
    });
    let processed = 0;
    while (true) {
      const claim = await this.queue.run(async () => {
        const effects = await this.readArray<EffectRecord>("_cache/effects.json");
        const index = effects.findIndex(effect => effect.status === "pending" && effect.dueAt <= new Date().toISOString() && this.handlers.has(effect.kind)
          && !effects.some(other => other !== effect && other.kind === effect.kind && other.key === effect.key && other.status === "running"));
        if (index < 0) return null;
        const record = effects[index]!;
        const handler = this.handlers.get(record.kind)!;
        effects[index] = { ...record, status: "running", attempts: record.attempts + 1, updatedAt: new Date().toISOString() };
        await this.writeArray("_cache/effects.json", effects);
        return { record, handler };
      });
      if (!claim) return processed;
      let error: string | undefined;
      try { await claim.handler(claim.record.payload, new AbortController().signal); }
      catch (cause) { error = cause instanceof Error ? cause.message : String(cause); }
      await this.queue.run(async () => {
        const effects = await this.readArray<EffectRecord>("_cache/effects.json");
        const index = effects.findIndex(effect => effect.kind === claim.record.kind && effect.key === claim.record.key && effect.status === "running");
        if (index < 0) throw new Error("Claimed effect is missing");
        effects[index] = { ...effects[index]!, status: error === undefined ? "completed" : "failed", lastError: error, updatedAt: new Date().toISOString() };
        await this.writeArray("_cache/effects.json", effects);
      });
      processed++;
    }
  }
}
