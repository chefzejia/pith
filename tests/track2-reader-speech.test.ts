import assert from "node:assert/strict";
import test from "node:test";
import { deflateRawSync } from "node:zlib";
import { extractProseBlocks, markdownSections, renderFile, renderMarkdown } from "../src/plugins/stage-reader/index.ts";
import { createReadAloudSession, filterProseOnly } from "../src/plugins/speech-service/index.ts";

const markdown = `---
title: Private metadata
---
# Heading
First sentence. Second sentence!

~~~ts
const secret = "do not read";
~~~

| Header | Value |
| --- | --- |
| hidden | data |

$$
x + y = z
$$
> A final thought.
`;

test("Markdown blocks and rendered locators exclude non-prose from speech", () => {
  const blocks = extractProseBlocks(markdown);
  const sentences = filterProseOnly(blocks);
  assert.deepEqual(sentences.map(s => s.text), ["Heading", "First sentence.", "Second sentence!", "A final thought."]);
  const html = renderMarkdown(markdown);
  assert.match(html, /<h1 id="line-3" data-locator="text:line:3" data-prose="true">Heading<\/h1>/);
  for (const locator of ["text:line:6", "text:line:10", "text:line:14"]) assert.ok(html.includes(`data-locator="${locator}" data-prose="false"`));
  assert.ok(!html.includes("Private metadata"));
  assert.match(renderMarkdown("A **bold** and `code` example."), /<strong>bold<\/strong> and <code>code<\/code>/);
  assert.deepEqual(markdownSections("---\n# Hidden\n---\n# Visible").map(s => s.title), ["Visible"]);
});

