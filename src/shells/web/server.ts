import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { DefaultAttentionEngine, DefaultWorkspaceStore, MutationQueue, type DojoScaffoldStage, type DojoToolkitDescriptor, type GuideAgentService, type GuideProvider, type PluginsConfigFile, type SelectionAnchor, type SpeechTtsService, type StageReaderService } from "../../core/index.ts";
import { LocalAcpGuideProvider, buildScenePrompt } from "../../plugins/guide-acp/index.ts";
import { bootStandaloneShell, type WorkspaceSnapshot } from "./index.ts";
import { NodeAgentProcessPort } from "./nodeProcess.ts";
import { NodeWorkspaceStorage } from "./nodeStorage.ts";

interface WebSettings { preset: "essentials" | "all"; persona: "sanctuary" | "studio"; plugins: Record<string, { enabled: boolean }>; agentId: "" | "dsh" | "claude" | "codex"; model: string; effort: string }
export interface PithWebServerOptions { workspaceDir: string; port?: number; guideProvider?: GuideProvider }

async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  let raw = "";
  for await (const chunk of req) {
    raw += String(chunk);
    if (raw.length > 1_000_000) throw new Error("Request too large");
  }
  const parsed: unknown = JSON.parse(raw || "{}");
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Expected an object");
  return parsed as Record<string, unknown>;
}
function str(data: Record<string, unknown>, key: string): string {
  const value = data[key];
  if (typeof value !== "string" || !value.trim()) throw new Error(`Invalid ${key}`);
  return value;
}
function anchor(value: unknown): SelectionAnchor | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid anchor");
  const a = value as Record<string, unknown>;
  const quote = a.quote;
  if (quote !== undefined && typeof quote !== "string") throw new Error("Invalid quote");
  return { file: str(a, "file"), locator: str(a, "locator"), ...(typeof quote === "string" ? { quote } : {}) };
}
function send(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" });
  res.end(JSON.stringify(value));
}

