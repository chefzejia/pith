import assert from "node:assert/strict";
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
