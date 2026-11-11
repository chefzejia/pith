import type { Material, RenderedDocumentView } from "../core/index.ts";
import { parseCurriculumOutline, type CurriculumItem } from "../plugins/stage-reader/pagination.ts";
import { emptyMaterialHtml } from "./repositoryIntake.ts";
import type { ObsidianReaderDocument } from "./view.ts";

export type SessionDocument = Pick<RenderedDocumentView, "html" | "sections"> & { text?: string; format?: RenderedDocumentView["format"]; mediaFile?: string | null };

export interface MaterialSessionAdapter {
  title: string;
  active(): boolean;
  loadMaterial(): Promise<Material | undefined>;
  readFile(material: Material, name: string): Promise<SessionDocument>;
  readOutline(material: Material, name?: string, document?: SessionDocument): Promise<string | undefined>;
  render(document: ObsidianReaderDocument): void;
  updateNavigation(files: Material["files"], curriculum: readonly CurriculumItem[] | undefined): void;
  afterOpen?(): Promise<void>;
  beforeLesson(title: string): Promise<void>;
  sendLesson(name: string, title: string): Promise<void>;
  afterLesson?(): Promise<void>;
}

export class MaterialSession {
  material: Material | undefined;
  file = "";
  private generation = 0;
  private materialGeneration = 0;
  private lessonRequest: number | null = null;
  private disposed = false;
  private readonly adapter: MaterialSessionAdapter;
  constructor(material: Material | undefined, adapter: MaterialSessionAdapter) { this.material = material; this.adapter = adapter; }
  private active(): boolean { return !this.disposed && this.adapter.active(); }
  private curriculum(material: Material, text: string | undefined): readonly CurriculumItem[] | undefined { return text === undefined ? undefined : parseCurriculumOutline(text, material.files.map(file => file.name)); }
  async openFile(name: string): Promise<void> {
    this.lessonRequest = null; const material = this.material; if (!material) throw new Error("材料不存在");
    const request = ++this.generation, document = await this.adapter.readFile(material, name);
    const outline = await this.adapter.readOutline(material, name, document);
    if (!this.active() || request !== this.generation) return;
    this.file = name; this.adapter.render({ title: this.adapter.title, html: document.html, sections: document.sections, files: material.files, currentFile: name, ...(document.format ? { format: document.format } : {}), ...(document.mediaFile !== undefined ? { mediaFile: document.mediaFile } : {}), ...(outline !== undefined ? { curriculum: this.curriculum(material, outline) } : {}) });
    if (this.adapter.afterOpen) await this.adapter.afterOpen();
  }
  async open(): Promise<void> {
    if (!this.active()) return;
    if (this.material?.files.length) return this.openFile(this.material.files[0]!.name);
    this.adapter.render({ title: this.adapter.title, html: emptyMaterialHtml(this.material), sections: [], files: [], currentFile: "" });
    if (this.adapter.afterOpen) await this.adapter.afterOpen();
  }
  async refresh(): Promise<void> {
    const request = this.generation; if (this.lessonRequest !== null) return;
    const next = await this.adapter.loadMaterial();
    if (!this.active() || request !== this.generation || this.lessonRequest !== null) return;
    if (JSON.stringify(this.material) === JSON.stringify(next)) return;
    const previousFiles = new Set(this.material?.id === next?.id ? this.material?.files.map(file => file.name) : []);
    const newSubtitle = next?.files.find(file => /\.vtt$/i.test(file.name) && !previousFiles.has(file.name));
    this.material = next;
    const file = newSubtitle || next?.files.find(item => item.name === this.file) || next?.files.find(item => item.name === "00-课程大纲.md") || next?.files[0];
    if (file && this.active()) await this.openFile(file.name);
  }
  async generateLesson(name: string, title: string): Promise<void> {
    const request = ++this.generation, previous = this.file; let opening = false; this.lessonRequest = request;
    try {
      await this.adapter.beforeLesson(title); if (!this.active() || request !== this.generation) return;
      await this.adapter.sendLesson(name, title); if (!this.active()) return;
      const refresh = ++this.materialGeneration, material = await this.adapter.loadMaterial();
      if (!this.active() || refresh !== this.materialGeneration) return;
      if (material) {
        const outline = await this.adapter.readOutline(material);
        if (!this.active() || refresh !== this.materialGeneration) return;
        this.material = material; this.adapter.updateNavigation(material.files, this.curriculum(material, outline));
      }
      if (request !== this.generation) return;
      if (!material || !material.files.some(file => file.name === name)) throw new Error(`讲义未保存：${name}`);
      opening = true; await this.openFile(name); if (this.adapter.afterLesson) await this.adapter.afterLesson();
    } catch (error) {
      if (!this.active() || this.generation !== request + (opening ? 1 : 0)) return;
      if (previous) await this.openFile(previous);
      throw error;
    } finally { if (this.lessonRequest === request) this.lessonRequest = null; }
  }
  dispose(): void { this.disposed = true; this.generation++; }
}
