/**
 * Pith WorkspaceStore public contract (`src/core/store/`).
 *
 * WorkspaceStore is the sole writer of `<workspace>/` durable Markdown files:
 * - `ME.md`
 * - `topics/topic-<id>/topic.md`
 * - `materials/material-<id>/material.md` and `files/*`
 *
 * All other modules (`plugins/*`, `shells/*`, and `guide-acp` MCP tools) read
 * and mutate durable workspace facts exclusively through this interface.
 */

import type {
  IntrinsicLocator,
  LearnerProfile,
  ProfileObservation,
  Material,
  MaterialKind,
  SelectionAnchor,
  Topic,
  Note,
  TopicStatus,
  UnreadableEntry,
} from "../types.ts";

export interface CreateTopicInput {
  readonly title: string;
  readonly target: string;
  readonly materialIds: readonly string[];
  readonly nextAction?: string;
  readonly toolkits: readonly string[];
}

export interface UpdateTopicPatch {
  readonly title?: string;
  readonly target?: string;
  readonly status?: TopicStatus;
  readonly nextAction?: string;
  readonly toolkits?: readonly string[];
}

export interface ImportMaterialFileInput {
  readonly name: string;
  readonly mimeType?: string;
  readonly bytes: Uint8Array;
}

export interface ImportMaterialInput {
  readonly title: string;
  readonly kind: MaterialKind;
  readonly files: readonly ImportMaterialFileInput[];
  readonly externalPath?: string;
  readonly commitSha?: string;
  readonly remoteUrl?: string;
  readonly aids?: readonly string[];
}

export interface AppendNoteInput {
  readonly kind: Note["kind"];
  readonly author: "user" | "guide";
  readonly body: string;
  readonly anchor?: SelectionAnchor;
  readonly guideRemark?: string;
  readonly result?: Readonly<Record<string, unknown>>;
}

export interface WorkspaceStore {
  ensureScaffold(): Promise<void>;

  readProfile(): Promise<LearnerProfile>;
  addObservation(input: { text: string; topicId: string; noteId?: string }): Promise<ProfileObservation>;
  removeObservation(observationId: string): Promise<void>;

  /** Topic and material folders whose ledger file fails to parse; `listTopics` and `listMaterials` omit them. */
  listUnreadable(): Promise<readonly UnreadableEntry[]>;

  listTopics(): Promise<readonly Topic[]>;
  getTopic(topicId: string): Promise<Topic | null>;
  createTopic(input: CreateTopicInput): Promise<Topic>;
  updateTopic(topicId: string, patch: UpdateTopicPatch): Promise<Topic>;
  attachMaterial(topicId: string, materialId: string): Promise<Topic>;
  appendTopicNote(topicId: string, note: AppendNoteInput): Promise<Note>;
  writeLesson(topicId: string, fileName: string, markdown: string): Promise<Topic>;
  /** Updates only the repository basis of an existing lesson, preserving its bytes. */
  rebaseLesson(topicId: string, fileName: string): Promise<Topic>;
  readLesson(topicId: string, fileName: string): Promise<string>;
  updateLessonLocator(topicId: string, fileName: string, locator: IntrinsicLocator): Promise<void>;

  listMaterials(): Promise<readonly Material[]>;
  getMaterial(materialId: string): Promise<Material | null>;
  importMaterial(input: ImportMaterialInput): Promise<Material>;
  setMaterialAids(materialId: string, aids: readonly string[]): Promise<Material>;
  appendMaterialNote(materialId: string, note: AppendNoteInput): Promise<Note>;
  updateReadingLocator(materialId: string, fileName: string, locator: IntrinsicLocator): Promise<void>;
  /** Records the last opened file/position and stamps openedAt; does not change files, aids or notes. */
  recordReading(materialId: string, input: { file: string; locator?: IntrinsicLocator }): Promise<void>;
}
