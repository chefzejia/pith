import type { Material, SelectionAnchor } from "../core/index.ts";
import { MaterialSession, type SessionState, type SessionDocument } from "./materialSession.ts";
import { mountPithWorkbench, type ObsidianViewActions, type PithWorkbenchView } from "./view.ts";
import { mountIntake, type IntakeActions } from "./intake.ts";

export interface MaterialWorkbenchOptions {
  root: HTMLElement;
  state: SessionState;
  loadState(): Promise<SessionState>;
  readFile(name: string): Promise<SessionDocument>;
  capture(kind: "note" | "highlight", body: string, anchor?: SelectionAnchor): Promise<unknown>;
  setAids(aids: readonly string[]): Promise<unknown>;
  saveLocator(file: string, locator: string): Promise<void>;
  opened(file: string): Promise<void>;
  intake: IntakeActions;
  home(): void | Promise<void>;
  settings(): void;
  report(error: unknown): void;
  speech?: Pick<ObsidianViewActions, "loadAudio" | "synthesizeSpeech" | "prepareInterline">;
}

/** The standalone reader shares the same stage, with a material note owner and no training/chat channel. */
export class MaterialWorkbench {
  readonly view: PithWorkbenchView;
  readonly session: MaterialSession;
  private disposed = false;
  private intake: { dispose(): void } | undefined;
  private readonly options: MaterialWorkbenchOptions;
  constructor(options: MaterialWorkbenchOptions) {
    this.options = options;
    const material = options.state.materials[0]!;
    this.view = mountPithWorkbench(options.root, {
      scene: "material", guideAvailable: options.intake.guideAvailable, home: options.home, openSettings: options.settings,
      openFile: (name, source) => this.session.openFile(name, source), openToolkit: () => {},
      ...options.speech,
      startIntake: () => this.startIntake(material),
      setMaterialAids: async aids => { await options.setAids(aids); await this.session.refresh(); },
      saveLocator: locator => options.saveLocator(this.session.file, locator),
      selection: (action, text, locator) => {
        if (action === "ask") return;
        const anchor: SelectionAnchor = { source: { kind: "material", materialId: material.id }, file: this.session.file, locator: locator ?? "text:offset:0", quote: text };
        if (action === "note") { this.intake?.dispose(); this.intake = undefined; this.view.quoteSelection(anchor, "notes"); return; }
        void options.capture("highlight", text, anchor).then(() => this.view.refreshGuide()).catch(options.report);
      },
      guideData: async () => { const state = await options.loadState(); const material = state.materials[0]; if (!material) throw new Error("材料不存在"); return { notes: material.notes, toolkits: [], conversation: [], actions: [] }; },
      sendGuide: async (text, anchor) => { await options.capture("note", text, anchor); },
    });
    this.session = new MaterialSession(options.state, {
      title: material.title, active: () => !this.disposed, loadState: options.loadState,
      readFile: (_source, name) => options.readFile(name), readOutline: async () => undefined,
      render: document => this.view.render(document), updateNavigation: (files, curriculum, groups) => this.view.updateMaterialNavigation(files, curriculum, groups),
      afterOpen: async () => { await options.opened(this.session.file); await this.view.refreshGuide(); },
      beforeLesson: async () => { throw new Error("材料阅读没有讲义"); }, sendLesson: async () => { throw new Error("材料阅读没有讲义"); },
    });
    this.view.setGuideAvailable(options.intake.guideAvailable);
  }
  private startIntake(material: Material): void {
    this.intake?.dispose();
    const panel = this.view.guideElement(), doc = panel.ownerDocument;
    panel.replaceChildren();
    const header = doc.createElement("div"), title = doc.createElement("h2"), back = doc.createElement("button"), host = doc.createElement("div");
    header.className = "pith-material-intake-heading"; title.textContent = "以此立项"; back.textContent = "返回笔记"; back.onclick = () => { this.intake?.dispose(); this.intake = undefined; void this.view.refreshGuide().catch(this.options.report); };
    header.append(title, back); panel.append(header, host);
    this.intake = mountIntake(host, { ...this.options.intake, materials: [material], requireGoal: true }, "你想通过这份材料搞懂什么");
  }
  open(): Promise<void> { return this.session.open(); }
  dispose(): void { this.disposed = true; this.intake?.dispose(); this.session.dispose(); this.view.dispose(); }
}
