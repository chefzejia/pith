import { execFileSync, spawn } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Runs the browser tests: every tests/*.test.ts that reads process.env.PITH_PLAYWRIGHT_MODULE, one file at a time, inside the test sandbox preload.
 * PITH_PLAYWRIGHT_MODULE and PITH_CHROME_PATH are used as given when set; otherwise conventional install locations are probed.
 * A missing Playwright module or Chrome binary ends the run with an error, so browser tests never skip unnoticed.
 * Arguments that name test files replace the default selection; every other argument goes to the Node test runner.
 * --list prints the selected files and exits without looking for a browser.
 */
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function isFile(path) {
  try { return statSync(path).isFile(); } catch (error) { if (error.code === "ENOENT" || error.code === "ENOTDIR") return false; throw error; }
}

function directories(path) {
  try { return readdirSync(path, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name); }
  catch (error) { if (error.code === "ENOENT" || error.code === "ENOTDIR") return []; throw error; }
}

function globalModules() {
  try { return execFileSync("npm", ["root", "-g"], { encoding: "utf8" }).trim(); }
  catch (error) { if (error.code === "ENOENT") return ""; throw error; }
}

function playwrightCandidates() {
  const global = globalModules();
  return [
    join(root, "node_modules/playwright/index.mjs"),
    ...(global ? [join(global, "playwright/index.mjs"), join(global, "@playwright/cli/node_modules/playwright/index.mjs"), join(global, "@playwright/test/node_modules/playwright/index.mjs")] : []),
  ];
}

function chromeCandidates() {
  const candidates = [];
  for (const cache of [join(homedir(), "Library/Caches/ms-playwright"), join(homedir(), ".cache/ms-playwright")]) {
    const builds = directories(cache).filter(name => /^chromium-\d+$/.test(name)).sort((a, b) => Number(b.slice(9)) - Number(a.slice(9)));
    for (const build of builds) {
      for (const platform of directories(join(cache, build))) {
        candidates.push(join(cache, build, platform, "chrome"));
        for (const app of directories(join(cache, build, platform)).filter(name => name.endsWith(".app"))) candidates.push(join(cache, build, platform, app, "Contents/MacOS", app.slice(0, -4)));
      }
    }
  }
  candidates.push("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome");
  return candidates;
}

function locate(variable, candidates) {
  const configured = process.env[variable];
  if (configured) return isFile(configured) ? { path: configured } : { searched: [`${variable}=${configured}`] };
  const found = candidates().find(isFile);
  return found ? { path: found } : { searched: candidates() };
}

const args = process.argv.slice(2).filter(arg => arg !== "--list");
const named = args.filter(arg => /\.test\.ts$/.test(arg));
const files = named.length ? named : readdirSync(join(root, "tests")).filter(name => name.endsWith(".test.ts") && readFileSync(join(root, "tests", name), "utf8").includes("process.env.PITH_PLAYWRIGHT_MODULE")).sort().map(name => `tests/${name}`);
if (process.argv.includes("--list")) { console.log(files.join("\n")); process.exit(0); }

const playwright = locate("PITH_PLAYWRIGHT_MODULE", playwrightCandidates);
const chrome = locate("PITH_CHROME_PATH", chromeCandidates);
if (!playwright.path || !chrome.path) {
  console.error("test-browser: browser tests need a Playwright module and a Chrome binary.");
  if (!playwright.path) console.error(`  Playwright module not found. Set PITH_PLAYWRIGHT_MODULE to playwright's index.mjs. Looked at:\n${playwright.searched.map(path => `    ${path}`).join("\n")}`);
  if (!chrome.path) console.error(`  Chrome binary not found. Set PITH_CHROME_PATH to a Chrome or Chromium executable. Looked at:\n${chrome.searched.map(path => `    ${path}`).join("\n")}`);
  process.exit(1);
}

function positiveMs(value, fallback, name) {
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    console.error(`test-browser: ${name} must be a positive number of milliseconds, got ${JSON.stringify(value)}`);
    process.exit(1);
  }
  return Math.floor(parsed);
}

function killProcessGroup(child, signal) {
  if (!child.pid) return;
  try {
    if (process.platform !== "win32") process.kill(-child.pid, signal);
    else child.kill(signal);
  } catch (error) {
    if (error?.code !== "ESRCH") throw error;
  }
}

function isProcessGroupAlive(pgid) {
  if (!pgid || process.platform === "win32") return false;
  try {
    process.kill(-pgid, 0);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") return false;
    if (error?.code === "EPERM") return true;
    throw error;
  }
}

