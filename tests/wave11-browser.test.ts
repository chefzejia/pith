import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createPithWebServer } from "../src/shells/web/server.ts";

test("Web settings and reader tools work in desktop and narrow browser layouts", { skip: !process.env.PITH_PLAYWRIGHT_MODULE || !process.env.PITH_CHROME_PATH }, async () => {
  const { chromium } = await import(process.env.PITH_PLAYWRIGHT_MODULE!);
  const dir = await mkdtemp(join(tmpdir(), "pith-wave11-browser-"));
  let server: Awaited<ReturnType<typeof createPithWebServer>> | undefined;
  let browser: Awaited<ReturnType<typeof chromium.launchPersistentContext>> | undefined;
  try {
    server = await createPithWebServer({ workspaceDir: dir }); const address = server.address(); assert.ok(address && typeof address !== "string");
    const base = `http://127.0.0.1:${address.port}`;
    const post = async (path: string, body: unknown) => { const response = await fetch(base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); assert.ok(response.ok); return response.json(); };
    const topic = await post("/api/topics", { title: "浏览器回归" });
    await post("/api/materials", { topicId: topic.id, title: "文章", kind: "article", files: [{ name: "article.md", data: Buffer.from("# 内容\n\nA useful concept.").toString("base64") }] });
    browser = await chromium.launchPersistentContext(join(dir, "profile"), { executablePath: process.env.PITH_CHROME_PATH, headless: true, viewport: { width: 1200, height: 800 }, args: ["--no-first-run", "--no-default-browser-check"] });
    const page = await browser.newPage();
    await page.route("**/api/agents?force=true", (route: { fulfill(options: unknown): Promise<void> }) => route.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
    await page.goto(base); await page.locator("#settings").click();
    assert.equal(await page.locator("details").evaluate((node: HTMLDetailsElement) => node.open), false);
    assert.equal(await page.locator("#simple-key-row").isHidden(), true);
    await page.locator("#simple-mode").selectOption("cloud");
    await page.waitForFunction(async () => (await (await fetch("/api/state")).json()).settings.speech?.ttsProvider === "openai-tts");
    await page.locator("details summary").click();
    await page.locator('[data-speech-field="ttsEndpoint"]').fill("https://speech.example.com/v1/audio/speech");
    await page.locator('[data-speech-field="ttsEndpoint"]').dispatchEvent("change");
    await page.waitForFunction(async () => (await (await fetch("/api/state")).json()).settings.speech?.ttsEndpoint === "https://speech.example.com/v1/audio/speech");
    await page.locator("#simple-mode").selectOption("local");
    await page.waitForFunction(async () => (await (await fetch("/api/state")).json()).settings.speech?.ttsProvider === "kokoro-local");
    assert.equal(await page.locator('[data-speech-field="ttsEndpoint"]').inputValue(), "");
    await page.locator("#simple-mode").selectOption("cloud");
    await page.waitForFunction(async () => (await (await fetch("/api/state")).json()).settings.speech?.ttsEndpoint === "https://speech.example.com/v1/audio/speech");
    await page.locator("#close-drawer").click();
    await page.locator(`[data-open="${topic.id}"]`).first().click();
    assert.equal(await page.locator("#open-dojo").isHidden(), true);
    await post(`/api/topics/${topic.id}/toolkits`, { toolkits: ["feynman"] });
    await page.locator("#home").click(); await page.locator(`[data-open="${topic.id}"]`).first().click();
    for (const width of [1200, 390]) {
      await page.setViewportSize({ width, height: 800 });
      assert.match(await page.locator("#open-dojo").textContent(), /费曼复述/);
      await page.locator("#open-dojo").click();
      const panel = page.locator(".training-panel"); assert.equal(await panel.count(), 1);
      assert.equal(await panel.evaluate((node: HTMLElement) => node.parentElement === document.body), true);
      const bounds = await panel.boundingBox(); assert.ok(bounds); assert.ok(Math.abs(bounds.y - 44) < 2); assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width + 1);
      await page.locator("#open-dojo").click();
      await page.locator("#typography-toggle").click();
      const typeBounds = await page.locator(".pith-typography-popover").boundingBox(); assert.ok(typeBounds); assert.ok(Math.abs(typeBounds.y - 44) < 2);
      await page.locator("#typography-toggle").click();
    }
  } finally {
    if (browser) await browser.close();
    if (server) await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve()));
    await rm(dir, { recursive: true, force: true });
  }
});
