/**
 * Capability Seams for Pith Stages, Dojos, Speech, and Guide (`src/core/seams.ts`).
 *
 * Following the DSH Capability Seam triad (Service Definition + Provider + Consumer):
 * - This module owns the host-agnostic Service Definitions (`stage.reader`,
 *   `stage.timeline`, `speech.tts`, `speech.asr`, `dojo.shadowing`, `guide.agent`).
 * - Plugins under `src/plugins/*` implement and provide these services.
 * - Shells (`src/shells/web`, `src/shells/obsidian`, `src/shells/dsh`) consume
 *   them without coupling to any concrete plugin implementation.
 */

import type {
  IntrinsicLocator,
  MaterialFileEntry,
  SelectionAnchor,
  SurfacePersona,
  Topic,
} from "./types.ts";

/**
 * 4-stage progressive scaffolding ladder shared across all Embodied Dojos
 * (language shadowing, Feynman recall, music sight-reading, code dojo).
 */
export type DojoScaffoldStage =
  | "listen-decompose"
  | "guided-follow"
  | "scaffold-cloze"
  | "blind-produce";

export interface TranscriptCue {
  readonly id: string;
  readonly startSec: number;
  readonly endSec: number;
  readonly text: string;
  readonly speaker?: string;
}

export interface DojoDiagnosisResult {
  readonly targetText: string;
  readonly producedText: string;
  readonly accuracyScore: number;
  readonly missedTokens: readonly string[];
  readonly matchedTokens: readonly string[];
  readonly summaryMarkdown: string;
}

export interface ReaderSectionHeading {
  readonly title: string;
  readonly level: number;
  readonly line: number;
  readonly locator: IntrinsicLocator;
}

export interface ProseBlock {
  readonly index: number;
  readonly locator: IntrinsicLocator;
  readonly text: string;
  readonly isProse: boolean;
}

export interface FixedPageEntry {
  readonly page: number;
  readonly label: string;
  readonly mimeType: string;
  readonly bytes?: Uint8Array;
  readonly text?: string;
}

export interface RenderedDocumentView {
  readonly format: "markdown" | "epub" | "pdf" | "cbz" | "image";
  readonly layout?: "reflowable" | "fixed-page";
  readonly title: string;
  readonly html: string;
  readonly sections: readonly ReaderSectionHeading[];
  readonly blocks?: readonly ProseBlock[];
  readonly pages?: readonly FixedPageEntry[];
  readonly totalUnits: number;
}

export interface TeachingBlockSpec {
  readonly id: string;
  readonly kind: "reflection" | "hint" | "checkpoint" | "explanation";
  readonly title: string;
  readonly body: string;
  readonly locator: IntrinsicLocator;
}

export interface TextQuoteMatch {
  readonly startOffset: number;
  readonly endOffset: number;
  readonly exact: string;
  readonly prefix?: string;
  readonly suffix?: string;
}

export interface PaginationMetrics {
  readonly columns: 1 | 2;
  readonly columnWidthPx: number;
  readonly columnGapPx: number;
  readonly horizontalInsetPx: number;
  readonly verticalInsetPx: number;
  readonly contentHeightPx: number;
  readonly totalScreens: number;
}

export interface StageReaderService {
  readonly formats: readonly ("markdown" | "epub" | "pdf" | "cbz" | "image")[];
  sections(markdown: string): ReaderSectionHeading[];
  render(markdown: string): string;
  extractProseBlocks?(markdownOrHtml: string): readonly ProseBlock[];
  extractTeachingBlocks?(markdown: string): readonly TeachingBlockSpec[];
  matchTextAnchor?(fullText: string, anchor: { readonly locator: IntrinsicLocator; readonly quote?: string; readonly prefix?: string; readonly suffix?: string }): TextQuoteMatch | null;
  computePagination?(viewportWidth: number, viewportHeight: number, scrollWidth: number, mode?: "auto" | "single" | "double"): PaginationMetrics;
  renderFile?(file: MaterialFileEntry, bytes: Uint8Array): Promise<RenderedDocumentView>;
}

export interface StageTimelineService {
  readonly formats: readonly ("audio" | "video")[];
  parseTranscript(raw: string): readonly TranscriptCue[];
  formatTimestamp(seconds: number): string;
  findCueAt(cues: readonly TranscriptCue[], seconds: number): TranscriptCue | null;
  sliceLoopRange?(cues: readonly TranscriptCue[], startSec: number, endSec: number): readonly TranscriptCue[];
}

export interface SpeechSentenceSegment {
  readonly text: string;
  readonly offset: number;
  readonly blockIndex?: number;
  readonly locator?: IntrinsicLocator;
}

export interface SpeechTtsService {
  readonly rate: number;
  splitSentences(text: string): readonly SpeechSentenceSegment[];
  filterProseOnly?(blocks: readonly ProseBlock[]): readonly SpeechSentenceSegment[];
}

export interface SpeechAsrService {
  readonly url: string;
  isLoopbackSafe(url: string): boolean;
}

export interface DojoToolkitDescriptor {
  readonly id: string;
  readonly label: string;
  readonly category: "language" | "comprehension" | "executable" | "music";
  readonly stages: readonly DojoScaffoldStage[];
  transformCue(text: string, stage: DojoScaffoldStage): string;
  diagnose(targetText: string, producedText: string): DojoDiagnosisResult;
  quickActions: readonly { id: string; label: string; prompt: string }[];
}

export interface GuideQuickAction {
  readonly id: string;
  readonly label: string;
  readonly prompt: string;
}

export interface DiscoveredAgentDescriptor {
  readonly id: "dsh" | "claude" | "codex" | (string & {});
  readonly label: string;
  readonly command: string | null;
  readonly args: readonly string[];
  readonly version: string | null;
  readonly available: boolean;
  readonly note: string;
}

export interface GuideMcpToolSpec {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
  execute(input: Readonly<Record<string, unknown>>): Promise<unknown>;
}

export interface GuideAgentService {
  readonly persona: SurfacePersona;
  readonly timeoutMs: number;
  readonly actions: readonly string[];
  detectAgents?(force?: boolean): Promise<readonly DiscoveredAgentDescriptor[]>;
  quickActionsForTopic?(topic: Topic, activeDojos: readonly DojoToolkitDescriptor[]): readonly GuideQuickAction[];
  configureTopicToolkits?(topicId: string, toolkits: readonly string[]): Promise<Topic>;
  listWorkspaceTools?(): readonly GuideMcpToolSpec[];
  buildScenePrompt?(input: {
    readonly profileMarkdown: string;
    readonly topic: Topic;
    readonly userMessage: string;
    readonly anchor?: SelectionAnchor;
    readonly availableToolkits?: readonly Pick<DojoToolkitDescriptor, "id" | "label" | "category">[];
  }): string;
}
