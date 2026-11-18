import { DefaultWorkspaceStore } from "../src/core/index.ts";
import { NodeWorkspaceStorage } from "../src/shells/web/nodeStorage.ts";

export async function seedSettledCount(directory: string) {
  const store = new DefaultWorkspaceStore(new NodeWorkspaceStorage(directory));
  const title = "Agent 框架如何划分内核与插件，以及扩展点如何影响宿主边界？";
  const target = "比较四份仓库的启动入口、会话生命周期、调度、路由和存储，核对注册表、清单、插件包和技能分别如何交给宿主管理。最后用对照表说明各方案的取舍。".repeat(2);
  const topic = await store.createTopic({ title, target, materialIds: [], toolkits: [] });
  for (const body of ["先区分内核职责", "再核对注册入口"]) await store.appendTopicNote(topic.id, { kind: "note", author: "user", body });
  await store.updateTopic(topic.id, { status: "settled" });
  return topic;
}
