import { constants } from "node:fs";
import { realpathSync } from "node:fs";
import { copyFile, lstat, mkdir, readdir, readFile, realpath, rename, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseFrontmatter } from "../src/core/store/frontmatter.ts";
import { DefaultWorkspaceStore } from "../src/core/store/WorkspaceStore.ts";
import { NodeWorkspaceStorage } from "../src/shells/web/nodeStorage.ts";

const PLAIN_ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const LEGACY_LINK_RE = /^\[\[materials\/([a-z0-9]+(?:-[a-z0-9]+)*)\/material\]\]$/;
const BLOCK_ITEM_RE = /^(  -\s+)(["'])\[\[materials\/([a-z0-9]+(?:-[a-z0-9]+)*)\/material\]\]\2(\s*)$/;
const INLINE_ITEM_RE = /^(\s*)(["'])\[\[materials\/([a-z0-9]+(?:-[a-z0-9]+)*)\/material\]\]\2(\s*)$/;

function splitLinesPreservingEol(text) {
  const lines = [];
  let pos = 0;
  while (pos < text.length) {
    const nl = text.indexOf("\n", pos);
    if (nl < 0) {
      lines.push({ text: text.slice(pos), eol: "" });
      break;
    }
    const hasCr = nl > pos && text[nl - 1] === "\r";
    lines.push({
      text: text.slice(pos, hasCr ? nl - 1 : nl),
      eol: hasCr ? "\r\n" : "\n",
    });
    pos = nl + 1;
  }
  return lines;
}

function splitInlineParts(inner) {
  const parts = [];
  let start = 0;
  let quote = "";
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (quote === '"' && ch === "\\") { i++; continue; }
    if (quote === "'" && ch === "'" && inner[i + 1] === "'") { i++; continue; }
    if (quote && ch === quote) quote = "";
    else if (!quote && (ch === '"' || ch === "'")) quote = ch;
    else if (!quote && ch === ",") {
      parts.push(inner.slice(start, i));
      start = i + 1;
    }
  }
  if (quote) return null;
  parts.push(inner.slice(start));
  return parts;
}

function rewriteInlineLine(lineText, expectedIds) {
  const match = /^(materials:\s*\[)([\s\S]*)(\])$/.exec(lineText);
  if (!match) return null;
  const parts = splitInlineParts(match[2]);
  if (!parts || parts.length !== expectedIds.length) return null;
  const converted = [];
  for (let i = 0; i < parts.length; i++) {
    const itemMatch = INLINE_ITEM_RE.exec(parts[i]);
    if (!itemMatch || itemMatch[3] !== expectedIds[i]) return null;
    converted.push(`${itemMatch[1]}${itemMatch[2]}${itemMatch[3]}${itemMatch[2]}${itemMatch[4]}`);
  }
  return `${match[1]}${converted.join(",")}${match[3]}`;
}

function rewriteMaterialsLines(raw, expectedIds) {
  const fmMatch = /^(---\r?\n)([\s\S]*?)(\r?\n---(?:\r?\n|$))/.exec(raw);
  if (!fmMatch || fmMatch[2] === undefined) return { ok: false, reason: "missing frontmatter delimiters" };
  const lines = splitLinesPreservingEol(fmMatch[2]);
  let foundMaterials = false;

  for (let i = 0; i < lines.length; i++) {
    const lineText = lines[i].text;
    if (!lineText.trim() || lineText.trimStart().startsWith("#")) continue;
    const pairMatch = /^([A-Za-z][\w-]*):(?:\s+(.*)|\s*)$/.exec(lineText);
    if (!pairMatch) return { ok: false, reason: "unsupported frontmatter structure" };
    const [, key, value = ""] = pairMatch;

    if (key === "materials") {
      foundMaterials = true;
      if (value.startsWith("[")) {
        const nextLine = rewriteInlineLine(lineText, expectedIds);
        if (!nextLine) return { ok: false, reason: "unsupported inline materials line format" };
        lines[i].text = nextLine;
        break;
      }
      if (value !== "") return { ok: false, reason: "unsupported materials format" };
      const convertedIds = [];
      while (i + 1 < lines.length && /^  - /.test(lines[i + 1].text)) {
        i++;
        const itemMatch = BLOCK_ITEM_RE.exec(lines[i].text);
        if (!itemMatch) return { ok: false, reason: "unsupported materials list line format" };
        lines[i].text = `${itemMatch[1]}${itemMatch[2]}${itemMatch[3]}${itemMatch[2]}${itemMatch[4]}`;
        convertedIds.push(itemMatch[3]);
      }
      if (
        convertedIds.length !== expectedIds.length ||
        !convertedIds.every((id, index) => id === expectedIds[index])
      ) {
        return { ok: false, reason: "materials list line mismatch" };
      }
      break;
    }

    if (value === "") {
      while (i + 1 < lines.length && /^  - /.test(lines[i + 1].text)) {
        i++;
        while (i + 1 < lines.length && /^    [A-Za-z]/.test(lines[i + 1].text)) i++;
      }
    }
  }

  if (!foundMaterials) return { ok: false, reason: "missing materials field" };
  const nextFrontmatter = lines.map(line => line.text + line.eol).join("");
  const nextRaw = `${fmMatch[1]}${nextFrontmatter}${fmMatch[3]}${raw.slice(fmMatch[0].length)}`;
  return { ok: true, nextRaw };
}

function createReadOnlyOverlayStorage(baseStorage, overrides) {
  const rejectWrite = async () => { throw new Error("Read-only overlay storage"); };
  return {
    mutationIdentity: {},
    exists: async path => overrides.has(path) || baseStorage.exists(path),
    readText: async path => overrides.has(path) ? overrides.get(path) : baseStorage.readText(path),
    readBinary: async path => overrides.has(path) ? new TextEncoder().encode(overrides.get(path)) : baseStorage.readBinary(path),
    list: path => baseStorage.list(path),
    writeText: rejectWrite,
    createText: rejectWrite,
    writeBinary: rejectWrite,
    createBinary: rejectWrite,
    copy: rejectWrite,
    processText: rejectWrite,
    mkdir: rejectWrite,
  };
}

function idsEqual(a, b) {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

async function allocateBackupDir(realWorkspaceDir) {
  const backupParent = join(homedir(), "Library/Application Support/pith/backups");
  await mkdir(backupParent, { recursive: true });
  const realBackupParent = await realpath(backupParent);
  const rel = relative(realWorkspaceDir, realBackupParent);
  if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) {
    throw new Error(`Backup directory ${realBackupParent} must be outside workspace ${realWorkspaceDir}`);
  }
  const stamp = new Date().toISOString().replace(/[-:.]/g, "");
  for (let suffix = 0; suffix < 1000; suffix++) {
    const candidate = join(realBackupParent, suffix === 0 ? stamp : `${stamp}-${suffix}`);
    try {
      await mkdir(candidate, { recursive: false });
      return candidate;
    } catch (error) {
      if (error && typeof error === "object" && error.code === "EEXIST") continue;
      throw error;
    }
  }
  throw new Error("Failed to allocate unique backup directory");
}

async function writeFileAtomically(targetPath, bytes, tempPaths, nextId) {
  const tempPath = join(dirname(targetPath), `.topic.md.tmp-${process.pid}-${nextId()}`);
  tempPaths.add(tempPath);
  await writeFile(tempPath, bytes, { flag: "wx" });
  await rename(tempPath, targetPath);
  tempPaths.delete(tempPath);
}

async function evaluateTopic({ topicDirName, relPath, fullPath, baseStorage }) {
  let info;
  try {
    info = await lstat(fullPath);
  } catch (error) {
    return { kind: "skip", relPath, reason: `cannot stat file: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (info.isSymbolicLink() || !info.isFile()) {
    return { kind: "skip", relPath, reason: "not a regular file" };
  }

  let originalBytes;
  try {
    originalBytes = await readFile(fullPath);
  } catch (error) {
    return { kind: "skip", relPath, reason: `cannot read file: ${error instanceof Error ? error.message : String(error)}` };
  }

  let raw;
  try {
    raw = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(originalBytes);
  } catch (error) {
    return { kind: "skip", relPath, reason: `invalid UTF-8: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (!Buffer.from(raw, "utf8").equals(originalBytes)) {
    return { kind: "skip", relPath, reason: "non-canonical UTF-8 byte sequence" };
  }

  let parsed;
  try {
    parsed = parseFrontmatter(raw);
  } catch (error) {
    return { kind: "skip", relPath, reason: `invalid frontmatter: ${error instanceof Error ? error.message : String(error)}` };
  }

  const attrs = parsed.attributes;
  if (!Object.hasOwn(attrs, "materials")) {
    return { kind: "skip", relPath, reason: "missing materials list" };
  }
  if (!Array.isArray(attrs.materials)) {
    return { kind: "skip", relPath, reason: "materials is not a list" };
  }
  if (attrs.materials.length === 0) {
    return { kind: "skip", relPath, reason: "empty materials list" };
  }

  const allPlain = attrs.materials.every(item => typeof item === "string" && PLAIN_ID_RE.test(item));
  if (allPlain) {
    return { kind: "skip", relPath, reason: "already plain material IDs" };
  }

  let sawPlain = false;
  let sawLegacy = false;
  let sawInvalid = false;
  const expectedIds = [];
  for (const item of attrs.materials) {
    if (typeof item === "string") {
      const legacyMatch = LEGACY_LINK_RE.exec(item);
      if (legacyMatch) {
        sawLegacy = true;
        expectedIds.push(legacyMatch[1]);
        continue;
      }
      if (PLAIN_ID_RE.test(item)) {
        sawPlain = true;
        continue;
      }
    }
    sawInvalid = true;
  }

  if (sawPlain && sawLegacy && !sawInvalid) {
    return { kind: "skip", relPath, reason: "mixed plain and double-link materials entries" };
  }
  if (sawInvalid || !sawLegacy || expectedIds.length !== attrs.materials.length) {
    return { kind: "skip", relPath, reason: "invalid or non-legacy materials entries" };
  }
  if (new Set(expectedIds).size !== expectedIds.length) {
    return { kind: "skip", relPath, reason: "duplicate material IDs" };
  }

  const rewritten = rewriteMaterialsLines(raw, expectedIds);
  if (!rewritten.ok) {
    return { kind: "skip", relPath, reason: rewritten.reason };
  }
  const { nextRaw } = rewritten;

  let reparsed;
  try {
    reparsed = parseFrontmatter(nextRaw);
  } catch (error) {
    return { kind: "skip", relPath, reason: `reparse failed: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (!Array.isArray(reparsed.attributes.materials) || !idsEqual(reparsed.attributes.materials, expectedIds)) {
    return { kind: "skip", relPath, reason: "rewritten frontmatter verification mismatch" };
  }

  try {
    const overlayStore = new DefaultWorkspaceStore(
      createReadOnlyOverlayStorage(baseStorage, new Map([[relPath, nextRaw]])),
    );
    const topic = await overlayStore.getTopic(topicDirName);
    if (!topic || !idsEqual(topic.materialIds, expectedIds)) {
      return { kind: "skip", relPath, reason: "unreadable legacy topic: post-conversion mismatch" };
    }
  } catch (error) {
    return { kind: "skip", relPath, reason: `unreadable legacy topic: ${error instanceof Error ? error.message : String(error)}` };
  }

  const nextBytes = Buffer.from(nextRaw, "utf8");
  return {
    kind: "migrate",
    topicDirName,
    relPath,
    fullPath,
    originalBytes,
    nextBytes,
    expectedMaterialIds: expectedIds,
  };
}

export async function migrateTopicMaterialIds(workspaceDir, options = {}) {
  const dryRun = options.dryRun === true;
  const resolvedInput = resolve(workspaceDir);
  const rootInfo = await lstat(resolvedInput).catch(() => null);
  if (!rootInfo || !rootInfo.isDirectory()) {
    throw new Error(`Workspace directory does not exist or is not a directory: ${workspaceDir}`);
  }
  const realWorkspaceDir = await realpath(resolvedInput);
  const topicsDir = join(realWorkspaceDir, "topics");
  const topicsInfo = await lstat(topicsDir).catch(error => {
    if (error && typeof error === "object" && error.code === "ENOENT") return null;
    throw error;
  });

  const plans = [];
  const skipped = [];

  if (topicsInfo) {
    if (topicsInfo.isSymbolicLink() || !topicsInfo.isDirectory()) {
      throw new Error(`Invalid topics directory: ${topicsDir}`);
    }
    const entries = await readdir(topicsDir, { withFileTypes: true });
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    const baseStorage = new NodeWorkspaceStorage(realWorkspaceDir);

    for (const entry of entries) {
      if (entry.isSymbolicLink()) {
        skipped.push({ relPath: `topics/${entry.name}/topic.md`, reason: "symbolic link topic directory skipped" });
        continue;
      }
      if (!entry.isDirectory()) continue;
      const relPath = `topics/${entry.name}/topic.md`;
      const fullPath = join(topicsDir, entry.name, "topic.md");
      const exists = await lstat(fullPath).then(() => true, error => {
        if (error && typeof error === "object" && error.code === "ENOENT") return false;
        throw error;
      });
      if (!exists) continue;

      const decision = await evaluateTopic({
        topicDirName: entry.name,
        relPath,
        fullPath,
        baseStorage,
      });
      if (decision.kind === "migrate") plans.push(decision);
      else skipped.push({ relPath: decision.relPath, reason: decision.reason });
    }
  }

  if (dryRun || plans.length === 0) {
    return {
      mode: dryRun ? "dry-run" : "live",
      backupDir: null,
      planned: plans.map(p => ({ relPath: p.relPath, materialIds: p.expectedMaterialIds })),
      migrated: [],
      skipped,
    };
  }

  const backupDir = await allocateBackupDir(realWorkspaceDir);
  for (const plan of plans) {
    const backupPath = join(backupDir, plan.relPath);
    await mkdir(dirname(backupPath), { recursive: true });
    await copyFile(plan.fullPath, backupPath, constants.COPYFILE_EXCL);
    const backedUpBytes = await readFile(backupPath);
    if (!backedUpBytes.equals(plan.originalBytes)) {
      throw new Error(`Backup verification failed for ${plan.relPath}`);
    }
  }

  let tempCounter = 0;
  const nextTempId = () => ++tempCounter;
  const tempPaths = new Set();
  const writtenPlans = [];

  try {
    for (const plan of plans) {
      await writeFileAtomically(plan.fullPath, plan.nextBytes, tempPaths, nextTempId);
      writtenPlans.push(plan);
    }

    const verifyStore = new DefaultWorkspaceStore(new NodeWorkspaceStorage(realWorkspaceDir));
    const verifyTopic = options.verifyTopic ?? (topicId => verifyStore.getTopic(topicId));
    for (const plan of plans) {
      const topic = await verifyTopic(plan.topicDirName, {
        workspaceDir: realWorkspaceDir,
        expectedMaterialIds: plan.expectedMaterialIds,
        store: verifyStore,
      });
      if (!topic) throw new Error(`Read-back verification returned null for ${plan.relPath}`);
      if (topic.id !== plan.topicDirName) throw new Error(`Read-back ID mismatch for ${plan.relPath}`);
      if (!idsEqual(topic.materialIds, plan.expectedMaterialIds)) {
        throw new Error(`Read-back materialIds mismatch for ${plan.relPath}`);
      }
    }

    return {
      mode: "live",
      backupDir,
      planned: plans.map(p => ({ relPath: p.relPath, materialIds: p.expectedMaterialIds })),
      migrated: plans.map(p => ({ relPath: p.relPath, materialIds: p.expectedMaterialIds })),
      skipped,
    };
  } catch (error) {
    const restoreErrors = [];
    for (const plan of writtenPlans) {
      const backupPath = join(backupDir, plan.relPath);
      try {
        const backupBytes = await readFile(backupPath);
        await writeFileAtomically(plan.fullPath, backupBytes, tempPaths, nextTempId);
        const restoredBytes = await readFile(plan.fullPath);
        if (!restoredBytes.equals(plan.originalBytes)) {
          restoreErrors.push(`${plan.relPath}: restored bytes do not match original`);
        }
      } catch (restoreErr) {
        restoreErrors.push(`${plan.relPath}: ${restoreErr instanceof Error ? restoreErr.message : String(restoreErr)}`);
      }
    }
    const baseMessage = error instanceof Error ? error.message : String(error);
    if (restoreErrors.length > 0) {
      throw new Error(`Migration failed (${baseMessage}); rollback errors: ${restoreErrors.join("; ")} (backupDir=${backupDir})`);
    }
    throw new Error(`Migration failed (${baseMessage}); restored ${writtenPlans.length} file(s) from ${backupDir}`);
  } finally {
    for (const tempPath of tempPaths) {
      await unlink(tempPath).catch(() => {});
    }
  }
}

export function parseCliArgs(argv) {
  let dryRun = false;
  let workspaceDir = null;
  for (const arg of argv) {
    if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}`);
    } else if (workspaceDir === null) {
      workspaceDir = arg;
    } else {
      throw new Error(`Unexpected argument: ${arg}`);
    }
  }
  if (!workspaceDir) {
    throw new Error("Usage: node scripts/migrate-topic-material-ids.mjs <workspaceDir> [--dry-run]");
  }
  return { workspaceDir, dryRun };
}

export async function runCli(argv = process.argv.slice(2), options = {}) {
  let parsed;
  try {
    parsed = parseCliArgs(argv);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }

  try {
    const result = await migrateTopicMaterialIds(parsed.workspaceDir, { ...options, dryRun: parsed.dryRun });
    for (const item of result.planned) {
      const tag = result.mode === "dry-run" ? "DRY-RUN" : "MIGRATE";
      console.log(`${tag} ${item.relPath}: [${item.materialIds.join(", ")}]`);
    }
    for (const item of result.skipped) {
      console.log(`SKIP ${item.relPath}: ${item.reason}`);
    }
    console.log(`mode: ${result.mode}`);
    console.log(`backupDir: ${result.backupDir ?? "none"}`);
    if (result.mode === "dry-run") console.log(`planned: ${result.planned.length}`);
    console.log(`migrated: ${result.migrated.length}`);
    console.log(`skipped: ${result.skipped.length}`);
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

function isMainModule() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMainModule()) {
  process.exitCode = await runCli(process.argv.slice(2));
}
