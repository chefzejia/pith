import assert from "node:assert/strict";
import test from "node:test";
import { renderEpub } from "../src/plugins/stage-reader/epub.ts";
import { linkedEpub } from "./wave12-epub-fixture.ts";

test("EPUB resolves chapter-scoped links without retaining network-capable hrefs", async () => {
  const doc = await renderEpub(linkedEpub());
  const targets = Array.from(doc.html.matchAll(/<a data-epub-target="([^"]*)" role="link" tabindex="0">([^<]+)<\/a>/g), match => [match[2], match[1]!.replaceAll("&quot;", '"')]);
  assert.deepEqual(targets, [
    ["Same", '{"chapter":0,"fragment":"shared"}'], ["Cross", '{"chapter":1,"fragment":"shared"}'], ["Chapter", '{"chapter":1,"fragment":""}'],
    ["Missing", '{"chapter":1,"fragment":"missing"}'], ["Blocked", '{"chapter":0,"fragment":"blocked"}'], ["Escape", ""], ["External", ""], ["Danger", ""],
    ["SVG Same", '{"chapter":0,"fragment":"svg-root"}'], ["SVG Cross", '{"chapter":1,"fragment":"svg-root"}'], ["SVG Inner Cross", '{"chapter":1,"fragment":"svg-inner"}'],
    ["Colon Same", '{"chapter":0,"fragment":"svg:inner"}'], ["Colon Cross", '{"chapter":1,"fragment":"svg:inner"}'], ["Unicode Cross", '{"chapter":1,"fragment":"漢字"}'], ["Percent Cross", '{"chapter":1,"fragment":"rate%done"}'],
    ["Back", '{"chapter":0,"fragment":"shared"}'], ["SVG Back", '{"chapter":0,"fragment":"svg-root"}'], ["SVG Inner Same", '{"chapter":1,"fragment":"svg-inner"}'], ["Forged ID", '{"chapter":1,"fragment":"pith-svg-1-0-svg-root"}'], ["Colon Back", '{"chapter":0,"fragment":"svg:inner"}'], ["Unicode Same", '{"chapter":1,"fragment":"漢字"}'],
  ]);
  assert.doesNotMatch(doc.html, /<a[^>]+href=/);
  assert.match(doc.html, /class="pith-epub-chapter pith-epub-chapter-0 book" data-epub-chapter="0"/);
  assert.match(doc.html, /<div class="keep"><section id="decoy"><span data-locator="[^"]+" data-prose="true">Decoy<\/span><\/section><\/div>/);
  assert.equal((doc.html.match(/data-epub-chapter=/g) ?? []).length, 2);
  assert.doesNotMatch(doc.html, /PITH-epub|data-epub-fragment="shared"/);
  assert.match(doc.html, /<span id="shared">One target<\/span>/);
  assert.match(doc.html, /<span id="shared">Two target<\/span>/);
  assert.match(doc.html, /id="pith-svg-0-0-svg-root" data-epub-fragment="svg-root"/);
  assert.match(doc.html, /id="pith-svg-0-0-svg-inner" data-epub-fragment="svg-inner"/);
  assert.match(doc.html, /id="pith-svg-1-0-svg-root" data-epub-fragment="svg-root"/);
  assert.match(doc.html, /id="pith-svg-0-1-nested-shape" data-epub-fragment="nested-shape"/);
  assert.match(doc.html, /fill="url\(#pith-svg-0-0-paint\)"/);
  assert.match(doc.html, /id="pith-svg-0-0-svg:inner" data-epub-fragment="svg:inner"/);
  assert.match(doc.html, /id="pith-svg-1-0-svg:inner" data-epub-fragment="svg:inner"/);
  assert.match(doc.html, /data-epub-fragment="漢字"/);
  assert.match(doc.html, /data-epub-fragment="rate%done"/);
  assert.match(doc.html, /fill="url\(#pith-svg-0-0-%E8%89%B2%3A%E5%BD%A9%25\)"/);
  assert.match(doc.html, /stroke: url\(#pith-svg-0-0-%E8%89%B2%3A%E5%BD%A9%25\)/);
  assert.match(doc.html, /<use href="#pith-svg-0-0-svg%3Ainner"/);
  assert.match(doc.html, /<span id="outer"><\/span><div><span data-locator="[^"]+" data-prose="true"><span id="inner">Nested target<\/span><\/span><\/div>/);
  assert.doesNotMatch(doc.html, /<abbr|<unknown|<script|<object|id="blocked(?:-child|-object)?"|onclick|evil\(\)|outside\.example/);
  assert.notEqual(doc.sections[0]!.locator, doc.sections[1]!.locator);
  assert.equal(doc.sections[2]!.locator, 'epub:{"chapter":1,"fragment":"missing"}');
});
