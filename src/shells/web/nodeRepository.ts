import { execFile, spawn } from "node:child_process";
import { mkdir, realpath, rm, stat } from "node:fs/promises";
import { basename, isAbsolute, join, sep } from "node:path";
import { homedir } from "node:os";
import { promisify } from "node:util";
import { normalizeRepositoryUrl } from "../../core/index.ts";
import type { RepositoryChange, RepositoryFileExcerpt, RepositoryPort, RepositorySearchMatch } from "../../core/index.ts";

const run = promisify(execFile);
const commitPattern = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const maxTreeBytes = 8 * 1024 * 1024;
const maxFileBytes = 256 * 1024;
const decoder = new TextDecoder("utf-8", { fatal: true });

function readOnlyGitEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith("GIT_")) delete env[key];
  Object.assign(env, { GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null", GIT_NO_REPLACE_OBJECTS: "1", GIT_NO_LAZY_FETCH: "1", GIT_TERMINAL_PROMPT: "0", GIT_PAGER: "cat" });
  return env;
}
async function git(root: string, args: string[], maxBuffer = maxTreeBytes): Promise<Buffer> {
  return (await run("git", ["--no-optional-locks", "-c", "core.fsmonitor=false", "-C", root, ...args], { encoding: "buffer", env: readOnlyGitEnv(), maxBuffer, timeout: 15000, windowsHide: true })).stdout;
}

async function gitPatch(root: string, args: string[], maxLines: number): Promise<{ patch: string; truncated: boolean }> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", ["--no-optional-locks", "-c", "core.fsmonitor=false", "-C", root, ...args], { env: readOnlyGitEnv(), stdio: ["ignore", "pipe", "pipe"], timeout: 15000, killSignal: "SIGKILL", windowsHide: true });
    const decoder = new TextDecoder("utf-8", { fatal: true }), lines: string[] = [];
    let pending = "", error = "", failure: unknown, truncated = false;
    const line = (value: string) => { if (lines.length === maxLines) truncated = true; else lines.push(value); };
    child.stdout.on("data", (chunk: Buffer) => {
      if (truncated || failure) return;
      try {
        pending += decoder.decode(chunk, { stream: true }); let end: number;
        while ((end = pending.indexOf("\n")) >= 0 && !truncated) { line(pending.slice(0, end)); pending = pending.slice(end + 1); }
        if (truncated) pending = "";
      } catch (cause) { failure = cause; child.kill("SIGKILL"); }
    });
    child.stderr.on("data", (chunk: Buffer) => { error = (error + chunk.toString("utf8")).slice(-8192); });
    child.once("error", reject);
    child.once("close", (code, signal) => {
      if (failure) { reject(failure); return; }
      if (code !== 0) { reject(new Error(`仓库比较失败：${error.trim() || signal || code}`)); return; }
      try { if (!truncated) { pending += decoder.decode(); if (pending) line(pending); } resolve({ patch: lines.join("\n"), truncated }); } catch (cause) { reject(cause); }
    });
  });
}

// Only clone/fetch use the user's Git configuration and credential/SSH environment.
// A detached process group lets cancellation reap Git's own transport descendants too.
async function remoteGit(args: string[], signal?: AbortSignal): Promise<string> {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawn("git", ["-c", "core.fsmonitor=false", ...args], {
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_PAGER: "cat" },
      detached: process.platform !== "win32", windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "", error = "", timedOut = false;
    const kill = () => { try { if (process.platform === "win32") child.kill("SIGKILL"); else if (child.pid) process.kill(-child.pid, "SIGKILL"); } catch (cause) { if ((cause as NodeJS.ErrnoException).code !== "ESRCH") throw cause; } };
    const timer = setTimeout(() => { timedOut = true; kill(); }, 180_000);
    signal?.addEventListener("abort", kill, { once: true });
    if (signal?.aborted) kill();
    child.stdout.on("data", (data: Buffer) => { output = (output + data.toString("utf8")).slice(-8192); });
    child.stderr.on("data", (data: Buffer) => { error = (error + data.toString("utf8")).slice(-8192); });
    const cleanup = () => { clearTimeout(timer); signal?.removeEventListener("abort", kill); };
    child.on("error", cause => { cleanup(); reject(cause); });
    child.on("close", code => {
      cleanup();
      if (signal?.aborted) reject(new Error("已停止克隆仓库"));
      else if (timedOut) reject(new Error("仓库操作超时"));
      else if (code !== 0) reject(new Error(`仓库操作失败：${error.trim() || `git exited ${code}`}`));
      else resolve(output.trim());
    });
  });
}

