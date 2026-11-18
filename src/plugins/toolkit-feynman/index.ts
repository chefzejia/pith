import { registerPlugin, type HostPort, type AgentPromptService, type ToolkitStage, type ToolkitDescriptor, type Topic } from "../../core/index.ts";
import { createFeynmanContrast } from "./contrast.ts";
export * from "./contrast.ts";

export function feynmanInUse(topics: readonly Topic[]): number {
  return topics.filter(topic => topic.toolkits.includes("feynman")).length;
}

const englishStopWords = new Set("a an the and or but to of in on at for by with is are was were am be been being have has had do does did as that it this these those from into can may will would should could not if then than through using use their its our your they we you which when where while because so therefore thus such also".split(" "));
const chineseFunctionWords = /因为|所以|因此|但是|然而|如果|那么|然后|而且|并且|或者|以及|通过|对于|由于|为了|可以|能够|需要|使用|会|将|把|被|让|使|的|地|得|了|着|过|和|与|及|或|在|是|为|由|对|从|向|中|并|而|也|就|则|又|不/g;
const tokenPattern = /`([^`\n]+)`|[A-Za-z][A-Za-z0-9]*(?:[-'][A-Za-z0-9]+)*|[\p{Script=Han}]+/gu;


export function transformCue(text: string, stage: ToolkitStage): string {
  if (stage === "guided-follow") return text;
  if (stage === "blind-produce") return "【合上原文】请用自己的话向初学者解释这段机制的核心因果链与边界条件：";
  if (stage === "listen-decompose") {
    return (text.match(/[^。.!?！？；;\n]+[。.!?！？；;]?/gu) ?? [])
      .map(part => part.trim()).filter(Boolean).map((part, index) => `${index + 1}. ${part}`).join("\n");
  }
  if (stage !== "scaffold-cloze") throw new Error("Invalid scaffold stage");
  return text.replace(tokenPattern, (word: string) => {
    if (word.startsWith("`")) return "[___]";
    if (/^[A-Za-z]/.test(word)) return word.length >= 5 && !englishStopWords.has(word.toLowerCase()) ? "[___]" : word;
    return word.replace(chineseFunctionWords, "\0$&\0").split("\0")
      .map((part, index) => index % 2 === 0 && part.length >= 2 ? "[___]" : part).join("");
  });
}

export const feynmanToolkit: ToolkitDescriptor = {
  id: "feynman", role: "training", label: "费曼复述", category: "comprehension",
  whenToUse: "架构设计、源码机制、核心概念或理论需要合书复述并逐条对照原文时挂载", compatibleStages: ["reader", "timeline"], uiProtocol: "inline-stage-lens",
  stages: ["blind-produce"],
  transformCue,
  quickActions: [{ id: "feynman-coach", label: "费曼深水区追问", prompt: "请审视我的费曼复述，指出逻辑跳跃或概念遗漏，并用一个反例追问我。" }],
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
