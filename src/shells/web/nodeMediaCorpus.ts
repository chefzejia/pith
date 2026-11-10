import { execFile } from "node:child_process";
import dns from "node:dns/promises";
import { constants } from "node:fs";
import { access, chmod, lstat, mkdir, mkdtemp, open, readdir, realpath, rename, rm } from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join } from "node:path";
import type { MediaCorpusBundle, MediaCorpusPort, MediaSearchCandidate } from "../../core/index.ts";
import { isPublicHttpUrl } from "../../plugins/guide-acp/externalIngest.ts";
import { publicAddress } from "./nodeHttp.ts";

const maxFile = 25 * 1024 * 1024;
const maxBinary = 100 * 1024 * 1024;

export async function publicHost(host: string, signal?: AbortSignal): Promise<{ address: string; family: number }> {
  const name = host.startsWith("[") ? host.slice(1, -1) : host;
  const literal = net.isIP(name);
  const deadline = signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000);
  deadline.throwIfAborted();
  const addresses = literal ? [{ address: name, family: literal }] : await new Promise<{ address: string; family: number }[]>((ok, fail) => {
    const aborted = () => fail(deadline.reason); deadline.addEventListener("abort", aborted, { once: true });
    void dns.lookup(name, { all: true, verbatim: true }).then(ok, fail).finally(() => deadline.removeEventListener("abort", aborted));
  });
  if (!addresses.length || addresses.some(item => !publicAddress(item.address, item.family))) throw new Error("Host resolves to a non-public address");
  return addresses[0]!;
}

async function validatedUrl(input: string, signal?: AbortSignal): Promise<URL> {
  let url: URL;
  try { url = new URL(input); } catch { throw new Error("Invalid public media URL"); }
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443") || !isPublicHttpUrl(input)) throw new Error("Invalid public media URL");
  await publicHost(url.hostname, signal);
  return url;
}

async function secureProxy(): Promise<{ url: string; close(): Promise<void> }> {
  const sockets = new Set<net.Socket>(); let received = 0;
  const server = http.createServer((_req, res) => { res.writeHead(403); res.end(); });
  server.on("connection", socket => { if (sockets.size >= 64) { socket.destroy(); return; } sockets.add(socket); socket.on("close", () => sockets.delete(socket)); socket.setTimeout(30000, () => socket.destroy()); });
  server.on("connect", (req, socket, head) => {
    void (async () => {
      try {
        const match = /^(\[[0-9a-f:]+\]|[a-z0-9.-]+):443$/i.exec(req.url ?? "");
        if (!match || req.headers["proxy-authorization"]) throw new Error("Invalid proxy target");
        const target = await publicHost(match[1]!);
        if (socket.destroyed) return;
        const remote = net.connect({ host: target.address, port: 443, family: target.family });
        sockets.add(remote); remote.on("close", () => sockets.delete(remote)); remote.setTimeout(30000, () => remote.destroy());
        remote.on("data", (chunk: Buffer) => { received += chunk.length; if (received > 2 * maxFile + 8 * 1024 * 1024) { remote.destroy(); socket.destroy(); } });
        remote.once("error", () => socket.destroy()); socket.once("error", () => remote.destroy());
        remote.once("connect", () => { socket.write("HTTP/1.1 200 Connection Established\r\n\r\n"); if (head.length) remote.write(head); socket.pipe(remote); remote.pipe(socket); });
      } catch { socket.destroy(); }
    })();
  });
  await new Promise<void>((ok, fail) => { server.once("error", fail); server.listen(0, "127.0.0.1", ok); });
  const address = server.address(); if (!address || typeof address === "string") throw new Error("Proxy unavailable");
  return { url: `http://127.0.0.1:${address.port}`, async close() { for (const socket of sockets) socket.destroy(); await new Promise<void>(ok => server.close(() => ok())); } };
}