export async function createPithWebServer(options: PithWebServerOptions): Promise<Server> {
  const storage = new NodeWorkspaceStorage(options.workspaceDir);
  const store = new DefaultWorkspaceStore(storage);
  await store.ensureScaffold();
  let localProvider: GuideProvider | undefined;
  const engine = new DefaultAttentionEngine(store, storage, () => options.guideProvider ?? (settings.agentId ? localProvider : undefined));
  const snapshot: WorkspaceSnapshot = { topics: [], materials: [], known: false };
  let settings: WebSettings = { preset: "all", persona: "sanctuary", plugins: {}, agentId: "", model: "", effort: "" };
  async function loadSettings(): Promise<void> {
    if (!await storage.exists("_cache/web-settings.json")) return;
    const saved: unknown = JSON.parse(await storage.readText("_cache/web-settings.json"));
    if (!saved || typeof saved !== "object" || Array.isArray(saved)) throw new Error("Invalid web settings");
    const value = saved as Partial<WebSettings>;
    if ((value.preset !== "all" && value.preset !== "essentials") || (value.persona !== "sanctuary" && value.persona !== "studio") || !value.plugins || typeof value.plugins !== "object" || Array.isArray(value.plugins) || (value.agentId !== undefined && !["", "dsh", "claude", "codex"].includes(value.agentId)) || (value.model !== undefined && typeof value.model !== "string") || (value.effort !== undefined && typeof value.effort !== "string")) throw new Error("Invalid web settings");
    settings = { ...value, preset: value.preset, persona: value.persona, plugins: value.plugins, agentId: value.agentId ?? "", model: value.model ?? "", effort: value.effort ?? "" };
  }
  await loadSettings();
  const config = (): PluginsConfigFile => ({ preset: settings.preset, plugins: { ...settings.plugins, "guide-acp": { ...settings.plugins["guide-acp"], config: { agentId: settings.agentId, model: settings.model, effort: settings.effort, persona: settings.persona } } } });
  const processPort = new NodeAgentProcessPort();
  const runtime = bootStandaloneShell({ id: "web", storage, process: processPort }, config(), { store, engine, snapshot, provider: options.guideProvider });
  localProvider = new LocalAcpGuideProvider({ processPort, store, getAgentConfig: () => ({ agentId: settings.agentId, model: settings.model, effort: settings.effort }), resolveDescriptor: async id => {
    const guide = runtime.getService<GuideAgentService>("guide.agent");
    if (!guide || !guide.detectAgents) throw new Error("Guide service unavailable");
    return (await guide.detectAgents()).find(item => item.id === id) ?? null;
  }, buildScenePrompt });
  let appliedGuideConfig = JSON.stringify([settings.agentId, settings.model, settings.effort, settings.persona]);
  const processEffects = (): void => {
    if (options.guideProvider || settings.agentId) void engine.processDueEffects().catch(error => console.error("Effect processing failed:", error));
  };
  async function refresh(): Promise<void> {
    snapshot.known = false;
    try {
      await loadSettings();
      const [topics, materials] = await Promise.all([store.listTopics(), store.listMaterials()]);
      snapshot.topics = topics; snapshot.materials = materials; snapshot.known = true;
    } finally {
      const nextGuideConfig = JSON.stringify([settings.agentId, settings.model, settings.effort, settings.persona]);
      if (nextGuideConfig !== appliedGuideConfig) {
        const next = config();
        runtime.reconcile({ ...next, plugins: { ...next.plugins, "guide-acp": { enabled: false } } });
        appliedGuideConfig = nextGuideConfig;
      }
      runtime.reconcile(config());
    }
  }
  await refresh();
  processEffects();
  const server = createServer(async (req, res) => {
    try {
      const host = req.headers.host;
      if (!host || !/^(?:localhost|127\.0\.0\.1)(?::\d+)?$/.test(host)) return send(res, 403, { error: "Invalid host" });
      if (req.headers.origin && req.headers.origin !== `http://${host}`) return send(res, 403, { error: "Invalid origin" });
      const url = new URL(req.url ?? "/", `http://${host}`);
      const method = req.method ?? "GET";
      if (method === "POST" && req.headers["content-type"] !== "application/json") return send(res, 415, { error: "JSON required" });
      if (method === "GET" && url.pathname === "/") {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8", "content-security-policy": "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'", "x-content-type-options": "nosniff" });
        res.end(APP); return;
      }
      if (method === "GET" && url.pathname === "/api/state") {
        await refresh(); return send(res, 200, { compass: await engine.compass(), materials: snapshot.materials, settings, plugins: runtime.statuses() });
      }
      if (method === "GET" && url.pathname === "/api/agents") {
        const guide = runtime.getService<GuideAgentService>("guide.agent");
        if (!guide || !guide.detectAgents) return send(res, 503, { error: "Guide service unavailable" });
        return send(res, 200, await guide.detectAgents(url.searchParams.get("force") === "true"));
      }
      if (method === "POST" && url.pathname === "/api/topics") {
        const data = await body(req);
        const topic = await store.createTopic({ title: str(data, "title"), target: typeof data.target === "string" ? data.target : "", nextAction: typeof data.nextAction === "string" ? data.nextAction : undefined,
          materialId: typeof data.materialId === "string" && data.materialId ? data.materialId : undefined });
        await refresh(); return send(res, 201, topic);
      }
      const toolkitPath = /^\/api\/topics\/([^/]+)\/toolkits$/.exec(url.pathname);
      if (method === "POST" && toolkitPath) {
        const data = await body(req);
        if (!Array.isArray(data.toolkits) || !data.toolkits.every(item => typeof item === "string" && /^[a-z][a-z0-9-]*$/.test(item)) || new Set(data.toolkits).size !== data.toolkits.length) throw new Error("Invalid toolkits");
        const topic = await store.updateTopic(decodeURIComponent(toolkitPath[1]!), { toolkits: data.toolkits });
        await refresh(); return send(res, 200, topic);
      }
      const actionsPath = /^\/api\/topics\/([^/]+)\/actions$/.exec(url.pathname);
      if (method === "GET" && actionsPath) {
        await refresh();
        const topic = await store.getTopic(decodeURIComponent(actionsPath[1]!));
        if (!topic) return send(res, 404, { error: "Topic not found" });
        const guide = runtime.getService<GuideAgentService>("guide.agent");
        if (!guide || !guide.quickActionsForTopic) return send(res, 503, { error: "Guide service unavailable" });
        const dojo = runtime.getService<DojoToolkitDescriptor>("dojo.shadowing");
        return send(res, 200, guide.quickActionsForTopic(topic, dojo ? [dojo] : []));
      }
      if (method === "POST" && url.pathname === "/api/speech/sentences") {
        const data = await body(req);
        const speech = runtime.getService<SpeechTtsService>("speech.tts");
        if (!speech) return send(res, 503, { error: "Speech service unavailable" });
        return send(res, 200, speech.splitSentences(str(data, "text")));
      }
      if (method === "POST" && (url.pathname === "/api/dojo/diagnose" || url.pathname === "/api/dojo/transform")) {
        const data = await body(req);
        const topicId = str(data, "topicId");
        await refresh();
        const topic = await store.getTopic(topicId);
        if (!topic) return send(res, 404, { error: "Topic not found" });
        if (!topic.toolkits.includes("shadowing") && !topic.toolkits.includes("dojo-shadowing")) return send(res, 403, { error: "Shadowing is not enabled for this topic" });
        const dojo = runtime.getService<DojoToolkitDescriptor>("dojo.shadowing");
        if (!dojo) return send(res, 503, { error: "Shadowing service unavailable" });
        const targetText = str(data, "targetText");
        if (url.pathname === "/api/dojo/transform") {
          const stage = str(data, "stage");
          if (!dojo.stages.includes(stage as DojoScaffoldStage)) throw new Error("Invalid stage");
          return send(res, 200, { text: dojo.transformCue(targetText, stage as DojoScaffoldStage) });
        }
        if (typeof data.producedText !== "string") throw new Error("Invalid producedText");
        const result = dojo.diagnose(targetText, data.producedText);
        if (data.saveNote !== undefined && typeof data.saveNote !== "boolean") throw new Error("Invalid saveNote");
        if (data.saveNote === true) {
          const note = await engine.captureSelection({ topicId, kind: "practice", body: result.summaryMarkdown, anchor: { file: str(data, "file"), locator: str(data, "locator"), quote: targetText } });
          processEffects(); return send(res, 201, { ...result, note });
        }
        return send(res, 200, result);
      }
      const materialPath = /^\/api\/materials\/([^/]+)\/file$/.exec(url.pathname);
      if (method === "GET" && (url.pathname === "/api/materials/file" || materialPath)) {
        const id = materialPath ? decodeURIComponent(materialPath[1]!) : url.searchParams.get("id"); const file = url.searchParams.get("name");
        if (!id || !file) throw new Error("Missing material or file");
        const material = await store.getMaterial(id);
        const entry = material && material.files.find(item => item.name === file);
        if (!entry) return send(res, 404, { error: "File not found" });
        const reader = runtime.getService<StageReaderService>("stage.reader");
        if (!reader) return send(res, 503, { error: "Reader unavailable" });
        if (reader.renderFile) {
          const bytes = await storage.readBinary(`materials/${id}/files/${file}`);
          const document = await reader.renderFile(entry, bytes);
          const text = document.format === "markdown" ? new TextDecoder().decode(bytes) : "";
          return send(res, 200, { text, html: document.html, sections: document.sections });
        }
        const text = await storage.readText(`materials/${id}/files/${file}`);
        return send(res, 200, { text, html: reader.render(text), sections: reader.sections(text) });
      }
      if (method === "POST" && url.pathname === "/api/notes") {
        const data = await body(req); const kind = str(data, "kind");
        if (kind !== "highlight" && kind !== "note" && kind !== "practice") throw new Error("Invalid kind");
        const note = await engine.captureSelection({ topicId: str(data, "topicId"), kind, body: str(data, "body"), anchor: anchor(data.anchor) });
        processEffects(); return send(res, 201, note);
      }
      if (url.pathname === "/api/chat" && method === "GET") {
        const id = url.searchParams.get("topicId"); if (!id || !await store.getTopic(id)) return send(res, 404, { error: "Topic not found" });
        return send(res, 200, await engine.getConversation(id));
      }
      if (url.pathname === "/api/chat" && method === "POST") {
        const data = await body(req);
        const result = await engine.sendMessage({ topicId: str(data, "topicId"), text: str(data, "text"), anchor: anchor(data.anchor), saveAsNote: data.saveAsNote === true });
        if (data.saveAsNote === true) processEffects();
        return send(res, 201, result);
      }
      if (url.pathname === "/api/settings" && method === "POST") {
        const data = await body(req);
        if (data.agentId !== undefined && (typeof data.agentId !== "string" || !["", "dsh", "claude", "codex"].includes(data.agentId))) throw new Error("Invalid agentId");
        if (data.model !== undefined && typeof data.model !== "string") throw new Error("Invalid model");
        if (data.effort !== undefined && typeof data.effort !== "string") throw new Error("Invalid effort");
        if (data.persona !== undefined && data.persona !== "sanctuary" && data.persona !== "studio") throw new Error("Invalid persona");
        await MutationQueue.forStorage(storage).run(async () => {
          await loadSettings();
          settings = { ...settings, ...(data.agentId !== undefined ? { agentId: data.agentId as WebSettings["agentId"] } : {}), ...(data.model !== undefined ? { model: data.model as string } : {}), ...(data.effort !== undefined ? { effort: data.effort as string } : {}), ...(data.persona !== undefined ? { persona: data.persona as WebSettings["persona"] } : {}) };
          await storage.writeText("_cache/web-settings.json", `${JSON.stringify(settings, null, 2)}\n`);
        });
        await refresh(); processEffects();
        return send(res, 200, { settings, plugins: runtime.statuses() });
      }
      if (url.pathname === "/api/plugins" && method === "POST") {
        const data = await body(req);
        if (data.preset !== undefined && data.preset !== "all" && data.preset !== "essentials") throw new Error("Invalid preset");
        if (data.persona !== undefined && data.persona !== "sanctuary" && data.persona !== "studio") throw new Error("Invalid persona");
        await MutationQueue.forStorage(storage).run(async () => {
          await loadSettings();
          if (data.id !== undefined) {
            const id = str(data, "id");
            if (!runtime.statuses().some(plugin => plugin.id === id) || typeof data.enabled !== "boolean") throw new Error("Invalid plugin");
            settings.plugins[id] = { enabled: data.enabled };
          }
          if (data.preset === "all" || data.preset === "essentials") settings.preset = data.preset;
          if (data.persona === "sanctuary" || data.persona === "studio") settings.persona = data.persona;
          await storage.writeText("_cache/web-settings.json", `${JSON.stringify(settings, null, 2)}\n`);
        });
        await refresh(); return send(res, 200, { settings, plugins: runtime.statuses() });
      }
      return send(res, 404, { error: "Not found" });
    } catch (error) {
      return send(res, 400, { error: error instanceof Error ? error.message : "Request failed" });
    }
  });
  server.on("close", () => runtime.stop());
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(options.port ?? 0, "127.0.0.1", () => { server.off("error", reject); resolve(); }); });
  return server;
}

