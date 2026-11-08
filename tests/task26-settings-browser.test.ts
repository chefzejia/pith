import assert from "node:assert/strict";
import { mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import { build } from "esbuild";
import { createPithWebServer } from "../src/shells/web/server.ts";
import { createObsidianHostPort, type ObsidianVaultAdapter } from "../src/shells/obsidian/index.ts";
import { testSandbox } from "./sandbox.ts";

test("Obsidian requires a valid Vault root before enabling managed speech", async () => {
  const dir = await testSandbox("pith-task26-root-");
  const previous = process.env.PITH_SPEECH_HOME; process.env.PITH_SPEECH_HOME = join(dir, "vault");
  try {
    for (const adapter of [{}, { getFullPath: () => "" }, { getFullPath: () => "relative" }, { getFullPath: () => { throw new Error("unavailable"); } }]) {
      assert.equal(createObsidianHostPort(adapter as ObsidianVaultAdapter).speechRuntime, undefined);
    }
    const vault = join(dir, "vault"); await mkdir(vault);
    const adapter = { getFullPath: () => vault } as unknown as ObsidianVaultAdapter;
    const runtime = createObsidianHostPort(adapter).speechRuntime;
    assert.ok(runtime && runtime.install);
    await assert.rejects(runtime.install(), /Vault/);
  } finally { if (previous === undefined) delete process.env.PITH_SPEECH_HOME; else process.env.PITH_SPEECH_HOME = previous; await rm(dir, { recursive: true, force: true }); }
});

test("Obsidian settings render the same protected runtime states", { timeout: 60000, skip: !process.env.PITH_PLAYWRIGHT_MODULE || !process.env.PITH_CHROME_PATH }, async () => {
  const dir = await testSandbox("pith-task26-obsidian-"); let browser: any;
  try {
    const bundle = await build({ entryPoints: ["src/shells/obsidian/index.ts"], bundle: true, write: false, platform: "browser", format: "iife", globalName: "NativePith", external: ["node:*", "obsidian"] });
    const { chromium } = await import(process.env.PITH_PLAYWRIGHT_MODULE!);
    browser = await chromium.launchPersistentContext(join(dir, "profile"), { executablePath: process.env.PITH_CHROME_PATH, headless: true, viewport: { width: 900, height: 900 } });
    const page = await browser.newPage();
    await page.setContent('<style>body{font:14px Arial;--background-modifier-border:#ddd;--text-muted:#666}#root{max-width:700px;margin:auto}</style><div id="root"></div>');
    await page.evaluate(() => { (window as any).require = (id: string) => id === "obsidian" ? { ItemView: class {}, Plugin: class {}, Notice: class {}, PluginSettingTab: class { containerEl = document.getElementById("root"); } } : id === "node:util" ? { promisify: (fn: unknown) => fn } : id === "node:net" ? { BlockList: class { addSubnet() {} } } : {}; });
    await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
    await page.evaluate(() => {
      const fixture: any = (window as any).fixture = { speech: { ttsProvider: "kokoro-local", asrProvider: "whisper-local" } };
      const controller = {
        getAgentConfig: () => ({ agentId: "", persona: "studio", model: "", effort: "" }), isAgentConfigured: () => true,
        detectAgents: async () => [], probeAgentOptions: async () => [], getSpeechConfig: () => fixture.speech,
        setSpeechMode: async (mode: string) => { fixture.speech = mode === "cloud" ? { ttsProvider: "openai", asrProvider: "openai-whisper" } : { ttsProvider: "kokoro-local", asrProvider: "whisper-local" }; },
        speechRuntimeState: async () => ({ supported: true, status: "failed", note: "fixture" }),
        speechRuntimeAction: async () => { throw new Error("fixture install failure"); },
      };
      new (window as any).NativePith.PithSettingTab({}, { getWorkspacePath: () => "Pith" }, controller).display();
    });
    await page.getByRole("button", { name: "重新安装" }).waitFor();
    assert.equal(await page.locator("#pith-runtime button").count(), 1);
    assert.equal(await page.locator("#pith-runtime").isVisible(), true);
    assert.equal(await page.getByLabel("API Key").isVisible(), false);
    await page.getByRole("button", { name: "重新安装" }).click();
    await page.getByText("安装异常：fixture install failure").waitFor();
    assert.equal(await page.getByRole("button", { name: "重新安装" }).isEnabled(), true);
    await page.waitForFunction(() => (document.querySelector('[aria-label="刷新本机 Agent"]') as HTMLButtonElement).disabled === false);
    assert.equal(await page.getByRole("button", { name: "刷新本机 Agent" }).textContent(), "↻");
    const evidence = resolve(".tmp/evidence/task-26"); await mkdir(evidence, { recursive: true });
    await page.screenshot({ path: join(evidence, "obsidian-settings.png") });
    await page.getByLabel("语音服务模式").selectOption("cloud");
    assert.equal(await page.locator("#pith-runtime").isVisible(), false);
    assert.equal(await page.getByLabel("API Key").isVisible(), true);
    assert.equal(await page.getByLabel("ASR 模型").isVisible(), true);
    assert.equal(await page.locator("details").count(), 0);
    assert.equal(await page.getByRole("button", { name: "检测连接" }).evaluate((el: HTMLElement) => el.previousElementSibling?.querySelectorAll("input").length), 5);
  } finally { if (browser) await browser.close(); await rm(dir, { recursive: true, force: true }); }
});

test("settings expose mutually exclusive speech controls and runtime transitions", { timeout: 60000, skip: !process.env.PITH_PLAYWRIGHT_MODULE || !process.env.PITH_CHROME_PATH }, async () => {
  const { chromium } = await import(process.env.PITH_PLAYWRIGHT_MODULE!);
  const dir = await testSandbox("pith-task26-settings-");
  const server = await createPithWebServer({ workspaceDir: dir });
  let browser: Awaited<ReturnType<typeof chromium.launchPersistentContext>> | undefined;
  try {
    const address = server.address(); assert.ok(address && typeof address !== "string");
    browser = await chromium.launchPersistentContext(join(dir, "profile"), { executablePath: process.env.PITH_CHROME_PATH, headless: true, viewport: { width: 1100, height: 850 } });
    const page = await browser.newPage();
    await page.route("**/api/agents?**", (route: any) => route.fulfill({ json: [] }));
    let release!: () => void, requested!: () => void;
    const gate = new Promise<void>(resolveGate => { release = resolveGate; });
    const entered = new Promise<void>(resolveEntered => { requested = resolveEntered; });
    let runtime = { supported: true, status: "not-installed", note: "fixture" };
    await page.route("**/api/speech/runtime", async (route: any) => {
      if (route.request().method() === "POST") {
        const action = route.request().postDataJSON().action;
        if (action === "install") { requested(); await gate; runtime = { supported: true, status: "stopped", note: "fixture" }; }
        else if (action === "remove") runtime = { supported: true, status: "not-installed", note: "fixture" };
        else runtime = { supported: true, status: "running", note: "fixture" };
      }
      await route.fulfill({ json: runtime });
    });
    await page.goto(`http://127.0.0.1:${address.port}`); await page.locator("[data-home-settings]").click();
    const scan = page.getByRole("button", { name: "刷新本机 Agent" });
    await page.waitForFunction(() => (document.querySelector('[aria-label="刷新本机 Agent"]') as HTMLButtonElement).disabled === false);
    assert.equal(await scan.textContent(), "↻");
    assert.equal(await scan.locator(".. ").evaluate((el: HTMLElement) => getComputedStyle(el).justifyContent), "flex-end");
    await page.locator("#simple-mode").selectOption("local");
    await page.getByRole("button", { name: "安装引擎" }).waitFor();
    assert.equal(await page.locator("#simple-cloud-fields").isVisible(), false);
    assert.equal(await page.locator("#simple-key-row").isVisible(), false);
    assert.equal(await page.locator("#simple-health").isVisible(), false);
    assert.equal(await page.locator("#speech-runtime button").count(), 1);
    const evidence = resolve(".tmp/evidence/task-26"); await mkdir(evidence, { recursive: true });
    await page.screenshot({ path: join(evidence, "web-local.png") });
    await page.getByRole("button", { name: "安装引擎" }).click(); await entered;
    assert.equal(await page.getByRole("button", { name: "正在安装…" }).isDisabled(), true);
    assert.match(await page.locator("#speech-runtime [role=status]").textContent(), /安装中/);
    release(); await page.getByRole("button", { name: "检测语音" }).waitFor();
    assert.equal(await page.getByRole("button", { name: "卸载" }).isVisible(), true);
    await page.getByRole("button", { name: "检测语音" }).click();
    await page.getByText("运行中", { exact: true }).waitFor();
    await page.getByRole("button", { name: "卸载" }).click();
    await page.getByRole("button", { name: "安装引擎" }).waitFor();
    await page.locator("#simple-mode").selectOption("cloud");
    assert.equal(await page.locator("#speech-runtime").isVisible(), false);
    assert.equal(await page.locator("#simple-cloud-fields input").count(), 5);
    assert.equal(await page.locator("#simple-cloud-fields").isVisible(), true);
    assert.equal(await page.locator("#simple-key-row").isVisible(), true);
    assert.equal(await page.locator("#drawer details").count(), 0);
    assert.equal(await page.locator("#simple-health").evaluate((el: HTMLElement) => el.previousElementSibling?.id), "simple-cloud-fields");
    await page.screenshot({ path: join(evidence, "web-cloud.png") });
  } finally { if (browser) await browser.close(); await new Promise<void>((resolveClose, reject) => server.close(error => error ? reject(error) : resolveClose())); await rm(dir, { recursive: true, force: true }); }
});
