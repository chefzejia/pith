import assert from "node:assert/strict";
import { mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import { build } from "esbuild";
import type { AgentProcessPort, AgentProcessSpawnSpec, AgentStdioHandle } from "../src/core/index.ts";
import { PithObsidianController } from "../src/shells/obsidian/index.ts";
import { NodeWorkspaceStorage } from "../src/shells/web/nodeStorage.ts";
import { createPithWebServer } from "../src/shells/web/server.ts";
import { testSandbox } from "./sandbox.ts";

function createBoundaryPort(): AgentProcessPort {
  const installed: Record<string, { path: string; version: string; helpText?: string }> = {
    dsh: { path: "/bin/dsh", version: "dsh 0.4.5", helpText: "DeepSeek Harness ACP" },
    "claude-agent-acp": { path: "/bin/claude-agent-acp", version: "0.94.0" },
    "codex-acp": { path: "/bin/codex-acp", version: "0.8.1" },
    agy: { path: "/bin/agy", version: "1.9.0", helpText: "Antigravity Agent Client Protocol (ACP)" },
  };
  return {
    searchPaths: () => ["/bin"],
    async findExecutable(command) {
      return installed[command]?.path ?? null;
    },
    async probeExecutable(execPath, args) {
      const entry = Object.values(installed).find((item) => item.path === execPath);
      if (!entry) return null;
      if (args.includes("--version")) return entry.version;
      if (args.includes("--help")) return entry.helpText ?? null;
      return null;
    },
    async spawnStdio(spec: AgentProcessSpawnSpec): Promise<AgentStdioHandle> {
      const listeners = new Set<(line: string) => void>();
      const emit = (msg: unknown) => {
        const raw = JSON.stringify(msg);
        for (const fn of listeners) fn(raw);
      };
      return {
        cwd: "/isolated/browser-m71",
        onLine(fn) {
          listeners.add(fn);
          return () => listeners.delete(fn);
        },
        writeLine(line) {
          const req = JSON.parse(line) as { id?: number; method: string };
          if (req.id === undefined) return;
          if (req.method === "initialize") {
            emit({ jsonrpc: "2.0", id: req.id, result: { agentCapabilities: spec.command.includes("agy") ? {} : { mcpCapabilities: { http: true } } } });
            return;
          }
          if (req.method === "session/new") {
            const optionsByCommand = spec.command.includes("agy")
              ? [
                  { id: "model", name: "Model", type: "select", currentValue: "gemini-3-pro", options: [{ value: "gemini-3-pro", name: "Gemini 3 Pro" }, { value: "gemini-2.5-flash", name: "Gemini 2.5 Flash" }] },
                  { id: "thought_level", name: "Thinking", category: "thought_level", type: "select", currentValue: "high", options: [{ value: "low", name: "Low" }, { value: "high", name: "High" }] },
                  { id: "mode", name: "Mode", category: "mode", type: "select", currentValue: "default", options: [{ value: "default", name: "Default" }] },
                ]
              : spec.command.includes("codex")
                ? [
                    { id: "model", name: "Model", type: "select", currentValue: "gpt-5.3-codex", options: [{ value: "gpt-5.3-codex", name: "GPT-5.3 Codex" }] },
                    { id: "reasoning_effort", name: "Effort", category: "thought_level", type: "select", currentValue: "medium", options: [{ value: "low", name: "Low" }, { value: "xhigh", name: "Extra High" }] },
                    { id: "mode", name: "Mode", category: "mode", type: "select", currentValue: "read-only", options: [{ value: "read-only", name: "Read Only" }] },
                  ]
                : [
                    { id: "model", name: "Model", type: "select", currentValue: "old-model", options: [{ value: "old-model", name: "Old Model" }] },
                    { id: "reasoning_effort", name: "Effort", type: "select", currentValue: "xhigh", options: [{ value: "low", name: "Low" }, { value: "xhigh", name: "Extra High" }] },
                  ];
            emit({ jsonrpc: "2.0", id: req.id, result: { sessionId: "m71-session", configOptions: optionsByCommand } });
          }
        },
        async close() {},
      } as AgentStdioHandle;
    },
  };
}

test("M71 browser: Web and Obsidian settings support 4 agents, probe agy thought_level, and prevent delayed-save model/effort leakage", { timeout: 90000, skip: !process.env.PITH_PLAYWRIGHT_MODULE || !process.env.PITH_CHROME_PATH }, async () => {
  const { chromium } = await import(process.env.PITH_PLAYWRIGHT_MODULE!);
  const root = await testSandbox("m71-browser-");
  await mkdir(join(root, "web"));
  await mkdir(join(root, "native"));
  const processPort = createBoundaryPort();
  const server = await createPithWebServer({ workspaceDir: join(root, "web"), processPort });
  let browser: Awaited<ReturnType<typeof chromium.launchPersistentContext>> | undefined;

  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const base = `http://127.0.0.1:${address.port}`;
    browser = await chromium.launchPersistentContext(join(root, "profile"), {
      executablePath: process.env.PITH_CHROME_PATH,
      headless: true,
      viewport: { width: 1100, height: 820 },
      args: ["--no-first-run", "--no-default-browser-check"],
    });

    // 1. Web Settings Drawer: 4 agents + delayed save race + agy thought_level
    const page = await browser.newPage();
    page.setDefaultTimeout(10_000);
    let releaseCodexSave!: () => void;
    let enteredCodexSave!: () => void;
    let holdCodexSave = false;
    const codexSaveGate = new Promise<void>((resolve) => { releaseCodexSave = resolve; });
    const codexSaveEntered = new Promise<void>((resolve) => { enteredCodexSave = resolve; });

    await page.route("**/api/settings", async (route: any) => {
      const data = route.request().postDataJSON();
      if (holdCodexSave && data.agentId === "codex") {
        holdCodexSave = false;
        enteredCodexSave();
        await codexSaveGate;
      }
      await route.continue();
    });

    await page.goto(base);
    await page.locator("[data-home-settings]").click();
    await page.waitForFunction(() => (document.querySelector("#simple-agent") as HTMLSelectElement | null)?.value === "dsh");
    await page.waitForFunction(() => !!document.querySelector('#simple-model option[value="old-model"]'));

    const agentValues = await page.locator("#simple-agent option").evaluateAll((options: HTMLOptionElement[]) => options.map((o) => o.value)) as string[];
    assert.deepEqual(agentValues.filter((value) => value !== "unconfigured"), ["", "dsh", "claude", "codex", "agy"]);

    const saveModelOld = page.waitForResponse((res: any) => res.url().endsWith("/api/settings") && res.request().postDataJSON()?.model === "old-model");
    await page.locator("#simple-model").selectOption("old-model");
    await saveModelOld;
    const saveEffortXhigh = page.waitForResponse((res: any) => res.url().endsWith("/api/settings") && res.request().postDataJSON()?.effort === "xhigh");
    await page.locator("#simple-effort").selectOption("xhigh");
    await saveEffortXhigh;
    assert.equal((await (await fetch(`${base}/api/state`)).json()).settings.effort, "xhigh");

    // Delay POST /api/settings while switching to codex
    holdCodexSave = true;
    await page.locator("#simple-agent").selectOption("codex");
    await codexSaveEntered;

    // Wait for codex probe to finish while save is STILL pending
    await page.waitForFunction(() => !!document.querySelector('#simple-model option[value="gpt-5.3-codex"]'));
    assert.equal(await page.locator("#simple-model").inputValue(), "");
    assert.equal(await page.locator("#simple-effort").inputValue(), "");
    assert.equal(await page.locator('#simple-model option[value="old-model"]').count(), 0);

    const saveCodex = page.waitForResponse((res: any) => res.url().endsWith("/api/settings") && res.request().postDataJSON()?.agentId === "codex");
    releaseCodexSave();
    await saveCodex;
    const afterCodex = await (await fetch(`${base}/api/state`)).json() as { settings: { agentId: string; model: string; effort: string } };
    assert.deepEqual([afterCodex.settings.agentId, afterCodex.settings.model, afterCodex.settings.effort], ["codex", "", ""]);

    // Switch to agy and verify thought_level probing & selection
    const saveAgy = page.waitForResponse((res: any) => res.url().endsWith("/api/settings") && res.request().postDataJSON()?.agentId === "agy");
    await page.locator("#simple-agent").selectOption("agy");
    await saveAgy;
    await page.waitForFunction(() => !!document.querySelector('#simple-model option[value="gemini-3-pro"]'));
    assert.equal(await page.locator("#simple-model").inputValue(), "");
    assert.equal(await page.locator("#simple-effort").inputValue(), "");
    const saveAgyModel = page.waitForResponse((res: any) => res.url().endsWith("/api/settings") && res.request().postDataJSON()?.model === "gemini-3-pro");
    await page.locator("#simple-model").selectOption("gemini-3-pro");
    await saveAgyModel;
    const saveAgyEffort = page.waitForResponse((res: any) => res.url().endsWith("/api/settings") && res.request().postDataJSON()?.effort === "low");
    await page.locator("#simple-effort").selectOption("low");
    await saveAgyEffort;
    const afterAgy = await (await fetch(`${base}/api/state`)).json() as { settings: { agentId: string; model: string; effort: string } };
    assert.deepEqual([afterAgy.settings.agentId, afterAgy.settings.model, afterAgy.settings.effort], ["agy", "gemini-3-pro", "low"]);

    const screenshotDir = process.env.PITH_M71_SCREENSHOT_DIR || join(process.env.PITH_TEST_SCREENSHOT_DIR!, "m71");
    await mkdir(resolve(screenshotDir), { recursive: true });
    await page.screenshot({ path: join(resolve(screenshotDir), "web-settings-4agents-agy.png") });

    // 2. Obsidian PithSettingTab in Chromium with real PithObsidianController + NodeWorkspaceStorage
    const controller = new PithObsidianController({
      id: "obsidian",
      storage: new NodeWorkspaceStorage(join(root, "native")),
      process: processPort,
    });
    await controller.initialize();
    await controller.setAgentConfig({ agentId: "dsh", model: "old-model", effort: "xhigh" });

    const bundle = await build({
      entryPoints: ["src/shells/obsidian/index.ts"],
      bundle: true,
      write: false,
      platform: "browser",
      format: "iife",
      globalName: "NativePith",
      external: ["node:*", "obsidian"],
    });
    const native = await browser.newPage();
    native.setDefaultTimeout(10_000);
    await native.setContent('<style>body{font:14px system-ui;margin:24px;--background-modifier-border:#ddd;--text-muted:#666}#root{max-width:680px;margin:auto;padding:20px;border:1px solid #ddd;border-radius:8px}</style><div id="root"></div>');
    await native.evaluate(() => {
      (window as any).require = (id: string) => {
        if (id === "obsidian") return { ItemView: class {}, Plugin: class {}, Notice: class {}, PluginSettingTab: class { containerEl = document.getElementById("root"); } };
        if (id === "node:util") return { promisify: (fn: unknown) => fn };
        if (id === "node:net") return { BlockList: class { addSubnet() {} } };
        return {};
      };
    });
    let holdNativeSave = false;
    let releaseNativeSave!: () => void;
    let nativeSaveEntered!: () => void;
    let agyLowSaved!: () => void;
    const nativeSaveGate = new Promise<void>((resolve) => { releaseNativeSave = resolve; });
    const nativeSaveWait = new Promise<void>((resolve) => { nativeSaveEntered = resolve; });
    const agyLowSaveDone = new Promise<void>((resolve) => { agyLowSaved = resolve; });
    await native.exposeFunction("m71GetAgent", () => controller.getAgentConfig());
    await native.exposeFunction("m71IsConfigured", () => controller.isAgentConfigured());
    await native.exposeFunction("m71Detect", (force: boolean) => controller.detectAgents(force));
    await native.exposeFunction("m71Probe", (id: string, force: boolean) => controller.probeAgentOptions(id, force));
    await native.exposeFunction("m71SaveAgent", async (cfg: { agentId: "" | "dsh" | "claude" | "codex" | "agy"; model: string; effort: string }) => {
      if (holdNativeSave && cfg.agentId === "codex") {
        holdNativeSave = false;
        nativeSaveEntered();
        await nativeSaveGate;
      }
      await controller.setAgentConfig(cfg);
      if (cfg.agentId === "agy" && cfg.model === "gemini-3-pro" && cfg.effort === "low") {
        agyLowSaved();
      }
    });
    await native.addScriptTag({ content: bundle.outputFiles[0]!.text });
    await native.evaluate(async () => {
      const initial = await (window as any).m71GetAgent();
      const configured = await (window as any).m71IsConfigured();
      let cached = initial;
      const proxyController = {
        getAgentConfig: () => cached,
        isAgentConfigured: () => configured,
        detectAgents: (force: boolean) => (window as any).m71Detect(force),
        probeAgentOptions: (id: string, force: boolean) => (window as any).m71Probe(id, force),
        setAgentConfig: async (cfg: any) => {
          await (window as any).m71SaveAgent(cfg);
          cached = cfg;
          (window as any).m71Saved = cfg;
        },
        getSpeechConfig: () => ({ ttsProvider: "kokoro-local", asrProvider: "whisper-local" }),
        speechRuntimeState: async () => ({ supported: true, status: "stopped", note: "已安装" }),
        speechRuntimeVoices: async () => ({ defaultVoice: "zf_084", voices: [] }),
      };
      const tab = new (window as any).NativePith.PithSettingTab({}, { getWorkspacePath: () => "Pith", setWorkspacePath: async () => false }, proxyController);
      (window as any).m71Tab = tab;
      tab.display();
    });

    const nativeAgent = native.locator("label", { hasText: "本机 Agent" }).locator("select");
    const nativeModel = native.locator("label", { hasText: "模型（Model）" }).locator("select");
    const nativeEffort = native.locator("label", { hasText: "推理强度（Effort）" }).locator("select");
    await native.waitForFunction(() => !!document.querySelector('option[value="old-model"]'));
    assert.deepEqual(
      await nativeAgent.locator("option").evaluateAll((opts: HTMLOptionElement[]) => opts.map((o) => o.value)),
      ["", "dsh", "claude", "codex", "agy"],
    );

    holdNativeSave = true;
    await nativeAgent.selectOption("codex");
    await nativeSaveWait;
    await native.waitForFunction(() => !!document.querySelector('option[value="gpt-5.3-codex"]'));
    assert.equal(await nativeModel.inputValue(), "");
    assert.equal(await nativeEffort.inputValue(), "");
    assert.equal(await nativeModel.locator('option[value="old-model"]').count(), 0);
    releaseNativeSave();
    await native.waitForFunction(() => document.querySelector('#root > p[role="status"]')?.textContent?.includes("设置已保存"));
    assert.deepEqual(controller.getAgentConfig(), { agentId: "codex", model: "", effort: "" });

    await nativeAgent.selectOption("agy");
    await native.waitForFunction(() => !!document.querySelector('option[value="gemini-3-pro"]'));
    await nativeModel.selectOption("gemini-3-pro");
    await nativeEffort.selectOption("low");
    await agyLowSaveDone;
    await native.waitForFunction(() => (window as any).m71Saved?.effort === "low");
    assert.deepEqual(controller.getAgentConfig(), { agentId: "agy", model: "gemini-3-pro", effort: "low" });
    await native.screenshot({ path: join(resolve(screenshotDir), "obsidian-settings-4agents-agy.png") });
    controller.dispose();
  } finally {
    if (browser) await browser.close();
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    await rm(root, { recursive: true, force: true });
  }
});
