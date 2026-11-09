import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { once } from "node:events";
import { createRequire } from "node:module";
import test from "node:test";
import { build } from "esbuild";
import { getSpeechVoices, ZIPVOICE_DIRECTORY } from "../src/shells/speech/speechVoices.ts";
import { SPEECH_GATEWAY } from "../src/shells/speech/speechGateway.ts";
import { NodeManagedSpeechRuntime } from "../src/shells/speech/speechRuntime.ts";
import { testSandbox } from "./sandbox.ts";

test("ZipVoice offers preset voices without user reference audio", () => {
  const result = getSpeechVoices();
  assert.equal(result.defaultVoice, "中文女声");
  assert.deepEqual(result.voices.map(voice => voice.id), ["中文女声", "新闻女声"]);
  result.voices.length = 0;
  assert.equal(getSpeechVoices().voices.length, 2);
});

test("gateway maps voice names and numeric IDs with unknown fallback", { timeout: 30000 }, async () => {
  const root = await testSandbox("task30-gateway-"); let child: ReturnType<typeof spawn> | undefined;
  try {
    await mkdir(join(root, "node_modules/sherpa-onnx-node"), { recursive: true });
    await writeFile(join(root, "node_modules/sherpa-onnx-node/index.js"), `
exports.GenerationConfig = class { constructor(options) { Object.assign(this, options); } };
exports.readWave = file => ({ samples: new Float32Array([file.endsWith('news-female-2.wav') ? .02 : .01]), sampleRate: 24000 });
exports.OfflineTts = class {
  constructor(config) { if (!config.model.zipvoice.encoder.endsWith('encoder.int8.onnx') || !config.model.zipvoice.vocoder.endsWith('vocos_24khz.onnx')) throw Error('ZipVoice model required'); }
  generate({text, generationConfig: config}) {
    if (config.numSteps !== 8 || !config.referenceText || config.referenceSampleRate !== 24000 || !(config.referenceAudio instanceof Float32Array)) throw Error('Missing reference contract');
    return { samples: new Float32Array([text === 'loud' ? 2 : text === 'invalid' ? NaN : config.referenceAudio[0] * config.speed]), sampleRate: 24000 };
  }
};
`);
    const bundle = await build({ entryPoints: ["src/shells/speech/speechGateway.ts"], bundle: true, write: false, platform: "node", format: "cjs", target: "es2022" });
    const modulePath = join(root, "gateway-bundle.cjs"); await writeFile(modulePath, bundle.outputFiles[0]!.contents);
    const bundled = createRequire(import.meta.url)(modulePath) as { SPEECH_GATEWAY: string };
    await writeFile(join(root, "gateway.cjs"), bundled.SPEECH_GATEWAY);
    child = spawn(process.execPath, [join(root, "gateway.cjs")], { cwd: root, env: { PATH: "/usr/bin:/bin", HOME: root }, stdio: ["ignore", "pipe", "pipe"] });
    let stderr = ""; child.stderr!.on("data", chunk => { stderr += String(chunk); });
    const port = await new Promise<number>((ok, fail) => { let output = ""; child!.stdout!.on("data", chunk => { output += String(chunk); const match = /^(\d+)\r?\n/.exec(output); if (match) ok(Number(match[1])); }); child!.once("error", fail); child!.once("exit", (code, signal) => fail(new Error(`Gateway exited ${code}/${signal}: ${stderr}`))); });
    const synth = async (voice: string, input = "test", speed = 1) => { const response = await fetch(`http://127.0.0.1:${port}/v1/audio/speech`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ input, voice, speed }), signal: AbortSignal.timeout(5000) }); assert.equal(response.status, 200); return Buffer.from(await response.arrayBuffer()).readInt16LE(44); };
    assert.equal(await synth("中文女声"), Math.round(.01 * 32767));
    assert.equal(await synth("新闻女声"), Math.round(.02 * 32767));
    assert.equal(await synth("1"), Math.round(.02 * 32767));
    for (const legacy of ["alloy", "", "zf_084", "48", "999"]) assert.equal(await synth(legacy), Math.round(.01 * 32767));
    assert.equal(await synth("中文女声", "test", 1.5), Math.round(.015 * 32767));
    assert.equal(await synth("中文女声", "loud"), Math.round(.95 * 32767));
    const invalid = await fetch(`http://127.0.0.1:${port}/v1/audio/speech`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ input: "invalid" }) });
    assert.equal(invalid.status, 503);
    const voices = await (await fetch(`http://127.0.0.1:${port}/v1/audio/voices`)).json();
    assert.deepEqual(voices, { ok: true, ...getSpeechVoices() });

  } finally { if (child && child.exitCode === null && child.signalCode === null) { const closed = once(child, "close"); child.kill("SIGTERM"); await closed; } await rm(root, { recursive: true, force: true }); }
});

