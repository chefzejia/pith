import assert from "node:assert/strict";
import test from "node:test";
import { inspectEpubPackage, renderEpub } from "../src/plugins/stage-reader/epub.ts";
import { prepareMaterialImport } from "../src/workbench/importMaterial.ts";
import { linkedEpub } from "./wave12-epub-fixture.ts";
import { coverPng, storedZip } from "./task29-fixture.ts";
import { coverFiles, fallbackCoverEpub } from "./audit11713-cover-fixture.ts";

const prepare = (bytes: Uint8Array) => prepareMaterialImport([new File([bytes], "local.epub", { type: "application/epub+zip" })]);
function changeEntry(bytes: Uint8Array, name: string, compressed = false): Uint8Array {
  const copy = bytes.slice(), view = new DataView(copy.buffer, copy.byteOffset, copy.byteLength);
  let at = view.getUint32(copy.length - 6, true);
  while (view.getUint32(at, true) === 0x02014b50) {
    const length = view.getUint16(at + 28, true), entry = new TextDecoder().decode(copy.subarray(at + 46, at + 46 + length));
    if (entry === name) {
      const offset = view.getUint32(at + 42, true);
      if (compressed) { view.setUint16(offset + 8, 8, true); view.setUint16(at + 10, 8, true); }
      else view.setUint32(offset, 0, true);
      return copy;
    }
    at += 46 + length + view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
  }
  throw new Error("Fixture entry missing");
}

test("formal File import accepts linkedEpub while ignoring its external optional SVG image", async () => {
  const input = linkedEpub(), material = await prepare(input);
  assert.equal(material.title, "Links"); assert.equal(material.kind, "book"); assert.deepEqual(material.files[0]!.bytes, new Uint8Array(input));
  assert.equal((await inspectEpubPackage(input)).coverDataUrl, undefined);
  const rendered = await renderEpub(material.files[0]!.bytes); assert.match(rendered.html, />One</); assert.match(rendered.html, />Two</);
});

test("optional guide and page image paths fail safely and later local cover candidates survive", async () => {
  const references = ["https://outside.example/x.png", "//outside.example/x.png", "../../escape.png", "%2e%2e/%2e%2e/escape.png", "javascript:evil.png", "data:image/png;base64,AAAA", "bad%ZZ.png", "bad\\path.png", "bad%00.png"];
  for (const href of references) {
    const files = coverFiles(href); files["O/chapter.xhtml"] = `<html><body><h1>Local chapter</h1><img src="${href}"/></body></html>`;
    const bytes = storedZip(files); assert.equal((await prepare(bytes)).title, "Cover candidates", href); assert.equal((await inspectEpubPackage(bytes)).coverDataUrl, undefined, href);
    files["O/chapter.xhtml"] = `<html><body><h1>Local chapter</h1><img src="${href}"/><img src="good.png"/></body></html>`; files["O/good.png"] = coverPng;
    assert.equal((await inspectEpubPackage(storedZip(files))).coverDataUrl, `data:image/png;base64,${coverPng.toString("base64")}`, href);
  }
  assert.match((await inspectEpubPackage(fallbackCoverEpub())).coverDataUrl!, /^data:image\/png;base64,/);
});

test("unavailable optional cover pages and images yield to later manifest cover bytes", async () => {
  const cases: { label: string; page?: string | Uint8Array; image?: Uint8Array; corrupt?: "header" | "compression" }[] = [
    { label: "missing page" }, { label: "invalid XML", page: "<html><body>" }, { label: "hostile XML", page: '<!ENTITY bad SYSTEM "https://outside.example/"><html/>' },
    { label: "invalid UTF-8", page: new Uint8Array([255]) },
    { label: "missing image", page: '<html><img src="bad.png"/></html>' },
    { label: "invalid image", page: '<html><img src="bad.png"/></html>', image: new Uint8Array([1, 2, 3]) },
    { label: "oversize image", page: '<html><img src="bad.png"/></html>', image: new Uint8Array(4 * 1024 * 1024 + 1) },
    { label: "bad local header", page: '<html><img src="bad.png"/></html>', image: coverPng, corrupt: "header" },
    { label: "bad compressed bytes", page: '<html><img src="bad.png"/></html>', image: coverPng, corrupt: "compression" },
  ];
  for (const item of cases) {
    const files = coverFiles("cover.xhtml"); if (item.page) files["O/cover.xhtml"] = item.page; if (item.image) files["O/bad.png"] = item.image;
    files["O/book.opf"] = String(files["O/book.opf"]).replace('</manifest>', '<item id="good" href="good.png"/></manifest>'); files["O/good.png"] = coverPng;
    let bytes = storedZip(files); if (item.corrupt) bytes = changeEntry(bytes, "O/bad.png", item.corrupt === "compression");
    assert.equal((await prepare(bytes)).title, "Cover candidates", item.label);
    assert.equal((await inspectEpubPackage(bytes)).coverDataUrl, `data:image/png;base64,${coverPng.toString("base64")}`, item.label);
  }
});

test("required package structure and manifest path failures still reject formal imports", async () => {
  const cases = [
    { path: "META-INF/container.xml", value: "<container/>", error: /rootfile missing/ },
    { path: "META-INF/container.xml", value: '<container><rootfile full-path="missing.opf"/></container>', error: /Missing EPUB entry/ },
    { path: "META-INF/container.xml", value: "<container>", error: /Unclosed XML/ },
    { path: "O/book.opf", value: "<package>", error: /Unclosed XML/ },
    { path: "O/book.opf", value: '<package><manifest><item id="chapter" href="../../escape.xhtml"/></manifest></package>', error: /path traversal/ },
    { path: "O/book.opf", value: '<package><manifest><item id="chapter" href="https://outside.example/chapter.xhtml"/></manifest></package>', error: /Invalid EPUB path/ },
    { path: "O/book.opf", value: '<package><manifest><item id="chapter" href="/outside.xhtml"/></manifest></package>', error: /Invalid EPUB path/ },
  ];
  for (const item of cases) { const files = coverFiles(); files[item.path] = item.value; await assert.rejects(prepare(storedZip(files)), item.error); }
});

test("unexpected optional codec faults propagate rather than becoming missing covers", async () => {
  const files = coverFiles("cover.xhtml"); files["O/cover.xhtml"] = '<html><img src="bad.png"/></html>'; files["O/bad.png"] = coverPng;
  const bytes = changeEntry(storedZip(files), "O/bad.png", true), original = globalThis.DecompressionStream;
  const failure = new Error("unexpected native codec fault");
  // Explicit native codec boundary failure; no product module is replaced.
  globalThis.DecompressionStream = class { constructor() { throw failure; } } as unknown as typeof DecompressionStream;
  try { await assert.rejects(prepare(bytes), error => error === failure); }
  finally { globalThis.DecompressionStream = original; }
});
