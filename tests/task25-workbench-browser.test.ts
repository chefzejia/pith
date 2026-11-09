import assert from "node:assert/strict";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { build } from "esbuild";
import { createPithWebServer } from "../src/shells/web/server.ts";
import { testSandbox } from "./sandbox.ts";

async function assertPrimaryHover(page: any): Promise<void> {
  for (const selector of ["[data-intake-open]", ".pith-focus button[data-topic]"]) {
    const button = page.locator(selector); await button.hover();
    const colors = await button.evaluate((node: HTMLElement) => { const css = getComputedStyle(node); return { foreground: css.color, background: css.backgroundColor }; });
    const luminance = (value: string) => { const components = value.match(/[\d.]+/g)!.slice(0, 3).map(Number).map((channel: number) => { const c = channel / 255; return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4; }); return .2126 * components[0]! + .7152 * components[1]! + .0722 * components[2]!; };
    const a = luminance(colors.foreground), b = luminance(colors.background); const ratio = (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
    assert.ok(ratio >= 4.5, `${selector}: hover contrast ${ratio} (${colors.foreground} on ${colors.background})`);
  }
}

test("topic board controls and timeline practice retain timestamps without reading them", { timeout: 60000, skip: !process.env.PITH_PLAYWRIGHT_MODULE || !process.env.PITH_CHROME_PATH }, async () => {
  const dir = await testSandbox("pith-task25-");
  await mkdir(join(dir, "workspace"));
  const server = await createPithWebServer({ workspaceDir: join(dir, "workspace") });
  let browser: any;
  try {
    const address = server.address(); assert.ok(address && typeof address !== "string"); const base = `http://127.0.0.1:${address.port}`;
    const post = async (path: string, data: unknown) => { const response = await fetch(base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data) }); assert.ok(response.ok); return response.json(); };
    const topic = await post("/api/topics", { title: "时间轴练习", target: "理解内容", nextAction: "继续学习" });
    await post("/api/materials", { topicId: topic.id, title: "字幕", kind: "media", files: [{ name: "speech.srt", data: Buffer.from("1\n00:00:01,000 --> 00:00:03,000\nA spoken sentence.\n").toString("base64") }] });
    await post(`/api/topics/${topic.id}/toolkits`, { toolkits: ["shadowing", "feynman"] });
    const { chromium } = await import(process.env.PITH_PLAYWRIGHT_MODULE!);
    browser = await chromium.launchPersistentContext(join(dir, "profile"), { executablePath: process.env.PITH_CHROME_PATH, headless: true, viewport: { width: 1100, height: 700 } });
    const page = await browser.newPage(); await page.goto(base);
    const settings = page.locator("[data-home-settings]");
    assert.equal(await settings.evaluate((node: HTMLElement) => node.classList.contains("pith-icon")), true);
    const [header, gear] = await Promise.all([page.locator(".pith-view-header").boundingBox(), settings.boundingBox()]); assert.ok(header && gear && header.x + header.width - (gear.x + gear.width) < 20);
    for (const selector of ["[data-intake-open]", "[data-intake-files]", ".pith-focus button"]) {
      const style = await page.locator(selector).evaluate((node: HTMLElement) => { const css = getComputedStyle(node); return { border: css.borderTopWidth, radius: css.borderTopLeftRadius, padding: css.paddingLeft }; });
      assert.ok(parseFloat(style.border) >= 1 && parseFloat(style.radius) >= 4 && parseFloat(style.padding) >= 8, selector);
    }
    if (process.env.PITH_EVIDENCE_DIR) await page.screenshot({ path: join(process.env.PITH_EVIDENCE_DIR, "board.png") });
    for (const selector of ['.pith-intake-box input[name="title"]', ".pith-intake-box button"]) {
      const style = await page.locator(selector).first().evaluate((node: HTMLElement) => { const css = getComputedStyle(node); return [parseFloat(css.borderTopWidth), parseFloat(css.borderTopLeftRadius), parseFloat(css.paddingLeft)]; });
      assert.ok(style.every((value: number) => value > 0), selector);
    }
    await assertPrimaryHover(page);
    if (process.env.PITH_EVIDENCE_DIR) await page.screenshot({ path: join(process.env.PITH_EVIDENCE_DIR, "worker-web-hover.png") });
    await settings.click(); assert.equal(await page.locator('#simple-agent').isVisible(), true);
    await page.locator('#close-drawer').click();
    await page.locator(`[data-topic="${topic.id}"]`).first().click();
    const cue = page.locator(".pith-cue").first(); await cue.waitFor();
    const original = await cue.innerHTML();
    let spoken = "";
    await page.route("**/api/speech/synthesize", async (route: any) => { spoken = route.request().postDataJSON().text; await route.fulfill({ status: 503, body: "test unavailable" }); });
    const speechRequest = page.waitForRequest("**/api/speech/synthesize"); await page.locator('[data-command="read"]').click(); await speechRequest;
    assert.equal(spoken, "A spoken sentence.");
    assert.match(original, /<time data-prose="false">00:01<\/time>/);
    await page.locator('[data-command="speech-close"]').click();
    await page.locator("#open-dojo").click();
    const popup = page.locator(".pith-dojo-panel"); const width = await popup.evaluate((node: HTMLElement) => node.getBoundingClientRect().width); assert.ok(width < 400, `popup width ${width}`);
    await page.locator('[data-dojo-choose="shadowing"]').click();
    await page.locator("[data-dojo-close]").click(); assert.equal(await cue.innerHTML(), original);
    await cue.click(); await page.locator('[data-dojo-choose="shadowing"]').click();
    const time = cue.locator(":scope > time");
    const assertTime = async () => { assert.equal(await time.count(), 1); assert.equal(await time.evaluate((node: HTMLElement) => node.offsetWidth > 0), true); assert.equal(await time.textContent(), "00:01"); };
    await assertTime();
    for (const stage of ["listen-decompose", "guided-follow", "scaffold-cloze", "blind-produce"]) { await page.locator(`[data-dojo-stage="${stage}"]`).click(); await assertTime(); }
    if (process.env.PITH_EVIDENCE_DIR) await page.screenshot({ path: join(process.env.PITH_EVIDENCE_DIR, "timeline.png") });
    await page.locator("[data-dojo-close]").click(); assert.equal(await cue.innerHTML(), original);
    await page.locator("#open-dojo").click(); await page.locator('[data-dojo-choose="feynman"]').click(); await assertTime();
    await page.locator("[data-dojo-reveal]").click(); await assertTime();
    await page.locator("[data-dojo-close]").click(); assert.equal(await cue.innerHTML(), original);
  } finally {
    if (browser) await browser.close();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await rm(dir, { recursive: true, force: true });
  }
});

