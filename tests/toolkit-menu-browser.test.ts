import assert from "node:assert/strict";
import { mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import { createPithWebServer } from "../src/shells/web/server.ts";
import { testSandbox } from "./sandbox.ts";

test("toolkit menu opens, enables and removes tools without stale actions", { timeout: 60000, skip: !process.env.PITH_PLAYWRIGHT_MODULE || !process.env.PITH_CHROME_PATH }, async () => {
  const root = await testSandbox("toolkit-menu-"), workspace = join(root, "workspace"); await mkdir(workspace);
  const server = await createPithWebServer({ workspaceDir: workspace });
  let browser: any;
  try {
    const address = server.address(); assert.ok(address && typeof address !== "string"); const base = `http://127.0.0.1:${address.port}`;
    const post = async (path: string, body: unknown) => { const response = await fetch(base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); assert.ok(response.ok, await response.clone().text()); return response.json() as Promise<any>; };
    const topic = await post("/api/topics", { title: "工具菜单", toolkits: ["feynman"] });
    await post("/api/materials", { topicId: topic.id, title: "阅读", kind: "article", files: [{ name: "reading.md", data: Buffer.from("# 标题\n\n第一段内容。\n\n第二段用于练习的内容。").toString("base64") }] });
    const { chromium } = await import(process.env.PITH_PLAYWRIGHT_MODULE!); browser = await chromium.launch({ executablePath: process.env.PITH_CHROME_PATH, headless: true });
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } }); let updates = 0, fail = false, hold = false, release: (() => void) | undefined, seen: (() => void) | undefined;
    await page.route(`**/api/topics/${topic.id}/toolkits`, async (route: any) => { updates++; if (fail) { fail = false; await route.fulfill({ status: 503, json: { error: "受控保存失败" } }); return; } if (hold) { seen?.(); await new Promise<void>(resolve => { release = resolve; }); } await route.continue(); });
    await page.goto(base); await page.locator(`[data-topic="${topic.id}"]`).first().click(); await page.getByText("第二段用于练习的内容。").waitFor();
    await page.locator("#open-toolkit").click();
    const panel = page.locator(".pith-toolkit-panel"); assert.equal(await panel.locator('input[type="checkbox"]').count(), 0); assert.equal(await panel.getByRole("button", { name: "打开", exact: true }).count(), 0);
    assert.equal(await panel.getByRole("button", { name: "移除费曼复述" }).count(), 1); assert.equal(await panel.getByRole("button", { name: "移除行间" }).count(), 0);
    assert.equal(await panel.evaluate((element: HTMLElement) => element.scrollWidth <= element.clientWidth && Array.from(element.querySelectorAll('button')).every(button => { const rect = button.getBoundingClientRect(), outer = element.getBoundingClientRect(); return rect.left >= outer.left && rect.right <= outer.right; })), true);
    await page.keyboard.press("Escape"); assert.equal(await panel.isHidden(), true, "Escape closes the tool menu");
    await page.locator("#open-toolkit").click(); assert.equal(await panel.isVisible(), true);
    const readerBox = await page.locator(".pith-reader").boundingBox(); assert.ok(readerBox);
    await page.mouse.click(readerBox.x + 10, readerBox.y + readerBox.height - 10); assert.equal(await panel.isHidden(), true, "a press outside closes the tool menu");
    await page.locator("#open-toolkit").click(); await page.locator("#open-toolkit").click(); assert.equal(await panel.isHidden(), true, "the tool button toggles the menu");
    await page.locator("#open-toolkit").click(); assert.equal(await panel.isVisible(), true);
    const evidence = resolve(`${process.env.PITH_TEST_SCREENSHOT_DIR}/toolkit-menu`); await mkdir(evidence, { recursive: true }); await page.screenshot({ path: join(evidence, "web-narrow-light.png") }); await page.emulateMedia({ colorScheme: "dark" }); await page.screenshot({ path: join(evidence, "web-narrow-dark.png") }); await page.emulateMedia({ colorScheme: "light" });
    const before = await (await fetch(base + "/api/state")).json() as any;
    await panel.getByRole("button", { name: "费曼复述", exact: true }).click(); await page.locator("[data-toolkit-close]").waitFor(); assert.equal(updates, 0);
    const after = await (await fetch(base + "/api/state")).json() as any; assert.deepEqual(after.compass.exploring.find((item: any) => item.id === topic.id), before.compass.exploring.find((item: any) => item.id === topic.id));
    await page.locator("#open-toolkit").click(); fail = true; await panel.getByRole("button", { name: "行间", exact: true }).click(); await page.getByText("受控保存失败").waitFor(); assert.equal(await panel.getByRole("button", { name: "行间", exact: true }).isEnabled(), true);
    await panel.getByRole("button", { name: "行间", exact: true }).click(); await panel.locator('[data-interline-mode="bilingual"]').waitFor(); assert.equal(updates, 2);
    await page.locator("#open-toolkit").click(); await panel.getByRole("button", { name: "移除行间" }).click(); await panel.getByRole("button", { name: "移除行间" }).waitFor({ state: "detached" });
    const current = await (await fetch(base + "/api/state")).json() as any; assert.deepEqual(current.compass.exploring.find((item: any) => item.id === topic.id).toolkits, ["feynman"]);
    hold = true; const pending = new Promise<void>(resolve => { seen = resolve; }); await panel.getByRole("button", { name: "行间", exact: true }).click(); await pending; assert.equal(await panel.getByRole("button", { name: "费曼复述", exact: true }).isEnabled(), false);
    await page.locator('[data-command="home"]').click(); await page.locator(".pith-home").waitFor(); const response = page.waitForResponse((item: any) => item.url().endsWith(`/api/topics/${topic.id}/toolkits`) && item.request().method() === "POST"); release!(); await response; assert.equal(await page.locator(".pith-home").isVisible(), true); assert.equal(await page.locator(".pith-inline-toolkit").count(), 0);
  } finally { if (browser) await browser.close(); await new Promise<void>((ok, fail) => server.close(error => error ? fail(error) : ok())); await rm(root, { recursive: true, force: true }); }
});
