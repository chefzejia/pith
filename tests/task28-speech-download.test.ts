import assert from "node:assert/strict";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { build } from "esbuild";
import { NodeManagedSpeechRuntime } from "../src/shells/speech/speechRuntime.ts";
import { createPithWebServer } from "../src/shells/web/server.ts";
import { testSandbox } from "./sandbox.ts";
import { createSpeechDownloadFixture } from "./task28-speech-fixture.ts";
import { downloadSpeechArchive, parseSystemProxy } from "../src/shells/speech/speechDownload.ts";

async function waitUntil<T>(read: () => Promise<T>, accept: (value: T) => boolean, timeout = 15000): Promise<T> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { const value = await read(); if (accept(value)) return value; await delay(100); }
  throw new Error("Timed out waiting for controlled download");
}

test("real managed download resumes after cancellation and reuses verified archives", { timeout: 60000 }, async () => {
  const root = await testSandbox("pith-task28-download-");
  const fixture = await createSpeechDownloadFixture(root, { chunkMs: 35 });
  const runtime = new NodeManagedSpeechRuntime({ home: join(root, "speech"), protectedRoot: join(root, "vault"), archives: fixture.overrides });
  try {
    const first = runtime.install(); const firstResult = Promise.allSettled([first]);
    const before = await waitUntil(() => runtime.getState(), state => state.status === "installing" && (state.progressPercent ?? 0) > 3);
    const later = await waitUntil(() => runtime.getState(), state => (state.progressPercent ?? 0) > (before.progressPercent ?? 0) + 3);
    assert.ok(later.downloadSizeMb && later.progressPercent && later.note.includes("MB"));
    const stopped = await runtime.stop(); await firstResult;
    assert.equal(stopped.status, "not-installed"); assert.equal((await runtime.getState()).status, "not-installed");
    const archive = join(root, "speech/managed-v2/node.tar.gz"), retained = (await stat(archive)).size;
    assert.ok(retained > 0);
    assert.equal((await runtime.install()).status, "stopped");
    assert.equal(fixture.requests.filter(item => item.name === "node.tar.gz")[1]!.range, `bytes=${retained}-`);
    assert.match(await readFile(join(root, "speech/managed-v2/installed"), "utf8"), /^pith-sherpa/);
    const count = fixture.requests.length;
    await rm(join(root, "speech/managed-v2/installed"));
    assert.equal((await runtime.install()).status, "stopped");
    assert.equal(fixture.requests.length, count, "verified archives must not be downloaded again");
  } finally { await runtime.stop(); await fixture.close(); await rm(root, { recursive: true, force: true }); }
});

test("real managed download retries a dropped connection with Range", { timeout: 60000 }, async () => {
  const root = await testSandbox("pith-task28-retry-"); const fixture = await createSpeechDownloadFixture(root, { disconnectFirst: true, chunkMs: 1 });
  const runtime = new NodeManagedSpeechRuntime({ home: join(root, "speech"), archives: fixture.overrides });
  try {
    assert.equal((await runtime.install()).status, "stopped");
    const calls = fixture.requests.filter(item => item.name === "node.tar.gz");
    assert.ok(calls.length >= 2 && calls[1]!.start > 0); assert.equal(calls[1]!.range, `bytes=${calls[1]!.start}-`);
  } finally { await runtime.stop(); await fixture.close(); await rm(root, { recursive: true, force: true }); }
});

test("incorrect archive hashes never install", { timeout: 60000 }, async () => {
  const root = await testSandbox("pith-task28-badhash-"); const fixture = await createSpeechDownloadFixture(root, { chunkMs: 0 });
  const runtime = new NodeManagedSpeechRuntime({ home: join(root, "speech"), archives: { ...fixture.overrides, "node.tar.gz": { ...fixture.overrides["node.tar.gz"]!, hash: "0".repeat(64) } } });
  try { await assert.rejects(runtime.install(), /校验失败/); assert.equal(fixture.requests.filter(item => item.name === "node.tar.gz").length, 4); assert.equal((await runtime.getState()).status, "failed"); await assert.rejects(readFile(join(root, "speech/managed-v2/installed")), { code: "ENOENT" }); }
  finally { await runtime.stop(); await fixture.close(); await rm(root, { recursive: true, force: true }); }
});

test("low-speed transfer retries from its retained offset", { timeout: 30000 }, async () => {
  const root = await testSandbox("pith-task28-low-speed-"); const fixture = await createSpeechDownloadFixture(root, { stallFirst: true, chunkMs: 0 });
  const runtime = new NodeManagedSpeechRuntime({ home: join(root, "speech"), archives: fixture.overrides, downloadPolicy: { connectTimeoutSec: 2, lowSpeedBytes: 1000000, lowSpeedSeconds: 1, backoffMs: 10 } });
  try { assert.equal((await runtime.install()).status, "stopped"); const requests = fixture.requests.filter(item => item.name === "node.tar.gz"); assert.ok(requests.length >= 2 && requests[1]!.start > 0); }
  finally { await runtime.stop(); await fixture.close(); await rm(root, { recursive: true, force: true }); }
});

