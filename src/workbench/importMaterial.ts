import { cleanMaterialTitle, inspectEpubPackage, sampleEpubLanguage } from "../plugins/stage-reader/epub.ts";
import { importedMaterialKind } from "./mediaAssets.ts";

export async function prepareMaterialImport(files: readonly File[]): Promise<{ title: string; kind: "media" | "book" | "article"; files: { name: string; mimeType: string; bytes: Uint8Array }[]; sampleText: string }> {
  if (!files.length) throw new Error("没有选择材料文件");
  const entries = await Promise.all(files.map(async file => ({ name: file.name, mimeType: file.type || "application/octet-stream", bytes: new Uint8Array(await file.arrayBuffer()) })));
  const first = entries[0]!, metadata = /\.epub$/i.test(first.name) ? await inspectEpubPackage(first.bytes) : {};
  const kind = importedMaterialKind(entries), title = metadata.title || cleanMaterialTitle(first.name);
  let sampleText = title;
  if (/\.epub$/i.test(first.name)) sampleText = await sampleEpubLanguage(first.bytes) || title;
  if (kind === "article") try { const text = new TextDecoder("utf-8", { fatal: true }).decode(first.bytes.subarray(0, 16384)); if (!/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text)) sampleText = text; } catch { /* Binary material has no text sample. */ }
  return { title, kind, files: entries, sampleText };
}
