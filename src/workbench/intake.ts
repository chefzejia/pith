import { normalizeRepositoryUrl, type GuideTurn, type Material, type Topic, type TurnOptions } from "../core/index.ts";
import { groupMaterialFiles } from "./importMaterial.ts";
import { pithIcon } from "./icons.ts";
import { guideThoughtMarkup } from "./view/guide.ts";

export interface IntakePorts {
  importFiles(files: File[]): Promise<Material>;
  importUrl(url: string, signal?: AbortSignal): Promise<Material>;
  importRepository(path: string, signal?: AbortSignal): Promise<{ material: Material; description: string }>;
  intake(input: { text: string; materialIds: readonly string[]; previous?: readonly GuideTurn[] }, options: TurnOptions): Promise<{ topic: Topic | null; turn: GuideTurn }>;
}
export interface IntakeActions {
  ports: IntakePorts;
  guideAvailable: boolean;
  settings?(): void;
  topic(topic: Topic): Promise<void>;
  fed(materials: readonly Material[]): Promise<void>;
  changed?(): Promise<void>;
  materials?: readonly Material[];
  requireGoal?: boolean;
}

export function splitIntakeText(text: string): { goal: string; repositories: string[]; urls: string[] } {
  const repositories: string[] = [], urls: string[] = [];
  let goal = text.trim().replace(/"((?:[^"\\]|\\.)+)"/g, (match, path: string) => {
    const decoded = path.replace(/\\(["\\])/g, "$1");
    if (!/^(?:\/|~\/|[a-z]:[\\/])/i.test(decoded)) return match;
    repositories.push(decoded); return " ";
  });
  goal = goal.replace(/(?:https?:\/\/|git@github\.com:)\S+/gi, url => { if (normalizeRepositoryUrl(url)) repositories.push(url); else if (/^https?:/i.test(url)) urls.push(url); else return url; return " "; }).trim();
  // The repository port resolves a bare path (including spaces) and its trailing goal.
  if (/^(?:\/|~\/|[a-z]:[\\/])/i.test(goal)) { repositories.push(goal); goal = ""; }
  goal = goal.replace(/\s+/g, " ");
  return { goal, repositories: [...new Set(repositories)], urls: [...new Set(urls)] };
}

/** Keeps imported materials across questions, failures and retries; import never depends on a guide. */
export class IntakeSession {
  readonly materials = new Map<string, Material>();
  previous: GuideTurn[] = [];
  private readonly imports = new Map<string | File, { material: Material; description?: string }>();
  private readonly ports: IntakePorts;
  constructor(ports: IntakePorts, materials: readonly Material[] = []) { this.ports = ports; for (const material of materials) this.materials.set(material.id, material); }
  async prepare(text: string, files: readonly File[], imported: () => Promise<void>, signal?: AbortSignal, progress?: (message: string) => void): Promise<string> {
    const input = splitIntakeText(text), descriptions: string[] = [];
    const keep = async (key: string | File, create: () => Promise<{ material: Material; description?: string }>) => {
      signal?.throwIfAborted();
      let result = this.imports.get(key);
      if (!result) { result = await create(); this.imports.set(key, result); await imported(); }
      this.materials.set(result.material.id, result.material);
      if (result.description) descriptions.push(result.description);
    };
    for (const path of input.repositories) { progress?.(normalizeRepositoryUrl(path) ? `正在克隆仓库 ${path}…` : `正在读取仓库 ${path}…`); await keep(`repo:${path}`, () => this.ports.importRepository(path, signal)); }
    for (const url of input.urls) { progress?.(`正在导入 ${url}…`); await keep(`url:${url}`, async () => ({ material: await this.ports.importUrl(url, signal) })); }
    for (const group of groupMaterialFiles(files)) await keep(group[0]!, async () => ({ material: await this.ports.importFiles(group) }));
    return [input.goal, ...descriptions].filter(Boolean).join("\n");
  }
  async ask(text: string, options: TurnOptions, changed?: () => Promise<void>): Promise<{ topic: Topic | null; turn: GuideTurn }> {
    const observed = new Set<string>();
    let refresh = Promise.resolve();
    const observeMaterials = (turn: GuideTurn) => {
      if (!changed) return;
      let added = false;
      for (const step of turn.steps) {
        if (step.kind !== "tool") continue;
        for (const effect of step.effects) {
          if (effect.kind !== "material" || observed.has(effect.materialId)) continue;
          observed.add(effect.materialId);
          added = true;
        }
      }
      if (added) refresh = refresh.then(changed).catch(error => console.error("Intake library refresh failed", error));
    };
    try {
      const result = await this.ports.intake({ text, materialIds: [...this.materials.keys()], previous: this.previous }, {
        ...options,
        onUpdate: turn => { observeMaterials(turn); options.onUpdate?.(turn); },
      });
      observeMaterials(result.turn);
      if (!result.topic && result.turn.status === "completed") this.previous.push(result.turn);
      return result;
    } finally { await refresh; }
  }
}

export function renderIntakeTurn(root: HTMLElement, turn: GuideTurn): void {
  const previous = root.dataset.intakeTurn === turn.id ? Array.from(root.children) : [];
  root.dataset.intakeTurn = turn.id;
  root.replaceChildren();
  for (const [index, step] of turn.steps.entries()) {
    const row = root.ownerDocument.createElement("div"); row.className = "pith-intake-step";
    if (step.kind === "thought") row.innerHTML = guideThoughtMarkup(step.text, Boolean(previous[index]?.querySelector(".pith-guide-thought[open]")));
    else row.textContent = step.kind === "reply" ? step.markdown : `${step.name} · ${step.status === "running" ? "进行中" : step.status === "completed" ? "完成" : "失败"}${step.summary ? ` · ${step.summary}` : ""}`;
    root.append(row);
  }
}

