import { mountPithWorkbench, type PithWorkbenchView } from "../../workbench/index.ts";
import { shadowingToolkit } from "../../plugins/toolkit-shadowing/index.ts";
import { feynmanToolkit } from "../../plugins/toolkit-feynman/index.ts";
import { interlineToolkit } from "../../plugins/toolkit-interline/index.ts";
import type { GuideTurn, GuideQuickAction, Material, SelectionAnchor, Topic } from "../../core/index.ts";
import type { InterlineViewUnit } from "../../plugins/toolkit-interline/index.ts";
import { MaterialSession, type SessionDocument } from "../../workbench/materialSession.ts";

type Request = <T>(path: string, data?: unknown) => Promise<T>;

export interface WebWorkbenchOptions {
  root: HTMLElement;
  topic: Topic;
  material: Material | undefined;
  request: Request;
  guideAvailable: boolean;
  guideVisible: boolean;
  home(): void;
  settings(): void;
  importMaterial(): void;
  visibility(visible: boolean): void;
  report(error: unknown): void;
}

export class WebWorkbench {
  private readonly view: PithWorkbenchView;
  private readonly options: WebWorkbenchOptions;
  private readonly session: MaterialSession;
  private readonly streamTurn: (data: Record<string, unknown>) => Promise<GuideTurn | undefined>;
  private disposed = false;

