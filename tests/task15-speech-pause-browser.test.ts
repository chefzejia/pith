import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { createPithWebServer } from "../src/shells/web/server.ts";
import { testSandbox } from "./sandbox.ts";

test("speech pause waits for pending play in Web and Obsidian", { timeout: 45000, skip: !process.env.PITH_PLAYWRIGHT_MODULE || !process.env.PITH_CHROME_PATH }, async () => {
  const dir = await testSandbox("pith-speech-pause-"); let browser: any, server: Awaited<ReturnType<typeof createPithWebServer>> | undefined;
  try {
    await mkdir(join(dir, "workspace")); server = await createPithWebServer({ workspaceDir: join(dir, "workspace") });
    const address = server.address(); assert.ok(address && typeof address !== "string"); const base = `http://127.0.0.1:${address.port}`;
    const post = async (path: string, body: unknown) => { const response = await fetch(base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); assert.ok(response.ok); return response.json(); };
    const topic = await post("/api/topics", { title: "Pause" });
    await post("/api/materials", { topicId: topic.id, title: "Pause", kind: "article", files: [{ name: "read.md", data: Buffer.from("A sentence long enough for this test.").toString("base64") }] });
    const bundle = await build({ entryPoints: ["src/shells/obsidian/plugin.ts"], bundle: true, write: false, platform: "browser", format: "iife", globalName: "PithView" });
    const { chromium } = await import(process.env.PITH_PLAYWRIGHT_MODULE!);
    browser = await chromium.launchPersistentContext(join(dir, "profile"), { executablePath: process.env.PITH_CHROME_PATH, headless: true });
    const page = await browser.newPage();
    const wav = Buffer.alloc(44 + 24000 * 20); wav.write("RIFF"); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVEfmt ", 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(24000, 24); wav.writeUInt32LE(48000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write("data", 36); wav.writeUInt32LE(wav.length - 44, 40);
    await page.route("**/api/speech/synthesize", (route: any) => route.fulfill({ status: 200, contentType: "audio/wav", body: wav }));
    for (const shell of ["web", "obsidian"] as const) {
      if (shell === "web") { await page.goto(base); await page.locator(`[data-topic="${topic.id}"]`).first().click(); }
      else { await page.goto("about:blank"); await page.setContent('<style>html,body,#root{height:100%;margin:0}</style><div id="root"></div>'); await page.addScriptTag({ content: bundle.outputFiles[0]!.text }); await page.evaluate((bytes: number[]) => { const view = new (window as any).PithView.PithObsidianView(document.getElementById("root"), { openFile() {}, selection() {}, openToolkit() {}, synthesizeSpeech: async () => ({ bytes: new Uint8Array(bytes), mimeType: "audio/wav" }) }); view.render({ title: "Pause", currentFile: "read.md", files: [], sections: [], format: "markdown", html: '<p data-prose="true">A sentence long enough for this test.</p>' }); }, [...wav]); }
      await page.evaluate(() => { const original = HTMLMediaElement.prototype.play, state: any = (window as any).pauseTest = { pending: [], calls: 0 }; HTMLMediaElement.prototype.play = function () { const player = this; state.calls++; return new Promise<void>((resolve, reject) => { state.pending.push({ resolve: () => original.call(player).then(resolve, reject), reject }); }); }; });
      const read = page.locator('[data-command="read"]'), pause = page.locator('[data-media="play"]');
      await read.click(); await page.waitForFunction(() => (window as any).pauseTest.calls === 1); assert.equal(await pause.isDisabled(), true);
      await page.evaluate(() => (window as any).pauseTest.pending.shift().resolve()); await pause.waitFor({ state: "visible" }); await page.waitForFunction(() => !(document.querySelector('[data-media="play"]') as HTMLButtonElement).disabled);
      await pause.click(); assert.equal(await pause.getAttribute("aria-label"), "播放");
      await pause.click(); await page.waitForFunction(() => (window as any).pauseTest.calls === 2); assert.equal(await pause.isDisabled(), true);
      await page.evaluate(() => (window as any).pauseTest.pending.shift().resolve()); await page.waitForFunction(() => !(document.querySelector('[data-media="play"]') as HTMLButtonElement).disabled);
      await pause.click(); await pause.click(); await page.waitForFunction(() => (window as any).pauseTest.calls === 3);
      await page.evaluate(() => (window as any).pauseTest.pending.shift().reject(new Error("受控播放故障")));
      await page.locator('.pith-speech-controls [role="alert"]').getByText("受控播放故障").waitFor();
    }
  } finally { if (browser) await browser.close(); if (server) await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve())); await rm(dir, { recursive: true, force: true }); }
});
