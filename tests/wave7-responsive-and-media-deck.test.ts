import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveResponsiveLayout } from "../src/plugins/stage-reader/pagination.ts";
import { audioContentType } from "../src/workbench/mediaAssets.ts";
import { createPithWebServer } from "../src/shells/web/server.ts";
import { toolkitSlot } from "../src/workbench/toolkitSlot.ts";
import { PithObsidianView } from "../src/shells/obsidian/plugin.ts";
import { renderTimelineView } from "../src/plugins/stage-timeline/index.ts";
import { bootStandaloneShell } from "../src/shells/web/index.ts";
import type { HostPort, StageReaderService } from "../src/core/index.ts";

test("responsive reader geometry follows container shape and guide width", () => {
  const cases = [
    [{ width: 390, height: 844 }, "portrait-phone", false, "bottom-sheet", false, 1, 44],
    [{ width: 844, height: 390 }, "landscape-phone", false, "overlay-drawer", true, 1, 44],
    [{ width: 780, height: 860 }, "foldable-square", true, "split-right", false, 1, 34],
    [{ width: 1150, height: 800 }, "tablet-desktop", true, "split-right", true, 1, 34],
    [{ width: 1150, height: 800, guideOpen: true }, "tablet-desktop", true, "split-right", true, 1, 34],
    [{ width: 1440, height: 900, guideOpen: true }, "tablet-desktop", true, "split-right", true, 1, 34],
  ] as const;
  for (const [input, formFactor, canSplitGuide, sheetMode, canDoubleColumn, effectiveColumns, hitTargetPx] of cases) {
    const result = resolveResponsiveLayout(input);
    assert.deepEqual([result.formFactor, result.canSplitGuide, result.sheetMode, result.canDoubleColumn, result.effectiveColumns, result.hitTargetPx], [formFactor, canSplitGuide, sheetMode, canDoubleColumn, effectiveColumns, hitTargetPx]);
  }
  assert.equal(resolveResponsiveLayout({ width: 1150, height: 800, guideOpen: true }).stageWidthPx, 830);
  assert.equal(resolveResponsiveLayout({ width: 1440, height: 900, preferredColumns: "single" }).effectiveColumns, 1);
  assert.equal(resolveResponsiveLayout({ width: 390, height: 844, preferredColumns: "double" }).effectiveColumns, 1);
  assert.equal(resolveResponsiveLayout({ width: 1200, height: 800, coarsePointer: true }).hitTargetPx, 44);
  assert.equal(resolveResponsiveLayout({ width: 739, height: 600 }).canSplitGuide, false);
  assert.equal(resolveResponsiveLayout({ width: 740, height: 600 }).canSplitGuide, true);
  assert.equal(resolveResponsiveLayout({ width: 720, height: 2000 }).maxColumns, 1);
  assert.equal(resolveResponsiveLayout({ width: 800, height: 2000, preferredColumns: "double" }).effectiveColumns, 2);
  assert.equal(resolveResponsiveLayout({ width: 1248, height: 300, preferredColumns: "triple" }).effectiveColumns, 3);
  assert.equal(resolveResponsiveLayout({ width: 1248, height: 300, readerWidthPx: 700, preferredColumns: "triple" }).effectiveColumns, 1);
  assert.equal(resolveResponsiveLayout({ width: 1248, height: 300, preferredColumns: "single" }).effectiveColumns, 1);
});

test("column limits use actual reader width, including the gap, independent of window height", () => {
  for (const height of [200, 2000]) {
    for (const [readerWidthPx, expected] of [[799, 1], [800, 2], [1247, 2], [1248, 3]] as const) {
      const layout = resolveResponsiveLayout({ width: 2000, height, readerWidthPx, preferredColumns: "triple" });
      assert.equal(layout.maxColumns, expected, `${readerWidthPx}x${height}`);
      assert.equal(layout.effectiveColumns, expected);
    }
  }
});

test("audio types are detected by MIME or recognized extension", () => {
  for (const [name, type] of [["x.mp3", "audio/mpeg"], ["x.m4a", "audio/mp4"], ["x.wav", "audio/wav"], ["x.ogg", "audio/ogg"], ["x.aac", "audio/aac"], ["x.flac", "audio/flac"]]) assert.equal(audioContentType({ name: name!, mimeType: "application/octet-stream" }), type);
  assert.equal(audioContentType({ name: "custom", mimeType: "audio/opus" }), "audio/opus");
  assert.equal(audioContentType({ name: "chapter.md", mimeType: "text/markdown" }), null);
  assert.equal(audioContentType({ name: "custom", mimeType: "audio/a\r\nX: b" }), null);
});

test("one toolbar slot aggregates zero, one, and multiple toolkits", () => {
  assert.equal(toolkitSlot([], "shadowing").text, "");
  assert.equal(toolkitSlot(["feynman"], "shadowing").text, "费曼复述");
  assert.equal(toolkitSlot(["shadowing", "feynman"], "shadowing").text, "影子跟读");
  assert.equal(toolkitSlot(["toolkit-shadowing", "shadowing", "other"], "other", { other: "Custom" }).text, "Custom");
});

test("reader service exposes the same responsive decision to host shells", () => {
  const runtime = bootStandaloneShell({ id: "memory", storage: {} as HostPort["storage"] });
  try {
    const reader = runtime.getService<StageReaderService>("stage.reader");
    assert.ok(reader && reader.resolveResponsiveLayout);
    assert.deepEqual(reader.resolveResponsiveLayout({ width: 780, height: 860 }), resolveResponsiveLayout({ width: 780, height: 860 }));
  } finally { runtime.stop(); }
});