  constructor(options: WebWorkbenchOptions) {
    this.options = options;
    const topicId = options.topic.id;
    const toolkits = [shadowingToolkit, feynmanToolkit, interlineToolkit];
    const streamTurn = async (data: Record<string, unknown>) => {
      const response = await fetch("/api/chat", { method: "POST", headers: { "content-type": "application/json", accept: "text/event-stream" }, body: JSON.stringify({ topicId, ...data }) });
      if (!response.ok) {
        const payload: unknown = await response.json().catch(() => null);
        const reason = payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string" ? payload.error : `向导请求失败 (${response.status})`;
        throw new Error(reason);
      }
      if (!response.body) throw new Error("向导响应没有数据流");
      const reader = response.body.getReader(), decoder = new TextDecoder(); let buffer = "", latest: GuideTurn | undefined;
      for (;;) {
        const chunk = await reader.read(); buffer += decoder.decode(chunk.value, { stream: !chunk.done });
        let end: number;
        while ((end = buffer.indexOf("\n\n")) >= 0) {
          const event = buffer.slice(0, end); buffer = buffer.slice(end + 2);
          const dataLine = event.split("\n").find(line => line.startsWith("data: "));
          if (!dataLine) continue;
          const value: unknown = JSON.parse(dataLine.slice(6));
          if (event.startsWith("event: error")) throw new Error(String(value));
          latest = value as GuideTurn; this.view.updateGuideTurn(latest);
        }
        if (chunk.done) break;
      }
      if (!latest || latest.status === "running") throw new Error("向导响应中断");
      return latest;
    };
    this.streamTurn = streamTurn;
    const postAudio = async (path: string, data: unknown, signal: AbortSignal): Promise<Response> => {
      const response = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data), signal });
      if (!response.ok) {
        const result: unknown = await response.json();
        throw new Error(result && typeof result === "object" && "error" in result ? String(result.error) : `HTTP ${response.status}`);
      }
      return response;
    };
    this.view = mountPithWorkbench(options.root, {
      autoInterline: options.topic.toolkitsOrigin === "default" && options.topic.toolkits.length === 1 && options.topic.toolkits[0] === "interline",
      home: options.home,
      openSettings: options.settings,
      importMaterial: options.importMaterial,
      openFile: name => this.session.openFile(name),
      generateLesson: (name, title) => { if (!options.guideAvailable) throw new Error("向导不可用，无法生成讲义"); return this.session.generateLesson(name, title); },
      openToolkit: (text, locator) => this.view.openToolkit(toolkits, text, text === undefined ? undefined : { file: this.session.file, locator: locator || "text:offset:0", quote: text }),
      selection: (action, text, locator) => {
        const anchor = { file: this.session.file, locator: locator || "text:offset:0", quote: text };
        if (action !== "highlight") { this.view.quoteSelection(anchor, action === "ask" ? "chat" : "notes"); return; }
        void options.request("/api/notes", { topicId, kind: "highlight", body: text, anchor }).then(() => this.view.refreshGuide()).catch(options.report);
      },
      guideVisibilityChanged: visible => { this.updateGuideLayout(visible); options.visibility(visible); },
      guideData: async () => {
        const [state, conversation] = await Promise.all([
          options.request<{ compass: { exploring: readonly Topic[]; settled: readonly Topic[] } }>("/api/state"),
          options.request<readonly GuideTurn[]>(`/api/chat?topicId=${encodeURIComponent(topicId)}`),
        ]);
        const topic = [...state.compass.exploring, ...state.compass.settled].find(item => item.id === topicId);
        if (!topic) throw new Error("课题不存在");
        const actions = options.guideAvailable ? await options.request<readonly GuideQuickAction[]>(`/api/topics/${encodeURIComponent(topicId)}/actions`) : [];
        return { notes: topic.notes, toolkits: topic.toolkits, conversation, actions };
      },
      sendGuide: async (text, anchor, saveAsNote) => { if (saveAsNote) await options.request("/api/notes", { topicId, kind: "note", body: text, anchor }); else { await streamTurn({ text, anchor }); await this.session.refresh(); } },
      stopGuide: async () => { await options.request("/api/chat/stop", { topicId }); },
      retryGuide: async turnId => { await streamTurn({ turnId }); await this.session.refresh(); },
      toggleToolkit: async (id, enabled) => { if (!toolkits.some(toolkit => toolkit.id === id)) throw new Error("Invalid toolkit ID"); const state = await options.request<{ compass: { exploring: readonly Topic[]; settled: readonly Topic[] } }>("/api/state"); const topic = [...state.compass.exploring, ...state.compass.settled].find(item => item.id === topicId); if (!topic) throw new Error("课题不存在"); const selected = topic.toolkits.filter(item => item !== id); if (enabled) selected.push(id); const updated = await options.request<Topic>(`/api/topics/${encodeURIComponent(topicId)}/toolkits`, { toolkits: selected }); this.view.setToolkits(updated.toolkits); },
      savePractice: async (body, anchor) => { await options.request("/api/notes", { topicId, kind: "practice", body, anchor }); },
      submitPractice: async (body, anchor, toolkit) => { await options.request("/api/notes", { topicId, kind: "practice", body, anchor }); if (!options.guideAvailable) return { guided: false }; if (!toolkit.evaluationRubric) throw new Error("实训评价规程不可用"); const turn = await streamTurn({ text: body, instruction: toolkit.evaluationRubric, anchor }); return { guided: turn?.status === "completed", ...(turn?.error ? { guideError: turn.error } : {}) }; },
      prepareInterline: async (units: readonly InterlineViewUnit[], index, mode) => options.request<{ html: string; status: string; error?: string }>("/api/interline", { topicId, file: this.session.file, units, index, mode }),
      synthesizeSpeech: async (text, signal) => { const response = await postAudio("/api/speech/synthesize", { text }, signal); return { bytes: new Uint8Array(await response.arrayBuffer()), mimeType: response.headers.get("content-type") || "audio/wav" }; },
      transcribeAudio: async (bytes, mimeType, signal) => { let binary = ""; for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768)); const response = await postAudio("/api/speech/transcribe", { audio: btoa(binary), mimeType }, signal ?? new AbortController().signal); return response.json() as Promise<{ text: string }>; },
      loadAudio: async name => { if (!this.session.material) throw new Error("材料不存在"); const response = await fetch(`/api/materials/${encodeURIComponent(this.session.material.id)}/raw?name=${encodeURIComponent(name)}`); if (!response.ok) throw new Error(`HTTP ${response.status}`); return new Uint8Array(await response.arrayBuffer()); },
    });
    const fileUrl = (material: Material, file: string) => `/api/materials/file?id=${encodeURIComponent(material.id)}&name=${encodeURIComponent(file)}`;
    this.session = new MaterialSession(options.material, {
      title: options.topic.title, active: () => !this.disposed,
      loadMaterial: async () => { const state = await options.request<{ compass: { exploring: readonly Topic[]; settled: readonly Topic[] }; materials: readonly Material[] }>("/api/state"); const topic = [...state.compass.exploring, ...state.compass.settled].find(item => item.id === topicId); if (!topic) throw new Error("课题不存在"); return state.materials.find(item => item.id === topic.materialId); },
      readFile: (material, name) => options.request<SessionDocument>(fileUrl(material, name)),
      readOutline: async (material, name, document) => !material.files.some(file => file.name === "00-课程大纲.md") ? undefined : (name === "00-课程大纲.md" && document ? document : await options.request<SessionDocument>(fileUrl(material, "00-课程大纲.md"))).text || "",
      render: document => this.view.render(document), updateNavigation: (files, curriculum) => this.view.updateMaterialNavigation(files, curriculum), afterOpen: () => this.view.refreshGuide(),
      beforeLesson: async title => { this.view.showLessonLoading(title); this.view.setGuideVisible(true); this.updateGuideLayout(true); options.visibility(true); },
      sendLesson: async (name, title) => { const text = `请按照《00-课程大纲.md》的规划，结合我的学习者画像与源码/材料依据，撰写《${name}》（${title}）的完整讲义并调用 pith_write_lesson 保存。`; await this.view.guideTurn(text, () => streamTurn({ text })); },
    });
    this.view.setGuideAvailable(options.guideAvailable);
    this.view.setGuideVisible(options.guideAvailable && options.guideVisible);
    this.updateGuideLayout(options.guideAvailable && options.guideVisible);
    this.view.setToolkits(options.topic.toolkits);
  }

  private updateGuideLayout(visible: boolean): void {
    const layout = this.options.root.querySelector<HTMLElement>(".pith-layout");
    if (layout) layout.classList.toggle("pith-guide-closed", !visible);
  }

  async open(): Promise<void> { await this.session.open(); }

  async startCurriculum(prompt = ""): Promise<void> {
    this.view.setGuideVisible(true); this.updateGuideLayout(true); this.options.visibility(true);
    const text = prompt || "请结合我的学习目标和材料规划课程，生成《00-课程大纲.md》和第一讲讲义。";
    try { await this.view.guideTurn(text, () => this.streamTurn({ text })); await this.session.refresh(); await this.view.refreshGuide(); }
    catch (error) { this.options.report(error); }
  }

  dispose(): void { this.disposed = true; this.session.dispose(); this.view.dispose(); }
}
