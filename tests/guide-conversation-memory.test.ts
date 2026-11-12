import assert from "node:assert/strict";
import test from "node:test";
import type { GuideTurn } from "../src/core/index.ts";
import { HISTORY_ELISION, HISTORY_MAX_ENTRY_CHARS, HISTORY_MAX_TOTAL_CHARS, selectConversationHistory } from "../src/plugins/guide-acp/conversationMemory.ts";

const turn = (id: string, user: string, reply: string, choices: string[] = []): GuideTurn => ({ id, status: "completed", startedAt: "", user: { text: user }, steps: [{ kind: "thought", text: "private" }, { kind: "reply", markdown: reply }], choices });

test("history contains only recent messages and latest choices", () => {
  const history = selectConversationHistory([turn("1", "question 1", "answer 1", ["old"]), turn("2", "question 2", "answer 2", ["next", "review"])]);
  assert.deepEqual(history.map(item => item.role), ["user", "guide", "user", "guide"]);
  assert.equal(history[1]!.text, "answer 1");
  assert.match(history[3]!.text, /next；review/);
  assert.ok(history.every(item => !item.text.includes("private")));
});

test("history retains recent contiguous entries within entry and total budgets", () => {
  const long = `begin${"x".repeat(3000)}end`;
  const history = selectConversationHistory(Array.from({ length: 20 }, (_, i) => turn(String(i), `question ${i}`, long)));
  assert.ok(history.length <= 16);
  assert.ok(history.reduce((sum, item) => sum + Array.from(item.text).length, 0) <= HISTORY_MAX_TOTAL_CHARS);
  assert.ok(history.every(item => Array.from(item.text).length <= HISTORY_MAX_ENTRY_CHARS));
  assert.match(history.at(-1)!.text, /^begin/); assert.match(history.at(-1)!.text, /end$/);
  assert.ok(history.at(-1)!.text.includes(HISTORY_ELISION));
});
