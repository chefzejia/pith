import type { ManagedSpeechState } from "../core/index.ts";

type Action = "install" | "ensureRunning" | "remove" | "stop";

export function renderSpeechRuntimeSettings(panel: HTMLElement, getState: () => Promise<ManagedSpeechState>, act: (action: Action) => Promise<ManagedSpeechState>, connected: () => boolean): void {
  const doc = panel.ownerDocument;
  const title = doc.createElement("div"); title.className = "pith-runtime-title";
  const name = doc.createElement("strong"); name.textContent = "本机语音引擎";
  const description = doc.createElement("small"); description.textContent = "Kokoro 中英 TTS · SenseVoice 多语种 ASR";
  title.append(name, description);
  const status = doc.createElement("div"); status.setAttribute("role", "status"); status.setAttribute("style", "min-width:0;max-width:100%;overflow-wrap:anywhere");
  const progressArea = doc.createElement("div"); progressArea.setAttribute("style", "flex-basis:100%;width:100%");
  const controls = doc.createElement("div"); controls.className = "pith-setting-control";
  panel.append(title, status, controls, progressArea);
  let state: ManagedSpeechState | null = null;
  let refresh: ReturnType<typeof setInterval> | null = null;
  let revision = 0;
  let localInstall = false;
  let actionPending = false;
  let canceling = false;
  let actionGeneration = 0;
  const draw = (info: ManagedSpeechState, busy = false) => {
    revision++;
    state = info;
    const labels = { "not-installed": "未安装", installing: "安装中…", stopped: "已就绪（按需自动启动）", starting: "启动中…", running: "运行中", failed: "安装异常" };
    const percent = info.progressPercent;
    status.textContent = info.supported ? info.status === "failed" || info.status === "installing" ? `${labels[info.status]}：${info.note}${percent === undefined ? "" : ` · ${Math.max(0, Math.min(100, percent)).toFixed(1)}%`}` : labels[info.status] : info.note;
    progressArea.replaceChildren();
    if (info.supported && info.status === "installing") { const bar = doc.createElement("progress"); bar.max = 100; if (percent !== undefined) bar.value = Math.max(0, Math.min(100, percent)); bar.setAttribute("aria-label", "安装进度"); bar.setAttribute("style", "width:100%;height:8px;accent-color:var(--pith-sage, #648568)"); progressArea.append(bar); }
    if (info.status !== "installing" && refresh !== null) { clearInterval(refresh); refresh = null; }
    if (info.status === "installing" && refresh === null) {
      refresh = setInterval(() => {
        if (!connected()) { if (refresh !== null) clearInterval(refresh); refresh = null; return; }
        const current = revision;
        void getState().then(next => { if (connected() && !canceling && revision === current && (!localInstall || next.status === "installing")) draw(next); }).catch(error => {
          if (connected() && revision === current) { if (refresh !== null) clearInterval(refresh); refresh = null; status.textContent = `状态不可用：${error instanceof Error ? error.message : String(error)}`; }
        });
      }, 1000);
    }
    controls.replaceChildren();
    if (!info.supported) return;
    if (info.status === "installing") { const cancel = doc.createElement("button"); cancel.type = "button"; cancel.textContent = canceling ? "正在取消…" : "取消安装"; cancel.disabled = canceling; cancel.onclick = () => run("stop"); controls.append(cancel); return; }
    const installed = info.status === "stopped" || info.status === "running" || info.status === "starting";
    const button = doc.createElement("button"); button.type = "button";
    button.textContent = busy && !installed ? "正在安装…" : installed ? "检测语音" : info.status === "failed" ? "重新安装" : "安装引擎";
    button.disabled = busy || info.status === "starting";
    button.onclick = () => run(installed ? "ensureRunning" : "install"); controls.append(button);
    if (installed) { const remove = doc.createElement("button"); remove.type = "button"; remove.textContent = "卸载"; remove.disabled = busy; remove.onclick = () => run("remove"); controls.append(remove); }
  };
  const run = (action: Action) => {
    if (!state || (actionPending && action !== "stop") || (action === "stop" && canceling)) return;
    const generation = ++actionGeneration;
    actionPending = true;
    const previous = state;
    if (action === "stop") { canceling = true; localInstall = false; draw(state, true); }
    else {
    localInstall = action === "install";
    draw(localInstall ? { ...state, status: "installing", note: "正在准备安装" } : state, true);
    if (!localInstall) status.textContent = "处理中…";
    }
    void act(action).then(info => { if (generation !== actionGeneration) return; canceling = false; localInstall = false; actionPending = false; if (connected()) draw(info); }).catch(error => {
      if (generation !== actionGeneration) return;
      canceling = false; localInstall = false; actionPending = false;
      if (!connected()) return;
      draw(action === "install" ? { supported: true, status: "failed", note: String(error) } : previous);
      status.textContent = `${action === "install" ? "安装异常" : "操作失败"}：${error instanceof Error ? error.message : String(error)}`;
    });
  };
  status.textContent = "正在检查…";
  void getState().then(info => { if (connected()) draw(info); }).catch(error => { if (connected()) status.textContent = `状态不可用：${error instanceof Error ? error.message : String(error)}`; });
}
