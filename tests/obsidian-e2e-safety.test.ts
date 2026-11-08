import assert from "node:assert/strict";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { cp, lstat, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { isolatedLaunchArgs, isolatedVaultRegistry, prepareIsolatedVault, startSpeechStub, stopOwnedChild } from "../scripts/verify-obsidian-e2e.ts";
import { testSandbox } from "./sandbox.ts";

test("speech stub owns a dynamic port and releases it", async () => {
  const stub = await startSpeechStub();
  try {
    assert.equal((await fetch(`${stub.base}/health`)).status, 200);
    assert.equal((await fetch(`${stub.base}/unexpected`)).status, 404);
    assert.deepEqual(stub.requests, ["GET /health", "GET /unexpected"]);
  } finally { await stub.close(); }
  await assert.rejects(fetch(`${stub.base}/health`));
});
test("isolated launch uses the supplied profile, port and mock keychain", () => {
  assert.deepEqual(isolatedLaunchArgs("/isolated/profile", 54321), ["--user-data-dir=/isolated/profile", "--remote-debugging-port=54321", "--use-mock-keychain", "--password-store=basic"]);
  assert.deepEqual(isolatedVaultRegistry(123), { updateDisabled: true, vaults: { devvault00000001: { path: resolve(".dev-vault"), ts: 123 } } });
});

test("termination waits for the owned child and does not stop a sibling", async () => {
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"]);
  const sibling = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"]);
  const exited = new Promise<void>((resolveExit, reject) => { child.once("exit", () => resolveExit()); child.once("error", reject); });
  const siblingExit = new Promise<void>((resolveExit, reject) => { sibling.once("exit", () => resolveExit()); sibling.once("error", reject); });
  try {
    await stopOwnedChild(child, exited);
    assert.ok(child.exitCode !== null || child.signalCode !== null);
    assert.equal(sibling.exitCode, null);
    assert.equal(sibling.signalCode, null);
    const stuck = { pid: 99, exitCode: null, signalCode: null, kill() { return true; } } as unknown as ChildProcess;
    await assert.rejects(stopOwnedChild(stuck, new Promise(() => {}), 10), /did not exit/);
  } finally { await stopOwnedChild(sibling, siblingExit); }
});

for (const vault of [false, true]) test(`isolated build ${vault ? "synchronizes an existing test vault" : "does not create a vault"}`, async () => {
  const root = await testSandbox("pith-build-test-");
  try {
    for (const path of ["package.json", "manifest.json", "scripts", "src"]) await cp(resolve(path), join(root, path), { recursive: true });
    await symlink(resolve("node_modules"), join(root, "node_modules"), "dir");
    if (vault) { await mkdir(join(root, ".dev-vault/.obsidian/plugins/pith"), { recursive: true }); await writeFile(join(root, ".dev-vault/.obsidian/plugins/pith/main.js"), "old plugin"); }
    await promisify(execFile)(process.execPath, ["scripts/build-obsidian.mjs"], { cwd: root, env: { ...process.env, HOME: root } });
    const built = await readFile(join(root, "dist/obsidian/main.js"));
    if (vault) assert.deepEqual(await readFile(join(root, ".dev-vault/.obsidian/plugins/pith/main.js")), built);
    else await assert.rejects(readFile(join(root, ".dev-vault/.obsidian/plugins/pith/main.js")), { code: "ENOENT" });
  } finally { await rm(root, { recursive: true, force: true }); }
});

for (const exists of [false, true]) test(`user plugin sync ${exists ? "updates only the three plugin files" : "does not create a missing destination"}`, async () => {
  const root = await testSandbox("pith-user-build-");
  const destination = join(root, "Library/Mobile Documents/iCloud~md~obsidian/Documents/ganfan-media/.obsidian/plugins/pith");
  try {
    for (const path of ["package.json", "manifest.json", "scripts", "src"]) await cp(resolve(path), join(root, path), { recursive: true });
    await symlink(resolve("node_modules"), join(root, "node_modules"), "dir");
    if (exists) { await mkdir(destination, { recursive: true }); await writeFile(join(destination, "data.json"), "untouched settings"); await writeFile(join(destination, "main.js"), "old plugin"); }
    await promisify(execFile)(process.execPath, ["scripts/build-obsidian.mjs"], { cwd: root, env: { ...process.env, HOME: root } });
    if (exists) {
      for (const name of ["main.js", "styles.css", "manifest.json"]) assert.ok((await readFile(join(destination, name))).equals(await readFile(join(root, "dist/obsidian", name))), `${name} differs from build`);
      assert.equal(await readFile(join(destination, "data.json"), "utf8"), "untouched settings");
    } else await assert.rejects(lstat(destination), { code: "ENOENT" });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("user plugin sync rejects linked plugin files before writing", async () => {
  const root = await testSandbox("pith-user-build-link-");
  const destination = join(root, "Library/Mobile Documents/iCloud~md~obsidian/Documents/ganfan-media/.obsidian/plugins/pith");
  try {
    for (const path of ["package.json", "manifest.json", "scripts", "src"]) await cp(resolve(path), join(root, path), { recursive: true });
    await symlink(resolve("node_modules"), join(root, "node_modules"), "dir");
    await mkdir(destination, { recursive: true });
    await writeFile(join(destination, "data.json"), "preserved");
    await symlink(join(destination, "data.json"), join(destination, "styles.css"));
    await assert.rejects(promisify(execFile)(process.execPath, ["scripts/build-obsidian.mjs"], { cwd: root, env: { ...process.env, HOME: root } }));
    assert.equal(await readFile(join(destination, "data.json"), "utf8"), "preserved");
    await assert.rejects(lstat(join(destination, "main.js")), { code: "ENOENT" });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("isolated verification deployment leaves existing vault configuration and data unchanged", async () => {
  const root = await testSandbox("pith-e2e-deploy-");
  try {
    const vault = join(root, "vault"), build = join(root, "build");
    await mkdir(join(vault, ".obsidian/plugins/pith"), { recursive: true });
    await mkdir(join(vault, "Pith/_cache"), { recursive: true });
    await mkdir(build);
    await writeFile(join(vault, ".obsidian/workspace.json"), "existing workspace");
    await writeFile(join(vault, ".obsidian/plugins/pith/main.js"), "existing plugin");
    await writeFile(join(vault, "Pith/_cache/web-settings.json"), "existing settings");
    for (const name of ["main.js", "styles.css", "manifest.json"]) await writeFile(join(build, name), `built ${name}`);
    const isolated = await prepareIsolatedVault(vault, build);
    assert.match(isolated.configDir, /^\.pith-e2e-/);
    assert.match(isolated.workspacePath, /^Pith-e2e-/);
    assert.deepEqual(JSON.parse(await readFile(join(vault, isolated.configDir, "plugins/pith/data.json"), "utf8")), { workspacePath: isolated.workspacePath });
    assert.deepEqual(JSON.parse(await readFile(join(vault, isolated.configDir, "community-plugins.json"), "utf8")), ["pith"]);
    assert.equal(await readFile(join(vault, isolated.configDir, "plugins/pith/main.js"), "utf8"), "built main.js");
    assert.equal(await readFile(join(vault, ".obsidian/workspace.json"), "utf8"), "existing workspace");
    assert.equal(await readFile(join(vault, ".obsidian/plugins/pith/main.js"), "utf8"), "existing plugin");
    assert.equal(await readFile(join(vault, "Pith/_cache/web-settings.json"), "utf8"), "existing settings");
  } finally { await rm(root, { recursive: true, force: true }); }
});
