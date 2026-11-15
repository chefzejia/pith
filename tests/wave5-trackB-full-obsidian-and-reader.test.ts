import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { Script } from "node:vm";
import test from "node:test";
import { DefaultWorkspaceStore, type ToolkitDescriptor } from "../src/core/index.ts";
import { PithObsidianController, createObsidianHostPort } from "../src/shells/obsidian/index.ts";
import { NodeWorkspaceStorage } from "../src/shells/web/nodeStorage.ts";
import { createPithWebServer } from "../src/shells/web/server.ts";

const exec = promisify(execFile);

test("Obsidian controller persists quoted conversation and practice from both registered toolkits", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pith-track-b-"));
  const storage = new NodeWorkspaceStorage(dir);
  const adapter = {
    getFullPath: (path: string) => join(dir, path),
    exists: (path: string) => storage.exists(path), read: (path: string) => storage.readText(path),
    readBinary: async (path: string) => new Uint8Array(await storage.readBinary(path)).buffer,
    write: (path: string, value: string) => storage.writeText(path, value),
    writeBinary: (path: string, value: ArrayBuffer) => storage.writeBinary(path, new Uint8Array(value)),
    mkdir: (path: string) => storage.mkdir(path),
    list: async (path: string) => { const entries = await storage.list(path); return { files: entries.filter(item => item.type === "file").map(item => item.path), folders: entries.filter(item => item.type === "folder").map(item => item.path) }; },
  };
  const controller = new PithObsidianController(createObsidianHostPort(adapter, "Pith", undefined, adapter));
  try {
    await controller.initialize();
    const topic = await controller.store.createTopic({ title: "阅读", target: "理解" , materialIds: [], toolkits: [] });
    await controller.store.writeLesson(topic.id, "article.md", "quoted text");
    const anchor = { source: { kind: "lesson" as const }, file: "article.md", locator: "text:offset:8", quote: "quoted text" };
    await controller.engine.runTurn({ topicId: topic.id, text: "解释一下", anchor });
    assert.deepEqual((await controller.engine.getConversation(topic.id))[0]!.user.anchor, anchor);
    for (const id of ["shadowing", "feynman"]) {
      const toolkit = controller.runtime.getService<ToolkitDescriptor>(`toolkit.${id}`); assert.ok(toolkit);
      assert.equal(toolkit.stages.length, toolkit.id === "feynman" ? 1 : 4);
      for (const stage of toolkit.stages) assert.ok(toolkit.transformCue("A useful concept", stage));
      const body = toolkit.diagnose ? toolkit.diagnose("A useful concept", "useful concept").summaryMarkdown : "useful concept";
      await controller.engine.capture({ owner: { topicId: topic.id }, kind: "practice", body, anchor });
    }
    const saved = await controller.store.getTopic(topic.id); assert.ok(saved);
    assert.equal(saved.notes.filter(note => note.kind === "practice").length, 2);
    assert.deepEqual(saved.notes[0]!.anchor, anchor);
  } finally { controller.dispose(); await rm(dir, { recursive: true, force: true }); }
});

test("Obsidian build and web reader script expose production controls", async t => {
  const buildRoot = await mkdtemp(join(tmpdir(), "pith-reader-build-"));
  t.after(() => rm(buildRoot, { recursive: true, force: true }));
  for (const path of ["package.json", "manifest.json", "scripts", "src"]) await cp(resolve(path), join(buildRoot, path), { recursive: true });
  await symlink(resolve("node_modules"), join(buildRoot, "node_modules"), "dir");
  await exec(process.execPath, ["scripts/build-obsidian.mjs"], { cwd: buildRoot, env: { ...process.env, HOME: buildRoot } });
  const [main, manifest, styles] = await Promise.all(["dist/obsidian/main.js", "dist/obsidian/manifest.json", "dist/obsidian/styles.css"].map(path => readFile(join(buildRoot, path), "utf8")));
  assert.ok(main && styles); assert.equal(JSON.parse(manifest!).id, "pith");
  assert.doesNotMatch(main!, /此视图尚未提供/);
  assert.match(styles!, /\.pith-toolkit-panel/);
  const workspace = await mkdtemp(join(tmpdir(), "pith-reader-http-"));
  const server = await createPithWebServer({ workspaceDir: workspace });
  try {
    const address = server.address(); assert.ok(address && typeof address !== "string");
    const script = await (await fetch(`http://127.0.0.1:${address.port}/app.js`)).text();
    assert.doesNotThrow(() => new Script(script));
    for (const token of ["pith-page-mode", "columnWidth", "data-toolkit-stage", "data-toolkit-save", "prefix"]) assert.ok(script.includes(token), token);
  } finally { await new Promise<void>((resolveClose, reject) => server.close(error => error ? reject(error) : resolveClose())); await rm(workspace, { recursive: true, force: true }); }
});

test("web toolkit API defaults to shadowing and validates explicit toolkit", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pith-track-b-web-"));
  let server: Awaited<ReturnType<typeof createPithWebServer>> | undefined;
  try {
    const store = new DefaultWorkspaceStore(new NodeWorkspaceStorage(dir));
    const topic = await store.createTopic({ title: "理解", target: "理解概念", materialIds: [], toolkits: ["shadowing", "feynman"] });
    server = await createPithWebServer({ workspaceDir: dir, port: 0 });
    const address = server.address(); assert.ok(address && typeof address !== "string");
    const base = `http://127.0.0.1:${address.port}`;
    const post = (path: string, data: unknown) => fetch(base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data) });
    const data = { topicId: topic.id, targetText: "A useful concept", stage: "blind-produce" };
    const old = await post("/api/toolkit/transform", data); assert.equal(old.status, 200); assert.equal((await old.json()).text, "A useful concept");
    const modern = await post("/api/toolkit/transform", { ...data, toolkit: "feynman" }); assert.equal(modern.status, 200); assert.match((await modern.json()).text, /解释/);
    assert.equal((await post("/api/toolkit/transform", { ...data, toolkit: "invalid" })).status, 400);
  } finally { if (server) await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve())); await rm(dir, { recursive: true, force: true }); }
});
