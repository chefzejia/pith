import assert from "node:assert/strict";
import test from "node:test";
import { deflateRawSync } from "node:zlib";
import { installReaderFont, READER_SANS_STACK, READER_SERIF_STACK, renderFile } from "../src/plugins/stage-reader/index.ts";
import { filterProseOnly } from "../src/plugins/speech-service/index.ts";
import { sanitizeStylesheet } from "../src/plugins/stage-reader/epubResources.ts";

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function zip(files: Record<string, string | Uint8Array>): Uint8Array {
  const local: Buffer[] = [], central: Buffer[] = [];
  let offset = 0;
  for (const [name, value] of Object.entries(files)) {
    const filename = Buffer.from(name), data = Buffer.from(value), compressed = deflateRawSync(data);
    const header = Buffer.alloc(30), record = Buffer.alloc(46);
    header.writeUInt32LE(0x04034b50); header.writeUInt16LE(8, 8); header.writeUInt32LE(crc32(data), 14); header.writeUInt32LE(compressed.length, 18); header.writeUInt32LE(data.length, 22); header.writeUInt16LE(filename.length, 26);
    record.writeUInt32LE(0x02014b50); record.writeUInt16LE(8, 10); record.writeUInt32LE(crc32(data), 16); record.writeUInt32LE(compressed.length, 20); record.writeUInt32LE(data.length, 24); record.writeUInt16LE(filename.length, 28); record.writeUInt32LE(offset, 42);
    local.push(header, filename, compressed); central.push(record, filename); offset += header.length + filename.length + compressed.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(central.length / 2, 8); end.writeUInt16LE(central.length / 2, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}

async function renderFixture(body: string, extra: Record<string, string | Uint8Array> = {}, nav = ""): ReturnType<typeof renderFile> {
  return renderFile({ name: "fixture.epub", mimeType: "application/epub+zip", bytes: 0, sha256: "" }, zip({
    "META-INF/container.xml": `<container><rootfile full-path="O/book.opf"/></container>`,
    "O/book.opf": `<package><manifest><item id="chapter" href="ch.xhtml"/><item id="nav" href="nav.xhtml" properties="nav"/></manifest><spine><itemref idref="chapter"/></spine></package>`,
    "O/nav.xhtml": `<html><body><nav epub:type="toc"><ol>${nav}</ol></nav></body></html>`,
    "O/ch.xhtml": `<html><body>${body}</body></html>`,
    ...extra,
  }));
}

test("inline SVG preserves safe local definitions and references while rejecting active or external content", async () => {
  const view = await renderFixture(`<svg xmlns:xlink="http://www.w3.org/1999/xlink"><defs><linearGradient id="g"><stop offset="0" stop-color="red"/></linearGradient><path id="p" d="M0 0 L2 2"/></defs><use href="#p"/><use xlink:href="#p"/><use href="https://invalid.example/x.svg#p"/><rect fill="url(#g)" style="stroke:url(#g)"/><rect fill="u\\72l(https://invalid.example/a)"/><image href="https://invalid.example/a.png"/><script>evil()</script></svg>`);
  assert.match(view.html, /<defs><linearGradient id="[^"]+"><stop offset="0" stop-color="red"/);
  const gradient = /linearGradient id="([^"]+)"/.exec(view.html);
  const path = /<path id="([^"]+)"/.exec(view.html);
  assert.ok(gradient && path);
  assert.ok(view.html.includes(`fill="url(#${gradient[1]})"`));
  assert.ok(view.html.includes(`stroke: url(#${gradient[1]})`));
  assert.ok(view.html.includes(`href="#${path[1]}"`));
  assert.ok(view.html.includes(`xlink:href="#${path[1]}"`));
  assert.doesNotMatch(view.html, /invalid\.example|<script|evil\(\)|\\72/);
  assert.match(view.html, /data-prose="false"/);
});

test("SVG inside a non-prose table uses the same sanitizer without nested speech blocks", async () => {
  const view = await renderFixture(`<table><tr><td><svg><defs><path id="shape" d="M0 0"/></defs><use href="#shape"/><rect fill="u\\72l(https://invalid.example/x)"/></svg></td></tr></table>`);
  const path = /<path id="([^"]+)"/.exec(view.html);
  assert.ok(path);
  assert.ok(view.html.includes(`href="#${path[1]}"`));
  assert.doesNotMatch(view.html, /invalid\.example|\\72/);
  assert.equal((view.html.match(/data-prose="false"/g) ?? []).length, 1);
  assert.equal(view.blocks!.length, 1);
});

