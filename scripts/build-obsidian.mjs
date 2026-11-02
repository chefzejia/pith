import { builtinModules } from "node:module";
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "../../ganfan-garden/node_modules/esbuild/lib/main.js";

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
