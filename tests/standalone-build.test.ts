import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const exec = promisify(execFile);
const root = process.cwd();

test("standalone tooling declares its build and typecheck dependencies", async () => {
  const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  assert.ok(pkg.devDependencies, "missing devDependencies");
  for (const dependency of ["typescript", "@types/node", "esbuild"]) {
    assert.ok(pkg.devDependencies[dependency], `missing devDependency: ${dependency}`);
  }
  const { stdout } = await exec("npm", ["run", "typecheck", "--", "--showConfig"], { cwd: root });
  const config = JSON.parse(stdout.slice(stdout.indexOf("{")));
  assert.deepEqual(config.compilerOptions.typeRoots.map((path: string) => resolve(root, path)), [join(root, "node_modules/@types")]);
});

test("Obsidian build runs without a neighboring repository", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pith-standalone-build-"));
  try {
    for (const path of ["package.json", "manifest.json", "scripts", "src"]) {
      await cp(join(root, path), join(dir, path), { recursive: true });
    }
    await symlink(join(root, "node_modules"), join(dir, "node_modules"), "dir");
    await exec("npm", ["run", "build:obsidian"], { cwd: dir, env: { ...process.env, HOME: dir } });
    for (const name of ["main.js", "manifest.json", "styles.css"]) {
      assert.ok((await readFile(join(dir, "dist/obsidian", name))).length > 0, name);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
