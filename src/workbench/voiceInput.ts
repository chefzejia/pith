export class VoiceInput {
  private generation = 0;
  private stream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private abort: AbortController | null = null;
  private active: string | null = null;
  private phase: "idle" | "permission" | "recording" | "transcribing" = "idle";
  private recordingUrl: string | null = null;

  private readonly win: Window & typeof globalThis;
  private readonly transcribe: (bytes: Uint8Array, mime: string, signal: AbortSignal) => Promise<{ readonly text: string }>;
  private readonly update: (target: string, phase: string) => void;
  private readonly result: (target: string, text: string) => void;
  private readonly fail: (message: string) => void;
  private readonly recording: (url: string | null) => void;
  constructor(win: Window & typeof globalThis, transcribe: (bytes: Uint8Array, mime: string, signal: AbortSignal) => Promise<{ readonly text: string }>, update: (target: string, phase: string) => void, result: (target: string, text: string) => void, fail: (message: string) => void, recording: (url: string | null) => void = () => {}) {
    this.win = win; this.transcribe = transcribe; this.update = update; this.result = result; this.fail = fail; this.recording = recording;
  }

  clearRecording(): void {
    if (!this.recordingUrl) return;
    this.recording(null); this.win.URL.revokeObjectURL(this.recordingUrl); this.recordingUrl = null;
  }

  dispose(): void { this.cancel(); this.clearRecording(); }

  cancel(target?: string): void {
    if (target && target !== this.active) return;
    const previous = this.active;
    this.generation++;
    if (this.abort) this.abort.abort();
    this.abort = null;
    if (this.recorder && this.recorder.state !== "inactive") this.recorder.stop();
    this.recorder = null;
    if (this.stream) for (const track of this.stream.getTracks()) track.stop();
    this.stream = null; this.active = null; this.phase = "idle";
    if (previous) this.update(previous, "idle");
  }

  async toggle(target: string): Promise<void> {
    if (this.active === target && this.phase === "recording") {
      const recorder = this.recorder;
      this.phase = "transcribing"; this.update(target, this.phase);
      if (recorder && recorder.state !== "inactive") recorder.stop();
      if (this.stream) for (const track of this.stream.getTracks()) track.stop();
      this.stream = null;
      return;
    }
    if (this.active === target && this.phase === "permission") { this.cancel(); return; }
    if (this.phase === "transcribing") return;
    this.cancel();
    if (target === "dojo") this.clearRecording();
    const generation = ++this.generation;
    this.active = target; this.phase = "permission"; this.update(target, this.phase);
    try {
      if (!this.win.navigator.mediaDevices || !this.win.navigator.mediaDevices.getUserMedia || !this.win.MediaRecorder) throw new Error("当前环境无法使用麦克风录音");
      const stream = await this.win.navigator.mediaDevices.getUserMedia({ audio: true });
      if (generation !== this.generation) { for (const track of stream.getTracks()) track.stop(); return; }
      this.stream = stream;
      const recorder = new this.win.MediaRecorder(stream);
      this.recorder = recorder;
      const chunks: Blob[] = [];
      recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      recorder.onerror = () => { if (generation === this.generation) { this.cancel(); this.fail("录音失败，请检查麦克风"); } };
      recorder.onstop = () => { void (async () => {
        if (generation !== this.generation) return;
        try {
          const mime = (recorder.mimeType || (chunks[0] && chunks[0].type) || "audio/webm").split(";")[0]!.trim().toLowerCase();
          const blob = new this.win.Blob(chunks, { type: mime });
          if (!blob.size) throw new Error("录音为空，请重试");
          if (target === "dojo") { this.recordingUrl = this.win.URL.createObjectURL(blob); this.recording(this.recordingUrl); }
          const bytes = new Uint8Array(await blob.arrayBuffer());
          if (generation !== this.generation) return;
          const abort = new AbortController(); this.abort = abort;
          const result = await this.transcribe(bytes, mime, abort.signal);
          if (generation !== this.generation) return;
          this.result(target, result.text);
          this.cancel();
        } catch (error) { if (generation === this.generation) { this.cancel(); this.fail(`语音识别失败：${error instanceof Error ? error.message : String(error)}`); } }
      })(); };
      recorder.start(); this.phase = "recording"; this.update(target, this.phase);
    } catch (error) { if (generation === this.generation) { this.cancel(); this.fail(`无法录音：${error instanceof Error ? error.message : String(error)}`); } }
  }
}
