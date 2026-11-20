import assert from "node:assert/strict";
import { mkdir, rm } from "node:fs/promises";
import type { Server } from "node:http";
import { join } from "node:path";
import test from "node:test";
import { DefaultWorkspaceStore, type LibraryOverview } from "../src/core/index.ts";
import { NodeWorkspaceStorage } from "../src/shells/web/nodeStorage.ts";
import { createPithWebServer } from "../src/shells/web/server.ts";
import { testSandbox } from "./sandbox.ts";
import { remoteFixture } from "./task59-remote-fixture.ts";
import { libraryAgent } from "./task67-acp-fixture.ts";

test("task67 Web feeds two paths and a remote together, starts from the library, and shows a live attachment", {
  skip: !process.env.PITH_PLAYWRIGHT_MODULE || !process.env.PITH_CHROME_PATH, timeout: 60000,
}, async () => {
  const root = await testSandbox("task67-browser-");
  let context: any, server: Server | undefined, git: Awaited<ReturnType<typeof remoteFixture>> | undefined;
  let complete!: () => void;
  const waitForReply = new Promise<void>(resolve => { complete = resolve; });
  try {
    git = await remoteFixture(root);
    const left = join(root, "Kernel repository"), right = join(root, "Plugin repository"), workspace = join(root, "workspace");
    await git.git("clone", "--no-local", git.source, left);
    await git.git("clone", "--no-local", git.source, right);
    await mkdir(workspace);
    const storage = new NodeWorkspaceStorage(workspace), store = new DefaultWorkspaceStore(storage);
    const question = "插件和远端仓库如何划分职责？", same = "已经有课题在研究插件职责吗？";
    const recommendation = "可以继续「仓库的插件职责」，那里已有相关材料。";
    const reason = "选了 Plugin repository 和 fixture/repository，因为它们分别提供本地实现和远端对照。";
    let topicId = "", attachedId = "";
    const agent = libraryAgent(workspace, store, storage, async (scene, call) => {
      const library = await call<LibraryOverview>("pith_list_library", {});
      if (scene.endsWith(same)) {
        assert.equal(library.topics.find(topic => topic.id === topicId)?.status, "shelved");
        return recommendation;
      }
      if (scene.endsWith(question)) {
        assert.match(scene, /# 材料（这次带来的）\n\[\]/);
        const ids = library.materials.filter(material => material.title === "Plugin repository" || material.repository?.source === git!.url).map(material => material.id);
        assert.equal(ids.length, 2);
        const topic = await call<{ id: string }>("pith_create_topic", { title: "仓库的插件职责", target: question, materialIds: ids, toolkits: [] });
        topicId = topic.id;
        await call("pith_write_lesson", { fileName: "01-职责.md", markdown: "# 仓库的插件职责\n\n比较组件边界。" });
        return reason;
      }
      assert.match(scene, /# 材料库与课题/);
      attachedId = library.materials.find(material => material.title === "Kernel repository")!.id;
      await call("pith_attach_material", { materialId: attachedId });
      await waitForReply;
      return "已引用 Kernel repository，供内核与插件对照。";
    });
    server = await createPithWebServer({ workspaceDir: workspace, guideProvider: agent.provider });
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const { chromium } = await import(process.env.PITH_PLAYWRIGHT_MODULE!);
    const captures = process.env.PITH_TASK67_SCREENSHOT_DIR;
    context = await chromium.launchPersistentContext(join(root, "profile"), {
      executablePath: process.env.PITH_CHROME_PATH, headless: !captures, viewport: { width: 1280, height: 840 },
    });
    const page = context.pages()[0]!;
    await page.goto("http://127.0.0.1:" + address.port);
    const input = page.getByRole("textbox", { name: "目标或材料" });
    const submit = page.getByRole("button", { name: "提交", exact: true });
    const cards = page.locator(".pith-material-card");
    await input.fill('"' + left + '" "' + right + '" ' + git.url);
    await submit.click();
    await cards.nth(2).waitFor();
    assert.equal(await cards.count(), 3);
    assert.equal((await store.listMaterials()).length, 3);
    assert.equal((await store.listTopics()).length, 0);
    assert.equal(agent.prompts.length, 0);
    if (captures) await page.screenshot({ path: join(captures, "web-mixed-material-intake.png"), type: "png" });

    await input.fill(question);
    await submit.click();
    await page.getByText(reason, { exact: true }).waitFor();
    assert.equal((await store.getTopic(topicId))?.materialIds.length, 2);
    const conversation = JSON.parse(await storage.readText("topics/" + topicId + "/conversation.json"));
    assert.ok(conversation[0].steps.some((step: { name?: string; status?: string }) => step.name === "pith_list_library" && step.status === "completed"));
    const message = page.getByRole("textbox", { name: "消息" });
    await message.fill("还有哪份材料可补充内核对照？");
    await page.getByRole("button", { name: "发送", exact: true }).click();
    await page.locator(".pith-nav-toggle").click();
    await page.locator(".pith-repository-group h3").getByText("Kernel repository", { exact: true }).waitFor();
    assert.ok((await store.getTopic(topicId))?.materialIds.includes(attachedId));
    assert.equal(await page.locator("[data-guide-stop]").isVisible(), true);
    if (captures) await page.screenshot({ path: join(captures, "web-attached-in-contents.png"), type: "png" });
    complete();
    await page.getByText("已引用 Kernel repository，供内核与插件对照。", { exact: true }).waitFor();
    await page.locator("[data-command=home]").click();
    await cards.filter({ hasText: "Kernel repository" }).filter({ hasText: "1 个课题引用" }).waitFor();
    await store.updateTopic(topicId, { status: "shelved" });
    await page.reload();
    await input.fill(same);
    await submit.click();
    await page.getByText(recommendation, { exact: true }).waitFor();
    await submit.waitFor();
    assert.equal(await input.getAttribute("placeholder"), "继续提问…");
    assert.equal((await store.listTopics()).length, 1);
    if (captures) await page.screenshot({ path: join(captures, "web-reuse-shelved-topic.png"), type: "png" });
  } finally {
    complete();
    if (context) await context.close();
    if (server) await new Promise<void>((resolve, reject) => { server!.close(error => error ? reject(error) : resolve()); server!.closeAllConnections(); });
    await git?.close();
    await rm(root, { recursive: true, force: true });
  }
});
