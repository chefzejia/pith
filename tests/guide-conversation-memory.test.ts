import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DefaultAttentionEngine, DefaultWorkspaceStore, type AgentProcessPort, type AgentStdioHandle, type DiscoveredAgentDescriptor, type GuideConversationEntry } from "../src/core/index.ts";
import { practiceMessage } from "../src/plugins/toolkit-feynman/index.ts";
import { HISTORY_ELISION, HISTORY_MAX_ENTRIES, HISTORY_MAX_ENTRY_CHARS, HISTORY_MAX_TOTAL_CHARS, selectConversationHistory } from "../src/plugins/guide-acp/conversationMemory.ts";
import { LocalAcpGuideProvider, buildScenePrompt } from "../src/plugins/guide-acp/index.ts";
import { NodeWorkspaceStorage } from "../src/shells/web/nodeStorage.ts";

const descriptor: DiscoveredAgentDescriptor = { id: "dsh", label: "fixture", command: "/fixture/dsh", args: [], available: true, version: null, note: "fixture" };

/** Scripted ACP agent at the process boundary: each `session/prompt` records its prompt text and returns the next reply. */
function scriptedAgent(): { port: AgentProcessPort; prompts: string[]; replies: string[] } {
  const prompts: string[] = [], replies: string[] = [];
  const port: AgentProcessPort = {
    findExecutable: async () => null,
    probeExecutable: async () => null,
    async spawnStdio(): Promise<AgentStdioHandle> {
      const listeners = new Set<(line: string) => void>();
      const handle: AgentStdioHandle & { cwd: string } = {
        cwd: "/sandbox",
        onLine(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
        writeLine(line) {
          const request = JSON.parse(line) as { id?: number; method: string; params: { prompt?: { text: string }[] } };
          if (request.id === undefined) return;
          let result: unknown = {};
          if (request.method === "session/new") result = { sessionId: "fixture" };
          if (request.method === "session/prompt") { prompts.push(request.params.prompt![0]!.text); result = { text: replies.shift() ?? "" }; }
          for (const listener of listeners) listener(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }));
        },
        async close() {},
      };
      return handle;
    },
  };
  return { port, prompts, replies };
}

/** Real store, real engine and real provider; only the agent process is scripted. */
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "pith-guide-memory-"));
  const storage = new NodeWorkspaceStorage(dir), store = new DefaultWorkspaceStore(storage);
  await store.ensureScaffold();
  const topic = await store.createTopic({ title: "宿主边界" });
  const agent = scriptedAgent();
  let provider: LocalAcpGuideProvider | undefined;
  const engine = new DefaultAttentionEngine(store, storage, () => provider);
  provider = new LocalAcpGuideProvider({ processPort: agent.port, store, engine, storage, getAgentConfig: () => ({ agentId: "dsh" }), resolveDescriptor: async () => descriptor, buildScenePrompt });
  return { dir, engine, topicId: topic.id, prompts: agent.prompts, replies: agent.replies };
}

const occurrences = (text: string, part: string): number => text.split(part).length - 1;
const points = (text: string): number => Array.from(text).length;
const loneSurrogate = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
const entry = (role: "user" | "guide", text: string, choices?: string[]): GuideConversationEntry => ({ id: crypto.randomUUID(), role, text, ...(choices ? { choices } : {}), createdAt: "2026-11-11T00:00:00.000Z" });

/** The history section, which sits directly before the current message with no other heading in between. */
function historySection(prompt: string): string {
  const start = prompt.indexOf("# 近期对话"), end = prompt.indexOf("# 学习者问题");
  assert.ok(start >= 0 && end > start, "the history section precedes the current message");
  const section = prompt.slice(start, end);
  assert.equal(occurrences(section, "\n# "), 0, "no other section sits between the history and the current message");
  return section;
}

