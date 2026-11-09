import { spawn, execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { lstat, readFile, rm } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";

export interface SpeechArchive { url: string; hash: string; algorithm: "sha256" | "sha512"; encoding: "hex" | "base64"; maxBytes: number }
export interface DownloadProgress { bytes: number; total?: number }
export interface DownloadPolicy { connectTimeoutSec: number; lowSpeedBytes: number; lowSpeedSeconds: number; backoffMs: number }
export const defaultDownloadPolicy: DownloadPolicy = { connectTimeoutSec: 20, lowSpeedBytes: 1024, lowSpeedSeconds: 30, backoffMs: 1000 };

async function archiveSize(path: string): Promise<number> {
  try { const info = await lstat(path); if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1) throw new Error("语音归档必须是普通文件"); return info.size; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0; throw error; }
}

async function valid(path: string, archive: SpeechArchive, signal: AbortSignal): Promise<boolean> {
  signal.throwIfAborted();
  const size = await archiveSize(path);
  if (size > archive.maxBytes) throw new Error("语音归档超过大小限制");
  if (!size) return false;
  const hash = createHash(archive.algorithm);
  for await (const chunk of createReadStream(path, { signal })) { signal.throwIfAborted(); hash.update(chunk); }
  return hash.digest(archive.encoding) === archive.hash;
}

async function proxyEnvironment(): Promise<Record<string, string>> {
  const keys = ["HTTPS_PROXY", "HTTP_PROXY", "NO_PROXY", "https_proxy", "http_proxy", "no_proxy"];
  const env = Object.fromEntries(keys.filter(key => process.env[key] !== undefined).map(key => [key, process.env[key]! ]));
  if (process.platform !== "darwin" || process.env.HTTPS_PROXY !== undefined || process.env.https_proxy !== undefined) return env;
  try {
    const { stdout } = await promisify(execFile)("/usr/sbin/scutil", ["--proxy"], { timeout: 2000, env: { PATH: "/usr/bin:/bin" }, maxBuffer: 16384 });
    const proxy = parseSystemProxy(stdout); if (proxy) env.HTTPS_PROXY = proxy;
  } catch { return env; }
  return env;
}

export function parseSystemProxy(output: string): string | undefined {
  for (const protocol of ["HTTPS", "HTTP"]) {
    const enabled = new RegExp(`^\\s*${protocol}Enable : 1\\s*$`, "m").test(output);
    const host = new RegExp(`^\\s*${protocol}Proxy : ([^\\s]+)\\s*$`, "m").exec(output);
    const port = new RegExp(`^\\s*${protocol}Port : (\\d+)\\s*$`, "m").exec(output);
    if (enabled && host && port && /^(localhost|127\.0\.0\.1|\[::1\])$/i.test(host[1]!) && Number(port[1]) > 0 && Number(port[1]) <= 65535) return `http://${host[1]}:${port[1]}`;
  }
  return undefined;
}