async function downloadOfficial(url: string, signal: AbortSignal, redirects = 0): Promise<Uint8Array> {
  if (redirects > 5) throw new Error("Too many binary redirects");
  const target = await validatedUrl(url, signal);
  if (!["github.com", "release-assets.githubusercontent.com", "objects.githubusercontent.com"].includes(target.hostname)) throw new Error("Untrusted binary download host");
  const address = await publicHost(target.hostname, signal);
  return new Promise((resolveDownload, reject) => {
    const request = https.get(target, { signal, agent: false, family: address.family, lookup: (_host, _opts, cb) => cb(null, address.address, address.family), headers: { "user-agent": "Pith" } }, response => {
      const status = response.statusCode ?? 0;
      if (status >= 300 && status < 400 && response.headers.location) { response.resume(); void downloadOfficial(new URL(response.headers.location, target).href, signal, redirects + 1).then(resolveDownload, reject); return; }
      if (status !== 200) { response.resume(); reject(new Error(`Binary download failed: ${status}`)); return; }
      const chunks: Buffer[] = []; let size = 0;
      response.on("data", (chunk: Buffer) => { size += chunk.length; if (size > maxBinary) response.destroy(new Error("Binary exceeds size limit")); else chunks.push(chunk); });
      response.on("error", reject); response.on("aborted", () => reject(new Error("Binary download aborted"))); response.on("end", () => resolveDownload(new Uint8Array(Buffer.concat(chunks))));
    });
    request.on("error", reject);
  });
}

