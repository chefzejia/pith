import { mountPithWorkbench, type PithWorkbenchView } from "../../workbench/index.ts";
import { shadowingToolkit } from "../../plugins/dojo-shadowing/index.ts";
import { feynmanToolkit } from "../../plugins/dojo-feynman/index.ts";
import { interlineToolkit } from "../../plugins/dojo-interline/index.ts";
import type { GuideConversationEntry, GuideQuickAction, Material, RenderedDocumentView, SelectionAnchor, Topic } from "../../core/index.ts";
import type { InterlineViewUnit } from "../../plugins/dojo-interline/index.ts";

type DocumentData = Pick<RenderedDocumentView, "html" | "sections"> & { format?: RenderedDocumentView["format"] };
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
  private material: Material | undefined;
  private file = "";
  private generation = 0;
  private disposed = false;

  constructor(options: WebWorkbenchOptions) {
    this.options = options;
    this.material = options.material;
    const topicId = options.topic.id;
    const dojos = [shadowingToolkit, feynmanToolkit, interlineToolkit];
    const postAudio = async (path: string, data: unknown, signal: AbortSignal): Promise<Response> => {
      const response = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data), signal });
      if (!response.ok) {
        const result: unknown = await response.json();
        throw new Error(result && typeof result === "object" && "error" in result ? String(result.error) : `HTTP ${response.status}`);
      }
      return response;
    };
    this.view = mountPithWorkbench(options.root, {
      home: options.home,
      openSettings: options.settings,
      importMaterial: options.importMaterial,
      openFile: name => this.openFile(name),
      openDojo: (text, locator) => this.view.openDojo(dojos, text, text === undefined ? undefined : { file: this.file, locator: locator || "text:offset:0", quote: text }),
      selection: (action, text, locator) => {
        const anchor = { file: this.file, locator: locator || "text:offset:0", quote: text };
        if (action !== "highlight") { this.view.quoteSelection(anchor, action === "ask" ? "chat" : "notes"); return; }
        void options.request("/api/notes", { topicId, kind: "highlight", body: text, anchor }).then(() => this.view.refreshGuide()).catch(options.report);
      },
      guideVisibilityChanged: visible => { this.updateGuideLayout(visible); options.visibility(visible); },
      guideData: async () => {
        const [state, conversation] = await Promise.all([
          options.request<{ compass: { exploring: readonly Topic[]; settled: readonly Topic[] } }>("/api/state"),
          options.request<readonly GuideConversationEntry[]>(`/api/chat?topicId=${encodeURIComponent(topicId)}`),
        ]);
        const topic = [...state.compass.exploring, ...state.compass.settled].find(item => item.id === topicId);
        if (!topic) throw new Error("课题不存在");
        const actions = options.guideAvailable ? await options.request<readonly GuideQuickAction[]>(`/api/topics/${encodeURIComponent(topicId)}/actions`) : [];
        return { notes: topic.notes, toolkits: topic.toolkits, conversation, actions };
      },
      sendGuide: async (text, anchor, saveAsNote) => { await options.request(saveAsNote ? "/api/notes" : "/api/chat", saveAsNote ? { topicId, kind: "note", body: text, anchor } : { topicId, text, anchor }); if (!saveAsNote) await this.refreshMaterial(); },
      toggleToolkit: async (id, enabled) => { const state = await options.request<{ compass: { exploring: readonly Topic[]; settled: readonly Topic[] } }>("/api/state"); const topic = [...state.compass.exploring, ...state.compass.settled].find(item => item.id === topicId); if (!topic) throw new Error("课题不存在"); const toolkits = topic.toolkits.filter(item => item !== id && item !== `dojo-${id}` && item !== "none"); if (enabled) toolkits.push(id); const updated = await options.request<Topic>(`/api/topics/${encodeURIComponent(topicId)}/toolkits`, { toolkits }); this.view.setToolkits(updated.toolkits); },
      savePractice: async (body, anchor) => { await options.request("/api/notes", { topicId, kind: "practice", body, anchor }); },
      submitPractice: async (body, anchor, toolkit) => options.request<{ guided: boolean; guideError?: string }>("/api/dojo/submit", { topicId, toolkit: toolkit.id, file: this.file, targetText: anchor.quote, producedText: body, anchor }),
      prepareInterline: async (units: readonly InterlineViewUnit[], index, mode) => options.request<{ html: string; status: string; error?: string }>("/api/interline", { topicId, file: this.file, units, index, mode }),
      synthesizeSpeech: async (text, signal) => { const response = await postAudio("/api/speech/synthesize", { text }, signal); return { bytes: new Uint8Array(await response.arrayBuffer()), mimeType: response.headers.get("content-type") || "audio/wav" }; },
      transcribeAudio: async (bytes, mimeType, signal) => { let binary = ""; for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768)); const response = await postAudio("/api/speech/transcribe", { audio: btoa(binary), mimeType }, signal ?? new AbortController().signal); return response.json() as Promise<{ text: string }>; },
      loadAudio: async name => { if (!this.material) throw new Error("材料不存在"); const response = await fetch(`/api/materials/${encodeURIComponent(this.material.id)}/raw?name=${encodeURIComponent(name)}`); if (!response.ok) throw new Error(`HTTP ${response.status}`); return new Uint8Array(await response.arrayBuffer()); },
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

  async openFile(name: string): Promise<void> {
    const material = this.material;
    if (!material) throw new Error("材料不存在");
    const request = ++this.generation;
    const data = await this.options.request<DocumentData>(`/api/materials/file?id=${encodeURIComponent(material.id)}&name=${encodeURIComponent(name)}`);
    if (this.disposed || request !== this.generation) return;
    this.file = name;
    this.view.render({ title: this.options.topic.title, html: data.html, sections: data.sections, files: material.files, currentFile: name, format: data.format });
    await this.view.refreshGuide();
  }

  async open(): Promise<void> {
    const material = this.material;
    if (material && material.files.length) return this.openFile(material.files[0]!.name);
    this.view.render({ title: this.options.topic.title, html: "<p>这个课题还没有关联材料。</p>", sections: [], files: [], currentFile: "" });
    await this.view.refreshGuide();
  }

  private async refreshMaterial(): Promise<void> {
    const state = await this.options.request<{ compass: { exploring: readonly Topic[]; settled: readonly Topic[] }; materials: readonly Material[] }>("/api/state");
    const topic = [...state.compass.exploring, ...state.compass.settled].find(item => item.id === this.options.topic.id);
    if (!topic) throw new Error("课题不存在");
    const next = state.materials.find(item => item.id === topic.materialId);
    if (JSON.stringify(this.material) === JSON.stringify(next)) return;
    this.material = next;
    const file = this.material?.files.find(item => item.name === this.file) || this.material?.files.find(item => item.name === "00-课程大纲.md") || this.material?.files[0];
    if (file && !this.disposed) await this.openFile(file.name);
  }

  async startCurriculum(prompt = ""): Promise<void> {
    this.view.setGuideVisible(true); this.updateGuideLayout(true); this.options.visibility(true);
    try { await this.options.request("/api/chat", { topicId: this.options.topic.id, text: prompt || "请结合我的学习目标和材料规划课程，生成《00-课程大纲.md》和第一讲讲义。" }); await this.refreshMaterial(); await this.view.refreshGuide(); }
    catch (error) { this.options.report(error); }
  }

  dispose(): void { this.disposed = true; this.generation++; this.view.dispose(); }
}
