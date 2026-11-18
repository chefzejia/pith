import { normalizeRepositoryUrl, type Material, type RepositoryPort, type WorkspaceStore } from "../core/index.ts";

export async function checkRepositoryUpdate(store: WorkspaceStore, repository: RepositoryPort, materialId: string): Promise<{ material: Material; added: boolean }> {
  const previous = await store.getMaterial(materialId);
  if (!previous || previous.kind !== "repo" || !previous.externalPath) throw new Error("仓库材料不存在");
  const { commitSha } = previous.remoteUrl ? await repository.fetchRemote(previous.externalPath) : await repository.inspectRepository(previous.externalPath);
  const existing = await store.listMaterials();
  const material = await store.importMaterial({ title: previous.title, kind: "repo", files: [], externalPath: previous.externalPath, commitSha, ...(previous.remoteUrl ? { remoteUrl: previous.remoteUrl } : {}) });
  return { material, added: !existing.some(item => item.id === material.id) };
}

export const ADJUST_LESSONS_MESSAGE = "请按新版本调整当前课题基于旧版本的讲义。逐讲读取：先调用 pith_read_lesson 找出该讲引用的文件，再调用 pith_compare_material，带路径比较讲义依据版本与课题最新引用版本；仅在需要了解整体变化时才分页查看变更文件列表，不通读全部变化。引用的文件有实质变化时，用 pith_write_lesson 重写受影响的讲义，并加入「相对上一版的变化」一段；不受影响的讲义只调用 pith_rebase_lesson 更新依据，保持正文字节不变。最后在回复中列出改了哪些讲、为什么改。";

export async function resolveRepositoryIntake(input: string, repository: Pick<RepositoryPort, "inspectRepository" | "cloneRemote">, signal?: AbortSignal): Promise<{ info: Awaited<ReturnType<RepositoryPort["inspectRepository"]>> & { remoteUrl?: string }; description: string }> {
  signal?.throwIfAborted();
  const [first, ...rest] = input.trim().split(/\s+/);
  const remote = normalizeRepositoryUrl(first ?? "");
  if (remote) return { info: await repository.cloneRemote(remote, signal), description: rest.join(" ").replace(/^—\s*/, "") };
  const separators = [...input.matchAll(/\s+/g)].map(match => match.index).reverse();
  const candidates = [input.length, ...separators];
  let missing: unknown;
  for (const end of candidates) {
    const path = input.slice(0, end).trimEnd();
    const description = input.slice(end).trim().replace(/^—\s*/, "");
    if (!path || (end !== input.length && !description)) continue;
    try { return { info: await repository.inspectRepository(path), description }; }
    catch (error) {
      if (!error || typeof error !== "object" || !("code" in error) || !("syscall" in error) || (error.code !== "ENOENT" && error.code !== "ENOTDIR") || error.syscall !== "realpath") throw error;
      if (!missing) missing = error;
    }
  }
  throw missing || new Error("请输入仓库绝对路径");
}

export function emptyMaterialHtml(material: Material | null | undefined): string {
  if (!material) return "<p>这个课题还没有关联材料。</p>";
  if (material.kind !== "repo") return "<p>材料尚无可阅读文件。</p>";
  const escape = (value: string) => value.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
  return `<h2>仓库已绑定</h2><p>路径：${escape(material.externalPath || "未提供")}</p><p>Commit：${escape(material.commitSha || "未提供")}</p><p>尚无讲义。</p>`;
}

export function renderRepositoryText(commit: string, path: string, text: string): { html: string; sections: []; format: "markdown" } {
  const escape = (value: string) => value.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
  const lines = text.split("\n");
  const html = `<pre><code>${lines.map((line, index) => `<span data-locator="${escape(`repo:${commit}:${path}#L${index + 1}-L${index + 1}`)}" data-prose="false" data-trainable="true">${escape(line)}</span>`).join("\n")}</code></pre>`;
  return { html, sections: [], format: "markdown" };
}
