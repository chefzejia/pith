import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import { build } from "esbuild";
import { PithObsidianController } from "../src/shells/obsidian/index.ts";
import { createPithWebServer } from "../src/shells/web/server.ts";
import { NodeHttpPort } from "../src/shells/web/nodeHttp.ts";
import { NodeWorkspaceStorage } from "../src/shells/web/nodeStorage.ts";
import { testSandbox } from "./sandbox.ts";

const voices = { defaultVoice: "zf_084", voices: [ { id: "af_maple", sid: 0, group: "英文音色 (af/bf)" }, { id: "zf_001", sid: 3, group: "中文女声 (zf)" }, { id: "zf_084", sid: 48, group: "中文女声 (zf)" }, { id: "zm_010", sid: 59, group: "中文男声 (zm)" } ] };
const stopped = { supported: true, status: "stopped" as const, note: "已安装" };

test("Web and Obsidian voice selection persists per mode and rejects stale queries", { timeout: 90000, skip: !process.env.PITH_PLAYWRIGHT_MODULE || !process.env.PITH_CHROME_PATH }, async () => {
  const root = await testSandbox("task30-settings-"); await mkdir(join(root, "workspace")); await mkdir(join(root, "native"));
  let requestedVoice = "";
  const audioServer = createServer(async (req, res) => { const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk)); requestedVoice = JSON.parse(Buffer.concat(chunks).toString()).voice; res.writeHead(200, { "content-type": "audio/wav" }); res.end(Buffer.from("RIFF-controlled-audio")); });
  await new Promise<void>(ok => audioServer.listen(0, "127.0.0.1", ok));
  const audioAddress = audioServer.address(); assert.ok(audioAddress && typeof audioAddress !== "string");
  let release!: (value: typeof voices) => void, entered!: () => void, calls = 0;
  const first = new Promise<typeof voices>(ok => { release = ok; }), requested = new Promise<void>(ok => { entered = ok; });
  const runtime = { getState: async () => stopped, ensureRunning: async () => ({ ...stopped, status: "running" as const, endpoint: `http://127.0.0.1:${audioAddress.port}/v1/audio/speech` }), getVoices: async () => { calls++; if (calls === 1) { entered(); return first; } return voices; } };
  const server = await createPithWebServer({ workspaceDir: join(root, "workspace"), speechRuntime: runtime });
  let browser: any;
  try {
    const address = server.address(); assert.ok(address && typeof address !== "string"); const base = `http://127.0.0.1:${address.port}`;
    const { chromium } = await import(process.env.PITH_PLAYWRIGHT_MODULE!); browser = await chromium.launchPersistentContext(join(root, "profile"), { executablePath: process.env.PITH_CHROME_PATH, headless: true, viewport: { width: 1100, height: 900 } });
    const page = await browser.newPage(); page.setDefaultTimeout(10000); await page.route("**/api/agents?**", (route: any) => route.fulfill({ json: [] }));
    let continueMode!: () => void, modeEntered!: () => void, holdCloud = true;
    const modeGate = new Promise<void>(ok => { continueMode = ok; }), modeRequested = new Promise<void>(ok => { modeEntered = ok; });
    await page.route("**/api/settings", async (route: any) => { if (holdCloud && route.request().postDataJSON().speechMode === "cloud") { holdCloud = false; modeEntered(); await modeGate; } await route.continue(); });
    await page.goto(base); await page.locator("[data-home-settings]").click(); await requested;
    await page.locator("#simple-mode").selectOption("cloud"); await modeRequested; const cloudSaved = page.waitForResponse((response: any) => response.url().endsWith("/api/settings") && response.request().postDataJSON()?.speech?.ttsVoice === "alloy-custom"); await page.locator('[data-speech-field="ttsVoice"]').fill("alloy-custom"); await page.locator('[data-speech-field="ttsVoice"]').dispatchEvent("change"); continueMode(); await cloudSaved; assert.equal(await page.locator('[data-speech-field="ttsVoice"]').inputValue(), "alloy-custom");
    await page.locator("#simple-mode").selectOption("local"); const select = page.getByLabel("朗读音色"); await page.waitForFunction(() => !!document.querySelector('#speech-voices option[value="zm_010"]'));
    const staleResponse = page.waitForResponse((response: any) => response.url().endsWith("/api/speech/voices"));
    release({ defaultVoice: "stale", voices: [{ id: "stale", sid: 0, group: "stale" }] }); await (await staleResponse).finished();
    await page.evaluate(() => new Promise<void>(resolveFrame => requestAnimationFrame(() => resolveFrame())));
    assert.equal(await page.locator('#speech-voices option[value="stale"]').count(), 0);
    assert.deepEqual(await select.locator("optgroup").evaluateAll((items: HTMLOptGroupElement[]) => items.map(item => item.label)), ["英文音色 (af/bf)", "中文女声 (zf)", "中文男声 (zm)"]);
    const localSaved = page.waitForResponse((response: any) => response.url().endsWith("/api/settings") && response.request().postDataJSON()?.speech?.ttsVoice === "zm_010"); await select.selectOption("zm_010"); await localSaved;
    const response = await page.evaluate(async () => { const result = await fetch('/api/speech/synthesize', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'test sentence' }) }); return result.status; }); assert.equal(response, 200); assert.equal(requestedVoice, "zm_010");
    const evidence = resolve(`${process.env.PITH_TEST_SCREENSHOT_DIR}/task-30`); await mkdir(evidence, { recursive: true }); await page.screenshot({ path: join(evidence, "web-voice.png") });
    await page.emulateMedia({ colorScheme: "dark" }); await page.screenshot({ path: join(evidence, "web-voice-dark.png") }); await page.emulateMedia({ colorScheme: "light" });
    await page.locator("#simple-mode").selectOption("cloud"); await page.waitForFunction(() => (document.querySelector('[data-speech-field="ttsVoice"]') as HTMLInputElement).value === 'alloy-custom');
    await page.locator("#simple-mode").selectOption("local"); await page.waitForFunction(() => (document.querySelector('#speech-voices select') as HTMLSelectElement).value === 'zm_010');
    await page.locator("#close-drawer").click(); await page.locator("[data-home-settings]").click(); await page.waitForFunction(() => (document.querySelector('#speech-voices select') as HTMLSelectElement)?.value === 'zm_010');

    const nativeRuntime = { getState: async () => stopped, getVoices: async () => voices };
    const controller = new PithObsidianController({ id: "obsidian", storage: new NodeWorkspaceStorage(join(root, "native")), http: new NodeHttpPort(), speechRuntime: nativeRuntime }); await controller.initialize();
    const bundle = await build({ entryPoints: ["src/shells/obsidian/index.ts"], bundle: true, write: false, platform: "browser", format: "iife", globalName: "NativePith", external: ["node:*", "obsidian"] });
    const native = await browser.newPage(); await native.setContent('<style>body{font:14px Arial;--background-modifier-border:#ddd;--text-muted:#666}#root{max-width:700px;margin:auto}</style><div id="root"></div>');
    await native.evaluate(() => { (window as any).require = (id: string) => id === "obsidian" ? { ItemView: class {}, Plugin: class {}, Notice: class {}, PluginSettingTab: class { containerEl = document.getElementById("root"); } } : id === "node:util" ? { promisify: (fn: unknown) => fn } : id === "node:net" ? { BlockList: class { addSubnet() {} } } : {}; });
    await native.exposeFunction("voiceState", () => controller.getSpeechConfig());
    await native.exposeFunction("voiceSetMode", async (mode: "local" | "cloud") => { await controller.setSpeechMode(mode); return controller.getSpeechConfig(); });
    await native.exposeFunction("voiceSave", async (config: Record<string, string>) => { await controller.setSpeechConfig(config); return controller.getSpeechConfig(); });
    await native.addScriptTag({ content: bundle.outputFiles[0]!.text });
    await native.evaluate(async (data: typeof voices) => { const fixture: any = (window as any).fixture = { speech: await (window as any).voiceState() }; const control = { getAgentConfig: () => ({ agentId: "", persona: "studio", model: "", effort: "" }), isAgentConfigured: () => true, detectAgents: async () => [], probeAgentOptions: async () => [], getSpeechConfig: () => fixture.speech, setSpeechConfig: async (config: Record<string,string>) => { fixture.speech = await (window as any).voiceSave(config); }, setSpeechMode: async (mode: string) => { fixture.speech = await (window as any).voiceSetMode(mode); }, speechRuntimeState: async () => ({ supported: true, status: "stopped", note: "已安装" }), speechRuntimeVoices: async () => data }; fixture.tab = new (window as any).NativePith.PithSettingTab({}, { getWorkspacePath: () => "Pith" }, control); fixture.tab.display(); }, voices);
    await native.waitForFunction(() => !!document.querySelector('#pith-voices option[value="zf_001"]'));
    await native.getByLabel("朗读音色").selectOption("zf_001"); await native.waitForFunction(() => (window as any).fixture.speech.ttsVoice === 'zf_001');
    await native.screenshot({ path: join(evidence, "obsidian-voice.png") });
    await native.getByLabel("语音服务模式").selectOption("cloud"); await native.getByLabel("音色", { exact: true }).fill("cloud-voice"); await native.getByLabel("音色", { exact: true }).dispatchEvent("change"); await native.waitForFunction(() => (window as any).fixture.speech.ttsVoice === 'cloud-voice');
    await native.getByLabel("语音服务模式").selectOption("local"); await native.waitForFunction(() => (document.querySelector('#pith-voices select') as HTMLSelectElement)?.value === 'zf_001');
    await native.evaluate(() => (window as any).fixture.tab.display()); await native.waitForFunction(() => (document.querySelector('#pith-voices select') as HTMLSelectElement)?.value === 'zf_001');
    await native.getByLabel("语音服务模式").selectOption("cloud"); await native.waitForFunction(() => (window as any).fixture.speech.ttsVoice === 'cloud-voice'); assert.equal(await native.getByLabel("音色", { exact: true }).inputValue(), "cloud-voice");
    controller.dispose();
  } finally { if (browser) await browser.close(); await new Promise<void>((ok, fail) => server.close(error => error ? fail(error) : ok())); await new Promise<void>((ok, fail) => audioServer.close(error => error ? fail(error) : ok())); await rm(root, { recursive: true, force: true }); }
});
