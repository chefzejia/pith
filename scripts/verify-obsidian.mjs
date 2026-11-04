import { spawn } from "node:child_process";
import { lstat, mkdir, mkdtemp, readFile, rmdir, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { snapshotFiles } from "./obsidian-safety.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const run = (args) => new Promise((resolveRun, reject) => {
  const child = spawn(process.execPath, args, { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "", stderr = "";
  child.stdout.on("data", chunk => { stdout += chunk; }); child.stderr.on("data", chunk => { stderr += chunk; });
  child.once("error", reject);
  child.once("close", code => code === 0 ? resolveRun({ stdout, stderr }) : reject(new Error(`${args.join(" ")} failed (${code}):\n${stderr}`)));
});

await run(["--experimental-strip-types", "scripts/verify-obsidian-e2e.ts", "--preflight"]);
const vault = await lstat(resolve(root, ".dev-vault"));
if (!vault.isDirectory() || vault.isSymbolicLink()) throw new Error(".dev-vault must be an existing directory");
const tmp = resolve(root, ".tmp"); await mkdir(tmp, { recursive: true });
const tmpInfo = await lstat(tmp); if (!tmpInfo.isDirectory() || tmpInfo.isSymbolicLink()) throw new Error("Invalid .tmp directory");
const runDir = await mkdtemp(resolve(tmp, "pith-verify-build-"));
const names = ["main.js", "styles.css", "manifest.json"];
const outputs = names.map(name => `dist/obsidian/${name}`);
const plugin = names.map(name => `.dev-vault/.obsidian/plugins/pith/${name}`);
const paths = [...outputs, ...plugin];
const dirs = ["dist", "dist/obsidian", ".dev-vault/.obsidian", ".dev-vault/.obsidian/plugins", ".dev-vault/.obsidian/plugins/pith"];
const absent = [];
for (const path of dirs) { try { const info = await lstat(resolve(root, path)); if (!info.isDirectory() || info.isSymbolicLink()) throw new Error(`Invalid directory: ${path}`); } catch (error) { if (error.code !== "ENOENT") throw error; absent.push(path); } }
const snapshot = await snapshotFiles(root, paths, resolve(runDir, "backup"));
console.error(`Obsidian verification build backup: ${resolve(runDir, "backup")}`);
let failure, report;
try {
  for (const path of paths) await snapshot.assertOriginal(path);
  const built = await run(["scripts/build-obsidian.mjs"]);
  if (built.stderr) process.stderr.write(built.stderr);
  for (const path of outputs) await snapshot.expectCurrent(path);
  for (let i = 0; i < names.length; i++) {
    const bytes = await readFile(resolve(root, outputs[i]));
    const mode = (await stat(resolve(root, plugin[i]))).mode & 0o7777;
    await snapshot.expect(plugin[i], bytes, mode);
  }
  report = await run(["--experimental-strip-types", "scripts/verify-obsidian-e2e.ts"]);
} catch (error) { failure = error; }
try {
  await snapshot.restore();
  for (const path of absent.reverse()) { try { await rmdir(resolve(root, path)); } catch (error) { if (error.code !== "ENOENT" && error.code !== "ENOTEMPTY") throw error; } }
} catch (error) { throw new AggregateError(failure ? [failure, error] : [error], `Verification restore failed; backup: ${runDir}`); }
if (failure) throw failure;
if (report.stderr) process.stderr.write(report.stderr);
process.stdout.write(report.stdout);
