import assert from "node:assert/strict";
import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { DefaultWorkspaceStore } from "../src/core/index.ts";
import { createScopedTools } from "../src/plugins/guide-acp/tools.ts";
import { openTurnTools } from "../src/plugins/guide-acp/mcpTools.ts";
import type { PublicHttpPort } from "../src/plugins/guide-acp/externalIngest.ts";
import { NodeWorkspaceStorage } from "../src/shells/web/nodeStorage.ts";
import { NodeToolServerPort } from "../src/shells/web/nodeToolServer.ts";
import { testSandbox } from "./sandbox.ts";
import { pdfFixture } from "./task55-pdf-fixture.ts";

const base = "https://courses.example.com";
const encoder = new TextEncoder(), mib = 1024 * 1024;
const pdf = pdfFixture();
const paddedPdf = (size: number) => { const bytes = new Uint8Array(size); bytes.set(pdf); return bytes; };
const fullPdf = paddedPdf(32 * mib);

function response(body: string | Uint8Array, type: string, status = 200) {
  const bytes = typeof body === "string" ? encoder.encode(body) : body;
  return { bytes, headers: { "content-type": type }, status, text: () => new TextDecoder().decode(bytes) };
}

test("course browsing is bounded and read-only; batch documents are atomic through MCP", async () => {
  const root = await testSandbox("task65-external-");
  const storage = new NodeWorkspaceStorage(root), store = new DefaultWorkspaceStore(storage);
  const requests: string[] = [];
  const http: PublicHttpPort = {
    async request() { assert.fail("unprotected transport"); },
    async requestPublic(spec, maxBytes, responseLimit) {
      const path = new URL(spec.url).pathname;
      requests.push(path);
      const result = path === "/course" ? response(`<title>Open Course</title><main><h1>Memory</h1><a href="/lecture/Week%201.pdf?x=1&amp;y=2">Lecture</a><a href=http://localhost/x>Local</a><p>${"a".repeat(23970)}🎓${"x".repeat(100)}</p></main>`, "text/html")
        : path === "/missing.pdf" ? response("Not found", "text/plain", 404)
        : path === "/redirect.pdf" ? response("Redirect", "text/plain", 302)
        : path === "/too-big.html" ? response(new Uint8Array(4 * mib + 1), "text/html")
        : path === "/too-big.pdf" ? response(paddedPdf(32 * mib + 1), "application/pdf")
        : path.startsWith("/full/") ? response(fullPdf, "application/pdf")
        : path === "/audio.mp3" ? response(new Uint8Array([1, 2, 3]), "audio/mpeg")
        : path.endsWith(".pdf") ? response(pdf, "application/pdf")
        : response("<main><h1>Exercises</h1></main>", "text/html");
      if (responseLimit && result.status === 200) assert.equal(responseLimit(result.headers), (result.headers["content-type"] === "application/pdf" ? 32 : 4) * mib);
      assert.ok(maxBytes <= 64 * mib);
      return result;
    },
  };
  const signal = new AbortController().signal;
  const steps: unknown[] = [];
  const topic = await store.createTopic({ title: "Memory", target: "How is memory located?", materialIds: [], toolkits: [] });
  const endpoint = await openTurnTools(new NodeToolServerPort(), createScopedTools({ store, storage, http, topicId: topic.id, onChoices() {} }), signal, (step, i) => { steps[i] = step; }, () => steps.length);
  let id = 0;
  async function call(name: string, args: object) {
    const res = await fetch(endpoint.endpoint.url, { method: "POST", headers: Object.fromEntries(endpoint.endpoint.headers.map(h => [h.name, h.value])), body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method: "tools/call", params: { name, arguments: args } }) });
    assert.ok(res.ok);
    const payload = await res.json();
    assert.ok(payload.result, JSON.stringify(payload));
    return { error: payload.result.isError, text: payload.result.content[0].text as string };
  }
  async function empty() {
    assert.deepEqual(await store.listMaterials(), [], "no material was written");
    assert.deepEqual(await readdir(join(root, "materials")), [], "no partial material directory");
    assert.deepEqual((await store.getTopic(topic.id))?.materialIds, [], "topic remains unchanged");
  }
  const ingest = (paths: string[]) => call("pith_ingest_external", { title: "Memory readings", urls: paths.map(path => base + path) });
  try {
    const read = await call("pith_read_external", { url: base + "/course" });
    assert.ok(!read.error, read.text);
    const page = JSON.parse(read.text);
    assert.equal(page.title, "Open Course");
    assert.match(page.markdown, /^# Memory/);
    assert.ok(page.markdown.length <= 24000);
    assert.equal(page.truncated, true);
    assert.deepEqual(page.links, [base + "/lecture/Week%201.pdf?x=1&y=2"]);
    assert.deepEqual(requests, ["/course"]);
    await empty();

    const before = requests.length;
    for (const args of [{ urls: [] }, { urls: Array(21).fill(base + "/exam") }, { urls: [base + "/exam", "http://localhost/"] }]) {
      const rejected = await call("pith_ingest_external", { title: "Rejected", ...args });
      assert.ok(rejected.error, rejected.text);
      assert.match(rejected.text, /1 to 20|not public/);
    }
    assert.equal(requests.length, before, "standard rejected inputs never reach the transport");
    for (const [paths, reason] of [
      [["/lecture/Week%201.pdf", "/missing.pdf"], /Link 2.*404/],
      [["/lecture/Week%201.pdf", "/redirect.pdf"], /Link 2.*302/],
      [["/too-big.html"], /size limit/],
      [["/too-big.pdf"], /size limit/],
      [["/full/1", "/full/2", "/full/3", "/full/4", "/exam"], /128 MB/],
    ] as const) {
      const rejected = await ingest([...paths]);
      assert.ok(rejected.error, rejected.text);
      assert.match(rejected.text, reason);
      await empty();
    }
    const longName = "06091d6bc417e4027b9f2ac48cb19c50_MIT6_004s09_tutor17_sol.pdf";
    const result = await ingest(["/lecture/Week%201.pdf", "/archive/Week%201.pdf", "/exer%3Acises", "/practice/" + longName]);
    assert.ok(!result.error, result.text);
    const [material] = await store.listMaterials();
    assert.ok(material);
    assert.equal(material.title, "Memory readings");
    assert.deepEqual(material.files.map(file => file.name), ["Week 1.pdf", "Week 1-2.pdf", "exer_cises.md", longName]);
    assert.deepEqual(Buffer.from(await storage.readBinary(`materials/${material.id}/files/Week 1.pdf`)), Buffer.from(pdf));
    assert.match(await storage.readText(`materials/${material.id}/files/exer_cises.md`), /# Exercises/);
    assert.deepEqual((await store.getTopic(topic.id))?.materialIds, [material.id]);
    const media = await call("pith_ingest_external", { kind: "media", url: base + "/audio.mp3", transcriptMarkdown: "Original transcript" });
    assert.ok(!media.error, media.text);
    assert.deepEqual(JSON.parse(media.text).material.files.map((file: { name: string }) => file.name), ["media.mp3", "transcript.md"]);
  } finally { await endpoint.drain(); await endpoint.endpoint.close(); await rm(root, { recursive: true, force: true }); }
});
