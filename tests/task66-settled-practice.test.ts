import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import test from "node:test";
import { DefaultWorkspaceStore } from "../src/core/index.ts";
import { NodeWorkspaceStorage } from "../src/shells/web/nodeStorage.ts";
import { createPithWebServer } from "../src/shells/web/server.ts";
import { testSandbox } from "./sandbox.ts";

const source = "The cache requires a matching version.";
const produced = "Reuse requires a matching version.";
const points = [{ id: "p1", claim: "Version match", sourceQuote: source }];

for (const state of ["settled", "late", "shelved"] as const) {
  test(`Web Feynman practice persistence: ${state}`, { timeout: 10000 }, async () => {
    const root = await testSandbox("task66-practice-");
    const storage = new NodeWorkspaceStorage(root), store = new DefaultWorkspaceStore(storage);
    const topic = await store.createTopic({ title: "Cache", target: "Explain cache reuse", materialIds: [], toolkits: ["feynman"] });
    await store.writeLesson(topic.id, "lesson.md", `# Cache\n\n${source}`);
    let started!: () => void, release!: () => void;
    const comparing = new Promise<void>(resolve => { started = resolve; });
    const finished = new Promise<void>(resolve => { release = resolve; });
    let prompts = 0;
    const server = await createPithWebServer({ workspaceDir: root, promptService: { async prompt(text) {
      prompts++;
      if (text.includes("原文：")) return JSON.stringify({ points });
      started();
      if (state === "late") await finished;
      return JSON.stringify({ items: [{ id: "p1", status: "covered", quote: produced }] });
    } } });
    try {
      const address = server.address(); assert.ok(address && typeof address !== "string");
      const base = `http://127.0.0.1:${address.port}`;
      const post = (path: string, fields: object) => fetch(base + path, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ topicId: topic.id, ...fields }),
      });
      const save = (result?: unknown) => post("/api/notes", { kind: "practice", body: produced, anchor: { source: { kind: "lesson" }, file: "lesson.md", locator: "text:line:2", quote: source }, result });
      const rejectPractice = async (response: Response) => {
        assert.equal(response.ok, false, "settled topic must reject practice");
        assert.match((await response.json()).error, /已沉淀/);
      };
      if (state === "settled") {
        await store.updateTopic(topic.id, { status: "settled" });
        await Promise.all([
          post("/api/feynman/prepare", { source }).then(rejectPractice),
          post("/api/feynman/compare", { source, produced }).then(rejectPractice),
        ]);
        assert.equal(prompts, 0);
        await rejectPractice(await save());
      } else {
        if (state === "shelved") await store.updateTopic(topic.id, { status: "shelved" });
        const comparison = post("/api/feynman/compare", { source, produced });
        if (state === "late") {
          await Promise.race([comparing, comparison.then(() => assert.fail("comparison ended before settlement"))]);
          await store.updateTopic(topic.id, { status: "settled" });
          release();
        }
        const response = await comparison;
        assert.equal(response.status, 200);
        const result = await response.json();
        assert.equal(result.toolkit, "feynman");
        const write = await save(result);
        if (state === "late") {
          await rejectPractice(write);
          await rejectPractice(await save());
        } else assert.equal(write.status, 201);
      }
      const saved = (await store.getTopic(topic.id))!;
      assert.equal(saved.status, state === "shelved" ? "shelved" : "settled");
      assert.deepEqual(saved.notes.map(note => note.body), state === "shelved" ? [produced] : []);
    } finally {
      release();
      await new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); });
      await rm(root, { recursive: true, force: true });
    }
  });
}
