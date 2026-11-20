import type { WorkspaceStoragePort } from "../host.ts";
import { libraryOverview } from "../library.ts";
import type { WorkspaceStore } from "../store/contract.ts";
import { MutationQueue } from "../store/MutationQueue.ts";
import { retryReceipts } from "./retryRecovery.ts";
import type { AttentionCompassSnapshot, AttentionEngine, EffectHandler, EffectKind, EffectRecord, GuideProvider, GuideTurn, TurnOptions, TurnStep } from "./contract.ts";

const recovered = new WeakSet<object>();

const runningTopics = new WeakMap<object, Set<string>>();

interface ActiveClaim {
  readonly kind: EffectKind;
  readonly key: string;
  readonly runSignal: AbortSignal;
  readonly settled: Promise<void>;
}

const activeClaims = new WeakMap<object, Set<ActiveClaim>>();

async function waitForSettled(
  waiters: readonly { readonly settled: Promise<void>; readonly handlerSignal: AbortSignal }[],
  signal?: AbortSignal,
): Promise<void> {
  if (waiters.length === 0) return;
  const signals = new Set<AbortSignal>(waiters.map(waiter => waiter.handlerSignal));
  if (signal) signals.add(signal);
  for (const item of signals) {
    if (item.aborted) return;
  }
  const cleanups: Array<() => void> = [];
  try {
    const aborted = new Promise<void>(resolve => {
      const onAbort = () => resolve();
      for (const item of signals) {
        item.addEventListener("abort", onAbort, { once: true });
        cleanups.push(() => item.removeEventListener("abort", onAbort));
      }
    });
    await Promise.race([
      ...waiters.map(waiter => waiter.settled),
      aborted,
    ]);
  } finally {
    for (const cleanup of cleanups) cleanup();
  }
}

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
  private readonly handlers = new Map<EffectKind, { readonly handler: EffectHandler; readonly controller: AbortController }>();
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
    const topicIdsByMaterial = new Map(libraryOverview(materials, topics).materials.map(entry => [entry.id, entry.topics.map(topic => topic.id)]));
    const library = materials.map(material => ({ material, topicIds: topicIdsByMaterial.get(material.id)! }));
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
    const previous = this.handlers.get(kind);
    if (previous) previous.controller.abort(new Error("Effect handler replaced"));
    const entry = { handler, controller: new AbortController() };
    this.handlers.set(kind, entry);
    return () => {
      if (this.handlers.get(kind) === entry) {
        this.handlers.delete(kind);
        entry.controller.abort(new Error("Effect handler unregistered"));
      }
    };
  }
  async processDueEffects(signal?: AbortSignal): Promise<number> {
    if (signal?.aborted) return 0;
    const identity = this.storage.mutationIdentity ?? this.storage;
    await this.queue.run(async () => {
      if (recovered.has(identity)) return;
      const effects = await this.readArray<EffectRecord>("_cache/effects.json");
      if (effects.some(effect => effect.status === "running")) {
        await this.writeArray("_cache/effects.json", effects.map(effect => effect.status === "running" ? { ...effect, status: "pending", updatedAt: new Date().toISOString() } : effect));
      }
      recovered.add(identity);
    });
    let processed = 0;
    while (true) {
      if (signal?.aborted) return processed;
      type Step =
        | { readonly kind: "done" }
        | { readonly kind: "wait"; readonly waiters: readonly { readonly settled: Promise<void>; readonly handlerSignal: AbortSignal }[] }
        | { readonly kind: "claimed"; readonly record: EffectRecord; readonly handler: EffectHandler; readonly runSignal: AbortSignal; readonly active: ActiveClaim; readonly resolveSettled: () => void };

      const step: Step = await this.queue.run(async () => {
        if (signal?.aborted) return { kind: "done" };
        const effects = await this.readArray<EffectRecord>("_cache/effects.json");
        const now = new Date().toISOString();
        const index = effects.findIndex(effect => {
          if (effect.status !== "pending" || effect.dueAt > now) return false;
          const entry = this.handlers.get(effect.kind);
          if (!entry || entry.controller.signal.aborted) return false;
          return !effects.some(other => other !== effect && other.kind === effect.kind && other.key === effect.key && other.status === "running");
        });
        if (index >= 0) {
          const entry = this.handlers.get(effects[index]!.kind)!;
          const record: EffectRecord = { ...effects[index]!, status: "running", attempts: effects[index]!.attempts + 1, updatedAt: now };
          effects[index] = record;
          await this.writeArray("_cache/effects.json", effects);
          const runSignal = signal ? AbortSignal.any([signal, entry.controller.signal]) : entry.controller.signal;
          let resolveSettled!: () => void;
          const settled = new Promise<void>(resolve => { resolveSettled = resolve; });
          const active: ActiveClaim = { kind: record.kind, key: record.key, runSignal, settled };
          let set = activeClaims.get(identity);
          if (!set) {
            set = new Set();
            activeClaims.set(identity, set);
          }
          set.add(active);
          return { kind: "claimed", record, handler: entry.handler, runSignal, active, resolveSettled };
        }
        const claims = activeClaims.get(identity);
        if (!claims || claims.size === 0) return { kind: "done" };
        const waiters: { readonly settled: Promise<void>; readonly handlerSignal: AbortSignal }[] = [];
        for (const active of claims) {
          if (!active.runSignal.aborted) continue;
          const entry = this.handlers.get(active.kind);
          if (!entry || entry.controller.signal.aborted) continue;
          waiters.push({ settled: active.settled, handlerSignal: entry.controller.signal });
        }
        return waiters.length > 0 ? { kind: "wait", waiters } : { kind: "done" };
      });
      if (step.kind === "done") return processed;
      if (step.kind === "wait") {
        await waitForSettled(step.waiters, signal);
        if (signal?.aborted) return processed;
        continue;
      }
      let error: string | undefined;
      let abortedFailure = false;
      try {
        try { await step.handler(step.record.payload, step.runSignal); }
        catch (cause) { error = cause instanceof Error ? cause.message : String(cause); }
        abortedFailure = error !== undefined && step.runSignal.aborted;
        await this.queue.run(async () => {
          const effects = await this.readArray<EffectRecord>("_cache/effects.json");
          const index = effects.findIndex(effect => effect.kind === step.record.kind && effect.key === step.record.key && effect.status === "running");
          if (index < 0) throw new Error("Claimed effect is missing");
          const record = effects[index]!;
          if (abortedFailure) {
            effects[index] = { ...record, status: "pending", attempts: Math.max(0, record.attempts - 1), updatedAt: new Date().toISOString() };
          } else {
            effects[index] = { ...record, status: error === undefined ? "completed" : "failed", lastError: error, updatedAt: new Date().toISOString() };
          }
          await this.writeArray("_cache/effects.json", effects);
        });
      } finally {
        const set = activeClaims.get(identity);
        if (set) {
          set.delete(step.active);
          if (set.size === 0) activeClaims.delete(identity);
        }
        step.resolveSettled();
      }
      if (abortedFailure) return processed;
      processed++;
      if (signal?.aborted) return processed;
    }
  }
}
