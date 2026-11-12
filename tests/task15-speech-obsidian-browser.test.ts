import assert from "node:assert/strict";
import { build } from "esbuild";
import { rm } from "node:fs/promises";
import test from "node:test";
import { testSandbox } from "./sandbox.ts";

test("Obsidian speech retains only actual completion or failure and isolates immediate replay", { timeout: 60000, skip: !process.env.PITH_PLAYWRIGHT_MODULE || !process.env.PITH_CHROME_PATH }, async () => {
  const dir = await testSandbox("pith-obsidian-speech-result-");
  let browser: any;
  try {
    const bundle = await build({ entryPoints: ["src/shells/obsidian/plugin.ts"], bundle: true, write: false, platform: "browser", format: "iife", globalName: "PithView" });
    const { chromium } = await import(process.env.PITH_PLAYWRIGHT_MODULE!);
    browser = await chromium.launchPersistentContext(`${dir}/profile`, { executablePath: process.env.PITH_CHROME_PATH, headless: true });
    const page = await browser.newPage();
    await page.setContent('<style>html,body,#root{height:100%;margin:0}</style><div id="root"></div>');
    await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
    await page.evaluate(() => {
      const state: any = (window as any).speechTest = { requests: [], events: [] };
      const original = HTMLMediaElement.prototype.play;
      HTMLMediaElement.prototype.play = function () {
        this.addEventListener("ended", () => state.events.push("ended"), { once: true });
        this.addEventListener("playing", () => state.events.push("playing"), { once: true });
        return original.call(this);
      };
      state.resolve = (index: number) => {
        const samples = 12000, bytes = new Uint8Array(44 + samples * 2), data = new DataView(bytes.buffer);
        for (const [offset, value] of [[0, "RIFF"], [8, "WAVE"], [12, "fmt "], [36, "data"]] as const) for (let i = 0; i < value.length; i++) bytes[offset + i] = value.charCodeAt(i);
        data.setUint32(4, bytes.length - 8, true); data.setUint32(16, 16, true); data.setUint16(20, 1, true); data.setUint16(22, 1, true); data.setUint32(24, 24000, true); data.setUint32(28, 48000, true); data.setUint16(32, 2, true); data.setUint16(34, 16, true); data.setUint32(40, samples * 2, true);
        state.requests[index].resolve({ bytes, mimeType: "audio/wav" });
      };
      const view = new (window as any).PithView.PithObsidianView(document.getElementById("root"), { openFile() {}, selection() {}, openToolkit() {}, openSettings() {}, synthesizeSpeech: (text: string) => new Promise((resolve, reject) => state.requests.push({ text, resolve, reject })) });
      state.view = view; state.document = { title: "Speech", currentFile: "book.md", files: [], sections: [], format: "markdown", html: '<p data-prose="true">First sentence. Second sentence.</p>' }; view.render(state.document);
    });
    const read = page.locator('[data-command="read"]'), result = page.locator('.pith-speech-controls [role="status"]');
    await read.click();
    await page.waitForFunction(() => (window as any).speechTest.requests.length === 1);
    await page.evaluate(() => (window as any).speechTest.resolve(0));
    await page.waitForFunction(() => (window as any).speechTest.events.includes("playing"));
    await page.waitForFunction(() => (window as any).speechTest.events.filter((event: string) => event === "ended").length === 1);
    assert.equal(await result.getByText("本章听读完成").count(), 0);
    await page.evaluate(() => (window as any).speechTest.resolve(1));
    await result.getByText("本章听读完成").waitFor();
    assert.equal(await page.evaluate(() => (window as any).speechTest.events.filter((event: string) => event === "ended").length), 2);
    await page.clock.install(); await page.clock.fastForward(10000);
    assert.equal(await result.isVisible(), true);
    await page.locator('[data-command="speech-close"]').click(); assert.equal(await result.count(), 0);
    await read.click(); await page.evaluate(() => (window as any).speechTest.requests[2].reject(new Error("受控网关故障")));
    await page.locator('.pith-speech-controls [role="alert"]').getByText("受控网关故障").waitFor();
    await read.click(); assert.equal(await page.locator('.pith-speech-controls [role="alert"]').count(), 0);
    await page.evaluate(() => (window as any).speechTest.resolve(3));
    await page.waitForFunction(() => (window as any).speechTest.events.filter((event: string) => event === "playing").length === 3);
    await page.evaluate(() => { const read = document.querySelector<HTMLButtonElement>('[data-command="read"]')!; read.click(); read.click(); });
    await page.waitForFunction(() => (window as any).speechTest.requests.length === 6);
    await page.evaluate(() => (window as any).speechTest.resolve(5));
    await page.waitForFunction(() => (window as any).speechTest.requests.length === 7);
    await page.evaluate(() => (window as any).speechTest.resolve(6));
    await result.getByText("本章听读完成").waitFor({ timeout: 15000 });
    await page.evaluate(() => { const state = (window as any).speechTest; state.view.render({ ...state.document, currentFile: "next.md" }); });
    assert.equal(await result.count(), 0);
  } finally { if (browser) await browser.close(); await rm(dir, { recursive: true, force: true }); }
});
