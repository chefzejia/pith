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

console.error(`test-browser: ${files.length} files, playwright ${playwright.path}, chrome ${chrome.path}`);
const child = spawn(process.execPath, ["--experimental-strip-types", "--import", "./tests/setup.ts", "--test", "--test-concurrency=1", ...args.filter(arg => !named.includes(arg)), ...files], {
  cwd: root,
  stdio: "inherit",
  env: { ...process.env, PITH_PLAYWRIGHT_MODULE: playwright.path, PITH_CHROME_PATH: chrome.path },
});
child.on("error", error => { console.error(`test-browser: ${error.message}`); process.exit(1); });
child.on("exit", (code, signal) => process.exit(signal ? 1 : code ?? 1));
