import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DefaultWorkspaceStore, parseFrontmatter, stringifyFrontmatter } from "../src/core/index.ts";
import { NodeWorkspaceStorage } from "../src/shells/web/nodeStorage.ts";

export async function createReadingRepository(root: string) {
  const path = join(root, "repository"), nested = "packages/core/nested/reader.ts";
  await mkdir(join(path, "packages/core/nested"), { recursive: true });
  await writeFile(join(path, "README.md"), "# 首项\n\n请经目录打开嵌套文件。\n");
  await writeFile(join(path, nested), Array.from({ length: 160 }, (_, i) => `// R_MARKER_${String(i + 1).padStart(3, "0")} 第 ${i + 1} 行：永久阅读位置属于材料。`).join("\n"));
  const git = (args: string[]) => execFileSync("git", args, { cwd: path, encoding: "utf8" }).trim();
  git(["init", "-q"]); git(["add", "README.md", nested]);
  git(["-c", "user.name=Pith fixture", "-c", "user.email=fixture@localhost", "-c", "commit.gpgsign=false", "commit", "-qm", "reading fixture"]);
  return { path, commit: git(["rev-parse", "HEAD"]), nested };
}

/** Formal Store preparation only; R/M target coordinates are never seeded. */
export async function seedReadingWorkspace(workspace: string, repo: Awaited<ReturnType<typeof createReadingRepository>>) {
  const storage = new NodeWorkspaceStorage(workspace), store = new DefaultWorkspaceStore(storage);
  await store.ensureScaffold(); assert.equal((await store.listMaterials()).length, 0); assert.equal((await store.listTopics()).length, 0);
  const repository = await store.importMaterial({ title: "R 仓库阅读", kind: "repo", files: [], aids: [], externalPath: repo.path, commitSha: repo.commit });
  const ordinary = await store.importMaterial({ title: "M 普通材料", kind: "article", aids: [], files: [
    { name: "01-first.md", bytes: new TextEncoder().encode("# 第一文件\n\n请打开第二文件。\n") },
    { name: "02-second.md", bytes: new TextEncoder().encode("# 第二文件\n\n" + Array.from({ length: 100 }, (_, i) => `M_MARKER_${String(i + 1).padStart(3, "0")} 第 ${i + 1} 段：删除缓存后仍从材料账本恢复。`).join("\n\n")) },
  ] });
  const fileOnly = await store.importMaterial({ title: "F 只有文件无坐标", kind: "article", aids: [], files: [
    { name: "01-first.md", bytes: new TextEncoder().encode("# F 首文件\n") }, { name: "02-only.md", bytes: new TextEncoder().encode("# F 第二文件\n\n合法 file-only 准备，没有预置坐标。\n") },
  ] });
  await store.recordReading(fileOnly.id, { file: "02-only.md" });
  const topic = await store.createTopic({ title: "永久位置复验课题", target: "删除缓存后能否恢复同一材料位置", materialIds: [repository.id, ordinary.id, fileOnly.id], toolkits: [] });
  const malformed = [];
  for (const [title, fields] of [
    ["E1 非法父目录", { readingFile: "packages/../escape.ts", readingOpenedAt: "2026-11-14T03:00:00.000Z" }],
    ["E2 缺少打开时间", { readingFile: repo.nested }],
    ["E3 孤立坐标", { readingLocator: "text:line:8" }],
  ] as const) {
    const material = await store.importMaterial({ title, kind: "repo", files: [], aids: [], externalPath: repo.path, commitSha: repo.commit });
    const path = join(workspace, "materials", material.id, "material.md"), parsed = parseFrontmatter(await readFile(path, "utf8"));
    await writeFile(path, stringifyFrontmatter({ ...parsed.attributes, ...fields }, parsed.body));
    malformed.push({ id: material.id, title, path });
  }
  await storage.writeText("_cache/web-settings.json", JSON.stringify({ preset: "all", persona: "sanctuary", plugins: {}, agentId: "", agentConfigured: true }));
  assert.equal((await store.listUnreadable()).length, 3);
  return { workspace, repository: { id: repository.id, file: repo.nested }, ordinary: { id: ordinary.id, file: "02-second.md" }, fileOnly: { id: fileOnly.id, file: "02-only.md", reading: (await store.getMaterial(fileOnly.id))!.reading }, topicId: topic.id, malformed, preparationOnly: true, agent: "off" };
}
