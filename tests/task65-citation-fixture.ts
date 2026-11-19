import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { WorkspaceStoragePort, WorkspaceStore } from "../src/core/index.ts";
import { repositoryCitations, type CitationPosition } from "../src/core/repositoryCitations.ts";
import { createScopedTools } from "../src/plugins/guide-acp/tools.ts";
import type { PublicHttpPort } from "../src/plugins/guide-acp/externalIngest.ts";
import { coverPng, storedZip } from "./task29-fixture.ts";
import { manyPagePdf, pdfFixture } from "./task55-pdf-fixture.ts";

export const lesson = "01-course.md";
const course = "https://courses.example.com";
const longPdf = "60a95dc31bbc56630c079dcfcc95ec53_MIT6_004s09_lec17.pdf";
const longCitation = longPdf + "#page=2";
const valid = ["lecture.pdf#page=2", "lecture.pdf#page=3", "slides.cbz#page=2", "fixed.epub#page=2", "lecture.webm#t=0:02", "lecture.webm#t=1.5"];
const invalid = ["lecture.pdf#page=4", "missing.pdf#page=1", "lecture.pdf#page=0", "lecture.pdf#page=2.5", "slides.cbz#page=3", "fixed.epub#page=3", "flow.epub#page=1", "lecture.webm#t=9", "lecture.webm#t=0:70", "lecture.webm#t=-1"];

function epub(fixed: boolean) {
  return storedZip({
    "META-INF/container.xml": '<container><rootfile full-path="O/book.opf"/></container>',
    "O/book.opf": `<package><metadata>${fixed ? '<meta property="rendition:layout">pre-paginated</meta>' : ""}</metadata><manifest><item id="one" href="one.xhtml"/><item id="two" href="two.xhtml"/></manifest><spine><itemref idref="one"/><itemref idref="two"/></spine></package>`,
    "O/one.xhtml": "<html><body><p>First spread</p></body></html>",
    "O/two.xhtml": "<html><body><p>Second spread</p></body></html>",
  });
}

export async function seedCitations(store: WorkspaceStore, storage: WorkspaceStoragePort) {
  const encoder = new TextEncoder();
  const http: PublicHttpPort = {
    async request() { assert.fail("unprotected transport"); },
    async requestPublic(spec) {
      const path = new URL(spec.url).pathname;
      const [bytes, type] = path === "/lesson/lecture.pdf" ? [pdfFixture("Memory overview", "Address translation"), "application/pdf"]
        : path === "/practice/lecture.pdf" ? [manyPagePdf(3), "application/pdf"]
        : [encoder.encode("<main><h1>Exercises</h1><p>Trace a memory reference.</p></main>"), "text/html"];
      return { status: 200, headers: { "content-type": type }, bytes, text: () => new TextDecoder().decode(bytes) };
    },
  };
  const tools = createScopedTools({ store, storage, http, onChoices() {} });
  const ingest = tools.find(tool => tool.name === "pith_ingest_external")!;
  const one = await ingest.execute({ title: "Course notes", urls: [course + "/lesson/lecture.pdf", course + "/lesson/exercises"] }) as { material: { id: string } };
  const two = await ingest.execute({ title: "Practice set", urls: [course + "/practice/lecture.pdf"] }) as { material: { id: string } };
  const media = await store.importMaterial({ title: "Recorded lecture", kind: "media", files: [
    { name: "lecture.webm", mimeType: "video/webm", bytes: await readFile(new URL("./fixtures/task38-video.webm", import.meta.url)) },
    { name: "lecture.vtt", mimeType: "text/vtt", bytes: encoder.encode("WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nMapping a virtual address\n") },
  ] });
  const books = await store.importMaterial({ title: "Image and book slides", kind: "book", files: [
    { name: "slides.cbz", mimeType: "application/x-cbz", bytes: storedZip({ "1.png": coverPng, "2.png": coverPng }) },
    { name: "fixed.epub", mimeType: "application/epub+zip", bytes: epub(true) },
    { name: "flow.epub", mimeType: "application/epub+zip", bytes: epub(false) },
  ] });
  await store.importMaterial({ title: "Unreferenced", kind: "book", files: [{ name: "missing.pdf", mimeType: "application/pdf", bytes: pdfFixture() }] });
  const topic = await store.createTopic({ title: "Course source navigation", target: "How does virtual address translation work?", materialIds: [one.material.id, two.material.id, media.id, books.id], toolkits: [] });
  await store.writeLesson(topic.id, lesson, `# Course source navigation

## Course readings

Start at \`${valid[0]}\`, then compare ${valid[1]}.

## Lecture slides and recording

Review ${valid[2]} and ${valid[3]}. Watch ${valid[4]} or ${valid[5]}.

[Public lecture at 2 seconds](https://example.com/lecture#t=2)

## Invalid references

${invalid.map(text => `- \`${text}\``).join("\n")}
`);
  const narrowMaterial = await store.importMaterial({ title: "Memory lecture", kind: "book", files: [
    { name: longPdf, mimeType: "application/pdf", bytes: pdfFixture("Memory overview", "Two-level page tables") },
  ] });
  const narrowTopic = await store.createTopic({ title: "Virtual address translation", target: "How do two-level page tables work?", materialIds: [narrowMaterial.id], toolkits: [] });
  await store.writeLesson(narrowTopic.id, lesson, `# Virtual address translation

