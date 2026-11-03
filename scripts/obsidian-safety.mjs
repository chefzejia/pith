import { lstat, mkdir, readFile, unlink, writeFile, chmod } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";

async function readState(root, name) {
  const target = resolve(root, name);
  if (!target.startsWith(resolve(root) + sep)) throw new Error(`Unsafe path: ${name}`);
  let current = resolve(root);
  for (const part of name.split("/")) {
    current = join(current, part);
    let info;
    try { info = await lstat(current); } catch (error) { if (error.code === "ENOENT") return null; throw error; }
    if (info.isSymbolicLink()) throw new Error(`Symbolic link is not allowed: ${current}`);
    if (current !== target && !info.isDirectory()) throw new Error(`Not a directory: ${current}`);
    if (current === target) {
      if (!info.isFile()) throw new Error(`Not a file: ${current}`);
      return { bytes: await readFile(current), mode: info.mode & 0o7777 };
    }
  }
  throw new Error(`Invalid path: ${name}`);
}

function same(left, right) { return left === null ? right === null : right !== null && left.mode === right.mode && left.bytes.equals(right.bytes); }

export async function snapshotFiles(root, names, backupDir) {
  await mkdir(backupDir, { recursive: true });
  const entries = [];
  for (const name of names) {
    const original = await readState(root, name);
    if (original) await writeFile(join(backupDir, `file-${entries.length}`), original.bytes, { flag: "wx", mode: 0o600 });
    entries.push({ name, original, expected: [] });
  }
  await writeFile(join(backupDir, "manifest.json"), JSON.stringify(entries.map(({ name, original }, index) => ({ name, exists: original !== null, mode: original && original.mode, backup: original ? `file-${index}` : null })), null, 2), { flag: "wx", mode: 0o600 });
  return {
    async expect(name, bytes, mode) {
      const entry = entries.find(item => item.name === name); if (!entry) throw new Error(`Not in snapshot: ${name}`);
      entry.expected.push(bytes === null ? null : { bytes: Buffer.from(bytes), mode: mode ?? (entry.original ? entry.original.mode : 0o644) });
    },
    async expectCurrent(name) {
      const entry = entries.find(item => item.name === name); if (!entry) throw new Error(`Not in snapshot: ${name}`);
      entry.expected.push(await readState(root, name));
    },
    async assertOriginal(name) {
      const entry = entries.find(item => item.name === name); if (!entry || !same(await readState(root, name), entry.original)) throw new Error(`Backup conflict: ${name}`);
    },
    async restore() {
      const conflicts = [];
      for (const entry of entries) {
        try {
          const current = await readState(root, entry.name);
          if (same(current, entry.original)) continue;
          if (!entry.expected.some(state => same(current, state))) { conflicts.push(entry.name); continue; }
          const target = join(root, entry.name);
          if (entry.original) { await mkdir(dirname(target), { recursive: true }); await writeFile(target, entry.original.bytes); await chmod(target, entry.original.mode); }
          else if (current) await unlink(target);
        } catch (error) { conflicts.push(`${entry.name}: ${error.message}`); }
      }
      if (conflicts.length) throw new Error(`Restore conflict: ${conflicts.join(", ")}; backups: ${backupDir}`);
    },
  };
}
