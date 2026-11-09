import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { once } from "node:events";
import { createRequire } from "node:module";
import test from "node:test";
import { build } from "esbuild";
import { readSpeechVoices } from "../src/shells/speech/speechVoices.ts";
import { SPEECH_GATEWAY } from "../src/shells/speech/speechGateway.ts";
import { NodeManagedSpeechRuntime } from "../src/shells/speech/speechRuntime.ts";
import { testSandbox } from "./sandbox.ts";

function varint(number: number): Buffer { const bytes = []; do { let byte = number % 128; number = Math.floor(number / 128); if (number) byte |= 128; bytes.push(byte); } while (number); return Buffer.from(bytes); }
function field(number: number, value: Uint8Array): Buffer { return Buffer.concat([varint(number * 8 + 2), varint(value.length), value]); }
function entry(key: string, value: string): Buffer { return field(14, Buffer.concat([field(1, Buffer.from(key)), field(2, Buffer.from(value))])); }
function model(mapping?: string): Buffer {
  const names = Array.from({ length: 49 }, (_, i) => `zf_${String(i).padStart(3, "0")}`);
  return Buffer.concat([field(7, Buffer.alloc(10000)), entry("speaker_names", names.join(",")), entry("speaker2id", mapping ?? names.map((name, i) => `${name}->${i}`).join(","))]);
}

