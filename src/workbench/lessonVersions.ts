import { lessonIsOutdated, lessonRepositoryMaterials, materialVersionGroups, type DefaultWorkspaceStore, type LessonEntry, type Material, type RepositoryPort, type Topic } from "../core/index.ts";
import { repositoryCitations } from "../core/repositoryCitations.ts";
import { rebaseComparedLesson } from "../core/store/WorkspaceStore.ts";
import { renderMarkdown } from "../plugins/stage-reader/index.ts";

interface VersionComparison {
  readonly title: string;
  readonly from: string | undefined;
  readonly to: string;
  readonly paths: readonly string[];
  readonly reason?: string;
}
export type LessonVersions = Readonly<Record<string, readonly VersionComparison[]>>;
type LessonStore = Pick<DefaultWorkspaceStore, "readLesson">;

export function lessonVersionDetails(comparisons: readonly VersionComparison[]): string[] {
  return comparisons.map(({ title, from, to, paths, reason }) => {
    const versions = `${title} ${from ? `@${from.slice(0, 7)}` : "无旧版本依据"} → @${to.slice(0, 7)}`;
    return `${versions}：${reason ?? (paths.length ? `变化文件：${paths.join("、")}` : "未发现引用文件变化，尚未改依据")}`;
  });
}

function latestRepositories(materials: readonly Material[]) {
  return materialVersionGroups(materials).map(group => group.latest).filter(material => material.kind === "repo");
}

async function repositoryFileNames(repository: RepositoryPort | undefined, material: Material): Promise<string[]> {
  if (!repository || !material.externalPath || !material.commitSha) throw new Error("仓库不可用");
  const names: string[] = [];
  for (let offset: number | null = 0; offset !== null;) {
    const page = await repository.listFiles(material.externalPath, material.commitSha, offset, 1000);
    names.push(...page.files); offset = page.nextOffset;
  }
  return names;
}

export async function readSessionRepositoryFiles(repository: RepositoryPort | undefined, materials: readonly Material[], topic: Topic | null): Promise<Record<string, string[]>> {
  const files: Record<string, string[]> = {};
  const stale = topic?.lessons.some(lesson => lessonIsOutdated(lesson, materials));
  for (const material of materials) if (material.kind === "repo") {
    try { files[material.id] = await repositoryFileNames(repository, material); }
    catch (error) { if (!stale) throw error; }
  }
  return files;
}

