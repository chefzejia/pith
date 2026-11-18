import type { FixedPageEntry, MaterialFileEntry, RenderedDocumentView } from "../../core/index.ts";
import { epubFixedPageCount, readZipEntries } from "./epub.ts";
import { pdfPageCount } from "./pdf.ts";
export { renderPdf } from "./pdf.ts";

const imageTypes: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif", svg: "image/svg+xml" };
function imageMime(name: string): string | undefined {
  const extension = /\.([^.\/]+)$/.exec(name);
  return extension ? imageTypes[extension[1]!.toLowerCase()] : undefined;
}
function naturalCompare(left: string, right: string): number {
  const a = left.match(/\d+|\D+/g) ?? [], b = right.match(/\d+|\D+/g) ?? [];
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const x = a[i]!, y = b[i]!;
    if (/^\d+$/.test(x) && /^\d+$/.test(y)) {
      const nx = x.replace(/^0+/, "") || "0", ny = y.replace(/^0+/, "") || "0";
      if (nx.length !== ny.length) return nx.length - ny.length;
      if (nx !== ny) return nx < ny ? -1 : 1;
    } else {
      const difference = x.toLowerCase().localeCompare(y.toLowerCase());
      if (difference) return difference;
    }
  }
  return a.length - b.length || left.localeCompare(right);
}
export function dataUrl(bytes: Uint8Array, mimeType: string): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${mimeType};base64,${btoa(binary)}`;
}
function fixedView(file: MaterialFileEntry, format: "cbz" | "image", pages: FixedPageEntry[]): RenderedDocumentView {
  const sections = pages.map(page => ({ title: page.label, level: 1, line: page.page - 1, locator: `page:${page.page}` }));
  const html = pages.map(page => `<figure class="pith-fixed-page" data-locator="page:${page.page}" data-prose="false"><img alt="${page.label}" data-page="${page.page}" src="${dataUrl(page.bytes!, page.mimeType)}"></figure>`).join("");
  return { format, layout: "fixed-page", title: file.name, html, sections, pages, blocks: [], totalUnits: pages.length };
}
export async function renderCbz(file: MaterialFileEntry, bytes: Uint8Array): Promise<RenderedDocumentView> {
  const entries = await readZipEntries(bytes, cbzImageEntry);
  const names = [...entries.keys()].sort(naturalCompare);
  if (!names.length) throw new Error("CBZ 中没有图片页");
  return fixedView(file, "cbz", names.map((name, index) => ({ page: index + 1, label: `第 ${index + 1} 页`, mimeType: imageMime(name)!, bytes: entries.get(name)! })));
}
const cbzImageEntry = (name: string): boolean => !name.endsWith("/") && imageMime(name) !== undefined;
export function fixedPageFormat(file: { name: string; mimeType?: string }): "pdf" | "cbz" | "epub" | undefined {
  if (/\.epub$/i.test(file.name) || file.mimeType === "application/epub+zip") return "epub";
  if (/\.pdf$/i.test(file.name) || file.mimeType === "application/pdf") return "pdf";
  if (/\.cbz$/i.test(file.name) || file.mimeType === "application/vnd.comicbook+zip" || file.mimeType === "application/x-cbz") return "cbz";
  return undefined;
}
export async function fixedPageCount(format: NonNullable<ReturnType<typeof fixedPageFormat>>, bytes: Uint8Array): Promise<number | undefined> {
  if (format === "pdf") return pdfPageCount(bytes);
  if (format === "epub") return epubFixedPageCount(bytes);
  return (await readZipEntries(bytes, cbzImageEntry)).size;
}
export function renderImage(file: MaterialFileEntry, bytes: Uint8Array): RenderedDocumentView {
  const mimeType = imageMime(file.name) ?? (Object.values(imageTypes).includes(file.mimeType) ? file.mimeType : undefined);
  if (!mimeType || mimeType === "image/svg+xml") throw new Error(`Unsupported image format: ${file.name}`);
  return fixedView(file, "image", [{ page: 1, label: "第 1 页", mimeType, bytes }]);
}
