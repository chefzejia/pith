import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import test from "node:test";
import { DefaultWorkspaceStore, type HttpResponseData } from "../src/core/index.ts";
import { createScopedTools } from "../src/plugins/guide-acp/tools.ts";
import type { PublicHttpPort } from "../src/plugins/guide-acp/externalIngest.ts";
import { NodeHttpPort } from "../src/shells/web/nodeHttp.ts";
import { NodeWorkspaceStorage } from "../src/shells/web/nodeStorage.ts";
import { testSandbox } from "./sandbox.ts";
import { pdfFixture } from "./task55-pdf-fixture.ts";

const encoder = new TextEncoder();
const publicIp = "93.184.216.34";

function response(body: string | Uint8Array, type: string, status = 200, location?: string): HttpResponseData {
  const bytes = typeof body === "string" ? encoder.encode(body) : body;
  return { status, headers: { "content-type": type, ...(location ? { location } : {}) }, bytes, text: () => new TextDecoder().decode(bytes) };
}

test("public redirects re-resolve and pin every hop, allow five hops, and name refused targets", async () => {
  const resolved: string[] = [], sent: { url: string; address: string }[] = [];
  const port = new NodeHttpPort({
    async resolve(hostname) { resolved.push(hostname); return [{ address: publicIp, family: 4 }]; },
    async send(url, address) {
      sent.push({ url: url.href, address: address.address });
      const index = Number(url.pathname.slice(1));
      return index < 5 ? response("", "text/plain", 301, `/${index + 1}`) : response("done", "text/plain");
    },
  });
  const result = await port.requestPublic({ url: "https://course.example.com/0" }, 1024);
  assert.equal(result.finalUrl, "https://course.example.com/5");
  assert.equal(sent.length, 6, "five redirects are followed, then the final response is read");
  assert.equal(resolved.length, 6, "DNS is resolved for each requested hop");
  assert.ok(sent.every(item => item.address === publicIp), "each request receives its resolved public address for pinning");

  const capped = new NodeHttpPort({
    async resolve() { return [{ address: publicIp, family: 4 }]; },
    async send(url) { return response("", "text/plain", 302, `/${Number(url.pathname.slice(1)) + 1}`); },
  });
  await assert.rejects(capped.requestPublic({ url: "https://course.example.com/0" }, 1024), /https:\/\/course\.example\.com\/6.*5 redirects/);

  let sentPrivate = 0;
  const privateDns = new NodeHttpPort({
    async resolve(hostname) { return [{ address: hostname === "private.example.net" ? "10.0.0.7" : publicIp, family: 4 }]; },
    async send() { sentPrivate++; return response("", "text/plain", 302, "https://private.example.net/resource"); },
  });
  await assert.rejects(privateDns.requestPublic({ url: "https://course.example.com/start" }, 1024), /https:\/\/private\.example\.net\/resource.*DNS resolved to a non-public address/);
  assert.equal(sentPrivate, 1, "the refused private target is never requested");

  let downgradeSends = 0;
  const downgrade = new NodeHttpPort({
    async resolve() { return [{ address: publicIp, family: 4 }]; },
    async send() { downgradeSends++; return response("", "text/plain", 301, "http://course.example.com/insecure"); },
  });
  await assert.rejects(downgrade.requestPublic({ url: "https://course.example.com/start" }, 1024), /http:\/\/course\.example\.com\/insecure.*downgrade/);
  assert.equal(downgradeSends, 1, "the HTTP downgrade is refused before DNS or a second request");
});

test("external reading resolves links from final URL and pretty-prints bounded JSON", async () => {
  const http: PublicHttpPort = {
    async request() { assert.fail("external content must use the public transport"); },
    async requestPublic(spec) {
      const path = new URL(spec.url).pathname;
      if (path === "/start") return { ...response('<main><a href="handouts/week-1.pdf">PDF</a></main>', "text/html"), finalUrl: "https://courses.example.net/catalog/current/" };
      if (path === "/catalog") return { ...response('{"course":{"id":66,"title":"Systems"}}', "application/vnd.catalog+json"), finalUrl: "https://api.learn.example.net/catalog" };
      return { ...response(JSON.stringify({ results: [{ description: "x".repeat(25000) }] }), "application/json"), finalUrl: "https://api.learn.example.net/large" };
    },
  };
  const tools = createScopedTools({ store: new DefaultWorkspaceStore({} as never), storage: {} as never, http, onChoices() {} });
  const read = tools.find(tool => tool.name === "pith_read_external")!;
  const page = await read.execute({ url: "https://courses.example.com/start" }) as { finalUrl: string; links: string[]; markdown: string };
  assert.equal(page.finalUrl, "https://courses.example.net/catalog/current/");
  assert.deepEqual(page.links, ["https://courses.example.net/catalog/current/handouts/week-1.pdf"]);

  const json = await read.execute({ url: "https://api.learn.example.net/catalog" }) as { finalUrl: string; markdown: string; truncated: boolean };
  assert.equal(json.finalUrl, "https://api.learn.example.net/catalog");
  assert.equal(json.markdown, '{\n  "course": {\n    "id": 66,\n    "title": "Systems"\n  }\n}');
  assert.equal(json.truncated, false);
  const large = await read.execute({ url: "https://api.learn.example.net/large" }) as { markdown: string; truncated: boolean };
  assert.equal(large.markdown.length, 24000);
  assert.equal(large.truncated, true);
});

test("redirected PDF imports retain final URL provenance, use its filename, and reject JSON", async () => {
  const root = await testSandbox("task66-external-");
  const storage = new NodeWorkspaceStorage(root), store = new DefaultWorkspaceStore(storage);
  const pdf = pdfFixture();
  const http: PublicHttpPort = {
    async request() { assert.fail("external content must use the public transport"); },
    async requestPublic(spec) {
      if (new URL(spec.url).pathname === "/json") return response('{"results":[]}', "application/json");
      return { ...response(pdf, "application/pdf"), finalUrl: "https://cdn.example.net/lectures/final-systems-exam.pdf" };
    },
  };
  const tools = createScopedTools({ store, storage, http, onChoices() {} });
  const ingest = tools.find(tool => tool.name === "pith_ingest_external")!;
  try {
    await assert.rejects(ingest.execute({ title: "Systems", urls: ["https://courses.example.com/json"] }), /Unsupported document type/);
    assert.deepEqual(await store.listMaterials(), [], "rejected JSON creates no material");

    const result = await ingest.execute({ title: "Systems", urls: ["https://courses.example.com/redirect.pdf"] }) as { material: { id: string; files: readonly { name: string }[] } };
    assert.deepEqual(result.material.files.map(file => file.name), ["final-systems-exam.pdf", "sources.md"]);
    const source = await storage.readText(`materials/${result.material.id}/files/sources.md`);
    assert.match(source, /https:\/\/cdn\.example\.net\/lectures\/final-systems-exam\.pdf/);
    assert.doesNotMatch(source, /courses\.example\.com/);
    assert.deepEqual(Buffer.from(await storage.readBinary(`materials/${result.material.id}/files/final-systems-exam.pdf`)), Buffer.from(pdf));
  } finally { await rm(root, { recursive: true, force: true }); }
});
