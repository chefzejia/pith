import { WebWorkbench } from "./workbench.ts";
import { intakeGuidePrompt, renderAcpSelect, renderCompass } from "../../workbench/index.ts";
import { renderSpeechRuntimeSettings } from "../../workbench/speechRuntimeSettings.ts";
import { renderSpeechVoiceSettings, type VoiceOptions } from "../../workbench/speechVoiceSettings.ts";
import { pithIcon } from "../../workbench/icons.ts";
import { speechMode } from "../speech/speechSettings.ts";
import { prepareMaterialImport } from "../../workbench/importMaterial.ts";
import type { BoardMaterial } from "../../workbench/boardMaterials.ts";
import type { AcpConfigOptionDescriptor, AttentionCompassSnapshot, DiscoveredAgentDescriptor, ManagedSpeechState, Material, PluginStatus, Topic } from "../../core/index.ts";

interface WebSettings { preset: "essentials" | "all"; persona: "sanctuary" | "studio"; plugins: Record<string, { enabled: boolean }>; agentId: "" | "dsh" | "claude" | "codex"; agentConfigured?: boolean; model: string; effort: string; speech?: Record<string, string> }
interface WebState { compass: AttentionCompassSnapshot; materials: readonly Material[]; boardMaterials: readonly BoardMaterial[]; settings: WebSettings; guideConfigured: boolean; plugins: readonly PluginStatus[] }
const requiredElement = (selector: string): HTMLElement => { const node = Array.from(document.querySelectorAll(selector)).find(item => !item.closest(".pith-article")); if (!(node instanceof HTMLElement)) throw new Error(`Missing ${selector}`); return node; };
const requiredHost = requiredElement;
const requiredSelect = (selector: string): HTMLSelectElement => { const node = requiredElement(selector); if (!(node instanceof HTMLSelectElement)) throw new Error(`Expected select ${selector}`); return node; };
const requiredInput = (selector: string): HTMLInputElement | HTMLTextAreaElement => { const node = requiredElement(selector); if (!(node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement)) throw new Error(`Expected input ${selector}`); return node; };
const requiredButton = (selector: string): HTMLButtonElement => { const node = requiredElement(selector); if (!(node instanceof HTMLButtonElement)) throw new Error(`Expected button ${selector}`); return node; };
const main = requiredElement("#main"), drawer = requiredElement("#drawer");
async function api<T = unknown>(path: string, data?: unknown): Promise<T> { const response = await fetch(path, data === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data) }); const result: unknown = await response.json(); if (!response.ok) throw new Error(result && typeof result === "object" && "error" in result ? String(result.error) : `HTTP ${response.status}`); return result as T; }
let state: WebState, topic: Topic | null = null, workbench: WebWorkbench | null = null, navigation = 0;
const guideVisibility = new Map<string, boolean>();
async function refresh(): Promise<void> { state = await api<WebState>("/api/state"); }
async function goHome(): Promise<void> { const request = ++navigation; await refresh(); if (request === navigation) home(); }
function notify(error: unknown): void { const toast = requiredElement("#toast"); toast.textContent = error instanceof Error ? error.message : String(error); toast.hidden = false; window.setTimeout(() => { toast.hidden = true; }, 4000); }
function home(): void {
  navigation++; if (workbench) workbench.dispose(); workbench = null; topic = null;
  main.style.height = "100vh";
  renderCompass(main, state.compass, {
    materials: state.boardMaterials,
    open: id => { void openTopic(id).catch(notify); },
    create: async data => {
      let material: Material | undefined; let target = "";
      if (data.repoPath) { const result = await api<Material & { intakeDescription: string }>("/api/materials/repo", { repoPath: data.repoPath }); material = result; target = result.intakeDescription; }
      else if (data.url) material = await api<Material>("/api/materials/url", { url: data.url });
      else if (data.files.length) material = await importFiles(data.files);
      const title = material?.title || data.title;
      const item = await api<Topic>("/api/topics", { title, ...(target ? { target } : {}), ...(material ? { materialId: material.id } : {}), ...(!material && data.guide ? { guideDefault: true } : {}) });
      try { await openTopic(item.id, data.guide, intakeGuidePrompt(target || data.title, data.files)); } catch (error) { notify(error); }
    },
    settings: openSimpleSettings,
  });
}
async function openTopic(id: string, guide = false, prompt = ""): Promise<void> {
  const request = ++navigation;
  await refresh(); if (request !== navigation) return;
  const next = [...state.compass.exploring, ...state.compass.settled].find(item => item.id === id);
  if (!next) throw new Error("课题不存在");
  if (workbench) workbench.dispose();
  topic = next;
  main.classList.remove("pith-view"); main.replaceChildren();
  const root = document.createElement("div"); root.style.height = "100vh"; main.append(root);
  const instance = new WebWorkbench({ root, topic: next, material: state.materials.find(item => item.id === next.materialId), request: api,
    guideAvailable: state.plugins.some(item => item.id === "guide-acp" && item.state === "active"), guideVisible: guideVisibility.get(id) ?? false,
    home: () => goHome().catch(notify), settings: openSimpleSettings, importMaterial: () => requiredElement("#material-files").click(), visibility: visible => guideVisibility.set(id, visible), report: notify });
  workbench = instance;
  await instance.open();
  if (guide && state.guideConfigured && request === navigation) await instance.startCurriculum(prompt);
}
document.addEventListener("click", event => {
  const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>("button") : null;
  if (!button || button.closest(".pith-view")) return;
  if (button.id === "close-drawer") drawer.hidden = true;
});
document.body.insertAdjacentHTML("beforeend", '<input id="material-files" type="file" multiple hidden>');
async function importFiles(files: File[], topicId?: string): Promise<Material> {
  const prepared = await prepareMaterialImport(files);
  const entries = prepared.files.map(({ bytes, ...entry }) => { let binary = ""; for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768)); return { ...entry, data: btoa(binary) }; });
  return api<Material>("/api/materials", { title: prepared.title, kind: prepared.kind, files: entries, topicId });
}
document.addEventListener("change", event => {
  if (!(event.target instanceof HTMLInputElement) || event.target.id !== "material-files" || !event.target.files?.length) return;
  const input = event.target, fileList = input.files; if (!fileList) return;
  const files = Array.from(fileList), topicId = topic?.id;
  void importFiles(files, topicId).then(async material => {
    const id = topicId || (await api<Topic>("/api/topics", { title: material.title, materialId: material.id })).id;
    if (!topicId || topic?.id === topicId) await openTopic(id);
  }).catch(notify).finally(() => { input.value = ""; });
});
let settingsPending = Promise.resolve(), agentIntent: string | undefined;
function openSimpleSettings() {
  drawer.hidden = false;
  drawer.innerHTML = '<button class="button" id="close-drawer">\u5173\u95ED</button><h2>\u5411\u5BFC Agent \u4E0E\u5DE5\u4F5C\u533A</h2><div class="form"><label>\u672C\u673A Agent <span class="pith-setting-control"><select id="simple-agent"><option value="">\u79BB\u7EBF</option><option value="dsh">dsh</option><option value="claude">claude</option><option value="codex">codex</option></select><button type="button" id="simple-scan" aria-label="刷新本机 Agent" title="刷新本机 Agent"></button></span></label><label>\u6A21\u578B\uFF08Model\uFF09 <select id="simple-model"></select></label><label>\u63A8\u7406\u5F3A\u5EA6\uFF08Effort\uFF09 <select id="simple-effort"></select></label><label>\u672F\u8BED\u98CE\u683C <select id="simple-persona"><option value="sanctuary">\u82B1\u56ED / \u56ED\u4E01</option><option value="studio">\u5DE5\u4F5C\u533A / \u5411\u5BFC</option></select></label><h2>\u8BED\u97F3\u670D\u52A1</h2><label>\u8BED\u97F3\u670D\u52A1\u6A21\u5F0F <select id="simple-mode"><option value="local">\u672C\u673A\u8BED\u97F3\uFF08\u81EA\u52A8\u8FDE\u63A5\uFF09</option><option value="cloud">\u4E91\u7AEF\u8BED\u97F3\uFF08OpenAI \u517C\u5BB9\uFF09</option></select></label><div id="speech-runtime"></div><label id="simple-key-row">API Key <input id="simple-key" type="password" autocomplete="new-password"></label><div id="simple-cloud-fields"><label>TTS \u7AEF\u70B9 URL <input data-speech-field="ttsEndpoint"></label><label>TTS \u6A21\u578B <input data-speech-field="ttsModel"></label><label>\u97F3\u8272 <input data-speech-field="ttsVoice"></label><label>ASR \u7AEF\u70B9 URL <input data-speech-field="asrLoopbackUrl"></label><label>ASR \u6A21\u578B <input data-speech-field="asrModel"></label></div><button type="button" id="simple-health">\u68C0\u6D4B\u8FDE\u63A5</button><div id="simple-status" role="status"></div></div>';
  const agent = requiredSelect("#simple-agent"), model = requiredSelect("#simple-model"), effort = requiredSelect("#simple-effort"), persona = requiredSelect("#simple-persona"), mode = requiredSelect("#simple-mode"), status = requiredHost("#simple-status"), speech = state.settings.speech || {};
  requiredButton("#simple-scan").innerHTML = pithIcon("rotate-cw");
  if (!state.settings.agentConfigured) {
    const option = document.createElement("option");
    option.value = "unconfigured";
    option.textContent = "\u672A\u914D\u7F6E";
    option.disabled = true;
    agent.prepend(option);
  }
  agent.value = agentIntent !== void 0 ? agentIntent : state.settings.agentConfigured ? state.settings.agentId : "unconfigured";
  persona.value = state.settings.persona;
  const currentMode = speechMode(speech);
  if (currentMode === "legacy") {
    const option = document.createElement("option");
    option.value = "legacy";
    option.textContent = "\u73B0\u6709\u65E7\u914D\u7F6E\uFF08\u4FDD\u7559\uFF09";
    option.disabled = true;
    mode.append(option);
    status.textContent = "\u73B0\u6709\u8BED\u97F3\u914D\u7F6E\u4FDD\u6301\u4E0D\u53D8\uFF1B\u9009\u62E9\u6A21\u5F0F\u53EF\u5207\u6362\u6807\u51C6\u534F\u8BAE";
  }
  mode.value = currentMode;
  drawer.querySelectorAll<HTMLInputElement>("input[data-speech-field]").forEach((input) => { const field = input.dataset.speechField; if (field) input.value = speech[field] || ""; });
  const enqueue = (operation: () => Promise<void>) => {
    settingsPending = settingsPending.then(operation).catch((error) => {
      status.textContent = error.message || String(error);
    });
    return settingsPending;
  };
  const save = (fields: Record<string, unknown>) => enqueue(async () => {
    const result = await api<{ settings: WebSettings }>("/api/settings", fields);
    state.settings = result.settings;
    status.textContent = "\u8BBE\u7F6E\u5DF2\u4FDD\u5B58";
  });
  const runtimePanel = requiredHost("#speech-runtime");
  const voiceRoot = document.createElement("div"); voiceRoot.id = "speech-voices"; runtimePanel.after(voiceRoot);
  let voiceRevision = 0; const fieldRevisions = new WeakMap<HTMLInputElement, number>();
  const voices = renderSpeechVoiceSettings(voiceRoot, () => api<VoiceOptions>("/api/speech/voices"), voice => { voiceRevision++; void enqueue(async () => { const result = await api<{ settings: WebSettings }>("/api/settings", { speech: { ...state.settings.speech, ttsVoice: voice } }); state.settings = result.settings; status.textContent = "设置已保存"; }); }, () => voiceRoot.isConnected && !drawer.hidden);
  voices.setMode(mode.value, speech.ttsVoice || "");
  renderSpeechRuntimeSettings(runtimePanel, () => api<ManagedSpeechState>("/api/speech/runtime"), action => api<ManagedSpeechState>("/api/speech/runtime", { action }), () => runtimePanel.isConnected, info => voices.setRuntimeState(info));
  const visibility = () => {
    runtimePanel.hidden = mode.value !== "local";
    requiredHost("#simple-key-row").hidden = mode.value !== "cloud";
    requiredHost("#simple-cloud-fields").hidden = mode.value !== "cloud";
    requiredHost("#simple-health").hidden = mode.value !== "cloud";
  };
  visibility();
  let probeGeneration = 0;
  const probe = (force = false) => {
    const id = agent.value, generation = ++probeGeneration;
    model.disabled = !id || id === "unconfigured";
    effort.disabled = true;
    renderAcpSelect(model, void 0, state.settings.model);
    renderAcpSelect(effort, void 0, state.settings.effort);
    if (model.disabled) return;
    api<readonly AcpConfigOptionDescriptor[]>("/api/agents/options?id=" + encodeURIComponent(id) + (force ? "&force=true" : "")).then((options) => {
      if (generation !== probeGeneration || !agent.isConnected || agent.value !== id) return;
      renderAcpSelect(model, options.find((item) => item.id === "model"), model.value);
      renderAcpSelect(effort, options.find((item) => item.id === "reasoning_effort" || item.id === "effort" || item.category === "thought_level"), effort.value);
      effort.disabled = false;
    }).catch((error) => {
      if (generation === probeGeneration && agent.isConnected) status.textContent = error.message || String(error);
    });
  };
  model.onchange = () => save({ model: model.value });
  effort.onchange = () => save({ effort: effort.value });
  agent.onchange = () => {
    agentIntent = agent.value;
    save({ agentId: agent.value });
    probe();
  };
  persona.onchange = () => save({ persona: persona.value });
  mode.onchange = () => {
    visibility();
    const selected = mode.value;
    voices.setMode(selected, "");
    const revision = voiceRevision, revisions = new Map(Array.from(drawer.querySelectorAll<HTMLInputElement>("input[data-speech-field]"), input => [input, fieldRevisions.get(input) ?? 0]));
    enqueue(async () => {
      const result = await api<{ settings: WebSettings }>("/api/settings", { speechMode: selected });
      state.settings = result.settings;
      if (mode.value === selected && voiceRevision === revision) voices.setValue((state.settings.speech || {}).ttsVoice || "");
      if (mode.value === selected) drawer.querySelectorAll<HTMLInputElement>("input[data-speech-field]").forEach((input) => { const field = input.dataset.speechField; if (field && (fieldRevisions.get(input) ?? 0) === revisions.get(input)) input.value = (state.settings.speech || {})[field] || ""; });
      status.textContent = "\u8BBE\u7F6E\u5DF2\u4FDD\u5B58";
    });
  };
  drawer.querySelectorAll<HTMLInputElement>("input[data-speech-field]").forEach((input) => { input.oninput = () => fieldRevisions.set(input, (fieldRevisions.get(input) ?? 0) + 1); input.onchange = () => {
    const name = input.dataset.speechField, value = input.value;
    if (!name || mode.value !== "cloud") return;
    enqueue(async () => {
      const result = await api<{ settings: WebSettings }>("/api/settings", { speech: { ...state.settings.speech, [name]: value } });
      state.settings = result.settings;
      status.textContent = "\u8BBE\u7F6E\u5DF2\u4FDD\u5B58";
    });
  }; });
  const keyInput = requiredInput("#simple-key");
  keyInput.onchange = () => {
    const value = keyInput.value;
    if (value) {
      save({ secrets: { OPENAI_API_KEY: value } });
      keyInput.value = "";
    }
  };
  requiredButton("#simple-health").onclick = () => enqueue(async () => {
    const info = await api<{ ttsHealth: { note: string }; asrHealth: { note: string } }>("/api/speech/presets");
    status.textContent = "TTS: " + info.ttsHealth.note + "\uFF1BASR: " + info.asrHealth.note;
  });
  const scan = () => {
    const button = requiredButton("#simple-scan");
    button.disabled = true;
    button.textContent = "…";
    api<readonly DiscoveredAgentDescriptor[]>("/api/agents?force=true").then((agents) => {
      const available = ["dsh", "claude", "codex"].map((id) => agents.find((item) => item.id === id && item.available)).find(Boolean);
      if (agentIntent === void 0 && agent.isConnected && !drawer.hidden && !state.settings.agentConfigured && available) {
        agent.value = available.id;
        save({ agentId: available.id });
        probe();
      } else if (!available) status.textContent = "\u672A\u53D1\u73B0\u53EF\u7528 Agent";
    }).catch((error) => {
      status.textContent = error.message || String(error);
    }).finally(() => {
      button.disabled = false;
      button.innerHTML = pithIcon("rotate-cw");
    });
  };
  requiredButton("#simple-scan").onclick = () => {
    scan();
    probe(true);
  };
  scan();
  probe();
}

refresh().then(home).catch(notify);