async function responseHeaders(headers: string): Promise<{ status: number; start?: number; end?: number; total?: number }> {
  let raw = "";
  try { raw = await readFile(headers, "utf8"); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  const blocks = raw.split(/\r?\n\r?\n/).filter(block => /^HTTP\//i.test(block));
  const last = blocks.at(-1) ?? "";
  const status = Number(/^HTTP\/\S+\s+(\d+)/i.exec(last)?.[1] ?? 0);
  const range = /^content-range:[ \t]*bytes[ \t]+(\d+)-(\d+)\/(\d+)[ \t]*\r?$/im.exec(last);
  const unsatisfied = /^content-range:[ \t]*bytes[ \t]+\*\/(\d+)[ \t]*\r?$/im.exec(last);
  const length = /^content-length:[ \t]*(\d+)[ \t]*\r?$/im.exec(last);
  const total = range ? Number(range[3]) : unsatisfied ? Number(unsatisfied[1]) : status === 200 && length ? Number(length[1]) : undefined;
  return { status, ...(range ? { start: Number(range[1]), end: Number(range[2]) } : {}), ...(total === undefined ? {} : { total }) };
}

async function sample(path: string, headers: string, before: number, report: (progress: DownloadProgress) => void): Promise<void> {
  const response = await responseHeaders(headers);
  const validRange = before === 0 || (response.status === 206 && response.start === before);
  const bytes = before + (validRange ? await archiveSize(path) : 0);
  const total = validRange ? response.total : undefined;
  report({ bytes, ...(total !== undefined && total > 0 ? { total } : {}) });
}

async function transfer(path: string, archive: SpeechArchive, signal: AbortSignal, report: (progress: DownloadProgress) => void, policy: DownloadPolicy, before: number): Promise<{ code: number; http: number; start?: number; end?: number; total?: number }> {
  signal.throwIfAborted();
  const headers = `${path}.headers`;
  await rm(headers, { force: true });
  const target = before ? `${path}.resume` : path;
  if (before) { await archiveSize(target); await rm(target, { force: true }); }
  const proxy = await proxyEnvironment(); signal.throwIfAborted();
  const host = new URL(archive.url).hostname;
  const noProxy = ["127.0.0.1", "localhost", "[::1]"].includes(host) ? ["--noproxy", "*"] : [];
  const args = ["--disable", "--silent", "--show-error", "--fail", "--location", "--connect-timeout", String(policy.connectTimeoutSec), "--speed-limit", String(policy.lowSpeedBytes), "--speed-time", String(policy.lowSpeedSeconds), "--max-filesize", String(archive.maxBytes - before), ...(before ? ["--range", `${before}-`] : []), "--dump-header", headers, "--output", target, "--write-out", "%{http_code}", ...noProxy, archive.url];
  const result = await new Promise<{ code: number; http: number; start?: number; end?: number; total?: number }>((resolveTransfer, reject) => {
    const child = spawn("curl", args, { cwd: undefined, env: { ...proxy, PATH: "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin" }, stdio: ["ignore", "pipe", "ignore"] });
    let output = "", spawnError: Error | undefined, sampleError: unknown, pendingSample: Promise<void> | null = null;
    child.stdout.on("data", data => { output += String(data); });
    child.once("error", error => { spawnError = error; });
    const abort = () => child.kill("SIGTERM");
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    const timer = setInterval(() => { if (!pendingSample) { pendingSample = sample(target, headers, before, report).catch(error => { sampleError = error; child.kill("SIGTERM"); }).finally(() => { pendingSample = null; }); } }, 250);
    child.once("close", (code) => {
      clearInterval(timer); signal.removeEventListener("abort", abort);
      void (pendingSample ?? Promise.resolve()).then(() => sample(target, headers, before, report)).then(() => responseHeaders(headers)).then(async response => { await rm(headers, { force: true }); return response; }).then(response => {
        if (sampleError) reject(sampleError); else if (spawnError) reject(spawnError); else resolveTransfer({ ...response, code: code ?? -1, http: Number(output) || response.status });
      }, reject);
    });
  });
  if (before) {
    const size = await archiveSize(target);
    const validRange = result.http === 206 && result.start === before && result.end !== undefined && result.total !== undefined && result.end >= before && result.end < result.total && size <= result.end - before + 1 && before + size <= archive.maxBytes;
    if (size && validRange) {
      if (await archiveSize(path) !== before) throw new Error("语音归档在续传期间发生变化");
      await pipeline(createReadStream(target), createWriteStream(path, { flags: "a" }));
    }
    await rm(target, { force: true });
    if (result.http === 206 && !validRange) throw new Error("服务器返回无效的续传范围，已保留原分片");
  }
  signal.throwIfAborted();
  return result;
}

export async function downloadSpeechArchive(path: string, archive: SpeechArchive, signal: AbortSignal, report: (progress: DownloadProgress) => void, policy = defaultDownloadPolicy): Promise<void> {
  signal.throwIfAborted();
  if (await valid(path, archive, signal)) { const bytes = await archiveSize(path); signal.throwIfAborted(); report({ bytes, total: bytes }); return; }
  for (let attempt = 0; attempt <= 3; attempt++) {
    signal.throwIfAborted();
    const before = await archiveSize(path);
    if (before > archive.maxBytes) throw new Error("语音归档超过大小限制");
    const result = await transfer(path, archive, signal, report, policy, before);
    if (result.code === 0 && await valid(path, archive, signal)) return;
    const after = await archiveSize(path);
    if (before > 0 && result.http === 200) throw new Error("服务器不支持断点续传，已保留原分片");
    if (result.http === 416 && (result.total === undefined || result.total !== before)) throw new Error("服务器拒绝续传，已保留原分片");
    if (result.http === 416 && await valid(path, archive, signal)) { report({ bytes: after, total: after }); return; }
    if (result.http === 416 || (result.code === 0 && result.total !== undefined && after === result.total)) await rm(path);
    else if (result.code === 0 && result.total === undefined) throw new Error("无法确认归档是否完整，已保留分片");
    if (attempt === 3) throw new Error(result.code === 0 ? "语音归档校验失败" : `语音下载失败 (${result.code}, HTTP ${result.http})`);
    await delay(policy.backoffMs * 2 ** attempt, undefined, { signal });
  }
}
