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

export interface HostPort {
  readonly id: "obsidian" | "dsh" | "web" | "desktop" | "mobile" | "memory";
  readonly storage: WorkspaceStoragePort;
  readonly http?: HttpPort;
  readonly secrets?: SecretPort;
  readonly sanitizer?: DomSanitizerPort;
  readonly process?: AgentProcessPort;
  notify?(message: string, timeoutMs?: number): void;
}
