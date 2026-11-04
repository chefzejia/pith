export function effectiveToolkits(toolkits: readonly string[], format: string): string[] {
  if (toolkits.length) return [...new Set(toolkits.filter(id => id !== "none").map(id => id.replace(/^dojo-/, "")))];
  if (/^(epub|pdf|cbz|markdown|md|article|book)$|\.(epub|pdf|cbz|md|markdown)$/i.test(format)) return ["feynman"];
  if (/^(media|audio|video)$|\.(vtt|srt|mp3|m4a|wav|ogg|mp4|webm)$/i.test(format)) return ["shadowing"];
  return [];
}
export function topicUsesToolkit(topic: { toolkits: readonly string[]; materialId?: string }, materials: readonly { id: string; kind: string; files: readonly { name: string }[] }[], id: string): boolean {
  if (topic.toolkits.length) return effectiveToolkits(topic.toolkits, "").includes(id);
  const material = materials.find(item => item.id === topic.materialId);
  return !!material && (effectiveToolkits([], material.kind).includes(id) || material.files.some(file => effectiveToolkits([], file.name).includes(id)));
}
export function toolkitSlot(toolkits: readonly string[], active: string, labels: Readonly<Record<string, string>> = {}): { ids: string[]; active: string; text: string } {
  const ids = [...new Set(toolkits.filter(id => id !== "none").map(id => id.replace(/^dojo-/, "")))];
  const selected = ids.includes(active) ? active : ids[0] ?? "";
  const name = labels[selected] ?? (selected === "shadowing" ? "影子跟读" : selected === "feynman" ? "费曼复述" : selected);
  return { ids, active: selected, text: ids.length ? `🛠 ${name}${ids.length > 1 ? ` · ${ids.length} ▾` : ""}` : "🛠" };
}
