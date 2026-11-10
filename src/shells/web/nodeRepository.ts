import { execFile } from "node:child_process";
import { realpath, stat } from "node:fs/promises";
import { basename, isAbsolute } from "node:path";
import { homedir } from "node:os";
import { promisify } from "node:util";
import type { RepositoryFileExcerpt, RepositoryPort } from "../../core/index.ts";

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
  return !!path && !isAbsolute(path) && !/[\\\u0000-\u001f\u007f]/u.test(path) && path.split("/").every(part => part !== "" && part !== "." && part !== "..");
}

async function entries(root: string, commit: string): Promise<{ path: string; oid: string }[]> {
  if (!isAbsolute(root) || !commitPattern.test(commit)) throw new Error("仓库绑定无效");
  const canonical = await realpath(root);
  const top = await realpath(decoder.decode(await git(canonical, ["rev-parse", "--show-toplevel"])).trim());
  if (canonical !== top) throw new Error("仓库路径不再指向根目录");
  if (decoder.decode(await git(canonical, ["cat-file", "-t", commit], 1024)).trim() !== "commit") throw new Error("仓库版本不是 commit");
  const data = decoder.decode(await git(canonical, ["ls-tree", "-r", "-z", "--full-tree", commit]));
  return data.split("\0").filter(Boolean).flatMap(record => {
    const match = /^(100644|100755) blob ([a-f0-9]{40}|[a-f0-9]{64})\t(.+)$/u.exec(record);
    return match && validPath(match[3]!) ? [{ oid: match[2]!, path: match[3]! }] : [];
  });
}

export class NodeRepositoryPort implements RepositoryPort {
  async inspectRepository(repoPath: string): Promise<{ externalPath: string; commitSha: string; title: string }> {
    if (/^[a-z]:[\\/]/i.test(repoPath) && process.platform !== "win32") throw new Error("当前系统不支持 Windows 仓库路径");
    if (repoPath.startsWith("~/")) repoPath = `${homedir()}/${repoPath.slice(2)}`;
    if (!isAbsolute(repoPath) || repoPath.includes("\0")) throw new Error("请输入仓库绝对路径");
    let directory: string;
    try { directory = await realpath(repoPath); } catch (error) { const separator = repoPath.indexOf(" — "); if (separator < 0 || (error as NodeJS.ErrnoException).code !== "ENOENT") throw error; directory = await realpath(repoPath.slice(0, separator)); }
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
  async readFile(externalPath: string, commitSha: string, filePath: string, startLine = 1, maxLines = 120): Promise<RepositoryFileExcerpt> {
    if (!validPath(filePath) || !Number.isSafeInteger(startLine) || startLine < 1 || !Number.isSafeInteger(maxLines) || maxLines < 1 || maxLines > 1000) throw new Error("仓库文件参数无效");
    const entry = (await entries(externalPath, commitSha)).find(item => item.path === filePath);
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
    const text = selected.slice(0, 12000);
    const endLine = startLine + (text.match(/\n/g) ?? []).length;
    return { externalPath, commitSha, path: filePath, startLine, endLine, text, truncated: selected.length > text.length || startLine - 1 + maxLines < lines.length };
  }
}
