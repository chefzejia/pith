import assert from "node:assert/strict";
import { build } from "esbuild";
import { readFile, rm } from "node:fs/promises";
import { resolve, sep } from "node:path";
import test from "node:test";
import { createPithWebServer } from "../src/shells/web/server.ts";
import { testSandbox } from "./sandbox.ts";

test("both shells record and transcribe guide and dojo input, and release tracks", { timeout: 60000, skip: !process.env.PITH_PLAYWRIGHT_MODULE || !process.env.PITH_CHROME_PATH }, async () => {
  const dir = await testSandbox("pith-voice-input-");
  const server = await createPithWebServer({ workspaceDir: dir });
  let browser: any;
  try {
    const address = server.address(); assert.ok(address && typeof address !== "string"); const base = `http://127.0.0.1:${address.port}`;
    const post = async (path: string, body: unknown) => { const response = await fetch(base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); assert.ok(response.ok); return response.json(); };
    const topic = await post("/api/topics", { title: "Voice" });
    await post("/api/materials", { topicId: topic.id, title: "Voice", kind: "article", files: [{ name: "voice.md", data: Buffer.from("Test voice input.").toString("base64") }] });
    await post(`/api/topics/${topic.id}/toolkits`, { toolkits: ["shadowing"] });
    const bundle = await build({ entryPoints: ["src/shells/obsidian/plugin.ts"], bundle: true, write: false, platform: "browser", format: "iife", globalName: "PithView" });
    const { chromium } = await import(process.env.PITH_PLAYWRIGHT_MODULE!);
    browser = await chromium.launchPersistentContext(`${dir}/profile`, { executablePath: process.env.PITH_CHROME_PATH, headless: true, args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] });
    await browser.grantPermissions(["microphone"], { origin: base });
    const page = await browser.newPage();
    await page.addInitScript(() => {
      const state: any = (window as any).voiceTest = { streams: [], calls: [] };
      navigator.mediaDevices.getUserMedia = async () => { const context = new AudioContext(); const source = context.createOscillator(); const destination = context.createMediaStreamDestination(); source.connect(destination); source.start(); await context.resume(); state.streams.push(destination.stream); return destination.stream; };
    });
    await page.route("**/api/speech/transcribe", async (route: any) => { const body = route.request().postDataJSON(); assert.equal(body.mimeType, "audio/webm"); assert.ok(Buffer.from(body.audio, "base64").length > 0); await route.fulfill({ json: { text: "recognized" } }); });
    await page.goto(base); await page.locator(`[data-open="${topic.id}"]`).first().click(); await page.locator("#toggle-side").click();
    for (const target of ["guide", "dojo"]) {
      if (target === "dojo") await page.locator("#open-dojo").click();
      const button = page.locator(`[data-voice="${target}"]`); await button.click(); await page.waitForFunction((value: string) => document.querySelector(`[data-voice="${value}"]`)?.getAttribute("aria-pressed") === "true", target);
      await page.waitForTimeout(300); await button.click(); await page.locator(target === "guide" ? "#message" : "#dojo-produced").evaluate((input: HTMLTextAreaElement) => new Promise<void>(resolve => { if (input.value.includes("recognized")) resolve(); else input.addEventListener("input", () => resolve(), { once: true }); }));
      assert.equal(await page.evaluate(() => (window as any).voiceTest.streams.at(-1).getTracks().every((track: MediaStreamTrack) => track.readyState === "ended")), true);
    }
    assert.equal(await page.locator("#asr-audio").count(), 0);
    await page.evaluate(() => { navigator.mediaDevices.getUserMedia = async () => { throw new Error("麦克风权限被拒绝"); }; });
    await page.locator('[data-voice="guide"]').click(); await page.waitForFunction(() => document.querySelector("#toast")?.textContent?.includes("麦克风权限被拒绝"));
    await page.goto(base); await page.setContent('<div id="root"></div>'); await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
    await page.evaluate(() => {
      const state: any = (window as any).voiceTest;
      const view = new (window as any).PithView.PithObsidianView(document.getElementById("root"), { openFile() {}, selection() {}, openDojo() {}, guideData: async () => ({ notes: [], conversation: [], actions: [], toolkits: ["shadowing"] }), transcribeAudio: async (bytes: Uint8Array, mime: string, signal: AbortSignal) => { state.calls.push({ size: bytes.length, mime }); if (state.defer) return new Promise(resolve => { state.signal = signal; state.finish = resolve; }); return { text: "recognized" }; } });
      state.view = view; document.body.append(view.guideElement()); view.render({ title: "Voice", currentFile: "voice.md", files: [], sections: [], format: "markdown", html: "<p>Voice</p>" }); view.setGuideVisible(true);
      state.dojo = { id: "shadowing", label: "跟读", stages: ["listen-decompose"], transformCue: (s: string) => s };
    });
    await page.evaluate(() => (window as any).voiceTest.view.refreshGuide());
    for (const target of ["guide", "dojo"]) {
      if (target === "dojo") await page.evaluate(() => (window as any).voiceTest.view.openDojo([(window as any).voiceTest.dojo]));
      const button = page.locator(`[data-voice="${target}"]`); await button.click(); await page.waitForFunction((value: string) => document.querySelector(`[data-voice="${value}"]`)?.getAttribute("aria-pressed") === "true", target); await page.waitForTimeout(300); await button.click();
      await page.locator(target === "guide" ? '.pith-guide textarea' : '[data-dojo-produced]').evaluate((input: HTMLTextAreaElement) => new Promise<void>(resolve => { if (input.value.includes("recognized")) resolve(); else input.addEventListener("input", () => resolve(), { once: true }); }));
      assert.equal(await page.evaluate(() => (window as any).voiceTest.streams.at(-1).getTracks().every((track: MediaStreamTrack) => track.readyState === "ended")), true);
    }
    const calls = await page.evaluate(() => (window as any).voiceTest.calls); assert.equal(calls.length, 2); assert.ok(calls.every((call: any) => call.size > 0 && call.mime === "audio/webm"));
    await page.evaluate(() => {
      const state: any = (window as any).voiceTest; const get = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia = async constraints => { const stream = await get(constraints); await new Promise<void>(resolve => { state.releasePermission = resolve; }); return stream; };
    });
    await page.locator('[data-voice="guide"]').click();
    await page.waitForFunction(() => Boolean((window as any).voiceTest.releasePermission));
    await page.evaluate(() => { const state: any = (window as any).voiceTest; state.view.setGuideVisible(false); state.releasePermission(); });
    await page.waitForFunction(() => (window as any).voiceTest.streams.at(-1).getTracks().every((track: MediaStreamTrack) => track.readyState === "ended"));
    assert.equal(await page.locator('[data-voice="guide"]').getAttribute("aria-pressed"), "false");
    await page.evaluate(() => { const state: any = (window as any).voiceTest; navigator.mediaDevices.getUserMedia = async () => { const context = new AudioContext(); const source = context.createOscillator(); const destination = context.createMediaStreamDestination(); source.connect(destination); source.start(); await context.resume(); state.streams.push(destination.stream); return destination.stream; }; state.view.setGuideVisible(true); state.defer = true; });
    await page.locator('[data-voice="guide"]').click(); await page.waitForFunction(() => document.querySelector('[data-voice="guide"]')?.getAttribute("aria-pressed") === "true"); await page.waitForTimeout(300); await page.locator('[data-voice="guide"]').click();
    await page.waitForFunction(() => Boolean((window as any).voiceTest.finish));
    await page.evaluate(() => { const state: any = (window as any).voiceTest; state.view.dispose(); state.finish({ text: "late" }); });
    assert.equal(await page.evaluate(() => (window as any).voiceTest.signal.aborted), true);
    assert.equal(await page.locator(".pith-guide").count(), 0);
  } finally { if (browser) await browser.close(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); await rm(dir, { recursive: true, force: true }); }
});

