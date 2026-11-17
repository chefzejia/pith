/**
 * Pith Core Domain Model (001-domain.md).
 *
 * Metaphor-free, host-agnostic domain entities:
 * - Profile (`ME.md`): the learner's evolving cognitive baseline
 * - Topic (`topics/<id>/topic.md`): an exploration unit and attention anchor
 * - Material (`materials/<id>/material.md`): observable files and intrinsic locators
 * - Note & SelectionAnchor: highlights, reflections, and toolkit practice diagnostics
 */

export type TopicStatus = "exploring" | "shelved" | "settled";

export type MaterialKind = "book" | "article" | "media" | "discussion" | "repo";

export type NoteKind = "highlight" | "note" | "practice";

/**
 * Intrinsic, viewport-independent position inside a Material file.
 * Examples:
 * - "text:section:2;block:4;offset:18"
 * - "page:12"
 * - "time:860"
 * - "repo:a1b2c3d:src/index.ts#L10-L24"
 */
export type IntrinsicLocator = string;

export type AnchorSource = { readonly kind: "material"; readonly materialId: string } | { readonly kind: "lesson" };

export interface SelectionAnchor {
  readonly source: AnchorSource;
  readonly file: string;
  readonly locator: IntrinsicLocator;
  readonly quote?: string;
}

export interface Note {
  readonly id: string;
  readonly kind: NoteKind;
  readonly author: "user" | "guide";
  readonly createdAt: string;
  readonly anchor?: SelectionAnchor;
  readonly body: string;
  readonly guideRemark?: string;
  readonly result?: Readonly<Record<string, unknown>>;
}

export interface LessonEntry {
  readonly name: string;
  readonly locator?: IntrinsicLocator;
  readonly lastActiveAt?: string;
}

export interface Topic {
  readonly id: string;
  readonly title: string;
  readonly target: string;
  readonly status: TopicStatus;
  readonly materialIds: readonly string[];
  /** Single concrete 15-minute next step shown on the Attention Compass. */
  readonly nextAction?: string;
  /** Dynamically injected toolkit/practice toolkit plugin IDs (e.g. ["shadowing"]). */
  readonly toolkits: readonly string[];
  readonly lessons: readonly LessonEntry[];
  readonly notes: readonly Note[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface MaterialFileEntry {
  readonly name: string;
  readonly mimeType: string;
  readonly bytes: number;
  readonly sha256: string;
  readonly locator?: IntrinsicLocator;
  readonly lastActiveAt?: string;
}

/** Permanent last-open state, stored in material.md. */
export interface MaterialReading {
  readonly file: string;
  readonly locator?: IntrinsicLocator;
  readonly openedAt: string;
}

export interface Material {
  readonly id: string;
  readonly title: string;
  readonly kind: MaterialKind;
  readonly createdAt: string;
  readonly files: readonly MaterialFileEntry[];
  readonly externalPath?: string;
  readonly commitSha?: string;
  readonly remoteUrl?: string;
  readonly aids: readonly string[];
  readonly reading?: MaterialReading;
  readonly notes: readonly Note[];
}

export interface UnreadableEntry { readonly kind: "topic" | "material"; readonly id: string; readonly path: string; readonly error: string }

export interface ProfileObservation {
  readonly id: string;
  readonly date: string;
  readonly text: string;
  readonly topicId: string;
  readonly noteId?: string;
}

export interface LearnerProfile {
  readonly markdown: string;
  readonly observations: readonly ProfileObservation[];
}

/**
 * Surface persona dictionary: decouples user-facing metaphor ("园丁/花园" vs "向导/工作区")
 * from the metaphor-free core domain.
 */
export interface SurfacePersona {
  readonly id: string;
  readonly workspaceLabel: string;
  readonly guideLabel: string;
  readonly topicLabel: string;
  readonly exploringLabel: string;
  readonly settledLabel: string;
}

export const DEFAULT_PERSONAS: Readonly<Record<string, SurfacePersona>> = {
  sanctuary: {
    id: "sanctuary",
    workspaceLabel: "花园",
    guideLabel: "园丁",
    topicLabel: "课题",
    exploringLabel: "探索中",
    settledLabel: "已沉淀",
  },
  studio: {
    id: "studio",
    workspaceLabel: "工作区",
    guideLabel: "向导",
    topicLabel: "课题",
    exploringLabel: "进行中",
    settledLabel: "已归档",
  },
};
