import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { testSandbox } from "./sandbox.ts";
import { renderEpub } from "../src/plugins/stage-reader/epub.ts";
import { createPithWebServer } from "../src/shells/web/server.ts";
import { linkedEpub } from "./wave12-epub-fixture.ts";

test("reader speech checks visible words across chapters in both rendered shells", { timeout: 30000, skip: !process.env.PITH_PLAYWRIGHT_MODULE || !process.env.PITH_CHROME_PATH }, async () => {
  const { chromium } = await import(process.env.PITH_PLAYWRIGHT_MODULE!);
  const dir = await testSandbox("pith-reader-behavior-");
  let browser: Awaited<ReturnType<typeof chromium.launchPersistentContext>> | undefined;
  let server: Awaited<ReturnType<typeof createPithWebServer>> | undefined;
  try {
    const bytes = linkedEpub(), doc = await renderEpub(bytes);
    const bundle = await build({ entryPoints: ["src/shells/obsidian/plugin.ts"], bundle: true, write: false, platform: "browser", format: "iife", globalName: "PithView" });
    await mkdir(join(dir, "workspace"));
    server = await createPithWebServer({ workspaceDir: join(dir, "workspace") });
    const address = server.address(); assert.ok(address && typeof address !== "string");
    const base = `http://127.0.0.1:${address.port}`;
    const post = async (path: string, value: unknown) => { const response = await fetch(base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(value) }); assert.ok(response.ok); return response.json(); };
    const topic = await post("/api/topics", { title: "Speech visibility" });
    await post("/api/materials", { topicId: topic.id, title: "Speech", kind: "book", files: [{ name: "book.epub", data: Buffer.from(bytes).toString("base64") }] });
    browser = await chromium.launchPersistentContext(join(dir, "profile"), { executablePath: process.env.PITH_CHROME_PATH, headless: true, viewport: { width: 1000, height: 700 }, args: ["--no-first-run", "--no-default-browser-check"] });
    const page = await browser.newPage();
    const spoken: string[] = [];
    let heard = () => {};
    await page.route("**/api/speech/synthesize", async (route: any) => { spoken.push(JSON.parse(route.request().postData()).text); heard(); await route.fulfill({ status: 503, body: "unavailable" }); });
    for (const shell of ["web", "obsidian"] as const) {
      spoken.length = 0;
      if (shell === "web") { await page.goto(base); await page.locator(`[data-open="${topic.id}"]`).first().click(); }
      else {
        await page.setContent('<style>html,body,#root{height:100%;margin:0}</style><div id="root"></div>');
        await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
        await page.exposeFunction("recordSpeech", (text: string) => { spoken.push(text); heard(); throw new Error("unavailable"); });
        await page.evaluate((value: unknown) => { const view = new (window as any).PithView.PithObsidianView(document.getElementById("root"), { openFile() {}, selection() {}, openDojo() {}, synthesizeSpeech: (text: string) => (window as any).recordSpeech(text) }); view.render({ ...(value as object), currentFile: "book.epub", files: [], title: "Speech" }); }, doc);
      }
      const article = page.locator(shell === "web" ? ".reader > #article" : ".pith-article");
      const button = page.locator(shell === "web" ? "#read-aloud" : '[data-command="read"]');
      await article.evaluate((node: HTMLElement) => { node.innerHTML = '<section class="pith-epub-chapter"><p data-prose="true"><span>。</span><span style="position:fixed;left:3000px">Later words</span></p></section>'; });
      await button.click();
      assert.match((await page.locator(".pith-toast-tip").textContent()) || "", /当前页面没有可朗读的正文段落/);
      assert.deepEqual(spoken, []);
      await article.evaluate((node: HTMLElement) => { node.insertAdjacentHTML("beforeend", '<section class="pith-epub-chapter" style="break-before:auto"><p data-prose="true">Visible words.</p></section>'); });
      const request = new Promise<void>(resolve => { heard = resolve; });
      await button.click();
      await Promise.race([request, new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`${shell}: speech request missing`)), 3000))]);
      assert.deepEqual(spoken, ["Visible words."]);
      if (shell === "web") {
        await page.locator("#speech-settings").click();
        assert.equal(await page.locator("#drawer #simple-mode").count(), 1);
      }
    }
  } finally {
    if (browser) await browser.close();
    if (server) await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve()));
    await rm(dir, { recursive: true, force: true });
  }
});

