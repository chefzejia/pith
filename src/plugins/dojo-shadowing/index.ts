import { registerPlugin, type DojoDiagnosisResult, type DojoScaffoldStage, type DojoToolkitDescriptor, type Topic } from "../../core/index.ts";

export function shadowingInUse(topics: readonly Topic[]): number {
  return topics.filter(topic => topic.toolkits.includes("shadowing") || topic.toolkits.includes("dojo-shadowing")).length;
}

const functionWords = /\b(?:a|an|the|and|or|but|to|of|in|on|at|for|by|with|is|are|was|were|am|be|been|have|has|had|do|does|did|as|that|it)\b(?!['’][\p{L}\p{N}])/giu;
const wordPattern = /[\p{Script=Latin}0-9][\p{Script=Latin}\p{M}0-9]*(?:['’][\p{Script=Latin}0-9][\p{Script=Latin}\p{M}0-9]*)*/gu;

export function transformCue(text: string, stage: DojoScaffoldStage): string {
  if (stage === "guided-follow") return text;
  if (stage === "blind-produce") return "••••••••";
  if (stage === "scaffold-cloze") return text.replace(functionWords, "___");
  if (stage !== "listen-decompose") throw new Error("Invalid scaffold stage");
  let words = 0;
  return text.replace(/\S+\s*/gu, (part: string, offset: number) => {
    words++;
    const boundary = /[,;:，；：]["”’)]*\s*$/.test(part) || words >= 10;
    if (!boundary || offset + part.length >= text.length) return part;
    words = 0;
    return part.replace(/\s*$/, match => ` /${match || " "}`);
  });
}

export function diagnose(targetText: string, producedText: string): DojoDiagnosisResult {
  const target = targetText.match(wordPattern) ?? [];
  const produced = producedText.match(wordPattern) ?? [];
  if ((target.length + 1) * (produced.length + 1) > 2_000_000) throw new Error("Text is too long to compare");
  const normalize = (word: string): string => word.normalize("NFC").toLowerCase().replace(/[’']/g, "'");
  const left = target.map(normalize); const right = produced.map(normalize);
  const rows = Array.from({ length: left.length + 1 }, () => new Uint32Array(right.length + 1));
  for (let i = left.length - 1; i >= 0; i--) for (let j = right.length - 1; j >= 0; j--) {
    rows[i]![j] = left[i] === right[j] ? rows[i + 1]![j + 1]! + 1 : Math.max(rows[i + 1]![j]!, rows[i]![j + 1]!);
  }
  const missedTokens: string[] = []; const matchedTokens: string[] = [];
  let i = 0; let j = 0;
  while (i < left.length) {
    if (j < right.length && left[i] === right[j]) { matchedTokens.push(target[i]!); i++; j++; }
    else if (j < right.length && rows[i]![j + 1]! > rows[i + 1]![j]!) j++;
    else { missedTokens.push(target[i]!); i++; }
  }
  const accuracyScore = target.length ? matchedTokens.length / target.length : 0;
  const summaryMarkdown = `跟读诊断\n\n目标：${targetText}\n\n复述：${producedText}\n\n准确率：${Math.round(accuracyScore * 100)}%\n\n漏词：${missedTokens.length ? missedTokens.join("、") : "无"}`;
  return { targetText, producedText, accuracyScore, missedTokens, matchedTokens, summaryMarkdown };
}

export const shadowingToolkit: DojoToolkitDescriptor = {
  id: "shadowing", label: "影子跟读", category: "language",
  stages: ["listen-decompose", "guided-follow", "scaffold-cloze", "blind-produce"],
  transformCue, diagnose,
  quickActions: [{ id: "shadowing-coach", label: "分析跟读", prompt: "请分析我的跟读，指出节奏与漏词并给出下一步练习。" }],
};

registerPlugin({
  id: "dojo-shadowing",
  api: "^1",
  requires: ["stage.timeline", "speech.asr"],
  provides: ["dojo.shadowing"],
  essential: false,
  name: "4-Stage Shadowing Dojo",
  description: "Progressive language shadowing: prosody decomposition, guided follow, cloze skeleton, and blind recall",
  oneInUse: "1 topic using shadowing",
  manyInUse: "{n} topics using shadowing",
  parts: [{ slot: "dojo", key: "shadowing" }],
  apply(ctx) {
    ctx.provide("dojo.shadowing", shadowingToolkit);
  },
});
