import assert from "node:assert/strict";
import dns from "node:dns";
import { once } from "node:events";
import http, { createServer, type Server } from "node:http";
import { syncBuiltinESMExports } from "node:module";
import test from "node:test";

async function listen(server: Server): Promise<number> {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return address.port;
}

async function close(server: Server): Promise<void> {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}

test("ordinary HTTP requests retain the 30 second idle timeout", { timeout: 5000 }, async () => {
  const originalSetTimeout = http.ClientRequest.prototype.setTimeout;
  const configuredTimeouts: number[] = [];
  http.ClientRequest.prototype.setTimeout = function (timeout, callback) {
    configuredTimeouts.push(timeout);
    return originalSetTimeout.call(this, timeout === 30_000 ? 250 : timeout, callback);
  };
  const { NodeHttpPort } = await import("../src/shells/web/nodeHttp.ts");
  const server = createServer((req, res) => {
    if (req.url === "/stall") return;
    res.writeHead(200); res.write("start");
    let count = 0;
    const interval = setInterval(() => {
      res.write(".");
      if (++count === 40) res.end("end");
    }, 15);
    res.once("close", () => clearInterval(interval));
  });
  const port = await listen(server);
  try {
    const http = new NodeHttpPort();
    const stalled = assert.rejects(http.request({ url: `http://127.0.0.1:${port}/stall`, signal: AbortSignal.timeout(2000) }), /HTTP request timed out/);
    const started = performance.now();
    const response = await http.request({ url: `http://127.0.0.1:${port}` });
    assert.equal(response.status, 200);
    assert.match(response.text(), /^start\.+end$/);
    assert.ok(performance.now() - started > 250);
    await stalled;
    assert.deepEqual(configuredTimeouts, [30_000, 30_000]);
  } finally { await close(server); http.ClientRequest.prototype.setTimeout = originalSetTimeout; }
});

test("public HTTP hosts enforce explicit deadlines through DNS and response", { timeout: 5000 }, async () => {
  const dnsState: { finish?: () => void; pending?: Promise<{ address: string; family: number }[]> } = {};
  const originalLookup = dns.promises.lookup;
  const originalRequest = http.request;
  let requests = 0;
  let responseClosed: Promise<void> | undefined;
  const releaseDns = async () => {
    const finish = dnsState.finish; const pending = dnsState.pending;
    assert.ok(finish && pending);
    finish(); await pending;
    delete dnsState.finish; delete dnsState.pending;
  };
  dns.promises.lookup = ((hostname: string) => {
    if (hostname === "slow.example.com") {
      dnsState.pending = new Promise(resolve => { dnsState.finish = () => resolve([{ address: "8.8.8.8", family: 4 }]); });
      return dnsState.pending;
    }
    return Promise.resolve([{ address: hostname === "private.example.com" ? "127.0.0.1" : "8.8.8.8", family: 4 }]);
  }) as unknown as typeof dns.promises.lookup;
  http.request = ((url: URL, options: http.RequestOptions, callback: (res: http.IncomingMessage) => void) => {
    requests++;
    assert.equal(url.hostname, "example.com");
    return originalRequest(url, { ...options, lookup: (_hostname, _options, cb) => cb(null, "127.0.0.1", 4) }, callback);
  }) as typeof http.request;
  syncBuiltinESMExports();
  const server = createServer((req, res) => {
    if (req.url === "/error") {
      res.writeHead(503); res.write("error");
      responseClosed = new Promise(resolve => res.once("close", resolve));
      return;
    }
    const timer = setTimeout(() => res.end("ok"), 250);
    responseClosed = new Promise(resolve => res.once("close", () => { clearTimeout(timer); resolve(); }));
  });
  const port = await listen(server);
  try {
    const { NodeHttpPort } = await import("../src/shells/web/nodeHttp.ts");
    const { DshPublicHttpPort } = await import("../src/shells/dsh/index.ts");
    for (const host of [new DshPublicHttpPort(), new NodeHttpPort()]) {
      const url = `http://example.com:${port}/`;
      assert.equal((await host.requestPublic({ url }, 100)).text(), "ok");
      await assert.rejects(host.requestPublic({ url, timeoutMs: 50 }, 100), /timed out/i);
      assert.ok(responseClosed); await responseClosed;
      if (host instanceof DshPublicHttpPort) {
        await assert.rejects(host.request({ url, timeoutMs: 50 }), /timed out/i);
        assert.ok(responseClosed); await responseClosed;
      }
      const started = once(server, "request");
      const responseAbort = new AbortController();
      const waiting = host.requestPublic({ url, signal: responseAbort.signal }, 100);
      await started; responseAbort.abort();
      await assert.rejects(waiting, { name: "AbortError" });
      assert.ok(responseClosed); await responseClosed;
      await assert.rejects(host.requestPublic({ url: `${url}error`, timeoutMs: 1000 }, 100), /Public HTTP request rejected: 503/);
      assert.ok(responseClosed); await responseClosed;
      const count = requests;
      await assert.rejects(host.requestPublic({ url: `http://slow.example.com:${port}/`, timeoutMs: 50 }, 100), /timed out/i);
      await releaseDns();
      assert.equal(requests, count, "timed-out DNS must not start a request");
      const controller = new AbortController();
      const cancelled = host.requestPublic({ url: `http://slow.example.com:${port}/`, signal: controller.signal }, 100);
      assert.equal(typeof dnsState.finish, "function");
      controller.abort();
      await assert.rejects(cancelled, { name: "AbortError" });
      await releaseDns();
      assert.equal(requests, count, "cancelled DNS must not start a request");
      await assert.rejects(host.requestPublic({ url: `http://private.example.com:${port}/` }, 100), /non-public address/);
      assert.equal(requests, count);
      await assert.rejects(host.requestPublic({ url, timeoutMs: 0 }, 100), /Invalid HTTP timeout/);
    }
  } finally {
    if (dnsState.finish) dnsState.finish();
    await close(server);
    dns.promises.lookup = originalLookup;
    http.request = originalRequest;
    syncBuiltinESMExports();
  }
});
