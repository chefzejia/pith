import { spawn, type ChildProcess } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { access, lstat, mkdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import type { ManagedSpeechRuntimePort, ManagedSpeechState } from "../core/index.ts";
import { SPEECH_GATEWAY } from "./speechGateway.ts";

const assets = [
  { name: "tts.tar.bz2", url: "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/vits-piper-en_US-lessac-medium.tar.bz2", sha256: "9e3febfacf0abf4270172d2958bcec246032b7e88efc2720840cc80c93de334e" },
  { name: "asr.tar.bz2", url: "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-whisper-tiny.en.tar.bz2", sha256: "2bd6cf965c8bb3e068ef9fa2191387ee63a9dfa2a4e37582a8109641c20005dd" },
] as const;
const marker = "pith-sherpa-1.12.40-v1";
const owner = "pith-managed-speech-v1";

function isWithin(path: string, parent: string): boolean { return path === parent || path.startsWith(parent + sep); }
async function resolvedExisting(path: string): Promise<string> {
  try { return await realpath(path); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; const parent = dirname(path); if (parent === path) throw error; return join(await resolvedExisting(parent), path.slice(parent.length + 1)); }
}
function run(command: string, args: readonly string[], cwd: string, signal?: AbortSignal): Promise<void> {
  return new Promise((resolveRun, reject) => {
    const proxy = Object.fromEntries(["HTTPS_PROXY", "HTTP_PROXY", "NO_PROXY", "https_proxy", "http_proxy", "no_proxy"].filter(key => process.env[key] !== undefined).map(key => [key, process.env[key]]));
    const child = spawn(command, [...args], { cwd, env: { ...proxy, PATH: "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin", HOME: cwd, PIP_CONFIG_FILE: "/dev/null", PIP_CACHE_DIR: join(cwd, "pip-cache"), PYTHONNOUSERSITE: "1" }, stdio: "ignore", signal });
    child.once("error", reject); child.once("exit", (code, sig) => code === 0 ? resolveRun() : reject(new Error(`安装进程失败 (${sig ?? code})`)));
  });
}

export class NodeManagedSpeechRuntime implements ManagedSpeechRuntimePort {
  private readonly home: string;
  private readonly protectedRoot: string | undefined;
  private child: ChildProcess | null = null;
  private endpoint: string | undefined;
  private operation: Promise<ManagedSpeechState> | null = null;
  private operationAbort: AbortController | null = null;
  constructor(options: { home?: string; protectedRoot?: string; idleTimeoutSec?: number } = {}) {
    const base = options.home ?? process.env.PITH_SPEECH_HOME ?? join(homedir(), "Library", "Application Support", "pith", "speech");
    if (!isAbsolute(base)) throw new Error("PITH_SPEECH_HOME 必须是绝对路径");
    this.home = join(resolve(base), "managed-v1"); this.protectedRoot = options.protectedRoot;
    this.idleTimeoutSec = options.idleTimeoutSec ?? 180;
    if (!Number.isInteger(this.idleTimeoutSec) || this.idleTimeoutSec < 1) throw new Error("Invalid idle timeout");
  }
  private readonly idleTimeoutSec: number;
  private async checkPath(): Promise<void> {
    const path = await resolvedExisting(this.home);
    if (this.protectedRoot) { const protectedRoot = await resolvedExisting(resolve(this.protectedRoot)); if (isWithin(path, protectedRoot) || isWithin(protectedRoot, path)) throw new Error("语音运行时不能放在 Vault 或工作区中"); }
    try { if ((await lstat(this.home)).isSymbolicLink()) throw new Error("语音运行时目录不能是符号链接"); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  private state(status: ManagedSpeechState["status"], note: string): ManagedSpeechState { return { supported: true, status, installDir: this.home, idleTimeoutSec: this.idleTimeoutSec, modelName: "Piper lessac / Whisper tiny.en", ...(this.endpoint ? { endpoint: `${this.endpoint}/v1/audio/speech`, asrEndpoint: `${this.endpoint}/v1/audio/transcriptions` } : {}), note }; }
  async getState(): Promise<ManagedSpeechState> {
    await this.checkPath();
    if (process.platform === "win32") return { supported: false, status: "not-installed", note: "当前平台暂不支持托管本机语音" };
    if (this.child && this.endpoint) return this.state("running", "本机语音运行中");
    try {
      if ((await readFile(join(this.home, ".owner"), "utf8")).trim() === owner && (await readFile(join(this.home, "installed"), "utf8")) === marker) {
        try { for (const path of ["venv/bin/python", "vits-piper-en_US-lessac-medium/en_US-lessac-medium.onnx", "vits-piper-en_US-lessac-medium/tokens.txt", "vits-piper-en_US-lessac-medium/espeak-ng-data", "sherpa-onnx-whisper-tiny.en/tiny.en-encoder.int8.onnx", "sherpa-onnx-whisper-tiny.en/tiny.en-decoder.int8.onnx", "sherpa-onnx-whisper-tiny.en/tiny.en-tokens.txt"]) await access(join(this.home, path)); }
        catch { return this.state("failed", "本机语音安装不完整，请卸载后重新安装"); }
        return this.state("stopped", "已安装，按需启动");
      }
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    return this.state("not-installed", "未安装本机语音引擎");
  }
  async install(signal?: AbortSignal): Promise<ManagedSpeechState> {
    if (this.operation) return this.operation;
    const controller = new AbortController(); this.operationAbort = controller;
    const task = this.installNow(signal ? AbortSignal.any([signal, controller.signal]) : controller.signal); this.operation = task;
    try { return await task; } finally { if (this.operation === task) { this.operation = null; this.operationAbort = null; } }
  }
  private async installNow(signal?: AbortSignal): Promise<ManagedSpeechState> {
    await this.checkPath();
    if (process.platform === "win32") throw new Error("当前平台暂不支持托管本机语音");
    if ((await this.getState()).status !== "not-installed") return this.getState();
    await mkdir(dirname(this.home), { recursive: true }); await this.checkPath();
    try { await mkdir(this.home); await writeFile(join(this.home, ".owner"), owner, { flag: "wx" }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; if ((await readFile(join(this.home, ".owner"), "utf8")).trim() !== owner) throw new Error("语音目录不属于 Pith，拒绝覆盖"); }
    await this.checkPath();
    await run("python3", ["-m", "venv", "venv"], this.home, signal);
    const python = join(this.home, "venv", "bin", "python");
    await run(python, ["-m", "pip", "install", "--disable-pip-version-check", "--index-url", "https://pypi.org/simple", "sherpa-onnx==1.12.40", "numpy==2.3.4"], this.home, signal);
    for (const asset of assets) {
      const archive = join(this.home, asset.name);
      await run("curl", ["--disable", "--fail", "--silent", "--show-error", "--location", "--max-time", "600", "--max-filesize", "600000000", "--output", archive, asset.url], this.home, signal);
      const bytes = await readFile(archive); if (bytes.length > 600_000_000 || createHash("sha256").update(bytes).digest("hex") !== asset.sha256) throw new Error("模型校验失败");
      await run(python, ["-c", "import sys,tarfile; t=tarfile.open(sys.argv[1]); t.extractall(path='.', filter='data'); t.close()", archive], this.home, signal);
      await rm(archive);
    }
    await writeFile(join(this.home, "gateway.py"), SPEECH_GATEWAY);
    await writeFile(join(this.home, "installed"), marker);
    return this.getState();
  }
  async ensureRunning(signal?: AbortSignal): Promise<ManagedSpeechState> {
    if (this.operation) { await this.operation; return this.ensureRunning(signal); }
    const controller = new AbortController(); this.operationAbort = controller;
    const task = (async () => { const current = await this.getState(); if (current.status === "running") return current; if (current.status !== "stopped") throw new Error("本机语音引擎尚未安装"); return this.startNow(signal ? AbortSignal.any([signal, controller.signal]) : controller.signal); })(); this.operation = task;
    try { return await task; } finally { if (this.operation === task) { this.operation = null; this.operationAbort = null; } }
  }
  private async startNow(signal?: AbortSignal): Promise<ManagedSpeechState> {
    signal?.throwIfAborted();
    const staged = join(this.home, `gateway-${randomUUID()}.tmp`);
    try { await writeFile(staged, SPEECH_GATEWAY, { flag: "wx" }); await rename(staged, join(this.home, "gateway.py")); } finally { await rm(staged, { force: true }); }
    const child = spawn(join(this.home, "venv", "bin", "python"), [join(this.home, "gateway.py")], { cwd: this.home, env: { PATH: "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin", HOME: this.home, PYTHONNOUSERSITE: "1", PITH_SPEECH_IDLE_SECONDS: String(this.idleTimeoutSec) }, stdio: ["ignore", "pipe", "ignore"] });
    this.child = child;
    const port = await new Promise<number>((resolvePort, reject) => {
      let output = ""; const finish = (error?: Error, port?: number) => { clearTimeout(timer); if (signal) signal.removeEventListener("abort", abort); if (error) reject(error); else resolvePort(port!); };
      const abort = () => { child.kill(); finish(new Error("启动已取消")); };
      const timer = setTimeout(() => { child.kill(); finish(new Error("语音进程启动超时")); }, 30000);
      if (signal) { signal.addEventListener("abort", abort, { once: true }); if (signal.aborted) { abort(); return; } }
      child.stdout!.on("data", data => { output += String(data); const match = /^(\d+)\r?\n/.exec(output); if (match) { const value = Number(match[1]); if (value < 1 || value > 65535) { child.kill(); finish(new Error("无效的网关端口")); } else finish(undefined, value); } });
      child.once("error", error => finish(error)); child.once("exit", code => finish(new Error(`语音进程退出 (${code})`)));
    }).catch(error => { if (this.child === child) this.child = null; throw error; });
    if (this.child !== child || child.exitCode !== null) throw new Error("语音进程未启动");
    this.endpoint = `http://127.0.0.1:${port}`;
    child.once("exit", () => { if (this.child === child) { this.child = null; this.endpoint = undefined; } });
    return this.state("running", "本机语音运行中");
  }
  async stop(): Promise<ManagedSpeechState> {
    if (this.operation) { const operation = this.operation, controller = this.operationAbort; if (controller) controller.abort(); try { await operation; } catch (error) { if (!controller || !controller.signal.aborted) throw error; } }
    const child = this.child;
    if (child) { child.kill("SIGTERM"); await new Promise<void>(resolveExit => { if (child.exitCode !== null || child.signalCode !== null) resolveExit(); else child.once("exit", () => resolveExit()); }); }
    return this.getState();
  }
  async remove(): Promise<ManagedSpeechState> {
    await this.stop(); await this.checkPath();
    try { if ((await readFile(join(this.home, ".owner"), "utf8")).trim() !== owner) throw new Error("语音目录不属于 Pith，拒绝删除"); await rm(this.home, { recursive: true }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    return this.getState();
  }
}
