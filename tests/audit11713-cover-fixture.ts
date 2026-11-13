import { coverPng, storedZip } from "./task29-fixture.ts";

export function coverFiles(guide = ""): Record<string, string | Uint8Array> {
  return {
    "META-INF/container.xml": '<container><rootfile full-path="O/book.opf"/></container>',
    "O/book.opf": `<package><metadata><title>Cover candidates</title></metadata><manifest><item id="chapter" href="chapter.xhtml"/></manifest><spine><itemref idref="chapter"/></spine>${guide ? `<guide><reference type="cover" href="${guide}"/></guide>` : ""}</package>`,
    "O/chapter.xhtml": '<html><body><h1>Local chapter</h1><p>The local text remains readable.</p></body></html>',
  };
}

export function fallbackCoverEpub(): Uint8Array {
  const files = coverFiles("https://outside.example/cover.xhtml");
  files["O/chapter.xhtml"] = '<html><body><h1>Local chapter</h1><p>The local text remains readable.</p><img src="../../escape.png"/><svg><image href="https://outside.example/x.png"/><image href="good.png"/></svg></body></html>';
  files["O/good.png"] = coverPng;
  return storedZip(files);
}