async function assessLessons(store: LessonStore, repository: RepositoryPort | undefined, topic: Topic, materials: readonly Material[], repositoryFiles?: Readonly<Record<string, readonly string[]>>) {
  const latest = latestRepositories(materials), files = new Map<string, Promise<readonly string[]>>(), diffs = new Map<string, Promise<ReadonlySet<string>>>();
  const listFiles = (material: Material) => {
    if (repositoryFiles) {
      const known = repositoryFiles[material.id];
      return known ? Promise.resolve(known) : Promise.reject(new Error("无法读取旧版本文件清单"));
    }
    let pending = files.get(material.id);
    if (!pending) {
      pending = repositoryFileNames(repository, material);
      files.set(material.id, pending);
    }
    return pending;
  };
  const listChanges = (from: Material, to: Material) => {
    const key = JSON.stringify([from.id, to.id]);
    let pending = diffs.get(key);
    if (!pending) {
      pending = (async () => {
        if (!repository || !from.externalPath || !from.commitSha || !to.commitSha) throw new Error("仓库不可用");
        const paths = new Set<string>();
        for (let offset: number | null = 0; offset !== null;) {
          const page = await repository.listChanges(from.externalPath, from.commitSha, to.commitSha, offset, 1000);
          for (const change of page.changes) { paths.add(change.path); if (change.previousPath) paths.add(change.previousPath); }
          offset = page.nextOffset;
        }
        return paths;
      })();
      diffs.set(key, pending);
    }
    return pending;
  };

  async function assess(lesson: LessonEntry) {
    const basis = lessonRepositoryMaterials(lesson, materials);
    const pairs = latest.map(to => ({ to, from: basis.find(from => from.externalPath === to.externalPath) })).filter(({ from, to }) => from?.id !== to.id);
    if (!pairs.length) return null;
    const references = async () => {
      const markdown = await store.readLesson(topic.id, lesson.name), texts: string[] = [];
      renderMarkdown(markdown, text => texts.push(text));
      const sources = await Promise.all(basis.map(async material => ({ id: material.id, files: (await listFiles(material)).map(name => ({ name })) })));
      const cited = new Map<string, Set<string>>();
      for (const matches of repositoryCitations(texts, sources)) for (const match of matches) for (const source of match.sources) {
        const paths = cited.get(source.id) ?? new Set<string>(); paths.add(match.path); cited.set(source.id, paths);
      }
      return { markdown, cited };
    };
    const evidence = await references().then(value => ({ value }), () => ({ value: undefined }));
    const comparisons: VersionComparison[] = [];
    for (const { from, to } of pairs) {
      const version = { title: to.title, from: from?.commitSha, to: to.commitSha!, paths: [] };
      if (!from || !evidence.value) {
        comparisons.push({ ...version, reason: from ? "比较失败：无法读取讲义或旧版本文件清单" : "比较失败：缺少旧版本依据" });
        continue;
      }
      try {
        const changed = await listChanges(from, to);
        const paths = [...(evidence.value.cited.get(from.id) ?? [])].filter(path => changed.has(path));
        comparisons.push({ ...version, paths });
      } catch {
        comparisons.push({ ...version, reason: "比较失败：无法读取两个提交之间的文件变化，已保留旧依据" });
      }
    }
    return { name: lesson.name, comparisons, markdown: evidence.value?.markdown, from: basis.map(material => material.id), to: latest.map(material => material.id) };
  }

  const assessments = [];
  for (const lesson of topic.lessons) {
    const assessment = await assess(lesson);
    if (assessment) assessments.push(assessment);
  }
  return assessments;
}

export async function readLessonVersions(store: LessonStore, repository: RepositoryPort | undefined, topic: Topic, materials: readonly Material[], repositoryFiles: Readonly<Record<string, readonly string[]>>): Promise<LessonVersions> {
  return Object.fromEntries((await assessLessons(store, repository, topic, materials, repositoryFiles)).map(({ name, comparisons }) => [name, comparisons]));
}

export async function useRepositoryVersion(store: DefaultWorkspaceStore, repository: RepositoryPort | undefined, topicId: string, materialId: string): Promise<LessonVersions> {
  const topic = await store.getTopic(topicId), target = await store.getMaterial(materialId);
  if (!topic || !target || target.kind !== "repo") throw new Error("仓库版本不存在");
  const lookup = (topic: Topic) => Promise.all(topic.materialIds.map(async id => {
    const material = await store.getMaterial(id);
    if (!material) throw new Error(`Material not found: ${id}`);
    return material;
  }));
  const current = latestRepositories(await lookup(topic)).find(material => material.externalPath === target.externalPath);
  if (!current || current.id === target.id || current.createdAt > target.createdAt) throw new Error("课题没有可改用的该仓库新版本");
  const updated = await store.attachMaterial(topicId, materialId);
  const remaining: Record<string, readonly VersionComparison[]> = Object.create(null);
  for (const { name, comparisons, markdown, from, to } of await assessLessons(store, repository, updated, await lookup(updated))) {
    if (markdown === undefined || comparisons.some(comparison => comparison.reason || comparison.paths.length)) {
      remaining[name] = comparisons;
      continue;
    }
    try { await rebaseComparedLesson(store, topicId, name, { markdown, from, to }); }
    catch { remaining[name] = comparisons.map(comparison => ({ ...comparison, reason: "未能改依据：讲义或课题可能已变动，已保留旧依据" })); }
  }
  return remaining;
}
