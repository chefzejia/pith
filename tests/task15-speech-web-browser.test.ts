import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { resolve, sep } from "node:path";
import test from "node:test";
import { createPithWebServer } from "../src/shells/web/server.ts";
import { testSandbox } from "./sandbox.ts";
import { storedEpub } from "./wave12-epub-fixture.ts";

test("Web controls and speech endpoints use the installed real gateway", { timeout: 60000, skip: !process.env.PITH_SPEECH_TEST_HOME || !process.env.PITH_PLAYWRIGHT_MODULE || !process.env.PITH_CHROME_PATH }, async () => {
  const home = resolve(process.env.PITH_SPEECH_TEST_HOME!); assert.ok(home.startsWith(resolve(".tmp") + sep));
  const previous = process.env.PITH_SPEECH_HOME; process.env.PITH_SPEECH_HOME = home;
  const dir = await testSandbox("pith-speech-web-"), server = await createPithWebServer({ workspaceDir: dir });
  let browser: any;
  try {
    const address = server.address(); assert.ok(address && typeof address !== "string"); const base = `http://127.0.0.1:${address.port}`;
    const { chromium } = await import(process.env.PITH_PLAYWRIGHT_MODULE!);
    browser = await chromium.launchPersistentContext(`${dir}/profile`, { executablePath: process.env.PITH_CHROME_PATH, headless: true });
    const page = await browser.newPage(); await page.route("**/api/agents?**", (route: any) => route.fulfill({ json: [] }));
    await page.goto(base); await page.locator("[data-home-settings]").click();
    await page.locator("#speech-runtime-status").getByText("已安装，按需启动").waitFor();
    await page.locator('[data-runtime="ensureRunning"]').click(); await page.locator("#speech-runtime-status").getByText("本机语音运行中").waitFor();
    await page.locator('[data-runtime="stop"]').click(); await page.locator("#speech-runtime-status").getByText("已安装，按需启动").waitFor();
    const tts = await fetch(`${base}/api/speech/synthesize`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "Hello, this is a local speech test." }) });
    assert.equal(tts.status, 200); assert.equal(tts.headers.get("content-type"), "audio/wav"); const audio = Buffer.from(await tts.arrayBuffer()); assert.equal(audio.subarray(0, 4).toString(), "RIFF");
    const asr = await fetch(`${base}/api/speech/transcribe`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ audio: audio.toString("base64"), mimeType: "audio/wav" }) });
    assert.equal(asr.status, 200); assert.match((await asr.json()).text.toLowerCase(), /local speech test/);
    const stopped = await fetch(`${base}/api/speech/runtime`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "stop" }) }); assert.equal((await stopped.json()).status, "stopped");
  } finally { if (browser) await browser.close(); await new Promise<void>((resolveClose, reject) => server.close(error => error ? reject(error) : resolveClose())); if (previous === undefined) delete process.env.PITH_SPEECH_HOME; else process.env.PITH_SPEECH_HOME = previous; await rm(dir, { recursive: true, force: true }); }
});

