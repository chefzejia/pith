import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { NodeAgentProcessPort } from "../src/shells/web/nodeProcess.ts";

test("Pith applies real dsh effort without network or model inference", async (t) => {
  const executable = await new NodeAgentProcessPort().findExecutable("dsh");
  if (!executable) { t.skip("dsh is not installed"); return; }
  const root = resolve(".tmp");
  await mkdir(root, { recursive: true });
  const sandbox = await mkdtemp(join(root, "task15-dsh-probe-"));
  try {
    const source = `import { CachedAgentDetector } from ${JSON.stringify(new URL("../src/plugins/guide-acp/discovery.ts", import.meta.url).href)};
import { runOneShotAcpPrompt } from ${JSON.stringify(new URL("../src/plugins/guide-acp/acpSession.ts", import.meta.url).href)};
import { NodeAgentProcessPort } from ${JSON.stringify(new URL("../src/shells/web/nodeProcess.ts", import.meta.url).href)};
const port = new NodeAgentProcessPort();
const detector = new CachedAgentDetector({ processPort: port, timeoutMs: 30000, candidates: [{ id: 'dsh', label: 'dsh', commands: [{ command: ${JSON.stringify(executable)}, args: ['--profile', 'acp'], versionArgs: ['--version'] }], installHint: '' }] });
const options = await detector.probeAgentOptions('dsh');
const model = options.find(item => item.id === 'model'), effort = options.find(item => item.id === 'reasoning_effort' || item.category === 'thought_level');
if (!model || !effort) throw new Error('dsh did not return model and effort options');
const effortValue = effort.options.find(item => item.value !== effort.currentValue)?.value;
if (!effortValue) throw new Error('dsh has no alternative effort');
const changes = [], pending = new Map(); let promptIntercepted = false;
const interceptingPort = { spawnStdio: async spec => {
  const child = await port.spawnStdio(spec); let listener;
  return { ...child, onLine(fn) { listener = fn; return child.onLine(line => { const response = JSON.parse(line); if (pending.has(response.id)) { changes.push({ request: pending.get(response.id), result: response.result, error: response.error }); pending.delete(response.id); } fn(line); }); },
    writeLine(line) { const request = JSON.parse(line); if (request.method === 'session/prompt') { promptIntercepted = true; listener(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: { stopReason: 'end_turn' } })); return; } if (request.method === 'session/set_config_option') pending.set(request.id, request.params); return child.writeLine(line); } };
} };
const descriptor = (await detector.detect()).find(item => item.id === 'dsh');
await runOneShotAcpPrompt('not sent to dsh', { descriptor, processPort: interceptingPort, effort: effortValue, timeoutMs: 30000 });
if (!promptIntercepted || changes.length !== 1 || changes[0].request.configId !== effort.id) throw new Error('Pith did not send the effort configuration call');
for (const change of changes) { const updated = change.result?.configOptions?.find(item => item.id === change.request.configId); if (change.error || updated?.currentValue !== change.request.value) throw new Error('dsh did not confirm configuration: ' + JSON.stringify(change)); }`;
    const args = ["--experimental-strip-types", "--input-type=module", "-e", source];
    if (process.platform !== "darwin") { t.skip("network-isolated real dsh test requires macOS sandbox-exec"); return; }
    await promisify(execFile)("/usr/bin/sandbox-exec", ["-p", "(version 1) (allow default) (deny network*)", process.execPath, ...args], {
      cwd: sandbox,
      env: { HOME: sandbox, DSH_HOME: join(sandbox, "dsh"), XDG_CONFIG_HOME: join(sandbox, "config"), XDG_CACHE_HOME: join(sandbox, "cache"), PATH: "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin" },
      timeout: 45000,
    });
  } finally { await rm(sandbox, { recursive: true, force: true }); }
});

