import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Installs the built plugin into one Obsidian vault: argv[2], else PITH_OBSIDIAN_VAULT, else the default vault.
 * Writes exactly main.js, styles.css and manifest.json under <vault>/.obsidian/plugins/pith.
 * Every source and destination check completes before the first write.
 */
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(root, "dist/obsidian");
const names = ["main.js", "styles.css", "manifest.json"];
const vault = resolve(process.argv[2] || process.env.PITH_OBSIDIAN_VAULT || join(homedir(), "Library/Mobile Documents/iCloud~md~obsidian/Documents/ganfan-media"));
const destination = join(vault, ".obsidian/plugins/pith");

function fail(message) {
  console.error(`install-obsidian: ${message}`);
  process.exit(1);
}

async function inspect(path) {
  try { return await lstat(path); } catch (error) { if (error.code === "ENOENT") return undefined; throw error; }
}

const sources = new Map();
for (const name of names) {
  const path = join(output, name);
  const info = await inspect(path);
  if (!info || !info.isFile()) fail(`missing build output ${path}; run npm run build:obsidian first`);
  sources.set(name, await readFile(path));
}

const destinationInfo = await inspect(destination);
if (!destinationInfo) fail(`plugin directory does not exist: ${destination}`);
if (!destinationInfo.isDirectory() || destinationInfo.isSymbolicLink()) fail(`plugin destination must be a directory: ${destination}`);
for (const name of names) {
  const info = await inspect(join(destination, name));
  if (info && (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1)) fail(`invalid plugin file: ${join(destination, name)}`);
}

console.log(`Installing Pith into ${destination}`);
for (const name of names) {
  const bytes = sources.get(name);
  const file = await open(join(destination, name), constants.O_WRONLY | constants.O_CREAT | constants.O_NOFOLLOW | constants.O_NONBLOCK, 0o666);
  try {
    const info = await file.stat();
    if (!info.isFile() || info.nlink !== 1) throw new Error(`Invalid plugin file: ${name}`);
    await file.truncate(0);
    await file.writeFile(bytes);
  } finally { await file.close(); }
  console.log(`${createHash("sha256").update(bytes).digest("hex")}  ${name}`);
}
