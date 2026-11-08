import { spawn, type ChildProcess } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { access, lstat, mkdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import type { ManagedSpeechRuntimePort, ManagedSpeechState } from "../../core/index.ts";
import { SPEECH_GATEWAY } from "./speechGateway.ts";

const assets = [
  { name: "tts.tar.bz2", url: "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/kokoro-int8-multi-lang-v1_1.tar.bz2", sha256: "259c9c8bc906d6078e4e0570421885dabb68b539c2f970fcbb890a58eeaf3e9c" },
  { name: "asr.tar.bz2", url: "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17.tar.bz2", sha256: "f6b2a72ebcb1ac7a764d4cfccd886e6bcb2a95c4657c2199d0ba95ed4b9ea71a" },
] as const;
const marker = "pith-sherpa-1.12.23-kokoro-sensevoice-v2";
const owner = "pith-managed-speech-v2";
const nodePackages: Record<string, string> = {
  "darwin-arm64": "zbjNUUH/IXhjRyRJ9mpcWVOGIVr31a/qXBPsfOYc7U8cgwcq33Vmj2OzoLYWQF6T+puqCAE4nMxFAxJvdZekhg==",
  "darwin-x64": "hgPhBG85bgULJo5xS5xvh1A9+D6GBPwhZ8QCvWvh7YP1kF9UZTF1r5hWBOzZiR2Ax0gQMbxVvw1t/NpR2N7HWA==",
  "linux-x64": "pUZIdDvPtyRXQDGo9R9MIBf2AFUzfgcGmutoulsEdH3hpK6JteR7Z/5pfrZIIqe/O99djAjEHK4AlwLHC2jiZw==",
};
const nodeRuntimeHashes: Record<string, string> = {
  "darwin-arm64": "c59006db713c770d6ec63ae16cb3edc11f49ee093b5c415d667bb4f436c6526d",
  "darwin-x64": "3cfed4795cd97277559763c5f56e711852d2cc2420bda1cea30c8aa9ac77ce0c",
  "linux-x64": "d36e56998220085782c0ca965f9d51b7726335aed2f5fc7321c6c0ad233aa96d",
};

function isWithin(path: string, parent: string): boolean { return path === parent || path.startsWith(parent + sep); }
async function resolvedExisting(path: string): Promise<string> {
  try { return await realpath(path); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; const parent = dirname(path); if (parent === path) throw error; return join(await resolvedExisting(parent), path.slice(parent.length + 1)); }
}
function run(command: string, args: readonly string[], cwd: string, signal?: AbortSignal): Promise<void> {
  return new Promise((resolveRun, reject) => {
    const proxy = Object.fromEntries(["HTTPS_PROXY", "HTTP_PROXY", "NO_PROXY", "https_proxy", "http_proxy", "no_proxy"].filter(key => process.env[key] !== undefined).map(key => [key, process.env[key]]));
    const child = spawn(command, [...args], { cwd, env: { ...proxy, PATH: "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin", HOME: cwd }, stdio: "ignore", signal });
    child.once("error", reject); child.once("exit", (code, sig) => code === 0 ? resolveRun() : reject(new Error(`安装进程失败 (${sig ?? code})`)));
  });
}
async function digest(path: string, algorithm: "sha256" | "sha512", encoding: "hex" | "base64"): Promise<string> {
  const hash = createHash(algorithm); for await (const chunk of createReadStream(path)) hash.update(chunk); return hash.digest(encoding);
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
    this.home = join(resolve(base), "managed-v2"); this.protectedRoot = options.protectedRoot;
    this.idleTimeoutSec = options.idleTimeoutSec ?? 180;
    if (!Number.isInteger(this.idleTimeoutSec) || this.idleTimeoutSec < 1) throw new Error("Invalid idle timeout");
  }
  private readonly idleTimeoutSec: number;
  private async checkPath(): Promise<void> {
    const path = await resolvedExisting(this.home);
    if (this.protectedRoot) { const protectedRoot = await resolvedExisting(resolve(this.protectedRoot)); if (isWithin(path, protectedRoot) || isWithin(protectedRoot, path)) throw new Error("语音运行时不能放在 Vault 或工作区中"); }
    try { if ((await lstat(this.home)).isSymbolicLink()) throw new Error("语音运行时目录不能是符号链接"); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  private state(status: ManagedSpeechState["status"], note: string): ManagedSpeechState { const modelName = "Kokoro-82M v1.1 (中英) + SenseVoice (多语种)"; return { supported: true, status, installDir: this.home, idleTimeoutSec: this.idleTimeoutSec, modelName, ...(this.endpoint ? { endpoint: `${this.endpoint}/v1/audio/speech`, asrEndpoint: `${this.endpoint}/v1/audio/transcriptions` } : {}), note: `${note} · ${modelName}` }; }
  async getState(): Promise<ManagedSpeechState> {
    await this.checkPath();
    if (!nodePackages[`${process.platform}-${process.arch}`]) return { supported: false, status: "not-installed", note: "当前平台暂不支持托管本机语音" };
    if (this.child && this.endpoint) return this.state("running", "本机语音运行中");
    try {
      if ((await readFile(join(this.home, ".owner"), "utf8")).trim() === owner && (await readFile(join(this.home, "installed"), "utf8")) === marker) {
        try { for (const path of ["bin/node", "node_modules/sherpa-onnx-node/sherpa-onnx.js", `node_modules/sherpa-onnx-${process.platform}-${process.arch}/sherpa-onnx.node`, "kokoro-int8-multi-lang-v1_1/model.int8.onnx", "kokoro-int8-multi-lang-v1_1/voices.bin", "kokoro-int8-multi-lang-v1_1/tokens.txt", "kokoro-int8-multi-lang-v1_1/espeak-ng-data", "kokoro-int8-multi-lang-v1_1/dict", "kokoro-int8-multi-lang-v1_1/lexicon-us-en.txt", "kokoro-int8-multi-lang-v1_1/lexicon-zh.txt", "kokoro-int8-multi-lang-v1_1/date-zh.fst", "kokoro-int8-multi-lang-v1_1/number-zh.fst", "kokoro-int8-multi-lang-v1_1/phone-zh.fst", "sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17/model.int8.onnx", "sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17/tokens.txt"]) await access(join(this.home, path)); }
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
    const nativeHash = nodePackages[`${process.platform}-${process.arch}`];
    if (!nativeHash) throw new Error("当前平台暂不支持托管本机语音");
    const current = await this.getState();
    if (current.status === "failed") {
      if ((await readFile(join(this.home, ".owner"), "utf8")).trim() !== owner) throw new Error("语音目录不属于 Pith，拒绝覆盖");
      await this.checkPath(); await rm(this.home, { recursive: true });
    } else if (current.status !== "not-installed") return current;
    await mkdir(dirname(this.home), { recursive: true }); await this.checkPath();
    try { await mkdir(this.home); await writeFile(join(this.home, ".owner"), owner, { flag: "wx" }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; if ((await readFile(join(this.home, ".owner"), "utf8")).trim() !== owner) throw new Error("语音目录不属于 Pith，拒绝覆盖"); }
    await this.checkPath();
    const nodeName = `node-v22.19.0-${process.platform}-${process.arch}`, nodeArchive = join(this.home, "node.tar.gz");
    await run("curl", ["--disable", "--fail", "--silent", "--show-error", "--location", "--max-time", "600", "--max-filesize", "100000000", "--output", nodeArchive, `https://nodejs.org/dist/v22.19.0/${nodeName}.tar.gz`], this.home, signal);
    if (await digest(nodeArchive, "sha256", "hex") !== nodeRuntimeHashes[`${process.platform}-${process.arch}`]) throw new Error("Node 运行时校验失败");
    await run("tar", ["-xzf", nodeArchive, "-C", this.home, "--strip-components=1", `${nodeName}/bin/node`], this.home, signal); await rm(nodeArchive);
    for (const [name, hash] of [["sherpa-onnx-node", "09SRixVSjsajxeCV8Hy9R5J4IHPtw7vNgaIcEokdh/LpU7sY+e12z9uHHIMMMgNiInyGEH74wIwjLXms+W7qRA=="], [`sherpa-onnx-${process.platform}-${process.arch}`, nativeHash]] as const) {
      const archive = join(this.home, `${name}.tgz`), target = join(this.home, "node_modules", name);
      await run("curl", ["--disable", "--fail", "--silent", "--show-error", "--location", "--max-time", "600", "--max-filesize", "300000000", "--output", archive, `https://registry.npmjs.org/${name}/-/${name}-1.12.23.tgz`], this.home, signal);
      if (await digest(archive, "sha512", "base64") !== hash) throw new Error("语音运行时校验失败");
      await mkdir(target, { recursive: true }); await run("tar", ["-xzf", archive, "-C", target, "--strip-components=1"], this.home, signal); await rm(archive);
    }
    for (const asset of assets) {
      const archive = join(this.home, asset.name);
      await run("curl", ["--disable", "--fail", "--silent", "--show-error", "--location", "--max-time", "1200", "--max-filesize", "1200000000", "--output", archive, asset.url], this.home, signal);
      if (await digest(archive, "sha256", "hex") !== asset.sha256) throw new Error("模型校验失败");
      await run("tar", ["-xjf", archive, "--exclude", "*/model.onnx", "--exclude", "*.py", "-C", this.home], this.home, signal);
      await rm(archive);
    }
    await writeFile(join(this.home, "gateway.cjs"), SPEECH_GATEWAY);
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
    try { await writeFile(staged, SPEECH_GATEWAY, { flag: "wx" }); await rename(staged, join(this.home, "gateway.cjs")); } finally { await rm(staged, { force: true }); }
    const libraryPath = join(this.home, "node_modules", `sherpa-onnx-${process.platform}-${process.arch}`);
    const child = spawn(join(this.home, "bin", "node"), [join(this.home, "gateway.cjs")], { cwd: this.home, env: { PATH: "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin", HOME: this.home, DYLD_LIBRARY_PATH: libraryPath, LD_LIBRARY_PATH: libraryPath, PITH_SPEECH_IDLE_SECONDS: String(this.idleTimeoutSec) }, stdio: ["ignore", "pipe", "ignore"] });
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
