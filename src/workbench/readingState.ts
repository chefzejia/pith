import { MutationQueue, type WorkspaceStoragePort, type Material } from "../core/index.ts";

export interface MaterialReading { file: string; locator?: string; openedAt: string }
const path = (id: string) => `_cache/reading/${encodeURIComponent(id)}.json`;

/** UI resume state also covers external repository files, which never enter Material.files. */
export async function readMaterialReading(storage: WorkspaceStoragePort, id: string): Promise<MaterialReading | undefined> {
  try {
    const value = JSON.parse(await storage.readText(path(id)));
    if (value && typeof value.file === "string" && value.file && typeof value.openedAt === "string" && Number.isFinite(Date.parse(value.openedAt)) && (value.locator === undefined || typeof value.locator === "string")) return value;
  } catch { /* Missing or corrupt UI caches can be rebuilt by reading. */ }
  return undefined;
}
export async function materialReadings(storage: WorkspaceStoragePort, materials: readonly Material[]): Promise<Record<string, MaterialReading>> {
  const entries = await Promise.all(materials.map(async material => [material.id, await readMaterialReading(storage, material.id)] as const));
  return Object.fromEntries(entries.filter((entry): entry is readonly [string, MaterialReading] => entry[1] !== undefined));
}
export async function rememberMaterialReading(storage: WorkspaceStoragePort, id: string, file: string, locator?: string): Promise<void> {
  if (!file) return;
  await MutationQueue.forStorage(storage).run(async () => {
    const previous = await readMaterialReading(storage, id);
    const position = locator ?? (previous?.file === file ? previous.locator : undefined);
    await storage.mkdir("_cache/reading");
    await storage.writeText(path(id), JSON.stringify({ file, ...(position === undefined ? {} : { locator: position }), openedAt: new Date().toISOString() }));
  });
}
export function readingPositionLabel(locator: string | undefined): string {
  if (!locator) return "";
  const page = /^page:(\d+)/.exec(locator), line = /^text:line:(\d+)/.exec(locator), repo = /#L(\d+)/.exec(locator), time = /^time:([\d.]+)/.exec(locator);
  if (page) return `第 ${page[1]} 页`;
  if (line) return `第 ${Number(line[1]) + 1} 行`;
  if (repo) return `第 ${repo[1]} 行`;
  if (time) { const seconds = Math.floor(Number(time[1])); return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`; }
  return "已保存阅读位置";
}
