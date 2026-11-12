import assert from "node:assert/strict";
import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { NodeAgentProcessPort } from "../src/shells/web/nodeProcess.ts";
import { NodeToolServerPort } from "../src/shells/web/nodeToolServer.ts";
import { testSandbox } from "./sandbox.ts";

test("tool endpoint requires its per-session token and accepts only POST", async () => {
  const server = new NodeToolServerPort();
  const first = await server.open(async body => body), second = await server.open(async body => body);
  try {
    assert.notEqual(first.headers[0]!.value, second.headers[0]!.value);
    assert.equal((await fetch(first.url, { method: "POST", body: "{}" })).status, 401);
    assert.equal((await fetch(first.url, { method: "POST", body: "{}", headers: { [second.headers[0]!.name]: second.headers[0]!.value } })).status, 401);
    const headers = { [first.headers[0]!.name]: first.headers[0]!.value };
    assert.equal((await fetch(first.url, { headers })).status, 405);
    const result = await fetch(first.url, { method: "POST", headers, body: '{"id":1}' });
    assert.equal(result.status, 200); assert.equal(await result.text(), '{"id":1}');
  } finally { await first.close(); await second.close(); }
});

test("macOS agent process cannot write workspace or repository, but can write its own cwd", { skip: process.platform !== "darwin" }, async () => {
  const root = await testSandbox("task49-sandbox-"), workspace = join(root, "workspace"), repository = join(root, "repository");
  await mkdir(workspace); await mkdir(repository);
  const port = new NodeAgentProcessPort({ workspaceRoot: workspace });
  let processHandle: Awaited<ReturnType<NodeAgentProcessPort["spawnStdio"]>> | undefined;
  try {
    const script = `const fs = require('node:fs'); process.stdin.once('data', () => { const paths = process.argv.slice(1); const result = paths.map(p => { try { fs.writeFileSync(p, 'changed'); return 'allowed'; } catch (e) { return e.code; } }); fs.writeFileSync('own.txt', 'own'); console.log(JSON.stringify({ result, cwd: process.cwd() })); }); process.stdin.resume();`;
    processHandle = await port.spawnStdio({ command: process.execPath, args: ["-e", script, join(workspace, "blocked"), join(repository, "blocked")], readOnlyPaths: [repository] });
    const received = new Promise<string>((resolve, reject) => { processHandle!.onLine(resolve); processHandle!.onError?.(reject); processHandle!.onExit?.(() => reject(new Error("Agent exited before reporting"))); });
    await processHandle.writeLine("start");
    const line = await received;
    const result = JSON.parse(line) as { result: string[]; cwd: string };
    assert.deepEqual(result.result, ["EPERM", "EPERM"]);
    assert.equal(await readFile(join(result.cwd, "own.txt"), "utf8"), "own");
  } finally { if (processHandle) await processHandle.close(); await rm(root, { recursive: true, force: true }); }
});
