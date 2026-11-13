import { DefaultWorkspaceStore } from "../src/core/store/WorkspaceStore.ts";
import { NodeWorkspaceStorage } from "../src/shells/web/nodeStorage.ts";

export async function createTestTopic(workspace: string, input: { title: string; target?: string; materialIds?: readonly string[]; nextAction?: string; toolkits?: readonly string[] }) {
  const store = new DefaultWorkspaceStore(new NodeWorkspaceStorage(workspace));
  return store.createTopic({ title: input.title, target: input.target || input.title, materialIds: input.materialIds || [], toolkits: input.toolkits || [], ...(input.nextAction ? { nextAction: input.nextAction } : {}) });
}
