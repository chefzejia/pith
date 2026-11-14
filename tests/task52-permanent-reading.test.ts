import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { DefaultWorkspaceStore, parseFrontmatter } from "../src/core/index.ts";
import { NodeWorkspaceStorage } from "../src/shells/web/nodeStorage.ts";
import { MaterialSession } from "../src/workbench/materialSession.ts";
import { boardMaterials } from "../src/workbench/boardMaterials.ts";
import { materialReadings, readMaterialReading, rememberMaterialReading } from "../src/workbench/readingState.ts";
import { testSandbox } from "./sandbox.ts";

const timestamp = "2026-11-14T03:00:00.000Z";
async function diskMaterial(root: string, kind: "repo" | "article", fields = "") {
  const id = `material-${kind}`, directory = join(root, "materials", id);
  await mkdir(join(directory, "files"), { recursive: true });
  const text = "# Original\n\nPermanent evidence.\n", sha = createHash("sha256").update(text).digest("hex");
  const files = kind === "repo" ? "files: []" : "files:\n" + ["a.md", "b.md", "c.md"].map(name => `  - name: "${name}"\n    mimeType: "text/markdown"\n    bytes: ${Buffer.byteLength(text)}\n    sha256: "${sha}"`).join("\n");
  if (kind !== "repo") for (const file of ["a.md", "b.md", "c.md"]) await writeFile(join(directory, "files", file), text);
  const path = join(directory, "material.md");
  await writeFile(path, `---\ntype: pith-material\nid: ${id}\ntitle: "Disk ${kind}"\nkind: ${kind}\naids: [interline]\ncreatedAt: "${timestamp}"\n${kind === "repo" ? 'externalPath: "/fixture/repository"\ncommitSha: "' + "a".repeat(40) + '"\n' : ""}${files}\n${fields}---\n\n# Material body stays intact\n`);
  return { id, path, directory, text };
}

