import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createNeuralSpeech, isLoopbackSafe } from "../src/plugins/speech-service/index.ts";
import { createPithWebServer } from "../src/shells/web/server.ts";

const close = (server: Server) => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
const listen = async (server: Server) => { await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve)); const address = server.address(); assert.ok(address && typeof address !== "string"); return `http://127.0.0.1:${address.port}`; };

for (const provider of ["whisper-local", "sensevoice-local"] as const) {
  test(`${provider} uses configured OpenAI-compatible endpoint and model, while preserving raw legacy requests`, async () => {
    const dir = await mkdtemp(join(tmpdir(), "pith-local-asr-"));
    const calls: { url: string; type: string; body: Buffer }[] = [];
    const engine = createServer(async (req, res) => {
      const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
      calls.push({ url: req.url!, type: req.headers["content-type"] || "", body: Buffer.concat(chunks) });
      if (req.url === "/html/v1/audio/transcriptions" || req.url === "/html/transcribe") { res.writeHead(200, { "content-type": "text/html" }); res.end("<html>not a transcript</html>"); return; }
      res.writeHead(req.url === "/reject/v1/audio/transcriptions" || req.url === "/custom/health" ? 404 : 200, { "content-type": "application/json" }); res.end('{"text":"recognized"}');
    });
    const endpoint = await listen(engine);
    let app: Server | undefined;
    try {
      app = await createPithWebServer({ workspaceDir: dir }); let address = app.address(); assert.ok(address && typeof address !== "string"); let base = `http://127.0.0.1:${address.port}`;
      const post = (path: string, value: unknown) => fetch(base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(value) });
      const speech = { asrProvider: provider, asrLoopbackUrl: `${endpoint}/custom/v1/audio/transcriptions`, asrModel: "local-model-42" };
      assert.equal((await post("/api/settings", { speech })).status, 200);
      const audio = Buffer.from([0, 1, 2, 255]);
      const result = await post("/api/speech/transcribe", { audio: audio.toString("base64"), mimeType: "audio/wav" });
      assert.equal(result.status, 200); assert.equal((await result.json()).text, "recognized");
      assert.equal(calls[0]!.url, "/custom/v1/audio/transcriptions"); assert.match(calls[0]!.type, /^multipart\/form-data; boundary=/);
      const form = await new Request("http://localhost/", { method: "POST", headers: { "content-type": calls[0]!.type }, body: calls[0]!.body }).formData();
      assert.equal(form.get("model"), "local-model-42"); const file = form.get("file"); assert.ok(file instanceof File); assert.equal(file.type, "audio/wav"); assert.deepEqual(Buffer.from(await file.arrayBuffer()), audio);
      const countBeforeHealth = calls.length; const health = await (await fetch(base + "/api/speech/presets")).json(); assert.equal(health.asrHealth.ok, false); assert.match(health.asrHealth.note, /未验证/); assert.equal(calls.length, countBeforeHealth);
      await close(app); app = await createPithWebServer({ workspaceDir: dir }); address = app.address(); assert.ok(address && typeof address !== "string"); base = `http://127.0.0.1:${address.port}`;
      assert.equal((await post("/api/speech/transcribe", { audio: audio.toString("base64"), mimeType: "audio/wav" })).status, 200);
      assert.equal(calls.at(-1)!.url, "/custom/v1/audio/transcriptions"); assert.match(calls.at(-1)!.body.toString(), /name="model"\r\n\r\nlocal-model-42\r\n/);
      assert.equal((await post("/api/settings", { speech: { ...speech, asrLoopbackUrl: `${endpoint}/legacy`, asrModel: "" } })).status, 200);
      assert.equal((await post("/api/speech/transcribe", { audio: audio.toString("base64"), mimeType: "audio/wav" })).status, 200);
      assert.equal(calls.at(-1)!.url, "/legacy/transcribe"); assert.equal(calls.at(-1)!.type, "audio/wav"); assert.deepEqual(calls.at(-1)!.body, audio);
      assert.equal((await post("/api/settings", { speech: { ...speech, asrLoopbackUrl: `${endpoint}/legacy` } })).status, 200);
      const count = calls.length; const unsupported = await post("/api/speech/transcribe", { audio: audio.toString("base64") });
      assert.equal(unsupported.status, 503); assert.match((await unsupported.json()).error, /v1\/audio\/transcriptions/); assert.equal(calls.length, count);
      assert.equal((await post("/api/settings", { speech: { ...speech, asrLoopbackUrl: `${endpoint}/reject/v1/audio/transcriptions` } })).status, 200);
      const rejected = await post("/api/speech/transcribe", { audio: audio.toString("base64") });
      assert.equal(rejected.status, 503); assert.match((await rejected.json()).error, /HTTP 404/); assert.equal(calls.length, count + 1); assert.equal(calls.at(-1)!.url, "/reject/v1/audio/transcriptions");
      for (const [asrLoopbackUrl, asrModel] of [[`${endpoint}/html/v1/audio/transcriptions`, "custom"], [`${endpoint}/html`, ""]]) {
        assert.equal((await post("/api/settings", { speech: { ...speech, asrLoopbackUrl, asrModel } })).status, 200);
        const html = await post("/api/speech/transcribe", { audio: audio.toString("base64") }); assert.equal(html.status, 503); assert.match((await html.json()).error, /Invalid transcription response/);
      }
    } finally { if (app) await close(app); await close(engine); await rm(dir, { recursive: true, force: true }); }
  });
}

test("local ASR defaults are provider-specific and unsafe endpoints fail closed", async () => {
  let calls = 0;
  const host = { id: "memory" as const, storage: {} as import("../src/core/index.ts").WorkspaceStoragePort, http: { request: async () => { calls++; throw new Error("unexpected request"); } } };
  const config = { ttsProvider: "kokoro-local" as const, ttsEndpoint: "", ttsVoice: "", azureRegion: "", asrProvider: "whisper-local" as const, asrLoopbackUrl: "", rate: 1 };
  assert.equal(createNeuralSpeech(host, config, isLoopbackSafe).asrEndpoint, "http://localhost:8765");
  assert.equal(createNeuralSpeech(host, { ...config, asrProvider: "sensevoice-local" }, isLoopbackSafe).asrEndpoint, "http://127.0.0.1:8766");
  for (const provider of ["whisper-local", "sensevoice-local"] as const) {
    const speech = createNeuralSpeech(host, { ...config, asrProvider: provider, asrLoopbackUrl: "http://192.168.1.1/v1/audio/transcriptions", asrModel: "test" }, isLoopbackSafe);
    await assert.rejects(speech.transcribeAudio(new Uint8Array([1])), /Unsafe local endpoint/);
  }
  assert.equal(calls, 0);
});
