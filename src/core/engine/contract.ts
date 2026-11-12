/**
 * Pith Attention Engine & Durable Effects Queue Contract (`src/core/engine/`).
 *
 * Inspired by `dsh-superagent` (`001-domain.md` & `007-architecture.md`):
 * 1. Sessionless by design: callers interact with durable `Topic` entities and
 *    synchronous/fast commands (`recordSelection`, `askGuide`, `settleTopic`,
 *    `enqueueEffect`), never blocking on raw LLM sessions.
 * 2. Coalescing durable Effects queue: background tasks (`curate-topic`,
 *    `prepare-next-action`, `generate-lesson`, `transcribe-media`) are keyed by
 *    `(kind, key)`. Enqueuing the same waiting key replaces its payload in place
 *    without duplicating LLM calls.
 * 3. Graceful offline degradation: when no Guide provider (`guide.agent`) is
 *    mounted or configured, all manual reading, highlighting, note-taking, and
 *    stage operations succeed immediately while queued AI effects remain safely
 *    held or skipped.
 */

import type { SelectionAnchor, Topic, TopicNote, UnreadableEntry } from "../types.ts";

export type EffectKind =
  | "curate-topic"
  | "prepare-next-action"
  | "generate-lesson"
  | "evaluate-settlement";

export type EffectStatus = "pending" | "running" | "failed" | "completed";

export interface EffectRecord {
  readonly kind: EffectKind;
  readonly key: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly status: EffectStatus;
  readonly attempts: number;
  readonly lastError?: string;
  readonly dueAt: string;
  readonly updatedAt: string;
}

export type EffectHandler = (
  payload: Readonly<Record<string, unknown>>,
  signal: AbortSignal,
) => Promise<void>;

export type TurnStatus = "running" | "completed" | "failed" | "stopped";

export type TurnEffect =
  | { readonly kind: "topic"; readonly topicId: string }
  | { readonly kind: "lesson"; readonly fileName: string }
  | { readonly kind: "note"; readonly noteId: string }
  | { readonly kind: "material"; readonly materialId: string }
  | { readonly kind: "toolkits"; readonly toolkits: readonly string[] }
  | { readonly kind: "observation"; readonly observationId: string; readonly text: string };

export type TurnStep =
  | { readonly kind: "thought"; readonly text: string }
  | { readonly kind: "tool"; readonly callId: string; readonly name: string; readonly inputPreview: string; readonly status: "running" | "completed" | "failed"; readonly summary?: string; readonly effects: readonly TurnEffect[] }
  | { readonly kind: "reply"; readonly markdown: string };

export interface GuideTurn {
  readonly id: string;
  readonly status: TurnStatus;
  readonly startedAt: string;
  readonly endedAt?: string;
  readonly user: { readonly text: string; readonly anchor?: SelectionAnchor; readonly instruction?: string };
  readonly steps: readonly TurnStep[];
  readonly choices: readonly string[];
  readonly error?: string;
}

export interface TurnOptions {
  readonly signal?: AbortSignal;
  readonly onUpdate?: (turn: GuideTurn) => void;
}

export interface GuideProvider {
  run(input: { scope: { kind: "intake"; materialIds: readonly string[] } | { kind: "topic"; topicId: string }; text: string; anchor?: SelectionAnchor; instruction?: string; history: readonly GuideTurn[] }, options: { signal: AbortSignal; onStep(step: TurnStep, index: number): void; onChoices(choices: readonly string[]): void }): Promise<{ readonly status: "completed" | "stopped" } | { readonly status: "failed"; readonly error: string }>;
}

export interface AttentionCompassSnapshot {
  readonly unreadable: readonly UnreadableEntry[];
  readonly exploring: readonly Topic[];
  readonly settled: readonly Topic[];
  readonly focusRecommendation: {
    readonly topicId: string;
    readonly title: string;
    readonly nextAction: string;
  } | null;
  readonly pendingEffectsCount: number;
}

export interface AttentionEngine {
  /** Build the first-screen Attention Compass snapshot ("What waits for a person?"). */
  compass(): Promise<AttentionCompassSnapshot>;

  /** Record a highlight or user note on a Topic immediately, and coalesce a background `prepare-next-action` effect. */
  captureSelection(input: {
    readonly topicId: string;
    readonly kind: "highlight" | "note" | "practice";
    readonly body: string;
    readonly anchor?: SelectionAnchor;
  }): Promise<TopicNote>;

  getConversation(topicId: string): Promise<readonly GuideTurn[]>;
  runTurn(input: { topicId: string; text: string; anchor?: SelectionAnchor; instruction?: string }, options?: TurnOptions): Promise<GuideTurn>;
  retryTurn(topicId: string, turnId: string, options?: TurnOptions): Promise<GuideTurn>;

  /** Durable Effects queue management. */
  enqueueEffect(kind: EffectKind, key: string, payload: Readonly<Record<string, unknown>>): Promise<EffectRecord>;
  listEffects(): Promise<readonly EffectRecord[]>;
  registerEffectHandler(kind: EffectKind, handler: EffectHandler): () => void;
  processDueEffects(): Promise<number>;
}