for (const behavior of ["invalid", "malformed", "unknown416"] as const) test(`refused or invalid Range (${behavior}) preserves the exact partial archive`, { timeout: 30000 }, async () => {
  const root = await testSandbox("pith-task28-refused-range-");
  const fixture = await createSpeechDownloadFixture(root, { rangeBehavior: behavior, chunkMs: 0 });
  const path = join(root, "partial.tar.gz");
  const partial = (await readFile(join(root, "archives/node.tar.gz"))).subarray(0, 131072);
  await writeFile(path, partial);
  try {
    await assert.rejects(downloadSpeechArchive(path, { ...fixture.overrides["node.tar.gz"]!, algorithm: "sha256", encoding: "hex", maxBytes: 10000000 }, new AbortController().signal, () => {}), /保留.*分片/);
    assert.deepEqual(await readFile(path), partial);
    assert.equal(fixture.requests[0]!.range, `bytes=${partial.length}-`);
  } finally { await fixture.close(); await rm(root, { recursive: true, force: true }); }
});

test("system proxy parsing uses enabled local endpoints only", () => {
  assert.equal(parseSystemProxy("HTTPSEnable : 1\nHTTPSProxy : 127.0.0.1\nHTTPSPort : 7890\n"), "http://127.0.0.1:7890");
  assert.equal(parseSystemProxy("HTTPEnable : 1\nHTTPProxy : localhost\nHTTPPort : 8080\n"), "http://localhost:8080");
  assert.equal(parseSystemProxy("HTTPSEnable : 0\nHTTPSProxy : 127.0.0.1\nHTTPSPort : 7890\n"), undefined);
  assert.equal(parseSystemProxy("HTTPSEnable : 1\nHTTPSProxy : remote.example\nHTTPSPort : 7890\n"), undefined);
});

for (const shell of ["web", "obsidian"] as const) test(`${shell} settings drive real controlled installation and cancellation`, { timeout: 90000, skip: !process.env.PITH_PLAYWRIGHT_MODULE || !process.env.PITH_CHROME_PATH }, async () => {
  const root = await testSandbox(`pith-task28-${shell}-`); const workspace = join(root, "workspace"); await mkdir(workspace);
  const fixture = await createSpeechDownloadFixture(root, { chunkMs: 80 });
  const runtime = new NodeManagedSpeechRuntime({ home: join(root, "speech"), protectedRoot: workspace, archives: fixture.overrides });
  const { chromium } = await import(process.env.PITH_PLAYWRIGHT_MODULE!);
  let browser: any; let web: Awaited<ReturnType<typeof createPithWebServer>> | undefined;
  try {
    browser = await chromium.launchPersistentContext(join(root, "profile"), { executablePath: process.env.PITH_CHROME_PATH, headless: true, viewport: { width: 1100, height: 850 } });
    const page = await browser.newPage(); page.setDefaultTimeout(15000);
    if (shell === "web") {
      web = await createPithWebServer({ workspaceDir: workspace, speechRuntime: runtime });
      const address = web.address(); assert.ok(address && typeof address !== "string");
      await page.route("**/api/agents?**", (route: any) => route.fulfill({ json: [] }));
      await page.goto(`http://127.0.0.1:${address.port}`); await page.locator("[data-home-settings]").click(); await page.locator("#simple-mode").selectOption("local");
    } else {
      const bundle = await build({ entryPoints: ["src/shells/obsidian/index.ts"], bundle: true, write: false, platform: "browser", format: "iife", globalName: "NativePith", external: ["node:*", "obsidian"] });
      await page.setContent('<style>body{font:14px Arial;--background-modifier-border:#ddd;--text-muted:#666}#root{max-width:700px;margin:auto}</style><div id="root"></div>');
      await page.evaluate(() => { (window as any).require = (id: string) => id === "obsidian" ? { ItemView: class {}, Plugin: class {}, Notice: class {}, PluginSettingTab: class { containerEl = document.getElementById("root"); } } : id === "node:util" ? { promisify: (fn: unknown) => fn } : id === "node:net" ? { BlockList: class { addSubnet() {} } } : {}; });
      await page.exposeFunction("task28State", () => runtime.getState());
      await page.exposeFunction("task28Action", (action: "install" | "ensureRunning" | "stop" | "remove") => runtime[action]());
      await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
      await page.evaluate(() => { const controller = { getAgentConfig: () => ({ agentId: "", persona: "studio", model: "", effort: "" }), isAgentConfigured: () => true, detectAgents: async () => [], probeAgentOptions: async () => [], getSpeechConfig: () => ({ ttsProvider: "kokoro-local", asrProvider: "whisper-local" }), speechRuntimeState: () => (window as any).task28State(), speechRuntimeAction: (action: string) => (window as any).task28Action(action) }; (window as any).tab = new (window as any).NativePith.PithSettingTab({}, { getWorkspacePath: () => "Pith" }, controller); (window as any).tab.display(); });
    }
    await page.getByRole("button", { name: "安装引擎" }).click();
    const progress = page.getByRole("progressbar", { name: "安装进度" });
    await page.waitForFunction(() => { const bar = document.querySelector('progress[aria-label="安装进度"]') as HTMLProgressElement | null; return bar && bar.hasAttribute("value") && bar.value > 2; });
    const first = Number(await progress.getAttribute("value"));
    await page.waitForFunction((value: number) => { const bar = document.querySelector('progress[aria-label="安装进度"]') as HTMLProgressElement | null; return bar && bar.value > value + 3; }, first);
    assert.match(await page.locator(shell === "web" ? "#speech-runtime [role=status]" : "#pith-runtime [role=status]").textContent(), /MB.*%/);
    const evidence = resolve(".tmp/evidence/task-28"); await mkdir(evidence, { recursive: true }); await page.screenshot({ path: join(evidence, `${shell}-progress.png`) });
    if (shell === "web") { await page.locator("#close-drawer").click(); await page.locator("[data-home-settings]").click(); }
    else await page.evaluate(() => (window as any).tab.display());
    assert.equal(fixture.requests.filter(item => item.name === "node.tar.gz").length, 1, "reopening must not start another download");
    await page.getByRole("button", { name: "取消安装" }).click();
    await page.getByRole("button", { name: "安装引擎" }).waitFor();
    const retained = (await stat(join(root, "speech/managed-v2/node.tar.gz"))).size; assert.ok(retained > 0);
    await page.getByRole("button", { name: "安装引擎" }).click();
    await page.getByRole("button", { name: "检测语音" }).waitFor({ timeout: 30000 });
    assert.equal(fixture.requests.filter(item => item.name === "node.tar.gz")[1]!.range, `bytes=${retained}-`);
    assert.equal((await runtime.getState()).status, "stopped");
  } finally { await runtime.stop(); if (web) await new Promise<void>((ok, fail) => web!.close(error => error ? fail(error) : ok())); if (browser) await browser.close(); await fixture.close(); await rm(root, { recursive: true, force: true }); }
});

