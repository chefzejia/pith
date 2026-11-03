import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { obsidianStyles, pageDirectionForKey, WheelPageGate } from "../src/shells/obsidian/plugin.ts";
import { createPithWebServer } from "../src/shells/web/server.ts";

test("Obsidian paging unifies keys and throttles wheel inertia", () => {
  for (const key of ["ArrowUp", "ArrowLeft", "PageUp"]) assert.equal(pageDirectionForKey(key), -1);
  for (const key of ["ArrowDown", "ArrowRight", "PageDown"]) assert.equal(pageDirectionForKey(key), 1);
  assert.equal(pageDirectionForKey("Enter"), 0);
  const gate = new WheelPageGate();
  assert.equal(gate.accept(1, 0), 0);
  assert.equal(gate.accept(25, 1), 1);
  assert.equal(gate.accept(25, 499), 0);
  assert.equal(gate.accept(-25, 501), -1);
});

test("Obsidian styles follow host tokens and support complete guide collapse", () => {
  for (const token of ["background-primary", "background-secondary", "background-modifier-border", "text-normal", "text-muted", "text-accent", "font-interface"]) assert.ok(obsidianStyles.includes(`var(--${token})`), token);
  assert.match(obsidianStyles, /\.pith-layout\.pith-guide-closed\{grid-template-columns:minmax\(0,1fr\)\}/);
  assert.match(obsidianStyles, /\.pith-left-drawer\{position:absolute;left:0/);
  assert.doesNotMatch(obsidianStyles, /\.pith-bottom-dock\{[^}]*opacity:\.15/);
  assert.match(obsidianStyles, /\.pith-view-header\{height:44px/);
  assert.doesNotMatch(obsidianStyles, /#f3ede1/i);
});

test("Obsidian reader explicitly enables selection only on article content", () => {
  const articleRules = [...obsidianStyles.matchAll(/(?:^|\n)\.pith-article\{([^}]*)\}/g)].map(match => match[1]!);
  assert.ok(articleRules.some(rule => /(?:^|;)user-select:text(?:;|$)/.test(rule)));
  assert.ok(articleRules.some(rule => /(?:^|;)-webkit-user-select:text(?:;|$)/.test(rule)));
  const viewRules = [...obsidianStyles.matchAll(/(?:^|\n)\.pith-view\{([^}]*)\}/g)].map(match => match[1]!);
  const selectable = /(?:^|;)(?:-webkit-)?user-select:text(?:;|$)/;
  assert.match("user-select:text", selectable);
  assert.ok(viewRules.length);
  for (const rule of viewRules) assert.doesNotMatch(rule, selectable);
});

test("web response exposes the spatial controls without legacy chrome", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pith-track3-"));
  const server = await createPithWebServer({ workspaceDir: dir });
  try {
    const address = server.address(); assert.ok(address && typeof address !== "string");
    const response = await fetch(`http://127.0.0.1:${address.port}/`);
    assert.equal(response.status, 200);
    const html = await response.text();
    for (const token of ["var(--background-primary)", "var(--background-secondary)", "var(--background-modifier-border)", "var(--text-normal)", "var(--font-interface)", "pith-left-drawer", "pith-bottom-dock", "pith-speech-active", "pith-toast-tip", "从此句朗读"]) assert.ok(html.includes(token), token);
    assert.match(html, /id="toggle-side" title="切换向导栏" aria-label="切换向导栏"/);
    assert.doesNotMatch(html, /#f3ede1|<div class="toc">|<nav class="files">|alert\s*\(/i);
    const script = /<script>([\s\S]*?)<\/script>/.exec(html); assert.ok(script);
    assert.doesNotThrow(() => new Function(script[1]!));
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await rm(dir, { recursive: true, force: true });
  }
});

test("source does not use blocking alert dialogs", async () => {
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (/\.[cm]?[jt]sx?$/.test(entry.name)) assert.doesNotMatch(await readFile(path, "utf8"), /\balert\s*\(/, path);
    }
  };
  await visit(join(process.cwd(), "src"));
});