test("Web reader plays real gateway audio and advances its visible progress", { timeout: 60000, skip: !process.env.PITH_SPEECH_TEST_HOME || !process.env.PITH_PLAYWRIGHT_MODULE || !process.env.PITH_CHROME_PATH }, async () => {
  const home = resolve(process.env.PITH_SPEECH_TEST_HOME!); assert.ok(home.startsWith(resolve(".tmp") + sep));
  const previous = process.env.PITH_SPEECH_HOME; process.env.PITH_SPEECH_HOME = home;
  const dir = await testSandbox("pith-speech-reader-"), server = await createPithWebServer({ workspaceDir: dir });
  let browser: any;
  try {
    const address = server.address(); assert.ok(address && typeof address !== "string"); const base = `http://127.0.0.1:${address.port}`;
    const post = async (path: string, value: unknown) => { const response = await fetch(base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(value) }); assert.ok(response.ok); return response.json(); };
    const topic = await post("/api/topics", { title: "Speech test" });
    const text = "Reading carefully begins with the decision to notice what is in front of us. A quiet moment gives each idea enough room to develop.";
    const book = storedEpub({ "META-INF/container.xml": '<container><rootfiles><rootfile full-path="book.opf"/></rootfiles></container>', "book.opf": '<package><metadata><title>Speech test</title></metadata><manifest><item id="one" href="one.xhtml"/></manifest><spine><itemref idref="one"/></spine></package>', "one.xhtml": `<html><body><h1>Chapter One: Attention</h1><p>${text}</p><p>We can return to the same sentence and discover a different detail.</p></body></html>` });
    await post("/api/materials", { topicId: topic.id, title: "Speech test", kind: "book", files: [{ name: "speech.epub", data: Buffer.from(book).toString("base64") }] });
    const { chromium } = await import(process.env.PITH_PLAYWRIGHT_MODULE!);
    browser = await chromium.launchPersistentContext(`${dir}/profile`, { executablePath: process.env.PITH_CHROME_PATH, headless: true, viewport: { width: 1100, height: 700 } });
    const page = await browser.newPage(); await page.route("**/api/agents?**", (route: any) => route.fulfill({ json: [] }));
    await page.goto(base); await page.locator(`[data-open="${topic.id}"]`).first().click(); await page.locator(".reader").waitFor();
    const eventErrors = await page.evaluate(() => {
      const errors: string[] = [];
      const capture = (event: ErrorEvent) => { errors.push(event.message); event.preventDefault(); };
      window.addEventListener("error", capture);
      document.dispatchEvent(new Event("scroll"));
      document.dispatchEvent(new Event("input", { bubbles: true }));
      document.querySelector(".reader")!.dispatchEvent(new Event("scroll"));
      window.removeEventListener("error", capture);
      return errors;
    });
    assert.deepEqual(eventErrors, []);
    for (let attempt = 0; attempt < 2; attempt++) {
      await page.locator("#read-aloud").click();
      await page.waitForFunction(() => Number((document.querySelector('[data-speech-seek]') as HTMLInputElement | null)?.value) > 0, null, { timeout: 20000 });
      assert.match(await page.locator("[data-speech-time]").textContent(), /\d\d:\d\d \/ \d\d:\d\d/);
      await page.waitForFunction(() => (document.querySelector("#speech-status")?.textContent || "").startsWith("2 /"), null, { timeout: 20000 });
      await page.waitForFunction(() => Number((document.querySelector('[data-speech-seek]') as HTMLInputElement | null)?.value) > 0, null, { timeout: 20000 });
      await page.locator("#speech-close").click();
    }
    await page.route("**/api/speech/synthesize", (route: any) => route.fulfill({ status: 503, json: { error: "测试网关不可用" } }));
    await page.locator("#read-aloud").click();
    await page.locator('#speech-result[role="alert"]').getByText("测试网关不可用").waitFor();
    await page.locator("#speech-close").click();
    assert.equal(await page.locator("#speech-result").count(), 0);
  } finally { if (browser) await browser.close(); await new Promise<void>((resolveClose, reject) => server.close(error => error ? reject(error) : resolveClose())); if (previous === undefined) delete process.env.PITH_SPEECH_HOME; else process.env.PITH_SPEECH_HOME = previous; await rm(dir, { recursive: true, force: true }); }
});

