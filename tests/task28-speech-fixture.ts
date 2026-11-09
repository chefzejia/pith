import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { NodeManagedSpeechRuntime } from "../src/shells/speech/speechRuntime.ts";

const exec = promisify(execFile);

export async function createSpeechDownloadFixture(root: string, options: { disconnectFirst?: boolean; stallFirst?: boolean; chunkMs?: number; rangeBehavior?: "ignore" | "invalid" | "malformed" | "unknown416" } = {}) {
  const source = join(root, "archives-source"), archives = join(root, "archives");
  await mkdir(source, { recursive: true }); await mkdir(archives, { recursive: true });
  const nodeName = `node-v22.19.0-${process.platform}-${process.arch}`;
  const native = `sherpa-onnx-${process.platform}-${process.arch}`;
  const tts = "kokoro-int8-multi-lang-v1_1", asr = "sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17";
  const file = async (path: string, bytes: string | Uint8Array) => { const target = join(source, path); await mkdir(join(target, ".."), { recursive: true }); await writeFile(target, bytes); };
  await file(`${nodeName}/bin/node`, "fixture only; never execute\n");
  await file(`${nodeName}/padding`, randomBytes(2 * 1024 * 1024));
  await exec("tar", ["-czf", join(archives, "node.tar.gz"), "-C", source, nodeName]);
  for (const [name, entry] of [["sherpa-onnx-node", "sherpa-onnx.js"], [native, "sherpa-onnx.node"]] as const) {
    const dir = join(root, `source-${name}`); await mkdir(join(dir, "package"), { recursive: true }); await writeFile(join(dir, "package", entry), "fixture\n");
    await exec("tar", ["-czf", join(archives, `${name}.tgz`), "-C", dir, "package"]);
  }
  for (const name of ["model.int8.onnx", "voices.bin", "tokens.txt", "lexicon-us-en.txt", "lexicon-zh.txt", "date-zh.fst", "number-zh.fst", "phone-zh.fst"]) await file(`${tts}/${name}`, "fixture\n");
  await file(`${tts}/espeak-ng-data/fixture`, "fixture\n"); await file(`${tts}/dict/fixture`, "fixture\n");
  for (const name of ["model.int8.onnx", "tokens.txt"]) await file(`${asr}/${name}`, "fixture\n");
  await exec("tar", ["-cjf", join(archives, "tts.tar.bz2"), "-C", source, tts]);
  await exec("tar", ["-cjf", join(archives, "asr.tar.bz2"), "-C", source, asr]);
  const names = ["node.tar.gz", "sherpa-onnx-node.tgz", `${native}.tgz`, "tts.tar.bz2", "asr.tar.bz2"];
  const data = new Map<string, Buffer>();
  for (const name of names) data.set(name, await readFile(join(archives, name)));
  const events = new EventEmitter();
  const requests: Array<{ name: string; start: number; range: string | null }> = [];
  let first = true;
  const server = createServer((req, res) => {
    const name = decodeURIComponent((req.url ?? "").slice(1)), bytes = data.get(name);
    if (!bytes) { res.writeHead(404); res.end(); return; }
    const range = req.headers.range ?? null, match = range && /^bytes=(\d+)-$/.exec(range), start = match ? Number(match[1]) : 0;
    requests.push({ name, start, range }); events.emit("request", requests.at(-1));
    if (start && options.rangeBehavior === "unknown416") { res.writeHead(416); res.end(); return; }
    if (start && options.rangeBehavior === "ignore") { res.writeHead(200, { "content-length": bytes.length }); res.end(bytes); return; }
    if (start >= bytes.length) { res.writeHead(416, { "content-range": `bytes */${bytes.length}` }); res.end(); return; }
    res.writeHead(start ? 206 : 200, { "content-type": "application/octet-stream", "content-length": bytes.length - start, "accept-ranges": "bytes", ...(start ? { "content-range": `bytes ${options.rangeBehavior === "invalid" ? start - 1 : start}-${bytes.length - 1}/${bytes.length}${options.rangeBehavior === "malformed" ? "invalid" : ""}` } : {}) });
    const disconnect = options.disconnectFirst && first && name === "node.tar.gz", stall = options.stallFirst && first && name === "node.tar.gz"; if (name === "node.tar.gz") first = false;
    let position = start;
    const send = () => {
      if (res.destroyed) return;
      if (position >= bytes.length) { res.end(); return; }
      const end = Math.min(bytes.length, position + 32768); res.write(bytes.subarray(position, end)); position = end; events.emit("chunk", { name, position, start });
      if (disconnect && position - start >= 262144) { res.destroy(); return; }
      if (stall) return;
      setTimeout(send, options.chunkMs ?? 35);
    };
    send();
  });
  await new Promise<void>((ok, fail) => { server.once("error", fail); server.listen(0, "127.0.0.1", ok); });
  const address = server.address(); if (!address || typeof address === "string") throw new Error("Fixture has no port");
  const overrides: Record<string, { url: string; hash: string }> = {};
  for (const name of names) overrides[name] = { url: `http://127.0.0.1:${address.port}/${name}`, hash: createHash(name.endsWith(".tgz") ? "sha512" : "sha256").update(data.get(name)!).digest(name.endsWith(".tgz") ? "base64" : "hex") };
  return { overrides, requests, events, close: () => new Promise<void>((ok, fail) => server.close(error => error ? fail(error) : ok())) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url) && process.argv.includes("--serve")) {
  const { testSandbox } = await import("./sandbox.ts");
  const { createPithWebServer } = await import("../src/shells/web/server.ts");
  const root = await testSandbox("pith-task28-fixture-"); const workspace = join(root, "workspace"); await mkdir(workspace);
  const fixture = await createSpeechDownloadFixture(root, { chunkMs: 80 });
  const home = join(root, "speech"); const runtime = new NodeManagedSpeechRuntime({ home, protectedRoot: workspace, archives: fixture.overrides });
  const web = await createPithWebServer({ workspaceDir: workspace, speechRuntime: runtime });
  fixture.events.on("request", item => console.log("REQUEST", JSON.stringify(item)));
  const address = web.address(); if (!address || typeof address === "string") throw new Error("Fixture web server has no port");
  console.log(JSON.stringify({ root, home, web: `http://127.0.0.1:${address.port}`, archives: fixture.overrides }));
}
