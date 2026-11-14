import type { Material, MaterialReading, WorkspaceStore } from "../core/index.ts";

export type { MaterialReading } from "../core/index.ts";

export function readMaterialReading(material: Material): MaterialReading | undefined { return material.reading; }
export function materialReadings(materials: readonly Material[]): Record<string, MaterialReading> {
  return Object.fromEntries(materials.flatMap(material => material.reading ? [[material.id, material.reading]] : []));
}
export function rememberMaterialReading(store: WorkspaceStore, id: string, file: string, locator?: string): Promise<void> {
  return store.recordReading(id, { file, ...(locator === undefined ? {} : { locator }) });
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
