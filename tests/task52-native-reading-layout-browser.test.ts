import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { DefaultWorkspaceStore } from "../src/core/index.ts";
import { NodeWorkspaceStorage } from "../src/shells/web/nodeStorage.ts";
import { nativeWorkbenchFixture } from "./native-workbench-fixture.ts";
import { testSandbox } from "./sandbox.ts";

const enabled = Boolean(process.env.PITH_PLAYWRIGHT_MODULE && process.env.PITH_CHROME_PATH);

for (const scenario of ["default-collapsed", "already-expanded", "user-selected-outline"] as const) test(`native topic guide restores only its own sidebar expansion: ${scenario}`, { skip: !enabled, timeout: 60000 }, async () => {
  const otherRightLeaf = scenario === "already-expanded", retainOpen = scenario !== "default-collapsed";
  const root = await testSandbox("task52-native-layout-"), workspace = join(root, "workspace"); await mkdir(workspace);
  const store = new DefaultWorkspaceStore(new NodeWorkspaceStorage(workspace)); await store.ensureScaffold();
  const quote = "共同原文证据：只有确认前提，结论才成立。材料记录必须能随时回到完整可见的原文。";
  const material = await store.importMaterial({ title: "布局材料", kind: "article", aids: [], files: [{ name: "reading.md", mimeType: "text/markdown", bytes: new TextEncoder().encode(`# 布局材料\n\n${quote}\n\n${Array.from({ length: 20 }, (_, i) => `第 ${i} 段：核对正文与笔记是否分别保有完整的可见空间。`).join("\n\n")}`) }] });
  await store.appendMaterialNote(material.id, { kind: "highlight", author: "user", body: quote, anchor: { source: { kind: "material", materialId: material.id }, file: "reading.md", locator: "text:line:4", quote } });
  const topic = await store.createTopic({ title: "布局课题", target: "检查场景转换", materialIds: [material.id], toolkits: [] });
  await store.writeLesson(topic.id, "lesson.md", "# 布局讲义\n\n打开向导，然后返回首页。\n");
  let browser: any;
  try {
    const { chromium } = await import(process.env.PITH_PLAYWRIGHT_MODULE!);
    browser = await chromium.launchPersistentContext(join(root, "profile"), { executablePath: process.env.PITH_CHROME_PATH, headless: true, viewport: { width: retainOpen ? 1440 : 1024, height: 700 } });
    const page = await browser.newPage(); page.setDefaultTimeout(5000);
    await nativeWorkbenchFixture(page, workspace, false, { otherRightLeaf });
    await page.locator(`[data-topic="${topic.id}"]`).click(); await page.locator(".pith-guide-toggle").click(); await page.locator(".pith-guide").waitFor({ state: "visible" });
    if (scenario === "user-selected-outline") await page.locator('[data-host-tab="outline"]').click();
    await page.locator('[data-command="home"]').click(); await page.locator(`[data-material="${material.id}"]`).click();
    await page.locator(".pith-article h1").getByText("布局材料", { exact: true }).waitFor();
    await page.locator(".pith-guide-toggle").click(); await page.locator(".pith-note-source").waitFor();
    const observed = await page.evaluate(() => {
      const w = window as any, reader = document.querySelector<HTMLElement>(".pith-reader")!, guide = document.querySelector<HTMLElement>(".pith-guide")!;
      const paragraph = document.querySelector(".pith-article p")!, range = document.createRange(); range.selectNodeContents(paragraph);
      return { pithHostLeaves: w.nativeTask52.workspace.getLeavesOfType("pith-guide").length, hostTabs: w.nativeTask52.workspace.getLayout().right.children[0].children.length, otherHostLeaves: w.nativeTask52.workspace.getLeavesOfType("outline").length, hostCollapsed: w.nativeTask52.workspace.rightSplit.collapsed, rootWidth: document.getElementById("root")!.clientWidth, mode: document.querySelector<HTMLElement>(".pith-view")!.dataset.sheetMode, reader: reader.getBoundingClientRect().toJSON(), notes: guide.getBoundingClientRect().toJSON(), text: Array.from(range.getClientRects(), rect => rect.toJSON()) };
    });
    if (process.env.PITH_NATIVE_LAYOUT_CAPTURE_DIR) {
      await mkdir(process.env.PITH_NATIVE_LAYOUT_CAPTURE_DIR, { recursive: true });
      await writeFile(join(process.env.PITH_NATIVE_LAYOUT_CAPTURE_DIR, `transition-${scenario}.json`), JSON.stringify(observed, null, 2));
    }
    assert.equal(observed.pithHostLeaves, 0, `topic guide host leaf survived home: ${JSON.stringify(observed)}`);
    assert.equal(observed.mode, "split-right");
    assert.ok(observed.reader.right <= observed.notes.left + 1, `notes cover prose: ${JSON.stringify(observed)}`);
    assert.equal(observed.hostTabs, 5, "default host tabs must survive guide detach");
    assert.equal(observed.otherHostLeaves, 1); assert.equal(observed.hostCollapsed, !retainOpen, "restore only Pith-owned expansion; retain original/user-selected host views");
    assert.equal(observed.rootWidth, retainOpen ? 1110 : 1024);
    assert.ok(observed.text.every((rect: any) => rect.left >= observed.reader.left && rect.right <= observed.reader.right + 1), "actual prose must reflow within its visible reader");
    await page.locator(".pith-guide-toggle").click(); await page.locator(".pith-guide").waitFor({ state: "hidden" });
    await page.locator(".pith-guide-toggle").click(); await page.locator(".pith-note-source").click();
    await page.waitForFunction(() => { const mark = document.querySelector(".pith-article mark")!.getBoundingClientRect(), reader = document.querySelector(".pith-reader")!.getBoundingClientRect(); return mark.top >= reader.top && mark.bottom <= reader.bottom && mark.right <= reader.right; });
    await page.locator('[data-command="home"]').click(); await page.locator(`[data-topic="${topic.id}"]`).click();
    await page.locator(".pith-guide").waitFor({ state: "visible" });
    await page.evaluate(() => (window as any).nativeTask52.view.onClose());
    const closed = await page.evaluate(() => { const w = (window as any).nativeTask52.workspace; return { guide: w.getLeavesOfType("pith-guide").length, other: w.getLeavesOfType("outline").length, collapsed: w.rightSplit.collapsed }; });
    assert.deepEqual(closed, { guide: 0, other: 1, collapsed: !retainOpen }, "host view close must also release its guide without altering other leaves");
  } finally { if (browser) await browser.close(); await rm(root, { recursive: true, force: true }); }
});
