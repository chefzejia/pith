import { latestRepositoryIds } from "./repositoryVersions.ts";
import type { Material, MaterialKind, Topic, TopicStatus } from "./types.ts";

export interface LibraryMaterialEntry {
  readonly id: string;
  readonly title: string;
  readonly kind: MaterialKind;
  readonly createdAt: string;
  readonly lastOpenedAt?: string;
  readonly noteCount: number;
  readonly repository?: { readonly source: string; readonly commit: string; readonly latest: boolean };
  readonly topics: readonly { readonly id: string; readonly title: string; readonly status: TopicStatus }[];
}

export interface LibraryTopicEntry {
  readonly id: string;
  readonly title: string;
  readonly target: string;
  readonly status: TopicStatus;
  readonly materialIds: readonly string[];
  readonly lessonCount: number;
  readonly userRecordCount: number;
  readonly updatedAt: string;
}

export interface LibraryOverview {
  readonly materials: readonly LibraryMaterialEntry[];
  readonly topics: readonly LibraryTopicEntry[];
}

function timestamp(value: string | undefined): number {
  return Date.parse(value ?? "") || 0;
}

export function libraryOverview(materials: readonly Material[], topics: readonly Topic[]): LibraryOverview {
  const latest = new Set(latestRepositoryIds(materials));
  const references = new Map<string, { topics: LibraryMaterialEntry["topics"][number][]; activity: number }>();
  const orderedTopics = [...topics].sort((a, b) => timestamp(b.updatedAt) - timestamp(a.updatedAt));
  const topicEntries = orderedTopics.map(({ id, title, target, status, materialIds, lessons, notes, updatedAt }): LibraryTopicEntry => {
    for (const materialId of new Set(materialIds)) {
      const reference = references.get(materialId) ?? { topics: [], activity: timestamp(updatedAt) };
      reference.topics.push({ id, title, status });
      references.set(materialId, reference);
    }
    return { id, title, target, status, materialIds, lessonCount: lessons.length, userRecordCount: notes.filter(note => note.author === "user" && (note.kind === "note" || note.kind === "practice")).length, updatedAt };
  });
  const materialEntries = materials.map((material): { entry: LibraryMaterialEntry; activity: number } => {
    const { id, title, kind, createdAt, reading, notes, remoteUrl, externalPath, commitSha } = material;
    const reference = references.get(id);
    return {
      entry: {
        id, title, kind, createdAt,
        ...(reading ? { lastOpenedAt: reading.openedAt } : {}),
        noteCount: notes.length,
        ...(kind === "repo" ? { repository: { source: remoteUrl ?? externalPath ?? "", commit: commitSha ?? "", latest: latest.has(id) } } : {}),
        topics: reference?.topics ?? [],
      },
      activity: Math.max(timestamp(createdAt), timestamp(reading?.openedAt), reference?.activity ?? 0),
    };
  });
  return { materials: materialEntries.sort((a, b) => b.activity - a.activity).map(item => item.entry), topics: topicEntries };
}
