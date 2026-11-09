import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type RequestListener } from "node:http";
import { join } from "node:path";
import test from "node:test";
import { discoverLocalAgents } from "../src/plugins/guide-acp/discovery.ts";
import { downloadSpeechArchive } from "../src/shells/speech/speechDownload.ts";
import { NodeAgentProcessPort } from "../src/shells/web/nodeProcess.ts";
import { testSandbox } from "./sandbox.ts";

const payload = Buffer.from("controlled archive bytes ".repeat(1000));
const partial = payload.subarray(0, 3000);
const hash = createHash("sha256").update(payload).digest("hex");
const policy = { connectTimeoutSec: 2, lowSpeedBytes: 1, lowSpeedSeconds: 2, backoffMs: 10 };

async function fixture(handler: RequestListener) {
  const server = createServer(handler);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); assert.ok(address && typeof address !== "string");
  return { url: `http://127.0.0.1:${address.port}/archive`, close: () => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())) };
}

test("Range ignored with a verified 200 body replaces the partial without appending", async () => {
  const root = await testSandbox("pith-task31-full-"); const path = join(root, "archive"); await writeFile(path, partial);
  let range: string | undefined;
  const http = await fixture((req, res) => { range = req.headers.range; res.writeHead(200, { "content-length": payload.length }); res.end(payload); });
  try {
    await downloadSpeechArchive(path, { url: http.url, hash, algorithm: "sha256", encoding: "hex", maxBytes: payload.length }, new AbortController().signal, () => {}, policy);
    assert.equal(range, `bytes=${partial.length}-`); assert.deepEqual(await readFile(path), payload);
  } finally { await http.close(); await rm(root, { recursive: true, force: true }); }
});

for (const kind of ["hash", "size", "cancel"] as const) test(`ignored Range ${kind} preserves the original partial`, async () => {
  const root = await testSandbox("pith-task31-protect-"); const path = join(root, "archive"); await writeFile(path, partial);
  const abort = new AbortController();
  const http = await fixture((_req, res) => {
    res.writeHead(200, { "content-length": payload.length });
    if (kind === "cancel") res.write(payload.subarray(0, 20000)); else res.end(payload);
  });
  try {
    await assert.rejects(downloadSpeechArchive(path, { url: http.url, hash: kind === "hash" ? "0".repeat(64) : hash, algorithm: "sha256", encoding: "hex", maxBytes: kind === "size" ? payload.length - 1 : payload.length }, abort.signal, progress => { if (kind === "cancel" && progress.bytes > partial.length) abort.abort(); }, policy));
    if (kind === "cancel") assert.equal(abort.signal.aborted, true);
    assert.deepEqual(await readFile(path), partial);
  } finally { await http.close(); await rm(root, { recursive: true, force: true }); }
});

for (const scenario of ["recover", "exhaust", "cancel"] as const) test(`HTTP 504 ${scenario} retains retry and cancellation semantics`, async () => {
  const root = await testSandbox("pith-task31-504-"); const path = join(root, "archive"); await writeFile(path, partial);
  const abort = new AbortController(); let calls = 0;
  const http = await fixture((req, res) => { calls++; assert.equal(req.headers.range, `bytes=${partial.length}-`); if (scenario === "recover" && calls === 3) { res.writeHead(206, { "content-range": `bytes ${partial.length}-${payload.length - 1}/${payload.length}`, "content-length": payload.length - partial.length }); res.end(payload.subarray(partial.length)); } else { res.writeHead(504); res.end(); if (scenario === "cancel") setTimeout(() => abort.abort(), 100); } });
  try {
    const started = Date.now();
    const download = downloadSpeechArchive(path, { url: http.url, hash, algorithm: "sha256", encoding: "hex", maxBytes: payload.length }, abort.signal, () => {}, scenario === "cancel" ? { ...policy, backoffMs: 3000 } : policy);
    if (scenario === "recover") { await download; assert.equal(calls, 3); assert.deepEqual(await readFile(path), payload); }
    else { await assert.rejects(download); assert.equal(calls, scenario === "cancel" ? 1 : 4); if (scenario === "cancel") assert.ok(Date.now() - started < 2000, "cancel must interrupt retry backoff"); assert.deepEqual(await readFile(path), partial); }
  } finally { await http.close(); await rm(root, { recursive: true, force: true }); }
});

test("real CLI discovery inherits configured agent directories and keeps isolated cwd and timeout", async () => {
  const root = await testSandbox("pith-task31-cli-"); const keys = ["HOME", "PI_CODING_AGENT_DIR", "CLAUDE_CONFIG_DIR", "CODEX_HOME", "DSH_HOME"] as const;
  const original = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  for (const key of keys) { const dir = join(root, key); await mkdir(dir); await writeFile(join(dir, "marker"), key); process.env[key] = dir; }
  const cli = join(root, "fixture-acp");
  await writeFile(cli, `#!/bin/sh\nfor name in HOME PI_CODING_AGENT_DIR CLAUDE_CONFIG_DIR CODEX_HOME DSH_HOME; do\n eval "dir=\\$$name"\n [ "$(cat "$dir/marker" 2>/dev/null)" = "$name" ] || exit 1\ndone\n[ "$PWD" != "$HOME" ] || exit 1\ncase "$1" in --version) echo 'fixture 1.0';; --help) echo 'Agent Client Protocol ACP';; --hang) exec sleep 10;; esac\n`); await chmod(cli, 0o755);
  try {
    const port = new NodeAgentProcessPort({ searchPaths: [root] });
    const [agent] = await discoverLocalAgents({ processPort: port, candidates: [{ id: "fixture", label: "Fixture", commands: [{ command: "fixture-acp", args: [], detectArgs: ["--help"], detectPattern: /ACP/ }], installHint: "fixture" }], timeoutMs: 1000 });
    assert.equal(agent!.available, true); assert.equal(agent!.version, "fixture 1.0");
    assert.equal(await port.probeExecutable(cli, ["--hang"], 100), null);
  } finally { for (const key of keys) { if (original[key] === undefined) delete process.env[key]; else process.env[key] = original[key]; } await rm(root, { recursive: true, force: true }); }
});