test("Markdown lists retain nested structure and only HTTP links are clickable", () => {
  const text = '- First [safe](https://example.com/a?x=1&y=2)\n    1. Nested `code`\n    2. [local](file:///secret)\n- Last [script](javascript:alert)\n\n<img src=x onerror=alert(1)>';
  const html = renderMarkdown(text);
  assert.match(html, /<ul><li data-locator="text:line:0" data-prose="true">First <a href="https:\/\/example.com\/a\?x=1&amp;y=2"/);
  assert.match(html, /<ol><li data-locator="text:line:1" data-prose="true">Nested <code>code<\/code><\/li><li data-locator="text:line:2" data-prose="true">local<\/li><\/ol>/);
  assert.doesNotMatch(html, /href="(?:file|javascript):|<img/);
  assert.match(html, /&lt;img/);
  assert.deepEqual(extractProseBlocks(text).slice(0, 4).map(block => block.locator), ["text:line:0", "text:line:1", "text:line:2", "text:line:3"]);
  assert.match(renderMarkdown("3. Three\n4. Four"), /^<ol start="3">/);
});

test("read-aloud starts at selected sentence and rejects non-prose", () => {
  const blocks = extractProseBlocks(markdown);
  const session = createReadAloudSession(blocks, "text:line:4;offset:20");
  assert.equal(session.started, true);
  if (!session.started) return;
  assert.equal(session.current().text, "Second sentence!");
  const seen: string[] = [];
  const unsubscribe = session.onLocatorChange(locator => seen.push(locator));
  assert.equal(session.next()?.text, "A final thought.");
  assert.equal(session.next(), null);
  assert.equal(session.previous()?.text, "Second sentence!");
  unsubscribe();
  assert.deepEqual(seen, ["text:line:4;offset:16", "text:line:17;offset:0", "text:line:4;offset:16"]);
  assert.deepEqual(createReadAloudSession(blocks, "text:line:6"), { started: false, reason: "not-prose", tip: "此处非正文段落，无法伴读" });
  assert.deepEqual(createReadAloudSession(blocks, "do not read"), { started: false, reason: "not-prose", tip: "此处非正文段落，无法伴读" });
  assert.deepEqual(createReadAloudSession(blocks, "missing"), { started: false, reason: "not-found" });
  const byText = createReadAloudSession(blocks, "Second sentence");
  assert.equal(byText.started && byText.current().text, "Second sentence!");
});

function zip(files: Record<string, string>, compressed: boolean): Uint8Array {
  const locals: Buffer[] = [], central: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const n = Buffer.from(name), data = Buffer.from(text), payload = compressed ? deflateRawSync(data) : data;
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(compressed ? 8 : 0, 8); local.writeUInt32LE(payload.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(n.length, 26);
    const record = Buffer.alloc(46); record.writeUInt32LE(0x02014b50); record.writeUInt16LE(compressed ? 8 : 0, 10); record.writeUInt32LE(payload.length, 20); record.writeUInt32LE(data.length, 24); record.writeUInt16LE(n.length, 28); record.writeUInt32LE(offset, 42);
    locals.push(local, n, payload); central.push(record, n); offset += local.length + n.length + payload.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

const container = `<?xml version="1.0"?><container><rootfiles><rootfile full-path="OEBPS/book.opf"/></rootfiles></container>`;
const chapter = `<html xmlns="http://www.w3.org/1999/xhtml"><body><h1 id="start">Chapter One</h1><p>First sentence. Second sentence.</p><blockquote><p>Quoted text.</p><pre>nested code</pre></blockquote><pre>do not read</pre><table><tr><td>secret table</td></tr></table><script>bad()</script></body></html>`;
const file = { name: "book.epub", mimeType: "application/epub+zip", bytes: 0, sha256: "" };

for (const compressed of [false, true]) test(`EPUB ${compressed ? "deflate" : "stored"} spine and nested Nav`, async () => {
  const opf = `<package><metadata><dc:title>Test &amp; Book</dc:title></metadata><manifest><item id="c" href="chapter.xhtml" media-type="application/xhtml+xml"/><item id="nav" href="nav.xhtml" properties="nav" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c"/></spine></package>`;
  const nav = `<html><body><nav epub:type="toc"><ol><li><a href="chapter.xhtml#start">Chapter</a><ol><li><a href="chapter.xhtml">Subchapter</a></li></ol></li></ol></nav></body></html>`;
  const view = await renderFile(file, zip({ "META-INF/container.xml": container, "OEBPS/book.opf": opf, "OEBPS/chapter.xhtml": chapter, "OEBPS/nav.xhtml": nav }, compressed));
  assert.equal(view.title, "Test & Book");
  assert.deepEqual(view.sections.map(s => [s.title, s.level, s.locator]), [["Chapter", 1, 'epub:{"chapter":0,"fragment":"start"}'], ["Subchapter", 2, 'epub:{"chapter":0,"fragment":""}']]);
  assert.deepEqual(filterProseOnly(view.blocks!).map(s => s.text), ["Chapter One", "First sentence.", "Second sentence.", "Quoted text."]);
  assert.ok(!view.html.includes("<script>"));
  assert.match(view.html, /data-prose="false"/);
});

test("EPUB NCX and malformed archives", async () => {
  const opf = `<package><metadata><title>Book</title></metadata><manifest><item id="c" href="chapter.xhtml"/><item id="toc" href="toc.ncx" media-type="application/x-dtbncx+xml"/></manifest><spine><itemref idref="c"/></spine></package>`;
  const ncx = `<ncx><navMap><navPoint><navLabel><text>Part</text></navLabel><content src="chapter.xhtml#start"/></navPoint></navMap></ncx>`;
  const view = await renderFile(file, zip({ "META-INF/container.xml": container, "OEBPS/book.opf": opf, "OEBPS/chapter.xhtml": chapter, "OEBPS/toc.ncx": ncx }, false));
  assert.equal(view.sections[0]?.title, "Part");
  await assert.rejects(renderFile(file, new Uint8Array([1, 2, 3])), /Invalid ZIP/);
  await assert.rejects(renderFile(file, zip({ "META-INF/container.xml": container, "OEBPS/book.opf": opf.replace('href="chapter.xhtml"', 'href="../../escape"') }, false)), /traversal/);
});
