import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { DefaultWorkspaceStore } from "../src/core/index.ts";
import { createPithWebServer } from "../src/shells/web/server.ts";
import { NodeWorkspaceStorage } from "../src/shells/web/nodeStorage.ts";
import { nativeWorkbenchFixture } from "./native-workbench-fixture.ts";
import { testSandbox } from "./sandbox.ts";
import { intakeFailure, intakeMaterialFixture, intakeReply, intakeThought } from "./task66-intake-fixture.ts";

for (const host of ["web", "obsidian"] as const) {
  test(`${host} intake refreshes Home in place and hides thought until expanded`, {
    timeout: 60000, skip: !process.env.PITH_PLAYWRIGHT_MODULE || !process.env.PITH_CHROME_PATH,
  }, async () => {
    const root = await testSandbox(`task66-intake-${host}-`);
    const storage = new NodeWorkspaceStorage(root), store = new DefaultWorkspaceStore(storage);
    const fixture = intakeMaterialFixture(store, storage);
    let browser: any, server: Awaited<ReturnType<typeof createPithWebServer>> | undefined;
    try {
      const { chromium } = await import(process.env.PITH_PLAYWRIGHT_MODULE!);
      browser = await chromium.launch({ executablePath: process.env.PITH_CHROME_PATH });
      const page = await browser.newPage({ viewport: { width: 1100, height: 760 } });
      if (host === "web") {
        server = await createPithWebServer({ workspaceDir: root, guideProvider: fixture.provider });
        const address = server.address(); assert.ok(address && typeof address !== "string");
        await page.goto(`http://127.0.0.1:${address.port}/`);
      } else await nativeWorkbenchFixture(page, root, true, { intakeMaterials: true });

      const input = page.getByRole("textbox", { name: "目标或材料" });
      const submit = page.locator("[data-intake-open]");
      const library = page.getByRole("region", { name: "材料库" });
      const count = library.locator(".pith-home-heading span");
      const statusLine = page.locator(".pith-intake-box [role=status]");
      const thought = page.locator(".pith-intake-step details.pith-guide-thought");
      const thoughtBody = thought.locator("div");
      for (const [index, exit] of ["completed", "failed", "stopped"].entries()) {
        await input.fill(exit);
        const originalInput = await input.elementHandle();
        await submit.click();
        await page.locator(".pith-intake-step").filter({ hasText: "pith_ingest_external · 完成" }).waitFor();
        await library.getByRole("button", { name: new RegExp(`Notes for ${exit}`) }).waitFor();
        assert.equal(await count.textContent(), String(index + 1));
        assert.equal((await store.listMaterials()).length, index + 1);
        assert.equal(await input.evaluate((node: HTMLInputElement, original: HTMLElement) => node === original, originalInput), true);
        assert.equal(await input.inputValue(), exit);
        assert.equal(await statusLine.textContent(), "向导正在立项…");
        assert.equal(await thoughtBody.isVisible(), false);
        await thought.locator("summary").click();
        assert.equal(await thoughtBody.isVisible(), true);
        assert.equal(await thoughtBody.textContent(), intakeThought);
        if (exit === "completed") await thought.locator("summary").click();
        if (exit === "stopped") await submit.click();
        else if (host === "web") fixture.finish();
        else await page.evaluate(() => (window as any).intakeFixture.finish());
        await page.getByRole("button", { name: "提交", exact: true }).waitFor();
        assert.equal(await count.textContent(), String(index + 1));
        assert.equal(await input.evaluate((node: HTMLInputElement, original: HTMLElement) => node === original, originalInput), true);
        assert.equal(await input.inputValue(), exit === "completed" ? "" : exit);
        assert.equal(await statusLine.textContent(), exit === "completed" ? "请补充目标后再次提交" : exit === "failed" ? intakeFailure : "已停止");
        assert.equal(await thoughtBody.isVisible(), exit !== "completed");
        if (exit === "completed") {
          assert.equal(await page.getByText(intakeReply, { exact: true }).isVisible(), true);
          const screenshots = process.env.PITH_TASK66_SCREENSHOT_DIR;
          if (screenshots) await page.screenshot({ path: join(screenshots, `${host}-intake.png`) });
        }
        await originalInput.dispose();
      }
    } finally {
      fixture.finish();
      if (browser) await browser.close();
      if (server) await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve()));
      await rm(root, { recursive: true, force: true });
    }
  });
}
