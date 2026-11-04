import assert from "node:assert/strict";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { runInNewContext } from "node:vm";
import { hasObsidianProcess, isOwnedProcess, stopOwnedChild } from "../scripts/verify-obsidian-e2e.ts";
// @ts-expect-error JavaScript helper has no declaration file.
import { snapshotFiles } from "../scripts/obsidian-safety.mjs";

for (const existed of [false, true]) test(`failed verification restores ${existed ? "existing" : "new"} workspace after child exit`, async () => {
  const root = await mkdtemp(join(tmpdir(), "pith-workspace-restore-"));
  try {
    const vault = join(root, "vault"), workspace = ".obsidian/workspace.json", settings = "settings.json";
    await mkdir(join(vault, ".obsidian"), { recursive: true });
    if (existed) await writeFile(join(vault, workspace), "original workspace", { mode: 0o640 });
    await writeFile(join(vault, settings), "original settings");
    const snapshot = await snapshotFiles(vault, [workspace, settings], join(root, "backup"));
    await snapshot.expect(settings, "intermediate settings");
    await writeFile(join(vault, workspace), "workspace written by Obsidian");
    await writeFile(join(vault, settings), "intermediate settings");
    const source = await readFile(new URL("../scripts/verify-obsidian-e2e.ts", import.meta.url), "utf8");
    const end = source.lastIndexOf("      await snapshot.restore();");
    const start = source.lastIndexOf("    try {", end);
    assert.ok(start >= 0 && end > start);
    const body = source.slice(start + "    try {".length, end + "      await snapshot.restore();".length);
    const restore = runInNewContext(`(async (snapshot, configPaths, settingsPath, completed) => {${body}})`) as (snapshot: unknown, paths: string[], settings: string, completed: boolean) => Promise<void>;
    await restore(snapshot, [workspace, settings], settings, false);
    if (existed) { assert.equal(await readFile(join(vault, workspace), "utf8"), "original workspace"); assert.equal((await stat(join(vault, workspace))).mode & 0o777, 0o640); }
    else await assert.rejects(stat(join(vault, workspace)), { code: "ENOENT" });
    assert.equal(await readFile(join(vault, settings), "utf8"), "original settings");
    const conflict = await snapshotFiles(vault, [workspace, settings], join(root, "conflict-backup"));
    await writeFile(join(vault, workspace), "workspace written by Obsidian");
    await writeFile(join(vault, settings), "unexpected settings");
    await assert.rejects(restore(conflict, [workspace, settings], settings, false), /Restore conflict: settings\.json/);
    assert.equal(await readFile(join(vault, settings), "utf8"), "unexpected settings");
    assert.equal(await readFile(join(root, "conflict-backup", "file-1"), "utf8"), "original settings");
    if (existed) assert.equal(await readFile(join(vault, workspace), "utf8"), "original workspace");
    else await assert.rejects(stat(join(vault, workspace)), { code: "ENOENT" });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("snapshot restores existing and newly created files after an intermediate save", async () => {
  const root = await mkdtemp(join(tmpdir(), "pith-snapshot-"));
  try {
    await mkdir(join(root, "vault")); await writeFile(join(root, "vault", "settings.json"), "original", { mode: 0o640 });
    const snapshot = await snapshotFiles(join(root, "vault"), ["settings.json", "created.json"], join(root, "backup"));
    await snapshot.expect("settings.json", "intermediate", 0o640); await snapshot.expect("created.json", "created", 0o644);
    await writeFile(join(root, "vault", "settings.json"), "intermediate"); await writeFile(join(root, "vault", "created.json"), "created", { mode: 0o644 });
    await snapshot.restore();
    assert.equal(await readFile(join(root, "vault", "settings.json"), "utf8"), "original");
    assert.equal((await stat(join(root, "vault", "settings.json"))).mode & 0o777, 0o640);
    await assert.rejects(stat(join(root, "vault", "created.json")), { code: "ENOENT" });
    assert.equal(await readFile(join(root, "backup", "file-0"), "utf8"), "original");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("snapshot preserves unknown external changes and retains backup", async () => {
  const root = await mkdtemp(join(tmpdir(), "pith-snapshot-conflict-"));
  try {
    await mkdir(join(root, "vault")); await writeFile(join(root, "vault", "settings.json"), "original");
    const snapshot = await snapshotFiles(join(root, "vault"), ["settings.json"], join(root, "backup"));
    await snapshot.expect("settings.json", "our write"); await writeFile(join(root, "vault", "settings.json"), "external");
    await assert.rejects(snapshot.restore(), /Restore conflict/);
    assert.equal(await readFile(join(root, "vault", "settings.json"), "utf8"), "external");
    assert.equal(await readFile(join(root, "backup", "file-0"), "utf8"), "original");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("build backs up existing plugin bytes before synchronizing a simulated vault", async () => {
  const root = await mkdtemp(join(tmpdir(), "pith-build-backup-test-"));
  try {
    for (const path of ["package.json", "manifest.json", "scripts", "src"]) await cp(resolve(path), join(root, path), { recursive: true });
    await symlink(resolve("node_modules"), join(root, "node_modules"), "dir");
    const plugin = join(root, ".dev-vault/.obsidian/plugins/pith"); await mkdir(plugin, { recursive: true });
    await writeFile(join(plugin, "main.js"), "old plugin");
    await writeFile(join(plugin, "styles.css"), "old style");
    const result = await promisify(execFile)(process.execPath, ["scripts/build-obsidian.mjs"], { cwd: root });
    const match = result.stderr.match(/Obsidian plugin backup: (.+)/); assert.ok(match);
    assert.equal(await readFile(join(match[1]!, "file-0"), "utf8"), "old plugin");
    assert.equal(await readFile(join(match[1]!, "file-1"), "utf8"), "old style");
    assert.notEqual(await readFile(join(plugin, "main.js"), "utf8"), "old plugin");
    const manifest = JSON.parse(await readFile(join(match[1]!, "manifest.json"), "utf8"));
    assert.equal(manifest[2].exists, false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("ownership checks follow only the child process tree", () => {
  const parents = new Map([[12, 11], [11, 10], [20, 1]]);
  assert.equal(isOwnedProcess(12, 10, parents), true); assert.equal(isOwnedProcess(20, 10, parents), false);
  assert.equal(hasObsidianProcess("123 /Applications/Obsidian.app/Contents/MacOS/Obsidian --user-data-dir=profile"), true);
  assert.equal(hasObsidianProcess("123 /usr/bin/node script.js"), false);
});

test("verify checks existing processes before build synchronization", async () => {
  const pkg = JSON.parse(await readFile("package.json", "utf8"));
  const command = pkg.scripts["verify:obsidian"] as string;
  assert.match(command, /verify-obsidian\.mjs/);
  const source = await readFile("scripts/verify-obsidian.mjs", "utf8");
  assert.ok(source.indexOf('"--preflight"') < source.indexOf('"scripts/build-obsidian.mjs"'));
  assert.ok(source.indexOf("await snapshot.restore()") < source.indexOf("process.stdout.write(report.stdout)"));
});

test("isolated Obsidian launch disables the system keychain", async () => {
  const source = await readFile("scripts/verify-obsidian-e2e.ts", "utf8");
  assert.match(source, /spawn\(obsidianBin,\s*\[[^\]]*"--use-mock-keychain"[^\]]*"--password-store=basic"/);
});

for (const conflict of [false, true]) test(`verification wrapper ${conflict ? "preserves unexpected plugin changes" : "restores build outputs before reporting success"}`, async () => {
  const root = await mkdtemp(join(tmpdir(), "pith-verify-wrapper-"));
  try {
    await mkdir(join(root, "scripts")); await mkdir(join(root, ".dev-vault/.obsidian/plugins/pith"), { recursive: true }); await mkdir(join(root, "dist/obsidian"), { recursive: true });
    await cp(resolve("scripts/verify-obsidian.mjs"), join(root, "scripts/verify-obsidian.mjs"));
    await cp(resolve("scripts/obsidian-safety.mjs"), join(root, "scripts/obsidian-safety.mjs"));
    const files = ["main.js", "styles.css", "manifest.json"];
    for (const name of files) { await writeFile(join(root, "dist/obsidian", name), `old-dist-${name}`); await writeFile(join(root, ".dev-vault/.obsidian/plugins/pith", name), `old-plugin-${name}`); }
    await writeFile(join(root, "scripts/build-obsidian.mjs"), `import { writeFile } from 'node:fs/promises'; for (const name of ${JSON.stringify(files)}) { await writeFile('dist/obsidian/'+name,'new-'+name); await writeFile('.dev-vault/.obsidian/plugins/pith/'+name,'new-'+name); }`);
    await writeFile(join(root, "scripts/verify-obsidian-e2e.ts"), `import { writeFile } from 'node:fs/promises'; if (!process.argv.includes('--preflight')) { ${conflict ? "await writeFile('.dev-vault/.obsidian/plugins/pith/main.js','unexpected');" : ""} console.log('INNER SUCCESS'); }`);
    if (conflict) {
      await assert.rejects(promisify(execFile)(process.execPath, ["scripts/verify-obsidian.mjs"], { cwd: root }), (error: unknown) => { const failure = error as { stdout?: string; stderr?: string }; assert.doesNotMatch(failure.stdout ?? "", /INNER SUCCESS/); assert.match(failure.stderr ?? "", /Restore conflict/); return true; });
      assert.equal(await readFile(join(root, ".dev-vault/.obsidian/plugins/pith/main.js"), "utf8"), "unexpected");
    } else {
      const result = await promisify(execFile)(process.execPath, ["scripts/verify-obsidian.mjs"], { cwd: root }); assert.match(result.stdout, /INNER SUCCESS/);
      for (const name of files) { assert.equal(await readFile(join(root, "dist/obsidian", name), "utf8"), `old-dist-${name}`); assert.equal(await readFile(join(root, ".dev-vault/.obsidian/plugins/pith", name), "utf8"), `old-plugin-${name}`); }
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("termination waits for our child exit and times out when it remains alive", async () => {
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"]);
  const exited = new Promise<void>((resolve, reject) => { child.once("exit", () => resolve()); child.once("error", reject); });
  await stopOwnedChild(child, exited); assert.ok(child.exitCode !== null || child.signalCode !== null);
  let killed = false;
  const stuck = { pid: 99, exitCode: null, signalCode: null, kill() { killed = true; return true; } } as unknown as ChildProcess;
  await assert.rejects(stopOwnedChild(stuck, new Promise(() => {}), 10), /did not exit/); assert.equal(killed, true);
});
