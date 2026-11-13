import { createInterface } from "node:readline";

const attempt = Number(process.env.PITH_FIXTURE_ATTEMPT);
const outcomes = (process.env.PITH_FIXTURE_OUTCOMES || "failed,failed,completed").split(",");
let mcp, prompt;
const emit = (request, result) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }) + "\n");
async function call(name, args) {
  const response = await fetch(mcp.url, { method: "POST", headers: Object.fromEntries(mcp.headers.map(header => [header.name, header.value])), body: JSON.stringify({ jsonrpc: "2.0", id: attempt, method: "tools/call", params: { name, arguments: args } }) });
  return response.json();
}
createInterface({ input: process.stdin }).on("line", async line => {
  try {
    const request = JSON.parse(line);
    if (request.method === "initialize") emit(request, { agentCapabilities: { mcpCapabilities: { http: true } } });
    if (request.method === "session/new") { mcp = request.params.mcpServers[0]; emit(request, { sessionId: "audit-controlled-process" }); }
    if (request.method === "session/prompt") {
      prompt = request;
      if (attempt === 1) await call("pith_settle_topic", { verificationSummary: "受控协议：用户已给出证据", observations: [{ text: "审计夹具：保留的观察一" }, { text: "审计夹具：对照观察二" }] });
      else if (outcomes[attempt - 1] !== "completed") await call("pith_save_note", { body: `审计夹具：第 ${attempt} 次请求新增笔记` });
      const outcome = outcomes[attempt - 1] ?? "completed";
      if (outcome === "failed") process.exit(23);
      if (outcome === "completed") emit(request, { text: "受控协议重试完成，本次没有调用写工具。", stopReason: "end_turn" });
      // A stopped attempt waits for the product's session/cancel, with no timer.
    }
    if (request.method === "session/cancel" && prompt) emit(prompt, { stopReason: "cancelled" });
  } catch (error) { process.stderr.write(String(error) + "\n"); process.exit(24); }
});
