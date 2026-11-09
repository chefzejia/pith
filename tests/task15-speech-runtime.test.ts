import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { createNeuralSpeech } from "../src/plugins/speech-service/neuralSpeech.ts";
import { isLoopbackSafe } from "../src/plugins/speech-service/index.ts";
import { NodeManagedSpeechRuntime } from "../src/shells/speech/speechRuntime.ts";
import { NodeHttpPort } from "../src/shells/web/nodeHttp.ts";
import { NodeWorkspaceStorage } from "../src/shells/web/nodeStorage.ts";
import { testSandbox } from "./sandbox.ts";
import { createSpeechDownloadFixture } from "./task28-speech-fixture.ts";

test("managed speech rejects Vault paths and preserves unowned directories", async () => {
  const dir = await testSandbox("pith-speech-boundary-");
  try {
    const vault = join(dir, "vault"); await mkdir(vault);
    const inside = new NodeManagedSpeechRuntime({ home: vault, protectedRoot: vault });
    await assert.rejects(inside.install(), /Vault/);
    const external = join(dir, "external"), managed = join(external, "managed-v2"); await mkdir(managed, { recursive: true }); await writeFile(join(managed, "unrelated"), "preserve");
    const runtime = new NodeManagedSpeechRuntime({ home: external, protectedRoot: vault });
    await assert.rejects(runtime.install()); await runtime.remove();
    assert.equal(await readFile(join(managed, "unrelated"), "utf8"), "preserve");
    const broken = join(dir, "broken", "managed-v2"); await mkdir(broken, { recursive: true }); await writeFile(join(broken, ".owner"), "pith-managed-speech-v2"); await writeFile(join(broken, "installed"), "pith-sherpa-1.12.23-kokoro-sensevoice-v2");
    const incomplete = new NodeManagedSpeechRuntime({ home: join(dir, "broken") }); assert.equal((await incomplete.getState()).status, "failed"); await assert.rejects(incomplete.ensureRunning()); assert.equal((await incomplete.remove()).status, "not-installed");
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("managed speech reports a single pending install and retains its failure", async () => {
  const dir = await testSandbox("pith-speech-pending-");
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>(resolveGate => { release = resolveGate; });
  const started = new Promise<void>(resolveStarted => { entered = resolveStarted; });
  let calls = 0;
  const fixture = await createSpeechDownloadFixture(dir, { chunkMs: 0 });
  const runtime = new NodeManagedSpeechRuntime({ home: join(dir, "speech"), protectedRoot: join(dir, "vault"), archives: fixture.overrides, runInstallCommand: async () => { calls++; entered(); await gate; throw new Error("受控下载失败"); } });
  const results = Promise.allSettled([runtime.install(), runtime.install()]);
  try {
    await started;
    const pending = await runtime.getState();
    assert.equal(pending.status, "installing"); assert.match(pending.note, /正在校验与解压 Node 运行时/);
    assert.equal(calls, 1);
    release();
    assert.deepEqual((await results).map(result => result.status), ["rejected", "rejected"]);
    const state = await runtime.getState();
    assert.equal(state.status, "failed"); assert.match(state.note, /受控下载失败/);
    assert.equal(calls, 1);
    assert.equal((await runtime.remove()).status, "not-installed");
  } finally { release(); await results; await fixture.close(); await rm(dir, { recursive: true, force: true }); }
});

test("managed speech serves real TTS and ASR and stops only its own process", { timeout: 120000, skip: !process.env.PITH_SPEECH_TEST_HOME }, async () => {
  const root = resolve(process.env.PITH_SPEECH_TEST_HOME!);
  assert.ok(root.startsWith(resolve(".tmp") + sep), "real engine test must use .tmp");
  const first = new NodeManagedSpeechRuntime({ home: root, idleTimeoutSec: 2 }), second = new NodeManagedSpeechRuntime({ home: root, idleTimeoutSec: 30 });
  const dir = await testSandbox("pith-speech-live-");
  try {
    assert.equal((await first.getState()).status, "stopped");
    const [one, same] = await Promise.all([first.ensureRunning(), first.ensureRunning()]); assert.equal(one.endpoint, same.endpoint);
    const other = await second.ensureRunning(); assert.notEqual(one.endpoint, other.endpoint);
    const host = { id: "web" as const, storage: new NodeWorkspaceStorage(dir), http: new NodeHttpPort(), speechRuntime: first };
    const speech = createNeuralSpeech(host, { ttsProvider: "kokoro-local", ttsEndpoint: "", ttsVoice: "", asrProvider: "whisper-local", asrLoopbackUrl: "", azureRegion: "", rate: 1 }, isLoopbackSafe);
    const audio = await speech.synthesizeSpeech("Hello, this is a local speech test.");
    assert.equal(audio.mimeType, "audio/wav"); assert.equal(new TextDecoder().decode(audio.bytes.slice(0, 4)), "RIFF");
    assert.match((await speech.transcribeAudio(audio.bytes, "audio/wav")).text.toLowerCase(), /local speech test/);
    const chinese = await speech.synthesizeSpeech("你好，欢迎使用本地语音识别。");
    assert.equal(new TextDecoder().decode(chinese.bytes.slice(0, 4)), "RIFF");
    assert.ok(chinese.bytes.slice(44).some(byte => byte !== 0));
    const recognized = await speech.transcribeAudio(chinese.bytes, "audio/wav");
    assert.match(recognized.text, /你好|欢迎|本地/);
    const samples = join(root, "managed-v2", "sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17", "test_wavs");
    assert.match((await speech.transcribeAudio(await readFile(join(samples, "zh.wav")), "audio/wav")).text, /[\u4e00-\u9fff]/u);
    assert.match((await speech.transcribeAudio(await readFile(join(samples, "en.wav")), "audio/wav")).text, /[a-z]{3}/i);
    assert.match((await first.getState()).modelName!, /Kokoro-82M v1\.1.*SenseVoice/);
    await first.stop(); assert.equal((await first.getState()).status, "stopped");
    assert.equal((await fetch(new URL("/health", other.endpoint!))).status, 200);
    await first.ensureRunning(); const deadline = Date.now() + 10000;
    while ((await first.getState()).status === "running" && Date.now() < deadline) await delay(100);
    assert.equal((await first.getState()).status, "stopped");
  } finally { await first.stop(); await second.stop(); await rm(dir, { recursive: true, force: true }); }
});
