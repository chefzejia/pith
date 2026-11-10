import { execFile } from "node:child_process";
import dns from "node:dns/promises";
import { constants } from "node:fs";
import { access, chmod, lstat, mkdir, mkdtemp, open, readdir, realpath, rename, rm } from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join } from "node:path";
import type { MediaCorpusBundle, MediaCorpusPort, MediaCorpusSlice, MediaSearchCandidate } from "../../core/index.ts";
import { isPublicHttpUrl } from "../../plugins/guide-acp/externalIngest.ts";
import { formatTimestamp, parseTranscript } from "../../plugins/stage-timeline/index.ts";
import { publicAddress } from "./nodeHttp.ts";

const maxFile = 25 * 1024 * 1024;
const maxBinary = 100 * 1024 * 1024;

export function buildMediaCorpusSlices(vttText: string, targetSliceSec = 45): MediaCorpusSlice[] {
  if (!Number.isFinite(targetSliceSec) || targetSliceSec < 25 || targetSliceSec > 60) throw new RangeError("Invalid slice duration");
  const cues = parseTranscript(vttText).flatMap(cue => { const count = Math.ceil((cue.endSec - cue.startSec) / 60); if (count <= 1) return [cue]; const chars = Array.from(cue.text); return Array.from({ length: count }, (_, i) => ({ ...cue, startSec: cue.startSec + (cue.endSec - cue.startSec) * i / count, endSec: cue.startSec + (cue.endSec - cue.startSec) * (i + 1) / count, text: chars.slice(Math.floor(chars.length * i / count), Math.floor(chars.length * (i + 1) / count)).join("") })); }), slices: MediaCorpusSlice[] = []; let group: typeof cues = [];
  const flush = () => { if (!group.length) return; const startSec = group[0]!.startSec, endSec = Math.max(...group.map(cue => cue.endSec)), index = slices.length + 1; slices.push({ id: `slice-${index}`, title: `片段 ${index} (${formatTimestamp(startSec)} - ${formatTimestamp(endSec)})`, startSec, endSec, cueCount: group.length, text: group.map(cue => cue.text.trim()).join(" ") }); group = []; };
  for (const cue of cues) { if (group.length && cue.endSec - group[0]!.startSec > 60) flush(); group.push(cue); const span = cue.endSec - group[0]!.startSec; if (span >= 25 && (span >= targetSliceSec || /[.!?。！？][\s"'”’）)]*$/u.test(cue.text))) flush(); }
  flush(); return slices;
}

function transcriptVtt(text: string, durationSec?: number): { vtt: string; estimated: boolean } {
  if (text.length > 4 * 1024 * 1024) throw new Error("语音识别文本过长");
  const sentences = (text.match(/[^.!?。！？\n]+[.!?。！？]*|[^\n]+/gu) ?? []).map(item => item.trim()).filter(Boolean);
  if (!sentences.length) throw new Error("语音识别未返回文本");
  const estimated = !durationSec || !Number.isFinite(durationSec) || durationSec <= 0;
  const duration = estimated ? sentences.length * 4 : durationSec!;
  const durationMs = Math.round(duration * 1000);
  if (sentences.length > 10000 || durationMs < sentences.length) throw new Error("语音识别时间范围无效");
  const stamp = (millis: number) => { const hours = Math.floor(millis / 3600000), minutes = Math.floor(millis / 60000) % 60, seconds = Math.floor(millis / 1000) % 60; return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(millis % 1000).padStart(3, "0")}`; };
  const weight = sentences.map(sentence => Array.from(sentence).length), total = weight.reduce((a, b) => a + b, 0); let elapsed = 0, previousMs = 0;
  return { vtt: `WEBVTT\n\n${sentences.map((sentence, i) => { const start = previousMs; elapsed += weight[i]!; const end = Math.max(start + 1, Math.min(Math.round(durationMs * elapsed / total), durationMs - (sentences.length - i - 1))); previousMs = end; return `${stamp(start)} --> ${stamp(end)}\n${sentence.replace(/-->/g, "→")}\n`; }).join("\n")}`, estimated };
}

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
  private transcribeAudio?: (bytes: Uint8Array, mimeType: string, signal?: AbortSignal) => Promise<{ readonly text: string; readonly durationSec?: number }>;
  constructor(options: { transcribeAudio?: (bytes: Uint8Array, mimeType: string, signal?: AbortSignal) => Promise<{ readonly text: string; readonly durationSec?: number }> } = {}) { this.transcribeAudio = options.transcribeAudio; }
  setTranscriber(transcribeAudio: NonNullable<NodeMediaCorpusPort["transcribeAudio"]>): void { this.transcribeAudio = transcribeAudio; }
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
      let title = url.hostname, videoCodec = "", mediaDuration: number | undefined;
      try { const output = await this.run([...common, "--no-simulate", "--print", "after_move:%(title)s", "--print", "after_move:%(vcodec)s", "--print", "after_move:%(duration)s", "--downloader", "native", "-f", "b[ext=mp4][protocol^=http][filesize<25M]/b[ext=webm][protocol^=http][filesize<25M]/ba[protocol^=http][filesize<25M]/ba[protocol^=http][filesize_approx<25M]", "--", url.href], directory, signal); const lines = output.trim().split(/\r?\n/); if (lines[0]) title = lines[0].slice(0, 500); videoCodec = lines[1] ?? ""; const duration = Number(lines[2]); if (Number.isFinite(duration) && duration > 0) mediaDuration = duration; } catch (error) { if (signal?.aborted) throw error; warnings.push("音轨提取失败"); }
      try { await this.run([...common, "--skip-download", "--write-subs", "--write-auto-subs", "--sub-langs", options.lang ?? "en.*,zh.*", "--sub-format", "vtt", "--", url.href], directory, signal); } catch (error) { if (signal?.aborted) throw error; warnings.push("字幕提取失败"); }
      const files: { name: string; mimeType: string; bytes: Uint8Array }[] = [];
      const names = await readdir(directory); if (names.length > 20) throw new Error("Too many media files"); let total = 0;
      for (const name of names) {
        if (!/^[a-zA-Z0-9_.-]+$/.test(name) || name.startsWith(".")) throw new Error("Unsafe media filename");
        const info = await lstat(join(directory, name)); if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1) throw new Error("Unsafe media file");
        const mimeType = /\.vtt$/i.test(name) ? "text/vtt" : /\.mp4$/i.test(name) ? "video/mp4" : /\.m4a$/i.test(name) ? "audio/mp4" : /\.webm$/i.test(name) ? videoCodec && videoCodec !== "none" && videoCodec !== "NA" ? "video/webm" : "audio/webm" : /\.mp3$/i.test(name) ? "audio/mpeg" : /\.opus$/i.test(name) ? "audio/ogg" : null;
        if (!mimeType) continue;
        const file = await open(join(directory, name), constants.O_RDONLY | constants.O_NOFOLLOW); try { const stat = await file.stat(); total += stat.size; if (!stat.isFile() || stat.nlink !== 1 || stat.size > maxFile || total > 2 * maxFile) throw new Error("Unsafe media file"); files.push({ name, mimeType, bytes: new Uint8Array(await file.readFile()) }); } finally { await file.close(); }
      }
      if (!files.length) throw new Error("未能获取音轨或字幕");
      const media = files.find(file => /^(audio|video)\//.test(file.mimeType));
      if (!media && !warnings.includes("音轨提取失败")) warnings.push("未找到音轨");
      if (media && !files.some(file => file.mimeType === "text/vtt") && this.transcribeAudio) {
        try { let audio = media;
          if (media.mimeType.startsWith("video/")) {
            const audioDir = join(directory, "asr"); await mkdir(audioDir);
            await this.run(["--max-filesize", "25M", "--restrict-filenames", "-o", "asr.%(ext)s", "--downloader", "native", "-f", "ba[protocol^=http][filesize<25M]/ba[protocol^=http][filesize_approx<25M]", "--", url.href], audioDir, signal);
            const names = await readdir(audioDir); if (names.length !== 1 || !/^asr\.(m4a|webm|mp3|opus)$/i.test(names[0]!)) throw new Error("未找到可转写音轨");
            const name = names[0]!, path = join(audioDir, name), info = await lstat(path); if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1) throw new Error("Unsafe media file");
            const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW); try { const stat = await file.stat(); if (!stat.isFile() || stat.nlink !== 1 || stat.size > maxFile) throw new Error("Unsafe media file"); const mimeType = /\.m4a$/i.test(name) ? "audio/mp4" : /\.webm$/i.test(name) ? "audio/webm" : /\.mp3$/i.test(name) ? "audio/mpeg" : "audio/ogg"; audio = { name, mimeType, bytes: new Uint8Array(await file.readFile()) }; } finally { await file.close(); }
          }
          const result = await this.transcribeAudio(audio.bytes, audio.mimeType, signal); signal?.throwIfAborted(); const generated = transcriptVtt(result.text, result.durationSec ?? mediaDuration); warnings.push(generated.estimated ? "字幕时长和时间按文本估算" : "字幕时间按文本比例估算"); files.push({ name: `${media.name.replace(/\.[^.]+$/, "")}.auto.vtt`, mimeType: "text/vtt", bytes: new TextEncoder().encode(generated.vtt) }); }
        catch (error) { if (signal?.aborted) throw error; warnings.push(`语音转写失败：${error instanceof Error ? error.message : String(error)}`); }
      }
      if (!files.some(file => file.mimeType === "text/vtt") && !warnings.includes("字幕提取失败")) warnings.push("未找到字幕");
      const subtitle = files.find(file => file.mimeType === "text/vtt"); let slices: MediaCorpusSlice[] = []; if (subtitle) { try { slices = buildMediaCorpusSlices(new TextDecoder("utf-8", { fatal: true }).decode(subtitle.bytes)); } catch { warnings.push("字幕编码无效"); } }
      return { title, sourceUrl: url.href, files, ...(slices.length ? { slices } : {}), ...(warnings.length ? { warnings } : {}) };
    } finally { await rm(directory, { recursive: true, force: true }); }
  }
}
