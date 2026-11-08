import { builtinModules } from "node:module";
import { constants } from "node:fs";
import { copyFile, lstat, mkdir, open, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(root, "dist/obsidian");
const vault = resolve(root, ".dev-vault");
const destination = resolve(vault, ".obsidian/plugins/pith");
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

let vaultInfo;
try { vaultInfo = await lstat(vault); } catch (error) { if (error.code !== "ENOENT") throw error; }
if (vaultInfo) {
  await mkdir(destination, { recursive: true });
  for (const name of ["main.js", "styles.css", "manifest.json"]) await copyFile(resolve(output, name), resolve(destination, name));
  console.log("Obsidian plugin synchronized");
}

const userDestination = resolve(homedir(), "Library/Mobile Documents/iCloud~md~obsidian/Documents/ganfan-media/.obsidian/plugins/pith");
let userDestinationInfo;
try { userDestinationInfo = await lstat(userDestination); } catch (error) { if (error.code !== "ENOENT") throw error; }
if (userDestinationInfo) {
  if (!userDestinationInfo.isDirectory() || userDestinationInfo.isSymbolicLink()) throw new Error("User plugin destination must be a directory");
  const names = ["main.js", "styles.css", "manifest.json"];
  for (const name of names) {
    try { const info = await lstat(resolve(userDestination, name)); if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1) throw new Error(`Invalid plugin file: ${name}`); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  for (const name of names) {
    const file = await open(resolve(userDestination, name), constants.O_WRONLY | constants.O_CREAT | constants.O_NOFOLLOW | constants.O_NONBLOCK, 0o666);
    try {
      const info = await file.stat();
      if (!info.isFile() || info.nlink !== 1) throw new Error(`Invalid plugin file: ${name}`);
      await file.truncate(0); await file.writeFile(await readFile(resolve(output, name)));
    } finally { await file.close(); }
  }
  console.log("User Obsidian plugin synchronized");
}
