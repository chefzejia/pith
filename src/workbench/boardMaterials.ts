import { readMaterialReading, type MaterialReading } from "./readingState.ts";
import type { Material, WorkspaceStoragePort } from "../core/index.ts";
import { inspectMaterialCover } from "../plugins/stage-reader/epub.ts";

export interface BoardMaterial { id: string; title: string; fileName?: string; coverUrl?: string; coverCached?: boolean; reading?: MaterialReading }
export const coverCachePath = (id: string): string => `_cache/covers/${id}.json`;

/** Board reads only derived thumbnails. Missing covers are prepared separately. */
export async function boardMaterials(storage: WorkspaceStoragePort, materials: readonly Material[]): Promise<BoardMaterial[]> {
  return Promise.all(materials.map(async material => {
    let coverUrl: string | undefined, coverCached = false;
    try { const cached: unknown = JSON.parse(await storage.readText(coverCachePath(material.id))); if (cached && typeof cached === "object" && "url" in cached && cached.url === null) coverCached = true; if (cached && typeof cached === "object" && "url" in cached && typeof cached.url === "string" && /^data:image\/png;base64,/.test(cached.url)) { coverUrl = cached.url; coverCached = true; } } catch { /* Rebuildable cache may be absent. */ }
    return { reading: readMaterialReading(material), coverCached, id: material.id, title: material.title, ...(material.files[0] ? { fileName: material.files[0].name } : {}), ...(coverUrl ? { coverUrl } : {}) };
  }));
}
export async function materialCoverSource(storage: WorkspaceStoragePort, material: Material): Promise<string | undefined> {
  const file = material.files.find(item => /\.(?:epub|cbz|png|jpe?g|gif|webp|avif)$/i.test(item.name));
  if (!file || file.bytes > 64 * 1024 * 1024) return undefined;
  return inspectMaterialCover(file.name, await storage.readBinary(`materials/${material.id}/files/${file.name}`));
}
export async function createCoverThumbnail(doc: Document, source: string): Promise<string> {
  const image = doc.createElement("img"); image.src = source; await image.decode();
  const scale = Math.min(1, 160 / image.naturalWidth, 220 / image.naturalHeight), canvas = doc.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext("2d"); if (!context) throw new Error("封面缩略图不可用");
  context.drawImage(image, 0, 0, canvas.width, canvas.height); return canvas.toDataURL("image/png");
}
export async function cacheMaterialCover(storage: WorkspaceStoragePort, material: Material, doc: Document): Promise<void> {
  if ((await boardMaterials(storage, [material]))[0]!.coverCached) return;
  const source = await materialCoverSource(storage, material);
  const url = source ? await createCoverThumbnail(doc, source) : null;
  await storage.mkdir("_cache/covers"); await storage.writeText(coverCachePath(material.id), JSON.stringify({ url }));
}
