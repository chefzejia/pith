import assert from "node:assert/strict";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, lstat, mkdir, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
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

const builtNames = ["main.js", "styles.css", "manifest.json"];
const defaultUserVault = "Library/Mobile Documents/iCloud~md~obsidian/Documents/ganfan-media";
const pluginDir = (vault: string): string => join(vault, ".obsidian/plugins/pith");
const run = promisify(execFile);

async function buildSandbox(prefix: string): Promise<string> {
  const root = await testSandbox(prefix);
  for (const path of ["package.json", "manifest.json", "scripts", "src"]) await cp(resolve(path), join(root, path), { recursive: true });
  await symlink(resolve("node_modules"), join(root, "node_modules"), "dir");
  return root;
}

function sandboxEnv(root: string, vault?: string): NodeJS.ProcessEnv {
  const { PITH_OBSIDIAN_VAULT: _inherited, ...env } = process.env;
  return { ...env, HOME: root, ...(vault === undefined ? {} : { PITH_OBSIDIAN_VAULT: vault }) };
}

test("build leaves an existing user vault plugin untouched", async () => {
  const root = await buildSandbox("pith-user-build-");
  const destination = pluginDir(join(root, defaultUserVault));
  try {
    await mkdir(destination, { recursive: true });
    await writeFile(join(destination, "data.json"), "untouched settings");
    await writeFile(join(destination, "main.js"), "old plugin");
    await run(process.execPath, ["scripts/build-obsidian.mjs"], { cwd: root, env: sandboxEnv(root) });
    assert.ok((await readFile(join(root, "dist/obsidian/main.js"))).byteLength > 0);
    assert.deepEqual((await readdir(destination)).sort(), ["data.json", "main.js"]);
    assert.equal(await readFile(join(destination, "main.js"), "utf8"), "old plugin");
    assert.equal(await readFile(join(destination, "data.json"), "utf8"), "untouched settings");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("install writes the three built files to the default, environment and argument vaults", async () => {
  const root = await buildSandbox("pith-install-");
  try {
    await run(process.execPath, ["scripts/build-obsidian.mjs"], { cwd: root, env: sandboxEnv(root) });
    const vaults = { default: join(root, defaultUserVault), env: join(root, "env-vault"), arg: join(root, "arg-vault") };
    for (const vault of Object.values(vaults)) {
      await mkdir(pluginDir(vault), { recursive: true });
      await writeFile(join(pluginDir(vault), "data.json"), "untouched settings");
      await writeFile(join(pluginDir(vault), "main.js"), "old plugin");
    }
    const installedTo = async (vault: string, stdout: string) => {
      for (const name of builtNames) {
        const built = await readFile(join(root, "dist/obsidian", name));
        assert.ok((await readFile(join(pluginDir(vault), name))).equals(built), `${name} differs from build`);
        assert.ok(stdout.includes(`${createHash("sha256").update(built).digest("hex")}  ${name}`), `${name} hash is not reported`);
      }
      assert.deepEqual((await readdir(pluginDir(vault))).sort(), ["data.json", ...builtNames].sort());
      assert.equal(await readFile(join(pluginDir(vault), "data.json"), "utf8"), "untouched settings");
    };
    const untouched = async (vault: string) => assert.equal(await readFile(join(pluginDir(vault), "main.js"), "utf8"), "old plugin");

    await installedTo(vaults.arg, (await run(process.execPath, ["scripts/install-obsidian.mjs", vaults.arg], { cwd: root, env: sandboxEnv(root, vaults.env) })).stdout);
    await untouched(vaults.env); await untouched(vaults.default);
    await installedTo(vaults.env, (await run(process.execPath, ["scripts/install-obsidian.mjs"], { cwd: root, env: sandboxEnv(root, vaults.env) })).stdout);
    await untouched(vaults.default);
    await installedTo(vaults.default, (await run(process.execPath, ["scripts/install-obsidian.mjs"], { cwd: root, env: sandboxEnv(root) })).stdout);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("install validates everything before the first write", async () => {
  const root = await buildSandbox("pith-install-reject-");
  try {
    const install = (vault: string) => run(process.execPath, ["scripts/install-obsidian.mjs", vault], { cwd: root, env: sandboxEnv(root) });
    const ready = join(root, "ready-vault");
    await mkdir(pluginDir(ready), { recursive: true });
    await assert.rejects(install(ready), /missing build output/);
    assert.deepEqual(await readdir(pluginDir(ready)), []);

    await run(process.execPath, ["scripts/build-obsidian.mjs"], { cwd: root, env: sandboxEnv(root) });

    const missing = join(root, "missing-vault");
    await assert.rejects(install(missing), /plugin directory does not exist/);
    await assert.rejects(lstat(missing), { code: "ENOENT" });

    const linked = join(root, "linked-vault");
    await mkdir(pluginDir(linked), { recursive: true });
    await writeFile(join(pluginDir(linked), "data.json"), "preserved");
    await symlink(join(pluginDir(linked), "data.json"), join(pluginDir(linked), "styles.css"));
    await assert.rejects(install(linked), /invalid plugin file/);
    assert.equal(await readFile(join(pluginDir(linked), "data.json"), "utf8"), "preserved");
    await assert.rejects(lstat(join(pluginDir(linked), "main.js")), { code: "ENOENT" });

    const target = join(root, "elsewhere");
    await mkdir(target);
    const linkedDirectory = join(root, "linked-directory-vault");
    await mkdir(join(linkedDirectory, ".obsidian/plugins"), { recursive: true });
    await symlink(target, pluginDir(linkedDirectory), "dir");
    await assert.rejects(install(linkedDirectory), /must be a directory/);
    assert.deepEqual(await readdir(target), []);
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