test("Pith switches a real dsh session to a local model and reaches its controlled provider", { timeout: 60000 }, async (t) => {
  if (process.platform !== "darwin") { t.skip("network isolation requires macOS sandbox-exec"); return; }
  const executable = await new NodeAgentProcessPort().findExecutable("dsh");
  if (!executable) { t.skip("dsh is not installed"); return; }
  const root = resolve(".tmp"); await mkdir(root, { recursive: true });
  const sandbox = await mkdtemp(join(root, "task15-dsh-model-"));
  const requests: { model?: string; stream?: boolean }[] = [];
  const provider = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", chunk => chunks.push(Buffer.from(chunk)));
    req.on("end", () => {
      requests.push(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.end('data: {"id":"local-test","object":"chat.completion.chunk","created":1,"model":"local-beta","choices":[{"index":0,"delta":{"role":"assistant","content":"Local fixture response."},"finish_reason":null}]}\n\ndata: {"id":"local-test","object":"chat.completion.chunk","created":1,"model":"local-beta","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');
    });
  });
  await new Promise<void>((resolveListen, reject) => { provider.once("error", reject); provider.listen(0, "127.0.0.1", resolveListen); });
  try {
    const address = provider.address(); assert.ok(address && typeof address !== "string");
    const source = `import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { CachedAgentDetector } from ${JSON.stringify(new URL("../src/plugins/guide-acp/discovery.ts", import.meta.url).href)};
import { runOneShotAcpPrompt } from ${JSON.stringify(new URL("../src/plugins/guide-acp/acpSession.ts", import.meta.url).href)};
import { NodeAgentProcessPort } from ${JSON.stringify(new URL("../src/shells/web/nodeProcess.ts", import.meta.url).href)};
const port = new NodeAgentProcessPort();
const candidate = { id: 'dsh', label: 'dsh', commands: [{ command: ${JSON.stringify(executable)}, args: ['--profile', 'acp'], versionArgs: ['--version'] }], installHint: '' };
const detector = new CachedAgentDetector({ processPort: port, timeoutMs: 30000, candidates: [candidate] });
await detector.probeAgentOptions('dsh');
await writeFile(join(process.env.DSH_HOME, 'profiles/acp/cordis.patch.yml'), ${JSON.stringify(`- id: llm-pi-ai\n  config:\n    providers:\n      local-test:\n        displayName: Local Test\n        api: openai-completions\n        baseURL: http://127.0.0.1:${address.port}/v1\n        apiKeyEnv: PITH_TEST_LOCAL_KEY\n        models:\n          - id: local-alpha\n            name: Local Alpha\n          - id: local-beta\n            name: Local Beta\n`)});
const options = await detector.probeAgentOptions('dsh', true);
const model = options.find(item => item.id === 'model');
const alpha = model?.options.find(item => item.group === 'local-test' && item.name === 'Local Alpha');
const beta = model?.options.find(item => item.group === 'local-test' && item.name === 'Local Beta');
if (!alpha || !beta || alpha.value === beta.value) throw new Error('Local model choices missing: ' + JSON.stringify(model));
const pending = new Map(), changes = [];
const monitored = { spawnStdio: async spec => { const child = await port.spawnStdio(spec); return { ...child, onLine(fn) { return child.onLine(line => { try { const response = JSON.parse(line); if (pending.has(response.id)) { changes.push({ request: pending.get(response.id), result: response.result, error: response.error }); pending.delete(response.id); } } catch {} fn(line); }); }, writeLine(line) { const request = JSON.parse(line); if (request.method === 'session/set_config_option') pending.set(request.id, request.params); return child.writeLine(line); } }; } };
const descriptor = (await detector.detect()).find(item => item.id === 'dsh');
const response = await runOneShotAcpPrompt('This is a local fixture request.', { descriptor, processPort: monitored, model: beta.value, timeoutMs: 30000 });
const change = changes.find(item => item.request.configId === 'model');
if (!change || change.error || change.result?.configOptions?.find(item => item.id === 'model')?.currentValue !== beta.value) throw new Error('Model switch not confirmed: ' + JSON.stringify(change));
if (!response.text.includes('Local fixture response.')) throw new Error('Unexpected response: ' + response.text);`;
    const policy = `(version 1) (allow default) (deny network*) (allow network-outbound (remote ip "localhost:${address.port}"))`;
    await promisify(execFile)("/usr/bin/sandbox-exec", ["-p", policy, process.execPath, "--experimental-strip-types", "--input-type=module", "-e", source], {
      cwd: sandbox,
      env: { HOME: sandbox, DSH_HOME: join(sandbox, "dsh"), XDG_CONFIG_HOME: join(sandbox, "config"), XDG_CACHE_HOME: join(sandbox, "cache"), PATH: "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin", PITH_TEST_LOCAL_KEY: "pith-fixture" },
      timeout: 50000,
    });
    assert.equal(requests.length, 1);
    assert.equal(requests[0]!.model, "local-beta");
    assert.equal(requests[0]!.stream, true);
  } finally { await new Promise<void>((resolveClose, reject) => provider.close(error => error ? reject(error) : resolveClose())); await rm(sandbox, { recursive: true, force: true }); }
});
