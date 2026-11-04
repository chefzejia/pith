import { Buffer } from "node:buffer";

export function linkedEpub(hostIds = false): Uint8Array {
  const padding = Array.from({ length: 20 }, (_, i) => `<p>第 ${i + 1} 段。${"Long book text for pagination. ".repeat(16)}</p>`).join("");
  const files: Record<string, string> = {
    "META-INF/container.xml": '<container><rootfiles><rootfile full-path="O/book.opf"/></rootfiles></container>',
    "O/book.opf": '<package><metadata><title>Links</title></metadata><manifest><item id="one" href="one.xhtml"/><item id="two" href="sub/two.xhtml"/><item id="nav" href="nav.xhtml" properties="nav"/></manifest><spine><itemref idref="one"/><itemref idref="two"/></spine></package>',
    "O/nav.xhtml": '<html><body><nav epub:type="toc"><ol><li><a href="one.xhtml#shared">One</a></li><li><a href="sub/two.xhtml#shared">Two</a></li><li><a href="sub/two.xhtml#missing">Missing</a></li></ol></nav></body></html>',
    "O/one.xhtml": `<html><body class="book PITH-epub-chapter-9"><div class="keep pith-epub-chapter PITH-epub-chapter-1" data-epub-chapter="1"><section class="pith-epub-chapter" data-epub-chapter="1" data-epub-fragment="shared" id="decoy">Decoy</section></div><h1>One</h1><p><a href="#shared">Same</a> <a href="sub/two.xhtml#shared">Cross</a> <a href="sub/two.xhtml">Chapter</a> <a href="sub/two.xhtml#missing">Missing</a> <a href="#blocked">Blocked</a> <a href="../../escape.xhtml#x">Escape</a> <a href="https://outside.example/x">External</a> <a href="javascript:alert(1)">Danger</a> <a href="#svg-root">SVG Same</a> <a href="sub/two.xhtml#svg-root">SVG Cross</a> <a href="sub/two.xhtml#svg-inner">SVG Inner Cross</a> <a href="#svg%3Ainner">Colon Same</a> <a href="sub/two.xhtml#svg%3Ainner">Colon Cross</a> <a href="sub/two.xhtml#%E6%BC%A2%E5%AD%97">Unicode Cross</a> <a href="sub/two.xhtml#rate%25done">Percent Cross</a></p>${padding}<p>${"Long paragraph across columns. ".repeat(150)}<abbr id="shared" onclick="evil()" style="background:url(https://outside.example)">One target</abbr></p><svg id="svg-root" viewBox="0 0 100 100" data-epub-chapter="1" data-epub-fragment="shared"><defs><linearGradient id="paint"><stop offset="0" stop-color="red"/></linearGradient><linearGradient id="色:彩%"><stop offset="0" stop-color="blue"/></linearGradient></defs><rect id="svg-inner" width="100" height="100" fill="url(#paint)"/><rect id="svg:inner" width="30" height="30" fill="url(#%E8%89%B2%3A%E5%BD%A9%25)" style="stroke:url(#%E8%89%B2%3A%E5%BD%A9%25)"/><use href="#svg%3Ainner"/><use href="https://outside.example/x#paint"/><image href="https://outside.example/x.png"/><script id="svg-evil">evil()</script></svg><table><tr><td><svg id="nested-svg"><rect id="nested-shape" width="10" height="10"/></svg></td></tr></table><unknown id="outer"><div><unknown id="inner">Nested target</unknown></div></unknown><script id="blocked">evil()</script><object id="blocked-object"><abbr id="blocked-child">bad</abbr></object></body></html>`,
    "O/sub/two.xhtml": `<html><body><h1>Two</h1><p><a href="../one.xhtml#shared">Back</a> <a href="../one.xhtml#svg-root">SVG Back</a> <a href="#svg-inner">SVG Inner Same</a> <a href="#pith-svg-1-0-svg-root">Forged ID</a> <a href="../one.xhtml#svg%3Ainner">Colon Back</a> <a href="#%E6%BC%A2%E5%AD%97">Unicode Same</a></p>${padding}<p>${"Long paragraph across columns. ".repeat(150)}<abbr id="shared">Two target</abbr></p><svg id="svg-root" viewBox="0 0 100 100"><rect id="svg-inner" width="100" height="100" fill="blue"/><rect id="svg:inner" width="30" height="30"/><rect id="漢字" width="40" height="40"/><rect id="rate%done" width="50" height="50"/></svg></body></html>`,
  };
  if (hostIds) {
    const ids = ["training", "article", "message", "preview", "toast", "settings", "toggle-navigation", "import-material", "detect-agents", "transcribe-audio", "toggle-side"];
    const targets = ids.map(id => `<p id="${id}">Book target ${id}</p>`).join("");
    const links = '<p><a href="#training">Training target</a> <a id="settings" href="#article">Settings link</a> <span id="import-material"><a href="#message">Import ancestor link</a></span> <a href="sub/two.xhtml#training">Cross host target</a></p>';
    files["O/one.xhtml"] = files["O/one.xhtml"]!.replace("<h1>One</h1>", `<h1>One</h1>${links}${targets}`);
    files["O/sub/two.xhtml"] = files["O/sub/two.xhtml"]!.replace("<h1>Two</h1>", '<h1>Two</h1><p id="training">Second training target</p><a href="../one.xhtml#training">Host target back</a>');
  }
  const locals: Buffer[] = [], central: Buffer[] = []; let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const n = Buffer.from(name), data = Buffer.from(text), local = Buffer.alloc(30), record = Buffer.alloc(46);
    local.writeUInt32LE(0x04034b50); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(n.length, 26);
    record.writeUInt32LE(0x02014b50); record.writeUInt32LE(data.length, 20); record.writeUInt32LE(data.length, 24); record.writeUInt16LE(n.length, 28); record.writeUInt32LE(offset, 42);
    locals.push(local, n, data); central.push(record, n); offset += local.length + n.length + data.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}
