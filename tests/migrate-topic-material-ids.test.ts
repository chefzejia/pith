import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, readdir, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { DefaultWorkspaceStore, type Topic } from "../src/core/index.ts";
import { NodeWorkspaceStorage } from "../src/shells/web/nodeStorage.ts";
import { testSandbox } from "./sandbox.ts";

const SCRIPT_PATH = resolve("scripts/migrate-topic-material-ids.mjs");

type MigrateModule = {
  migrateTopicMaterialIds: (
    workspaceDir: string,
    options?: {
      dryRun?: boolean;
      verifyTopic?: (
        id: string,
        ctx: { workspaceDir: string; expectedMaterialIds: string[]; store: DefaultWorkspaceStore },
      ) => Promise<Topic | null>;
    },
  ) => Promise<unknown>;
};

function splitWithEol(text: string): string[] {
  const lines: string[] = [];
  let pos = 0;
  while (pos < text.length) {
    const nl = text.indexOf("\n", pos);
    if (nl < 0) {
      lines.push(text.slice(pos));
      break;
    }
    lines.push(text.slice(pos, nl + 1));
    pos = nl + 1;
  }
  return lines;
}

function assertOnlyMaterialsLinesChanged(before: Buffer, after: Buffer, expectedReplacements: number): void {
  assert.equal(Buffer.compare(before, after) !== 0, true, "expected file bytes to change");
  const beforeLines = splitWithEol(before.toString("utf8"));
  const afterLines = splitWithEol(after.toString("utf8"));
  assert.equal(beforeLines.length, afterLines.length, "line count must remain identical");
  let changed = 0;
  for (let i = 0; i < beforeLines.length; i++) {
    if (beforeLines[i] === afterLines[i]) continue;
    changed++;
    assert.match(beforeLines[i]!, /\[\[materials\/[a-z0-9]+(?:-[a-z0-9]+)*\/material\]\]/);
    assert.doesNotMatch(afterLines[i]!, /\[\[materials\//);
    const reconstructed = beforeLines[i]!.replace(/\[\[materials\/([a-z0-9]+(?:-[a-z0-9]+)*)\/material\]\]/g, "$1");
    assert.equal(afterLines[i], reconstructed);
  }
  assert.equal(changed, expectedReplacements);
}

async function setupRichWorkspace(root: string) {
  const workspace = join(root, "workspace");
  const fakeHome = join(root, "home");
  await mkdir(workspace, { recursive: true });
  await mkdir(fakeHome, { recursive: true });

  const storage = new NodeWorkspaceStorage(workspace);
  const store = new DefaultWorkspaceStore(storage);
  await store.ensureScaffold();

  const repoOne = await store.importMaterial({
    title: "Repo One",
    kind: "repo",
    externalPath: join(root, "repos/one"),
    commitSha: "1111111111111111111111111111111111111111",
    files: [],
  });
  const repoTwo = await store.importMaterial({
    title: "Repo Two",
    kind: "repo",
    externalPath: join(root, "repos/two"),
    commitSha: "2222222222222222222222222222222222222222",
    files: [],
  });
  const article = await store.importMaterial({
    title: "Article Alpha",
    kind: "article",
    files: [{ name: "doc.md", mimeType: "text/markdown", bytes: new TextEncoder().encode("# Doc\n\nBody paragraph.\n") }],
  });

  const writeTopic = async (dirName: string, content: string | Buffer) => {
    const dir = join(workspace, "topics", dirName);
    await mkdir(dir, { recursive: true });
    const filePath = join(dir, "topic.md");
    await writeFile(filePath, content);
    return filePath;
  };

  // 1. Legacy single material (LF) + lesson with basedOn + note + practice with result + body literal [[materials/...]]
  const topicAId = "topic-20261119-single-lf";
  const topicAContent = [
    "---",
    "type: pith-topic",
    `id: "${topicAId}"`,
    'title: "Single LF Topic"',
    'target: "Understand single material"',
    'status: "exploring"',
    "materials:",
    `  - "[[materials/${repoOne.id}/material]]"`,
    'nextAction: "Review lesson 01"',
    "toolkits:",
    '  - "feynman"',
    "lessons:",
    '  - name: "01-outline.md"',
    '    locator: "text:line:0"',
    '    lastActiveAt: "2026-11-19T10:05:00.000Z"',
    `    basedOn: "${repoOne.id}"`,
    'createdAt: "2026-11-19T10:00:00.000Z"',
    'updatedAt: "2026-11-19T10:10:00.000Z"',
    "---",
    "",
    "## [note] 2026-11-19T10:06:00.000Z",
    "<!-- pith-note:v1 -->",
    '- id: "n-1"',
    '- author: "user"',
    `- material: "${article.id}"`,
    '- file: "doc.md"',
    '- locator: "text:line:1"',
    "",
    "<!-- pith-note:quote -->",
    `> Literal text [[materials/${repoOne.id}/material]] must stay untouched`,
    "",
    "<!-- pith-note:body -->",
    "User note body",
    "",
    "<!-- pith-note:remark -->",
    "> [guide] Good observation",
    "",
    "<!-- pith-note:end -->",
    "",
    "## [practice] 2026-11-19T10:08:00.000Z",
    "<!-- pith-note:v1 -->",
    '- id: "n-2"',
    '- author: "user"',
    "- lesson: true",
    '- file: "01-outline.md"',
    '- locator: "text:line:2"',
    "",
    "<!-- pith-note:body -->",
    "My recall attempt",
    "",
    "<!-- pith-note:result -->",
    '{"items":[{"id":"k1","text":"Core point","status":"hit"}],"passage":"Original passage"}',
    "",
    "<!-- pith-note:end -->",
    "",
  ].join("\n");
  const topicAPath = await writeTopic(topicAId, topicAContent);
  await mkdir(join(workspace, "topics", topicAId, "lessons"), { recursive: true });
  await writeFile(join(workspace, "topics", topicAId, "lessons", "01-outline.md"), "# Outline\n");

  // 2. Legacy multi-material (CRLF, comment in frontmatter, single-quoted link, extra spaces, basedOn, practice)
  const topicBId = "topic-20261119-multi-crlf";
  const topicBContent = [
    "---",
    "# preserve comment",
    "type: pith-topic",
    `id: ${topicBId}`,
    "title: Multi CRLF Topic",
    "target: Compare multiple materials",
    "status: shelved",
    "materials:",
    `  - "[[materials/${repoOne.id}/material]]"`,
    `  -  '[[materials/${article.id}/material]]'`,
    `  - "[[materials/${repoTwo.id}/material]]"`,
    "toolkits: []",
    "lessons:",
    '  - name: "01-compare.md"',
    `    basedOn: "${repoOne.id},${repoTwo.id}"`,
    'createdAt: "2026-11-19T11:00:00.000Z"',
    'updatedAt: "2026-11-19T11:10:00.000Z"',
    "---",
    "",
    "## [practice] 2026-11-19T11:09:00.000Z",
    "<!-- pith-note:v1 -->",
    '- id: "n-3"',
    '- author: "user"',
    "",
    "<!-- pith-note:body -->",
    "CRLF recall",
    "",
    "<!-- pith-note:result -->",
    '{"items":[{"id":"k2","text":"Point B","status":"missing"}],"passage":"CRLF passage"}',
    "",
    "<!-- pith-note:end -->",
    "",
  ].join("\r\n");
  const topicBPath = await writeTopic(topicBId, topicBContent);
  await mkdir(join(workspace, "topics", topicBId, "lessons"), { recursive: true });
  await writeFile(join(workspace, "topics", topicBId, "lessons", "01-compare.md"), "# Compare\r\n");

  // 3. Legacy inline list
  const topicCId = "topic-20261119-inline";
  const topicCContent = [
    "---",
    "type: pith-topic",
    `id: "${topicCId}"`,
    'title: "Inline List"',
    'target: "Handle inline lists"',
    'status: "settled"',
    `materials: ["[[materials/${article.id}/material]]", '[[materials/${repoOne.id}/material]]']`,
    "toolkits: []",
    "lessons: []",
    'createdAt: "2026-11-19T12:00:00.000Z"',
    'updatedAt: "2026-11-19T12:10:00.000Z"',
    "---",
    "",
  ].join("\n");
  const topicCPath = await writeTopic(topicCId, topicCContent);

  // 4..10. Skip cases
  const plainTopic = await store.createTopic({
    title: "Already Plain",
    target: "Should be skipped",
    materialIds: [article.id],
    toolkits: [],
  });
  const emptyTopic = await store.createTopic({
    title: "Empty Materials",
    target: "Should be skipped",
    materialIds: [],
    toolkits: [],
  });

  const mixedId = "topic-skip-mixed";
  const mixedPath = await writeTopic(mixedId, [
    "---",
    "type: pith-topic",
    `id: "${mixedId}"`,
    'title: "Mixed"',
    'target: "Mixed"',
    'status: "exploring"',
    "materials:",
    `  - "[[materials/${article.id}/material]]"`,
    `  - "${repoOne.id}"`,
    "toolkits: []",
    "lessons: []",
    'createdAt: "2026-11-19T12:00:00.000Z"',
    'updatedAt: "2026-11-19T12:00:00.000Z"',
    "---",
    "",
  ].join("\n"));

  const invalidLinkId = "topic-skip-invalid-link";
  const invalidLinkPath = await writeTopic(invalidLinkId, [
    "---",
    "type: pith-topic",
    `id: "${invalidLinkId}"`,
    'title: "Invalid Link"',
    'target: "Bad link ID"',
    'status: "exploring"',
    "materials:",
    '  - "[[materials/Bad_ID/material]]"',
    "toolkits: []",
    "lessons: []",
    'createdAt: "2026-11-19T12:00:00.000Z"',
    'updatedAt: "2026-11-19T12:00:00.000Z"',
    "---",
    "",
  ].join("\n"));

  const missingListId = "topic-skip-missing-list";
  const missingListPath = await writeTopic(missingListId, [
    "---",
    "type: pith-topic",
    `id: "${missingListId}"`,
    'title: "Missing List"',
    'target: "Legacy without materials list"',
    'status: "exploring"',
    `materialId: "${article.id}"`,
    "toolkits: []",
    "lessons: []",
    'createdAt: "2026-11-19T12:00:00.000Z"',
    'updatedAt: "2026-11-19T12:00:00.000Z"',
    "---",
    "",
  ].join("\n"));

  const corruptId = "topic-skip-corrupt";
  const corruptPath = await writeTopic(corruptId, "not frontmatter at all\n");

  const mismatchId = "topic-skip-mismatch";
  const mismatchPath = await writeTopic(mismatchId, [
    "---",
    "type: pith-topic",
    'id: "different-id"',
    'title: "Mismatch"',
    'target: "Should stay unreadable"',
    'status: "exploring"',
    "materials:",
    `  - "[[materials/${article.id}/material]]"`,
    "toolkits: []",
    "lessons: []",
    'createdAt: "2026-11-19T12:00:00.000Z"',
    'updatedAt: "2026-11-19T12:00:00.000Z"',
    "---",
    "",
  ].join("\n"));

  return {
    workspace,
    fakeHome,
    store,
    repoOne,
    repoTwo,
    article,
    migrateTargets: [
      { id: topicAId, path: topicAPath, expectedIds: [repoOne.id], changedLines: 1 },
      { id: topicBId, path: topicBPath, expectedIds: [repoOne.id, article.id, repoTwo.id], changedLines: 3 },
      { id: topicCId, path: topicCPath, expectedIds: [article.id, repoOne.id], changedLines: 1 },
    ],
    skipTargets: [
      { id: plainTopic.id, path: join(workspace, "topics", plainTopic.id, "topic.md"), reason: /already plain material IDs/ },
      { id: emptyTopic.id, path: join(workspace, "topics", emptyTopic.id, "topic.md"), reason: /empty materials list/ },
      { id: mixedId, path: mixedPath, reason: /mixed plain and double-link/ },
      { id: invalidLinkId, path: invalidLinkPath, reason: /invalid or non-legacy/ },
      { id: missingListId, path: missingListPath, reason: /missing materials list/ },
      { id: corruptId, path: corruptPath, reason: /invalid frontmatter/ },
      { id: mismatchId, path: mismatchPath, reason: /unreadable legacy topic/ },
    ],
  };
}

test("--dry-run prints plan and reasons without creating backups or touching files", async () => {
  const root = await testSandbox("migrate-dryrun-");
  try {
    const f = await setupRichWorkspace(root);
    const allPaths = [...f.migrateTargets.map(t => t.path), ...f.skipTargets.map(t => t.path)];
    const originals = await Promise.all(allPaths.map(p => readFile(p)));

    const run = spawnSync(process.execPath, [SCRIPT_PATH, f.workspace, "--dry-run"], {
      env: { ...process.env, HOME: f.fakeHome },
      encoding: "utf8",
    });
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /^mode: dry-run$/m);
    assert.match(run.stdout, /^backupDir: none$/m);
    assert.match(run.stdout, /^planned: 3$/m);
    assert.match(run.stdout, /^migrated: 0$/m);
    assert.match(run.stdout, /^skipped: 7$/m);
    for (const target of f.migrateTargets) {
      assert.match(run.stdout, new RegExp(`^DRY-RUN topics/${target.id}/topic\\.md:`, "m"));
    }
    for (const skip of f.skipTargets) {
      assert.match(run.stdout, new RegExp(`^SKIP topics/${skip.id}/topic\\.md: .*${skip.reason.source}`, "m"));
    }

    assert.deepEqual(await readdir(f.fakeHome), [], "dry-run must not create any files or directories under HOME");
    for (let i = 0; i < allPaths.length; i++) {
      assert.equal(Buffer.compare(await readFile(allPaths[i]!), originals[i]!), 0);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("live migration converts only materials lines, stores byte-for-byte backups outside workspace, preserves unreadable topics, and is idempotent on rerun", async () => {
  const root = await testSandbox("migrate-live-");
  try {
    const f = await setupRichWorkspace(root);
    const migrateBefore = await Promise.all(f.migrateTargets.map(t => readFile(t.path)));
    const skipBefore = await Promise.all(f.skipTargets.map(async t => ({ bytes: await readFile(t.path), stat: await stat(t.path) })));

    const run1 = spawnSync(process.execPath, [SCRIPT_PATH, f.workspace], {
      env: { ...process.env, HOME: f.fakeHome },
      encoding: "utf8",
    });
    assert.equal(run1.status, 0, run1.stderr);
    assert.match(run1.stdout, /^mode: live$/m);
    assert.match(run1.stdout, /^migrated: 3$/m);
    assert.match(run1.stdout, /^skipped: 7$/m);

    const backupMatch = /^backupDir: (.+)$/m.exec(run1.stdout);
    assert.ok(backupMatch && backupMatch[1] && backupMatch[1] !== "none");
    const backupDir = backupMatch[1].trim();
    const expectedBackupRoot = await realpath(join(f.fakeHome, "Library/Application Support/pith/backups"));
    const realWorkspace = await realpath(f.workspace);
    assert.equal(relative(expectedBackupRoot, backupDir).startsWith(".."), false, "backup must live under $HOME/Library/Application Support/pith/backups");
    assert.equal(relative(realWorkspace, backupDir).startsWith(".."), true, "backup must live outside workspace");

    // Backup contains exact original bytes for modified files only
    const backedUpTopics = await readdir(join(backupDir, "topics"));
    assert.deepEqual(backedUpTopics.sort(), f.migrateTargets.map(t => t.id).sort());
    for (let i = 0; i < f.migrateTargets.length; i++) {
      const target = f.migrateTargets[i]!;
      const backupBytes = await readFile(join(backupDir, "topics", target.id, "topic.md"));
      assert.equal(Buffer.compare(backupBytes, migrateBefore[i]!), 0, `backup mismatch for ${target.id}`);
      const afterBytes = await readFile(target.path);
      assertOnlyMaterialsLinesChanged(migrateBefore[i]!, afterBytes, target.changedLines);

      // Readable via DefaultWorkspaceStore with full fidelity
      const loaded = await f.store.getTopic(target.id);
      assert.ok(loaded, `expected ${target.id} to parse cleanly`);
      assert.deepEqual(loaded.materialIds, target.expectedIds);
    }

    // Verify note / practice result / basedOn fidelity on migrated topics
    const loadedA = (await f.store.getTopic(f.migrateTargets[0]!.id))!;
    assert.equal(loadedA.lessons[0]?.basedOn?.[0], f.repoOne.id);
    assert.equal(loadedA.notes.length, 2);
    assert.equal(loadedA.notes[0]?.anchor?.quote, `Literal text [[materials/${f.repoOne.id}/material]] must stay untouched`);
    assert.equal(loadedA.notes[0]?.guideRemark, "Good observation");
    assert.deepEqual(loadedA.notes[1]?.result, { items: [{ id: "k1", text: "Core point", status: "hit" }], passage: "Original passage" });

    const loadedB = (await f.store.getTopic(f.migrateTargets[1]!.id))!;
    assert.equal(loadedB.status, "shelved");
    assert.deepEqual(loadedB.lessons[0]?.basedOn, [f.repoOne.id, f.repoTwo.id]);
    assert.deepEqual(loadedB.notes[0]?.result, { items: [{ id: "k2", text: "Point B", status: "missing" }], passage: "CRLF passage" });

    // Skipped files untouched byte-for-byte and same inode/mtime
    for (let i = 0; i < f.skipTargets.length; i++) {
      const skip = f.skipTargets[i]!;
      const afterBytes = await readFile(skip.path);
      const afterStat = await stat(skip.path);
      assert.equal(Buffer.compare(afterBytes, skipBefore[i]!.bytes), 0);
      assert.equal(afterStat.ino, skipBefore[i]!.stat.ino);
      assert.equal(afterStat.mtimeMs, skipBefore[i]!.stat.mtimeMs);
    }

    // Unreadable list excludes all migrated + valid topics and retains corrupted/invalid ones
    const unreadableIds = (await f.store.listUnreadable()).map(entry => entry.id).sort();
    assert.deepEqual(unreadableIds, [
      "topic-skip-corrupt",
      "topic-skip-invalid-link",
      "topic-skip-mismatch",
      "topic-skip-missing-list",
      "topic-skip-mixed",
    ]);

    // No stray temp files
    for (const entry of await readdir(join(f.workspace, "topics"))) {
      const files = await readdir(join(f.workspace, "topics", entry));
      assert.equal(files.some(name => name.includes(".tmp")), false, `stray temp file in ${entry}`);
    }

    // Second run modifies 0 files, creates no new backups, preserves inodes & mtimes
    const afterFirstAll = await Promise.all([...f.migrateTargets, ...f.skipTargets].map(async t => ({
      path: t.path,
      bytes: await readFile(t.path),
      stat: await stat(t.path),
    })));
    const backupsBeforeSecond = await readdir(expectedBackupRoot);

    const run2 = spawnSync(process.execPath, [SCRIPT_PATH, f.workspace], {
      env: { ...process.env, HOME: f.fakeHome },
      encoding: "utf8",
    });
    assert.equal(run2.status, 0, run2.stderr);
    assert.match(run2.stdout, /^mode: live$/m);
    assert.match(run2.stdout, /^backupDir: none$/m);
    assert.match(run2.stdout, /^migrated: 0$/m);
    assert.match(run2.stdout, /^skipped: 10$/m);
    assert.deepEqual(await readdir(expectedBackupRoot), backupsBeforeSecond);
    for (const prev of afterFirstAll) {
      const nowStat = await stat(prev.path);
      assert.equal(Buffer.compare(await readFile(prev.path), prev.bytes), 0);
      assert.equal(nowStat.ino, prev.stat.ino);
      assert.equal(nowStat.mtimeMs, prev.stat.mtimeMs);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("read-back failure restores ALL modified files from backup byte-for-byte and exits non-zero", async () => {
  const root = await testSandbox("migrate-rollback-");
  const prevHome = process.env.HOME;
  try {
    const workspace = join(root, "workspace");
    const fakeHome = join(root, "home");
    await mkdir(workspace, { recursive: true });
    await mkdir(fakeHome, { recursive: true });

    const store = new DefaultWorkspaceStore(new NodeWorkspaceStorage(workspace));
    await store.ensureScaffold();
    const mat = await store.importMaterial({ title: "Mat", kind: "article", files: [] });

    const makeLegacy = async (id: string, title: string) => {
      const dir = join(workspace, "topics", id);
      await mkdir(dir, { recursive: true });
      const content = [
        "---",
        "type: pith-topic",
        `id: "${id}"`,
        `title: "${title}"`,
        'target: "Learn"',
        'status: "exploring"',
        "materials:",
        `  - "[[materials/${mat.id}/material]]"`,
        "toolkits: []",
        "lessons: []",
        'createdAt: "2026-11-19T00:00:00.000Z"',
        'updatedAt: "2026-11-19T00:00:00.000Z"',
        "---",
        "",
      ].join("\n");
      const filePath = join(dir, "topic.md");
      await writeFile(filePath, content);
      return { id, filePath, original: Buffer.from(content, "utf8") };
    };

    const t1 = await makeLegacy("topic-20261119-first", "First");
    const t2 = await makeLegacy("topic-20261119-second", "Second");

    // 1. Subprocess CLI non-zero exit + byte-for-byte rollback when read-back returns null on second topic
    const scriptUrl = pathToFileURL(SCRIPT_PATH).href;
    const childCode = `
      import { runCli } from ${JSON.stringify(scriptUrl)};
      let calls = 0;
      const code = await runCli([${JSON.stringify(workspace)}], {
        verifyTopic: async (id, ctx) => {
          calls++;
          if (calls === 1) return ctx.store.getTopic(id);
          return null;
        },
      });
      process.exitCode = code;
    `;
    const child = spawnSync(process.execPath, ["--input-type=module", "-e", childCode], {
      env: { ...process.env, HOME: fakeHome },
      encoding: "utf8",
    });
    assert.notEqual(child.status, 0);
    assert.match(child.stderr, /restored 2 file\(s\)/);
    assert.equal(Buffer.compare(await readFile(t1.filePath), t1.original), 0, "first topic must be restored");
    assert.equal(Buffer.compare(await readFile(t2.filePath), t2.original), 0, "second topic must be restored");

    // 2. Direct function checks for throwing and mismatched materialIds
    const { migrateTopicMaterialIds } = (await import(scriptUrl)) as MigrateModule;
    process.env.HOME = fakeHome;
    await assert.rejects(
      migrateTopicMaterialIds(workspace, {
        verifyTopic: async () => { throw new Error("Injected read-back failure"); },
      }),
      /Injected read-back failure.*restored 2 file\(s\)/,
    );
    assert.equal(Buffer.compare(await readFile(t1.filePath), t1.original), 0);
    assert.equal(Buffer.compare(await readFile(t2.filePath), t2.original), 0);

    await assert.rejects(
      migrateTopicMaterialIds(workspace, {
        verifyTopic: async (id: string) => ({
          id,
          title: "x",
          target: "x",
          status: "exploring",
          materialIds: ["wrong-id"],
          toolkits: [],
          lessons: [],
          notes: [],
          createdAt: "",
          updatedAt: "",
        }),
      }),
      /Read-back materialIds mismatch.*restored 2 file\(s\)/,
    );
    assert.equal(Buffer.compare(await readFile(t1.filePath), t1.original), 0);
    assert.equal(Buffer.compare(await readFile(t2.filePath), t2.original), 0);

    for (const id of [t1.id, t2.id]) {
      const entries = await readdir(join(workspace, "topics", id));
      assert.deepEqual(entries, ["topic.md"]);
    }
  } finally {
    if (prevHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome;
    await rm(root, { recursive: true, force: true });
  }
});

test("handles edge cases: empty workspace, invalid CLI args, and materials at end of frontmatter without trailing newline", async () => {
  const root = await testSandbox("migrate-edge-");
  try {
    const emptyWs = join(root, "empty-ws");
    const fakeHome = join(root, "home");
    await mkdir(emptyWs, { recursive: true });
    await mkdir(fakeHome, { recursive: true });

    const emptyRun = spawnSync(process.execPath, [SCRIPT_PATH, emptyWs], {
      env: { ...process.env, HOME: fakeHome },
      encoding: "utf8",
    });
    assert.equal(emptyRun.status, 0, emptyRun.stderr);
    assert.match(emptyRun.stdout, /^backupDir: none$/m);
    assert.match(emptyRun.stdout, /^migrated: 0$/m);
    assert.match(emptyRun.stdout, /^skipped: 0$/m);

    const missingRun = spawnSync(process.execPath, [SCRIPT_PATH, join(root, "does-not-exist")], {
      env: { ...process.env, HOME: fakeHome },
      encoding: "utf8",
    });
    assert.notEqual(missingRun.status, 0);

    const badArgRun = spawnSync(process.execPath, [SCRIPT_PATH, "--unknown"], {
      env: { ...process.env, HOME: fakeHome },
      encoding: "utf8",
    });
    assert.notEqual(badArgRun.status, 0);

    // Materials as final frontmatter property and no trailing newline at EOF
    const ws = join(root, "eof-ws");
    await mkdir(join(ws, "topics", "topic-eof"), { recursive: true });
    const rawNoEof = [
      "---",
      "type: pith-topic",
      'id: "topic-eof"',
      'title: "EOF"',
      'target: "Test EOF"',
      'status: "exploring"',
      "toolkits: []",
      "lessons: []",
      'createdAt: "2026-11-19T00:00:00.000Z"',
      'updatedAt: "2026-11-19T00:00:00.000Z"',
      "materials:",
      '  - "[[materials/material-eof-1/material]]"',
      "---",
    ].join("\n");
    const topicPath = join(ws, "topics", "topic-eof", "topic.md");
    await writeFile(topicPath, rawNoEof);

    const run = spawnSync(process.execPath, [SCRIPT_PATH, ws], {
      env: { ...process.env, HOME: fakeHome },
      encoding: "utf8",
    });
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /^migrated: 1$/m);
    const after = await readFile(topicPath, "utf8");
    assert.equal(after.endsWith("---"), true, "EOF without trailing newline must be preserved");
    assertOnlyMaterialsLinesChanged(Buffer.from(rawNoEof, "utf8"), Buffer.from(after, "utf8"), 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
