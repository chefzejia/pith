import assert from "node:assert/strict";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { DefaultWorkspaceStore } from "../src/core/index.ts";
import { NodeWorkspaceStorage } from "../src/shells/web/nodeStorage.ts";
import { createPithWebServer } from "../src/shells/web/server.ts";
import { nativeWorkbenchFixture } from "./native-workbench-fixture.ts";
import { linkedEpub } from "./wave12-epub-fixture.ts";
import { fallbackCoverEpub } from "./audit11713-cover-fixture.ts";
import { testSandbox } from "./sandbox.ts";

const enabled = Boolean(process.env.PITH_PLAYWRIGHT_MODULE && process.env.PITH_CHROME_PATH);
for (const host of ["Web", "Obsidian"]) test(`A3 ${host} homepage uploads EPUB with unsafe optional covers and reads its local body`, { skip: !enabled, timeout: 60000 }, async () => {
  const root = await testSandbox("audit11713-cover-"), workspace = join(root, "workspace"); await mkdir(workspace);
  let browser: any, server: Awaited<ReturnType<typeof createPithWebServer>> | undefined;
  try {
    const store = new DefaultWorkspaceStore(new NodeWorkspaceStorage(workspace));
    if (host === "Web") server = await createPithWebServer({ workspaceDir: workspace });
    const { chromium } = await import(process.env.PITH_PLAYWRIGHT_MODULE!);
    browser = await chromium.launchPersistentContext(join(root, "profile"), { executablePath: process.env.PITH_CHROME_PATH, headless: true, viewport: { width: 1100, height: 800 } });
    const page = await browser.newPage(); page.setDefaultTimeout(8000);
    const outside: string[] = [], errors: string[] = []; let agentCalls = 0;
    await page.route('**/*', (route: any) => { const url = new URL(route.request().url()); if (!['localhost', '127.0.0.1'].includes(url.hostname)) { outside.push(url.origin); return route.abort(); } return route.continue(); });
    page.on('pageerror', (error: Error) => errors.push(error.message));
    page.on('request', (request: any) => { if (/\/api\/(?:chat|intake)$/.test(new URL(request.url()).pathname)) agentCalls++; });
    if (host === "Web") { const address = server!.address(); assert.ok(address && typeof address !== "string"); await page.goto(`http://127.0.0.1:${address.port}`); }
    else await nativeWorkbenchFixture(page, workspace);
    const upload = async (name: string, bytes: Uint8Array, heading: string) => {
      await page.locator('.pith-intake-box [type=file]').setInputFiles({ name, mimeType: 'application/epub+zip', buffer: Buffer.from(bytes) });
      await page.locator('[data-intake-open]').click(); await page.locator('.pith-epub-chapter h1').getByText(heading, { exact: true }).waitFor();
    };
    await upload('linked.epub', linkedEpub(), 'One');
    await page.locator('[data-command=home]').click();
    const linked = page.locator('.pith-material-card').filter({ hasText: 'Links' }); await linked.click(); await page.locator('.pith-epub-chapter h1').getByText('One', { exact: true }).waitFor();
    await page.locator('[data-command=home]').click();
    await upload('local-cover.epub', fallbackCoverEpub(), 'Local chapter');
    await page.locator('.pith-article').getByText('The local text remains readable.', { exact: true }).waitFor(); await page.locator('[data-command=home]').click();
    const covered = page.locator('.pith-material-card').filter({ hasText: 'Cover candidates' }); await covered.locator('img').waitFor();
    await covered.locator('img').evaluate((image: HTMLImageElement) => image.decode());
    const materials = await store.listMaterials(); assert.equal(materials.length, 2); assert.equal((await store.listTopics()).length, 0);
    assert.equal((await store.getMaterial(materials.find(item => item.title === 'Links')!.id))!.files[0]!.name, 'linked.epub');
    assert.equal(agentCalls, 0); assert.deepEqual(outside, []); assert.deepEqual(errors, []);
    if (host === 'Web' && process.env.PITH_WORKER_CAPTURE_DIR) { await mkdir(process.env.PITH_WORKER_CAPTURE_DIR, { recursive: true }); await page.screenshot({ path: join(process.env.PITH_WORKER_CAPTURE_DIR, 'uploaded-materials.png') }); }
  } finally { if (browser) await browser.close(); if (server) await new Promise<void>((resolve, reject) => { server!.close(error => error ? reject(error) : resolve()); server!.closeAllConnections(); }); await rm(root, { recursive: true, force: true }); }
});
