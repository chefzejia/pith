import { registerPlugin, type DojoDiagnosisResult, type DojoScaffoldStage, type DojoToolkitDescriptor, type Topic } from "../../core/index.ts";

export function feynmanInUse(topics: readonly Topic[]): number {
  return topics.filter(topic => topic.toolkits.includes("feynman") || topic.toolkits.includes("dojo-feynman")).length;
}

const englishStopWords = new Set("a an the and or but to of in on at for by with is are was were am be been being have has had do does did as that it this these those from into can may will would should could not if then than through using use their its our your they we you which when where while because so therefore thus such also".split(" "));
const chineseFunctionWords = /因为|所以|因此|但是|然而|如果|那么|然后|而且|并且|或者|以及|通过|对于|由于|为了|可以|能够|需要|使用|会|将|把|被|让|使|的|地|得|了|着|过|和|与|及|或|在|是|为|由|对|从|向|中|并|而|也|就|则|又|不/g;
const tokenPattern = /`([^`\n]+)`|[A-Za-z][A-Za-z0-9]*(?:[-'][A-Za-z0-9]+)*|[\p{Script=Han}]+/gu;

function chineseConcepts(text: string): string[] {
  return text.split(chineseFunctionWords).filter(part => part.length >= 2);
}

function conceptTokens(text: string): string[] {
  const concepts = new Map<string, string>();
  for (const match of text.matchAll(tokenPattern)) {
    const word = match[0];
    let candidates: string[];
    if (match[1] !== undefined) candidates = [match[1].trim()];
    else if (/^[A-Za-z]/.test(word)) candidates = englishStopWords.has(word.toLowerCase()) ? [] : [word];
    else {
      candidates = chineseConcepts(word).flatMap(part => {
        if (part.length <= 4) return [part];
        return Array.from({ length: part.length - 1 }, (_, index) => part.slice(index, index + 2));
      });
    }
    for (const candidate of candidates) {
      const key = candidate.normalize("NFC").toLowerCase();
      if (key && !concepts.has(key)) concepts.set(key, candidate);
    }
  }
  return [...concepts.values()];
}

export function transformCue(text: string, stage: DojoScaffoldStage): string {
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

export function diagnoseFeynman(targetText: string, producedText: string): DojoDiagnosisResult {
  const concepts = conceptTokens(targetText);
  const normalizedProduced = producedText.normalize("NFC").toLowerCase();
  const matchedTokens: string[] = [];
  const missedTokens: string[] = [];
  for (const concept of concepts) {
    const normalized = concept.normalize("NFC").toLowerCase();
    const escaped = normalized.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = /^[a-z0-9]/.test(normalized) && /[a-z0-9]$/.test(normalized)
      ? new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`, "u")
      : null;
    const matched = pattern ? pattern.test(normalizedProduced) : normalizedProduced.includes(normalized);
    (matched ? matchedTokens : missedTokens).push(concept);
  }
  const accuracyScore = concepts.length ? matchedTokens.length / concepts.length : 0;
  const summaryMarkdown = `费曼复述诊断\n\n概念覆盖率：${Math.round(accuracyScore * 100)}%\n\n已覆盖：${matchedTokens.length ? matchedTokens.join("、") : "无"}\n\n遗漏：${missedTokens.length ? missedTokens.join("、") : "无"}`;
  return { targetText, producedText, accuracyScore, missedTokens, matchedTokens, summaryMarkdown };
}

export const feynmanToolkit: DojoToolkitDescriptor = {
  id: "feynman", label: "费曼复述", category: "comprehension",
  stages: ["listen-decompose", "guided-follow", "scaffold-cloze", "blind-produce"],
  transformCue, diagnose: diagnoseFeynman,
  quickActions: [{ id: "feynman-coach", label: "费曼深水区追问", prompt: "请审视我的费曼复述，指出逻辑跳跃或概念遗漏，并用一个反例追问我。" }],
};

registerPlugin({
  id: "dojo-feynman", api: "^1", requires: ["stage.reader"], provides: ["dojo.feynman"], essential: false,
  name: "4-Stage Feynman Recall Dojo",
  description: "Concept decomposition, guided comparison, cloze recall, and blind explanation",
  oneInUse: "1 topic using feynman", manyInUse: "{n} topics using feynman",
  parts: [{ slot: "dojo", key: "feynman" }],
  apply(ctx) { ctx.provide("dojo.feynman", feynmanToolkit); },
});