for (const kind of ["repo", "article"] as const) for (const withLocator of [true, false]) test(`disk ${kind} last file/${withLocator ? "coordinate" : "no coordinate"} survives deleting all cache and rebuilding Store/session`, async () => {
  const root = await testSandbox("permanent-reading-");
  try {
    const disk = await diskMaterial(root, kind), storage = new NodeWorkspaceStorage(root), store = new DefaultWorkspaceStore(storage);
    await store.ensureScaffold();
    await store.appendMaterialNote(disk.id, { kind: "note", author: "user", body: "Independent material evidence" });
    const before = (await store.getMaterial(disk.id))!, beforeBytes = parseFrontmatter(await readFile(disk.path, "utf8"));
    const file = kind === "repo" ? "packages/core/nested/reader.ts" : "b.md", locator = kind === "repo" ? `repo:${"a".repeat(40)}:${file}#L12-L12` : "text:line:12;offset:4";
    const start = Date.now();
    await rememberMaterialReading(store, disk.id, file, withLocator ? locator : undefined);
    await rememberMaterialReading(store, disk.id, file); // actual afterOpen notifications carry no coordinate
    const saved = (await store.getMaterial(disk.id))!.reading;
    await mkdir(join(root, "_cache/reading"), { recursive: true });
    await writeFile(join(root, "_cache/reading", disk.id + ".json"), JSON.stringify({ file: "wrong.md", locator: "page:99", openedAt: timestamp }));
    assert.deepEqual(readMaterialReading((await store.getMaterial(disk.id))!), saved, "old cache must be ignored even while present");
    await rm(join(root, "_cache"), { recursive: true, force: true });
    const restarted = new DefaultWorkspaceStore(new NodeWorkspaceStorage(root)); await restarted.ensureScaffold();
    const after = (await restarted.getMaterial(disk.id))!;
    assert.ok(after.reading, "permanent reading must survive deleting the entire cache and rebuilding Store");
    assert.ok(saved);
    assert.equal(after.reading.file, file); assert.equal(after.reading.locator, withLocator ? locator : undefined);
    assert.ok(Date.parse(after.reading.openedAt) >= start && Date.parse(after.reading.openedAt) <= Date.now());
    assert.deepEqual(after.reading, saved, "file, coordinate and openedAt are durable facts");
    assert.deepEqual(after.files, before.files); assert.deepEqual(after.aids, before.aids); assert.deepEqual(after.notes, before.notes);
    const afterBytes = parseFrontmatter(await readFile(disk.path, "utf8"));
    for (const key of Object.keys(beforeBytes.attributes)) assert.deepEqual(afterBytes.attributes[key], beforeBytes.attributes[key], key);
    assert.equal(afterBytes.body, beforeBytes.body);
    assert.equal(afterBytes.attributes.readingFile, file); assert.equal(afterBytes.attributes.readingOpenedAt, saved.openedAt);
    assert.equal(afterBytes.attributes.readingLocator, saved.locator);
    assert.deepEqual((await boardMaterials(storage, [after]))[0]!.reading, saved);
    const state = { topic: null, materials: [after], repositoryFiles: kind === "repo" ? { [disk.id]: ["README.md", file] } : {}, readings: materialReadings([after]) };
    let rendered: { locator?: string } | undefined;
    const session = new MaterialSession(state, { title: after.title, active: () => true, loadState: async () => state, readFile: async () => ({ html: "<p>Real session adapter document</p>", sections: [] }), readOutline: async () => undefined, render: document => { rendered = document; }, updateNavigation() {}, beforeLesson: async () => {}, sendLesson: async () => {} });
    await session.open(); assert.equal(session.file, file); assert.equal(rendered!.locator, saved.locator); session.dispose();
    if (kind !== "repo") assert.equal(await readFile(join(disk.directory, "files/b.md"), "utf8"), disk.text);
    assert.deepEqual(await restarted.listUnreadable(), []);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("recordReading keeps only the selected file's position and serializes with other ledger writers", async () => {
  const root = await testSandbox("reading-switch-");
  try {
    const disk = await diskMaterial(root, "article"), store = new DefaultWorkspaceStore(new NodeWorkspaceStorage(root));
    await store.updateReadingLocator(disk.id, "a.md", "text:line:8");
    await store.recordReading(disk.id, { file: "a.md", locator: "text:line:9" });
    await store.recordReading(disk.id, { file: "a.md" }); assert.equal((await store.getMaterial(disk.id))!.reading!.locator, "text:line:9");
    await store.recordReading(disk.id, { file: "b.md" }); assert.equal((await store.getMaterial(disk.id))!.reading!.locator, undefined);
    await store.recordReading(disk.id, { file: "a.md" }); assert.equal((await store.getMaterial(disk.id))!.reading!.locator, "text:line:8", "switching back uses the selected file's own locator");
    const other = new DefaultWorkspaceStore(new NodeWorkspaceStorage(root));
    await Promise.all([store.recordReading(disk.id, { file: "c.md" }), other.setMaterialAids(disk.id, []), other.appendMaterialNote(disk.id, { kind: "note", author: "user", body: "Concurrent evidence" })]);
    const updated = (await store.getMaterial(disk.id))!;
    assert.equal(updated.reading!.file, "c.md"); assert.deepEqual(updated.aids, []); assert.equal(updated.notes.length, 1); assert.equal(updated.files[0]!.locator, "text:line:8");
  } finally { await rm(root, { recursive: true, force: true }); }
});

const malformed = [
  ['readingFile: "nested/../escape.ts"\nreadingOpenedAt: "' + timestamp + '"\n', /readingFile path/],
  ['readingFile: "nested/reader.ts"\n', /appear together/],
  ['readingLocator: "text:line:9"\n', /appear together/],
  ['readingFile: "/absolute.ts"\nreadingOpenedAt: "' + timestamp + '"\n', /readingFile path/],
  ['readingFile: "nested/reader.ts"\nreadingOpenedAt: "2026-02-30T00:00:00Z"\n', /ISO timestamp/],
  ['readingFile: "nested/reader.ts"\nreadingOpenedAt: "today"\n', /ISO timestamp/],
  ['readingFile: "nested/reader.ts"\nreadingOpenedAt: "' + timestamp + '"\nreadingLocator: ""\n', /readingLocator/],
  ['readingFile: "nested/reader.ts"\nreadingOpenedAt: "' + timestamp + '"\nreadingLocator: 2\n', /readingLocator/],
] as const;
for (const [fields, reason] of malformed) test(`malformed on-disk reading is isolated: ${fields.split("\n")[0]}`, async () => {
  const root = await testSandbox("reading-invalid-");
  try {
    const disk = await diskMaterial(root, "repo", fields), bytes = await readFile(disk.path, "utf8"), store = new DefaultWorkspaceStore(new NodeWorkspaceStorage(root));
    assert.deepEqual(await store.listMaterials(), []);
    const unreadable = await store.listUnreadable(); assert.equal(unreadable.length, 1); assert.equal(unreadable[0]!.id, disk.id); assert.match(unreadable[0]!.error, reason);
    await assert.rejects(store.getMaterial(disk.id), reason); assert.equal(await readFile(disk.path, "utf8"), bytes);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("recordReading rejects unsafe paths, bad locators and missing ordinary files without writing", async () => {
  const root = await testSandbox("reading-reject-");
  try {
    const repo = await diskMaterial(root, "repo"), ordinary = await diskMaterial(root, "article"), store = new DefaultWorkspaceStore(new NodeWorkspaceStorage(root));
    const bytes = await readFile(repo.path, "utf8");
    for (const file of ["", "\0", "/abs.ts", "C:/abs.ts", "C:\\abs.ts", "nested/../abs.ts", "../abs.ts"]) await assert.rejects(store.recordReading(repo.id, { file }));
    for (const locator of ["", "\0", "line\n2"]) await assert.rejects(store.recordReading(repo.id, { file: "nested/ok.ts", locator }));
    assert.equal(await readFile(repo.path, "utf8"), bytes);
    await assert.rejects(store.recordReading(ordinary.id, { file: "missing.md" }), /not found/);
    await store.recordReading(repo.id, { file: "nested/./ok.ts" }); assert.equal((await store.getMaterial(repo.id))!.reading!.file, "nested/./ok.ts");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("old cached reading alone is ignored, never migrated", async () => {
  const root = await testSandbox("reading-legacy-cache-");
  try {
    const disk = await diskMaterial(root, "repo"), store = new DefaultWorkspaceStore(new NodeWorkspaceStorage(root));
    await mkdir(join(root, "_cache/reading"), { recursive: true });
    await writeFile(join(root, "_cache/reading", disk.id + ".json"), JSON.stringify({ file: "nested/old.ts", locator: "text:line:9", openedAt: timestamp }));
    const bytes = await readFile(disk.path, "utf8"), material = (await store.getMaterial(disk.id))!;
    assert.equal(readMaterialReading(material), undefined); assert.deepEqual(materialReadings([material]), {}); assert.equal((await boardMaterials(new NodeWorkspaceStorage(root), [material]))[0]!.reading, undefined);
    assert.equal(await readFile(disk.path, "utf8"), bytes);
  } finally { await rm(root, { recursive: true, force: true }); }
});
