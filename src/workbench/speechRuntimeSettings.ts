import type { ManagedSpeechState } from "../core/index.ts";

type Action = "install" | "ensureRunning" | "remove";

export function renderSpeechRuntimeSettings(panel: HTMLElement, getState: () => Promise<ManagedSpeechState>, act: (action: Action) => Promise<ManagedSpeechState>, connected: () => boolean): void {
  const doc = panel.ownerDocument;
  const title = doc.createElement("div"); title.className = "pith-runtime-title";
  const name = doc.createElement("strong"); name.textContent = "本机语音引擎";
  const description = doc.createElement("small"); description.textContent = "Kokoro 中英 TTS · SenseVoice 多语种 ASR";
  title.append(name, description);
  const status = doc.createElement("div"); status.setAttribute("role", "status");
  const controls = doc.createElement("div"); controls.className = "pith-setting-control";
  panel.append(title, status, controls);
  let state: ManagedSpeechState | null = null;
  const draw = (info: ManagedSpeechState, busy = false) => {
    state = info;
    const labels = { "not-installed": "未安装", installing: "安装中…", stopped: "已就绪（按需自动启动）", starting: "启动中…", running: "运行中", failed: "安装异常" };
    status.textContent = info.supported ? labels[info.status] : info.note;
    controls.replaceChildren();
    if (!info.supported) return;
    const installed = info.status === "stopped" || info.status === "running" || info.status === "starting";
    const button = doc.createElement("button"); button.type = "button";
    button.textContent = busy && !installed ? "正在安装…" : installed ? "检测语音" : info.status === "failed" ? "重新安装" : "安装引擎";
    button.disabled = busy || info.status === "installing" || info.status === "starting";
    button.onclick = () => run(installed ? "ensureRunning" : "install"); controls.append(button);
    if (installed) { const remove = doc.createElement("button"); remove.type = "button"; remove.textContent = "卸载"; remove.disabled = busy; remove.onclick = () => run("remove"); controls.append(remove); }
  };
  const run = (action: Action) => {
    if (!state) return;
    const previous = state;
    draw(state, true);
    status.textContent = action === "install" ? "安装中…" : "处理中…";
    void act(action).then(info => { if (connected()) draw(info); }).catch(error => {
      if (!connected()) return;
      draw(action === "install" ? { supported: true, status: "failed", note: String(error) } : previous);
      status.textContent = `${action === "install" ? "安装异常" : "操作失败"}：${error instanceof Error ? error.message : String(error)}`;
    });
  };
  status.textContent = "正在检查…";
  void getState().then(info => { if (connected()) draw(info); }).catch(error => { if (connected()) status.textContent = `状态不可用：${error instanceof Error ? error.message : String(error)}`; });
}