// Shared across host instances; operations for distinct remotes remain independent.
const clones = new Map<string, Promise<unknown>>();
async function waitForClone(previous: Promise<unknown>, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  await new Promise<void>((resolve, reject) => {
    const abort = () => { signal?.removeEventListener("abort", abort); reject(new Error("已停止克隆仓库")); };
    signal?.addEventListener("abort", abort, { once: true });
    void previous.catch(() => {}).then(() => { signal?.removeEventListener("abort", abort); resolve(); });
  });
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
  async fetchRemote(externalPath: string, signal?: AbortSignal): Promise<{ commitSha: string }> {
    signal?.throwIfAborted();
    const home = process.env.PITH_REPOSITORY_HOME ?? join(homedir(), "Library/Application Support/pith/repositories");
    if (!isAbsolute(home) || !isAbsolute(externalPath)) throw new Error("仓库绑定无效");
    const canonical = await realpath(externalPath), managedHome = await realpath(home);
    if (!canonical.startsWith(managedHome + sep)) throw new Error("只可拉取 Pith 克隆的仓库");
    const origin = decoder.decode(await git(canonical, ["config", "--get", "remote.origin.url"], 4096)).trim();
    const remoteUrl = normalizeRepositoryUrl(origin);
    if (!remoteUrl || remoteUrl !== origin || canonical !== await realpath(join(home, "github.com", remoteUrl.slice("https://github.com/".length)))) throw new Error("仓库目录的远端地址不匹配");
    const result = await this.cloneRemote(remoteUrl, signal);
    return { commitSha: result.commitSha };
  }
  async listChanges(externalPath: string, fromSha: string, toSha: string, offset = 0, limit = 200): Promise<{ changes: RepositoryChange[]; total: number; nextOffset: number | null }> {
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 1000) throw new Error("仓库比较分页参数无效");
    const [before, after] = await Promise.all([entries(externalPath, fromSha), entries(externalPath, toSha)]);
    const ordinary = new Set([...before, ...after].map(entry => entry.path));
    const flags = ["diff", "--no-ext-diff", "--no-textconv", "--no-color", "--no-relative", "--find-renames"];
    const stats = decoder.decode(await git(externalPath, [...flags, "--numstat", "-z", fromSha, toSha, "--"])).split("\0");
    const counts = new Map<string, { additions: number; deletions: number }>();
    for (let index = 0; index < stats.length && stats[index]; index++) {
      const match = /^(\d+|-)\t(\d+|-)\t([\s\S]*)$/u.exec(stats[index]!);
      if (!match) throw new Error("仓库差异统计无效");
      let path = match[3]!;
      if (!path) { index++; path = stats[++index]!; }
      counts.set(path, { additions: match[1] === "-" ? 0 : Number(match[1]), deletions: match[2] === "-" ? 0 : Number(match[2]) });
    }
    const names = decoder.decode(await git(externalPath, [...flags, "--name-status", "-z", fromSha, toSha, "--"])).split("\0");
    const changes: RepositoryChange[] = [];
    for (let index = 0; index < names.length && names[index];) {
      const status = names[index++]!, oldPath = names[index++]!;
      const path = status.startsWith("R") ? names[index++]! : oldPath;
      if (!validPath(path) || !ordinary.has(path) && !ordinary.has(oldPath)) continue;
      const count = counts.get(path); if (!count) throw new Error("仓库差异统计缺失");
      changes.push({ path, status: status.startsWith("R") ? "renamed" : status === "A" ? "added" : status === "D" ? "deleted" : "modified", ...(status.startsWith("R") ? { previousPath: oldPath } : {}), ...count });
    }
    return { changes: changes.slice(offset, offset + limit), total: changes.length, nextOffset: offset + limit < changes.length ? offset + limit : null };
  }
  async readChange(externalPath: string, fromSha: string, toSha: string, filePath: string, maxLines = 400): Promise<{ path: string; patch: string; truncated: boolean }> {
    if (!validPath(filePath) || !Number.isSafeInteger(maxLines) || maxLines < 1 || maxLines > 2000) throw new Error("仓库差异参数无效");
    const path = filePath.split("/").filter(part => part !== ".").join("/");
    const [before, after] = await Promise.all([entries(externalPath, fromSha), entries(externalPath, toSha)]);
    if (![...before, ...after].some(entry => entry.path === path)) throw new Error("仓库快照中没有这个普通文件");
    return { path, ...await gitPatch(externalPath, ["diff", "--no-ext-diff", "--no-textconv", "--no-color", "--no-relative", "--find-renames", "--unified=3", fromSha, toSha, "--", `:(literal)${path}`], maxLines) };
  }
  async cloneRemote(input: string, signal?: AbortSignal): Promise<{ externalPath: string; commitSha: string; title: string; remoteUrl: string }> {
    const remoteUrl = normalizeRepositoryUrl(input);
    if (!remoteUrl) throw new Error("请输入 GitHub 仓库根地址");
    const home = process.env.PITH_REPOSITORY_HOME ?? join(homedir(), "Library/Application Support/pith/repositories");
    if (!isAbsolute(home)) throw new Error("PITH_REPOSITORY_HOME 必须是绝对路径");
    const title = remoteUrl.slice("https://github.com/".length), target = join(home, "github.com", title);
    while (clones.has(target)) await waitForClone(clones.get(target)!, signal);
    signal?.throwIfAborted();
    const operation = (async () => {
      let created = false;
      try {
        await mkdir(join(target, ".."), { recursive: true });
        try { await mkdir(target); created = true; }
        catch (cause) { if ((cause as NodeJS.ErrnoException).code !== "EEXIST") throw cause; }
        signal?.throwIfAborted();
        if (created) await remoteGit(["clone", "--depth=1", "--no-checkout", "--no-tags", "--", remoteUrl, target], signal);
        else {
          // Fail closed if a managed pathname is occupied by an unrelated repository.
          const origin = decoder.decode(await git(target, ["config", "--get", "remote.origin.url"], 4096)).trim();
          if (origin !== remoteUrl) throw new Error("仓库目录的远端地址不匹配");
          await remoteGit(["-C", target, "fetch", "--depth=1", "--no-tags", "origin", "HEAD"], signal);
        }
        const commitSha = decoder.decode(await git(target, ["rev-parse", "--verify", created ? "HEAD^{commit}" : "FETCH_HEAD^{commit}"])).trim();
        if (!commitPattern.test(commitSha)) throw new Error("仓库 commit 无效");
        signal?.throwIfAborted();
        await remoteGit(["-C", target, "update-ref", `refs/pith/pins/${commitSha}`, commitSha], signal);
        await remoteGit(["-C", target, "update-ref", "HEAD", commitSha], signal);
        signal?.throwIfAborted();
        return { externalPath: await realpath(target), commitSha, title, remoteUrl };
      } catch (cause) {
        if (created) await rm(target, { recursive: true, force: true });
        throw cause;
      }
    })();
    clones.set(target, operation);
    try { return await operation; }
    finally { if (clones.get(target) === operation) clones.delete(target); }
  }
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
