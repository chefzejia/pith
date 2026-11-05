import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { createNeuralSpeech } from "../src/plugins/speech-service/neuralSpeech.ts";
import { isLoopbackSafe } from "../src/plugins/speech-service/index.ts";
import { NodeManagedSpeechRuntime } from "../src/shells/speechRuntime.ts";
import { NodeHttpPort } from "../src/shells/web/nodeHttp.ts";
import { NodeWorkspaceStorage } from "../src/shells/web/nodeStorage.ts";
import { testSandbox } from "./sandbox.ts";

test("managed speech rejects Vault paths and preserves unowned directories", async () => {
  const dir = await testSandbox("pith-speech-boundary-");
  try {
    const vault = join(dir, "vault"); await mkdir(vault);
    const inside = new NodeManagedSpeechRuntime({ home: vault, protectedRoot: vault });
    await assert.rejects(inside.install(), /Vault/);
    const external = join(dir, "external"), managed = join(external, "managed-v1"); await mkdir(managed, { recursive: true }); await writeFile(join(managed, "unrelated"), "preserve");
    const runtime = new NodeManagedSpeechRuntime({ home: external, protectedRoot: vault });
    await assert.rejects(runtime.install()); await runtime.remove();
    assert.equal(await readFile(join(managed, "unrelated"), "utf8"), "preserve");
    const broken = join(dir, "broken", "managed-v1"); await mkdir(broken, { recursive: true }); await writeFile(join(broken, ".owner"), "pith-managed-speech-v1"); await writeFile(join(broken, "installed"), "pith-sherpa-1.12.40-v1");
    const incomplete = new NodeManagedSpeechRuntime({ home: join(dir, "broken") }); assert.equal((await incomplete.getState()).status, "failed"); await assert.rejects(incomplete.ensureRunning()); assert.equal((await incomplete.remove()).status, "not-installed");
  } finally { await rm(dir, { recursive: true, force: true }); }
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
    await first.stop(); assert.equal((await first.getState()).status, "stopped");
    assert.equal((await fetch(new URL("/health", other.endpoint!))).status, 200);
    await first.ensureRunning(); const deadline = Date.now() + 10000;
    while ((await first.getState()).status === "running" && Date.now() < deadline) await delay(100);
    assert.equal((await first.getState()).status, "stopped");
  } finally { await first.stop(); await second.stop(); await rm(dir, { recursive: true, force: true }); }
});
