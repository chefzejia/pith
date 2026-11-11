import assert from "node:assert/strict";
import { mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import { ingestExternalUrl } from "../src/plugins/guide-acp/externalIngest.ts";
import { sampleEpubLanguage } from "../src/plugins/stage-reader/epub.ts";
import { extractProseBlocks, renderMarkdown } from "../src/plugins/stage-reader/index.ts";
import { createPithWebServer } from "../src/shells/web/server.ts";
import { NodeWorkspaceStorage } from "../src/shells/web/nodeStorage.ts";
import { defaultToolkitsForMaterial } from "../src/workbench/toolkitSlot.ts";
import { storedZip } from "./task29-fixture.ts";
import { testSandbox } from "./sandbox.ts";

const html = '<html><head><title>English &amp; Reading</title></head><body><nav>unwanted navigation</nav><article><h1>Learning together</h1><p>This is a complete English paragraph about learning and reading.</p><blockquote><p>Practice makes progress.</p><p>Another quote.</p><blockquote><p>Nested quote.</p></blockquote><p>Outer again.</p></blockquote><pre><code>if (a &lt; b) {\n\n\n  print(`hello`);\n}</code></pre><script>bad()</script></article></body></html>';
const http = { request: async () => { throw new Error("unexpected request"); }, requestPublic: async () => ({ status: 200, headers: { "content-type": "text/html" }, bytes: new TextEncoder().encode(html) }) };

test("external clipping preserves structure and rejects unsafe destinations", async () => {
  const bundle = await ingestExternalUrl({ url: "https://public.com/post" }, http), text = new TextDecoder().decode(bundle.files[0]!.bytes);
  assert.equal(bundle.title, "English & Reading"); assert.match(text, /# Learning together/); assert.match(text, /> Practice makes progress\.\n\n> Another quote\.\n\n> > Nested quote\.\n\n> Outer again\./); assert.match(text, /```\nif \(a < b\) \{\n\n\n  print\(`hello`\);\n\}\n```/); assert.doesNotMatch(text, /unwanted navigation|bad\(\)/);
  const rendered = renderMarkdown(text); assert.match(rendered, /<h1/); assert.match(rendered, /<blockquote[^>]*><blockquote>Nested quote\.<\/blockquote><\/blockquote>/); assert.match(rendered, /<pre[^>]*><code>if \(a &lt; b\) \{\n\n\n  print\(`hello`\);\n\}<\/code><\/pre>/); assert.doesNotMatch(rendered, /<script>/);
  const quotedHttp = { ...http, requestPublic: async () => ({ status: 200, headers: { "content-type": "text/html" }, bytes: new TextEncoder().encode('<article><blockquote><blockquote><pre>first\n\n&gt; second</pre></blockquote></blockquote></article>') }) };
  const quoted = await ingestExternalUrl({ url: "https://public.com/quoted" }, quotedHttp);
  const quotedText = new TextDecoder().decode(quoted.files[0]!.bytes); assert.match(quotedText, /> > ```\n> > first\n> > \n> > > second\n> > ```/);
  assert.match(renderMarkdown(quotedText), /<blockquote><blockquote><pre[^>]*data-prose="false"><code>first\n\n&gt; second<\/code><\/pre><\/blockquote><\/blockquote>/); assert.equal(extractProseBlocks(quotedText).some(block => block.isProse), false);
  await assert.rejects(ingestExternalUrl({ url: "http://127.0.0.1/private" }, http), /not public/);
});

test("EPUB classification reads bounded spine text rather than its title", async () => {
  const book = (text: string) => storedZip({ "META-INF/container.xml": '<container><rootfile full-path="O/book.opf"/></container>', "O/book.opf": '<package><metadata><dc:title>中文书名</dc:title></metadata><manifest><item id="chapter" href="chapter.xhtml"/></manifest><spine><itemref idref="chapter"/></spine></package>', "O/chapter.xhtml": `<html><body><p>${text}</p></body></html>` });
  const classify = async (text: string) => defaultToolkitsForMaterial({ kind: "book", files: [{ name: "中文.epub" }], sampleText: await sampleEpubLanguage(book(text)) });
  assert.deepEqual(await classify("This is an English paragraph about reading and understanding."), ["interline"]);
  assert.deepEqual(await classify("这是中文正文，应当保留中文的默认工具。"), ["feynman"]);
});

test("URL intake persists a structured article and defaults without ACP", { timeout: 60000, skip: !process.env.PITH_PLAYWRIGHT_MODULE || !process.env.PITH_CHROME_PATH }, async () => {
  const root = await testSandbox("task41-reading-"), workspace = join(root, "workspace"); await mkdir(workspace);
  let requests = 0, rejectTranslation = false;
  const server = await createPithWebServer({ workspaceDir: workspace, http, interlineTranslator: async input => { requests++; if (rejectTranslation) throw new Error("受控翻译不可用"); return new Map(input.segments.map(segment => [segment.locator, "受控翻译"])); } });
  let browser: any;
  try {
    const address = server.address(); assert.ok(address && typeof address !== "string"); const base = `http://127.0.0.1:${address.port}`;
    const { chromium } = await import(process.env.PITH_PLAYWRIGHT_MODULE!); browser = await chromium.launch({ executablePath: process.env.PITH_CHROME_PATH, headless: true });
    const page = await browser.newPage({ viewport: { width: 1000, height: 800 } }); page.setDefaultTimeout(8000); await page.goto(base);
    await page.locator('[name="title"]').fill("http://127.0.0.1/private"); await page.locator('[data-intake-open]').click(); await page.getByRole("status").getByText(/not public/).waitFor();
    let state = await (await fetch(base + "/api/state")).json() as any; assert.equal(state.compass.exploring.length, 0);
    await page.locator('[name="title"]').fill("https://public.com/post"); await page.locator('[data-intake-open]').click(); await page.locator('.pith-article h1').getByText("Learning together").waitFor();
    await page.locator('.pith-interline-subtitle').first().waitFor(); assert.ok(requests > 0);
    assert.equal(await page.locator('.pith-article pre code').textContent(), 'if (a < b) {\n\n\n  print(`hello`);\n}'); assert.equal(await page.locator('.pith-article blockquote blockquote').count(), 1); assert.equal(await page.locator('.pith-article pre').getAttribute('data-prose'), 'false');
    state = await (await fetch(base + "/api/state")).json() as any; const topic = state.compass.exploring[0]; assert.deepEqual(topic.toolkits, ["interline"]); assert.equal(topic.toolkitsOrigin, "default");
    assert.match(await new NodeWorkspaceStorage(workspace).readText(`materials/${topic.materialId}/files/article.md`), /# Learning together/);
    await page.locator('#open-dojo').click(); await page.locator('[data-dojo-choose="interline"]').click(); assert.equal(await page.locator('button[data-interline-mode="bilingual"]').getAttribute("aria-pressed"), "true");
    await mkdir(resolve(".tmp/evidence/task-41"), { recursive: true }); await page.screenshot({ path: resolve(".tmp/evidence/task-41/web-bilingual.png") });
    const update = await fetch(`${base}/api/topics/${encodeURIComponent(topic.id)}/toolkits`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ toolkits: ["feynman"] }) }); assert.equal(update.status, 200);
    await page.locator('[data-command="home"]').click(); await page.locator(`[data-topic="${topic.id}"]`).first().click(); await page.locator('.pith-article h1').getByText("Learning together").waitFor(); assert.match(await page.locator('#open-dojo').textContent(), /费曼/); assert.equal(await page.locator('.pith-interline-subtitle').count(), 0);
    rejectTranslation = true; await page.locator('[data-command="home"]').click(); await page.locator('[name="title"]').fill("https://public.com/failure"); await page.locator('[data-intake-open]').click(); await page.locator('.pith-toast-tip').getByText(/受控翻译不可用/).waitFor();
  } finally { if (browser) await browser.close(); await new Promise<void>((ok, fail) => server.close(error => error ? fail(error) : ok())); await rm(root, { recursive: true, force: true }); }
});
