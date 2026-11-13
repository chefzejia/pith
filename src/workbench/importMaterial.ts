import { cleanMaterialTitle, inspectEpubPackage } from "../plugins/stage-reader/epub.ts";
import { renderFile } from "../plugins/stage-reader/index.ts";
import { importedMaterialKind } from "./mediaAssets.ts";

export async function prepareMaterialImport(files: readonly File[]): Promise<{ title: string; kind: "media" | "book" | "article"; files: { name: string; mimeType: string; bytes: Uint8Array }[] }> {
  if (!files.length) throw new Error("没有选择材料文件");
  const entries = await Promise.all(files.map(async file => ({ name: file.name, mimeType: file.type || "application/octet-stream", bytes: new Uint8Array(await file.arrayBuffer()) })));
  const first = entries[0]!, metadata = /\.epub$/i.test(first.name) ? await inspectEpubPackage(first.bytes) : {};
  const kind = importedMaterialKind(entries), title = metadata.title || cleanMaterialTitle(first.name);
  return { title, kind, files: entries };
}

/** Group media and language sidecars; unrelated files become independent materials. */
export function groupMaterialFiles(files: readonly File[]): File[][] {
  const groups = new Map<string, File[]>();
  for (const file of files) {
    const key = file.name.replace(/\.[^.]+$/, "").replace(/[._-](?:[a-z]{2,3}(?:[-_](?:[a-z]{2}|hans|hant))?|hans|hant)$/i, "").normalize("NFC").toLowerCase();
    const group = groups.get(key) ?? []; group.push(file); groups.set(key, group);
  }
  return [...groups.values()];
}

export async function sampleMaterialText(files: readonly { name: string; bytes: Uint8Array }[]): Promise<string> {
  const document = files.find(file => /\.(?:epub|pdf)$/i.test(file.name));
  if (document) {
    const rendered = await renderFile({ name: document.name, mimeType: /\.pdf$/i.test(document.name) ? "application/pdf" : "application/epub+zip", bytes: document.bytes.length, sha256: "" }, document.bytes);
    return (rendered.blocks ?? []).filter(block => block.isProse).map(block => block.text).join(" ").slice(0, 16384);
  }
  return files.filter(file => /\.(?:md|markdown|txt|srt|vtt|ts|js|py)$/i.test(file.name)).map(file => new TextDecoder().decode(file.bytes.subarray(0, 16384))).join("\n").slice(0, 16384);
}
