import type { Topic, WorkspaceStoragePort } from "../../core/index.ts";

function path(topicId: string): string {
  if (!topicId || topicId === "." || topicId === ".." || /[/\\\0]/.test(topicId)) throw new Error("Invalid topic id");
  return `_cache/toolkit-defaults/${encodeURIComponent(topicId)}.json`;
}

export async function markDefaultToolkit(storage: WorkspaceStoragePort, topic: Topic): Promise<void> {
  await storage.mkdir("_cache/toolkit-defaults");
  await storage.writeText(path(topic.id), JSON.stringify({ defaultToolkit: "feynman" }));
}

export async function clearDefaultToolkit(storage: WorkspaceStoragePort | undefined, topicId: string): Promise<void> {
  if (!storage || !await storage.exists(path(topicId))) return;
  await storage.writeText(path(topicId), "{}");
}

export async function isDefaultToolkit(storage: WorkspaceStoragePort | undefined, topic: Topic): Promise<boolean> {
  if (!storage || topic.materialId || topic.toolkits.length !== 1 || topic.toolkits[0] !== "feynman" || !await storage.exists(path(topic.id))) return false;
  try { const value: unknown = JSON.parse(await storage.readText(path(topic.id))); return !!value && typeof value === "object" && "defaultToolkit" in value && value.defaultToolkit === "feynman"; }
  catch (error) { if (error instanceof SyntaxError) return false; throw error; }
}
