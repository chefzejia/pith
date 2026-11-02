import test from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPithWebServer } from "../src/shells/web/server.ts";

async function close(server: Server): Promise<void> { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", () => resolve()); });
  const address = server.address(); assert.ok(address && typeof address !== "string"); return `http://127.0.0.1:${address.port}`;
}

test("source forbids operating-system speech and recognition APIs", async () => {
  const visit = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) assert.doesNotMatch(await readFile(path, "utf8"), /speechSynthesis|SpeechSynthesisUtterance|webkitSpeechRecognition|\bSpeechRecognition\b/, path);
    }
  };
  await visit(join(process.cwd(), "src"));
});

test("web workbench fails closed, connects a local speech engine, and imports subtitles", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pith-wave4b-"));
  const engine = createServer((req, res) => {
    if (req.url === "/health") { res.writeHead(200); res.end("ok"); return; }
    if (req.url === "/v1/audio/speech") { res.writeHead(200, { "content-type": "audio/mpeg" }); res.end(Buffer.from([1, 2, 3, 4])); return; }
    if (req.url === "/transcribe") { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ text: "跟读结果" })); return; }
    res.writeHead(404); res.end();
  });
  const engineBase = await listen(engine);
  const app = await createPithWebServer({ workspaceDir: dir, port: 0 });
  try {
    const address = app.address(); assert.ok(address && typeof address !== "string");
    const base = `http://127.0.0.1:${address.port}`;
    const post = (path: string, value: unknown) => fetch(base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(value) });
    let response = await post("/api/settings", { speech: { ttsProvider: "kokoro-local", ttsEndpoint: "http://127.0.0.1:1/v1/audio/speech" } }); assert.equal(response.status, 200);
    response = await post("/api/speech/synthesize", { text: "测试。" }); assert.equal(response.status, 503); assert.match((await response.json()).error, /设置/);
    response = await post("/api/settings", { speech: { ttsProvider: "kokoro-local", ttsEndpoint: `${engineBase}/v1/audio/speech`, asrProvider: "whisper-local", asrLoopbackUrl: engineBase } }); assert.equal(response.status, 200);
    response = await post("/api/speech/synthesize", { text: "测试。" }); assert.equal(response.status, 200); assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [1, 2, 3, 4]);
    response = await post("/api/speech/transcribe", { audio: Buffer.from("audio").toString("base64"), mimeType: "audio/webm" }); assert.equal(response.status, 200); assert.equal((await response.json()).text, "跟读结果");
    const presets = await (await fetch(base + "/api/speech/presets")).json(); assert.equal(presets.ttsHealth.ok, true); assert.equal(presets.asrHealth.ok, true);
    response = await post("/api/topics", { title: "课题" }); assert.equal(response.status, 201); const topic = await response.json();
    response = await post("/api/materials", { title: "字幕", kind: "media", topicId: topic.id, files: [{ name: "test.vtt", mimeType: "text/vtt", data: Buffer.from("WEBVTT\n\n00:00:01.000 --> 00:00:03.000\n第一句。\n").toString("base64") }] }); assert.equal(response.status, 201); const material = await response.json();
    response = await fetch(`${base}/api/materials/${material.id}/file?name=test.vtt`); assert.equal(response.status, 200); const document = await response.json(); assert.match(document.html, /pith-timeline-stage/); assert.match(document.html, /pith-cue/); assert.match(document.html, /第一句/);
    const state = await (await fetch(base + "/api/state")).json(); assert.equal(state.compass.exploring[0].materialId, material.id);
    response = await post(`/api/topics/${topic.id}/toolkits`, { toolkits: ["shadowing"] }); assert.equal(response.status, 200);
    response = await post("/api/settings", { speech: { ttsProvider: "kokoro-local", ttsEndpoint: "http://127.0.0.1:1/v1/audio/speech" } }); assert.equal(response.status, 200);
    response = await post("/api/speech/synthesize", { text: "不应使用旧端点。" }); assert.equal(response.status, 503);
  } finally { await close(app); await close(engine); await rm(dir, { recursive: true, force: true }); }
});
