import assert from "node:assert/strict";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { DefaultWorkspaceStore, type SelectionAnchor, type Topic } from "../src/core/index.ts";
import { createPithWebServer } from "../src/shells/web/server.ts";
import { NodeWorkspaceStorage } from "../src/shells/web/nodeStorage.ts";
import { nativeWorkbenchFixture } from "./native-workbench-fixture.ts";
import { testSandbox } from "./sandbox.ts";

const enabled = Boolean(process.env.PITH_PLAYWRIGHT_MODULE && process.env.PITH_CHROME_PATH);
const shared = "共同原文证据：只有确认前提，结论才成立。";
const bottom = "课题甲的底部证据：检验不成立的边界。";
const lessonQuote = "讲义专属证据：用材料检验假设。";
const file = "same.md";
const source = (title: string) => `# ${title}\n\n${shared}\n\n${Array.from({ length: 35 }, (_, index) => `中间段落 ${index}：沿着原文核对推理条件和可复现的反例。`).join("\n\n")}\n\n${bottom}`;

async function selectFirstParagraph(page: any): Promise<void> {
  await page.locator('.pith-article p[data-prose="true"]').first().evaluate((node: HTMLElement) => {
    const range = document.createRange(); range.selectNodeContents(node);
    const selection = getSelection()!; selection.removeAllRanges(); selection.addRange(range);
    node.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  });
}
async function openNavigationFile(page: any, materialId?: string): Promise<void> {
  await page.locator(".pith-nav-toggle").click();
  await page.locator(materialId ? `.pith-left-drawer [data-material-id="${materialId}"][data-file="${file}"]` : `.pith-left-drawer [data-lesson][data-file="${file}"]`).click();
}
async function openNotes(page: any): Promise<void> {
  if (!await page.locator(".pith-guide").isVisible()) await page.locator(".pith-guide-toggle").click();
  await page.locator('[data-guide-tab="notes"]').click();
}
async function waitForMark(page: any, id: string, owner: string): Promise<void> {
  await page.waitForFunction(({ id, owner }: { id: string; owner: string }) => {
    const mark = Array.from(document.querySelectorAll<HTMLElement>("mark[data-pith-note]")).find(node => node.dataset.pithNote === id && node.dataset.noteOwner === owner);
    if (!mark) return false;
    const reader = mark.closest(".pith-reader")!.getBoundingClientRect(), box = mark.getBoundingClientRect();
    return box.bottom > reader.top && box.top < reader.bottom;
  }, { id, owner }).catch((error: Error) => { throw new Error(`note anchor not visible for owner ${owner}: ${error.message}`); });
}
async function capture(page: any, name: string): Promise<void> {
  if (!process.env.PITH_MATERIAL_NOTES_CAPTURE_DIR) return;
  await mkdir(process.env.PITH_MATERIAL_NOTES_CAPTURE_DIR, { recursive: true });
  await page.screenshot({ path: join(process.env.PITH_MATERIAL_NOTES_CAPTURE_DIR, `${name}.png`) });
}

