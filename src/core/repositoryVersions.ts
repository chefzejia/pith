import type { LessonEntry, Material, Topic } from "./types.ts";

/** Versions are ordered by import time; non-repository materials remain separate. */
export function materialVersionGroups(materials: readonly Material[]): { latest: Material; versions: Material[] }[] {
  const groups = new Map<string, Material[]>();
  for (const material of materials) {
    const key = material.kind === "repo" ? `repo:${material.externalPath}` : `material:${material.id}`;
    const versions = groups.get(key) ?? []; versions.push(material); groups.set(key, versions);
  }
  return [...groups.values()].map(versions => {
    versions.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return { latest: versions[versions.length - 1]!, versions };
  });
}

export function latestRepositoryIds(materials: readonly Material[]): string[] {
  return materialVersionGroups(materials).filter(group => group.latest.kind === "repo").map(group => group.latest.id);
}

/** Published lessons without a stamp retain the earliest referenced snapshot. */
export function lessonRepositoryMaterials(lesson: LessonEntry, materials: readonly Material[]): Material[] {
  if (lesson.basedOn === undefined) return materialVersionGroups(materials).filter(group => group.latest.kind === "repo").map(group => group.versions[0]!);
  const paths = new Set<string>();
  return lesson.basedOn.map(id => {
    const material = materials.find(item => item.id === id);
    if (!material || material.kind !== "repo" || !material.externalPath || paths.has(material.externalPath)) throw new Error("Invalid lesson basedOn");
    paths.add(material.externalPath); return material;
  });
}

export function lessonIsOutdated(lesson: LessonEntry, materials: readonly Material[]): boolean {
  const basis = new Set(lessonRepositoryMaterials(lesson, materials).map(material => material.id));
  return latestRepositoryIds(materials).some(id => !basis.has(id));
}

export function topicMaterials(topic: Topic, materials: readonly Material[]): Material[] {
  return topic.materialIds.map(id => {
    const material = materials.find(item => item.id === id);
    if (!material) throw new Error(`Material not found: ${id}`);
    return material;
  });
}
