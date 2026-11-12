/**
 * HostPort: the narrow boundary between Pith Core/Plugins and any native shell
 * (Obsidian, DeepSeek Harness, standalone Web/Tauri desktop, or iOS SwiftUI).
 *
 * Neither `src/core/` nor `src/plugins/` may import host packages directly;
 * every host capability is injected through these interfaces.
 */

export interface StorageEntry {
  readonly path: string;
  readonly type: "file" | "folder";
}

export interface WorkspaceStoragePort {
  readonly mutationIdentity?: object;
  exists(path: string): Promise<boolean>;
  readText(path: string): Promise<string>;
  readBinary(path: string): Promise<Uint8Array>;
  writeText(path: string, data: string): Promise<void>;
  createText(path: string, data: string): Promise<void>;
  writeBinary(path: string, data: Uint8Array): Promise<void>;
  createBinary(path: string, data: Uint8Array): Promise<void>;
  copy(from: string, to: string): Promise<void>;
  processText(path: string, update: (current: string) => string): Promise<string>;
  mkdir(path: string): Promise<void>;
  list(path: string): Promise<readonly StorageEntry[]>;
}

export interface HttpRequestSpec {
  readonly url: string;
  readonly method?: "GET" | "POST" | "PUT" | "DELETE";
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string | Uint8Array;
  readonly signal?: AbortSignal;
  /** Total request deadline in milliseconds, from 1 to 600000. Without it, host idle timeouts apply. */
  readonly timeoutMs?: number;
}

export async function withHttpDeadline<T>(spec: HttpRequestSpec, execute: (signal: AbortSignal | undefined) => Promise<T>): Promise<T> {
  const timeoutMs = spec.timeoutMs;
  if (timeoutMs !== undefined && (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 600_000)) throw new Error("Invalid HTTP timeout");
  const source = spec.signal;
  if (source) source.throwIfAborted();
  if (timeoutMs === undefined && !source) return execute(undefined);

  const controller = new AbortController();
  let deadline: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  const interrupted = new Promise<never>((_resolve, reject) => {
    if (source) {
      onAbort = () => { controller.abort(source.reason); reject(source.reason); };
      source.addEventListener("abort", onAbort, { once: true });
    }
    if (timeoutMs !== undefined) deadline = setTimeout(() => {
      const error = new Error("HTTP request timed out");
      controller.abort(error);
      reject(error);
    }, timeoutMs);
  });
  try { return await Promise.race([execute(controller.signal), interrupted]); }
  finally {
    if (deadline !== undefined) clearTimeout(deadline);
    if (source && onAbort) source.removeEventListener("abort", onAbort);
  }
}

export interface HttpResponseData {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly bytes: Uint8Array;
  text(): string;
}

export interface HttpPort {
  request(spec: HttpRequestSpec): Promise<HttpResponseData>;
}

export interface SecretPort {
  getSecret(key: string): Promise<string | null> | string | null;
}

export interface DomSanitizerPort {
  sanitizeToFragment(html: string, ownerDocument: Document): DocumentFragment;
}

export interface AgentProcessSpawnSpec {
  readonly command: string;
  readonly args?: readonly string[];
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly readOnlyPaths?: readonly string[];
}

export interface AgentStdioHandle {
  readonly pid?: number;
  writeLine(line: string): Promise<void> | void;
  onLine(listener: (line: string) => void): () => void;
  onError?(listener: (error: Error) => void): () => void;
  onExit?(listener: (code: number | null, signal: string | null) => void): () => void;
  close(timeoutMs?: number): Promise<void>;
}

export interface AgentProcessPort {
  searchPaths?(): readonly string[];
  findExecutable(command: string, searchPaths?: readonly string[]): Promise<string | null>;
  probeExecutable(executablePath: string, args: readonly string[], timeoutMs?: number): Promise<string | null>;
  spawnStdio(spec: AgentProcessSpawnSpec): Promise<AgentStdioHandle>;
}

export interface RepositoryFileExcerpt {
  readonly externalPath: string;
  readonly commitSha: string;
  readonly path: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly text: string;
  readonly truncated: boolean;
}

export interface RepositoryPort {
  inspectRepository(repoPath: string): Promise<{ readonly externalPath: string; readonly commitSha: string; readonly title: string }>;
  listFiles(externalPath: string, commitSha: string, offset?: number, limit?: number): Promise<{ readonly files: readonly string[]; readonly total: number; readonly nextOffset: number | null }>;
  readFile(externalPath: string, commitSha: string, filePath: string, startLine?: number, maxLines?: number): Promise<RepositoryFileExcerpt>;
}

export interface MediaSearchCandidate {
  readonly id: string;
  readonly title: string;
  readonly url: string;
  readonly durationSec?: number;
  readonly uploader?: string;
}

export interface MediaCorpusSlice {
  readonly id: string;
  readonly title: string;
  readonly startSec: number;
  readonly endSec: number;
  readonly cueCount: number;
  readonly text: string;
}

export interface MediaCorpusBundle {
  readonly title: string;
  readonly sourceUrl: string;
  readonly files: readonly { readonly name: string; readonly mimeType: string; readonly bytes: Uint8Array }[];
  readonly slices?: readonly MediaCorpusSlice[];
  readonly warnings?: readonly string[];
}

export interface MediaCorpusPort {
  searchMedia(query: string, limit?: number, signal?: AbortSignal): Promise<readonly MediaSearchCandidate[]>;
  fetchMediaCorpus(url: string, options?: { readonly maxDurationSec?: number; readonly lang?: string }, signal?: AbortSignal): Promise<MediaCorpusBundle>;
}

import type { ManagedSpeechRuntimePort } from "./seams.ts";

export interface ToolServerPort {
  open(handle: (requestBody: string) => Promise<string>): Promise<{
    readonly url: string;
    readonly headers: readonly { readonly name: string; readonly value: string }[];
    close(): Promise<void>;
  }>;
}

export interface HostPort {
  readonly id: "obsidian" | "dsh" | "web" | "desktop" | "mobile" | "memory";
  readonly storage: WorkspaceStoragePort;
  readonly http?: HttpPort;
  readonly secrets?: SecretPort;
  readonly sanitizer?: DomSanitizerPort;
  readonly process?: AgentProcessPort;
  readonly toolServer?: ToolServerPort;
  readonly speechRuntime?: ManagedSpeechRuntimePort;
  readonly repository?: RepositoryPort;
  readonly mediaCorpus?: MediaCorpusPort;
  notify?(message: string, timeoutMs?: number): void;
}