const extraArgs = args.filter(arg => !named.includes(arg));
const testTimeoutMs = positiveMs(process.env.PITH_BROWSER_TEST_TIMEOUT_MS, 90_000, "PITH_BROWSER_TEST_TIMEOUT_MS");
const fileTimeoutMs = positiveMs(process.env.PITH_BROWSER_FILE_TIMEOUT_MS, 180_000, "PITH_BROWSER_FILE_TIMEOUT_MS");
const hasTestTimeout = extraArgs.some(arg => arg === "--test-timeout" || arg.startsWith("--test-timeout="));
const runnerTimeoutArgs = hasTestTimeout ? [] : [`--test-timeout=${testTimeoutMs}`];

console.error(`test-browser: ${files.length} files (test timeout ${hasTestTimeout ? "custom" : `${testTimeoutMs}ms`}, file timeout ${fileTimeoutMs}ms), playwright ${playwright.path}, chrome ${chrome.path}`);

let activeChild = null;
let interrupted = false;
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    interrupted = true;
    const exitCode = signal === "SIGINT" ? 130 : 143;
    if (!activeChild || !activeChild.pid) process.exit(exitCode);
    const target = activeChild;
    killProcessGroup(target, signal);
    if (process.platform === "win32" || !isProcessGroupAlive(target.pid)) process.exit(exitCode);
    const deadline = Date.now() + 500;
    const timer = setInterval(() => {
      if (!isProcessGroupAlive(target.pid)) {
        clearInterval(timer);
        process.exit(exitCode);
      } else if (Date.now() >= deadline) {
        clearInterval(timer);
        killProcessGroup(target, "SIGKILL");
        process.exit(exitCode);
      }
    }, 25);
  });
}

function runFile(file, index) {
  return new Promise(resolveRun => {
    console.error(`test-browser: [${index + 1}/${files.length}] ${file}`);
    const child = spawn(process.execPath, ["--experimental-strip-types", "--import", "./tests/setup.ts", "--test", "--test-concurrency=1", ...runnerTimeoutArgs, ...extraArgs, file], {
      cwd: root,
      stdio: "inherit",
      detached: process.platform !== "win32",
      env: { ...process.env, PITH_PLAYWRIGHT_MODULE: playwright.path, PITH_CHROME_PATH: chrome.path },
    });
    activeChild = child;
    const pgid = child.pid;
    let timedOut = false;
    let settled = false;
    let childExited = false;
    let exitResult = null;
    let cleanupTimer = null;
    const finish = result => {
      if (settled) return;
      settled = true;
      clearTimeout(fileTimer);
      if (cleanupTimer) {
        clearInterval(cleanupTimer);
        cleanupTimer = null;
      }
      if (activeChild === child) activeChild = null;
      resolveRun(result);
    };
    const buildTimeoutResult = () => exitResult ?? { file, ok: false, timedOut: true, reason: `timed out after ${fileTimeoutMs}ms` };
    const startProcessGroupCleanup = () => {
      const graceMs = Math.min(3_000, Math.max(500, Math.floor(fileTimeoutMs / 2)));
      killProcessGroup(child, "SIGTERM");
      if (process.platform === "win32") {
        cleanupTimer = setTimeout(() => {
          killProcessGroup(child, "SIGKILL");
          finish(buildTimeoutResult());
        }, graceMs);
        return;
      }
      const graceDeadline = Date.now() + graceMs;
      let killDeadline = null;
      cleanupTimer = setInterval(() => {
        const groupAlive = isProcessGroupAlive(pgid);
        if (childExited && !groupAlive) {
          finish(buildTimeoutResult());
          return;
        }
        const now = Date.now();
        if (killDeadline === null) {
          if (now >= graceDeadline) {
            killProcessGroup(child, "SIGKILL");
            killDeadline = now + 2_000;
          }
          return;
        }
        if (!groupAlive || now >= killDeadline) {
          finish(buildTimeoutResult());
        }
      }, 25);
    };
    const fileTimer = setTimeout(() => {
      timedOut = true;
      console.error(`test-browser: ${file} timed out after ${fileTimeoutMs}ms; terminating process group`);
      startProcessGroupCleanup();
    }, fileTimeoutMs);
    fileTimer.unref();
    child.on("error", error => {
      console.error(`test-browser: ${file}: ${error.message}`);
      childExited = true;
      exitResult = { file, ok: false, timedOut, reason: error.message };
      if (!timedOut) finish(exitResult);
    });
    child.on("exit", (code, signal) => {
      childExited = true;
      const ok = !timedOut && !signal && code === 0;
      exitResult = { file, ok, timedOut, reason: timedOut ? `timed out after ${fileTimeoutMs}ms` : signal ? `signal ${signal}` : `exit ${code ?? 1}` };
      if (!timedOut) finish(exitResult);
    });
  });
}

const failures = [];
for (let i = 0; i < files.length && !interrupted; i++) {
  const result = await runFile(files[i], i);
  if (!result.ok) failures.push(result);
}
if (failures.length > 0) {
  console.error(`test-browser: ${failures.length}/${files.length} file(s) failed:`);
  for (const failure of failures) console.error(`  - ${failure.file} (${failure.reason})`);
  process.exit(1);
}
process.exit(0);
