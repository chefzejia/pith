import { createTestTopic } from "./topic-fixture.ts";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { createPithWebServer } from "../src/shells/web/server.ts";
import { NodeAgentProcessPort } from "../src/shells/web/nodeProcess.ts";
import { storedEpub } from "./wave12-epub-fixture.ts";

test("Web guide sends the chosen model through a real isolated dsh session", { timeout: 90000, skip: !process.env.PITH_PLAYWRIGHT_MODULE || !process.env.PITH_CHROME_PATH }, async (t) => {
  if (process.platform !== "darwin") { t.skip("network isolation requires macOS sandbox-exec"); return; }
  if (!process.env.PITH_DSH_BROWSER_SANDBOX) {
    const executable = await new NodeAgentProcessPort().findExecutable("dsh");
    if (!executable) { t.skip("dsh is not installed"); return; }
    const root = resolve(".tmp"); await mkdir(root, { recursive: true });
    const dir = await mkdtemp(join(root, "task15-dsh-browser-"));
    try {
      const policy = '(version 1) (allow default) (deny network*) (allow network* (local unix-socket)) (allow network-inbound (local ip "localhost:*")) (allow network-outbound (remote ip "localhost:*"))';
      await promisify(execFile)("/usr/bin/sandbox-exec", ["-p", policy, process.execPath, "--experimental-strip-types", "--test", "tests/task15-dsh-web-browser.test.ts"], {
        cwd: process.cwd(), timeout: 85000,
        env: { HOME: dir, DSH_HOME: join(dir, "dsh"), XDG_CONFIG_HOME: join(dir, "config"), XDG_CACHE_HOME: join(dir, "cache"), TMPDIR: dir, PATH: `${dirname(executable)}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin`, PITH_DSH_BROWSER_SANDBOX: dir, PITH_DSH_TEST_BINARY: executable, PITH_TEST_LOCAL_KEY: "pith-fixture", PITH_PLAYWRIGHT_MODULE: process.env.PITH_PLAYWRIGHT_MODULE!, PITH_CHROME_PATH: process.env.PITH_CHROME_PATH!, PITH_SPEECH_HOME: join(dir, "speech") },
      });
    } finally { await rm(dir, { recursive: true, force: true }); }
    return;
  }

  const dir = process.env.PITH_DSH_BROWSER_SANDBOX, requests: { model?: string }[] = [];
  const frames: unknown[] = [];
  const originalSpawn = NodeAgentProcessPort.prototype.spawnStdio;
  NodeAgentProcessPort.prototype.spawnStdio = async function(spec) {
    const handle = await originalSpawn.call(this, spec);
    return { ...handle, writeLine(line) { const message = JSON.parse(line); frames.push({ sent: message.method, id: message.id }); return handle.writeLine(line); }, onLine(listener) { return handle.onLine(line => { try { const message = JSON.parse(line); frames.push({ received: message.method, id: message.id, error: message.error }); } catch {} listener(line); }); } };
  };
  const provider = createServer((req, res) => { const chunks: Buffer[] = []; req.on("data", chunk => chunks.push(Buffer.from(chunk))); req.on("end", () => {
    requests.push(JSON.parse(Buffer.concat(chunks).toString("utf8")));
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.end('data: {"id":"fixture","object":"chat.completion.chunk","created":1,"model":"local-beta","choices":[{"index":0,"delta":{"role":"assistant","content":"Local fixture response."},"finish_reason":null}]}\n\ndata: {"id":"fixture","object":"chat.completion.chunk","created":1,"model":"local-beta","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');
  }); });
  await new Promise<void>((done, reject) => { provider.once("error", reject); provider.listen(0, "127.0.0.1", done); });
  let web: Awaited<ReturnType<typeof createPithWebServer>> | undefined, browser: any;
  try {
    const address = provider.address(); assert.ok(address && typeof address !== "string");
    await promisify(execFile)(process.env.PITH_DSH_TEST_BINARY!, ["--profile", "acp", "--dump-config"], { cwd: dir, timeout: 15000 });
    await writeFile(join(dir, "dsh/profiles/acp/cordis.patch.yml"), `- id: llm-pi-ai\n  config:\n    providers:\n      local-test:\n        displayName: Local Test\n        api: openai-completions\n        baseURL: http://127.0.0.1:${address.port}/v1\n        apiKeyEnv: PITH_TEST_LOCAL_KEY\n        models:\n          - id: local-alpha\n            name: Local Alpha\n          - id: local-beta\n            name: Local Beta\n`);
    await mkdir(join(dir, "workspace"));
    // The outer network sandbox cannot be nested with macOS file sandbox-exec.
    web = await createPithWebServer({ workspaceDir: join(dir, "workspace"), processPort: new NodeAgentProcessPort() });
    const webAddress = web.address(); assert.ok(webAddress && typeof webAddress !== "string"); const base = `http://127.0.0.1:${webAddress.port}`;
    const post = async (path: string, value: unknown) => { const response = await fetch(base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(value) }); assert.ok(response.ok); return response.json(); };
    await post("/api/settings", { agentId: "dsh", model: "old-profile-model", effort: "low" });
    const topic = await createTestTopic(join(dir, "workspace"), { title: "English reading" });
    const book = storedEpub({ "META-INF/container.xml": '<container><rootfiles><rootfile full-path="book.opf"/></rootfiles></container>', "book.opf": '<package><metadata><title>Speech test</title></metadata><manifest><item id="one" href="one.xhtml"/></manifest><spine><itemref idref="one"/></spine></package>', "one.xhtml": "<html><body><h1>Chapter One: Attention</h1><p>Reading carefully begins with the decision to notice what is in front of us.</p></body></html>" });
    await post("/api/materials", { topicId: topic.id, title: "English", kind: "book", files: [{ name: "english.epub", data: Buffer.from(book).toString("base64") }] });
    const { chromium } = await import(process.env.PITH_PLAYWRIGHT_MODULE!);
    browser = await chromium.launchPersistentContext(join(dir, "browser"), { executablePath: process.env.PITH_CHROME_PATH, headless: true, viewport: { width: 1280, height: 720 } });
    const page = await browser.newPage(); const errors: string[] = []; page.on("pageerror", (error: Error) => errors.push(error.message));
    await page.goto(base); await page.locator("[data-home-settings]").click();
    const beta = page.locator('#simple-model optgroup[label="Local Test"] option').filter({ hasText: "Local Beta" });
    try { await beta.waitFor({ state: "attached" }); }
    catch (error) { throw new Error(`ACP configuration probe failed: ${JSON.stringify({ frames, errors, options: await page.locator("#simple-model").textContent() })}`, { cause: error }); }
    assert.equal(await page.locator("#simple-model").inputValue(), "old-profile-model");
    assert.equal(await page.locator("#simple-effort").inputValue(), "low");
    assert.equal(frames.some((frame: any) => frame.sent === "session/set_config_option"), false);
    const model = await beta.getAttribute("value"); assert.ok(model); await page.locator("#simple-model").selectOption(model);
    await page.waitForFunction(async (selected: string) => { const settings = (await (await fetch("/api/state")).json()).settings; return settings.model === selected && settings.effort === "low"; }, model);
    await page.locator("#simple-effort").selectOption("");
    await page.waitForFunction(async (selected: string) => { const settings = (await (await fetch("/api/state")).json()).settings; return settings.agentId === "dsh" && settings.model === selected && settings.effort === ""; }, model);
    await page.waitForFunction(() => !(document.querySelector("#simple-effort") as HTMLSelectElement).disabled);
    await page.locator("#close-drawer").click(); await page.locator(`[data-topic="${topic.id}"]`).first().click(); await page.locator(".pith-guide-toggle").click();
    await page.locator(".pith-guide textarea").fill("This is a local fixture request."); await page.locator("[data-guide-send]").click();
    try { await page.locator(".pith-guide-content").getByText("Local fixture response.").waitFor({ timeout: 20000 }); }
    catch { throw new Error(JSON.stringify({ requests, frames, errors, toast: await page.locator("#toast").textContent(), input: await page.locator(".pith-guide textarea").inputValue() })); }
    assert.equal(requests.length, 1); assert.equal(requests[0]!.model, "local-beta"); assert.deepEqual(errors, []);
    await page.route("**/api/chat", (route: any) => route.fulfill({ status: 503, json: { error: "Fixture failure" } }));
    await page.locator(".pith-guide textarea").fill("Second fixture request."); await page.locator("[data-guide-send]").click();
    await page.locator("[data-guide-error]").getByText("Fixture failure").waitFor();
    assert.equal(await page.locator(".pith-guide textarea").inputValue(), "Second fixture request.");
  } finally {
    if (browser) await browser.close();
    if (web) await new Promise<void>((done, reject) => web!.close(error => error ? reject(error) : done()));
    await new Promise<void>((done, reject) => provider.close(error => error ? reject(error) : done()));
    NodeAgentProcessPort.prototype.spawnStdio = originalSpawn;
  }
});
