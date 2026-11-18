import type { MaterialReading } from "./readingState.ts";
import { lessonIsOutdated, lessonRepositoryMaterials, materialVersionGroups, type AnchorSource, type Material, type RenderedDocumentView, type Topic } from "../core/index.ts";
import { parseCurriculumOutline, type CurriculumItem } from "../plugins/stage-reader/pagination.ts";
import { emptyMaterialHtml } from "./repositoryIntake.ts";
import type { ObsidianReaderDocument } from "./view.ts";

export type SessionDocument = Pick<RenderedDocumentView, "html" | "sections"> & { text?: string; format?: RenderedDocumentView["format"]; mediaFile?: string | null };
export interface SessionState {
  readonly readings?: Readonly<Record<string, MaterialReading>>;
  readonly topic: Topic | null;
  readonly materials: readonly Material[];
  readonly libraryMaterials?: readonly Material[];
  readonly repositoryFiles: Readonly<Record<string, readonly string[]>>;
}
export interface MaterialSessionAdapter {
  title: string;
  active(): boolean;
  loadState(): Promise<SessionState>;
  readFile(source: AnchorSource, name: string): Promise<SessionDocument>;
  readOutline(): Promise<string | undefined>;
  render(document: ObsidianReaderDocument): void;
  updateNavigation(files: ObsidianReaderDocument["files"], curriculum: readonly CurriculumItem[] | undefined, groups: NonNullable<ObsidianReaderDocument["materialGroups"]>): void;
  afterOpen?(): Promise<void>;
  beforeLesson(title: string): Promise<void>;
  sendLesson(name: string, title: string): Promise<void>;
  afterLesson?(): Promise<void>;
}

