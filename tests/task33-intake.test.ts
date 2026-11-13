import { testToolkits } from "./guide-tools-fixture.ts";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { build } from "esbuild";
import { DefaultWorkspaceStore } from "../src/core/index.ts";
import { renderFile } from "../src/plugins/stage-reader/index.ts";
import { filterProseOnly } from "../src/plugins/speech-service/index.ts";
import { createScopedTools } from "../src/plugins/guide-acp/tools.ts";
import { createPithWebServer } from "../src/shells/web/server.ts";
import { NodeWorkspaceStorage } from "../src/shells/web/nodeStorage.ts";
import { initialMaterialAids } from "../src/workbench/toolkitSlot.ts";
import { importedMaterialKind, isMediaFile } from "../src/workbench/mediaAssets.ts";
import { testSandbox } from "./sandbox.ts";

test("only material reading aids are initialized from sampled language", () => {
  assert.deepEqual(initialMaterialAids("这是中文正文"), []);
  assert.deepEqual(initialMaterialAids("An English paragraph"), ["interline"]);
  assert.deepEqual(initialMaterialAids("AB中文"), ["interline"]);
  assert.deepEqual(initialMaterialAids("ABC你好!!!"), []);
  assert.deepEqual(initialMaterialAids(""), []);
  assert.equal(importedMaterialKind([{ name: "sample.ts", mimeType: "video/mp2t" }]), "article");
  assert.equal(isMediaFile({ name: "recording.flac", mimeType: "application/octet-stream" }), true);
});

test("source reader escapes markup, anchors every line and rejects binary", async () => {
  const file = { name: "example.abc", mimeType: "application/octet-stream", bytes: 0, sha256: "" };
  const view = await renderFile(file, new TextEncoder().encode('<script>alert("x")</script>\nsecond & third\n'));
  assert.match(view.html, /&lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt;/);
  assert.match(view.html, /data-locator="text:line:1"[^>]*>second &amp; third/);
  assert.deepEqual(view.blocks?.map(block => block.locator), ["text:line:0", "text:line:1", "text:line:2"]);
  await assert.rejects(renderFile(file, new Uint8Array([65, 0, 66])), /binary/);
  await assert.rejects(renderFile(file, new Uint8Array([255])), /binary/);
});

test("imported source remains trainable but is excluded from prose and guide validates bytes", async () => {
  const root = await testSandbox("audit-source-");
  try {
    const storage = new NodeWorkspaceStorage(root), store = new DefaultWorkspaceStore(storage);
    await store.ensureScaffold();
    const reader = { formats: ["markdown" as const], sections: () => [], render: () => "", renderFile };
    for (const [name, mimeType] of [["sample.ts", "video/mp2t"], ["module.py", "application/octet-stream"]]) {
      const bytes = new TextEncoder().encode("const answer = 42;\nnext line");
      const material = await store.importMaterial({ title: name!, kind: "article", files: [{ name: name!, mimeType: mimeType!, bytes }] });
      const topic = await store.createTopic({ title: name!, target: "Read source", materialIds: [material.id], toolkits: [] });
      const read = createScopedTools({ toolkits: testToolkits, topicId: topic.id, store, storage, reader, onChoices: () => {} }).find(tool => tool.name === "pith_read_material")!;
      const view = await renderFile(material.files[0]!, bytes);
      assert.deepEqual(filterProseOnly(view.blocks!), []);
      assert.match(view.html, /data-prose="false" data-trainable="true"/);
      assert.match((await read.execute({ materialId: material.id, file: name }) as { blocks: { text: string }[] }).blocks.map(block => block.text).join("\n"), /answer = 42/);
    }
    for (const name of ["prose.txt", "prose.abc"]) {
      const bytes = new TextEncoder().encode("Natural prose.\nAnother sentence.");
      const view = await renderFile({ name, mimeType: "application/octet-stream", bytes: bytes.length, sha256: "" }, bytes);
      assert.equal(filterProseOnly(view.blocks!).length, 2);
      assert.match(view.html, /data-prose="true"/);
    }
    for (const bytes of [new Uint8Array([65, 0, 66]), new Uint8Array([255])]) {
      const material = await store.importMaterial({ title: "invalid", kind: "article", files: [{ name: "invalid.ts", mimeType: "text/plain", bytes }] });
      const topic = await store.createTopic({ title: "invalid", target: "Read source", materialIds: [material.id], toolkits: [] });
      const read = createScopedTools({ toolkits: testToolkits, topicId: topic.id, store, storage, reader, onChoices: () => {} }).find(tool => tool.name === "pith_read_material")!;
      await assert.rejects(read.execute({ materialId: material.id, file: "invalid.ts" }), /binary/);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("real HTTP intake and repository binding preserve explicitly selected toolkit lists", async () => {
  const root = await testSandbox("task33-http-");
  const repo = join(root, "repo"), workspace = join(root, "workspace"); await mkdir(repo); await mkdir(workspace);
  const git = promisify(execFile), env = { PATH: process.env.PATH, HOME: root, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_AUTHOR_NAME: "Fixture", GIT_AUTHOR_EMAIL: "fixture@example.invalid", GIT_COMMITTER_NAME: "Fixture", GIT_COMMITTER_EMAIL: "fixture@example.invalid" };
  await git("git", ["-C", repo, "init", "-q"], { env }); await writeFile(join(repo, "source.ts"), "export const value = 1;\n"); await git("git", ["-C", repo, "add", "source.ts"], { env }); await git("git", ["-C", repo, "commit", "-qm", "fixture"], { env });
  const storage = new NodeWorkspaceStorage(workspace), store = new DefaultWorkspaceStore(storage);
  const server = await createPithWebServer({ workspaceDir: workspace, guideProvider: { async run(input, options) {
    assert.equal(input.scope.kind, "intake"); if (input.scope.kind !== "intake") throw new Error("intake required");
    const create = createScopedTools({ toolkits: testToolkits, store, storage, materialIds: input.scope.materialIds, onChoices() {} }).find(item => item.name === "pith_create_topic")!;
    const args = { title: input.text, target: input.text, materialIds: input.scope.materialIds, toolkits: input.text === "空工具" ? [] : ["feynman"] };
    const topic = await create.execute(args);
    options.onStep({ kind: "tool", callId: "create", name: create.name, inputPreview: "{}", status: "completed", effects: await create.effects!(topic, args) }, 0);
    return { status: "completed" };
  } } });
  try {
    const address = server.address(); assert.ok(address && typeof address !== "string"); const base = `http://127.0.0.1:${address.port}`;
    const post = async (path: string, value: unknown) => { const response = await fetch(base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(value) }); assert.equal(response.status, 201, await response.clone().text()); return response.json() as Promise<any>; };
    const material = await post("/api/materials/repo", { repoPath: repo }); assert.equal(material.kind, "repo"); assert.match(material.commitSha, /^[a-f0-9]{40,64}$/);
    assert.deepEqual((await post("/api/intake", { text: "仓库", materialIds: [material.id] })).topic.toolkits, ["feynman"]);
    assert.deepEqual((await post("/api/intake", { text: "空工具", materialIds: [material.id] })).topic.toolkits, []);
    const text = await post("/api/materials", { title: "标题", kind: "article", files: [{ name: "中文.ts", data: Buffer.from("这是中文正文").toString("base64") }] });
    assert.deepEqual((await post("/api/intake", { text: "标题", materialIds: [text.id] })).topic.toolkits, ["feynman"]);
  } finally { await new Promise<void>((ok, fail) => server.close(error => error ? fail(error) : ok())); await rm(root, { recursive: true, force: true }); }
});
