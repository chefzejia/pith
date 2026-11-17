import assert from "node:assert/strict";
import { access, mkdir } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { DefaultWorkspaceStore } from "../src/core/index.ts";
import { createScopedTools } from "../src/plugins/guide-acp/tools.ts";
import { createPithWebServer } from "../src/shells/web/server.ts";
import { NodeWorkspaceStorage } from "../src/shells/web/nodeStorage.ts";
import { remoteFixture } from "./task59-remote-fixture.ts";

test("GUI remote intake and topic picker use real git, stop partial clones, retain failures and reuse material", { timeout: 60000, skip: !process.env.PITH_PLAYWRIGHT_MODULE || !process.env.PITH_CHROME_PATH }, async () => {
  const f = await remoteFixture(), workspace = join(f.root, "workspace"); await mkdir(workspace);
  const storage = new NodeWorkspaceStorage(workspace), store = new DefaultWorkspaceStore(storage);
  const received: string[] = [];
  const server = await createPithWebServer({ workspaceDir: workspace, guideProvider: { async run(input, options) {
    assert.equal(input.scope.kind, "intake"); if (input.scope.kind !== "intake") throw new Error("intake scope required"); received.push(input.text);
    const tool = createScopedTools({ store, storage, materialIds: input.scope.materialIds, toolkits: [], onChoices() {} }).find(tool => tool.name === "pith_create_topic")!;
    const args = { title: input.text, target: input.text, materialIds: input.scope.materialIds, toolkits: [] }, topic = await tool.execute(args);
    options.onStep({ kind: "tool", name: tool.name, callId: "create", inputPreview: "{}", status: "completed", effects: await tool.effects!(topic, args) }, 0);
    return { status: "completed" };
  } } });
  let browser: any, page: any;
  try {
    const address = server.address(); assert.ok(address && typeof address !== "string");
    const { chromium } = await import(process.env.PITH_PLAYWRIGHT_MODULE!); browser = await chromium.launch({ executablePath: process.env.PITH_CHROME_PATH, headless: true });
    page = await browser.newPage({ viewport: { width: 1024, height: 800 } }); page.setDefaultTimeout(10000);
    await page.goto(`http://127.0.0.1:${address.port}`);
    const input = page.locator('[name="title"]');
    const hold = await f.holdPack(); await input.fill(f.url); await page.locator('[data-intake-open]').click(); await hold.arrived;
    await page.getByRole("status").filter({ hasText: "正在克隆仓库" }).waitFor(); await page.getByRole("button", { name: "停止", exact: true }).click();
    await page.getByRole("status").filter({ hasText: "已停止" }).waitFor();
    // Server cancellation is asynchronous; wait for the response-side cleanup acknowledgement via filesystem events.
    await page.waitForFunction(async () => { const state = await (await fetch('/api/state')).json(); return state.materials.length === 0; });
    await hold.release();
    await input.press("Enter"); await page.locator(".pith-article").getByText("export const before = 1;").waitFor();
    const first = (await store.listMaterials())[0]!; assert.equal(first.remoteUrl, f.url); assert.equal((await store.listMaterials()).length, 1);
    await page.locator('[data-command="home"]').click(); await input.fill(f.url + ".git/"); await input.press("Enter"); await page.locator(".pith-article").getByText("export const before = 1;").waitFor(); assert.equal((await store.listMaterials()).length, 1);
    await page.locator('[data-command="home"]').click();
    const missing = "https://github.com/fixture/missing"; await f.git("config", "--global", `url.file://${join(f.root, "absent.git")}.insteadOf`, missing);
    await input.fill(missing); await input.press("Enter"); await page.getByRole("status").filter({ hasText: /仓库操作失败/ }).waitFor(); assert.equal(await input.inputValue(), missing); assert.equal((await store.listMaterials()).length, 1);
    await input.fill(`理解仓库边界 ${f.url}`); await input.press("Enter"); await page.locator('[data-command="home"]').waitFor();
    assert.deepEqual(received, ["理解仓库边界"]); assert.deepEqual((await store.listTopics())[0]!.materialIds, [first.id]);
    await page.getByRole("button", { name: "目录和材料", exact: true }).click(); await page.locator('[data-command="import"]').click();
    const picker = page.getByRole("region", { name: "添加材料" }), pickerInput = picker.locator("form input");
    const second = "https://github.com/fixture/second"; await f.git("config", "--global", "--add", `url.file://${f.remote}.insteadOf`, second);
    const held = await f.holdPack(); await pickerInput.fill(second); await picker.getByRole("button", { name: "导入并引用", exact: true }).click(); await held.arrived;
    await picker.getByRole("status").filter({ hasText: "正在克隆仓库" }).waitFor(); await picker.getByRole("button", { name: "停止", exact: true }).click(); await picker.getByRole("status").filter({ hasText: "已停止" }).waitFor(); await held.release();
    assert.equal(await pickerInput.inputValue(), second);
    await picker.getByRole("button", { name: "导入并引用", exact: true }).click(); await picker.getByRole("status").filter({ hasText: "材料已入库并引用" }).waitFor();
    assert.equal((await store.listMaterials()).length, 2); assert.equal((await store.listTopics())[0]!.materialIds.length, 2);
    await pickerInput.fill(f.url); await picker.getByRole("button", { name: "导入并引用", exact: true }).click(); await picker.getByRole("status").filter({ hasText: "材料已入库并引用" }).waitFor();
    assert.equal((await store.listMaterials()).length, 2); assert.equal((await store.listTopics())[0]!.materialIds.length, 2);
    await pickerInput.fill(missing); await picker.getByRole("button", { name: "导入并引用", exact: true }).click(); await picker.getByRole("status").filter({ hasText: "仓库操作失败" }).waitFor(); assert.equal(await pickerInput.inputValue(), missing);
    assert.ok(await picker.getByRole("button", { name: "导入并引用", exact: true }).isEnabled());
    await assert.rejects(access(join(f.repositories, "github.com/fixture/missing")), { code: "ENOENT" });
  } catch (error) { console.error(await page?.locator("body").innerText()); throw error; } finally { if (browser) await browser.close(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); await f.close(); }
});