test("Web recorded WebM reaches the isolated native ASR", { timeout: 90000, skip: !process.env.PITH_SPEECH_TEST_HOME || !process.env.PITH_PLAYWRIGHT_MODULE || !process.env.PITH_CHROME_PATH }, async () => {
  const home = resolve(process.env.PITH_SPEECH_TEST_HOME!); assert.ok(home.startsWith(resolve(".tmp") + sep));
  const audio = await readFile(`${home}/test-en.wav`);
  const previous = process.env.PITH_SPEECH_HOME; process.env.PITH_SPEECH_HOME = home;
  const dir = await testSandbox("pith-voice-native-"); const server = await createPithWebServer({ workspaceDir: dir }); let browser: any;
  try {
    const address = server.address(); assert.ok(address && typeof address !== "string"); const base = `http://127.0.0.1:${address.port}`;
    const post = async (path: string, body: unknown) => { const response = await fetch(base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); assert.ok(response.ok); return response.json(); };
    const topic = await post("/api/topics", { title: "Native ASR" });
    await post("/api/materials", { topicId: topic.id, title: "Native ASR", kind: "article", files: [{ name: "voice.md", data: Buffer.from("Voice input test.").toString("base64") }] });
    const { chromium } = await import(process.env.PITH_PLAYWRIGHT_MODULE!);
    browser = await chromium.launchPersistentContext(`${dir}/profile`, { executablePath: process.env.PITH_CHROME_PATH, headless: true });
    const page = await browser.newPage(); await page.goto(base); await page.locator(`[data-open="${topic.id}"]`).first().click(); await page.locator("#toggle-side").click();
    await page.evaluate(async (data: number[]) => {
      const state: any = (window as any).nativeVoice = {}; const context = new AudioContext(); const buffer = await context.decodeAudioData(new Uint8Array(data).buffer);
      navigator.mediaDevices.getUserMedia = async () => { const destination = context.createMediaStreamDestination(); const source = context.createBufferSource(); source.buffer = buffer; source.connect(destination); state.source = source; state.done = new Promise<void>(resolve => { source.onended = () => resolve(); }); await context.resume(); return destination.stream; };
    }, [...audio]);
    const button = page.locator('[data-voice="guide"]'); await button.click(); await page.waitForFunction(() => document.querySelector('[data-voice="guide"]')?.getAttribute("aria-pressed") === "true");
    await page.evaluate(async () => { const state: any = (window as any).nativeVoice; state.source.start(); await state.done; }); await button.click();
    await page.waitForFunction(() => Boolean((document.querySelector("#message") as HTMLTextAreaElement).value), null, { timeout: 60000 });
    assert.match((await page.locator("#message").inputValue()).toLowerCase(), /reading a book together/);
  } finally { if (browser) await browser.close(); await new Promise<void>((resolveClose, reject) => server.close(error => error ? reject(error) : resolveClose())); if (previous === undefined) delete process.env.PITH_SPEECH_HOME; else process.env.PITH_SPEECH_HOME = previous; await rm(dir, { recursive: true, force: true }); }
});