test("Obsidian workspace board connects settings and maintains readable hover", { timeout: 30000, skip: !process.env.PITH_PLAYWRIGHT_MODULE || !process.env.PITH_CHROME_PATH }, async () => {
  const dir = await testSandbox("pith-task25-native-board-"); let browser: any;
  try {
    const bundle = await build({ entryPoints: ["src/shells/obsidian/index.ts"], bundle: true, write: false, platform: "browser", format: "iife", globalName: "NativePith", external: ["node:*", "obsidian"] });
    const { chromium } = await import(process.env.PITH_PLAYWRIGHT_MODULE!);
    browser = await chromium.launchPersistentContext(join(dir, "profile"), { executablePath: process.env.PITH_CHROME_PATH, headless: true, viewport: { width: 1100, height: 700 } });
    const page = await browser.newPage();
    await page.setContent('<style>html,body,#root{height:100%;margin:0}body{--background-primary:#fff;--background-secondary:#f4f4f4;--background-modifier-border:#ddd;--background-modifier-hover:#e1e9e2;--text-normal:#222;--text-muted:#666;--font-interface:Arial}</style><div id="root"></div>');
    await page.evaluate(() => { (window as any).require = (id: string) => id === "obsidian" ? { ItemView: class { contentEl = document.getElementById("root"); }, Plugin: class {}, Notice: class {} } : id === "node:util" ? { promisify: (fn: unknown) => fn } : id === "node:net" ? { BlockList: class { addSubnet() {} } } : {}; });
    await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
    await page.evaluate(async () => {
      const state: any = (window as any).nativeBoard = { opened: 0 };
      const compass = { exploring: [], settled: [], focusRecommendation: { topicId: "t", title: "测试课题", nextAction: "继续探索" } };
      const controller = { guideVisibility: new Map(), openCompass: async () => compass, openBoardMaterials: async () => [] };
      state.view = new (window as any).NativePith.PithWorkspaceView({}, controller, {}, undefined, () => { state.opened++; });
      await state.view.onOpen();
    });
    const settings = page.locator("[data-home-settings]"); assert.equal(await settings.count(), 1); await settings.click(); assert.equal(await page.evaluate(() => (window as any).nativeBoard.opened), 1);
    await assertPrimaryHover(page);
    if (process.env.PITH_EVIDENCE_DIR) await page.screenshot({ path: join(process.env.PITH_EVIDENCE_DIR, "worker-native-hover.png") });
  } finally { if (browser) await browser.close(); await rm(dir, { recursive: true, force: true }); }
});