test("Obsidian uses one toolkit button and cue clicks seek without mounting a toolkit", async () => {
  const label = { textContent: "" }; const button = { innerHTML: "", querySelector: () => label, title: "", hidden: false, classList: { toggle() {} }, setAttribute() {} };
  const audio = { currentTime: 0 };
  const cancelled: string[] = [];
  const view = Object.create(PithObsidianView.prototype) as Record<string, unknown>;
  view.guideData = { readOnly: false };
  Object.assign(view, { actions: {}, toolkits: [], toolkitId: "", mountedToolkits: [], popover: { hidden: true }, toolkit: { hidden: true }, voice: { cancel: (target: string) => cancelled.push(target), clearRecording() {} }, dock: { querySelector: () => button, classList: { toggle() {} } }, assetAudio: audio, article: { contains: () => true } });
  const set = view.setToolkits as (ids: string[]) => void;
  set.call(view, []); assert.equal(button.hidden, false);
  set.call(view, ["feynman"]); assert.equal(label.textContent, "费曼复述");
  set.call(view, ["shadowing", "feynman"]); assert.equal(label.textContent, "费曼复述");
  set.call(view, []);
  assert.deepEqual(cancelled, ["toolkit"]);
  const cue = { dataset: { locator: "time:16.5" } };
  await (view.click as (event: unknown) => Promise<void>).call(view, { target: { closest: (selector: string) => selector === ".pith-cue" ? cue : null } });
  assert.equal(audio.currentTime, 16.5);
  assert.match(renderTimelineView({ title: "test", cues: [{ id: "c", startSec: 16.5, endSec: 18, text: "Text" }] }), /data-locator="time:16\.5" data-prose="true" data-end-sec="18"/);
});

test("Obsidian media controls seek, change rate, close and reopen the deck", async () => {
  const audio = { currentTime: 20, duration: 60, playbackRate: 1, pause() {}, removeAttribute() {}, load() {} };
  const deck = { hidden: false };
  const view = Object.create(PithObsidianView.prototype) as Record<string, unknown>;
  Object.assign(view, { actions: {}, assetAudio: audio, assetSource: { name: "clip.wav", type: "audio/wav" }, assetControls: { hidden: false }, mediaDeck: deck, speechRate: 1, speaking: false, root: { contains: () => true }, article: { querySelectorAll: () => [] }, playback: { renderCueMarkers() {} }, updateAssetControls() {}, async loadAsset() { deck.hidden = false; } });
  const click = async (dataset: Record<string, string>) => { const button = { dataset, textContent: "", hasAttribute: () => false }; await (view.click as (event: unknown) => Promise<void>).call(view, { target: { closest: (selector: string) => selector === "button" ? button : null } }); return button; };
  await click({ media: "back" }); assert.equal(audio.currentTime, 5);
  await click({ media: "forward" }); assert.equal(audio.currentTime, 20);
  assert.equal((await click({ media: "rate" })).textContent, "1.25x"); assert.equal(audio.playbackRate, 1.25);
  await click({ media: "close" }); assert.equal(deck.hidden, true); assert.equal(view.assetAudio, null);
  await click({ command: "read" }); assert.equal(deck.hidden, false);
});

test("raw audio serves only listed assets and supports byte ranges without path escapes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pith-wave7-"));
  const app = await createPithWebServer({ workspaceDir: dir });
  try {
    const address = app.address(); assert.ok(address && typeof address !== "string");
    const base = `http://127.0.0.1:${address.port}`;
    const response = await fetch(`${base}/api/materials`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: "test", kind: "article", files: [{ name: "read.md", mimeType: "text/markdown", data: Buffer.from("# text").toString("base64") }, { name: "sound.mp3", mimeType: "application/octet-stream", data: Buffer.from([0, 1, 2, 3, 4, 5]).toString("base64") }] }) });
    assert.equal(response.status, 201);
    const material = await response.json() as { id: string };
    const url = `${base}/api/materials/${encodeURIComponent(material.id)}/raw?name=`;
    const audio = await fetch(`${url}sound.mp3`); assert.equal(audio.status, 200); assert.equal(audio.headers.get("content-type"), "audio/mpeg"); assert.deepEqual([...new Uint8Array(await audio.arrayBuffer())], [0, 1, 2, 3, 4, 5]);
    const partial = await fetch(`${url}sound.mp3`, { headers: { range: "bytes=2-4" } }); assert.equal(partial.status, 206); assert.equal(partial.headers.get("content-range"), "bytes 2-4/6"); assert.deepEqual([...new Uint8Array(await partial.arrayBuffer())], [2, 3, 4]);
    assert.equal((await fetch(`${url}sound.mp3`, { headers: { range: "bytes=50-" } })).status, 416);
    assert.equal((await fetch(`${url}read.md`)).status, 415);
    assert.equal((await fetch(`${url}${encodeURIComponent("../ME.md")}`)).status, 404);
    const outside = join(dir, "outside"); await writeFile(outside, "private");
    const target = join(dir, "materials", material.id, "files", "sound.mp3"); await unlink(target); await symlink(outside, target);
    assert.equal((await fetch(`${url}sound.mp3`)).status, 400);
    assert.equal(await readFile(outside, "utf8"), "private");
  } finally { await new Promise<void>((resolve, reject) => app.close(error => error ? reject(error) : resolve())); await rm(dir, { recursive: true, force: true }); }
});
