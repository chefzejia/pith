import { registerPlugin, type HostPort, type AgentPromptService, type ToolkitStage, type ToolkitDescriptor, type Topic } from "../../core/index.ts";
import { createFeynmanContrast } from "./contrast.ts";
export * from "./contrast.ts";

export function feynmanInUse(topics: readonly Topic[]): number {
  return topics.filter(topic => topic.toolkits.includes("feynman")).length;
}

export function transformCue(_text: string, stage: ToolkitStage): string {
  if (stage !== "blind-produce") throw new Error("Invalid scaffold stage");
  return "【合上原文】请用自己的话向初学者解释这段机制的核心因果链与边界条件：";
}

export const feynmanToolkit: ToolkitDescriptor = {
  id: "feynman", role: "training", label: "费曼复述", category: "comprehension",
  whenToUse: "架构设计、源码机制、核心概念或理论需要合书复述并逐条对照原文时挂载", compatibleStages: ["reader", "timeline"], uiProtocol: "inline-stage-lens",
  stages: ["blind-produce"],
  transformCue,
  quickActions: [],
};

registerPlugin({
  id: "toolkit-feynman", api: "^1", requires: ["stage.reader"], provides: ["toolkit.feynman"], essential: false,
  name: "Feynman Recall Toolkit",
  description: "Blind explanation and source comparison",
  oneInUse: "1 topic using feynman", manyInUse: "{n} topics using feynman",
  apply(ctx) {
    ctx.provide("toolkit.feynman", feynmanToolkit);
    const host = ctx.service<HostPort>("host");
    if (host) ctx.provide("feynman.contrast", createFeynmanContrast(host.storage, { prompt: (text, options) => {
      const service = ctx.service<AgentPromptService>("guide.prompt");
      if (!service) throw new Error("向导 Agent 不可用");
      return service.prompt(text, options);
    } }));
  },
});