test("a canceled install settling late cannot overwrite the next install", { timeout: 30000, skip: !process.env.PITH_PLAYWRIGHT_MODULE || !process.env.PITH_CHROME_PATH }, async () => {
  const root = await testSandbox("pith-task28-late-"); const { chromium } = await import(process.env.PITH_PLAYWRIGHT_MODULE!);
  let browser: any;
  try {
    const bundle = await build({ entryPoints: ["src/workbench/speechRuntimeSettings.ts"], bundle: true, write: false, platform: "browser", format: "iife", globalName: "SpeechSettings" });
    browser = await chromium.launchPersistentContext(join(root, "profile"), { executablePath: process.env.PITH_CHROME_PATH, headless: true });
    const page = await browser.newPage(); await page.setContent('<div id="panel"></div>'); await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
    await page.evaluate(() => {
      const fixture: any = (window as any).fixture = { state: { supported: true, status: "not-installed", note: "fixture" }, pending: [] };
      const act = (action: string) => {
        if (action === "stop") { fixture.state = { supported: true, status: "not-installed", note: "stopped" }; return Promise.resolve(fixture.state); }
        fixture.state = { supported: true, status: "installing", note: "new download", progressPercent: 12 };
        return new Promise((resolve, reject) => fixture.pending.push({ resolve, reject }));
      };
      (window as any).SpeechSettings.renderSpeechRuntimeSettings(document.getElementById("panel"), async () => fixture.state, act, () => true);
    });
    await page.getByRole("button", { name: "安装引擎" }).click();
    await page.getByRole("button", { name: "取消安装" }).click();
    await page.getByRole("button", { name: "安装引擎" }).click();
    await page.evaluate(() => (window as any).fixture.pending[0].reject(new Error("late canceled operation")));
    await page.waitForFunction(() => (window as any).fixture.pending.length === 2);
    assert.equal(await page.getByRole("button", { name: "取消安装" }).isEnabled(), true);
    assert.doesNotMatch(await page.locator('[role="status"]').textContent(), /安装异常|late canceled/);
    await page.evaluate(() => { const fixture = (window as any).fixture; fixture.state = { supported: true, status: "stopped", note: "done" }; fixture.pending[1].resolve(fixture.state); });
    await page.getByRole("button", { name: "检测语音" }).waitFor();
  } finally { if (browser) await browser.close(); await rm(root, { recursive: true, force: true }); }
});