test("protobuf voice metadata is bounded and mappings must agree", async () => {
  const root = await testSandbox("task30-metadata-"); const file = join(root, "model.onnx");
  try {
    await writeFile(file, model()); const result = await readSpeechVoices(file);
    assert.equal(result.voices.length, 49); assert.equal(result.defaultVoice, "zf_048"); assert.equal(result.voices[1]!.sid, 1);
    await writeFile(file, model("zf_000->1")); await assert.rejects(readSpeechVoices(file), /不一致/);
    const truncated = model(); await writeFile(file, truncated.subarray(0, truncated.length - 2)); await assert.rejects(readSpeechVoices(file), /截断/);
    await writeFile(file, Buffer.from([0x3a, 0xff, 0xff])); await assert.rejects(readSpeechVoices(file), /截断/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("gateway maps voice names and numeric IDs with unknown fallback", { timeout: 30000 }, async () => {
  const root = await testSandbox("task30-gateway-"); let child: ReturnType<typeof spawn> | undefined;
  try {
    await mkdir(join(root, "kokoro-int8-multi-lang-v1_1"), { recursive: true }); await mkdir(join(root, "node_modules/sherpa-onnx-node"), { recursive: true });
    await writeFile(join(root, "kokoro-int8-multi-lang-v1_1/model.int8.onnx"), model());
    await writeFile(join(root, "node_modules/sherpa-onnx-node/index.js"), "exports.OfflineTts = class { generate({sid}) { return { samples: new Float32Array([sid / 100]), sampleRate: 24000 }; } };\n");
    const bundle = await build({ entryPoints: ["src/shells/speech/speechGateway.ts"], bundle: true, write: false, platform: "node", format: "cjs", target: "es2022" });
    const modulePath = join(root, "gateway-bundle.cjs"); await writeFile(modulePath, bundle.outputFiles[0]!.contents);
    const bundled = createRequire(import.meta.url)(modulePath) as { SPEECH_GATEWAY: string };
    await writeFile(join(root, "gateway.cjs"), bundled.SPEECH_GATEWAY);
    child = spawn(process.execPath, [join(root, "gateway.cjs")], { cwd: root, env: { PATH: "/usr/bin:/bin", HOME: root }, stdio: ["ignore", "pipe", "pipe"] });
    let stderr = ""; child.stderr!.on("data", chunk => { stderr += String(chunk); });
    const port = await new Promise<number>((ok, fail) => { let output = ""; child!.stdout!.on("data", chunk => { output += String(chunk); const match = /^(\d+)\r?\n/.exec(output); if (match) ok(Number(match[1])); }); child!.once("error", fail); child!.once("exit", (code, signal) => fail(new Error(`Gateway exited ${code}/${signal}: ${stderr}`))); });
    const synth = async (voice: string) => { const response = await fetch(`http://127.0.0.1:${port}/v1/audio/speech`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ input: "test", voice }), signal: AbortSignal.timeout(5000) }); assert.equal(response.status, 200); return Buffer.from(await response.arrayBuffer()).readInt16LE(44); };
    assert.equal(await synth("zf_001"), Math.round(.01 * 32767)); assert.equal(await synth("1"), Math.round(.01 * 32767));
    assert.equal(await synth("alloy"), Math.round(.48 * 32767)); assert.equal(await synth(""), Math.round(.48 * 32767)); assert.equal(await synth("999"), Math.round(.48 * 32767));
  } finally { if (child && child.exitCode === null && child.signalCode === null) { const closed = once(child, "close"); child.kill("SIGTERM"); await closed; } await rm(root, { recursive: true, force: true }); }
});

test("real Kokoro model exposes voices and changes synthesized audio", { timeout: 180000, skip: !process.env.PITH_TASK30_SPEECH_ASSETS }, async () => {
  const source = resolve(process.env.PITH_TASK30_SPEECH_ASSETS!), root = await testSandbox("task30-real-"), managed = join(source, "managed-v2");
  const started = Date.now(), log = (message: string) => console.log(`[task30 ${Date.now() - started}ms] ${message}`);
  assert.ok(source.startsWith(resolve("../..") + "/") || source.includes("/.tmp/"));
  let child: ReturnType<typeof spawn> | undefined;
  try {
    log("reading model metadata"); const runtime = new NodeManagedSpeechRuntime({ home: source }); const result = await runtime.getVoices(); log(`metadata read: ${result.voices.length} voices`);
    assert.equal(result.voices.length, 103); assert.equal(result.defaultVoice, "zf_084");
    assert.equal(result.voices.find(item => item.id === "af_maple")?.sid, 0); assert.equal(result.voices.find(item => item.id === "zm_100")?.sid, 102);
    await symlink(join(managed, "kokoro-int8-multi-lang-v1_1"), join(root, "kokoro-int8-multi-lang-v1_1"), "dir");
    await symlink(join(managed, "node_modules"), join(root, "node_modules"), "dir");
    await writeFile(join(root, "gateway.cjs"), SPEECH_GATEWAY);
    child = spawn(join(managed, "bin/node"), [join(root, "gateway.cjs")], { cwd: root, env: { PATH: "/usr/bin:/bin", HOME: root, DYLD_LIBRARY_PATH: join(managed, "node_modules", `sherpa-onnx-${process.platform}-${process.arch}`), PITH_SPEECH_IDLE_SECONDS: "180" }, stdio: ["ignore", "pipe", "pipe"] });
    let stderr = ""; child.stderr!.on("data", chunk => { stderr += String(chunk); log(`gateway stderr: ${String(chunk).slice(0, 2000)}`); });
    child.once("exit", (code, signal) => log(`gateway exit code=${code} signal=${signal} stderr=${stderr.slice(-2000)}`));
    const port = await new Promise<number>((ok, fail) => { let output = ""; const timeout = setTimeout(() => fail(new Error(`Gateway startup timed out: ${stderr}`)), 30000); child!.stdout!.on("data", chunk => { output += String(chunk); const match = /^(\d+)\r?\n/.exec(output); if (match) { clearTimeout(timeout); ok(Number(match[1])); } }); child!.once("error", fail); child!.once("exit", () => { clearTimeout(timeout); fail(new Error(`Gateway exited: ${stderr}`)); }); });
    log(`gateway ready on ${port}`); const base = `http://127.0.0.1:${port}`;
    const voices = await (await fetch(`${base}/v1/audio/voices`, { signal: AbortSignal.timeout(30000) })).json() as typeof result; assert.equal(voices.voices.length, 103); log("voices response received");
    const health = await (await fetch(`${base}/health`, { signal: AbortSignal.timeout(30000) })).json() as typeof result; assert.equal(health.defaultVoice, "zf_084"); log("health response received");
    const synth = async (voice: string) => { log(`speech ${voice} request`); const response = await fetch(`${base}/v1/audio/speech`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ input: "Today we read a book.", voice }), signal: AbortSignal.timeout(30000) }); log(`speech ${voice} headers ${response.status}`); if (!response.ok) throw new Error(`Speech request failed: ${await response.text()}`); const bytes = Buffer.from(await response.arrayBuffer()); log(`speech ${voice} read ${bytes.length} bytes`); assert.equal(bytes.subarray(0, 4).toString(), "RIFF"); return createHash("sha256").update(bytes).digest("hex"); };
    const female = await synth("zf_001"), male = await synth("zm_010"); assert.notEqual(female, male);
  } finally { log("stopping owned gateway"); if (child && child.exitCode === null && child.signalCode === null) { const closed = once(child, "close"); child.kill("SIGTERM"); await closed; } log("gateway closed"); await rm(root, { recursive: true, force: true }); }
});
