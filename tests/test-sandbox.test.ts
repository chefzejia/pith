import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createInterface } from "node:readline";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import test from "node:test";
import { NodeManagedSpeechRuntime } from "../src/shells/speech/speechRuntime.ts";

test("test processes resolve the home directory and the managed speech runtime inside a throwaway sandbox", async () => {
  const home = process.env.HOME ?? "";
  assert.match(basename(home), /^pith-test-home-/, "run tests through npm test or npm run test:file");
  assert.equal(dirname(home), tmpdir());
  assert.equal(homedir(), home);
  assert.equal(process.env.PITH_SPEECH_HOME, join(home, "speech"));
  const state = await new NodeManagedSpeechRuntime().getState();
  assert.equal(state.status, "not-installed");
  if (state.supported) assert.equal(state.installDir, join(home, "speech", "managed-v2"));
});

test("test process removes its own home on exit, failure and handled signals", async () => {
  for (const mode of ["exit", "failure", "SIGINT", "SIGTERM"] as const) {
    const action = mode === "exit" ? "process.exit(0)" : mode === "failure" ? "process.exit(7)" : "process.stdin.resume()";
    const child = spawn(process.execPath, ["--experimental-strip-types", "--import", "./tests/setup.ts", "-e", `console.log(process.env.HOME); ${action}`], { stdio: ["pipe", "pipe", "pipe"] });
    const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code, signal) => resolve({ code, signal }));
    });
    const lines = createInterface({ input: child.stdout });
    let home = "";
    try {
      for await (const line of lines) { home = line; break; }
      assert.match(basename(home), /^pith-test-home-/);
      if (mode === "SIGINT" || mode === "SIGTERM") {
        assert.equal(existsSync(home), true);
        assert.equal(child.kill(mode), true);
      }
      const result = await exited;
      assert.deepEqual(result, mode === "SIGINT" || mode === "SIGTERM" ? { code: null, signal: mode } : { code: mode === "exit" ? 0 : 7, signal: null });
      assert.equal(existsSync(home), false, `${mode} left ${home}`);
    } finally {
      lines.close();
      if (child.exitCode === null && child.signalCode === null) { child.kill("SIGKILL"); await exited; }
    }
  }
});
