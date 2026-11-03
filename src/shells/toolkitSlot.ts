export function toolkitSlot(toolkits: readonly string[], active: string, labels: Readonly<Record<string, string>> = {}): { ids: string[]; active: string; text: string } {
  const ids = [...new Set(toolkits.map(id => id.replace(/^dojo-/, "")))];
  const selected = ids.includes(active) ? active : ids[0] ?? "";
  const name = labels[selected] ?? (selected === "shadowing" ? "影子跟读" : selected === "feynman" ? "费曼复述" : selected);
  return { ids, active: selected, text: ids.length ? `✦ ${name}${ids.length > 1 ? ` · ${ids.length} ▾` : ""}` : "+" };
}