export class MaterialSession {
  file = "";
  source: AnchorSource | undefined;
  private state: SessionState;
  private generation = 0;
  private disposed = false;
  private readonly adapter: MaterialSessionAdapter;
  constructor(state: SessionState, adapter: MaterialSessionAdapter) { this.state = state; this.adapter = adapter; }
  get material(): Material | undefined { const source = this.source; return source?.kind === "material" ? this.state.materials.find(material => material.id === source.materialId) : undefined; }
  private active(): boolean { return !this.disposed && this.adapter.active(); }
  private firstFile(material: Material): string | undefined {
    const names = material.kind === "repo" ? this.state.repositoryFiles[material.id] ?? [] : material.files.map(file => file.name);
    const reading = this.state.readings?.[material.id];
    if (reading && names.includes(reading.file)) return reading.file;
    return material.kind === "repo" ? names[0] : [...material.files].sort((a, b) => (b.lastActiveAt ?? "").localeCompare(a.lastActiveAt ?? ""))[0]?.name;
  }
  private groups(): NonNullable<ObsidianReaderDocument["materialGroups"]> {
    return this.state.materials.map(material => {
      const available = materialVersionGroups(this.state.libraryMaterials ?? this.state.materials).find(group => group.latest.kind === "repo" && group.latest.externalPath === material.externalPath)?.latest;
      const newer = available && !this.state.materials.some(item => item.id === available.id) && available.createdAt > material.createdAt ? available : undefined;
      return { id: material.id, title: material.title, kind: material.kind, externalPath: material.externalPath, commitSha: material.commitSha, createdAt: material.createdAt,
        basedLessons: (this.state.topic?.lessons ?? []).filter(lesson => lessonRepositoryMaterials(lesson, this.state.materials).some(item => item.id === material.id)).map(lesson => lesson.name),
        ...(newer?.commitSha ? { newerVersion: { id: newer.id, commitSha: newer.commitSha } } : {}), files: material.kind === "repo" ? (this.state.repositoryFiles[material.id] ?? []).map(name => ({ name })) : material.files };
    });
  }
  private async navigation(): Promise<{ files: ObsidianReaderDocument["files"]; curriculum: readonly CurriculumItem[] | undefined; groups: NonNullable<ObsidianReaderDocument["materialGroups"]> }> {
    const files = (this.state.topic?.lessons ?? []).map(lesson => ({ name: lesson.name, basedOn: lessonRepositoryMaterials(lesson, this.state.materials).map(material => material.id), outdated: lessonIsOutdated(lesson, this.state.materials) })), outline = await this.adapter.readOutline();
    return { files, curriculum: outline === undefined ? undefined : parseCurriculumOutline(outline, files.map(file => file.name)), groups: this.groups() };
  }
  async openFile(name: string, source = this.source): Promise<void> {
    if (!source) throw new Error("文件来源不存在");
    const request = ++this.generation, state = await this.adapter.loadState();
    if (!this.active() || request !== this.generation) return;
    this.state = state;
    const document = await this.adapter.readFile(source, name), navigation = await this.navigation();
    if (!this.active() || request !== this.generation) return;
    this.file = name; this.source = source;
    const reading = source.kind === "material" ? this.state.readings?.[source.materialId] : undefined;
    const locator = source.kind === "lesson" ? this.state.topic?.lessons.find(file => file.name === name)?.locator : reading?.file === name && reading.locator !== undefined ? reading.locator : this.material?.files.find(file => file.name === name)?.locator;
    this.adapter.render({ title: this.adapter.title, html: document.html, sections: document.sections, files: navigation.files, mediaFiles: this.material?.files ?? [], currentFile: name, source, materialGroups: navigation.groups, materialNotes: this.state.topic && this.material ? { materialId: this.material.id, title: this.material.title, notes: this.material.notes } : undefined, materialAids: this.material?.aids ?? [], locator, ...(document.format ? { format: document.format } : {}), ...(document.mediaFile !== undefined ? { mediaFile: document.mediaFile } : {}), ...(navigation.curriculum ? { curriculum: navigation.curriculum } : {}) });
    if (this.adapter.afterOpen) await this.adapter.afterOpen();
  }
  async open(): Promise<void> {
    if (!this.active()) return;
    const lesson = [...(this.state.topic?.lessons ?? [])].sort((a, b) => (b.lastActiveAt ?? "").localeCompare(a.lastActiveAt ?? ""))[0];
    if (lesson) return this.openFile(lesson.name, { kind: "lesson" });
    const material = materialVersionGroups(this.state.materials)[0]?.latest, first = material && this.firstFile(material);
    if (material && first) return this.openFile(first, { kind: "material", materialId: material.id });
    const navigation = await this.navigation();
    this.adapter.render({ title: this.adapter.title, html: emptyMaterialHtml(material), sections: [], files: navigation.files, currentFile: "", materialGroups: navigation.groups, ...(navigation.curriculum ? { curriculum: navigation.curriculum } : {}) });
    if (this.adapter.afterOpen) await this.adapter.afterOpen();
  }
  async openMaterial(id: string): Promise<void> {
    const material = this.state.materials.find(item => item.id === id);
    if (!material) throw new Error("材料不存在");
    const first = this.firstFile(material);
    if (!first) throw new Error("材料没有可打开的文件");
    await this.openFile(first, { kind: "material", materialId: id });
  }
  async refresh(): Promise<void> {
    const request = this.generation, previous = this.state, next = await this.adapter.loadState();
    if (!this.active() || request !== this.generation) return;
    this.state = next;
    const navigation = await this.navigation();
    if (!this.active() || request !== this.generation) return;
    this.adapter.updateNavigation(navigation.files, navigation.curriculum, navigation.groups);
    if (!this.file && ((next.topic?.lessons ?? []).length || next.materials.some(material => material.files.length || next.repositoryFiles[material.id]?.length))) await this.open();
    else if (this.source?.kind === "lesson" && next.topic?.lessons.some(lesson => lesson.name === this.file) && JSON.stringify(previous.topic?.lessons.find(lesson => lesson.name === this.file)) !== JSON.stringify(next.topic?.lessons.find(lesson => lesson.name === this.file))) await this.openFile(this.file, this.source);
  }
  async generateLesson(name: string, title: string): Promise<void> {
    const request = ++this.generation, previous = this.file, source = this.source;
    try {
      await this.adapter.beforeLesson(title); if (!this.active() || request !== this.generation) return;
      await this.adapter.sendLesson(name, title);
      const next = await this.adapter.loadState(); if (!this.active()) return;
      this.state = next; const navigation = await this.navigation();
      if (!this.active()) return;
      this.adapter.updateNavigation(navigation.files, navigation.curriculum, navigation.groups);
      if (request !== this.generation) return;
      if (!(next.topic?.lessons ?? []).some(lesson => lesson.name === name)) throw new Error(`讲义未保存：${name}`);
      await this.openFile(name, { kind: "lesson" }); if (this.adapter.afterLesson) await this.adapter.afterLesson();
    } catch (error) {
      if (!this.active() || request !== this.generation) return;
      if (previous && source) await this.openFile(previous, source);
      throw error;
    }
  }
  dispose(): void { this.disposed = true; this.generation++; }
}
