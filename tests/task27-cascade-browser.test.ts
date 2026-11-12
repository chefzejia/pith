import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import { renderEpub } from "../src/plugins/stage-reader/epub.ts";
import { createPithWebServer } from "../src/shells/web/server.ts";
import { storedEpub } from "./wave12-epub-fixture.ts";
import { testSandbox } from "./sandbox.ts";

const enabled = Boolean(process.env.PITH_PLAYWRIGHT_MODULE && process.env.PITH_CHROME_PATH);
function fixture(): Uint8Array {
  const body = `<html><head><style>body { color: #003000 } .white { background: #fff } .gray { background: #e8e8e8 } .mid { background: #454545 } .black { background: #161616 } .navy { background: #000033 } .safe { color: #5500af } .muted { color: #999999 } .explicit { color: #004080 } .alpha { background: rgba(0,0,0,0.7) }</style></head><body><h2>继承与背景</h2><p id="unpainted">没有局部背景的文字</p><p class="safe" id="safe">浅色主题原书颜色</p><p class="muted" id="no-local-muted">浅色主题未设背景的原色</p><div class="white"><p><span id="white">白底继承文字</span></p></div><div class="gray"><p><span id="gray">灰白底继承文字</span></p></div><div class="mid"><p><span id="mid">中灰底继承文字</span></p></div><div class="black"><p><span id="black">近黑底继承文字</span></p><div class="white"><p><span id="nested-white">深底内的白底文字</span></p></div></div><div class="navy"><p><span id="navy">深蓝底继承文字</span></p><p class="explicit"><span id="explicit">深蓝底指定颜色</span></p></div><div class="white"><p class="alpha"><span id="alpha">半透明深底文字</span></p></div></body></html>`;
  const root = '<html><head><style>body.book { background: #efaf43; color: #003000 } .dark { background: #161616 } .navy { background: #000033 }</style></head><body class="book"><h2 id="root-safe">浅色章节背景的原色</h2><div class="dark"><p><span id="root-dark">章节内近黑底文字</span></p></div><div class="navy"><p><span id="root-navy">章节内深蓝底文字</span></p></div></body></html>';
  return storedEpub({ "META-INF/container.xml": '<container><rootfile full-path="O/book.opf"/></container>', "O/book.opf": '<package><manifest><item id="a" href="a.xhtml"/><item id="b" href="b.xhtml"/></manifest><spine><itemref idref="a"/><itemref idref="b"/></spine></package>', "O/a.xhtml": body, "O/b.xhtml": root });
}

async function inspect(page: any, ids: readonly string[]): Promise<Record<string, { ratio: number; color: string }>> {
  return page.evaluate((ids: string[]) => {
    const parse = (value: string) => value.match(/[\d.]+/g)!.map(Number);
    const composite = (front: number[], back: number[]) => front.slice(0, 3).map((v, i) => v * (front[3] ?? 1) + back[i]! * (1 - (front[3] ?? 1)));
    const lum = (c: number[]) => c.map(x => { const v = x / 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }).reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i]!, 0);
    return Object.fromEntries(ids.map(id => {
      const element = document.getElementById(id)!; const layers: number[][] = [];
      for (let node: Element | null = element; node; node = node.parentElement) layers.push(parse(getComputedStyle(node).backgroundColor));
      let bg = [255, 255, 255]; for (const layer of layers.reverse()) bg = composite(layer, bg);
      const color = getComputedStyle(element).color, fg = composite(parse(color), bg), x = lum(fg), y = lum(bg);
      return [id, { ratio: (Math.max(x, y) + .05) / (Math.min(x, y) + .05), color }];
    }));
  }, ids);
}