test("a guide turn carries the earlier turns of the topic and states the current message once", async () => {
  const f = await fixture();
  try {
    f.replies.push("HostPort 是内核与宿主之间的窄边界。那么它为什么不能直接导入 node:fs？\n\n```pith-choices\n- 我来回答\n- 给我一个提示\n```", "对，这正是宿主零泄漏。");
    await f.engine.sendMessage({ topicId: f.topicId, text: "先解释 HostPort 是什么" });
    await f.engine.sendMessage({ topicId: f.topicId, text: "因为内核必须与宿主无关" });
    assert.equal(f.prompts.length, 2);

    assert.equal(occurrences(f.prompts[0]!, "# 近期对话"), 0, "the first turn of a topic has no history section");
    assert.equal(occurrences(f.prompts[0]!, "先解释 HostPort 是什么"), 1);

    const history = historySection(f.prompts[1]!);
    const asked = history.indexOf("学习者：先解释 HostPort 是什么");
    const answered = history.indexOf("向导：HostPort 是内核与宿主之间的窄边界。那么它为什么不能直接导入 node:fs？");
    assert.ok(asked >= 0 && answered > asked, history);
    assert.match(history, /我来回答；给我一个提示/);
    assert.doesNotMatch(history, /pith-choices/);
    assert.equal(occurrences(f.prompts[1]!, "因为内核必须与宿主无关"), 1);
    assert.ok(f.prompts[1]!.indexOf("因为内核必须与宿主无关") > f.prompts[1]!.indexOf("# 学习者问题"));
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});

test("the read-tool follow-up prompt of one turn keeps the earlier turns", async () => {
  const f = await fixture();
  try {
    f.replies.push("第一轮回答。你能举一个反例吗？", `先读取课题。\n\n\`\`\`pith-tool\n${JSON.stringify({ name: "pith_get_context", arguments: { topicId: f.topicId } })}\n\`\`\``, "读完了，这个反例成立。");
    await f.engine.sendMessage({ topicId: f.topicId, text: "开始吧" });
    const second = await f.engine.sendMessage({ topicId: f.topicId, text: "反例是只有一个宿主的时候" });
    assert.equal(f.prompts.length, 3);
    assert.match(f.prompts[2]!, /上一轮只读工具结果/);
    assert.match(historySection(f.prompts[2]!), /向导：第一轮回答。你能举一个反例吗？/);
    assert.equal(second.guideEntry?.text, "读完了，这个反例成立。");
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});

test("a practice submission appears in later turns as the learner's own words", async () => {
  const f = await fixture();
  try {
    f.replies.push("主干抓住了。它成立的前提是什么？", "对。");
    await f.engine.sendMessage({ topicId: f.topicId, text: practiceMessage("HostPort 把宿主能力注入内核", "费曼复述", "指出前提并给出反例") });
    await f.engine.sendMessage({ topicId: f.topicId, text: "前提是内核不导入宿主包" });
    const history = historySection(f.prompts[1]!);
    assert.match(history, /学习者：HostPort 把宿主能力注入内核/);
    assert.doesNotMatch(history, /指出前提并给出反例/);
    assert.doesNotMatch(f.prompts[1]!, /PITH_PRACTICE:/);
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});

test("history excludes the current message and keeps the newest turns within the entry, per-turn and total budgets", () => {
  const current = entry("user", "current");
  const many = Array.from({ length: 30 }, (_, index) => entry(index % 2 ? "guide" : "user", `turn-${index}`));
  const kept = selectConversationHistory([...many, current], current);
  assert.equal(kept.length, HISTORY_MAX_ENTRIES);
  assert.deepEqual(kept.map(turn => turn.text), many.slice(-HISTORY_MAX_ENTRIES).map(item => item.text));
  assert.deepEqual(kept.map(turn => turn.role), many.slice(-HISTORY_MAX_ENTRIES).map(item => item.role));
  assert.deepEqual(selectConversationHistory(many.slice(0, 2), undefined).map(turn => turn.text), ["turn-0", "turn-1"]);
  assert.deepEqual(selectConversationHistory([current], current), []);
  assert.deepEqual(selectConversationHistory([entry("guide", "  "), entry("user", "kept"), current], current).map(turn => turn.text), ["kept"]);

  const long = Array.from({ length: 9 }, (_, index) => entry("user", `H${index}${"x".repeat(3000)}T${index}`));
  const budgeted = selectConversationHistory([...long, current], current);
  assert.equal(budgeted.length, HISTORY_MAX_TOTAL_CHARS / HISTORY_MAX_ENTRY_CHARS);
  assert.deepEqual(budgeted.map(turn => turn.text.slice(0, 2)), ["H3", "H4", "H5", "H6", "H7", "H8"]);
  for (const [index, turn] of budgeted.entries()) {
    assert.equal(points(turn.text), HISTORY_MAX_ENTRY_CHARS);
    assert.ok(turn.text.includes(HISTORY_ELISION));
    assert.ok(turn.text.endsWith(`T${index + 3}`), "an over-long turn keeps its end");
  }

  const small = entry("user", "s".repeat(50)), blocker = entry("guide", "b".repeat(2000));
  const tail = [...Array.from({ length: 5 }, () => entry("user", "y".repeat(2000))), entry("guide", "z".repeat(1900))];
  const contiguous = selectConversationHistory([small, blocker, ...tail, current], current);
  assert.equal(contiguous.length, tail.length, "selection stops at the first turn that exceeds the total budget");

  const emoji = selectConversationHistory([entry("guide", "😀".repeat(3000)), current], current)[0]!.text;
  assert.equal(points(emoji), HISTORY_MAX_ENTRY_CHARS);
  assert.doesNotMatch(emoji, loneSurrogate);
});

test("only the latest guide turn lists the choices it offered", () => {
  const current = entry("user", "第二个");
  const turns = selectConversationHistory([entry("guide", "更早的问题", ["甲", "乙"]), entry("user", "回答"), entry("guide", "最近的问题", ["丙", "丁"]), current], current);
  assert.deepEqual(turns.map(turn => turn.text), ["更早的问题", "回答", "最近的问题\n（当时给出的选项：丙；丁）"]);
});

test("the scene prompt renders the history section only when earlier turns exist", () => {
  const topic = { id: "t", title: "T", target: "", status: "exploring" as const, toolkits: [], notes: [], createdAt: "", updatedAt: "" };
  const base = { profileMarkdown: "# ME", topic, userMessage: "当前消息" };
  assert.equal(occurrences(buildScenePrompt(base), "# 近期对话"), 0);
  assert.equal(occurrences(buildScenePrompt({ ...base, conversation: [] }), "# 近期对话"), 0);
  const section = historySection(buildScenePrompt({ ...base, conversation: [{ role: "user", text: "问" }, { role: "guide", text: "答" }] }));
  assert.ok(section.indexOf("学习者：问") < section.indexOf("向导：答"));
});