test("repeated large images share resource budget while each reference renders", async () => {
  const image = Buffer.alloc(8 * 1024 * 1024);
  Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/aAAAAABJRU5ErkJggg==", "base64").copy(image);
  const view = await renderFixture(`<img src="large.png"/><img src="large.png"/><img src="large.png"/><img src="large.png"/>`, { "O/large.png": image });
  assert.equal((view.html.match(/src="data:image\/png;base64,/g) ?? []).length, 4);
  assert.equal(view.blocks!.filter(block => !block.isProse).length, 4);
});

test("repeated inline SVG images reuse the same resource", async () => {
  const image = Buffer.alloc(8 * 1024 * 1024);
  const view = await renderFixture(`<svg>${'<image href="large.png"/>'.repeat(4)}</svg>`, { "O/large.png": image });
  assert.equal((view.html.match(/href="data:image\/png;base64,/g) ?? []).length, 4);
});

test("nested SVG data is charged to final output only through its enclosing URL", async () => {
  const image = Buffer.alloc(10 * 1024 * 1024);
  const files = { "O/cover.svg": `<svg xmlns="http://www.w3.org/2000/svg"><image href="large.png"/></svg>`, "O/large.png": image };
  const view = await renderFixture('<img src="cover.svg"/>'.repeat(3), files);
  assert.equal((view.html.match(/src="data:image\/svg\+xml;base64,/g) ?? []).length, 3);
  const urls = [...view.html.matchAll(/src="(data:image\/svg\+xml;base64,[^"]+)"/g)];
  const total = urls.reduce((sum, url) => sum + url[1]!.length, 0);
  assert.ok(total < 64 * 1024 * 1024);
  assert.ok(total > 50 * 1024 * 1024);
  await assert.rejects(renderFixture('<img src="cover.svg"/>'.repeat(4), files), /EPUB output budget exceeded/);
});

test("nested SVG intermediate expansion remains bounded independently of final output", async () => {
  const image = Buffer.alloc(10 * 1024 * 1024);
  await assert.rejects(renderFixture('<img src="cover.svg"/>', {
    "O/cover.svg": `<svg xmlns="http://www.w3.org/2000/svg">${'<image href="large.png"/>'.repeat(5)}</svg>`,
    "O/large.png": image,
  }), /EPUB intermediate output budget exceeded/);
});

test("repeated spine chapters cannot amplify plain HTML beyond the book output limit", async () => {
  const chapter = `<html><body><p>${"a".repeat(128 * 1024)}</p></body></html>`;
  const opf = (count: number): string => `<package><manifest><item id="c" href="ch.xhtml"/></manifest><spine>${'<itemref idref="c"/>'.repeat(count)}</spine></package>`;
  const accepted = await renderFixture("", { "O/book.opf": opf(511), "O/ch.xhtml": chapter });
  assert.equal(accepted.totalUnits, 511);
  assert.ok(accepted.html.length < 64 * 1024 * 1024);
  assert.ok(accepted.html.length > 63 * 1024 * 1024);
  await assert.rejects(renderFixture("", { "O/book.opf": opf(520), "O/ch.xhtml": chapter }), /EPUB output budget exceeded/);
});

test("final HTML permits the exact limit and counts escaped output characters", async () => {
  const opf = `<package><manifest><item id="c" href="ch.xhtml"/><item id="d" href="last.xhtml"/></manifest><spine>${'<itemref idref="c"/>'.repeat(7)}<itemref idref="d"/></spine></package>`;
  const chapter = `<html><body><p>${"a".repeat(8 * 1024 * 1024)}</p></body></html>`;
  const common = { "O/book.opf": opf, "O/ch.xhtml": chapter };
  const baseLength = (await renderFixture("", { ...common, "O/last.xhtml": "<html><body><p>x</p></body></html>" })).html.length;
  const filler = 64 * 1024 * 1024 - baseLength + 1;
  const accepted = await renderFixture("", { ...common, "O/last.xhtml": `<html><body><p>${"x".repeat(filler)}</p></body></html>` });
  assert.equal(accepted.html.length, 64 * 1024 * 1024);
  await assert.rejects(renderFixture("", { ...common, "O/last.xhtml": `<html><body><p>${"x".repeat(filler - 1)}&amp;</p></body></html>` }), /EPUB output budget exceeded/);
});

test("final HTML budget includes prose and repeated image URLs exactly once", async () => {
  const image = Buffer.alloc(10 * 1024 * 1024);
  const pictures = '<img src="large.png"/>'.repeat(4);
  const accepted = await renderFixture(`<p>${"a".repeat(10 * 1024 * 1024)}</p>${pictures}`, { "O/large.png": image });
  assert.equal((accepted.html.match(/src="data:image\/png;base64,/g) ?? []).length, 4);
  assert.ok(accepted.html.length < 64 * 1024 * 1024);
  assert.ok(accepted.html.length > 63 * 1024 * 1024);
  await assert.rejects(renderFixture(`<p>${"a".repeat(12 * 1024 * 1024)}</p>${pictures}`, { "O/large.png": image }), /EPUB output budget exceeded/);
});

test("distinct resource and repeated output budget exhaustion raise explicit errors", async () => {
  const image = Buffer.alloc(10 * 1024 * 1024);
  await assert.rejects(renderFixture(`<img src="a.png"/><img src="b.png"/><img src="c.png"/>`, { "O/a.png": image, "O/b.png": image, "O/c.png": image }), /EPUB.*resource.*budget.*exceeded/i);
  const repeated = Buffer.alloc(8 * 1024 * 1024);
  await assert.rejects(renderFixture(`<img src="large.png"/>`.repeat(7), { "O/large.png": repeated }), /EPUB.*output.*budget.*exceeded/i);
  await assert.rejects(renderFixture("", {
    "O/book.opf": `<package><manifest><item id="a" href="ch.xhtml"/><item id="b" href="ch2.xhtml"/></manifest><spine><itemref idref="a"/><itemref idref="b"/></spine></package>`,
    "O/ch.xhtml": `<html><body>${'<img src="large.png"/>'.repeat(4)}</body></html>`,
    "O/ch2.xhtml": `<html><body>${'<img src="large.png"/>'.repeat(3)}</body></html>`,
    "O/large.png": repeated,
  }), /EPUB.*output.*budget.*exceeded/i);
});

test("SVG presentation attributes reject escaped CSS URLs in chapters and image documents", async () => {
  const dangerous = "u\\72l(https://invalid.example/a.svg#x)";
  const view = await renderFixture(`<svg><rect fill="red"/><rect fill="${dangerous}" stroke="${dangerous}"/><rect fill="var(--external)"/></svg><img src="cover.svg"/>`, {
    "O/cover.svg": `<svg xmlns="http://www.w3.org/2000/svg"><rect fill="red"/><rect fill="${dangerous}" style="stroke:${dangerous};fill:blue"/><rect fill="var(--external)"/></svg>`,
  });
  assert.match(view.html, /fill="red"/);
  assert.doesNotMatch(view.html, /invalid\.example|\\72|var\(/);
  const encoded = /data:image\/svg\+xml;base64,([^"]+)/.exec(view.html);
  assert.ok(encoded);
  const svg = Buffer.from(encoded[1]!, "base64").toString();
  assert.match(svg, /fill="red"/);
  assert.match(svg, /style="fill: blue"/);
  assert.doesNotMatch(svg, /invalid\.example|\\72|var\(/);
});

test("external SVG keeps safe gradients, local references and embedded ZIP images without external resources", async () => {
  const view = await renderFixture(`<img src="images/cover.svg"/>`, {
    "O/images/cover.svg": `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 10 10"><defs><linearGradient id="grad"><stop offset="0" stop-color="red"/></linearGradient><clipPath id="clip"><rect width="2" height="2"/></clipPath></defs><rect fill="url(#grad)" clip-path="url(#clip)" style="stroke:url(#grad);opacity:0.5"/><image xlink:href="../art.png" width="10" height="10"/><image href="https://invalid.example/a.png"/><image href="nested.svg"/><script>evil()</script></svg>`,
    "O/images/nested.svg": `<svg xmlns="http://www.w3.org/2000/svg"><image href="cover.svg"/><rect fill="blue"/></svg>`,
    "O/art.png": Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/aAAAAABJRU5ErkJggg==", "base64"),
  });
  const encoded = /data:image\/svg\+xml;base64,([^"]+)/.exec(view.html);
  assert.ok(encoded);
  const svg = Buffer.from(encoded[1]!, "base64").toString();
  assert.match(svg, /<defs><linearGradient id="grad"><stop offset="0" stop-color="red"/);
  assert.match(svg, /fill="url\(#grad\)"/);
  assert.match(svg, /clip-path="url\(#clip\)"/);
  assert.match(svg, /style="stroke: url\(#grad\); opacity: 0\.5"/);
  assert.match(svg, /xlink:href="data:image\/png;base64,iVBORw0KGgo/);
  const nested = /href="data:image\/svg\+xml;base64,([^"]+)"/.exec(svg);
  assert.ok(nested);
  const nestedSvg = Buffer.from(nested[1]!, "base64").toString();
  assert.match(nestedSvg, /fill="blue"/);
  assert.doesNotMatch(nestedSvg, /data:image\/svg\+xml/);
  assert.doesNotMatch(svg, /invalid\.example|<script|evil\(\)/);
});

test("TOC fragments within non-prose point to the containing block", async () => {
  const view = await renderFixture(`<p>Before.</p><table><tr><td id="cell">Table</td></tr></table><pre><code id="code">Code</code></pre><p>After.</p>`, {}, `<li><a href="ch.xhtml#cell">Cell</a></li><li><a href="ch.xhtml#code">Code</a></li>`);
  const table = view.blocks!.find(block => block.text === "Table")!;
  const code = view.blocks!.find(block => block.text === "Code")!;
  assert.equal(table.isProse, false);
  assert.equal(code.isProse, false);
  assert.deepEqual(view.sections.map(section => section.locator), [table.locator, code.locator]);
});

test("EPUB prose retains DOM text whitespace and speech offsets across inline markup", async () => {
  const view = await renderFixture(`<p> Hello<em> world </em>again.  Next sentence.</p><div> Outer <strong> words </strong><img src="none.png"/> End.</div>`);
  const block = view.blocks!.find(item => item.text.includes("Hello"))!;
  assert.equal(block.text, " Hello world again.  Next sentence.");
  assert.match(view.html, /> Hello<em> world <\/em>again\.  Next sentence\.<\/p>/);
  const sentences = filterProseOnly(view.blocks!).filter(item => item.blockIndex === block.index);
  assert.deepEqual(sentences.map(item => [item.text, item.offset]), [["Hello world again.", 1], ["Next sentence.", 21]]);
  assert.ok(view.blocks!.some(item => item.text === " Outer  words "));
});

test("body CSS selectors target the chapter root without escaping it", async () => {
  const css = sanitizeStylesheet(`body { color: red } html body.chapter > p { text-align: center } body + p { color: blue } p { color: green }`, 2);
  assert.match(css, /\.pith-epub-chapter-2 \{ color: red \}/);
  assert.match(css, /\.pith-epub-chapter-2\.chapter > p \{ text-align: center \}/);
  assert.doesNotMatch(css, /color: blue/);
  assert.match(css, /\.pith-epub-chapter-2 p \{ color: green \}/);
  const view = await renderFixture("", { "O/ch.xhtml": `<html><head><style>body.chapter &gt; p { text-align: center }</style></head><body class="chapter" style="color: red; background: url(evil)"><p>Text</p></body></html>` });
  assert.match(view.html, /class="pith-epub-chapter pith-epub-chapter-0 chapter" style="color: red"/);
  assert.match(view.html, /\.pith-epub-chapter-0\.chapter > p \{ text-align: center \}/);
  assert.doesNotMatch(view.html, /url\(evil\)/);
});

test("EPUB preserves chapters, images, safe formatting, navigation and non-overlapping prose", async () => {
  const files = {
    "META-INF/container.xml": `<container><rootfiles><rootfile full-path="OEBPS/book.opf"/></rootfiles></container>`,
    "OEBPS/book.opf": `<package><metadata><title>Illustrated Book</title></metadata><manifest><item id="one" href="text/one.xhtml"/><item id="two" href="text/two.xhtml"/><item id="nav" href="nav.xhtml" properties="nav"/><item id="css" href="book.css" media-type="text/css"/><item id="cover" href="images/cover.png" media-type="image/png" properties="cover-image"/><item id="art" href="images/art.png" media-type="image/png"/><item id="vector" href="images/art.svg" media-type="image/svg+xml"/></manifest><spine><itemref idref="one"/><itemref idref="two"/></spine></package>`,
    "OEBPS/nav.xhtml": `<html><body><nav epub:type="toc"><ol><li><a href="text/one.xhtml#intro">Start</a><ol><li><a href="text/two.xhtml#end">End</a></li></ol></li></ol></nav></body></html>`,
    "OEBPS/book.css": `p { text-align: center; background: url(https://bad.example/x); color: red } body { font-weight: bold }`,
    "OEBPS/text/one.xhtml": `<html><head><link rel="stylesheet" href="../book.css"/><style>h1 { font-style: italic; background-image: url(evil) }</style></head><body><figure><img src="../images/cover.png" alt="Cover" onerror="alert(1)"/></figure><h1 id="intro">Opening</h1><blockquote>Before <p>Nested <em>words</em>.</p> After.</blockquote><p style="text-align: center; background: url(evil)">Left <img src="../images/art.png"/> Right <code>secret code</code> Done.</p><table><tr><td>Secret table</td></tr></table><script>evil()</script><img src="javascript:alert(1)"/><a href="javascript:alert(1)" onclick="evil()">Safe link text.</a></body></html>`,
    "OEBPS/text/two.xhtml": `<html><body><h2 id="end">Second</h2><svg viewBox="0 0 10 10" xmlns:xlink="http://www.w3.org/1999/xlink"><image href="../images/art.png"/><image xlink:href="../images/cover.png"/></svg><img src="../images/art.svg"/><ul><li><p>Item text.</p><ul><li>Child item.</li></ul></li></ul><pre>Hidden code</pre></body></html>`,
    "OEBPS/images/cover.png": Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/aAAAAABJRU5ErkJggg==", "base64"),
    "OEBPS/images/art.png": Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/aAAAAABJRU5ErkJggg==", "base64"),
    "OEBPS/images/art.svg": `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><script>alert(1)</script><rect width="1" height="1" fill="red" onclick="evil()"/></svg>`,
  };
  const view = await renderFile({ name: "book.epub", mimeType: "application/epub+zip", bytes: 0, sha256: "" }, zip(files));
  assert.equal(view.totalUnits, 2);
  assert.deepEqual(view.sections.map(s => [s.title, s.level, s.line]), [["Start", 1, 0], ["End", 2, 1]]);
  assert.ok(view.html.includes(`data-locator="${view.sections[0]!.locator}"`));
  assert.ok(view.html.includes(`data-locator="${view.sections[1]!.locator}"`));
  assert.equal((view.html.match(/class="pith-epub-chapter /g) ?? []).length, 2);
  assert.match(view.html, /<blockquote>/);
  assert.match(view.html, /<ul><li>/);
  assert.match(view.html, /<table data-locator="[^"]+" data-prose="false">/);
  assert.match(view.html, /src="data:image\/png;base64,iVBORw0KGgo/);
  assert.match(view.html, /href="data:image\/png;base64,iVBORw0KGgo/);
  assert.match(view.html, /xlink:href="data:image\/png;base64,iVBORw0KGgo/);
  const encodedSvg = /src="data:image\/svg\+xml;base64,([^"]+)"/.exec(view.html);
  assert.ok(encodedSvg);
  assert.doesNotMatch(Buffer.from(encodedSvg[1]!, "base64").toString(), /script|onclick/);
  assert.match(view.html, /\.pith-epub-chapter-0 p \{ text-align: center; color: red \}/);
  assert.match(view.html, /style="text-align: center"/);
  assert.doesNotMatch(view.html, /onerror|onclick|javascript:|url\(|evil\(\)/);
  assert.deepEqual(filterProseOnly(view.blocks!).map(item => item.text), ["Opening", "Before", "Nested words.", "After.", "Left", "Right", "Done.", "Safe link text.", "Second", "Item text.", "Child item."]);
});

test("font injection is per-document, idempotent, and includes the bundled font and license", () => {
  assert.equal(READER_SERIF_STACK, '"Garden LXGW WenKai", "LXGW WenKai", "Songti SC", "Noto Serif CJK SC", "Source Han Serif SC", "Iowan Old Style", Georgia, serif');
  assert.equal(READER_SANS_STACK, '"Avenir Next", "PingFang SC", "Helvetica Neue", sans-serif');
  const styles: { textContent: string; setAttribute: (name: string, value: string) => void }[] = [];
  const doc = { head: { querySelector: () => styles[0] ?? null, appendChild: (style: typeof styles[number]) => styles.push(style) }, createElement: () => ({ textContent: "", setAttribute: () => {} }) } as unknown as Document;
  installReaderFont(doc); installReaderFont(doc);
  assert.equal(styles.length, 1);
  assert.match(styles[0]!.textContent, /@font-face.*Garden LXGW WenKai.*data:font\/woff2;base64,/s);
  assert.match(styles[0]!.textContent, /SIL OPEN FONT LICENSE/);
});