for (const host of ["Web", "Obsidian"]) test(`${host} reuses material records read-only across two topics without changing note ownership`, { skip: !enabled, timeout: 90000 }, async t => {
  const root = await testSandbox("task52-material-notes-"), workspace = join(root, "workspace"); await mkdir(workspace);
  const storage = new NodeWorkspaceStorage(workspace), store = new DefaultWorkspaceStore(storage); await store.ensureScaffold();
  const materials = await Promise.all(["材料甲", "材料乙"].map(title => store.importMaterial({ title, kind: "article", aids: [], files: [{ name: file, mimeType: "text/markdown", bytes: new TextEncoder().encode(source(title)) }] })));
  await storage.writeText("_cache/web-settings.json", JSON.stringify({ preset: "all", persona: "sanctuary", plugins: {}, agentId: "", agentConfigured: true }));
  let server: Awaited<ReturnType<typeof createPithWebServer>> | undefined, browser: any;
  try {
    const { chromium } = await import(process.env.PITH_PLAYWRIGHT_MODULE!);
    browser = await chromium.launch({ executablePath: process.env.PITH_CHROME_PATH, headless: true });
    const page = await browser.newPage({ viewport: { width: 1250, height: 850 } }); page.setDefaultTimeout(5000);
    let agentRequests = 0; const errors: string[] = [];
    page.on("pageerror", (error: Error) => errors.push(error.message));
    page.on("request", (request: any) => { if (/\/api\/(chat|intake)$/.test(new URL(request.url()).pathname) && request.method() === "POST") agentRequests++; });
    if (host === "Web") { server = await createPithWebServer({ workspaceDir: workspace }); const address = server.address(); assert.ok(address && typeof address !== "string"); await page.goto(`http://127.0.0.1:${address.port}`); }
    else await nativeWorkbenchFixture(page, workspace);

    // Material captures use the actual UI; topic creation below is Store preparation, not Agent acceptance.
    for (const material of materials) {
      await page.locator(`[data-material="${material.id}"]`).click(); await page.locator(".pith-article h1").getByText(material.title, { exact: true }).waitFor();
      await selectFirstParagraph(page); await page.locator('[data-selection="highlight"]').click(); await page.locator(".pith-article mark").first().waitFor();
      await selectFirstParagraph(page); await page.locator('[data-selection="note"]').click();
      await page.locator(".pith-guide textarea").fill(`${material.title}的永久笔记`); await page.locator("[data-guide-send]").click();
      await page.locator(".pith-note-source").filter({ hasText: `${material.title}的永久笔记` }).waitFor();
      assert.equal((await store.getMaterial(material.id))!.notes.length, 2);
      if (material !== materials.at(-1)) await page.locator('[data-command="home"]').click();
    }
    const permanent = await Promise.all(materials.map(async material => (await store.getMaterial(material.id))!.notes));
    const topics: Topic[] = [];
    for (const title of ["课题甲", "课题乙"]) {
      const topic = await store.createTopic({ title, target: "按归属复用原文证据", materialIds: materials.map(material => material.id), toolkits: [] });
      await store.writeLesson(topic.id, file, `# ${title}讲义\n\n${shared}\n\n${lessonQuote}`); topics.push(topic);
    }
    // Only OS randomness is fixed to create legal same-ID notes in different ledgers.
    const duplicate = async (id: string, anchor: SelectionAnchor, body: string) => {
      const random = t.mock.method(crypto, "randomUUID", () => id.slice(2) as ReturnType<typeof crypto.randomUUID>);
      try { return await store.appendTopicNote(topics[0]!.id, { kind: "note", author: "user", body, anchor }); }
      finally { random.mock.restore(); }
    };
    const lessonNote = await duplicate(permanent[0]![1]!.id, { source: { kind: "lesson" }, file, locator: "text:line:4", quote: lessonQuote }, "课题甲讲义笔记");
    const topicNote = await duplicate(permanent[0]![0]!.id, { source: { kind: "material", materialId: materials[0]!.id }, file, locator: `text:offset:${source("材料甲").indexOf(bottom)}`, quote: bottom }, "课题甲底部笔记");
    await page.locator('[data-command="home"]').click();
    await page.locator(`[data-topic="${topics[0]!.id}"]`).click();
    await page.locator(".pith-article h1").getByText("课题甲讲义", { exact: true }).waitFor();
    await openNavigationFile(page, materials[0]!.id);
    await page.locator(".pith-article h1").getByText("材料甲", { exact: true }).waitFor(); await openNotes(page);
    assert.ok(await page.locator(".pith-article mark").filter({ hasText: shared }).count(), "existing material highlight vanished inside its topic");
    const topicSection = page.locator('[data-note-section="topic"]'), materialSection = page.locator('[data-note-section="material"]');
    assert.equal(await topicSection.getByRole("heading", { name: "课题笔记", exact: true }).count(), 1);
    assert.equal(await materialSection.getByRole("heading", { name: "材料笔记 · 材料甲", exact: true }).count(), 1);
    assert.equal(await materialSection.getByText("只读", { exact: true }).count(), 1);
    assert.equal(await page.locator('[data-guide-tab="notes"]').textContent(), "笔记 2 · 材料 2", "topic count must exclude material notes");
    assert.equal(await page.locator('[data-guide-send]').textContent(), "保存笔记", "notes tab action must say save note");
    assert.equal(await topicSection.locator(".pith-note-source").count(), 2); assert.equal(await materialSection.locator(".pith-note-source").count(), 2);
    await capture(page, `${host.toLowerCase()}-topic-material-notes`);

    // Same note id/file, different owner and source: the readonly material note must not open the lesson.
    await page.locator(".pith-reader").evaluate((node: HTMLElement) => { node.scrollTop = node.scrollHeight; });
    await materialSection.locator(`[data-note-id="${lessonNote.id}"]`).click();
    await waitForMark(page, lessonNote.id, `material:${materials[0]!.id}`);
    assert.equal(await page.locator(".pith-article h1").textContent(), "材料甲");
    // Same note id/file/source, different owners and quotes: scroll to the owning note's actual mark.
    await topicSection.locator(`[data-note-id="${topicNote.id}"]`).click();
    await waitForMark(page, topicNote.id, "primary");
    const primaryMark = page.locator(`mark[data-pith-note="${topicNote.id}"][data-note-owner="primary"]`);
    const materialMark = page.locator(`mark[data-pith-note="${topicNote.id}"][data-note-owner="material:${materials[0]!.id}"]`);
    const visible = (mark: any) => mark.evaluate((node: HTMLElement) => { const reader = node.closest(".pith-reader")!.getBoundingClientRect(), box = node.getBoundingClientRect(); return box.bottom > reader.top && box.top < reader.bottom; });
    assert.equal(await visible(primaryMark), true); assert.equal(await visible(materialMark), false);
    await materialSection.locator(`[data-note-id="${topicNote.id}"]`).click();
    await waitForMark(page, topicNote.id, `material:${materials[0]!.id}`);
    assert.equal(await visible(materialMark), true); assert.equal(await visible(primaryMark), false);
    await topicSection.locator(`[data-note-id="${lessonNote.id}"]`).click();
    await page.locator(".pith-article h1").getByText("课题甲讲义", { exact: true }).waitFor();
    assert.equal(await page.locator('[data-guide-tab="notes"]').textContent(), "笔记 2", "lessons must not show a material count");
    assert.equal(await materialSection.count(), 0, "material notes must clear when opening a lesson"); assert.equal(await page.locator('mark[data-note-owner^="material:"]').count(), 0);
    assert.equal(await page.locator(".pith-article mark").count(), 1);
    await page.locator('[data-note-section="topic"]').locator(`[data-note-id="${topicNote.id}"]`).click();
    await materialSection.getByRole("heading", { name: "材料笔记 · 材料甲", exact: true }).waitFor();

    await openNavigationFile(page, materials[1]!.id); await materialSection.getByRole("heading", { name: "材料笔记 · 材料乙", exact: true }).waitFor();
    assert.equal((await materialSection.innerText()).includes("材料甲的永久笔记"), false);
    assert.equal(await page.locator('mark[data-note-owner="primary"]').count(), 0, "same filename/quote must not match another material's topic note");
    await selectFirstParagraph(page); await page.locator('[data-selection="note"]').click(); await page.locator(".pith-guide textarea").fill("课题甲内新增，仍归课题");
    await page.locator("[data-guide-send]").click(); await topicSection.locator(".pith-note-source").filter({ hasText: "课题甲内新增，仍归课题" }).waitFor();
    assert.equal((await store.getTopic(topics[0]!.id))!.notes.length, 3);
    await selectFirstParagraph(page); await page.locator('[data-selection="highlight"]').click(); await page.locator('[data-guide-tab="notes"]').filter({ hasText: /^笔记 4 · 材料 2$/ }).waitFor();
    assert.equal((await store.getTopic(topics[0]!.id))!.notes.at(-1)!.anchor!.source.kind, "material");
    await page.locator('[data-guide-tab="chat"]').click(); assert.equal(await page.locator("[data-guide-send]").textContent(), "发送");
    await page.locator('[data-guide-tab="notes"]').click(); assert.equal(await page.locator("[data-guide-send]").textContent(), "保存笔记");
    await page.locator('[data-command="home"]').click(); await page.locator(`[data-topic="${topics[1]!.id}"]`).click();
    await page.locator(".pith-article h1").getByText("课题乙讲义", { exact: true }).waitFor();
    await openNavigationFile(page, materials[0]!.id); await openNotes(page);
    await materialSection.getByRole("heading", { name: "材料笔记 · 材料甲", exact: true }).waitFor();
    assert.equal(await page.locator('[data-guide-tab="notes"]').textContent(), "笔记 0 · 材料 2", "material records are visible even when the new topic has no notes");
    assert.equal((await page.locator(".pith-guide-content").innerText()).includes("课题甲内新增，仍归课题"), false);
    await page.locator(".pith-guide textarea").fill("课题乙专属笔记"); await page.locator("[data-guide-send]").click();
    await page.locator(".pith-guide-content p").filter({ hasText: "课题乙专属笔记" }).waitFor();
    assert.equal(await page.locator('[data-guide-tab="notes"]').textContent(), "笔记 1 · 材料 2");
    assert.equal(await page.locator(".pith-guide-content p").filter({ hasText: "课题乙专属笔记" }).count(), 1);
    await page.locator('[data-command="home"]').click(); await page.locator(`[data-material="${materials[0]!.id}"]`).click(); await page.locator(".pith-article h1").getByText("材料甲", { exact: true }).waitFor();
    if (!await page.locator(".pith-guide").isVisible()) {
      const target = await page.locator(".pith-guide-toggle").evaluate((button: HTMLElement) => {
        const box = button.getBoundingClientRect(), hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
        return { reachable: hit?.closest("button") === button, root: button.closest(".pith-view")?.getBoundingClientRect().toJSON(), button: box.toJSON(), blocker: hit?.outerHTML };
      });
      assert.ok(target.reachable, `host pane overlaps reader controls: ${JSON.stringify(target)}`);
      await page.locator(".pith-guide-toggle").click();
    }
    await page.locator(".pith-note-source").filter({ hasText: "材料甲的永久笔记" }).waitFor();
    assert.equal(await page.locator("[data-note-section]").count(), 0); assert.equal(await page.locator('[data-guide-tab="chat"]').count(), 0);
    assert.equal(await page.locator('[data-guide-tab="notes"]').textContent(), "笔记 2");
    assert.equal((await page.locator(".pith-guide-content").innerText()).includes("课题甲讲义笔记"), false);
    if (host === "Web") await capture(page, "web-standalone-notes");
    assert.deepEqual(await Promise.all(materials.map(async material => (await store.getMaterial(material.id))!.notes)), permanent);
    assert.equal((await store.getTopic(topics[1]!.id))!.notes.length, 1); assert.equal(agentRequests, 0); assert.deepEqual(errors, []);
  } finally {
    if (browser) await browser.close();
    if (server) await new Promise<void>((resolve, reject) => { server!.close(error => error ? reject(error) : resolve()); server!.closeAllConnections(); });
    await rm(root, { recursive: true, force: true });
  }
});
