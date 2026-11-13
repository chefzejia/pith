import type { AttentionCompassSnapshot, Material } from "../src/core/index.ts";
import { renderCompass } from "../src/workbench/compass.ts";
import { openMaterialPicker } from "../src/workbench/materialPicker.ts";
import type { IntakePorts } from "../src/workbench/intake.ts";

/** Layout inputs and action boundaries; the shared renderers and styles are unchanged. */
export function mountMaterialCards(root: HTMLElement) {
  const date = "2026-11-14T00:00:00.000Z", clicks: string[] = [];
  const materials: Material[] = [
    "有封面材料", "无封面材料", "有封面的长标题：从证据核对到持续阅读以及跨平台材料管理的完整过程与实践", "无封面的长标题：" + "UnbrokenMaterialTitle".repeat(4),
  ].map((title, index) => ({ id: `card-${index}`, title, kind: "book", createdAt: date, files: [], aids: [], notes: [] }));
  const canvas = root.ownerDocument.createElement("canvas"); canvas.width = 64; canvas.height = 88;
  const context = canvas.getContext("2d")!; context.fillStyle = "#4e6a56"; context.fillRect(0, 0, 64, 88); context.fillStyle = "#fff"; context.font = "12px sans-serif"; context.fillText("BOOK", 14, 46);
  const covers = materials.map((material, index) => ({ id: material.id, title: material.title,
    ...(index % 2 === 0 ? { coverUrl: canvas.toDataURL("image/png") } : {}),
    ...(index !== 1 ? { reading: { openedAt: date, file: index === 0 ? "chapter.epub" : "很长的阅读文件名-" + "unbrokenFileName".repeat(4) + ".epub", locator: "page:123" } } : {}),
  }));
  const unused = async (): Promise<never> => { throw new Error("Layout fixture does not import or call an Agent"); };
  const ports: IntakePorts = { importFiles: unused, importUrl: unused, importRepository: unused, intake: unused };
  const snapshot: AttentionCompassSnapshot = { unreadable: [], exploring: [], shelved: [], settled: [], library: materials.map(material => ({ material, topicIds: [] })), focusRecommendation: null, pendingEffectsCount: 0 };
  const compass = renderCompass(root, snapshot, { open() {}, openMaterial(id) { clicks.push(id); }, materials: covers, intake: { ports, guideAvailable: false, topic: unused, async fed() {} } });
  let picker: ReturnType<typeof openMaterialPicker> | undefined;
  return { clicks, openPicker() {
    picker = openMaterialPicker(root, { library: async () => materials, referenced: async () => [materials[3]!.id], ports, async attach(id) { clicks.push(id); }, async added() {} });
  }, dispose() { picker?.dispose(); compass.dispose(); } };
}
