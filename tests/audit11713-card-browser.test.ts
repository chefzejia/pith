import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { build } from "esbuild";
import { testSandbox } from "./sandbox.ts";

// Relevant rules observed in Obsidian 1.15.0 app.css, not an invented native layout.
// The source excerpt/hash is archived with the Worker report; no local app is required.
const nativeButtons = `:root{--input-height:30px}button{display:inline-flex;align-items:center;justify-content:center;height:var(--input-height);white-space:nowrap}`;
const base = `html,body,#root{height:100%;margin:0}body{--background-primary:#fff;--background-secondary:#f6f6f7;--background-modifier-border:#e4e4e7;--background-modifier-hover:#ececef;--text-normal:#18181b;--text-muted:#71717a;--text-accent:#4e6a56;--font-interface:system-ui,sans-serif;font:15px/1.6 var(--font-interface)}button,input,textarea{font:inherit;color:inherit}`;
const enabled = Boolean(process.env.PITH_PLAYWRIGHT_MODULE && process.env.PITH_CHROME_PATH);
type Rect = { left: number; right: number; top: number; bottom: number };

async function geometry(page: any, selector: string) {
  return page.locator(selector).evaluateAll((buttons: HTMLButtonElement[]) => buttons.map(button => {
    const rect = (node: Element): Rect => { const r = node.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }; };
    const text: Rect[] = [], walker = document.createTreeWalker(button, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) if (walker.currentNode.textContent?.trim()) { const range = document.createRange(); range.selectNodeContents(walker.currentNode); for (const r of range.getClientRects()) text.push({ left: r.left, right: r.right, top: r.top, bottom: r.bottom }); }
    const style = getComputedStyle(button), contentLeft = rect(button).left + parseFloat(style.paddingLeft) + parseFloat(style.borderLeftWidth);
    return { label: button.textContent, box: rect(button), container: rect(button.parentElement!), contentLeft, text, children: Array.from(button.children).map(rect), scrollWidth: button.scrollWidth, clientWidth: button.clientWidth, scrollHeight: button.scrollHeight, clientHeight: button.clientHeight };
  }));
}

function assertGeometry(items: Awaited<ReturnType<typeof geometry>>, card: boolean) {
  assert.equal(items.length, 4);
  for (const item of items) {
    assert.ok(item.text.length > 0);
    assert.ok(item.box.left >= item.container.left - 1 && item.box.right <= item.container.right + 1, `button outside list: ${JSON.stringify(item)}`);
    assert.ok(Math.abs((card ? item.children[0]!.left : item.text[0]!.left) - item.contentLeft) <= 1, `content lost left alignment: ${JSON.stringify(item)}`);
    for (const r of [...item.children, ...item.text]) assert.ok(r.left >= item.box.left - 1 && r.right <= item.box.right + 1 && r.top >= item.box.top - 1 && r.bottom <= item.box.bottom + 1, `content outside click boundary: ${JSON.stringify(item)}`);
    assert.ok(item.scrollWidth <= item.clientWidth + 1 && item.scrollHeight <= item.clientHeight + 1, `clipped content: ${JSON.stringify(item)}`);
    if (card) assert.ok(item.children[0]!.right <= item.children[1]!.left, `cover overlaps copy: ${JSON.stringify(item)}`);
    for (let index = 1; index < item.text.length; index++) assert.ok(item.text[index]!.top >= item.text[index - 1]!.bottom - 1, `text overlaps: ${JSON.stringify(item)}`);
  }
  for (let a = 0; a < items.length; a++) for (let b = a + 1; b < items.length; b++) {
    const first = items[a]!.box, second = items[b]!.box;
    assert.ok(first.right <= second.left + 1 || second.right <= first.left + 1 || first.bottom <= second.top + 1 || second.bottom <= first.top + 1, "buttons overlap");
  }
}

for (const host of ["web", "native-rule"]) for (const surface of ["library", "picker"]) test(`material ${surface} contains covers and complete text in ${host} layout`, { skip: !enabled, timeout: 30000 }, async () => {
  const root = await testSandbox("audit11713-card-");
  let browser: any;
  try {
    const bundle = await build({ entryPoints: ["tests/audit11713-card-fixture.ts"], bundle: true, write: false, platform: "browser", format: "iife", globalName: "CardLayout" });
    const { chromium } = await import(process.env.PITH_PLAYWRIGHT_MODULE!);
    browser = await chromium.launchPersistentContext(join(root, "profile"), { executablePath: process.env.PITH_CHROME_PATH, headless: true, viewport: { width: 1100, height: 1000 } });
    const page = await browser.newPage(); page.setDefaultTimeout(5000);
    await page.setContent(`<style>${base}${host === "native-rule" ? nativeButtons : ""}</style><div id="root"></div>`);
    await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
    await page.evaluate(() => { (window as any).cardLayout = (window as any).CardLayout.mountMaterialCards(document.getElementById("root")); });
    await page.evaluate(async () => { await document.fonts.ready; await Promise.all(Array.from(document.querySelectorAll(".pith-material-card img"), image => (image as HTMLImageElement).decode())); });
    if (surface === "picker") { await page.evaluate(() => (window as any).cardLayout.openPicker()); await page.locator('.pith-material-picker-list button').nth(3).waitFor(); }
    const selector = surface === "library" ? ".pith-material-card" : ".pith-material-picker-list button";
    const observations = [];
    for (const width of [1100, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      const items = await geometry(page, selector); observations.push({ width, items });
      if (process.env.PITH_CARD_CAPTURE_DIR) {
        const directory = process.env.PITH_CARD_CAPTURE_DIR; await mkdir(directory, { recursive: true });
        await writeFile(join(directory, `${host}-${surface}-geometry.json`), JSON.stringify(observations, null, 2));
        if ((surface === "library" && width === 1100) || (surface === "picker" && width === 390 && host === "native-rule")) {
          if (surface === "library") await page.locator('.pith-library').scrollIntoViewIfNeeded();
          await page.screenshot({ path: join(directory, `${host}-${surface}.png`) });
        }
      }
      assertGeometry(items, surface === "library");
    }
    const clickable = page.locator(selector).first(); await clickable.scrollIntoViewIfNeeded(); await clickable.click();
    await page.waitForFunction(() => (window as any).cardLayout.clicks.includes("card-0"));
    await page.evaluate(() => (window as any).cardLayout.dispose());
  } finally { if (browser) await browser.close(); await rm(root, { recursive: true, force: true }); }
});
