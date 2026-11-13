import { nonHanLetterRatio } from "../core/seams.ts";

export function toolkitSlot(toolkits: readonly string[], active: string, labels: Readonly<Record<string, string>> = {}): { ids: string[]; active: string; text: string } {
  const ids = [...new Set(toolkits)];
  const selected = ids.includes(active) ? active : ids[0] ?? "";
  const name = labels[selected] ?? (selected === "shadowing" ? "影子跟读" : selected === "feynman" ? "费曼复述" : selected === "interline" ? "行间" : selected);
  return { ids, active: selected, text: ids.length ? name : "" };
}
/** Only reading aids have language defaults. Training always comes from the topic goal. */
export function initialMaterialAids(sampleText: string): string[] { return nonHanLetterRatio(sampleText) >= 0.5 ? ["interline"] : []; }
