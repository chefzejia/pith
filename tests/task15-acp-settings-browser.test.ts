import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import test from "node:test";
import { createPithWebServer } from "../src/shells/web/server.ts";
import { testSandbox } from "./sandbox.ts";

test("Web agent options show groups and save selected model and effort", { timeout: 60000, skip: !process.env.PITH_PLAYWRIGHT_MODULE || !process.env.PITH_CHROME_PATH }, async () => {
  const { chromium } = await import(process.env.PITH_PLAYWRIGHT_MODULE!);
  const dir = await testSandbox("pith-task15-acp-ui-");
  const server = await createPithWebServer({ workspaceDir: dir });
  let browser: Awaited<ReturnType<typeof chromium.launchPersistentContext>> | undefined;
  try {
    const address = server.address(); assert.ok(address && typeof address !== "string"); const base = `http://127.0.0.1:${address.port}`;
    browser = await chromium.launchPersistentContext(`${dir}/profile`, { executablePath: process.env.PITH_CHROME_PATH, headless: true });
    const page = await browser.newPage();
    await page.route("**/api/agents?**", (route: any) => route.fulfill({ json: [{ id: "dsh", available: true }] }));
    await page.route("**/api/agents/options?**", (route: any) => route.fulfill({ json: [{ id: "model", name: "Model", type: "select", currentValue: "first", options: [{ value: "first", name: "First", group: "magpie", groupLabel: "Magpie" }, { value: "second", name: "Second", group: "magpie", groupLabel: "Magpie" }] }, { id: "reasoning_effort", name: "Effort", type: "select", currentValue: "low", options: [{ value: "low", name: "Low" }, { value: "high", name: "High" }] }] }));
    await page.goto(base); await page.locator("#settings").click();
    await page.locator("#simple-agent").selectOption("dsh");
    await page.locator('#simple-model optgroup[label="Magpie"]').waitFor({ state: "attached" });
    assert.match((await page.locator('#simple-model option[value=""]').textContent())!, /First/);
    await page.locator("#simple-model").selectOption("second"); await page.locator("#simple-effort").selectOption("high");
    await page.waitForFunction(async () => { const response = await fetch("/api/state"); const data = await response.json(); return data.settings.model === "second" && data.settings.effort === "high"; });
    await page.locator("#close-drawer").click(); await page.locator("#settings").click();
    await page.locator('#simple-model optgroup[label="Magpie"]').waitFor({ state: "attached" });
    assert.equal(await page.locator("#simple-model").inputValue(), "second"); assert.equal(await page.locator("#simple-effort").inputValue(), "high");
  } finally { if (browser) await browser.close(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); await rm(dir, { recursive: true, force: true }); }
});
