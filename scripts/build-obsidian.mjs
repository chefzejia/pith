import { builtinModules } from "node:module";
import { copyFile, lstat, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
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
