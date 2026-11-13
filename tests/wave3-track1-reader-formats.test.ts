import assert from "node:assert/strict";
import test from "node:test";
import { deflateRawSync } from "node:zlib";
import { renderFile } from "../src/plugins/stage-reader/index.ts";
import { applyPaginationStyles, computePagination } from "../src/plugins/stage-reader/pagination.ts";

const file = (name: string, mimeType = "") => ({ name, mimeType, bytes: 0, sha256: "" });

function zip(files: Record<string, Uint8Array>, compressed = false): Uint8Array {
  const local: Buffer[] = [], central: Buffer[] = [];
  let offset = 0;
  for (const [name, bytes] of Object.entries(files)) {
    const n = Buffer.from(name), data = Buffer.from(bytes), payload = compressed ? deflateRawSync(data) : data;
    const header = Buffer.alloc(30), entry = Buffer.alloc(46);
    header.writeUInt32LE(0x04034b50); header.writeUInt16LE(compressed ? 8 : 0, 8); header.writeUInt32LE(payload.length, 18); header.writeUInt32LE(data.length, 22); header.writeUInt16LE(n.length, 26);
    entry.writeUInt32LE(0x02014b50); entry.writeUInt16LE(compressed ? 8 : 0, 10); entry.writeUInt32LE(payload.length, 20); entry.writeUInt32LE(data.length, 24); entry.writeUInt16LE(n.length, 28); entry.writeUInt32LE(offset, 42);
    local.push(header, n, payload); central.push(entry, n); offset += header.length + n.length + payload.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}

test("pagination geometry and forced modes", () => {
  assert.deepEqual(computePagination(800, 600, 1601), { columns: 1, horizontalInsetPx: 40, verticalInsetPx: 30, columnWidthPx: 720, columnGapPx: 80, contentHeightPx: 540, totalScreens: 2 });
  assert.deepEqual(computePagination(900, 800, 1802), { columns: 2, horizontalInsetPx: 45, verticalInsetPx: 32, columnWidthPx: 360, columnGapPx: 90, contentHeightPx: 736, totalScreens: 3 });
  assert.equal(computePagination(1200, 500, 1200, "single").columns, 1);
  assert.equal(computePagination(80, 100, 0, "double").columnWidthPx, 20);
  assert.equal(computePagination(0, 0, 0).totalScreens, 1);
});

test("pagination keeps a bounded centered column and exact screen stride", () => {
  for (const width of [80, 320, 801, 1800, 2200, 3840]) for (const [mode, columns, max] of [["single", 1, 820], ["double", 2, 680], ["triple", 3, 580]] as const) {
    const metrics = computePagination(width, 700, width * 5, mode);
    assert.equal(metrics.columns, columns);
    assert.ok(metrics.columnWidthPx <= max);
    assert.ok(Math.abs(columns * (metrics.columnWidthPx + metrics.columnGapPx) - width) < 1e-9);
    assert.ok(Math.abs(metrics.columnGapPx - 2 * metrics.horizontalInsetPx) < 1e-9);
  }
});

test("pagination styles measure overflow after layout", () => {
  const properties = new Map<string, string>();
  const style = () => ({ setProperty: (name: string, value: string) => properties.set(name, value), removeProperty: (name: string) => properties.delete(name) });
  const body = { style: style(), ownerDocument: { defaultView: null }, querySelectorAll: () => [] } as unknown as HTMLElement;
  const viewport = { clientWidth: 1000, clientHeight: 600, scrollWidth: 2001, style: style() } as unknown as HTMLElement;
  const metrics = applyPaginationStyles(viewport, body);
  assert.equal(metrics.totalScreens, 2);
  assert.equal(body.style.columnWidth, "404px");
  assert.equal(body.style.columnGap, "96px");
  assert.equal(properties.get("--pith-page-height"), "540px");
  assert.equal(properties.get("--pith-page-scroll-extent"), "1999px");
  assert.equal(viewport.style.overflowX, "hidden");
});

for (const compressed of [false, true]) test(`CBZ natural page order and bytes (${compressed ? "deflated" : "stored"})`, async () => {
  const view = await renderFile(file("comic.cbz"), zip({ "page10.png": Uint8Array.of(10), "page2.png": Uint8Array.of(2), "cover.JPG": Uint8Array.of(1), "dir/": Uint8Array.of(), "notes.txt": Uint8Array.of(3) }, compressed));
  assert.equal(view.layout, "fixed-page");
  assert.deepEqual(view.pages!.map(page => [page.page, page.mimeType, page.bytes![0]]), [[1, "image/jpeg", 1], [2, "image/png", 2], [3, "image/png", 10]]);
  assert.deepEqual(view.sections.map(section => section.locator), ["page:1", "page:2", "page:3"]);
  assert.match(view.html, /data-locator="page:2" data-prose="false"><img alt="第 2 页" data-page="2" src="data:image\/png;base64,Ag=="/);
  await assert.rejects(renderFile(file("empty.cbz"), zip({ "readme.txt": Uint8Array.of(1) })), /没有图片页/);
});

test("single image uses byte-preserving embedded source", async () => {
  const view = await renderFile(file("picture", "image/webp"), Uint8Array.of(0, 255));
  assert.equal(view.format, "image");
  assert.equal(view.totalUnits, 1);
  assert.match(view.html, /data:image\/webp;base64,AP8=/);
});

test("invalid PDF fails without a browser canvas", async () => {
  await assert.rejects(renderFile(file("x.pdf"), new TextEncoder().encode("not a PDF")), /Invalid PDF|Invalid PDF structure/);
});
