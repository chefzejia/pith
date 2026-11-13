import { createTestTopic } from "./topic-fixture.ts";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import { build } from "esbuild";
import { createPithWebServer } from "../src/shells/web/server.ts";
import { testSandbox } from "./sandbox.ts";

const close = (server: Server) => new Promise<void>((ok, fail) => server.close(error => error ? fail(error) : ok()));
const title = "试听段落", first = "The first visible paragraph is here.", second = "This second paragraph is the controlled speech target.";
const markdown = `# ${title}\n\n${first}\n\n${second}\n`;

test("both hosts keep clicked, selected and visible prose aligned with controlled HTTP speech", { timeout: 60000, skip: !process.env.PITH_PLAYWRIGHT_MODULE || !process.env.PITH_CHROME_PATH }, async () => {
  const root = await testSandbox("task34-target-"); let browser: any; let web: Server | undefined;
  const requests: string[] = []; const samples = 8000, wav = Buffer.alloc(44 + samples * 2);
  wav.write("RIFF", 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVEfmt ", 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(16000, 24); wav.writeUInt32LE(32000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write("data", 36); wav.writeUInt32LE(samples * 2, 40);
  const fixture = createServer(async (req, res) => {
    res.setHeader("access-control-allow-origin", "*"); res.setHeader("access-control-allow-headers", "content-type"); res.setHeader("access-control-allow-methods", "POST, OPTIONS");
    if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }
    if (req.method === "GET" && req.url === "/") { res.writeHead(200, { "content-type": "text/html" }); res.end("<!doctype html>"); return; }
    if (req.method !== "POST" || req.url !== "/v1/audio/speech") { res.writeHead(404); res.end(); return; }
    const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk)); requests.push(JSON.parse(Buffer.concat(chunks).toString()).input);
    res.writeHead(200, { "content-type": "audio/wav" }); res.end(wav);
  });
  try {
    await new Promise<void>(ok => fixture.listen(0, "127.0.0.1", ok)); const address = fixture.address(); assert.ok(address && typeof address !== "string"); const endpoint = `http://127.0.0.1:${address.port}/v1/audio/speech`;
    web = await createPithWebServer({ workspaceDir: root }); const webAddress = web.address(); assert.ok(webAddress && typeof webAddress !== "string"); const base = `http://127.0.0.1:${webAddress.port}`;
    const post = async (path: string, data: unknown) => { const response = await fetch(base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data) }); assert.ok(response.ok, await response.clone().text()); return response.json() as Promise<any>; };
    const topic = await createTestTopic(root, { title: "正文练习", toolkits: ["shadowing", "feynman"] }); await post("/api/materials", { title, kind: "article", topicId: topic.id, files: [{ name: "reading.md", mimeType: "text/markdown", data: Buffer.from(markdown).toString("base64") }] }); await post("/api/settings", { speech: { ttsProvider: "kokoro-local", ttsEndpoint: endpoint } });
    const native = await build({ entryPoints: ["src/shells/obsidian/index.ts"], bundle: true, write: false, platform: "browser", format: "iife", globalName: "NativePith", external: ["node:*", "obsidian"] });
    const { chromium } = await import(process.env.PITH_PLAYWRIGHT_MODULE!); browser = await chromium.launch({ executablePath: process.env.PITH_CHROME_PATH, headless: true, args: ["--autoplay-policy=no-user-gesture-required"] });
    const page = await browser.newPage({ viewport: { width: 1100, height: 800 } }); page.setDefaultTimeout(8000);
    const evidence = resolve(`${process.env.PITH_TEST_SCREENSHOT_DIR}/task-34`); await mkdir(evidence, { recursive: true });
    for (const host of ["web", "native"] as const) {
      if (host === "web") { await page.goto(base); await page.locator(`[data-topic="${topic.id}"]`).first().click(); }
      else {
        await page.goto(new URL(endpoint).origin); await page.setContent('<style>html,body,#root{height:100%;margin:0}body{--background-primary:#fff;--background-secondary:#f1f3ef;--background-modifier-border:#ccd5cd;--background-modifier-hover:#e1e9e2;--text-normal:#222;--text-muted:#666;--font-interface:Arial}</style><div id="root"></div>');
        await page.evaluate(() => { (window as any).require = (id: string) => id === "obsidian" ? { ItemView: class { contentEl = document.getElementById("root"); }, Plugin: class {}, Notice: class {} } : id === "node:util" ? { promisify: (fn: unknown) => fn } : id === "node:net" ? { BlockList: class { addSubnet() {} } } : {}; });
        await page.addScriptTag({ content: native.outputFiles[0]!.text });
        await page.evaluate(async ({ endpoint, markdown }: { endpoint: string; markdown: string }) => {
          const data = new Map<string, Uint8Array>(), folders = new Set<string>(), encoder = new TextEncoder(), decoder = new TextDecoder();
          const storage = { exists: async (path: string) => data.has(path) || folders.has(path), readText: async (path: string) => { if (!data.has(path)) throw new Error("missing " + path); return decoder.decode(data.get(path)); }, readBinary: async (path: string) => { const value = data.get(path); if (!value) throw new Error("missing " + path); return value; }, writeText: async (path: string, text: string) => { data.set(path, encoder.encode(text)); }, createText: async (path: string, text: string) => { if (data.has(path)) throw new Error("exists"); data.set(path, encoder.encode(text)); }, writeBinary: async (path: string, bytes: Uint8Array) => { data.set(path, bytes); }, createBinary: async (path: string, bytes: Uint8Array) => { if (data.has(path)) throw new Error("exists"); data.set(path, bytes); }, processText: async (path: string, update: (text: string) => string) => { const result = update(decoder.decode(data.get(path))); data.set(path, encoder.encode(result)); return result; }, mkdir: async (path: string) => { folders.add(path); }, list: async (path: string) => [...folders, ...data.keys()].filter(item => item.startsWith(path + "/") && !item.slice(path.length + 1).includes("/")).map(item => ({ path: item, type: folders.has(item) ? "folder" : "file" })) };
          const http = { request: async (spec: any) => { const response = await fetch(spec.url, { method: spec.method, headers: spec.headers, body: spec.body }); const bytes = new Uint8Array(await response.arrayBuffer()); return { status: response.status, headers: Object.fromEntries(response.headers), bytes, text: () => decoder.decode(bytes) }; } };
          const host = { id: "obsidian", storage, http }, controller = new (window as any).NativePith.PithObsidianController(host); await controller.initialize(); await controller.setSpeechConfig({ ttsProvider: "kokoro-local", ttsEndpoint: endpoint });
          const material = await controller.importMaterial({ title: "正文", kind: "article", files: [{ name: "reading.md", mimeType: "text/markdown", bytes: encoder.encode(markdown) }] }); const topic = await controller.store.createTopic({ title: "正文练习", target: "理解正文", materialIds: [material.id], toolkits: ["shadowing", "feynman"] });
          const view = new (window as any).NativePith.PithWorkspaceView({}, controller, host); await view.openTopic(topic.id); (window as any).nativeTarget = { controller, view };
        }, { endpoint, markdown });
      }
      const p1 = page.locator('.pith-article [data-locator="text:line:2"]'), p2 = page.locator('.pith-article [data-locator="text:line:4"]'); await p2.waitFor();
      await p2.click(); await page.locator('#open-toolkit').click(); await page.locator('[data-toolkit-choose="shadowing"]').click();
      assert.equal(await p2.locator('.pith-toolkit-source').textContent(), second); assert.equal(await p2.locator('[data-toolkit-display]').textContent(), second);
      const before = requests.length, response = page.waitForResponse((item: any) => item.request().method() === 'POST' && (item.url().includes('/audio/speech') || item.url().endsWith('/api/speech/synthesize'))); await page.locator('[data-toolkit-play-cue]').click(); await response; assert.equal(requests.length, before + 1); assert.equal(requests.at(-1), second);
      await page.screenshot({ path: join(evidence, `fix-${host}-clicked-prose.png`) });
      await page.locator('[data-command="typography"]').click(); await page.locator('[data-interline-mode="original"]').waitFor(); await page.locator('[data-command="typography"]').click(); await page.locator('#open-toolkit').click(); await page.locator('[data-toolkit-choose="feynman"]').click(); await page.locator('[data-toolkit-produced]').fill('Clicked explanation'); await page.locator('[data-toolkit-submit]').click(); await page.waitForFunction(() => document.querySelector('.pith-inline-toolkit [role="status"]')?.textContent?.includes('已记入'));
      const clickedNotes = host === 'web' ? (await (await fetch(base + '/api/state')).json() as any).compass.exploring[0].notes : await page.evaluate(async () => (await (window as any).nativeTarget.controller.store.listTopics())[0].notes); const clickedAnchor = clickedNotes.find((note: any) => note.body === 'Clicked explanation').anchor; assert.equal(clickedAnchor.quote, second); assert.equal(clickedAnchor.file, 'reading.md'); assert.equal(clickedAnchor.locator, 'text:line:4'); await page.locator('[data-toolkit-close]').click();
      await page.evaluate(() => { const block = document.querySelector('[data-locator="text:line:4"]')!, text = block.firstChild!; const selection = window.getSelection()!; selection.setBaseAndExtent(text, 5, text, 21); block.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); });
      await page.locator('#open-toolkit').click(); await page.locator('[data-toolkit-choose="shadowing"]').click(); await page.locator('[data-toolkit-stage="listen-decompose"]').click(); assert.equal(await p2.locator('[data-toolkit-display]').textContent(), second.slice(5, 21));
      const selectedResponse = page.waitForResponse((item: any) => item.request().method() === 'POST' && (item.url().includes('/audio/speech') || item.url().endsWith('/api/speech/synthesize'))); await page.locator('[data-toolkit-play-cue]').click(); await selectedResponse; assert.equal(requests.at(-1), second.slice(5, 21));
      await page.locator('#open-toolkit').click(); await page.locator('[data-toolkit-choose="feynman"]').click(); await page.locator('[data-toolkit-produced]').fill('Explanation'); await page.locator('[data-toolkit-submit]').click();
      await page.waitForFunction(() => document.querySelector('.pith-inline-toolkit [role="status"]')?.textContent?.includes('已记入')); const notes = host === 'web' ? (await (await fetch(base + '/api/state')).json() as any).compass.exploring[0].notes : await page.evaluate(async () => (await (window as any).nativeTarget.controller.store.listTopics())[0].notes); const selectedAnchor = notes.find((note: any) => note.body === 'Explanation').anchor; assert.equal(selectedAnchor.quote, second.slice(5, 21)); assert.equal(selectedAnchor.file, 'reading.md'); assert.match(selectedAnchor.locator, /^text:offset:/); await page.locator('[data-toolkit-close]').click();
      await page.evaluate(() => { window.getSelection()?.removeAllRanges(); const article = document.querySelector('.pith-article')!, block = article.querySelector('[data-locator="text:line:2"]')!; article.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); const overlay = document.createElement('section'); overlay.className = 'pith-inline-toolkit'; overlay.dataset.prose = 'false'; overlay.innerHTML = '<p data-prose="true">overlay must never be selected</p>'; article.insertBefore(overlay, block); const extra = document.createElement('span'); extra.className = 'pith-interline-subtitle'; extra.textContent = 'overlay text'; block.append(extra); }); await page.locator('#open-toolkit').click(); await page.locator('[data-toolkit-choose="shadowing"]').click(); await page.locator('[data-toolkit-stage="listen-decompose"]').click(); assert.equal(await p1.locator('[data-toolkit-display]').textContent(), first); await page.locator('[data-toolkit-close]').click();
      await page.evaluate(() => { document.querySelector('.pith-inline-toolkit')?.remove(); const block = document.querySelector<HTMLElement>('[data-locator="text:line:4"]')!; block.style.marginTop = '1100px'; block.scrollIntoView(); }); await page.locator('#open-toolkit').click(); await page.locator('[data-toolkit-choose="shadowing"]').click(); assert.equal(await p2.locator('[data-toolkit-display]').textContent(), second);
    }
  } finally { if (browser) await browser.close(); if (web) await close(web); await close(fixture); await rm(root, { recursive: true, force: true }); }
});
