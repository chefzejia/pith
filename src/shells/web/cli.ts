import { resolve } from "node:path";
import { createPithWebServer } from "./server.ts";

const port = Number(process.env.PORT ?? "4173");
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("Invalid PORT");
const server = await createPithWebServer({ workspaceDir: resolve(process.env.PITH_WORKSPACE ?? "workspace"), port });
const address = server.address();
if (!address || typeof address === "string") throw new Error("Server address unavailable");
console.log(`Pith: http://127.0.0.1:${address.port}`);
