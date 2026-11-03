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

export type DeviceFormFactor = "portrait-phone" | "landscape-phone" | "foldable-square" | "tablet-desktop";

export interface ResponsiveLayoutDecision {
  readonly formFactor: DeviceFormFactor;
  readonly aspectRatio: number;
  /** Whether Guide & Dojo may dock as a side-by-side right split pane (`W >= 740 && R >= 0.85 && H >= 480`). */
  readonly canSplitGuide: boolean;
  /** How Guide & Dojo panels should mount when opened (`split-right` vs `bottom-sheet` vs `overlay-drawer`). */
  readonly sheetMode: "split-right" | "bottom-sheet" | "overlay-drawer";
  /** Stage width remaining after accounting for a docked right guide when `guideOpen && canSplitGuide`. */
  readonly stageWidthPx: number;
  /** Whether the reading stage geometry satisfies the Two-Page Spread rule (`W_stage >= 936 && R_stage >= 1.15 && H_stage >= 520`). */
  readonly canDoubleColumn: boolean;
  /** Effective columns (1 or 2) after combining user preference with physical geometry constraints. */
  readonly effectiveColumns: 1 | 2;
  /** Minimum interactive target size in px (44px on coarse pointer / phone, 34px on fine desktop). */
  readonly hitTargetPx: 34 | 44;
}

export interface StageReaderService {
  readonly formats: readonly ("markdown" | "epub" | "pdf" | "cbz" | "image")[];
  sections(markdown: string): ReaderSectionHeading[];
  render(markdown: string): string;
  extractProseBlocks?(markdownOrHtml: string): readonly ProseBlock[];
  extractTeachingBlocks?(markdown: string): readonly TeachingBlockSpec[];
  matchTextAnchor?(fullText: string, anchor: { readonly locator: IntrinsicLocator; readonly quote?: string; readonly prefix?: string; readonly suffix?: string }): TextQuoteMatch | null;
  computePagination?(viewportWidth: number, viewportHeight: number, scrollWidth: number, mode?: "auto" | "single" | "double"): PaginationMetrics;
  resolveResponsiveLayout?(input: {
    readonly width: number;
    readonly height: number;
    readonly fontSizePx?: number;
    readonly guideOpen?: boolean;
    readonly guideWidthPx?: number;
    readonly preferredColumns?: "auto" | "single" | "double";
    readonly coarsePointer?: boolean;
  }): ResponsiveLayoutDecision;
  renderFile?(file: MaterialFileEntry, bytes: Uint8Array): Promise<RenderedDocumentView>;
}

export interface StageTimelineService {
  readonly formats: readonly ("audio" | "video")[];
  parseTranscript(raw: string): readonly TranscriptCue[];
  formatTimestamp(seconds: number): string;
  findCueAt(cues: readonly TranscriptCue[], seconds: number): TranscriptCue | null;
  sliceLoopRange?(cues: readonly TranscriptCue[], startSec: number, endSec: number): readonly TranscriptCue[];
  renderTimelineView?(input: {
    readonly title: string;
    readonly mediaFile?: string;
    readonly mediaKind?: "audio" | "video";
    readonly cues: readonly TranscriptCue[];
    readonly activeCueId?: string;
    readonly loopRange?: { readonly startSec: number; readonly endSec: number };
  }): string;
}

export type CuratedTtsProviderId = "openai-compatible-local" | "openai-tts" | "azure-neural" | "kokoro-local";
export type CuratedAsrProviderId = "whisper-local" | "sensevoice-local" | "openai-whisper";

export interface SpeechEnginePreset<TId extends string = string> {
  readonly id: TId;
  readonly label: string;
  readonly kind: "local" | "cloud";
  readonly defaultEndpoint: string;
  readonly defaultModel?: string;
  readonly defaultVoice?: string;
  readonly installHint: string;
}

export interface SpeechSynthesisAudio {
  readonly bytes: Uint8Array;
  readonly mimeType: string;
  readonly providerId: CuratedTtsProviderId;
}

export interface SpeechSentenceSegment {
  readonly text: string;
  readonly offset: number;
  readonly blockIndex?: number;
  readonly locator?: IntrinsicLocator;
}

export type SpeechHealthStatus = "verified" | "unverified" | "failed";

export interface SpeechHealthReport<TId extends string = string> {
  readonly ok: boolean;
  readonly status?: SpeechHealthStatus;
  readonly providerId?: TId;
  readonly note: string;
}

export interface SpeechTtsService {
  readonly providerId?: CuratedTtsProviderId;
  readonly endpoint?: string;
  readonly model?: string;
  readonly voice?: string;
  readonly rate: number;
  splitSentences(text: string): readonly SpeechSentenceSegment[];
  filterProseOnly?(blocks: readonly ProseBlock[]): readonly SpeechSentenceSegment[];
  listPresets?(): readonly SpeechEnginePreset<CuratedTtsProviderId>[];
  checkHealth?(signal?: AbortSignal): Promise<SpeechHealthReport<CuratedTtsProviderId> & { readonly providerId: CuratedTtsProviderId }>;
  synthesizeSpeech?(text: string, signal?: AbortSignal): Promise<SpeechSynthesisAudio>;
}

export interface AsrTranscriptionResult {
  readonly text: string;
  readonly language?: string;
  readonly durationSec?: number;
  readonly providerId?: CuratedAsrProviderId;
}

export interface SpeechAsrService {
  readonly providerId?: CuratedAsrProviderId;
  readonly url: string;
  readonly model?: string;
  isLoopbackSafe(url: string): boolean;
  listPresets?(): readonly SpeechEnginePreset<CuratedAsrProviderId>[];
  checkHealth?(signal?: AbortSignal): Promise<SpeechHealthReport<CuratedAsrProviderId>>;
  transcribeAudio?(audioBytes: Uint8Array, mimeType?: string, signal?: AbortSignal): Promise<AsrTranscriptionResult>;
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

export interface ExternalIngestInput {
  readonly url: string;
  readonly kind?: "article" | "discussion" | "media";
  readonly transcriptMarkdown?: string;
}

export interface ExternalIngestBundle {
  readonly title: string;
  readonly kind: "article" | "discussion" | "media";
  readonly files: readonly { readonly name: string; readonly mimeType: string; readonly bytes: Uint8Array }[];
  readonly warnings: readonly string[];
}

export interface GuideAgentService {
  readonly persona: SurfacePersona;
  readonly timeoutMs: number;
  readonly actions: readonly string[];
  detectAgents?(force?: boolean): Promise<readonly DiscoveredAgentDescriptor[]>;
  quickActionsForTopic?(topic: Topic, activeDojos: readonly DojoToolkitDescriptor[]): readonly GuideQuickAction[];
  configureTopicToolkits?(topicId: string, toolkits: readonly string[]): Promise<Topic>;
  listWorkspaceTools?(): readonly GuideMcpToolSpec[];
  ingestExternalUrl?(input: ExternalIngestInput): Promise<ExternalIngestBundle>;
  buildScenePrompt?(input: {
    readonly profileMarkdown: string;
    readonly topic: Topic;
    readonly userMessage: string;
    readonly anchor?: SelectionAnchor;
    readonly availableToolkits?: readonly Pick<DojoToolkitDescriptor, "id" | "label" | "category">[];
  }): string;
}
