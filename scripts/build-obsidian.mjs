import { builtinModules } from "node:module";
import { copyFile, lstat, mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { snapshotFiles } from "./obsidian-safety.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(root, "dist/obsidian");
await mkdir(output, { recursive: true });
await build({
  entryPoints: [resolve(root, "src/shells/obsidian/index.ts")],
  outfile: resolve(output, "main.js"),
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "es2022",
  external: ["obsidian", "electron", ...builtinModules, ...builtinModules.map(name => `node:${name}`)],
  footer: { js: "module.exports = module.exports.default;" },
});
const styles = await build({ entryPoints: [resolve(root, "src/shells/obsidian/plugin.ts")], bundle: true, platform: "node", format: "esm", write: false });
const source = styles.outputFiles[0];
if (!source) throw new Error("Failed to compile Obsidian styles");
const { obsidianStyles } = await import(`data:text/javascript;base64,${Buffer.from(source.contents).toString("base64")}`);
await writeFile(resolve(output, "styles.css"), obsidianStyles);
await copyFile(resolve(root, "manifest.json"), resolve(output, "manifest.json"));

const vault = resolve(root, ".dev-vault");
let vaultInfo;
try { vaultInfo = await lstat(vault); } catch (error) { if (error.code !== "ENOENT") throw error; }
if (vaultInfo) {
  if (!vaultInfo.isDirectory() || vaultInfo.isSymbolicLink()) throw new Error("Invalid .dev-vault directory");
  const tmp = resolve(root, ".tmp"); await mkdir(tmp, { recursive: true });
  const tmpInfo = await lstat(tmp); if (!tmpInfo.isDirectory() || tmpInfo.isSymbolicLink()) throw new Error("Invalid .tmp directory");
  const backup = await mkdtemp(resolve(tmp, "pith-build-backup-"));
  console.error(`Obsidian plugin backup: ${backup}`);
  const names = ["main.js", "styles.css", "manifest.json"];
  const paths = names.map(name => `.obsidian/plugins/pith/${name}`);
  const snapshot = await snapshotFiles(vault, paths, backup);
  try {
    for (const path of paths) await snapshot.assertOriginal(path);
    await mkdir(resolve(vault, ".obsidian/plugins/pith"), { recursive: true });
    for (let i = 0; i < names.length; i++) {
      const name = names[i], path = paths[i];
      await snapshot.assertOriginal(path);
      const source = resolve(output, name), bytes = await readFile(source);
      const destination = resolve(vault, path);
      let mode;
      try { mode = (await stat(destination)).mode & 0o7777; } catch (error) { if (error.code !== "ENOENT") throw error; mode = (await stat(source)).mode & 0o7777; }
      await snapshot.expect(path, bytes, mode);
      await copyFile(source, destination);
    }
  } catch (error) {
    try { await snapshot.restore(); } catch (restoreError) { throw new AggregateError([error, restoreError], `Build sync failed; backup: ${backup}`); }
    throw new Error(`Build sync failed; backup: ${backup}`, { cause: error });
  }
  console.log(`Obsidian plugin synchronized; backup: ${backup}`);
}