test("real ZipVoice presets change synthesized audio", { timeout: 180000, skip: !process.env.PITH_TASK30_SPEECH_ASSETS }, async () => {
  const source = resolve(process.env.PITH_TASK30_SPEECH_ASSETS!), root = await testSandbox("task30-real-"), managed = join(source, "managed-v2");
  const started = Date.now(), log = (message: string) => console.log(`[task30 ${Date.now() - started}ms] ${message}`);
  assert.ok(source.startsWith(resolve("../..") + "/") || source.includes("/.tmp/"));
  let child: ReturnType<typeof spawn> | undefined;
  try {
    log("reading voice presets"); const runtime = new NodeManagedSpeechRuntime({ home: source }); const result = await runtime.getVoices(); log(`metadata read: ${result.voices.length} voices`);
    assert.equal(result.voices.length, 2); assert.equal(result.defaultVoice, "中文女声");
    await symlink(join(managed, ZIPVOICE_DIRECTORY), join(root, ZIPVOICE_DIRECTORY), "dir");
    await symlink(join(managed, "node_modules"), join(root, "node_modules"), "dir");
    await writeFile(join(root, "gateway.cjs"), SPEECH_GATEWAY);
    child = spawn(join(managed, "bin/node"), [join(root, "gateway.cjs")], { cwd: root, env: { PATH: "/usr/bin:/bin", HOME: root, DYLD_LIBRARY_PATH: join(managed, "node_modules", `sherpa-onnx-${process.platform}-${process.arch}`), PITH_SPEECH_IDLE_SECONDS: "180" }, stdio: ["ignore", "pipe", "pipe"] });
    let stderr = ""; child.stderr!.on("data", chunk => { stderr += String(chunk); log(`gateway stderr: ${String(chunk).slice(0, 2000)}`); });
    child.once("exit", (code, signal) => log(`gateway exit code=${code} signal=${signal} stderr=${stderr.slice(-2000)}`));
    const port = await new Promise<number>((ok, fail) => { let output = ""; const timeout = setTimeout(() => fail(new Error(`Gateway startup timed out: ${stderr}`)), 30000); child!.stdout!.on("data", chunk => { output += String(chunk); const match = /^(\d+)\r?\n/.exec(output); if (match) { clearTimeout(timeout); ok(Number(match[1])); } }); child!.once("error", fail); child!.once("exit", () => { clearTimeout(timeout); fail(new Error(`Gateway exited: ${stderr}`)); }); });
    log(`gateway ready on ${port}`); const base = `http://127.0.0.1:${port}`;
    const voices = await (await fetch(`${base}/v1/audio/voices`, { signal: AbortSignal.timeout(30000) })).json() as typeof result; assert.equal(voices.voices.length, 2); log("voices response received");
    const health = await (await fetch(`${base}/health`, { signal: AbortSignal.timeout(30000) })).json() as typeof result; assert.equal(health.defaultVoice, "中文女声"); log("health response received");
    const synth = async (voice: string, input = "test", speed = 1) => { log(`speech ${voice} request`); const response = await fetch(`${base}/v1/audio/speech`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ input: "今天我们读一本书，慢慢理解其中的意思。", voice }), signal: AbortSignal.timeout(30000) }); log(`speech ${voice} headers ${response.status}`); if (!response.ok) throw new Error(`Speech request failed: ${await response.text()}`); const bytes = Buffer.from(await response.arrayBuffer()); log(`speech ${voice} read ${bytes.length} bytes`); assert.equal(bytes.subarray(0, 4).toString(), "RIFF"); return createHash("sha256").update(bytes).digest("hex"); };
    const first = await synth("中文女声"), second = await synth("新闻女声"); assert.notEqual(first, second);
  } finally { log("stopping owned gateway"); if (child && child.exitCode === null && child.signalCode === null) { const closed = once(child, "close"); child.kill("SIGTERM"); await closed; } log("gateway closed"); await rm(root, { recursive: true, force: true }); }
});
