import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import type { ToolServerPort } from "../../core/index.ts";

export class NodeToolServerPort implements ToolServerPort {
  async open(handle: (requestBody: string) => Promise<string>) {
    const token = randomBytes(32).toString("hex"), expected = Buffer.from(token);
    const server = createServer(async (req, res) => {
      const value = req.headers["x-pith-token"];
      const actual = typeof value === "string" ? Buffer.from(value) : Buffer.alloc(0);
      if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) { res.writeHead(401); res.end(); return; }
      if (req.method !== "POST") { res.writeHead(405); res.end(); return; }
      try {
        let body = "";
        for await (const chunk of req) { body += String(chunk); if (body.length > 4_000_000) throw new Error("Request too large"); }
        const result = await handle(body);
        if (!result) { res.writeHead(202); res.end(); return; }
        res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" }); res.end(result);
      } catch { if (!res.headersSent) res.writeHead(500); res.end(); }
    });
    await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", () => { server.off("error", reject); resolve(); }); });
    const address = server.address();
    if (!address || typeof address === "string") { server.close(); throw new Error("Tool server address unavailable"); }
    return {
      url: `http://127.0.0.1:${address.port}/`,
      headers: [{ name: "x-pith-token", value: token }],
      close: () => new Promise<void>((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); server.closeIdleConnections(); }),
    };
  }
}
