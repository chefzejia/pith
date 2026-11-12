import type { WorkspaceStoragePort } from "../host.ts";
import type { WorkspaceStore } from "../store/contract.ts";
import { MutationQueue } from "../store/MutationQueue.ts";
import type { AttentionCompassSnapshot, AttentionEngine, EffectHandler, EffectKind, EffectRecord, GuideConversationEntry } from "./contract.ts";

export interface GuideProvider {
  reply(input: { topicId: string; conversation: readonly GuideConversationEntry[] }): Promise<string>;
}

const recovered = new WeakSet<object>();

export function parseGuideReply(reply: string): { text: string; choices: string[] } {
  const match = /(?:^|\n)```pith-choices\s*\n([\s\S]*?)\n```\s*$/.exec(reply);
  if (!match) return { text: reply, choices: [] };
  const lines = match[1]!.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  let choices: unknown = lines.map(line => line.replace(/^[-*]\s+/, ""));
  if (match[1]!.trim().startsWith("[")) {
    try { choices = JSON.parse(match[1]!); } catch { return { text: reply, choices: [] }; }
  }
  if (!Array.isArray(choices) || !choices.every(item => typeof item === "string" && item.trim())) return { text: reply, choices: [] };
  return { text: reply.slice(0, match.index).trimEnd(), choices };
}

function component(value: string): string {
  if (!value || value === "." || value === ".." || /[/\\\0]/.test(value)) throw new Error("Invalid topic id");
  return value;
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
    if (path.startsWith("_cache/conversations/")) await this.storage.mkdir("_cache/conversations");
    await this.storage.writeText(path, `${JSON.stringify(value, null, 2)}\n`);
  }
  async compass(): Promise<AttentionCompassSnapshot> {
    const [topics, effects, unreadable] = await Promise.all([this.store.listTopics(), this.listEffects(), this.store.listUnreadable()]);
    const exploring = topics.filter(topic => topic.status === "exploring");
    const settled = topics.filter(topic => topic.status === "settled");
    const focus = exploring.find(topic => Boolean(topic.nextAction));
    return { exploring, settled, unreadable, focusRecommendation: focus && focus.nextAction ? { topicId: focus.id, title: focus.title, nextAction: focus.nextAction } : null,
      pendingEffectsCount: effects.filter(effect => effect.status === "pending" || effect.status === "running").length };
  }
  async captureSelection(input: Parameters<AttentionEngine["captureSelection"]>[0]): ReturnType<AttentionEngine["captureSelection"]> {
    const note = await this.store.appendNote(input.topicId, { kind: input.kind, body: input.body, anchor: input.anchor });
    await this.enqueueEffect("prepare-next-action", input.topicId, { topicId: input.topicId, noteId: note.id });
    return note;
  }
  getConversation(topicId: string): Promise<readonly GuideConversationEntry[]> {
    const path = `_cache/conversations/${component(topicId)}.json`;
    return this.queue.run(() => this.readArray<GuideConversationEntry>(path));
  }
  async sendMessage(input: Parameters<AttentionEngine["sendMessage"]>[0]): ReturnType<AttentionEngine["sendMessage"]> {
    if (!await this.store.getTopic(input.topicId)) throw new Error("Topic not found");
    if (!input.text.trim()) throw new Error("Message is empty");
    const note = input.saveAsNote ? await this.captureSelection({ topicId: input.topicId, kind: "note", body: input.text, anchor: input.anchor }) : undefined;
    const userEntry: GuideConversationEntry = { id: crypto.randomUUID(), role: "user", text: input.text,
      ...(input.anchor ? { anchor: input.anchor } : {}), ...(note ? { savedNoteId: note.id } : {}), createdAt: new Date().toISOString() };
    const path = `_cache/conversations/${component(input.topicId)}.json`;
    const conversation = await this.queue.run(async () => {
      const entries = await this.readArray<GuideConversationEntry>(path);
      entries.push(userEntry);
      await this.writeArray(path, entries);
      return entries;
    });
    const provider = this.provider ? this.provider() : undefined;
    if (!provider) return { userEntry };
    const reply = parseGuideReply(await provider.reply({ topicId: input.topicId, conversation }));
    const guideEntry: GuideConversationEntry = { id: crypto.randomUUID(), role: "guide", text: reply.text, choices: reply.choices, createdAt: new Date().toISOString() };
    await this.queue.run(async () => {
      const entries = await this.readArray<GuideConversationEntry>(path);
      entries.push(guideEntry);
      await this.writeArray(path, entries);
    });
    return { userEntry, guideEntry };
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
