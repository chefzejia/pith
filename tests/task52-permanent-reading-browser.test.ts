import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { DefaultWorkspaceStore } from "../src/core/index.ts";
import { NodeWorkspaceStorage } from "../src/shells/web/nodeStorage.ts";
import { createPithWebServer } from "../src/shells/web/server.ts";
import { nativeWorkbenchFixture } from "./native-workbench-fixture.ts";
import { createReadingRepository, seedReadingWorkspace } from "./task52-reading-fixture.ts";
import { testSandbox } from "./sandbox.ts";

const enabled = Boolean(process.env.PITH_PLAYWRIGHT_MODULE && process.env.PITH_CHROME_PATH);
for (const host of ["Web", "Obsidian boundary"]) test(`${host} restores GUI-written repository/ordinary positions after restart/cache deletion through standalone and topic entry`, { skip: !enabled, timeout: 60000 }, async () => {
  const root = await testSandbox("permanent-reading-browser-"), workspace = join(root, "workspace"); await mkdir(workspace);
  const repo = await createReadingRepository(root), seed = await seedReadingWorkspace(workspace, repo), store = new DefaultWorkspaceStore(new NodeWorkspaceStorage(workspace));
  let browser: any, server: Awaited<ReturnType<typeof createPithWebServer>> | undefined;
  try {
    const { chromium } = await import(process.env.PITH_PLAYWRIGHT_MODULE!);
    const open = async () => {
      browser = await chromium.launchPersistentContext(join(root, "profile"), { executablePath: process.env.PITH_CHROME_PATH, headless: true, viewport: { width: 1200, height: 800 } });
      const page = await browser.newPage(); page.setDefaultTimeout(6000);
      if (host === "Web") { server = await createPithWebServer({ workspaceDir: workspace, port: 0 }); const address = server.address(); assert.ok(address && typeof address !== "string"); await page.goto(`http://127.0.0.1:${address.port}`); }
      else await nativeWorkbenchFixture(page, workspace);
      return page;
    };
    const close = async () => { await browser.close(); browser = undefined; if (server) { await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve())); server = undefined; } };
    let page = await open();
    const saved: Record<string, NonNullable<Awaited<ReturnType<typeof store.getMaterial>>>["reading"]> = {};
    for (const material of [seed.repository, seed.ordinary]) {
      await page.locator(`[data-material="${material.id}"]`).click();
      await page.waitForFunction((text: string) => document.querySelector(".pith-article")?.textContent?.includes(text), material === seed.repository ? "首项" : "第一文件");
      await page.locator(".pith-nav-toggle").click(); await page.locator(`.pith-left-drawer [data-material-id="${material.id}"][data-file="${material.file}"]`).click();
      await page.waitForFunction((text: string) => document.querySelector(".pith-article")?.textContent?.includes(text), material === seed.repository ? "R_MARKER_001" : "M_MARKER_001");
      await page.locator(".pith-reader").evaluate((reader: HTMLElement) => { reader.scrollTop = 1500; });
      const deadline = Date.now() + 6000;
      do { saved[material.id] = (await store.getMaterial(material.id))!.reading; if (saved[material.id]?.file === material.file && saved[material.id]?.locator && !saved[material.id]!.locator!.includes("#L1-L1")) break; await delay(50); } while (Date.now() < deadline);
      assert.equal(saved[material.id]?.file, material.file); assert.ok(saved[material.id]?.locator);
      await page.locator('[data-command="home"]').click();
    }
    const fileOnlyBefore = (await store.getMaterial(seed.fileOnly.id))!.reading;
    await close();
    // Leaving the reader flushes one last reading event. Baseline only after
    // normal shutdown, before a fresh homepage can open any material again.
    for (const material of [seed.repository, seed.ordinary]) { const ended = (await store.getMaterial(material.id))!.reading; assert.equal(ended!.locator, saved[material.id]!.locator); saved[material.id] = ended; }
    await rm(join(workspace, "_cache"), { recursive: true, force: true });
    page = await open();
    for (const material of [seed.repository, seed.ordinary]) {
      assert.deepEqual((await store.getMaterial(material.id))!.reading, saved[material.id], "homepage before reopening must retain timestamp too");
      assert.ok((await page.locator(`[data-material="${material.id}"]`).textContent()).includes(material.file));
    }
    assert.deepEqual((await store.getMaterial(seed.fileOnly.id))!.reading, fileOnlyBefore);
    const positions = [];
    for (const material of [seed.repository, seed.ordinary]) {
      await page.locator(`[data-material="${material.id}"]`).click();
      await page.waitForFunction(() => (document.querySelector<HTMLElement>(".pith-reader")?.scrollTop ?? 0) > 1000);
      const position = await page.locator(".pith-reader").evaluate((reader: HTMLElement) => ({ scrollTop: reader.scrollTop, text: reader.textContent?.slice(0, 80) })); positions.push(position);
      assert.ok(position.scrollTop > 1000, "restore actual visible position, not just locator string");
      if (process.env.PITH_PERMANENT_READING_CAPTURE_DIR && host === "Web") { await mkdir(process.env.PITH_PERMANENT_READING_CAPTURE_DIR, { recursive: true }); await page.screenshot({ path: join(process.env.PITH_PERMANENT_READING_CAPTURE_DIR, material === seed.repository ? "web-repository-restored.png" : "web-ordinary-restored.png") }); }
      await page.locator('[data-command="home"]').click();
    }
    await page.locator(`[data-topic="${seed.topicId}"]`).click();
    await page.waitForFunction(() => (document.querySelector<HTMLElement>(".pith-reader")?.scrollTop ?? 0) > 1000);
    assert.ok((await page.locator(".pith-article").textContent()).includes("R_MARKER_045"), "topic session must reopen the same non-first nested repository file");
    assert.equal((await store.getMaterial(seed.repository.id))!.reading!.locator, saved[seed.repository.id]!.locator);
    assert.deepEqual((await store.getMaterial(seed.repository.id))!.files, []);
    assert.equal((await store.listUnreadable()).length, 3);
    if (process.env.PITH_PERMANENT_READING_CAPTURE_DIR) await writeFile(join(process.env.PITH_PERMANENT_READING_CAPTURE_DIR, host === "Web" ? "web-restart.json" : "native-boundary-restart.json"), JSON.stringify({ saved, fileOnlyBefore, positions, workspace, repo }, null, 2));
    await close();
  } finally { if (browser) await browser.close(); if (server) await new Promise<void>(resolve => server!.close(() => resolve())); await rm(root, { recursive: true, force: true }); }
});