Read the second page:

${longCitation}

The page below this reference explains the two levels.
`);
  return { topic, one: one.material.id, two: two.material.id, books: books.id, media: media.id, narrowTopic };
}

export async function exerciseNarrowCitation(page: any, topicId: string, capture?: (step: string) => Promise<void>) {
  await page.locator(`.pith-topic-card[data-topic="${topicId}"]`).click();
  await page.locator(".pith-guide-toggle").click();
  await page.locator(".pith-guide-content").waitFor();
  await page.waitForFunction(() => {
    const width = document.querySelector(".pith-reader")?.clientWidth ?? 0;
    return width > 0 && width <= 500;
  });
  const citation = page.locator(".pith-article").getByRole("button", { name: longCitation, exact: true });
  await citation.waitFor();
  const layout = await citation.evaluate((node: HTMLElement) => {
    const article = node.closest<HTMLElement>(".pith-article")!, reader = node.closest<HTMLElement>(".pith-reader")!;
    const range = document.createRange();
    range.selectNodeContents(node);
    const lines = Array.from(range.getClientRects());
    const textBounds = node.parentElement!.getBoundingClientRect(), button = node.getBoundingClientRect();
    return {
      width: reader.clientWidth,
      lines: new Set(lines.map(rect => Math.round(rect.top))).size,
      overflow: [reader, article, node].map(element => element.scrollWidth - element.clientWidth),
      textFits: lines.every(rect => rect.left >= textBounds.left - 1 && rect.right <= textBounds.right + 1 && rect.top >= button.top - 1 && rect.bottom <= button.bottom + 1),
    };
  });
  assert.ok(layout.width > 0 && layout.width <= 500, `expected a narrow stage: ${JSON.stringify(layout)}`);
  assert.ok(layout.lines > 1 && layout.textFits && layout.overflow.every((value: number) => value <= 1), `long citation must wrap without clipping: ${JSON.stringify(layout)}`);
  await capture?.("narrow-citation");
  await citation.click();
  const second = page.locator('.pith-fixed-page[data-locator="page:2"]');
  await second.getByText("Two-level page tables").waitFor();
  await page.locator("[data-page-count]").getByText("2 / 2", { exact: true }).waitFor();
  await capture?.("narrow-pdf-page-2");
  return layout;
}

export async function exerciseCitations(page: any, fixture: Awaited<ReturnType<typeof seedCitations>>, evidence?: { directory: string; host: string }) {
  const article = page.locator(".pith-article");
  const citations = article.locator(".pith-source-citation");
  const capture = async (step: string) => {
    if (evidence) await page.screenshot({ path: join(evidence.directory, `${evidence.host}-${step}.png`) });
  };
  const open = async () => {
    await page.locator(".pith-nav-toggle").click();
    await page.locator(`[data-file="${lesson}"]`).click();
    await article.getByRole("heading", { name: "Course source navigation" }).waitFor();
  };
  await page.locator(`.pith-topic-card[data-topic="${fixture.topic.id}"]`).click();
  await article.getByRole("heading", { name: "Course source navigation" }).waitFor();
  await citations.filter({ hasText: "lecture.webm#t=1.5" }).waitFor();
  for (const text of invalid) {
    const node = article.locator("li").getByText(text, { exact: true });
    assert.equal(await node.count(), 1, `out-of-range or invalid source remains ordinary text: ${text}`);
    assert.equal(await article.locator("li .pith-source-citation").filter({ hasText: text }).count(), 0, `out-of-range or invalid source must not be clickable: ${text}`);
  }
  const sources = [
    { id: fixture.one, files: [{ name: "lecture.pdf", position: "page" as CitationPosition, limit: 2 }] },
    { id: fixture.two, files: [{ name: "lecture.pdf", position: "page" as CitationPosition, limit: 3 }] },
    { id: fixture.books, files: [{ name: "slides.cbz", position: "page" as CitationPosition, limit: 2 }, { name: "fixed.epub", position: "page" as CitationPosition, limit: 2 }] },
    { id: fixture.media, files: [{ name: "lecture.webm", position: "time" as CitationPosition, limit: 4 }] },
  ];
  const expected = repositoryCitations(valid, sources, (source, path) => source.files.find(file => file.name === path)?.limit).flatMap(matches =>
    matches.flatMap(match => match.sources.map(source => [match.path, match.locator, source.id])));
  assert.deepEqual(await citations.evaluateAll((nodes: HTMLElement[]) => nodes.map(node => [node.dataset.citationPath, node.dataset.citationLocator, node.dataset.citationMaterial])), expected, "the rendered buttons agree with the shared citation matcher");
  assert.deepEqual(await citations.filter({ hasText: "lecture.pdf#page=2" }).allTextContents(), ["lecture.pdf#page=2 (Course notes)", "lecture.pdf#page=2 (Practice set)"]);
  assert.equal(await article.getByRole("link", { name: "Public lecture at 2 seconds" }).getAttribute("href"), "https://example.com/lecture#t=2");
  await capture("lesson");
  await citations.filter({ hasText: "lecture.pdf#page=2 (Course notes)" }).click();
  const pdfPage = article.locator('.pith-fixed-page[data-locator="page:2"]');
  await pdfPage.getByText("Address translation").waitFor();
  await page.waitForFunction(() => {
    const page = document.querySelector('.pith-fixed-page[data-locator="page:2"]'), reader = document.querySelector(".pith-reader");
    if (!page || !reader) return false;
    const bounds = page.getBoundingClientRect(), viewport = reader.getBoundingClientRect();
    return bounds.left + bounds.width / 2 >= viewport.left && bounds.left + bounds.width / 2 < viewport.right;
  });
  await capture("pdf-page-2");
  await open();
  await citations.filter({ hasText: "lecture.pdf#page=3 (Practice set)" }).click();
  await article.locator('.pith-fixed-page[data-locator="page:3"]').waitFor();
  await open();
  await citations.filter({ hasText: "slides.cbz#page=2" }).click();
  await article.locator('.pith-fixed-page[data-locator="page:2"]').waitFor();
  await open();
  await citations.filter({ hasText: "fixed.epub#page=2" }).click();
  await article.locator('.pith-epub-chapter[data-locator="page:2"]').getByText("Second spread").waitFor();
  await open();
  await citations.filter({ hasText: "lecture.webm#t=0:02" }).click();
  await page.waitForFunction(() => {
    const media = document.querySelector<HTMLVideoElement>(".pith-article video");
    return media?.paused && Math.abs(media.currentTime - 2) < 0.05;
  });
  assert.equal(await page.getByRole("button", { name: "播放", exact: true }).count(), 1);
  await capture("video-paused");
}