test("Web clears quoted text between topics and retains per-topic guide visibility", { timeout: 30000, skip: !process.env.PITH_PLAYWRIGHT_MODULE || !process.env.PITH_CHROME_PATH }, async () => {
  const { chromium } = await import(process.env.PITH_PLAYWRIGHT_MODULE!);
  const dir = await testSandbox("pith-navigation-behavior-");
  let browser: Awaited<ReturnType<typeof chromium.launchPersistentContext>> | undefined;
  let server: Awaited<ReturnType<typeof createPithWebServer>> | undefined;
  try {
    await mkdir(join(dir, "workspace"));
    server = await createPithWebServer({ workspaceDir: join(dir, "workspace") });
    const address = server.address(); assert.ok(address && typeof address !== "string");
    const base = `http://127.0.0.1:${address.port}`;
    const post = async (path: string, value: unknown) => { const response = await fetch(base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(value) }); assert.ok(response.ok); return response.json(); };
    const first = await post("/api/topics", { title: "First topic" });
    const second = await post("/api/topics", { title: "Second topic" });
    for (const topic of [first, second]) await post("/api/materials", { topicId: topic.id, title: topic.title, kind: "article", files: [{ name: "text.md", data: Buffer.from(`# ${topic.title}\n\nQuoted text.`).toString("base64") }] });
    browser = await chromium.launchPersistentContext(join(dir, "profile"), { executablePath: process.env.PITH_CHROME_PATH, headless: true, viewport: { width: 1200, height: 800 }, args: ["--no-first-run", "--no-default-browser-check"] });
    const page = await browser.newPage();
    await page.goto(base);
    const open = async (id: string) => { await page.locator(`[data-open="${id}"]`).first().click(); await page.locator(".reader #article p").waitFor(); };
    await open(first.id);
    assert.equal(await page.locator("#toggle-side").getAttribute("aria-pressed"), "false");
    await page.locator(".reader #article p").evaluate((paragraph: HTMLElement) => { const selection = window.getSelection()!, range = document.createRange(); range.selectNodeContents(paragraph); selection.removeAllRanges(); selection.addRange(range); paragraph.dispatchEvent(new MouseEvent("mouseup", { bubbles: true })); });
    await page.locator('#toolbar [data-action="ask"]').click();
    await page.waitForFunction(() => document.querySelector("#preview")?.textContent?.includes("Quoted text"));
    assert.match(await page.locator("#preview").textContent(), /Quoted text/);
    assert.equal(await page.locator("#toggle-side").getAttribute("aria-pressed"), "true");
    await page.locator("#home").click(); await open(second.id);
    assert.equal(await page.locator("#preview").textContent(), "");
    assert.equal(await page.locator("#toggle-side").getAttribute("aria-pressed"), "false");
    await page.locator("#home").click(); await open(first.id);
    assert.equal(await page.locator("#preview").textContent(), "");
    assert.equal(await page.locator("#toggle-side").getAttribute("aria-pressed"), "true");

    await page.locator("#home").click();
    let releaseSecond!: () => void, secondRequested!: () => void;
    const gate = new Promise<void>(resolve => { releaseSecond = resolve; });
    const pending = new Promise<void>(resolve => { secondRequested = resolve; });
    await page.route("**/api/chat?**", async (route: any) => {
      if (new URL(route.request().url()).searchParams.get("topicId") === second.id) { secondRequested(); await gate; }
      await route.continue();
    });
    try {
      await page.locator(`[data-open="${second.id}"]`).first().click();
      await pending;
      await open(first.id);
      const response = page.waitForResponse((item: any) => new URL(item.url()).pathname === "/api/chat" && new URL(item.url()).searchParams.get("topicId") === second.id);
      releaseSecond();
      await (await response).finished();
      assert.equal(await page.locator("#crumb").textContent(), "First topic");
      assert.match(await page.locator(".reader #article").textContent(), /First topic/);
      assert.equal(await page.locator("#preview").textContent(), "");
    } finally { releaseSecond(); await page.unroute("**/api/chat?**"); }
  } finally {
    if (browser) await browser.close();
    if (server) await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve()));
    await rm(dir, { recursive: true, force: true });
  }
});

test("Web subtitle cues open shadowing only when it is explicitly mounted", { timeout: 30000, skip: !process.env.PITH_PLAYWRIGHT_MODULE || !process.env.PITH_CHROME_PATH }, async () => {
  const { chromium } = await import(process.env.PITH_PLAYWRIGHT_MODULE!);
  const dir = await testSandbox("pith-cue-behavior-");
  let browser: Awaited<ReturnType<typeof chromium.launchPersistentContext>> | undefined;
  let server: Awaited<ReturnType<typeof createPithWebServer>> | undefined;
  try {
    await mkdir(join(dir, "workspace"));
    server = await createPithWebServer({ workspaceDir: join(dir, "workspace") });
    const address = server.address(); assert.ok(address && typeof address !== "string");
    const base = `http://127.0.0.1:${address.port}`;
    const post = async (path: string, value: unknown) => { const response = await fetch(base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(value) }); assert.ok(response.ok); return response.json(); };
    const topic = await post("/api/topics", { title: "Subtitle" });
    await post("/api/materials", { topicId: topic.id, title: "Subtitle", kind: "media", files: [{ name: "speech.srt", data: Buffer.from("1\n00:00:01,000 --> 00:00:03,000\nA spoken sentence.\n").toString("base64") }] });
    await post(`/api/topics/${topic.id}/toolkits`, { toolkits: ["feynman"] });
    browser = await chromium.launchPersistentContext(join(dir, "profile"), { executablePath: process.env.PITH_CHROME_PATH, headless: true, viewport: { width: 1000, height: 700 }, args: ["--no-first-run", "--no-default-browser-check"] });
    const page = await browser.newPage();
    await page.goto(base);
    const open = async () => { await page.locator(`[data-open="${topic.id}"]`).first().click(); await page.locator(".pith-cue").first().waitFor(); };
    await open();
    await page.locator(".pith-cue").first().click();
    assert.equal(await page.locator(".training-panel").count(), 0);
    assert.equal((await (await fetch(`${base}/api/state`)).json()).compass.exploring.find((item: { id: string }) => item.id === topic.id).toolkits.includes("shadowing"), false);
    await post(`/api/topics/${topic.id}/toolkits`, { toolkits: ["shadowing"] });
    await page.locator("#home").click(); await open();
    const transformed = page.waitForResponse((response: any) => new URL(response.url()).pathname === "/api/dojo/transform" && response.request().method() === "POST");
    await page.locator(".pith-cue").first().click();
    assert.equal((await transformed).ok(), true);
    await page.locator(".training-panel #dojo-target").waitFor();
    assert.equal(await page.locator(".training-panel #dojo-target").inputValue(), "A spoken sentence.");
  } finally {
    if (browser) await browser.close();
    if (server) await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve()));
    await rm(dir, { recursive: true, force: true });
  }
});
