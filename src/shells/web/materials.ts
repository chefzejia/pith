import type { Material } from "../../core/index.ts";
import type { SessionDocument } from "../../workbench/materialSession.ts";
import { renderFile } from "../../plugins/stage-reader/index.ts";
import { renderRepositoryText } from "../../workbench/repositoryIntake.ts";
import type { ObsidianViewActions } from "../../workbench/view.ts";

type Request = <T>(path: string, data?: unknown) => Promise<T>;
export async function readWebMaterial(request: Request, material: Material, name: string, topicId?: string): Promise<SessionDocument> {
  if (material.kind === "repo") {
    const result = await request<{ text: string; commitSha: string }>(`/api/topic-repository?materialId=${encodeURIComponent(material.id)}&name=${encodeURIComponent(name)}${topicId ? `&topicId=${encodeURIComponent(topicId)}` : ""}`);
    return { ...renderRepositoryText(result.commitSha, name, result.text), text: result.text };
  }
  const file = material.files.find(file => file.name === name); if (!file) throw new Error("文件不存在");
  if (/\.pdf$/i.test(file.name) || file.mimeType === "application/pdf") {
    const response = await fetch(`/api/materials/${encodeURIComponent(material.id)}/raw?name=${encodeURIComponent(name)}`); if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return renderFile(file, new Uint8Array(await response.arrayBuffer()));
  }
  return request(`/api/materials/file?id=${encodeURIComponent(material.id)}&name=${encodeURIComponent(name)}`);
}
export function webReadingSpeech(request: Request, materialId: string, file: () => string): Pick<ObsidianViewActions, "loadAudio" | "synthesizeSpeech" | "prepareInterline"> {
  return {
    prepareInterline: (units, index, mode) => request("/api/interline", { materialId, file: file(), units, index, mode }),
    loadAudio: async name => { const response = await fetch(`/api/materials/${encodeURIComponent(materialId)}/raw?name=${encodeURIComponent(name)}`); if (!response.ok) throw new Error(`HTTP ${response.status}`); return new Uint8Array(await response.arrayBuffer()); },
    synthesizeSpeech: async (text, signal) => { const response = await fetch("/api/speech/synthesize", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }), signal }); if (!response.ok) { const error = await response.json(); throw new Error(String(error.error)); } return { bytes: new Uint8Array(await response.arrayBuffer()), mimeType: response.headers.get("content-type") || "audio/wav" }; },
  };
}
