import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import type { Server } from "node:http";
import { DefaultWorkspaceStore } from "../src/core/index.ts";
import { NodeWorkspaceStorage } from "../src/shells/web/nodeStorage.ts";
import { createPithWebServer } from "../src/shells/web/server.ts";
import { nativeWorkbenchFixture } from "./native-workbench-fixture.ts";
import { seedCitations, exerciseCitations, exerciseNarrowCitation } from "./task65-citation-fixture.ts";
import { testSandbox } from "./sandbox.ts";

for (const host of ["Web", "Obsidian"] as const) test(`${host}: S1-imported files use the shared citation rules, page bounds and paused media seek`, { skip: !process.env.PITH_PLAYWRIGHT_MODULE || !process.env.PITH_CHROME_PATH, timeout: 45000 }, async () => {
  const root = await testSandbox("task65-citations-");
  let server: Server | undefined, browser: any;
  try {
    const storage = new NodeWorkspaceStorage(root), store = new DefaultWorkspaceStore(storage);
    await store.ensureScaffold();
    await storage.writeText("_cache/web-settings.json", JSON.stringify({ preset: "all", persona: "sanctuary", plugins: {}, agentId: "", agentConfigured: true }));
    const fixture = await seedCitations(store, storage);
    const { chromium } = await import(process.env.PITH_PLAYWRIGHT_MODULE!);
    browser = await chromium.launch({ executablePath: process.env.PITH_CHROME_PATH, headless: !process.env.PITH_TASK65_SCREENSHOTS });
    const page = await browser.newPage({ viewport: { width: 1120, height: 840 } });
    page.setDefaultTimeout(7000);
    if (host === "Web") {
      server = await createPithWebServer({ workspaceDir: root });
      const address = server.address(); assert.ok(address && typeof address !== "string");
      await page.goto(`http://127.0.0.1:${address.port}`);
    } else await nativeWorkbenchFixture(page, root);
    const screenshots = process.env.PITH_TASK65_SCREENSHOTS;
    await exerciseCitations(page, fixture, screenshots && host === "Web" ? { directory: screenshots, host: "web" } : undefined);
    await page.getByRole("button", { name: "返回首页" }).click();
    await page.setViewportSize({ width: 800, height: 840 });
    if (host === "Obsidian") await page.addStyleTag({ content: "body button { display:inline-flex; white-space:nowrap; height:30px; box-shadow:0 0 0 1px gray; }" });
    await exerciseNarrowCitation(page, fixture.narrowTopic.id, screenshots && host === "Web"
      ? step => page.screenshot({ path: join(screenshots, `web-${step}.png`) }) : undefined);
  } finally {
    try { await browser?.close(); }
    finally {
      if (server) await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve()));
      await rm(root, { recursive: true, force: true });
    }
  }
});