test("short Chinese chapter plays every real Kokoro sentence and retains its result", { timeout: 90000, skip: !process.env.PITH_SPEECH_TEST_HOME || !process.env.PITH_PLAYWRIGHT_MODULE || !process.env.PITH_CHROME_PATH }, async () => {
  const home = resolve(process.env.PITH_SPEECH_TEST_HOME!); assert.ok(home.startsWith(resolve(".tmp") + sep));
  const previous = process.env.PITH_SPEECH_HOME; process.env.PITH_SPEECH_HOME = home;
  const dir = await testSandbox("pith-speech-cn-"), server = await createPithWebServer({ workspaceDir: dir });
  let browser: any;
  try {
    const address = server.address(); assert.ok(address && typeof address !== "string"); const base = `http://127.0.0.1:${address.port}`;
    const post = async (path: string, value: unknown) => { const response = await fetch(base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(value) }); assert.ok(response.ok); return response.json(); };
    const topic = await post("/api/topics", { title: "短文验收" });
    const book = storedEpub({ "META-INF/container.xml": '<container><rootfiles><rootfile full-path="book.opf"/></rootfiles></container>', "book.opf": '<package><metadata><title>短文</title></metadata><manifest><item id="one" href="one.xhtml"/></manifest><spine><itemref idref="one"/></spine></package>', "one.xhtml": '<html><body><h1>短文</h1><p>清晨阳光照进窗户。我们安静地读完这一段文字。</p></body></html>' });
    await post("/api/materials", { topicId: topic.id, title: "短文", kind: "book", files: [{ name: "short.epub", data: Buffer.from(book).toString("base64") }] });
    const { chromium } = await import(process.env.PITH_PLAYWRIGHT_MODULE!);
    browser = await chromium.launchPersistentContext(`${dir}/profile`, { executablePath: process.env.PITH_CHROME_PATH, headless: true });
    const page = await browser.newPage(); await page.route("**/api/agents?**", (route: any) => route.fulfill({ json: [] }));
    await page.addInitScript(() => {
      const original = window.Audio;
      (window as any).speechEvents = [];
      window.Audio = new Proxy(original, { construct(target, args: ConstructorParameters<typeof Audio>) {
        const audio = new target(...args);
        for (const type of ["playing", "timeupdate", "ended", "error"]) audio.addEventListener(type, () => (window as any).speechEvents.push({ type, time: audio.currentTime, duration: audio.duration }));
        return audio;
      } });
    });
    await page.goto(base); await page.locator(`[data-open="${topic.id}"]`).first().click();
    for (let attempt = 1; attempt <= 3; attempt++) {
      await page.locator("#read-aloud").click();
      assert.equal(await page.locator("#speech-result").count(), 0);
      await page.waitForFunction((count: number) => (window as any).speechEvents.filter((event: any) => event.type === "ended").length === count * 3, attempt, { timeout: 30000 });
      await page.locator('#speech-result[role="status"]').getByText("本章听读完成").waitFor();
      const events = await page.evaluate(() => (window as any).speechEvents);
      assert.equal(events.filter((event: any) => event.type === "error").length, 0);
      assert.equal(events.filter((event: any) => event.type === "playing").length, attempt * 3);
      assert.ok(events.filter((event: any) => event.type === "ended").every((event: any) => event.duration > 1 && event.time === event.duration));
      if (attempt === 2) {
        await page.locator('[data-page="next"]').click();
        assert.equal(await page.locator("#speech-result").count(), 0);
      }
    }
    await page.clock.install(); await page.clock.fastForward(10000);
    assert.equal(await page.locator("#speech-result").isVisible(), true);
    await page.locator("#speech-close").click();
    assert.equal(await page.locator("#speech-result").count(), 0);
    await page.locator("#read-aloud").click();
    assert.equal(await page.locator("#speech-result").count(), 0);
    await page.locator("#speech-close").click();
    await page.locator("#home").click();
    assert.equal(await page.locator("#speech-result").count(), 0);
  } finally { if (browser) await browser.close(); await new Promise<void>((resolveClose, reject) => server.close(error => error ? reject(error) : resolveClose())); if (previous === undefined) delete process.env.PITH_SPEECH_HOME; else process.env.PITH_SPEECH_HOME = previous; await rm(dir, { recursive: true, force: true }); }
});
