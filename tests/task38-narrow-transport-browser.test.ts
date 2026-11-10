import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { build } from "esbuild";

test("transport fits and remains operable in a narrow Obsidian content pane", { timeout: 30000, skip: !process.env.PITH_PLAYWRIGHT_MODULE || !process.env.PITH_CHROME_PATH }, async () => {
  const bundle = await build({ entryPoints: ["src/shells/obsidian/plugin.ts"], bundle: true, write: false, platform: "browser", format: "iife", globalName: "PithView" });
  const { chromium } = await import(process.env.PITH_PLAYWRIGHT_MODULE!);
  const browser = await chromium.launch({ executablePath: process.env.PITH_CHROME_PATH, headless: true, args: ["--autoplay-policy=no-user-gesture-required"] });
  try {
    const page = await browser.newPage({ viewport: { width: 700, height: 850 }, colorScheme: "dark" }); page.setDefaultTimeout(5000);
    await page.setContent(`<style>html,body{margin:0;height:100%;background:#202020;color:#ddd;font:14px sans-serif}body{display:flex}#left{width:56px;flex:none}#root{width:332px;height:100%;flex:none;--background-primary:#202020;--background-secondary:#292929;--background-modifier-border:#444;--background-modifier-hover:#333;--text-normal:#ddd;--text-muted:#aaa;--font-interface:sans-serif}#side{flex:1;position:relative;z-index:1;background:#202020}button{min-width:44px;min-height:44px;height:44px;padding:0 12px}</style><div id="left"></div><div id="root"></div><div id="side"></div>`);
    await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
    await page.evaluate(() => {
      const sampleRate = 8000, bytes = new Uint8Array(44 + sampleRate * 2 * 24), wav = new DataView(bytes.buffer); const write = (offset: number, text: string) => { for (let i = 0; i < text.length; i++) wav.setUint8(offset + i, text.charCodeAt(i)); };
      write(0, "RIFF"); wav.setUint32(4, bytes.length - 8, true); write(8, "WAVEfmt "); wav.setUint32(16, 16, true); wav.setUint16(20, 1, true); wav.setUint16(22, 1, true); wav.setUint32(24, sampleRate, true); wav.setUint32(28, sampleRate * 2, true); wav.setUint16(32, 2, true); wav.setUint16(34, 16, true); write(36, "data"); wav.setUint32(40, bytes.length - 44, true);
      const view = new (window as any).PithView.PithObsidianView(document.getElementById("root"), { openFile() {}, selection() {}, openDojo() {}, loadAudio: async () => bytes });
      (window as any).narrowView = view;
      view.render({ title: "Audio", currentFile: "clip.vtt", files: [{ name: "clip.wav", mimeType: "audio/wav" }], sections: [], html: `<section class="pith-timeline-stage">${[1, 5, 10, 15, 20].map((start, i) => `<div class="pith-cue" data-locator="time:${start}" data-end-sec="${start + 3}" data-prose="true">Sentence ${i + 1}</div>`).join("")}</section>` });
    });
    await page.waitForFunction(() => { const view = (window as any).narrowView; return view.assetAudio && view.assetAudio.readyState >= 1 && document.querySelectorAll('.pith-deck-marker').length === 5; });
    await mkdir(resolve(".tmp/evidence/task-38"), { recursive: true }); await page.screenshot({ path: resolve(".tmp/evidence/task-38/worker-native-pane.png") });
    const geometry = await page.evaluate(() => {
      const deck = document.querySelector<HTMLElement>(".pith-media-deck")!, bounds = deck.getBoundingClientRect(), buttons = Array.from(deck.querySelectorAll<HTMLElement>('[data-media]')); const track = deck.querySelector<HTMLElement>(".pith-deck-track")!.getBoundingClientRect();
      return { width: bounds.width, height: bounds.height, track: track.width, buttons: buttons.map(button => { const rect = button.getBoundingClientRect(), hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2); return { name: button.dataset.media, left: rect.left - bounds.left, right: rect.right - bounds.left, hit: Boolean(hit && button.contains(hit)) }; }) };
    });
    assert.equal(geometry.width, 332); assert.equal(geometry.height, 48); assert.equal(geometry.buttons.length, 5); assert.equal(await page.locator('.pith-media-deck input[type=range]').count(), 1); assert.ok(geometry.track >= 65, JSON.stringify(geometry));
    for (const button of geometry.buttons) assert.ok(button.left >= 0 && button.right <= geometry.width && button.hit, JSON.stringify(geometry));
    await page.locator('[data-media="play"]').click(); await page.waitForFunction(() => !(window as any).narrowView.assetAudio.paused); await page.locator('[data-media="play"]').click();
    const seek = page.locator('.pith-media-seek'), box = await seek.boundingBox(); assert.ok(box); await page.mouse.move(box.x + box.width * .2, box.y + box.height / 2); await page.mouse.down(); await page.mouse.move(box.x + box.width * .8, box.y + box.height / 2, { steps: 8 }); await page.mouse.up();
    assert.ok(await page.evaluate(() => (window as any).narrowView.assetAudio.currentTime > 12));
    await page.locator('.pith-deck-marker[data-cue-start="5"]').click(); assert.ok(Math.abs(await page.evaluate(() => (window as any).narrowView.assetAudio.currentTime) - 5) < .1);
    await page.locator('[data-media="forward"]').click(); assert.ok(await page.evaluate(() => (window as any).narrowView.assetAudio.currentTime > 19)); await page.locator('[data-media="back"]').click(); assert.ok(Math.abs(await page.evaluate(() => (window as any).narrowView.assetAudio.currentTime) - 5) < .1);
    await page.locator('[data-media="rate"]').click(); assert.equal(await page.evaluate(() => (window as any).narrowView.assetAudio.playbackRate), 1.25);
    await page.locator('[data-media="close"]').click(); assert.equal(await page.locator('.pith-media-deck').isHidden(), true);
  } finally { await browser.close(); }
});
