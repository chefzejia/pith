import { testToolkits } from "./guide-tools-fixture.ts";
import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import test from "node:test";
import { DefaultWorkspaceStore } from "../src/core/index.ts";
import { createScopedTools } from "../src/plugins/guide-acp/tools.ts";
import { renderFile, renderMarkdown, markdownSections } from "../src/plugins/stage-reader/index.ts";
import { NodeWorkspaceStorage } from "../src/shells/web/nodeStorage.ts";
import { testSandbox } from "./sandbox.ts";
import { manyPagePdf, pdfFixture } from "./task55-pdf-fixture.ts";

test("scoped material tool reads PDF pages in bounded resumable chunks without a DOM", async () => {
  const dir = await testSandbox("task55-pdf-node-");
  try {
    const storage = new NodeWorkspaceStorage(dir), store = new DefaultWorkspaceStore(storage);
    const longText = Array(1300).fill("longcontent").join(" "), bytes = pdfFixture("longcontent".repeat(1300), "Second page evidence");
    const material = await store.importMaterial({ title: "PDF evidence", kind: "book", files: [{ name: "book.pdf", mimeType: "application/pdf", bytes }] });
    const topic = await store.createTopic({ title: "PDF topic", target: "Read", materialIds: [material.id], toolkits: [] });
    const tools = createScopedTools({ toolkits: testToolkits, topicId: topic.id, store, storage, reader: { formats: ["pdf"], sections: markdownSections, render: renderMarkdown, renderFile }, onChoices() {} });
    const tool = tools.find(item => item.name === "pith_read_material")!;
    type Result = { blocks: { locator: string; text: string }[]; truncated: boolean; next: { startLine: number; startOffset: number } | null };
    const first = await tool.execute({ materialId: material.id, file: "book.pdf", maxLines: 1 }) as Result;
    assert.equal(first.blocks[0]!.locator, "page:1"); assert.equal(first.blocks[0]!.text.length, 12000); assert.deepEqual(first.next, { startLine: 0, startOffset: 12000 });
    const second = await tool.execute({ materialId: material.id, file: "book.pdf", maxLines: 1, ...first.next }) as Result;
    assert.equal(second.blocks[0]!.locator, "page:1"); assert.equal(first.blocks[0]!.text + second.blocks[0]!.text, longText); assert.deepEqual(second.next, { startLine: 1, startOffset: 0 });
    const third = await tool.execute({ materialId: material.id, file: "book.pdf", ...second.next }) as Result;
    assert.deepEqual(third.blocks.map(block => [block.locator, block.text]), [["page:2", "Second page evidence"]]); assert.equal(third.next, null);
    await assert.rejects(tool.execute({ materialId: "outside", file: "book.pdf" }), /scope/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("long PDFs retain their page locators without an arbitrary page-count cutoff", async () => {
  const result = await renderFile({ name: "long.pdf", mimeType: "application/pdf", bytes: 0, sha256: "" }, manyPagePdf(201));
  assert.equal(result.totalUnits, 201);
  assert.equal(result.blocks?.[200]?.locator, "page:201");
  assert.equal(result.blocks?.[200]?.text, "Long book");
});