export function mountIntake(root: HTMLElement, actions: IntakeActions, placeholder = "说出想搞懂的问题，或拖入文件、贴入链接与本地仓库路径…"): { dispose(): void; setGuideAvailable(available: boolean): void } {
  const doc = root.ownerDocument, session = new IntakeSession(actions.ports, actions.materials);
  root.innerHTML = `<form class="pith-intake-box"><div class="pith-intake-row"><button type="button" data-intake-files aria-label="添加文件">${pithIcon("plus")}</button><input type="file" multiple hidden><input name="title" aria-label="目标或材料"><button type="submit" data-intake-open aria-label="提交">${pithIcon("arrow-up")}</button></div><div data-intake-selected class="pith-intake-selected"></div><div class="pith-intake-process" aria-live="polite"></div><div class="pith-home-status" role="status"></div></form>`;
  const form = root.querySelector("form")!, input = root.querySelector<HTMLInputElement>('[name="title"]')!, picker = root.querySelector<HTMLInputElement>('[type="file"]')!, submit = root.querySelector<HTMLButtonElement>('[data-intake-open]')!, add = root.querySelector<HTMLButtonElement>('[data-intake-files]')!, status = root.querySelector<HTMLElement>('[role="status"]')!, process = root.querySelector<HTMLElement>('.pith-intake-process')!, chips = root.querySelector<HTMLElement>('[data-intake-selected]')!;
  input.placeholder = placeholder;
  let selected: File[] = [], controller: AbortController | undefined, disposed = false;
  let resolvedGoal: { input: string; text: string } | undefined;
  const showChips = () => {
    chips.replaceChildren();
    const chip = (label: string, remove: () => void) => { const span = doc.createElement("span"), button = doc.createElement("button"); span.className = "pith-intake-chip"; span.append(label); button.type = "button"; button.setAttribute("aria-label", `移除 ${label}`); button.innerHTML = pithIcon("close"); button.disabled = Boolean(controller); button.onclick = () => { remove(); showChips(); update(); }; span.append(button); chips.append(span); };
    for (const material of session.materials.values()) chip(material.title, () => session.materials.delete(material.id));
    selected.forEach((file, i) => chip(file.name, () => selected.splice(i, 1)));
  };
  const update = (keepStatus = false) => {
    const goal = resolvedGoal?.input === input.value ? resolvedGoal.text : splitIntakeText(input.value).goal;
    submit.disabled = !controller && Boolean(goal && !actions.guideAvailable);
    if (!controller && goal && !actions.guideAvailable) {
      status.textContent = "向导未连接，无法立项。只投喂材料仍可使用。";
      if (actions.settings) { const button = doc.createElement("button"); button.type = "button"; button.textContent = "设置向导"; button.onclick = actions.settings; status.append(" ", button); }
    } else if (!controller && !keepStatus) status.textContent = "";
  };
  picker.onchange = () => { selected.push(...Array.from(picker.files ?? [])); picker.value = ""; showChips(); update(); };
  add.onclick = () => picker.click(); input.oninput = () => { resolvedGoal = undefined; update(); };
  form.ondragover = event => event.preventDefault();
  form.ondrop = event => { event.preventDefault(); if (!controller) { selected.push(...Array.from(event.dataTransfer?.files ?? [])); showChips(); update(); } };
  form.onsubmit = event => {
    event.preventDefault();
    if (controller) { controller.abort(); status.textContent = "正在停止…"; return; }
    const original = input.value;
    if (!original.trim() && !selected.length && !session.materials.size) { status.textContent = "请输入目标或添加材料"; return; }
    controller = new AbortController(); const signal = controller.signal;
    input.disabled = add.disabled = true; submit.disabled = false; submit.innerHTML = pithIcon("stop"); submit.setAttribute("aria-label", "停止"); status.textContent = "正在导入材料…"; showChips();
    void (async () => {
      try {
        const goal = await session.prepare(original, selected, async () => { if (actions.changed) await actions.changed(); }, signal, message => { if (!disposed) status.textContent = message; });
        selected = []; resolvedGoal = { input: original, text: goal };
        if (signal.aborted) throw new Error("已停止；已导入的材料保留在材料库");
        if (!goal) { if (session.previous.length || actions.requireGoal) { status.textContent = "请输入你想搞懂的问题"; return; } await actions.fed([...session.materials.values()]); return; }
        if (!actions.guideAvailable) throw new Error("向导未连接；已导入的材料保留在材料库，请先在设置中连接向导");
        status.textContent = "向导正在立项…";
        const result = await session.ask(goal, { signal, onUpdate: turn => { if (!disposed) renderIntakeTurn(process, turn); } }, actions.changed);
        if (disposed) return;
        renderIntakeTurn(process, result.turn);
        // A topic tool may already have committed before a late interruption; the frozen engine returns that durable topic.
        if (result.topic) { await actions.topic(result.topic); return; }
        if (result.turn.status !== "completed") throw new Error(result.turn.error || (result.turn.status === "stopped" ? "已停止" : "立项失败"));
        selected = []; input.value = ""; input.placeholder = "继续提问…"; status.textContent = "";
      } catch (error) { if (!disposed) { input.value = original; status.textContent = signal.aborted ? "已停止" : error instanceof Error ? error.message : String(error); } }
      finally { controller = undefined; if (!disposed) { input.disabled = add.disabled = false; submit.disabled = false; submit.innerHTML = pithIcon("arrow-up"); submit.setAttribute("aria-label", "提交"); showChips(); update(true); } }
    })();
  };
  showChips(); update();
  return { dispose() { disposed = true; controller?.abort(); }, setGuideAvailable(available) { actions.guideAvailable = available; update(); } };
}