async function verify(mode: "dark" | "light"): Promise<void> {
  const dir = await testSandbox(`pith-task27-${mode}-`); await mkdir(join(dir, "workspace"));
  const server = await createPithWebServer({ workspaceDir: join(dir, "workspace") }); let browser: any;
  try {
    const address = server.address(); assert.ok(address && typeof address !== "string"); const base = `http://127.0.0.1:${address.port}`;
    const post = async (path: string, data: unknown) => { const response = await fetch(base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data) }); assert.ok(response.ok); return response.json(); };
    const topic = await post("/api/topics", { title: "继承与背景" });
    await post("/api/materials", { topicId: topic.id, title: "继承与背景", kind: "book", files: [{ name: "fixture.epub", data: Buffer.from(fixture()).toString("base64") }] });
    const bundle = await build({ entryPoints: ["src/shells/obsidian/plugin.ts"], bundle: true, write: false, platform: "browser", format: "iife", globalName: "PithView" });
    const rendered = await renderEpub(fixture());
    const { chromium } = await import(process.env.PITH_PLAYWRIGHT_MODULE!);
    browser = await chromium.launchPersistentContext(join(dir, "profile"), { executablePath: process.env.PITH_CHROME_PATH, headless: true, viewport: { width: 1100, height: 900 } });
    const page = await browser.newPage(); const evidence = resolve(".tmp/evidence/task-27"); await mkdir(evidence, { recursive: true });
    for (const shell of ["web", "obsidian"] as const) {
      if (shell === "web") {
        await page.goto(base);
        await page.addStyleTag({ content: 'body.theme-dark{--background-primary:#1e1e1e;--background-secondary:#292929;--text-normal:#eee}body.theme-light{--background-primary:#fff;--text-normal:#222}' });
        await page.evaluate((name: string) => { document.body.className = `theme-${name}`; }, mode);
        await page.locator(`[data-topic="${topic.id}"]`).first().click();
      } else {
        await page.goto("about:blank");
        await page.setContent(`<style>html,body,#root{height:100%;margin:0}body.theme-dark{--background-primary:#1e1e1e;--background-secondary:#292929;--text-normal:#eee}body.theme-light{--background-primary:#fff;--text-normal:#222}</style><body class="theme-${mode}"><div id="root"></div></body>`);
        await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
        await page.evaluate((html: string) => { const view = new (window as any).PithView.PithObsidianView(document.getElementById("root"), { openFile() {}, selection() {}, openToolkit() {} }); view.render({ html, title: "继承与背景", currentFile: "test.epub", format: "epub", files: [], sections: [] }); }, rendered.html);
      }
      await page.locator("#alpha").waitFor({ state: "attached" });
      const values = await inspect(page, ["unpainted", "white", "gray", "mid", "black", "nested-white", "navy", "explicit", "alpha", "root-safe", "root-dark", "root-navy"]);
      for (const [id, result] of Object.entries(values)) assert.ok(result.ratio >= 4.5, `${shell}/${mode}/${id}: ${JSON.stringify(result)}`);
      if (mode === "light") {
        assert.equal((await inspect(page, ["safe"])).safe!.color, "rgb(85, 0, 175)");
        assert.equal((await inspect(page, ["no-local-muted"]))["no-local-muted"]!.color, "rgb(153, 153, 153)");
        assert.equal(values.white!.color, "rgb(0, 48, 0)");
        assert.equal(values["root-safe"]!.color, "rgb(0, 48, 0)");
      }
      await page.screenshot({ path: join(evidence, `worker-${shell}-${mode}-inheritance.png`) });
      if (mode === "light") { await page.locator("#root-safe").scrollIntoViewIfNeeded(); await page.screenshot({ path: join(evidence, `worker-${shell}-light-root.png`) }); }
      const opposite = mode === "dark" ? "light" : "dark";
      await page.evaluate(({ oldMode, nextMode }: { oldMode: string; nextMode: string }) => { document.body.classList.replace(`theme-${oldMode}`, `theme-${nextMode}`); }, { oldMode: mode, nextMode: opposite });
      await page.waitForFunction((dark: boolean) => (getComputedStyle(document.getElementById("unpainted")!).color !== "rgb(0, 48, 0)") === dark, opposite === "dark");
      const switched = await inspect(page, ["white", "gray", "mid", "black", "nested-white", "navy", "explicit", "alpha", "root-safe", "root-dark", "root-navy"]);
      for (const [id, result] of Object.entries(switched)) assert.ok(result.ratio >= 4.5, `${shell}/${mode}->${opposite}/${id}: ${JSON.stringify(result)}`);
      if (opposite === "light") assert.equal(switched.white!.color, "rgb(0, 48, 0)");
    }
  } finally { if (browser) await browser.close(); await new Promise<void>((resolveClose, reject) => server.close(error => error ? reject(error) : resolveClose())); await rm(dir, { recursive: true, force: true }); }
}

test("dark mode corrects final inherited colors on local backgrounds", { timeout: 60000, skip: !enabled }, async () => verify("dark"));
test("light mode corrects local dark backgrounds and preserves readable colors", { timeout: 60000, skip: !enabled }, async () => verify("light"));
