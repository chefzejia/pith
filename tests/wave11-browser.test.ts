import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createPithWebServer } from "../src/shells/web/server.ts";
import { testSandbox } from "./sandbox.ts";

test("settings labels and controls fit the drawer at desktop and narrow widths", { timeout: 30000, skip: !process.env.PITH_PLAYWRIGHT_MODULE || !process.env.PITH_CHROME_PATH }, async () => {
  const { chromium } = await import(process.env.PITH_PLAYWRIGHT_MODULE!);
  const dir = await testSandbox("pith-settings-layout-");
  let server: Awaited<ReturnType<typeof createPithWebServer>> | undefined;
  let browser: Awaited<ReturnType<typeof chromium.launchPersistentContext>> | undefined;
  try {
    await mkdir(join(dir, "workspace"));
    server = await createPithWebServer({ workspaceDir: join(dir, "workspace") });
    const address = server.address(); assert.ok(address && typeof address !== "string");
    browser = await chromium.launchPersistentContext(join(dir, "profile"), { executablePath: process.env.PITH_CHROME_PATH, headless: true, viewport: { width: 1100, height: 700 } });
    const page = await browser.newPage();
    await page.route("**/api/agents?force=true", (route: { fulfill(options: unknown): Promise<void> }) => route.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
    await page.goto(`http://127.0.0.1:${address.port}`); await page.locator("[data-home-settings]").click();
    for (const width of [1100, 390, 280]) {
      await page.setViewportSize({ width, height: 700 });
      for (const mode of ["local", "cloud"]) {
        await page.locator("#simple-mode").selectOption(mode);
        if (process.env.PITH_SETTINGS_SCREENSHOT_DIR) await page.screenshot({ path: join(process.env.PITH_SETTINGS_SCREENSHOT_DIR, `settings-${width}-${mode}.png`) });
        const rows = await page.locator("#drawer label:visible").evaluateAll((labels: HTMLLabelElement[]) => labels.map(label => {
          const text = label.firstChild!, range = label.ownerDocument.createRange(); range.selectNodeContents(text);
          const bounds = label.getBoundingClientRect();
          return { name: text.textContent?.trim(), lines: range.getClientRects().length, controls: [...label.querySelectorAll<HTMLElement>("input,select,button")].map(control => { const r = control.getBoundingClientRect(); return { left: r.left - bounds.left, right: r.right - bounds.right, height: r.height }; }) };
        }));
        for (const row of rows) {
          assert.equal(row.lines, 1, `${width}px ${mode}: ${row.name} wraps`);
          for (const control of row.controls) assert.ok(control.left >= -1 && control.right <= 1 && control.height <= 52, `${width}px ${mode}: ${row.name} control ${JSON.stringify(control)}`);
        }
        const modeFits = await page.locator("#simple-mode").evaluate((select: HTMLSelectElement) => { const canvas = document.createElement("canvas"), context = canvas.getContext("2d")!, style = getComputedStyle(select); context.font = style.font; return context.measureText(select.selectedOptions[0]!.textContent!).width <= select.clientWidth - 32; });
        assert.equal(modeFits, true, `${width}px ${mode}: selected mode is clipped`);
        assert.equal(await page.locator("#drawer").evaluate((node: HTMLElement) => node.scrollWidth <= node.clientWidth + 1), true);
      }
    }
  } finally {
    if (browser) await browser.close();
    if (server) await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve()));
    await rm(dir, { recursive: true, force: true });
  }
});

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
    let agentsAvailable = false;
    await page.route("**/api/agents?force=true", (route: { fulfill(options: unknown): Promise<void> }) => route.fulfill({ status: 200, contentType: "application/json", body: agentsAvailable ? JSON.stringify([{ id: "dsh", available: true }]) : "[]" }));
    await page.goto(base); await page.locator("[data-home-settings]").click();
    assert.equal(await page.locator("#simple-agent").inputValue(), "unconfigured");
    await page.locator("#simple-agent").selectOption("");
    await page.waitForFunction(async () => (await (await fetch("/api/state")).json()).settings.agentConfigured === true);
    agentsAvailable = true;
    await page.locator("#close-drawer").click(); await page.locator("[data-home-settings]").click();
    await page.waitForFunction(() => !(document.querySelector("#simple-scan") as HTMLButtonElement).disabled);
    assert.equal(await page.locator("#simple-agent").inputValue(), "");
    assert.equal((await (await fetch(`${base}/api/state`)).json()).settings.agentId, "");
    assert.equal(await page.locator("#simple-key-row").isHidden(), true);
    await page.locator("#simple-mode").selectOption("cloud");
    await page.waitForFunction(async () => (await (await fetch("/api/state")).json()).settings.speech?.ttsProvider === "openai-tts");
    await page.locator('[data-speech-field="ttsEndpoint"]').fill("https://speech.example.com/v1/audio/speech");
    await page.locator('[data-speech-field="ttsEndpoint"]').dispatchEvent("change");
    await page.waitForFunction(async () => (await (await fetch("/api/state")).json()).settings.speech?.ttsEndpoint === "https://speech.example.com/v1/audio/speech");
    await page.locator("#simple-mode").selectOption("local");
    await page.waitForFunction(async () => (await (await fetch("/api/state")).json()).settings.speech?.ttsProvider === "kokoro-local");
    await page.waitForFunction(() => (document.querySelector('[data-speech-field="ttsEndpoint"]') as HTMLInputElement).value === "");
    assert.equal(await page.locator('[data-speech-field="ttsEndpoint"]').inputValue(), "");
    await page.locator("#simple-mode").selectOption("cloud");
    await page.waitForFunction(async () => (await (await fetch("/api/state")).json()).settings.speech?.ttsEndpoint === "https://speech.example.com/v1/audio/speech");
    await page.locator("#close-drawer").click();
    await page.locator(`[data-topic="${topic.id}"]`).first().click();
    assert.equal(await page.locator("#open-toolkit").isHidden(), true);
    await post(`/api/topics/${topic.id}/toolkits`, { toolkits: ["feynman"] });
    await page.locator('[data-command="home"]').click(); await page.locator(`[data-topic="${topic.id}"]`).first().click();
    await page.waitForFunction(() => document.querySelector("#open-toolkit")?.textContent?.includes("费曼复述"));
    for (const width of [1200, 390]) {
      await page.setViewportSize({ width, height: 800 });
      assert.match(await page.locator("#open-toolkit").textContent(), /费曼复述/);
      await page.locator("#open-toolkit").click();
      const panel = page.locator(".pith-toolkit-panel"); assert.equal(await panel.count(), 1);
      assert.equal(await panel.evaluate((node: HTMLElement) => node.parentElement?.classList.contains("pith-bottom-dock")), true);
      const bounds = await panel.boundingBox(); assert.ok(bounds); assert.ok(Math.abs(bounds.y - 48) < 2); assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width + 1);
      await page.locator("#open-toolkit").click();
      await page.locator('[data-command="typography"]').click();
      const typeBounds = await page.locator(".pith-typography-popover").boundingBox(); assert.ok(typeBounds); assert.ok(Math.abs(typeBounds.y - 48) < 2);
      await page.locator('[data-command="typography"]').click();
    }
  } finally {
    if (browser) await browser.close();
    if (server) await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve()));
    await rm(dir, { recursive: true, force: true });
  }
});
