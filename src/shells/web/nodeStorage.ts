import { lstat, mkdir, readFile, readdir, realpath, rename, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { isAbsolute, join, resolve, sep } from "node:path";
import type { StorageEntry, WorkspaceStoragePort } from "../../core/index.ts";

const identities = new Map<string, object>();

export class NodeWorkspaceStorage implements WorkspaceStoragePort {
  readonly mutationIdentity: object;
  private readonly root: string;
  constructor(root: string) {
    this.root = resolve(root);
    let identity = identities.get(this.root);
    if (!identity) { identity = {}; identities.set(this.root, identity); }
    this.mutationIdentity = identity;
  }
  private async path(path: string): Promise<string> {
    if (!path || isAbsolute(path) || path.includes("\\") || path.split("/").some(part => !part || part === "." || part === "..")) throw new Error("Invalid workspace path");
    const root = await realpath(this.root);
    const target = resolve(root, path);
    if (!target.startsWith(root + sep)) throw new Error("Path outside workspace");
    let current = root;
    for (const part of path.split("/")) {
      current = join(current, part);
      try {
        if ((await lstat(current)).isSymbolicLink()) throw new Error("Symbolic links are not allowed");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") break;
        throw error;
      }
    }
    return target;
  }
  async exists(path: string): Promise<boolean> {
    const target = await this.path(path);
    try { await lstat(target); return true; } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    }
  }
  async readText(path: string): Promise<string> { return readFile(await this.path(path), "utf8"); }
  async readBinary(path: string): Promise<Uint8Array> { return readFile(await this.path(path)); }
  async writeText(path: string, data: string): Promise<void> {
    const target = await this.path(path);
    const temporary = `${target}.${randomUUID()}.tmp`;
    await writeFile(temporary, data, { flag: "wx" });
    try { await rename(temporary, target); }
    catch (error) { await unlink(temporary); throw error; }
  }
  async createText(path: string, data: string): Promise<void> { await writeFile(await this.path(path), data, { flag: "wx" }); }
  async writeBinary(path: string, data: Uint8Array): Promise<void> { await writeFile(await this.path(path), data, { flag: "w" }); }
  async createBinary(path: string, data: Uint8Array): Promise<void> { await writeFile(await this.path(path), data, { flag: "wx" }); }
  async processText(path: string, update: (current: string) => string): Promise<string> {
    const result = update(await this.readText(path));
    await this.writeText(path, result);
    return result;
  }
  async mkdir(path: string): Promise<void> { await mkdir(await this.path(path), { recursive: true }); }
  async list(path: string): Promise<readonly StorageEntry[]> {
    return (await readdir(await this.path(path), { withFileTypes: true })).filter(entry => entry.isFile() || entry.isDirectory())
      .map(entry => ({ path: `${path}/${entry.name}`, type: entry.isDirectory() ? "folder" : "file" }));
  }
}
