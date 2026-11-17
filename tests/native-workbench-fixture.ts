import { build } from "esbuild";
import { NodeWorkspaceStorage } from "../src/shells/web/nodeStorage.ts";
import { NodeRepositoryPort } from "../src/shells/web/nodeRepository.ts";

/** Obsidian API, storage/repository ports and guide provider are explicit host boundaries. All product controllers/stores/engine are real. */
export async function nativeWorkbenchFixture(page: any, directory: string, guide = false, options: { otherRightLeaf?: boolean; agentProcess?: boolean } = {}): Promise<void> {
  const storage = new NodeWorkspaceStorage(directory), repository = new NodeRepositoryPort();
  await page.exposeFunction("nativeStorage", async (method: string, args: any[]) => {
    if (method === "readBinary") return Array.from(await storage.readBinary(args[0]));
    if (method === "createBinary" || method === "writeBinary") return storage[method](args[0], new Uint8Array(args[1]));
    if (method === "list") return storage.list(args[0]);
    if (method === "exists") return storage.exists(args[0]);
    if (method === "readText") return storage.readText(args[0]);
    if (method === "createText" || method === "writeText") return storage[method](args[0], args[1]);
    if (method === "mkdir") return storage.mkdir(args[0]);
    if (method === "copy") return storage.copy(args[0], args[1]);
    throw new Error(`Unexpected host method: ${method}`);
  });
  await page.exposeFunction("nativeRepository", async (method: "inspectRepository" | "listFiles" | "readFile" | "searchFiles", args: any[]) => {
    if (method === "inspectRepository") return repository.inspectRepository(args[0]);
    if (method === "listFiles") return repository.listFiles(args[0], args[1], args[2], args[3]);
    if (method === "searchFiles") return repository.searchFiles(args[0], args[1], args[2]);
    return repository.readFile(args[0], args[1], args[2], args[3], args[4]);
  });
  const bundle = await build({ entryPoints: ["src/shells/obsidian/index.ts"], bundle: true, write: false, platform: "browser", format: "iife", globalName: "NativePith", external: ["node:*", "obsidian"] });
  const tools = await build({ entryPoints: ["tests/guide-tools-fixture.ts"], bundle: true, write: false, platform: "browser", format: "iife", globalName: "NativeTools" });
  await page.route("http://localhost:31552/**", (route: any) => route.fulfill({ contentType: "text/html", body: '<style>html,body,#root{height:100%;margin:0}body{--background-primary:#fcfbf8;--background-secondary:#f1f0ea;--background-modifier-border:#d5d8cf;--background-modifier-hover:#e4e9df;--text-normal:#283129;--text-muted:#70796e;--text-accent:#42664b;--font-interface:system-ui}button,input,textarea{font:inherit}button{padding:8px}</style><div id="root"></div>' }));
  await page.goto("http://localhost:31552/");
  await page.evaluate(() => { (window as any).require = (id: string) => id === "obsidian" ? { ItemView: class { contentEl: HTMLElement; constructor(leaf: any) { this.contentEl = leaf.contentEl ?? document.getElementById("root"); } }, Plugin: class {}, Notice: class { constructor(message: string) { (window as any).notice = message; } } } : id === "node:util" ? { promisify: (fn: unknown) => fn } : id === "node:net" ? { BlockList: class { addSubnet() {} } } : {}; });
  await page.addScriptTag({ content: bundle.outputFiles[0]!.text }); await page.addScriptTag({ content: tools.outputFiles[0]!.text });
  await page.evaluate(async ({ guide, otherRightLeaf, agentProcess }: { guide: boolean; otherRightLeaf?: boolean; agentProcess?: boolean }) => {
    const w = window as any, call = (method: string) => (...args: unknown[]) => w.nativeStorage(method, args), storage: any = {};
    for (const method of ["exists", "readText", "writeText", "createText", "list", "mkdir", "copy"]) storage[method] = call(method);
    storage.readBinary = async (path: string) => new Uint8Array(await call("readBinary")(path));
    for (const method of ["createBinary", "writeBinary"]) storage[method] = (path: string, value: Uint8Array) => call(method)(path, Array.from(value));
    // The host boundary serializes updates; the real store still owns ledger mutations.
    storage.processText = async (path: string, update: (current: string) => string) => { const text = update(await storage.readText(path)); await storage.writeText(path, text); return text; };
    const repository = Object.fromEntries(["inspectRepository", "listFiles", "readFile", "searchFiles"].map(method => [method, (...args: unknown[]) => w.nativeRepository(method, args)]));
    const process = agentProcess ? { findExecutable: async () => null, probeExecutable: async () => null, spawnStdio: async () => { throw new Error("No agent process is run by the native availability fixture"); } } : undefined;
    const host = { id: "obsidian", storage, repository, process }; let controller: any;
    const provider = { async run(input: any, options: any) {
      if (input.scope.kind !== "intake") throw new Error("Unexpected native guide turn");
      const tools = w.NativeTools.createScopedTools({ toolkits: w.NativeTools.testToolkits, store: controller.store, storage, materialIds: input.scope.materialIds, onChoices() {} });
      const create = tools.find((tool: any) => tool.name === "pith_create_topic"), args = { title: "理解材料的因果条件", target: input.text, materialIds: input.scope.materialIds, toolkits: ["feynman"] }, topic = await create.execute(args);
      options.onStep({ kind: "tool", callId: "create", name: create.name, inputPreview: "{}", status: "completed", effects: await create.effects(topic, args) }, 0); return { status: "completed" };
    } };
    controller = new w.NativePith.PithObsidianController(host, async (input: any) => new Map(input.segments.map((segment: any) => [segment.locator, "原生夹具译文"])), guide ? provider : undefined);
    await controller.initialize();
    let guideLeaf: any;
    const root = document.getElementById("root")!;
    // Observed Obsidian boundary: five default tabs survive guide detach. Only
    // collapsing the split reclaims its width; selecting another tab retains it.
    const hostTypes = ["backlink", "outgoing-link", "tag", "all-properties", "outline"];
    let currentTab = 4;
    const otherPanel = document.createElement("div"); otherPanel.dataset.otherHostLeaf = "outline"; otherPanel.style.cssText = "position:fixed;right:0;top:0;width:330px;height:100%";
    const outlineTab = document.createElement("button"); outlineTab.dataset.hostTab = "outline"; outlineTab.textContent = "Host outline"; otherPanel.append(outlineTab); document.body.append(otherPanel);
    const renderSplit = () => { const closed = workspace.rightSplit.collapsed; root.style.width = closed ? "" : "calc(100% - 330px)"; otherPanel.hidden = closed; if (guideLeaf) guideLeaf.contentEl.hidden = closed || currentTab !== 5; };
    outlineTab.onclick = () => { currentTab = 4; renderSplit(); };
    const workspace = { rightSplit: { collapsed: !otherRightLeaf, expand() { this.collapsed = false; renderSplit(); }, collapse() { this.collapsed = true; renderSplit(); } }, getLayout: () => ({ right: { type: "split", children: [{ type: "tabs", currentTab, children: [...hostTypes, ...(guideLeaf ? ["pith-guide"] : [])].map(type => ({ type: "leaf", state: { type } })) }] } }), getLeavesOfType: (type: string) => type === "pith-guide" ? guideLeaf ? [guideLeaf] : [] : type === "outline" ? [{ contentEl: otherPanel }] : [], getRightLeaf: () => {
      const panel = document.createElement("div"); panel.style.cssText = "position:fixed;right:0;top:48px;width:330px;height:calc(100% - 48px);background:var(--background-primary)";
      const leaf: any = { contentEl: panel, async detach() { await leaf.view?.onClose(); panel.remove(); if (guideLeaf === leaf) { guideLeaf = undefined; currentTab = 4; renderSplit(); } }, async setViewState() { leaf.view = new w.NativePith.PithGuideView(leaf); document.body.append(panel); currentTab = 5; guideLeaf = leaf; renderSplit(); } }; return leaf;
    }, async revealLeaf() {} };
    renderSplit();
    const view = new w.NativePith.PithWorkspaceView({}, controller, host, workspace, () => { w.settingsOpened = true; });
    w.nativeTask52 = { controller, view, workspace }; await view.onOpen();
  }, { guide, otherRightLeaf: options.otherRightLeaf, agentProcess: options.agentProcess });
}
