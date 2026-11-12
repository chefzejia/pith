import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const coverPng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/aX8AAAAASUVORK5CYII=", "base64");

export function storedZip(files: Record<string, string | Uint8Array>): Uint8Array {
  const locals: Buffer[] = [], central: Buffer[] = []; let offset = 0;
  for (const [name, value] of Object.entries(files)) {
    const n = Buffer.from(name), data = Buffer.from(value), local = Buffer.alloc(30), record = Buffer.alloc(46);
    local.writeUInt32LE(0x04034b50); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(n.length, 26);
    record.writeUInt32LE(0x02014b50); record.writeUInt32LE(data.length, 20); record.writeUInt32LE(data.length, 24); record.writeUInt16LE(n.length, 28); record.writeUInt32LE(offset, 42);
    locals.push(local, n, data); central.push(record, n); offset += local.length + n.length + data.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

export function coveredEpub(): Uint8Array {
  return storedZip({
    "META-INF/container.xml": '<container><rootfile full-path="O/book.opf"/></container>',
    "O/book.opf": '<package><metadata><dc:title>真实书名 = A Long Subtitle</dc:title><dc:creator>测试作者</dc:creator><meta name="cover" content="cover"/></metadata><manifest><item id="cover" href="cover.png" media-type="image/png"/><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="chapter"/></spine></package>',
    "O/chapter.xhtml": '<html><body><h1>第一章</h1><p>测试正文。</p></body></html>',
    "O/cover.png": coverPng,
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url) && process.argv.includes("--write")) {
  const directory = resolve(`${process.env.PITH_TEST_SCREENSHOT_DIR}/task-29`); await mkdir(directory, { recursive: true });
  const path = join(directory, "测试书 = Long subtitle (z-library.sk, 1lib.sk, z-lib.sk).epub");
  await writeFile(path, coveredEpub()); console.log(path);
}
