import {
  DEFAULT_PERSONAS,
  parseGuideReply,
  registerPlugin,
  type AttentionEngine,
  type DojoToolkitDescriptor,
  type GuideAgentService,
  type GuideConversationEntry,
  type GuideProvider,
  type GuideQuickAction,
  type HostPort,
  type SelectionAnchor,
  type Topic,
  type WorkspaceStore,
} from "../../core/index.ts";
import { LocalAcpGuideProvider, buildReadOnlyAgentEnv, runOneShotAcpPrompt } from "./acpSession.ts";
import { BUILTIN_LOCAL_AGENTS, CachedAgentDetector, discoverLocalAgents } from "./discovery.ts";

export {
  BUILTIN_LOCAL_AGENTS,
  CachedAgentDetector,
  LocalAcpGuideProvider,
  buildReadOnlyAgentEnv,
  discoverLocalAgents,
  runOneShotAcpPrompt,
};

export function quickActionsForTopic(topic: Topic, activeDojos: readonly DojoToolkitDescriptor[]): GuideQuickAction[] {
  const actions: GuideQuickAction[] = [
    { id: "orient", label: "导读这一节", prompt: "请结合我的目标导读当前材料。" },
    { id: "quiz", label: "考考我 / 下一步", prompt: "请检验我的理解，并给出下一步。" },
  ];
  if (topic.notes.length) actions.push({ id: "settle", label: "总结沉淀", prompt: "请根据我的笔记和目标进行毕业深水区一问。" });
  for (const dojo of activeDojos) {
    if (topic.toolkits.includes(dojo.id) || topic.toolkits.includes(`dojo-${dojo.id}`)) actions.push(...dojo.quickActions);
  }
  return actions;
}

export function buildScenePrompt(input: { profileMarkdown: string; topic: Topic; userMessage: string; anchor?: SelectionAnchor }): string {
  const { topic } = input;
  return [
    `# 学习者画像\n${input.profileMarkdown}`,
    `# 当前课题\n标题：${topic.title}\n目标：${topic.target}\n状态：${topic.status}\n下一步：${topic.nextAction ?? "未设置"}`,
    `# 笔记\n${topic.notes.map((note) => note.body).join("\n\n") || "暂无"}`,
    input.anchor
      ? `# 当前选区\n文件：${input.anchor.file}\n位置：${input.anchor.locator}\n引用：${input.anchor.quote ?? ""}`
      : "# 当前选区\n无",
    `# 学习者问题\n${input.userMessage}`,
    "# 毕业门控（Settlement Gate）\n提出一道针对课题目标的深水区问题，要求学习者独立解释或迁移应用。只有回答证明理解后，才建议将课题沉淀；不要替学习者回答或自行宣布毕业。",
  ].join("\n\n");
}

registerPlugin({
  id: "guide-acp",
  api: "^1",
  requires: ["host", "store", "engine"],
  provides: ["guide.agent"],
  essential: true,
  name: "Guide Collaborator (ACP/MCP)",
  description: "Sessionless attention & curriculum collaborator grounded in ME.md and Topic ledgers",
  parts: [{ slot: "guide", key: "guide-panel" }],
  settings: {
    persona: {
      type: "string",
      title: "Surface persona",
      description: "User-facing metaphor for workspace and AI collaborator",
      default: "sanctuary",
      enum: ["sanctuary", "studio"],
    },
    agentId: {
      type: "string",
      title: "Local Agent CLI",
      description: "Local ACP agent CLI id (dsh / claude / codex)",
      default: "",
      enum: ["", "dsh", "claude", "codex"],
    },
    model: {
      type: "string",
      title: "Model override",
      description: "Optional model identifier passed to ACP session/new",
      default: "",
    },
    effort: {
      type: "string",
      title: "Reasoning effort",
      description: "Optional reasoning effort passed to ACP session/new",
      default: "",
    },
    timeoutMs: {
      type: "integer",
      title: "Turn timeout (ms)",
      default: 60000,
      minimum: 5000,
      maximum: 600000,
    },
  },
  apply(ctx) {
    const personaId = String(ctx.config["persona"] ?? "sanctuary");
    const persona = DEFAULT_PERSONAS[personaId] ?? DEFAULT_PERSONAS["sanctuary"]!;
    const timeout = ctx.config["timeoutMs"];
    if (typeof timeout !== "number") throw new Error("Invalid guide timeout");
    const agentId = String(ctx.config["agentId"] ?? "");
    const model = String(ctx.config["model"] ?? "");
    const effort = String(ctx.config["effort"] ?? "");

    const host = ctx.service<HostPort>("host");
    const engine = ctx.service<AttentionEngine>("engine");
    const store = ctx.service<WorkspaceStore>("store");
    const detector = new CachedAgentDetector({ processPort: host?.process });

    const service: GuideAgentService = {
      persona,
      timeoutMs: timeout,
      actions: ["解释这段内容", "给我一个例子", "检验我的理解"],
      detectAgents: (force?: boolean) => detector.detect(force),
      quickActionsForTopic,
      buildScenePrompt,
    };
    ctx.provide("guide.agent", service);

    let provider = ctx.service<GuideProvider>("guide.provider");
    if (!provider && agentId && host?.process && store && typeof store.readProfile === "function") {
      provider = new LocalAcpGuideProvider({
        processPort: host.process,
        store,
        getAgentConfig: () => ({
          agentId,
          ...(model ? { model } : {}),
          ...(effort ? { effort } : {}),
          timeoutMs: timeout,
        }),
        resolveDescriptor: async (id: string) => {
          const list = await detector.detect();
          return list.find((item) => item.id === id) ?? null;
        },
        buildScenePrompt,
      });
    }

    if (provider && engine && store && typeof engine.registerEffectHandler === "function") {
      const activeProvider = provider;
      const dispose = engine.registerEffectHandler("prepare-next-action", async (payload) => {
        if (typeof payload.topicId !== "string") throw new Error("Effect topic is missing");
        const topicId = payload.topicId;
        const prompt: GuideConversationEntry = {
          id: crypto.randomUUID(),
          role: "user",
          text: "请为当前课题给出一个 15 分钟内可完成的具体下一步行动，只返回行动内容。",
          createdAt: new Date().toISOString(),
        };
        const reply = await activeProvider.reply({
          topicId,
          conversation: [...(await engine.getConversation(topicId)), prompt],
        });
        const nextAction = parseGuideReply(reply).text.trim();
        if (!nextAction) throw new Error("Guide returned an empty next action");
        await store.updateTopic(topicId, { nextAction });
      });
      ctx.onDispose(dispose);
    }
  },
});