async function ensureDirectory(path: string): Promise<void> {
  const parent = dirname(path);
  if (parent !== path) await ensureDirectory(parent);
  try { const stat = await lstat(path); if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Unsafe binary directory"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; await mkdir(path); }
}

export class NodeMediaCorpusPort implements MediaCorpusPort {
  private async binary(signal?: AbortSignal): Promise<string> {
    signal?.throwIfAborted(); const override = process.env.PITH_YTDLP_PATH;
    if (override) { if (!basename(override) || !isAbsolute(override)) throw new Error("Invalid yt-dlp path"); await access(override, constants.X_OK); return override; }
    const executable = process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp";
    for (const directory of (process.env.PATH ?? "").split(process.platform === "win32" ? ";" : ":").filter(Boolean)) {
      const candidate = join(directory, executable); try { await access(candidate, constants.X_OK); return candidate; } catch { /* try next executable */ }
    }
    const directory = join(homedir(), "Library", "Application Support", "pith", "bin"), target = join(directory, executable);
    try { const stat = await lstat(target); if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Unsafe managed binary"); await access(target, constants.X_OK); return target; } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    const asset = process.platform === "darwin" ? "yt-dlp_macos" : process.platform === "linux" && process.arch === "x64" ? "yt-dlp_linux" : process.platform === "linux" && process.arch === "arm64" ? "yt-dlp_linux_aarch64" : process.platform === "win32" && process.arch === "x64" ? "yt-dlp.exe" : null;
    if (!asset) throw new Error("Unsupported yt-dlp platform");
    await ensureDirectory(directory);
    const timeout = AbortSignal.timeout(120000), combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    const bytes = await downloadOfficial(`https://github.com/yt-dlp/yt-dlp/releases/latest/download/${asset}`, combined);
    const temp = join(directory, `.yt-dlp-${process.pid}-${crypto.randomUUID()}.tmp`);
    try { const file = await open(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o700); try { await file.writeFile(bytes); } finally { await file.close(); } await chmod(temp, 0o755); await rename(temp, target); } finally { await rm(temp, { force: true }); }
    return target;
  }

  private async run(args: readonly string[], directory: string, signal?: AbortSignal): Promise<string> {
    const binary = await this.binary(signal), proxy = await secureProxy();
    try {
      return await new Promise((ok, fail) => execFile(binary, ["--ignore-config", "--no-plugin-dirs", "--no-cache-dir", "--no-playlist", "--no-warnings", "--socket-timeout", "15", "--retries", "1", "--proxy", proxy.url, ...args], { cwd: directory, env: { HOME: directory, USERPROFILE: directory, TMPDIR: directory, TEMP: directory, PATH: process.env.PATH ?? "" }, timeout: 120000, maxBuffer: 2 * 1024 * 1024, signal }, (error, stdout) => error ? fail(error) : ok(stdout)));
    } finally { await proxy.close(); }
  }

  async searchMedia(query: string, limit = 5, signal?: AbortSignal): Promise<readonly MediaSearchCandidate[]> {
    if (!query.trim() || query.length > 500 || !Number.isInteger(limit) || limit < 1 || limit > 10) throw new Error("Invalid media search");
    const directory = await mkdtemp(join(await realpath(tmpdir()), "pith-media-"));
    try {
      const output = await this.run(["--dump-json", "--flat-playlist", "--", `ytsearch${limit}:${query.trim()}`], directory, signal);
      const result: MediaSearchCandidate[] = [];
      for (const line of output.split(/\r?\n/).filter(Boolean)) {
        const item: unknown = JSON.parse(line); if (!item || typeof item !== "object") throw new Error("Invalid media search result");
        const value = item as Record<string, unknown>; const candidate = typeof value.webpage_url === "string" ? value.webpage_url : value.url;
        if (typeof value.id !== "string" || !value.id || typeof value.title !== "string" || !value.title || typeof candidate !== "string") throw new Error("Invalid media search result");
        const url = candidate.startsWith("https://") ? candidate : /^[\w-]{11}$/.test(value.id) ? `https://www.youtube.com/watch?v=${value.id}` : "";
        await validatedUrl(url, signal);
        result.push({ id: value.id, title: value.title, url, ...(typeof value.duration === "number" && Number.isFinite(value.duration) ? { durationSec: value.duration } : {}), ...(typeof value.uploader === "string" ? { uploader: value.uploader } : {}) });
        if (result.length >= limit) break;
      }
      return result;
    } finally { await rm(directory, { recursive: true, force: true }); }
  }

  async fetchMediaCorpus(input: string, options: { readonly maxDurationSec?: number; readonly lang?: string } = {}, signal?: AbortSignal): Promise<MediaCorpusBundle> {
    const url = await validatedUrl(input, signal);
    if (options.lang !== undefined && !/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})?$/.test(options.lang)) throw new Error("Invalid subtitle language");
    if (options.maxDurationSec !== undefined && (!Number.isInteger(options.maxDurationSec) || options.maxDurationSec < 1 || options.maxDurationSec > 86400)) throw new Error("Invalid maximum duration");
    const directory = await mkdtemp(join(await realpath(tmpdir()), "pith-media-")); const warnings: string[] = [];
    try {
      const common = ["--max-filesize", "25M", "--restrict-filenames", "-o", "%(id)s.%(ext)s", ...(options.maxDurationSec ? ["--match-filter", `duration <= ${options.maxDurationSec}`] : [])];
      let title = url.hostname;
      try { const output = await this.run([...common, "--no-simulate", "--print", "after_move:%(title)s", "--downloader", "native", "-f", "ba[protocol^=http][filesize<25M]/ba[protocol^=http][filesize_approx<25M]", "--", url.href], directory, signal); if (output.trim()) title = output.trim().split(/\r?\n/)[0]!.slice(0, 500); } catch (error) { if (signal?.aborted) throw error; warnings.push("音轨提取失败"); }
      try { await this.run([...common, "--skip-download", "--write-subs", "--write-auto-subs", "--sub-langs", options.lang ?? "en.*,zh.*", "--sub-format", "vtt", "--", url.href], directory, signal); } catch (error) { if (signal?.aborted) throw error; warnings.push("字幕提取失败"); }
      const files: { name: string; mimeType: string; bytes: Uint8Array }[] = [];
      const names = await readdir(directory); if (names.length > 20) throw new Error("Too many media files"); let total = 0;
      for (const name of names) {
        if (!/^[a-zA-Z0-9_.-]+$/.test(name) || name.startsWith(".")) throw new Error("Unsafe media filename");
        const info = await lstat(join(directory, name)); if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1) throw new Error("Unsafe media file");
        const mimeType = /\.vtt$/i.test(name) ? "text/vtt" : /\.m4a$/i.test(name) ? "audio/mp4" : /\.webm$/i.test(name) ? "audio/webm" : /\.mp3$/i.test(name) ? "audio/mpeg" : /\.opus$/i.test(name) ? "audio/ogg" : null;
        if (!mimeType) continue;
        const file = await open(join(directory, name), constants.O_RDONLY | constants.O_NOFOLLOW); try { const stat = await file.stat(); total += stat.size; if (!stat.isFile() || stat.nlink !== 1 || stat.size > maxFile || total > 2 * maxFile) throw new Error("Unsafe media file"); files.push({ name, mimeType, bytes: new Uint8Array(await file.readFile()) }); } finally { await file.close(); }
      }
      if (!files.length) throw new Error("未能获取音轨或字幕");
      if (!files.some(file => file.mimeType.startsWith("audio/")) && !warnings.includes("音轨提取失败")) warnings.push("未找到音轨");
      if (!files.some(file => file.mimeType === "text/vtt") && !warnings.includes("字幕提取失败")) warnings.push("未找到字幕");
      return { title, sourceUrl: url.href, files, ...(warnings.length ? { warnings } : {}) };
    } finally { await rm(directory, { recursive: true, force: true }); }
  }
}
