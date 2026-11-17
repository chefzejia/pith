import { execFile } from "node:child_process";
import { realpath, stat } from "node:fs/promises";
import { basename, isAbsolute } from "node:path";
import { homedir } from "node:os";
import { promisify } from "node:util";
import type { RepositoryFileExcerpt, RepositoryPort, RepositorySearchMatch } from "../../core/index.ts";

const run = promisify(execFile);
const commitPattern = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const maxTreeBytes = 8 * 1024 * 1024;
const maxFileBytes = 256 * 1024;
const decoder = new TextDecoder("utf-8", { fatal: true });

async function git(root: string, args: string[], maxBuffer = maxTreeBytes): Promise<Buffer> {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith("GIT_")) delete env[key];
  Object.assign(env, { GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null", GIT_NO_REPLACE_OBJECTS: "1", GIT_NO_LAZY_FETCH: "1", GIT_TERMINAL_PROMPT: "0", GIT_PAGER: "cat" });
  return (await run("git", ["--no-optional-locks", "-c", "core.fsmonitor=false", "-C", root, ...args], { encoding: "buffer", env, maxBuffer, timeout: 15000, windowsHide: true })).stdout;
}

function validPath(path: string): boolean {
  return !!path && !isAbsolute(path) && !/^[a-z]:\//i.test(path) && !/[\\\u0000-\u001f\u007f]/u.test(path) && path.split("/").every(part => part !== "" && part !== "..");
}

async function entries(root: string, commit: string): Promise<{ path: string; oid: string; size: number }[]> {
  if (!isAbsolute(root) || !commitPattern.test(commit)) throw new Error("仓库绑定无效");
  const canonical = await realpath(root);
  const top = await realpath(decoder.decode(await git(canonical, ["rev-parse", "--show-toplevel"])).trim());
  if (canonical !== top) throw new Error("仓库路径不再指向根目录");
  if (decoder.decode(await git(canonical, ["cat-file", "-t", commit], 1024)).trim() !== "commit") throw new Error("仓库版本不是 commit");
  const data = decoder.decode(await git(canonical, ["ls-tree", "-r", "-z", "--long", "--full-tree", commit]));
  return data.split("\0").filter(Boolean).flatMap(record => {
    const match = /^(100644|100755) blob ([a-f0-9]{40}|[a-f0-9]{64}) +([0-9]+)\t(.+)$/u.exec(record);
    return match && validPath(match[4]!) ? [{ oid: match[2]!, size: Number(match[3]), path: match[4]! }] : [];
  });
}

async function grep(root: string, args: string[], maxBuffer = maxTreeBytes): Promise<Buffer> {
  try { return await git(root, ["grep", "--no-textconv", "--no-color", "--full-name", "-a", ...args], maxBuffer); }
  catch (cause) {
    const error = cause as { code?: unknown; stderr?: Buffer; message?: string };
    if (error.code === 1) return Buffer.alloc(0);
    throw new Error(`仓库搜索失败：${error.stderr?.toString("utf8").trim() || error.message}`);
  }
}

export class NodeRepositoryPort implements RepositoryPort {
  async inspectRepository(repoPath: string): Promise<{ externalPath: string; commitSha: string; title: string }> {
    if (/^[a-z]:[\\/]/i.test(repoPath) && process.platform !== "win32") throw new Error("当前系统不支持 Windows 仓库路径");
    if (repoPath.startsWith("~/")) repoPath = `${homedir()}/${repoPath.slice(2)}`;
    if (!isAbsolute(repoPath) || repoPath.includes("\0")) throw new Error("请输入仓库绝对路径");
    const directory = await realpath(repoPath);
    if (!(await stat(directory)).isDirectory()) throw new Error("仓库路径不是目录");
    const externalPath = await realpath(decoder.decode(await git(directory, ["rev-parse", "--show-toplevel"])).trim());
    const commitSha = decoder.decode(await git(externalPath, ["rev-parse", "--verify", "HEAD^{commit}"])).trim();
    if (!commitPattern.test(commitSha)) throw new Error("仓库 commit 无效");
    return { externalPath, commitSha, title: basename(externalPath) };
  }
  async listFiles(externalPath: string, commitSha: string, offset = 0, limit = 200): Promise<{ files: string[]; total: number; nextOffset: number | null }> {
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 1000) throw new Error("仓库分页参数无效");
    const files = (await entries(externalPath, commitSha)).map(entry => entry.path);
    const next = offset + limit;
    return { files: files.slice(offset, next), total: files.length, nextOffset: next < files.length ? next : null };
  }
  async searchFiles(externalPath: string, commitSha: string, query: Parameters<RepositoryPort["searchFiles"]>[2]): Promise<{ matches: RepositorySearchMatch[]; truncated: boolean }> {
    const limit = query.limit ?? 50;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) throw new Error("仓库搜索 limit 必须在 1 到 200 之间");
    if (typeof query.pattern !== "string" || !query.pattern || /[\0\r\n]/u.test(query.pattern)) throw new Error("仓库搜索 pattern 必须是非空单行文本");
    if ((query.regex !== undefined && typeof query.regex !== "boolean") || (query.caseSensitive !== undefined && typeof query.caseSensitive !== "boolean")) throw new Error("仓库搜索匹配选项无效");
    if (query.pathPrefix !== undefined && (typeof query.pathPrefix !== "string" || !validPath(query.pathPrefix.replace(/\/$/, "")))) throw new Error("仓库搜索 pathPrefix 无效");
    const prefix = query.pathPrefix === undefined ? "" : query.pathPrefix.split("/").filter(part => part !== ".").join("/");
    const files = (await entries(externalPath, commitSha)).filter(entry => entry.size <= maxFileBytes && entry.path.startsWith(prefix));
    const flags = [query.regex ? "-E" : "-F", ...(query.caseSensitive ? [] : ["-i"]), "-e", query.pattern, commitSha];
    if (!files.length) { await grep(externalPath, ["-l", "-z", ...flags, "--", ":(exclude)*"]); return { matches: [], truncated: false }; }
    const matches: RepositorySearchMatch[] = [];
    // Literal pathspec batches keep large repositories below the host's argument-size limit.
    for (let offset = 0; offset < files.length;) {
      const batch: typeof files = [];
      let bytes = 0;
      while (offset < files.length && bytes < 24000) {
        const entry = files[offset++]!; batch.push(entry); bytes += Buffer.byteLength(entry.path) + 20;
      }
      const names = new Set(decoder.decode(await grep(externalPath, ["-l", "-z", ...flags, "--", ...batch.map(entry => `:(literal)${entry.path}`)])).split("\0").filter(Boolean).map(name => name.slice(commitSha.length + 1)));
      for (const entry of batch) {
        if (!names.has(entry.path)) continue;
        const content = await git(externalPath, ["cat-file", "blob", entry.oid], maxFileBytes + 1);
        if (content.includes(0)) continue;
        try { decoder.decode(content); } catch { continue; }
        const lines = decoder.decode(await grep(externalPath, ["-n", "-h", "-m", String(limit + 1), ...flags, "--", `:(literal)${entry.path}`], maxFileBytes + 4096)).split("\n");
        for (const line of lines) {
          if (!line) continue;
          if (matches.length === limit) return { matches, truncated: true };
          const colon = line.indexOf(":");
          matches.push({ path: entry.path, line: Number(line.slice(0, colon)), text: Array.from(line.slice(colon + 1).replace(/\r$/, "")).slice(0, 300).join("") });
        }
      }
    }
    return { matches, truncated: false };
  }
  async readFile(externalPath: string, commitSha: string, filePath: string, startLine = 1, maxLines = 120): Promise<RepositoryFileExcerpt> {
    if (!validPath(filePath) || !Number.isSafeInteger(startLine) || startLine < 1 || !Number.isSafeInteger(maxLines) || maxLines < 1 || maxLines > 1000) throw new Error("仓库文件参数无效");
    const canonicalPath = filePath.split("/").filter(part => part !== ".").join("/");
    const entry = (await entries(externalPath, commitSha)).find(item => item.path === canonicalPath);
    if (!entry) throw new Error("仓库快照中没有这个普通文件");
    const size = Number(decoder.decode(await git(externalPath, ["cat-file", "-s", entry.oid], 1024)).trim());
    if (!Number.isSafeInteger(size) || size < 0 || size > maxFileBytes) throw new Error("仓库文件超过大小限制");
    const bytes = await git(externalPath, ["cat-file", "blob", entry.oid], maxFileBytes + 1);
    if (bytes.includes(0)) throw new Error("仓库文件包含二进制内容");
    let content: string;
    try { content = decoder.decode(bytes); } catch { throw new Error("仓库文件不是有效 UTF-8"); }
    const lines = content.split(/\r?\n/);
    if (startLine > lines.length) throw new Error("仓库文件行号超出范围");
    const selected = lines.slice(startLine - 1, startLine - 1 + maxLines).join("\n");
    const endLine = startLine + (selected.match(/\n/g) ?? []).length;
    return { externalPath, commitSha, path: filePath, startLine, endLine, text: selected, truncated: startLine - 1 + maxLines < lines.length };
  }
}
