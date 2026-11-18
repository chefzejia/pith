import assert from "node:assert/strict";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { createPithWebServer } from "../src/shells/web/server.ts";
import { nativeWorkbenchFixture } from "./native-workbench-fixture.ts";
import { testSandbox } from "./sandbox.ts";
import { seedSettledCount } from "./settled-count-fixture.ts";

test("settled record count stays on one line beside long copy in both hosts", { skip: !process.env.PITH_PLAYWRIGHT_MODULE || !process.env.PITH_CHROME_PATH, timeout: 60000 }, async () => {
  const dir = await testSandbox("settled-count-");
  let browser: any, server: Awaited<ReturnType<typeof createPithWebServer>> | undefined;
  try {
    const workspace = join(dir, "workspace");
    await mkdir(workspace);
    const topic = await seedSettledCount(workspace);
    server = await createPithWebServer({ workspaceDir: workspace });
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const { chromium } = await import(process.env.PITH_PLAYWRIGHT_MODULE!);
    browser = await chromium.launchPersistentContext(join(dir, "profile"), { executablePath: process.env.PITH_CHROME_PATH, headless: true });
    for (const host of ["Web", "Obsidian"] as const) {
      const page = await browser.newPage();
      await page.setViewportSize({ width: 1280, height: 850 });
      if (host === "Web") await page.goto(`http://127.0.0.1:${address.port}`);
      else await nativeWorkbenchFixture(page, workspace);
      const row = page.locator(`.pith-settled-row[data-topic="${topic.id}"]`);
      await row.waitFor();
      assert.equal(await row.locator("strong").textContent(), topic.title);
      assert.equal(await row.locator("small").textContent(), topic.target);
      assert.equal(await row.locator(":scope > span").last().textContent(), "2 条记录");
      for (const width of [1280, 390]) {
        await page.setViewportSize({ width, height: 850 });
        const layout = await row.evaluate((button: HTMLButtonElement) => {
          const copy = button.firstElementChild!, count = button.lastElementChild!;
          const lines = (element: Element) => {
            const range = document.createRange();
            range.selectNodeContents(element);
            return Array.from(range.getClientRects()).filter(rect => rect.width && rect.height);
          };
          const bounds = button.getBoundingClientRect(), countRects = lines(count);
          return {
            countLines: new Set(countRects.map(rect => Math.round(rect.top))).size,
            countFits: countRects.every(rect => rect.left >= copy.getBoundingClientRect().right - 1 && rect.right <= bounds.right + 1),
            titleLines: new Set(lines(copy.querySelector("strong")!).map(rect => Math.round(rect.top))).size,
            targetLines: new Set(lines(copy.querySelector("small")!).map(rect => Math.round(rect.top))).size,
            rowFits: button.scrollWidth <= button.clientWidth + 1,
          };
        });
        assert.equal(layout.countLines, 1, `${host} at ${width}px: settled count must occupy one rendered line`);
        assert.ok(layout.countFits && layout.rowFits, `${host} at ${width}px: text must fit without overlap`);
        if (width === 390) assert.ok(layout.titleLines > 1 && layout.targetLines > 1, `${host}: long copy must wrap in a narrow pane`);
      }
      await row.click();
      await page.locator(".pith-title").getByText(topic.title, { exact: true }).waitFor();
      await page.close();
    }
  } finally {
    if (browser) await browser.close();
    if (server) await new Promise<void>((ok, fail) => server!.close(error => error ? fail(error) : ok()));
    await rm(dir, { recursive: true, force: true });
  }
});
