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
  Material,
  MaterialKind,
  SelectionAnchor,
  Topic,
  TopicNote,
  TopicStatus,
} from "../types.ts";

export interface CreateTopicInput {
  readonly id?: string;
  readonly title: string;
  readonly target?: string;
  readonly materialId?: string;
  readonly nextAction?: string;
  readonly toolkits?: readonly string[];
  readonly toolkitsOrigin?: "default" | "explicit";
}

export interface UpdateTopicPatch {
  readonly title?: string;
  readonly target?: string;
  readonly status?: TopicStatus;
  readonly materialId?: string;
  readonly nextAction?: string;
  readonly toolkits?: readonly string[];
  readonly toolkitsOrigin?: "default" | "explicit" | null;
}

export interface ImportMaterialFileInput {
  readonly name: string;
  readonly mimeType?: string;
  readonly bytes: Uint8Array;
}

export interface ImportMaterialInput {
  readonly id?: string;
  readonly title: string;
  readonly kind: MaterialKind;
  readonly files: readonly ImportMaterialFileInput[];
  readonly externalPath?: string;
  readonly commitSha?: string;
}

export interface AppendNoteInput {
  readonly kind: TopicNote["kind"];
  readonly body: string;
  readonly anchor?: SelectionAnchor;
  readonly guideRemark?: string;
}

export interface WorkspaceStore {
  ensureScaffold(): Promise<void>;

  readProfile(): Promise<LearnerProfile>;
  writeProfile(markdown: string): Promise<void>;

  listTopics(): Promise<readonly Topic[]>;
  getTopic(topicId: string): Promise<Topic | null>;
  createTopic(input: CreateTopicInput): Promise<Topic>;
  updateTopic(topicId: string, patch: UpdateTopicPatch): Promise<Topic>;
  /** Compares material binding and toolkit state inside the mutation queue; null indicates a conflict. */
  updateTopicIfUnchanged?(topicId: string, expected: Pick<Topic, "materialId" | "toolkits" | "toolkitsOrigin">, patch: UpdateTopicPatch): Promise<Topic | null>;
  appendNote(topicId: string, note: AppendNoteInput): Promise<TopicNote>;

  listMaterials(): Promise<readonly Material[]>;
  getMaterial(materialId: string): Promise<Material | null>;
  importMaterial(input: ImportMaterialInput): Promise<Material>;
  appendMaterialFiles?(materialId: string, files: readonly ImportMaterialFileInput[]): Promise<Material>;
  writeGeneratedFile(materialId: string, fileName: string, markdown: string): Promise<Material>;
  updateReadingLocator(materialId: string, fileName: string, locator: IntrinsicLocator): Promise<void>;
}