const APP = String.raw`<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Pith</title>
<style>
:root{color-scheme:light dark;--background-primary:#fff;--background-secondary:#f5f5f5;--background-modifier-border:#ddd;--background-modifier-hover:#eee;--text-normal:#222;--text-muted:#666;--text-faint:#999;--text-accent:#705dc7;--interactive-accent:#705dc7;--text-on-accent:#fff;--font-interface:system-ui,sans-serif}
@media(prefers-color-scheme:dark){:root{--background-primary:#1e1e1e;--background-secondary:#262626;--background-modifier-border:#444;--background-modifier-hover:#333;--text-normal:#ddd;--text-muted:#aaa;--text-faint:#777;--text-accent:#a99bea;--interactive-accent:#7865c4;--text-on-accent:#fff}}
*{box-sizing:border-box}body{margin:0;background:var(--background-primary);color:var(--text-normal);font:15px/1.6 var(--font-interface)}button,input,textarea,select{font:inherit;color:inherit}button{cursor:pointer}button:focus-visible,input:focus-visible,textarea:focus-visible,select:focus-visible{outline:2px solid var(--text-accent);outline-offset:2px}button:active{transform:scale(.97)}[hidden]{display:none!important}
header{height:56px;display:flex;align-items:center;gap:12px;padding:0 20px;border-bottom:1px solid var(--background-modifier-border);background:var(--background-primary)}.brand{font-size:20px;font-weight:700;border:0;background:none;padding:0}.crumb{color:var(--text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.head-actions{margin-left:auto;display:flex;gap:8px}.icon-button{width:38px;height:38px;display:grid;place-items:center;border:0;border-radius:5px;background:transparent}.icon-button:hover,.button:hover{background:var(--background-modifier-hover)}.icon-button svg{width:19px;height:19px;fill:none;stroke:currentColor;stroke-width:1.7}.button{background:transparent;border:1px solid var(--background-modifier-border);border-radius:5px;padding:7px 12px;min-height:38px}.button.primary{background:var(--interactive-accent);border-color:var(--interactive-accent);color:var(--text-on-accent)}.button.active{background:var(--background-modifier-hover)}
.home{max-width:1120px;margin:auto;padding:40px 28px}.home h1,.reader h1{font-size:30px;line-height:1.35}.eyebrow,.small{font-size:12px;color:var(--text-muted)}.focus{margin:28px 0 48px;padding:22px;background:var(--background-secondary);display:flex;align-items:center;gap:25px}.focus strong{display:block;font-size:20px}.focus .button{margin-left:auto}.section-head{display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--background-modifier-border);margin-top:32px}.topic-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px;margin-top:16px}.topic-card{text-align:left;background:var(--background-secondary);border:1px solid var(--background-modifier-border);padding:18px;min-height:130px;border-radius:4px}.topic-card strong{display:block;font-size:18px}.topic-card p,.empty{color:var(--text-muted)}
.workspace{display:grid;grid-template-columns:minmax(0,1fr) 340px;height:calc(100vh - 56px)}.workspace.guide-closed{grid-template-columns:minmax(0,1fr)}.reader-wrap{position:relative;min-width:0;min-height:0}.reader{height:100%;overflow:auto;overscroll-behavior:contain;scrollbar-gutter:stable;overflow-wrap:anywhere}.reader #article{max-width:850px;margin:auto;padding:32px 60px 120px;font-size:16px;line-height:1.9}.reader h1:first-child{margin-top:0}.reader pre{overflow:auto;padding:18px;background:var(--background-secondary)}.reader blockquote{color:var(--text-muted);border-left:1px solid var(--background-modifier-border);padding-left:18px}.reader mark,.training-panel mark{background:var(--background-modifier-hover);color:var(--text-normal)}
.side{background:var(--background-secondary);border-left:1px solid var(--background-modifier-border);display:flex;flex-direction:column;min-width:0;min-height:0}.side.hidden-side{display:none}.side-tabs{display:flex;border-bottom:1px solid var(--background-modifier-border);padding:12px;gap:6px}.side-tabs button{border:0;background:none;padding:8px}.side-tabs button.active{background:var(--background-modifier-hover)}.side-content{overflow:auto;flex:1;padding:20px}.message,.note{white-space:pre-wrap;overflow-wrap:anywhere;margin-bottom:18px}.message b{display:block;color:var(--text-accent);font-size:12px}.chips{display:flex;gap:6px;flex-wrap:wrap}.chips button{border:1px solid var(--background-modifier-border);background:none;border-radius:4px;padding:6px}.compose{padding:15px;border-top:1px solid var(--background-modifier-border)}textarea,input,select{background:var(--background-primary);border:1px solid var(--background-modifier-border);padding:9px}.compose textarea,.training-panel textarea{width:100%;min-height:76px;resize:vertical}.quote-preview{font-size:12px;color:var(--text-muted)}
.toolbar{position:fixed;display:none;z-index:8;background:var(--background-secondary);color:var(--text-normal);border:1px solid var(--background-modifier-border);border-radius:5px;padding:4px;max-width:calc(100vw - 16px)}.toolbar button{border:0;background:none;padding:8px}.drawer,.pith-left-drawer{position:fixed;top:0;bottom:0;width:min(360px,100%);background:var(--background-secondary);border:1px solid var(--background-modifier-border);z-index:10;padding:20px;overflow:auto}.drawer{right:0}.pith-left-drawer{left:0}.drawer label{display:flex;justify-content:space-between;gap:15px;padding:12px 0}.pith-left-drawer button{display:block;width:100%;text-align:left;border:0;background:none;padding:8px;color:var(--text-normal)}.pith-left-drawer button:hover,.pith-left-drawer button[aria-current=true]{background:var(--background-modifier-hover)}.pith-left-drawer h2{font-size:15px;margin:20px 8px 6px}.form{display:grid;gap:10px;padding:20px 0}
.pith-dock-zone{position:absolute;left:0;right:0;bottom:0;display:flex;justify-content:center;padding:30px 12px 16px}.pith-bottom-dock{display:flex;align-items:center;gap:4px;padding:5px;background:var(--background-secondary);border:1px solid var(--background-modifier-border);border-radius:24px;opacity:.15;transition:opacity .2s;pointer-events:auto}.pith-dock-zone:hover .pith-bottom-dock,.pith-bottom-dock:focus-within,.pith-bottom-dock.active{opacity:1}.pith-bottom-dock button{border:0;background:none;border-radius:18px;padding:8px 12px}.training-panel{position:absolute;z-index:3;right:16px;bottom:76px;width:min(480px,calc(100% - 32px));max-height:70%;overflow:auto;padding:16px;background:var(--background-secondary);border:1px solid var(--background-modifier-border);border-radius:6px}.training-panel .stages{display:flex;gap:5px;flex-wrap:wrap}.training-panel label{display:block;margin-top:12px}.training-panel .scaffold{white-space:pre-wrap;padding:12px;background:var(--background-primary)}.speech-status{font-size:12px;color:var(--text-muted)}.pith-speech-active{background:var(--background-modifier-hover);text-decoration:underline;text-decoration-color:var(--text-accent);text-underline-offset:4px;animation:pith-speech-breathe 2.4s ease-in-out infinite}@keyframes pith-speech-breathe{50%{background:transparent}}.pith-toast-tip{position:fixed;z-index:20;left:50%;bottom:80px;transform:translateX(-50%);background:var(--background-secondary);border:1px solid var(--background-modifier-border);border-radius:5px;padding:8px 12px;color:var(--text-normal);max-width:calc(100vw - 24px)}
@media(max-width:800px){header{padding:0 10px;gap:6px}.crumb{display:none}.home{padding:25px 18px}.focus{align-items:flex-start;flex-direction:column}.focus .button{margin:0}.workspace{grid-template-columns:minmax(0,1fr)}.side{position:absolute;right:0;top:56px;bottom:0;width:min(340px,100%);z-index:4}.reader #article{padding:25px 22px 110px}.toolbar button{padding:6px}}
@media(prefers-reduced-motion:reduce){.pith-bottom-dock{transition:none}.pith-speech-active{animation:none}}
</style></head><body><header><button class="icon-button" id="toggle-navigation" title="目录和材料" aria-label="目录和材料" aria-expanded="false" hidden>☰</button><button class="brand" id="home">Pith</button><span class="crumb" id="crumb">注意力罗盘</span><div class="head-actions"><button class="icon-button" id="toggle-side" title="切换向导栏" aria-label="切换向导栏" aria-pressed="true" hidden><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"></rect><path d="M15 4v16"></path></svg></button><button class="icon-button" id="settings" title="设置" aria-label="设置">⚙</button></div></header><main id="main"></main><div class="toolbar" id="toolbar"><button data-action="highlight">高亮</button><button data-action="note">记笔记</button><button data-action="ask">问向导</button><button data-action="speak">▶ 从此句朗读</button></div><aside class="pith-left-drawer" id="navigation" aria-label="材料和目录" hidden></aside><aside class="drawer" id="drawer" hidden></aside><div class="pith-toast-tip" id="toast" role="status" hidden></div><script>
const $=s=>document.querySelector(s), main=$('#main'), drawer=$('#drawer');let state,topic=null,file=null,conversation=[],tab='chat',selection=null,pending=null,sideVisible=true;
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function api(path,data){const r=await fetch(path,data===undefined?{}:{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data)});const x=await r.json();if(!r.ok)throw Error(x.error);return x}
let toastTimer;function notify(e){const tip=$('#toast');tip.textContent=e.message||String(e);tip.hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>{tip.hidden=true},2000)}
async function refresh(){state=await api('/api/state')}
function label(){return state.settings.persona==='sanctuary'?'园丁':'向导'}
function home(){stopSpeech();$('#toggle-navigation').hidden=true;closeNavigation();topic=null;file=null;$('#crumb').textContent='注意力罗盘';$('#toggle-side').hidden=true;const c=state.compass;main.innerHTML='<div class="home"><span class="eyebrow">YOUR ATTENTION, YOUR PACE</span><h1>今天，想深入什么？</h1>'+ (c.focusRecommendation?'<div class="focus"><div><span class="eyebrow">下一步 · 15 分钟</span><strong>'+esc(c.focusRecommendation.nextAction)+'</strong><span class="small">'+esc(c.focusRecommendation.title)+'</span></div><button class="button primary" data-open="'+esc(c.focusRecommendation.topicId)+'">继续探索 →</button></div>':'<div class="focus">选择一个课题，开始今天的探索。</div>')+'<div class="section-head"><h2>探索中 <span class="small">'+c.exploring.length+'</span></h2><button class="button" id="new-topic">＋ 新建课题</button></div><div id="new-form"></div><div class="topic-grid">'+c.exploring.map(t=>'<button class="topic-card" data-open="'+esc(t.id)+'"><span class="eyebrow">探索中</span><strong>'+esc(t.title)+'</strong><p>'+esc(t.nextAction||t.target||'尚未设置下一步')+'</p></button>').join('')+'</div><div class="section-head"><h2>已沉淀 <span class="small">'+c.settled.length+'</span></h2></div>'+(c.settled.length?'<div class="topic-grid">'+c.settled.map(t=>'<button class="topic-card" data-open="'+esc(t.id)+'"><strong>'+esc(t.title)+'</strong></button>').join('')+'</div>':'<div class="empty">尚无已沉淀课题</div>')+'</div>';}
function markExisting(){const root=$('#article');if(!root)return;for(const n of topic.notes){if(!n.anchor||n.anchor.file!==file||!n.anchor.quote)continue;const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT),nodes=[];let node,text='';while(node=walker.nextNode()){nodes.push({node,start:text.length});text+=node.data}const match=/^text:offset:(\d+)$/.exec(n.anchor.locator);let start=match?Number(match[1]):-1;if(start<0||text.slice(start,start+n.anchor.quote.length)!==n.anchor.quote)start=text.indexOf(n.anchor.quote);if(start<0)continue;const end=start+n.anchor.quote.length;for(const part of nodes){const a=Math.max(0,start-part.start),b=Math.min(part.node.length,end-part.start);if(a>=b)continue;const range=document.createRange();range.setStart(part.node,a);range.setEnd(part.node,b);const mark=document.createElement('mark');range.surroundContents(mark)}}renderTraining();if(tab==='chat'&&state.plugins.some(p=>p.id==='guide-acp'&&p.state==='active'))updateQuickActions().catch(notify)}
async function updateQuickActions(){const id=topic.id;const actions=await api('/api/topics/'+encodeURIComponent(id)+'/actions');const target=$('.side-content > .chips');if(!target||!topic||topic.id!==id||tab!=='chat')return;target.innerHTML=actions.map(a=>'<button data-choice="'+esc(a.prompt)+'">'+esc(a.label)+'</button>').join('')}
async function openTopic(id){const previous=topic&&topic.id;if(previous!==id){stopSpeech();trainingOpen=false;trainingTarget='';trainingProduced='';trainingView='';trainingResult=null;trainingAnchor=null;selection=null}await refresh();topic=[...state.compass.exploring,...state.compass.settled].find(t=>t.id===id);if(!topic)throw Error('课题不存在');conversation=await api('/api/chat?topicId='+encodeURIComponent(id));const m=state.materials.find(m=>m.id===topic.materialId);if(previous!==id||!m||!m.files.some(f=>f.name===file))file=m&&m.files.length?m.files[0].name:null;$('#crumb').textContent=topic.title;$('#toggle-navigation').hidden=false;const guide=state.plugins.find(p=>p.id==='guide-acp');if(!guide||guide.state!=='active')sideVisible=false;$('#toggle-side').hidden=!guide||guide.state!=='active';await workspace()}
async function workspace(){stopSpeech();const m=state.materials.find(m=>m.id===topic.materialId);let documentData=null;if(m&&file)documentData=await api('/api/materials/file?id='+encodeURIComponent(m.id)+'&name='+encodeURIComponent(file));const heads=documentData?documentData.sections.filter(h=>h.level<=3):[];$('#navigation').innerHTML='<h2>材料</h2>'+(m?m.files.map(f=>'<button data-file="'+esc(f.name)+'" aria-current="'+(f.name===file)+'">'+esc(f.name)+'</button>').join(''):'')+'<h2>目录</h2>'+heads.map(h=>'<button data-locator="'+esc(h.locator)+'" style="padding-left:'+(8+(h.level-1)*12)+'px">'+esc(h.title)+'</button>').join('');main.innerHTML='<div class="workspace '+(sideVisible?'':'guide-closed')+'"><section class="reader-wrap"><article class="reader" tabindex="0" aria-label="阅读舞台"><div id="article">'+(documentData?documentData.html:'<p class="empty">这个课题还没有关联材料。</p>')+'</div></article><div id="training"></div></section><aside class="side '+(sideVisible?'':'hidden-side')+'"><div class="side-tabs"><button data-tab="chat" class="'+(tab==='chat'?'active':'')+'">对话</button><button data-tab="notes" class="'+(tab==='notes'?'active':'')+'">笔记 '+topic.notes.length+'</button></div><div class="side-content">'+(tab==='chat'?conversation.map(e=>'<div class="message '+esc(e.role)+'"><b>'+(e.role==='user'?'你':label())+'</b>'+esc(e.text)+(e.choices&&e.choices.length?'<div class="chips">'+e.choices.map(c=>'<button data-choice="'+esc(c)+'">'+esc(c)+'</button>').join('')+'</div>':'')+'</div>').join('')+'<div class="chips"></div>':topic.notes.map(n=>'<div class="note"><span class="small">'+esc(n.createdAt)+' · '+esc(n.kind)+'</span><div>'+esc(n.body)+'</div></div>').join(''))+'</div><div class="compose"><div class="quote-preview" id="preview">'+(pending?'引用：'+esc(pending.quote):'')+'</div><textarea id="message" placeholder="写下你的想法"></textarea><button class="button primary" id="send">发送</button></div></aside></div>';$('#toggle-side').setAttribute('aria-pressed',String(sideVisible));markExisting()}
function settings(){drawer.hidden=false;drawer.innerHTML='<button class="button" id="close-drawer">关闭</button><h2>向导 Agent 与工作区设置</h2><form id="settings-form" class="form"><label for="agent-id">本机 Agent</label><select id="agent-id"><option value="">离线模式</option><option value="dsh">DeepSeek Harness</option><option value="claude">Claude Code</option><option value="codex">Codex</option></select><button type="button" class="button" id="detect-agents">扫描本机 Agent</button><div id="agent-status" role="status" aria-live="polite"></div><label for="agent-model">模型</label><input id="agent-model" autocomplete="off"><label for="agent-effort">推理强度</label><input id="agent-effort" autocomplete="off"><label for="persona">术语风格</label><select id="persona"><option value="sanctuary">花园 / 园丁</option><option value="studio">工作区 / 向导</option></select><button class="button primary" type="submit">保存设置</button></form>';$('#persona').value=state.settings.persona;$('#agent-id').value=state.settings.agentId;$('#agent-model').value=state.settings.model;$('#agent-effort').value=state.settings.effort}
document.addEventListener('click',async e=>{try{const t=e.target.closest('button');if(!t)return;if(t.id==='home'){await refresh();home()}else if(t.id==='settings')settings();else if(t.id==='close-drawer')drawer.hidden=true;else if(t.id==='toggle-navigation'){const nav=$('#navigation');nav.hidden=!nav.hidden;t.setAttribute('aria-expanded',String(!nav.hidden))}else if(t.id==='toggle-side'){sideVisible=!sideVisible;$('.side').classList.toggle('hidden-side',!sideVisible);$('.workspace').classList.toggle('guide-closed',!sideVisible);t.setAttribute('aria-pressed',String(sideVisible))}else if(t.dataset.locator){closeNavigation();const target=[...document.querySelectorAll('#article [data-locator]')].find(node=>node.dataset.locator===t.dataset.locator);if(target)target.scrollIntoView({block:'start'})}else if(t.dataset.open)await openTopic(t.dataset.open);else if(t.id==='new-topic')$('#new-form').innerHTML='<form class="form" id="create"><input name="title" placeholder="课题名称" required><input name="target" placeholder="探索目标"><input name="nextAction" placeholder="下一步行动"><select name="materialId"><option value="">不关联材料</option>'+state.materials.map(m=>'<option value="'+esc(m.id)+'">'+esc(m.title)+'</option>').join('')+'</select><button class="button primary">创建</button></form>';else if(t.dataset.file){closeNavigation();file=t.dataset.file;selection=null;await workspace()}else if(t.dataset.tab){tab=t.dataset.tab;await workspace()}else if(t.dataset.choice){$('#message').value=t.dataset.choice;$('#message').focus()}else if(t.id==='send'){const text=$('#message').value.trim();if(!text)return;if(tab==='notes'){await api('/api/notes',{topicId:topic.id,kind:'note',body:text,anchor:pending||undefined})}else await api('/api/chat',{topicId:topic.id,text,anchor:pending||undefined});pending=null;await openTopic(topic.id)}else if(t.dataset.action&&selection){if(t.dataset.action==='speak'){startSpeech(true)}else if(t.dataset.action==='highlight'){await api('/api/notes',{topicId:topic.id,kind:'highlight',body:selection.quote,anchor:selection});await openTopic(topic.id)}else{pending=selection;tab=t.dataset.action==='note'?'notes':'chat';sideVisible=true;await workspace();$('#message').focus()}$('#toolbar').style.display='none'}}catch(err){notify(err)}});
document.addEventListener('submit',async e=>{if(e.target.id!=='create'&&e.target.id!=='settings-form')return;e.preventDefault();try{if(e.target.id==='create'){const d=Object.fromEntries(new FormData(e.target));const t=await api('/api/topics',d);await openTopic(t.id)}else{await api('/api/settings',{agentId:$('#agent-id').value,model:$('#agent-model').value,effort:$('#agent-effort').value,persona:$('#persona').value});await refresh();if(topic)await workspace();drawer.hidden=true}}catch(err){notify(err)}});
document.addEventListener('click',async e=>{const button=e.target.closest('#detect-agents');if(!button)return;button.disabled=true;const status=$('#agent-status');status.textContent='正在扫描...';try{const agents=await api('/api/agents?force=true');status.innerHTML=agents.map(a=>'<p><strong>'+esc(a.label)+'</strong> · '+(a.available?'可用':'不可用')+(a.version?' · '+esc(a.version):'')+'<br><span class="small">'+esc(a.note)+'</span></p>').join('')}catch(err){status.textContent=err.message||String(err)}finally{button.disabled=false}});
document.addEventListener('mouseup',()=>{const s=window.getSelection(),article=$('#article'),bar=$('#toolbar');if(!article||!s||s.isCollapsed||!article.contains(s.anchorNode)||!article.contains(s.focusNode)){if(!bar.matches(':hover'))bar.style.display='none';return}const range=s.getRangeAt(0),quote=s.toString();selectionRange=range.cloneRange();if(!quote.trim())return;const prefix=document.createRange();prefix.selectNodeContents(article);prefix.setEnd(range.startContainer,range.startOffset);selection={file,locator:'text:offset:'+prefix.toString().length,quote};const rect=range.getBoundingClientRect();bar.style.display='block';bar.querySelectorAll('button').forEach(button=>button.hidden=false);bar.style.left=Math.max(8,Math.min(innerWidth-bar.offsetWidth-8,rect.left))+'px';bar.style.top=Math.max(8,rect.top-bar.offsetHeight-8)+'px'});
let trainingOpen=false,stage='listen-decompose',trainingTarget='',trainingProduced='',trainingView='',trainingResult=null,trainingAnchor=null,speechActive=false,selectionRange=null,speechGeneration=0,lastWheel=-Infinity;
function closeNavigation(){$('#navigation').hidden=true;$('#toggle-navigation').setAttribute('aria-expanded','false')}
document.addEventListener('click',e=>{const article=$('#article'),selected=window.getSelection();if(!article||!article.contains(e.target)||!selected||!selected.isCollapsed)return;const range=document.caretRangeFromPoint(e.clientX,e.clientY);if(!range||!article.contains(range.startContainer))return;selectionRange=range;selection={file,locator:'text:offset:0',quote:''};const bar=$('#toolbar');bar.style.display='block';bar.querySelectorAll('button').forEach(button=>button.hidden=button.dataset.action!=='speak');bar.style.left=Math.max(8,Math.min(innerWidth-bar.offsetWidth-8,e.clientX))+'px';bar.style.top=Math.max(8,e.clientY-bar.offsetHeight-8)+'px'});
function clearSpeechMark(){document.querySelectorAll('.pith-speech-active').forEach(mark=>{const parent=mark.parentNode;mark.replaceWith(...mark.childNodes);if(parent)parent.normalize()})}
function stopSpeech(){speechGeneration++;if('speechSynthesis' in window)window.speechSynthesis.cancel();speechActive=false;clearSpeechMark();if($('#training'))renderTraining()}
function startSpeech(fromSelection){
  if(!('speechSynthesis' in window)){notify('当前浏览器不支持语音朗读');return}
  const article=$('#article');if(!article)return;let startBlock=null,startOffset=0;
  if(fromSelection){if(!selectionRange){notify('请先选择正文');return}const node=selectionRange.startContainer;const element=node.nodeType===Node.ELEMENT_NODE?node:node.parentElement;startBlock=element&&element.closest('[data-prose]');if(!startBlock||startBlock.dataset.prose!=='true'||element.closest('pre,code,table,math,[data-prose="false"]')){notify('此处非正文段落，无法伴读');return}const prefix=document.createRange();prefix.selectNodeContents(startBlock);prefix.setEnd(node,selectionRange.startOffset);startOffset=prefix.toString().length}
  stopSpeech();const blocks=[...article.querySelectorAll('[data-prose="true"]')];const queue=[];const segmenter=new Intl.Segmenter(undefined,{granularity:'sentence'});for(const block of blocks){const text=block.textContent;for(const part of segmenter.segment(text)){const leading=part.segment.length-part.segment.trimStart().length;const value=part.segment.trim();if(value)queue.push({block,start:part.index+leading,end:part.index+leading+value.length,text:value})}}
  let index=0;if(fromSelection){index=queue.findIndex(item=>item.block===startBlock&&item.end>startOffset);if(index<0){notify('此处非正文段落，无法伴读');return}}
  if(!queue.length){notify('没有可朗读的正文');return}speechActive=true;const generation=++speechGeneration;renderTraining();
  const next=()=>{if(!speechActive||generation!==speechGeneration)return;if(index>=queue.length){stopSpeech();return}clearSpeechMark();const item=queue[index++];const walker=document.createTreeWalker(item.block,NodeFilter.SHOW_TEXT),nodes=[];let node,offset=0;while(node=walker.nextNode()){nodes.push({node,start:offset});offset+=node.length}for(const part of nodes){const a=Math.max(0,item.start-part.start),b=Math.min(part.node.length,item.end-part.start);if(a>=b)continue;const range=document.createRange();range.setStart(part.node,a);range.setEnd(part.node,b);const mark=document.createElement('span');mark.className='pith-speech-active';mark.dataset.speechActive='true';range.surroundContents(mark)}const reader=$('.reader'),active=item.block.querySelector('.pith-speech-active');if(active){const r=reader.getBoundingClientRect(),p=active.getBoundingClientRect();if(p.top<r.top||p.bottom>r.bottom)reader.scrollTop+=p.top-r.top-32}const status=$('#speech-status');if(status)status.textContent=index+' / '+queue.length;const utterance=new SpeechSynthesisUtterance(item.text);utterance.onend=next;utterance.onerror=()=>{if(generation===speechGeneration){stopSpeech();notify('朗读中断')}};window.speechSynthesis.speak(utterance)};next()
}
function turnPage(direction){const reader=$('.reader');if(reader)reader.scrollBy({top:direction*reader.clientHeight,behavior:'instant'})}
document.addEventListener('wheel',e=>{if(!e.target.closest('.reader')||e.ctrlKey||Math.abs(e.deltaY)<2)return;e.preventDefault();const now=performance.now();if(now-lastWheel<500)return;lastWheel=now;turnPage(Math.sign(e.deltaY))},{passive:false});
document.addEventListener('keydown',e=>{if(!topic||e.defaultPrevented||e.altKey||e.ctrlKey||e.metaKey||e.shiftKey||e.target.closest('input,textarea,select,button,[contenteditable="true"],.side,.drawer,.pith-left-drawer'))return;const direction=({ArrowUp:-1,ArrowLeft:-1,PageUp:-1,ArrowDown:1,ArrowRight:1,PageDown:1})[e.key];if(direction){e.preventDefault();turnPage(direction)}});
const stages=[['listen-decompose','意群拆解'],['guided-follow','原文'],['scaffold-cloze','骨干词'],['blind-produce','盲听诊断']];
function renderTraining(){const container=$('#training');if(!container)return;const enabled=topic.toolkits.includes('shadowing')||topic.toolkits.includes('dojo-shadowing');container.innerHTML='<div class="pith-dock-zone"><div class="pith-bottom-dock '+(speechActive||trainingOpen?'active':'')+'"><button id="read-aloud">'+(speechActive?'停止伴读':'🎧 伴读全文')+'</button><span class="speech-status" id="speech-status"></span><button id="open-dojo">🗣 4 阶跟读工坊</button></div></div>'+(enabled&&trainingOpen?'<section class="training-panel"><div class="stages" role="group" aria-label="跟读阶段">'+stages.map(s=>'<button class="button '+(stage===s[0]?'active':'')+'" data-stage="'+s[0]+'">'+s[1]+'</button>').join('')+'</div><label>目标文本<textarea id="dojo-target">'+esc(trainingTarget)+'</textarea></label><button class="button" id="use-selection">使用当前选区</button><button class="button" id="transform">应用阶段</button><div class="scaffold" id="scaffold">'+esc(trainingView)+'</div><label>复述文本<textarea id="dojo-produced">'+esc(trainingProduced)+'</textarea></label><button class="button primary" id="diagnose">诊断</button> <button class="button" id="save-diagnosis" '+(trainingResult?'':'disabled')+'>保存到笔记</button><div class="result" aria-live="polite">'+(trainingResult?'准确率 '+Math.round(trainingResult.accuracyScore*100)+'%　漏词：'+(trainingResult.missedTokens.length?trainingResult.missedTokens.map(w=>'<mark>'+esc(w)+'</mark>').join(' '):'无'):'')+'</div></section>':'')}
function trainingInput(){const t=$('#dojo-target'),p=$('#dojo-produced');if(t)trainingTarget=t.value;if(p)trainingProduced=p.value}
async function transformTraining(){trainingInput();if(!trainingTarget.trim()){trainingView='';renderTraining();return}trainingView=(await api('/api/dojo/transform',{topicId:topic.id,targetText:trainingTarget,stage})).text;renderTraining()}
document.addEventListener('click',async e=>{const t=e.target.closest('button');if(!t||!topic)return;try{if(t.id==='mount-dojo'){const enabled=topic.toolkits.includes('shadowing')||topic.toolkits.includes('dojo-shadowing');const toolkits=topic.toolkits.filter(x=>x!=='shadowing'&&x!=='dojo-shadowing');if(!enabled)toolkits.push('shadowing');await api('/api/topics/'+encodeURIComponent(topic.id)+'/toolkits',{toolkits});trainingOpen=!enabled;await openTopic(topic.id)}else if(t.id==='open-dojo'){if(!topic.toolkits.includes('shadowing')&&!topic.toolkits.includes('dojo-shadowing')){await api('/api/topics/'+encodeURIComponent(topic.id)+'/toolkits',{toolkits:[...topic.toolkits,'shadowing']});trainingOpen=true;await openTopic(topic.id);return}trainingOpen=!trainingOpen;if(trainingOpen&&selection&&selection.file===file){trainingAnchor=selection;trainingTarget=selection.quote}renderTraining();if(trainingOpen&&trainingTarget)await transformTraining()}else if(t.dataset.stage){stage=t.dataset.stage;await transformTraining()}else if(t.id==='use-selection'){if(!selection||selection.file!==file)throw Error('请先在正文中选择文本');trainingAnchor=selection;trainingTarget=selection.quote;renderTraining();await transformTraining()}else if(t.id==='transform'){await transformTraining()}else if(t.id==='diagnose'||t.id==='save-diagnosis'){trainingInput();const result=await api('/api/dojo/diagnose',{topicId:topic.id,file:trainingAnchor?trainingAnchor.file:file||'unknown',locator:trainingAnchor?trainingAnchor.locator:'text:offset:0',targetText:trainingTarget,producedText:trainingProduced,saveNote:t.id==='save-diagnosis'});trainingResult=result;if(t.id==='save-diagnosis')await openTopic(topic.id);else renderTraining()}else if(t.id==='read-aloud'){if(speechActive)stopSpeech();else startSpeech(false)}}catch(err){notify(err)}});
refresh().then(home).catch(notify);
</script></body></html>`;
