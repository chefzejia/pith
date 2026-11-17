import { normalizeRepositoryUrl, type Material, type RepositoryPort } from "../core/index.ts";

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
