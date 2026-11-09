import { registerPlugin, type DojoDiagnosisResult, type DojoScaffoldStage, type DojoToolkitDescriptor, type Topic } from "../../core/index.ts";

export function shadowingInUse(topics: readonly Topic[]): number {
  return topics.filter(topic => topic.toolkits.includes("shadowing") || topic.toolkits.includes("dojo-shadowing")).length;
}

const functionWords = /\b(?:a|an|the|and|or|but|to|of|in|on|at|for|by|with|is|are|was|were|am|be|been|have|has|had|do|does|did|as|that|it)\b(?!['’][\p{L}\p{N}])/giu;
export function shadowingTokens(text: string): { text: string; start: number; end: number }[] {
  const pattern = /[\p{Script=Latin}\p{Script=Cyrillic}\p{Script=Greek}\p{Script=Arabic}\p{N}][\p{Script=Latin}\p{Script=Cyrillic}\p{Script=Greek}\p{Script=Arabic}\p{M}\p{N}]*(?:['’][\p{Script=Latin}\p{Script=Cyrillic}\p{Script=Greek}\p{Script=Arabic}\p{N}][\p{Script=Latin}\p{Script=Cyrillic}\p{Script=Greek}\p{Script=Arabic}\p{M}\p{N}]*)*|[\p{L}\p{N}]\p{M}*/gu;
  return Array.from(text.matchAll(pattern), match => ({ text: match[0], start: match.index, end: match.index + match[0].length }));
}

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
  const targetParts = shadowingTokens(targetText);
  const target = targetParts.map(part => part.text);
  const produced = shadowingTokens(producedText).map(part => part.text);
  if (!target.length && targetText.trim()) throw new Error("原文没有可对齐的文字或数字");
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
  const escape = (value: string): string => value.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
  let cursor = 0, matchedIndex = 0, aligned = "";
  for (const part of targetParts) {
    aligned += escape(targetText.slice(cursor, part.start));
    if (part.text === matchedTokens[matchedIndex]) { aligned += escape(part.text); matchedIndex++; }
    else aligned += `<mark>${escape(part.text)}</mark>`;
    cursor = part.end;
  }
  aligned += escape(targetText.slice(cursor));
  const summaryMarkdown = `跟读对照\n\n原文：${aligned}\n\n复述：${escape(producedText)}\n\n漏词：${missedTokens.length ? missedTokens.map(escape).join("、") : "无"}`;
  return { targetText, producedText, accuracyScore, missedTokens, matchedTokens, summaryMarkdown };
}

export const shadowingToolkit: DojoToolkitDescriptor = {
  id: "shadowing", label: "影子跟读", category: "language", evalMode: "deterministic",
  whenToUse: "外语听力、口语发音、演讲台词或音视频字幕需要四阶跟读与漏词诊断时挂载", compatibleStages: ["timeline", "reader"], uiProtocol: "inline-stage-lens",
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
  apply(ctx) {
    ctx.provide("dojo.shadowing", shadowingToolkit);
  },
});

export function renderDojoAlignment(target: string, matched: readonly string[]): string {
  const escape = (text: string): string => text.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
  let offset = 0, index = 0, html = "";
  for (const part of shadowingTokens(target)) {
    html += escape(target.slice(offset, part.start));
    const token = part.text;
    if (index < matched.length && token === matched[index]) { html += escape(token); index++; }
    else html += `<mark>${escape(token)}</mark>`;
    offset = part.end;
  }
  return html + escape(target.slice(offset));
}
