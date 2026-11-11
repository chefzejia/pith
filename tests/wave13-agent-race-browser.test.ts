import assert from "node:assert/strict";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { testSandbox } from "./sandbox.ts";
import { createPithWebServer } from "../src/shells/web/server.ts";

test("closing settings invalidates a scan before an explicit offline choice, including after restart", { timeout: 30000, skip: !process.env.PITH_PLAYWRIGHT_MODULE || !process.env.PITH_CHROME_PATH }, async () => {
  const { chromium } = await import(process.env.PITH_PLAYWRIGHT_MODULE!);
  const dir = await testSandbox("wave13-agent-");
  let server: Awaited<ReturnType<typeof createPithWebServer>> | undefined;
  let browser: Awaited<ReturnType<typeof chromium.launchPersistentContext>> | undefined;
  try {
    await mkdir(join(dir, "workspace"));
    const start = async () => { server = await createPithWebServer({ workspaceDir: join(dir, "workspace") }); const address = server.address(); assert.ok(address && typeof address !== "string"); return `http://127.0.0.1:${address.port}`; };
    let base = await start();
    browser = await chromium.launchPersistentContext(join(dir, "profile"), { executablePath: process.env.PITH_CHROME_PATH, headless: true, args: ["--no-first-run", "--no-default-browser-check"] });
    const page = await browser.newPage();
    let resolveFirstScan!: (route: any) => void, resolveOfflineSave!: (route: any) => void, scanCount = 0, unexpectedAgentSave = false;
    const firstScan = new Promise<any>(resolve => { resolveFirstScan = resolve; });
    const offlineSave = new Promise<any>(resolve => { resolveOfflineSave = resolve; });
    await page.route("**/api/agents?force=true", async (route: any) => { if (++scanCount === 1) resolveFirstScan(route); else await route.fulfill({ status: 200, contentType: "application/json", body: "[]" }); });
    await page.route("**/api/settings", async (route: any) => { const value = route.request().postDataJSON(); if (value.agentId === "") resolveOfflineSave(route); else { if (value.agentId === "dsh") unexpectedAgentSave = true; await route.continue(); } });
    await page.goto(base); await page.locator("[data-home-settings]").click();
    await page.waitForFunction(() => (document.querySelector("#simple-scan") as HTMLButtonElement).disabled);
    await page.evaluate(() => { (window as any).oldScan = document.querySelector("#simple-scan"); });
    await page.locator("#close-drawer").click(); await page.locator("[data-home-settings]").click();
    await page.locator("#simple-agent").selectOption("");
    await page.waitForFunction(() => (window as any).oldScan !== document.querySelector("#simple-scan"));
    const scanRoute = await firstScan, saveRoute = await offlineSave;
    await scanRoute.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([{ id: "dsh", available: true }]) });
    await page.waitForFunction(() => !(window as any).oldScan.disabled);
    assert.equal(unexpectedAgentSave, false);
    await saveRoute.continue();
    await page.waitForFunction(async () => (await (await fetch("/api/state")).json()).settings.agentConfigured === true);
    await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve())); server = undefined;
    base = await start(); await page.goto(base); await page.locator("[data-home-settings]").click();
    await page.waitForFunction(() => !(document.querySelector("#simple-scan") as HTMLButtonElement).disabled);
    assert.equal(await page.locator("#simple-agent").inputValue(), "");
    assert.equal((await (await fetch(`${base}/api/state`)).json()).settings.agentConfigured, true);
  } finally {
    if (browser) await browser.close();
    if (server) await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve()));
    await rm(dir, { recursive: true, force: true });
  }
});

test("offline intent survives closing and reopening while its save is pending", { timeout: 30000, skip: !process.env.PITH_PLAYWRIGHT_MODULE || !process.env.PITH_CHROME_PATH }, async () => {
  const { chromium } = await import(process.env.PITH_PLAYWRIGHT_MODULE!);
  const dir = await testSandbox("wave13-offline-pending-");
  let server: Awaited<ReturnType<typeof createPithWebServer>> | undefined;
  let browser: Awaited<ReturnType<typeof chromium.launchPersistentContext>> | undefined;
  try {
    await mkdir(join(dir, "workspace"));
    const start = async () => { server = await createPithWebServer({ workspaceDir: join(dir, "workspace") }); const address = server.address(); assert.ok(address && typeof address !== "string"); return `http://127.0.0.1:${address.port}`; };
    let base = await start();
    browser = await chromium.launchPersistentContext(join(dir, "profile"), { executablePath: process.env.PITH_CHROME_PATH, headless: true });
    const page = await browser.newPage();
    let resolveSave!: (route: any) => void, scans = 0, dshSaves = 0;
    const pendingSave = new Promise<any>(resolve => { resolveSave = resolve; });
    await page.route("**/api/settings", async (route: any) => { const data = route.request().postDataJSON(); if (data.agentId === "") resolveSave(route); else { if (data.agentId === "dsh") dshSaves++; await route.continue(); } });
    await page.route("**/api/agents?force=true", async (route: any) => { scans++; await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(scans === 1 ? [] : [{ id: "dsh", available: true }]) }); });
    await page.goto(base); await page.locator("[data-home-settings]").click();
    await page.waitForFunction(() => !(document.querySelector("#simple-scan") as HTMLButtonElement).disabled);
    await page.locator("#simple-agent").selectOption("");
    const save = await pendingSave;
    await page.locator("#close-drawer").click(); await page.locator("[data-home-settings]").click();
    await page.waitForFunction(() => !(document.querySelector("#simple-scan") as HTMLButtonElement).disabled);
    assert.equal(scans, 2); assert.equal(await page.locator("#simple-agent").inputValue(), ""); assert.equal(dshSaves, 0);
    await save.continue();
    await page.waitForFunction(async () => (await (await fetch("/api/state")).json()).settings.agentConfigured === true);
    await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve())); server = undefined;
    base = await start(); await page.goto(base); await page.locator("[data-home-settings]").click();
    await page.waitForFunction(() => !(document.querySelector("#simple-scan") as HTMLButtonElement).disabled);
    assert.equal(await page.locator("#simple-agent").inputValue(), ""); assert.equal(dshSaves, 0);
  } finally {
    if (browser) await browser.close();
    if (server) await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve()));
    await rm(dir, { recursive: true, force: true });
  }
});
