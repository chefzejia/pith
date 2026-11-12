import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { testSandbox } from "./sandbox.ts";

/**
 * Test-process sandbox, loaded through `--import` by the npm test scripts.
 * HOME and PITH_SPEECH_HOME point at one throwaway directory per test process, whatever the caller exported,
 * so no test reads or starts anything under the developer's real home directory.
 * A test that needs a specific home sets it inside the test and restores the sandbox value afterwards.
 */
const sandbox = mkdtempSync(join(tmpdir(), "pith-test-home-"));
const screenshots = await testSandbox("pith-test-screenshots-");
process.env.PITH_TEST_SCREENSHOT_DIR = screenshots;
process.env.HOME = sandbox;
process.env.PITH_SPEECH_HOME = join(sandbox, "speech");
const cleanup = () => { rmSync(sandbox, { recursive: true, force: true }); rmSync(screenshots, { recursive: true, force: true }); };
process.on("exit", cleanup);
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    cleanup();
    process.kill(process.pid, signal);
  });
}
