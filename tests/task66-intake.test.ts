import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import test from "node:test";
import { DefaultAttentionEngine, DefaultWorkspaceStore } from "../src/core/index.ts";
import { NodeWorkspaceStorage } from "../src/shells/web/nodeStorage.ts";
import { IntakeSession } from "../src/workbench/intake.ts";
import { testSandbox } from "./sandbox.ts";
import { intakeFailure, intakeMaterialFixture } from "./task66-intake-fixture.ts";

for (const status of ["completed", "failed", "stopped"] as const) {
  test(`intake publishes durable materials before a ${status} exit without a topic`, { timeout: 4000 }, async () => {
    const root = await testSandbox("task66-intake-");
    const storage = new NodeWorkspaceStorage(root), store = new DefaultWorkspaceStore(storage);
    const fixture = intakeMaterialFixture(store, storage);
    const engine = new DefaultAttentionEngine(store, storage, () => fixture.provider);
    const unused = async (): Promise<never> => { throw new Error("Unexpected direct import"); };
    const intake = new IntakeSession({ intake: (input, options) => engine.intake(input, options), importFiles: unused, importUrl: unused, importRepository: unused });
    const stop = new AbortController();
    let notifyRefresh!: () => void;
    const refreshed = new Promise<void>(resolve => { notifyRefresh = resolve; });
    let deadline: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<never>((_, reject) => {
      deadline = setTimeout(() => reject(new Error("No material refresh while the turn was running")), 2000);
    });
    let calls = 0, titles: string[] = [];
    const pending = intake.ask(status, { signal: stop.signal }, async () => {
      calls++;
      titles = (await engine.compass()).library.map(entry => entry.material.title);
      notifyRefresh();
    });
    try {
      await Promise.race([refreshed, pending.then(() => assert.fail("Turn ended before the material refresh")), timedOut]);
      assert.deepEqual(titles, [`Notes for ${status}`]);
      if (status === "stopped") stop.abort();
      else fixture.finish();
      const result = await pending;
      assert.equal(result.topic, null);
      assert.equal(result.turn.status, status);
      if (status === "failed") assert.equal(result.turn.error, intakeFailure);
      assert.equal(calls, 1, "terminal and repeated snapshots must not refresh the same material again");
    } finally {
      clearTimeout(deadline);
      stop.abort();
      await pending.catch(() => {});
      await rm(root, { recursive: true, force: true });
    }
  });
}
