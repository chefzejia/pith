import { registerPlugin, type Material, type StageTimelineService, type TranscriptCue } from "../../core/index.ts";

export function timelineInUse(materials: readonly Material[]): number {
  return materials.filter(material => material.kind === "media").length;
}

function seconds(value: string): number | null {
  const parts = value.replace(",", ".").split(":");
  if (parts.length < 2 || parts.length > 3 || parts.some(part => !/^\d+(?:\.\d+)?$/.test(part))) return null;
  const n = parts.map(Number);
  const last = n[n.length - 1]!;
  const minutes = n[n.length - 2]!;
  if (last >= 60 || (parts.length === 3 && minutes >= 60)) return null;
  return (parts.length === 3 ? n[0]! * 3600 : 0) + minutes * 60 + last;
}

export function parseTranscript(raw: string): TranscriptCue[] {
  const lines = raw.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").split("\n");
  const cues: TranscriptCue[] = [];
  const openEnded = new Set<string>();
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    const timing = /^(\d{1,}:\d{2}(?::\d{2})?(?:[.,]\d{1,3})?)\s*-->\s*(\d{1,}:\d{2}(?::\d{2})?(?:[.,]\d{1,3})?)(?:\s+.*)?$/.exec(line);
    if (timing) {
      const start = seconds(timing[1]!); const end = seconds(timing[2]!);
      const text: string[] = [];
      while (i + 1 < lines.length && lines[i + 1]!.trim()) text.push(lines[++i]!.trim());
      if (start === null || end === null || end <= start || !text.length) continue;
      const content = text.join("\n");
      const speaker = /^<v\s+([^>]+)>/i.exec(content);
      cues.push({ id: `cue-${cues.length + 1}`, startSec: start, endSec: end, text: content.replace(/<[^>]*>/g, ""), ...(speaker ? { speaker: speaker[1]!.trim() } : {}) });
      continue;
    }
    const timed = /^\[(\d{1,}:\d{2}(?::\d{2})?(?:[.,]\d{1,3})?)\]\s*(.+)$/.exec(line);
    if (timed) {
      const start = seconds(timed[1]!);
      if (start !== null) {
        const id = `cue-${cues.length + 1}`;
        openEnded.add(id);
        cues.push({ id, startSec: start, endSec: start + 5, text: timed[2]! });
      }
    }
  }
  cues.sort((a, b) => a.startSec - b.startSec);
  for (let i = 0; i + 1 < cues.length; i++) {
    const cue = cues[i]!;
    if (openEnded.has(cue.id)) cues[i] = { ...cue, endSec: Math.max(cue.startSec + 0.001, cues[i + 1]!.startSec) };
  }
  return cues;
}
export function formatTimestamp(value: number): string {
  if (!Number.isFinite(value) || value < 0) throw new Error("Invalid timestamp");
  const total = Math.floor(value); const h = Math.floor(total / 3600); const m = Math.floor(total / 60) % 60; const s = total % 60;
  return `${h ? `${String(h).padStart(2, "0")}:` : ""}${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
export function findCueAt(cues: readonly TranscriptCue[], value: number): TranscriptCue | null {
  if (!Number.isFinite(value) || value < 0) return null;
  return cues.find(cue => cue.startSec <= value && value < cue.endSec) ?? null;
}

registerPlugin({
  id: "stage-timeline",
  api: "^1",
  requires: ["host", "store", "window"],
  provides: ["stage.timeline"],
  essential: false,
  name: "Media Timeline Stage",
  description: "Synchronized video/podcast playback with selectable transcript cues and keyframe anchors",
  oneInUse: "1 media material in workspace",
  manyInUse: "{n} media materials in workspace",
  parts: [{ slot: "stage", key: "timeline" }],
  apply(ctx) {
    const service: StageTimelineService = {
      formats: ["audio", "video"],
      parseTranscript, formatTimestamp, findCueAt,
    };
    ctx.provide("stage.timeline", service);
  },
});
