import type { ManagedSpeechState } from "../core/index.ts";

export interface VoiceOptions { voices: readonly { id: string; sid: number; group: string }[]; defaultVoice: string }

export function renderSpeechVoiceSettings(root: HTMLElement, getVoices: () => Promise<VoiceOptions>, save: (voice: string) => void, connected: () => boolean) {
  const doc = root.ownerDocument, label = doc.createElement("label"), select = doc.createElement("select"), status = doc.createElement("small");
  label.className = "pith-setting-row"; label.textContent = "朗读音色"; select.setAttribute("aria-label", "朗读音色"); label.append(select); status.setAttribute("role", "status"); root.append(label, status);
  let mode = "", value = "", installed = false, generation = 0, loaded: VoiceOptions | undefined;
  const draw = () => {
    select.replaceChildren();
    const option = doc.createElement("option"); option.value = ""; option.textContent = loaded ? `默认（${loaded.defaultVoice}）` : "暂无可用音色"; select.append(option);
    if (loaded) {
      const groups = new Map<string, HTMLOptGroupElement>();
      for (const voice of loaded.voices) { let group = groups.get(voice.group); if (!group) { group = doc.createElement("optgroup"); group.label = voice.group; groups.set(voice.group, group); select.append(group); } const item = doc.createElement("option"); item.value = voice.id; item.textContent = voice.id; group.append(item); }
      const selected = loaded.voices.find(voice => voice.id === value || String(voice.sid) === value); select.value = selected ? selected.id : "";
    }
    select.disabled = !loaded;
  };
  const load = () => {
    const current = ++generation; loaded = undefined; draw();
    if (mode !== "local" || !installed) { status.textContent = ""; return; }
    status.textContent = "正在读取音色…";
    void Promise.resolve().then(getVoices).then(result => { if (current !== generation || !connected() || mode !== "local") return; loaded = result; status.textContent = ""; draw(); }).catch(error => { if (current !== generation || !connected() || mode !== "local") return; status.textContent = `音色不可用：${error instanceof Error ? error.message : String(error)}`; });
  };
  select.addEventListener("change", () => { if (mode !== "local") return; value = select.value; save(value); });
  return {
    setMode(next: string, selected: string) { mode = next; value = selected; root.hidden = mode !== "local"; load(); },
    setValue(selected: string) { value = selected; draw(); },
    setRuntimeState(state: ManagedSpeechState) { const next = state.supported && (state.status === "stopped" || state.status === "running" || state.status === "starting"); if (next !== installed) { installed = next; load(); } },
  };
}
