import { normalizeRepositoryUrl, type Material } from "../core/index.ts";
import { groupMaterialFiles } from "./importMaterial.ts";
import { splitIntakeText, type IntakePorts } from "./intake.ts";
import { pithIcon } from "./icons.ts";

export function openMaterialPicker(root: HTMLElement, options: { library(): Promise<readonly Material[]>; referenced(): Promise<readonly string[]>; ports: IntakePorts; attach(id: string): Promise<void>; added(id: string): Promise<void> }): { dispose(): void } {
  const doc = root.ownerDocument, panel = doc.createElement("section"); panel.className = "pith-material-picker"; panel.setAttribute("aria-label", "添加材料");
  panel.innerHTML = `<header><h2>添加材料</h2><button data-picker-close aria-label="关闭添加材料">${pithIcon("close")}</button></header><button data-picker-files>选择文件</button><input type="file" multiple hidden><form><input aria-label="链接或仓库路径" placeholder="粘贴链接或本地仓库路径"><button>导入并引用</button></form><p role="status"></p><h3>从材料库选择</h3><div class="pith-material-picker-list"></div>`;
  root.append(panel); const abort = new AbortController(), status = panel.querySelector<HTMLElement>('[role="status"]')!, picker = panel.querySelector<HTMLInputElement>('[type="file"]')!;
  let busy = false, operation: AbortController | undefined;
  const submit = panel.querySelector<HTMLButtonElement>("form button")!, input = panel.querySelector<HTMLInputElement>("form input")!;
  const close = () => { if (!busy) { abort.abort(); panel.remove(); } };
  panel.querySelector<HTMLButtonElement>('[data-picker-close]')!.onclick = close;
  doc.addEventListener("keydown", event => { if (event.key === "Escape") close(); }, { signal: abort.signal });
  const refresh = async () => {
    const [materials, referenced] = await Promise.all([options.library(), options.referenced()]); if (!panel.isConnected) return;
    const list = panel.querySelector<HTMLElement>(".pith-material-picker-list")!; list.replaceChildren();
    for (const material of materials) { const button = doc.createElement("button"); button.textContent = material.title + (referenced.includes(material.id) ? " · 已引用" : ""); button.disabled = referenced.includes(material.id); button.onclick = () => { void run(async () => { await options.attach(material.id); await options.added(material.id); }); }; list.append(button); }
  };
  const run = async (action: (signal: AbortSignal) => Promise<void>) => {
    if (busy) return; busy = true; panel.querySelectorAll<HTMLButtonElement>("button").forEach(button => button.disabled = true); status.textContent = "正在添加…";
    operation = new AbortController(); const signal = operation.signal; input.disabled = true; submit.disabled = false; submit.textContent = "停止";
    try { await action(signal); signal.throwIfAborted(); status.textContent = "材料已入库并引用"; }
    catch (error) { status.textContent = signal.aborted ? "已停止；已导入的材料保留在材料库" : error instanceof Error ? error.message : String(error); }
    finally { operation = undefined; busy = false; input.disabled = false; submit.textContent = "导入并引用"; panel.querySelectorAll<HTMLButtonElement>("button").forEach(button => button.disabled = false); await refresh(); }
  };
  panel.querySelector<HTMLButtonElement>('[data-picker-files]')!.onclick = () => picker.click();
  picker.onchange = () => { const files = Array.from(picker.files ?? []); picker.value = ""; void run(async () => { for (const group of groupMaterialFiles(files)) { const material = await options.ports.importFiles(group); await options.attach(material.id); await options.added(material.id); } }); };
  panel.querySelector<HTMLFormElement>("form")!.onsubmit = event => {
    event.preventDefault(); if (operation) { operation.abort(); status.textContent = "正在停止…"; return; } const input = panel.querySelector<HTMLInputElement>('form input')!, text = input.value.trim(); if (!text) return;
    const parsed = splitIntakeText(text);
    void run(async signal => {
      if (parsed.goal || (!parsed.urls.length && !parsed.repositories.length)) throw new Error("请输入链接或本地仓库路径");
      for (const url of parsed.urls) { signal.throwIfAborted(); status.textContent = `正在导入 ${url}…`; const material = await options.ports.importUrl(url, signal); signal.throwIfAborted(); await options.attach(material.id); await options.added(material.id); }
      for (const path of parsed.repositories) { signal.throwIfAborted(); status.textContent = normalizeRepositoryUrl(path) ? `正在克隆仓库 ${path}…` : `正在读取仓库 ${path}…`; const { material } = await options.ports.importRepository(path, signal); signal.throwIfAborted(); await options.attach(material.id); await options.added(material.id); }
      input.value = "";
    });
  };
  void refresh().catch(error => { status.textContent = String(error); });
  return { dispose() { operation?.abort(); abort.abort(); panel.remove(); } };
}
