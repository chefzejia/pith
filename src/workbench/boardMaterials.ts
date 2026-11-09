import type { Material, WorkspaceStoragePort } from "../core/index.ts";
import { inspectMaterialCover } from "../plugins/stage-reader/epub.ts";

export interface BoardMaterial { id: string; title: string; fileName?: string; coverUrl?: string }

export async function boardMaterials(storage: WorkspaceStoragePort, materials: readonly Material[]): Promise<BoardMaterial[]> {
  return Promise.all(materials.map(async material => {
    const file = material.files.find(item => /\.(?:epub|cbz|png|jpe?g|gif|webp|avif)$/i.test(item.name));
    let cover: string | undefined;
    if (file && file.bytes <= 64 * 1024 * 1024) {
      try { cover = await inspectMaterialCover(file.name, await storage.readBinary(`materials/${material.id}/files/${file.name}`)); }
      catch { cover = undefined; }
    }
    return { id: material.id, title: material.title, ...(material.files[0] ? { fileName: material.files[0].name } : {}), ...(cover ? { coverUrl: cover } : {}) };
  }));
}
