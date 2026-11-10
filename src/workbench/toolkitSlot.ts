import { isMediaFile } from "./mediaAssets.ts";

export function effectiveToolkits(toolkits: readonly string[], _format: string): string[] {
  return [...new Set(toolkits.filter(id => id !== "none").map(id => id.replace(/^dojo-/, "")))];
}
export function topicUsesToolkit(topic: { toolkits: readonly string[]; materialId?: string }, _materials: readonly { id: string; kind: string; files: readonly { name: string }[] }[], id: string): boolean {
  return effectiveToolkits(topic.toolkits, "").includes(id);
}
export function toolkitSlot(toolkits: readonly string[], active: string, labels: Readonly<Record<string, string>> = {}): { ids: string[]; active: string; text: string } {
  const ids = [...new Set(toolkits.filter(id => id !== "none").map(id => id.replace(/^dojo-/, "")))];
  const selected = ids.includes(active) ? active : ids[0] ?? "";
  const name = labels[selected] ?? (selected === "shadowing" ? "影子跟读" : selected === "feynman" ? "费曼复述" : selected === "interline" ? "行间双语" : selected);
  return { ids, active: selected, text: ids.length ? `${name}${ids.length > 1 ? ` · ${ids.length}` : ""}` : "" };
}
export function defaultToolkitsForMaterial(input: { kind: string; files: readonly { name: string; mimeType?: string }[]; sampleText?: string }): string[] {
  if (input.kind === "media" || input.files.some(isMediaFile)) return ["shadowing"];
  if (input.kind === "repo") return ["feynman"];
  const sample = input.sampleText?.trim().replace(/\.[a-z][a-z0-9]{0,9}$/i, "") || input.files.map(file => file.name.replace(/^.*[/\\]/, "").replace(/\.[^.]+$/, "")).join(" ");
  const characters = Array.from(sample).filter(char => !/\s/u.test(char));
  const foreign = characters.filter(char => /\p{L}/u.test(char) && !/\p{Script=Han}/u.test(char)).length;
  return characters.length && foreign / characters.length >= 0.5 ? ["interline", "feynman"] : ["feynman"];
}
