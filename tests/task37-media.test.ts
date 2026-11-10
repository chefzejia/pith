import assert from "node:assert/strict";
import { watch } from "node:fs";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { DefaultWorkspaceStore } from "../src/core/index.ts";
import { createGuideWorkspaceTools } from "../src/plugins/guide-acp/tools.ts";
import { NodeMediaCorpusPort, publicHost } from "../src/shells/web/nodeMediaCorpus.ts";
import { NodeWorkspaceStorage } from "../src/shells/web/nodeStorage.ts";
import { testSandbox } from "./sandbox.ts";

const fixture = `#!/usr/bin/env node
const fs = require('node:fs'); const net = require('node:net'); const path = require('node:path'); const args = process.argv.slice(2);
if (!args.includes('--ignore-config') || !args.includes('--no-plugin-dirs') || process.env.CLAUDE_CONFIG_DIR) process.exit(4);
const proxy = new URL(args[args.indexOf('--proxy') + 1]);
const url = args.at(-1);
if (url.startsWith('ytsearch')) {
  const socket = net.connect(Number(proxy.port), proxy.hostname);
  let response = ''; socket.on('connect', () => socket.write('CONNECT 127.0.0.1:443 HTTP/1.1\\r\\nHost: 127.0.0.1\\r\\n\\r\\n'));
  socket.on('data', chunk => { response += chunk; }); socket.on('close', () => { if (response.includes('200 Connection')) process.exit(7); console.log(JSON.stringify({id:'abcdefghijk',title:'Fixture',webpage_url:'https://8.8.8.8/watch',duration:42,uploader:'Fixture'})); });
} else if (url.includes('cancel')) { process.on('SIGTERM', () => { fs.writeFileSync(path.join(__dirname, 'stopped'), 'yes'); process.exit(0); }); fs.writeFileSync(path.join(__dirname, 'started'), 'yes'); setInterval(() => {}, 1000); }
else if (url.includes('symlink')) { fs.symlinkSync('/etc/passwd','bad.vtt'); }
else if (url.includes('partial') && !args.includes('--skip-download')) { process.exit(2); }
else if (args.includes('--skip-download')) { fs.writeFileSync('clip.en.vtt','WEBVTT\\n\\n00:00.000 --> 00:01.000\\nHello\\n'); }
else { fs.writeFileSync('clip.webm', Buffer.from([1,2,3,4])); console.log('Fixture title'); }
`;

test("proxy DNS validation rejects private and loopback destinations", async () => {
  for (const host of ["127.0.0.1", "10.1.2.3", "169.254.169.254", "::1", "localhost"]) await assert.rejects(publicHost(host), /non-public/);
  assert.equal((await publicHost("8.8.8.8")).address, "8.8.8.8");
});

test("yt-dlp subprocess uses isolated public proxy and appends or imports real material bytes", async () => {
  const root = await testSandbox("task37-media-"); const binary = join(root, "yt-dlp.cjs"); const previous = process.env.PITH_YTDLP_PATH;
  await writeFile(binary, fixture); await chmod(binary, 0o755); process.env.PITH_YTDLP_PATH = binary;
  try {
    const corpus = new NodeMediaCorpusPort();
    const found = await corpus.searchMedia("spoken English", 2); assert.equal(found[0]?.title, "Fixture"); assert.equal(found[0]?.url, "https://8.8.8.8/watch");
    const bundle = await corpus.fetchMediaCorpus("https://8.8.8.8/watch"); assert.equal(bundle.title, "Fixture title"); assert.deepEqual(bundle.files.map(file => file.name).sort(), ["clip.en.vtt", "clip.webm"]);
    const partial = await corpus.fetchMediaCorpus("https://8.8.8.8/partial"); assert.deepEqual(partial.files.map(file => file.name), ["clip.en.vtt"]); assert.ok(partial.warnings?.includes("音轨提取失败"));
    await assert.rejects(corpus.fetchMediaCorpus("https://127.0.0.1/watch"), /public/);
    await assert.rejects(corpus.fetchMediaCorpus("https://user@8.8.8.8/watch"), /public/);
    await assert.rejects(corpus.fetchMediaCorpus("https://8.8.8.8/symlink"), /Unsafe/);
    const abort = new AbortController(); const started = new Promise<void>((ok, fail) => { const watcher = watch(root, (_event, name) => { if (name === "started") { watcher.close(); ok(); } }); watcher.on("error", fail); });
    const cancelled = corpus.fetchMediaCorpus("https://8.8.8.8/cancel", {}, abort.signal); await started; abort.abort(); await assert.rejects(cancelled); assert.equal(await readFile(join(root, "stopped"), "utf8"), "yes");
    await mkdir(join(root, "workspace")); const storage = new NodeWorkspaceStorage(join(root, "workspace")), store = new DefaultWorkspaceStore(storage); await store.ensureScaffold();
    const existing = await store.importMaterial({ title: "Existing", kind: "article", files: [{ name: "lesson.md", bytes: new TextEncoder().encode("original") }] });
    const topic = await store.createTopic({ title: "Existing topic", materialId: existing.id, toolkits: ["feynman"] });
    const other = await store.createTopic({ title: "New topic" });
    const tools = createGuideWorkspaceTools(store, undefined, storage, undefined, undefined, corpus, topic.id); const fetchTool = tools.find(tool => tool.name === "pith_fetch_media_corpus")!;
    await assert.rejects(fetchTool.execute({ topicId: other.id, url: "https://8.8.8.8/watch" }), /current session/);
    await fetchTool.execute({ topicId: topic.id, url: "https://8.8.8.8/watch" });
    const updated = await store.getTopic(topic.id), material = await store.getMaterial(existing.id); assert.equal(updated?.materialId, existing.id); assert.ok(updated?.toolkits.includes("shadowing")); assert.ok(updated?.toolkits.includes("feynman")); assert.deepEqual(material?.files.map(file => file.name).sort(), ["clip.en.vtt", "clip.webm", "lesson.md"]);
    for (const file of bundle.files) assert.deepEqual(new Uint8Array(await storage.readBinary(`materials/${existing.id}/files/${file.name}`)), file.bytes);
    assert.deepEqual(new Uint8Array(await storage.readBinary(`materials/${existing.id}/files/lesson.md`)), new TextEncoder().encode("original"));
    await assert.rejects(fetchTool.execute({ topicId: topic.id, url: "https://8.8.8.8/watch" }), /exist/i);
    for (const file of bundle.files) assert.deepEqual(new Uint8Array(await storage.readBinary(`materials/${existing.id}/files/${file.name}`)), file.bytes);
    assert.deepEqual(new Uint8Array(await storage.readBinary(`materials/${existing.id}/files/lesson.md`)), new TextEncoder().encode("original"));
    const newTools = createGuideWorkspaceTools(store, undefined, storage, undefined, undefined, corpus, other.id); await newTools.find(tool => tool.name === "pith_fetch_media_corpus")!.execute({ topicId: other.id, url: "https://8.8.8.8/watch" });
    const created = await store.getTopic(other.id); assert.ok(created?.materialId); assert.ok(created.toolkits.includes("shadowing")); assert.equal((await store.getMaterial(created.materialId))?.files.length, 2);
    for (const file of bundle.files) assert.deepEqual(new Uint8Array(await storage.readBinary(`materials/${created.materialId}/files/${file.name}`)), file.bytes);
  } finally { if (previous === undefined) delete process.env.PITH_YTDLP_PATH; else process.env.PITH_YTDLP_PATH = previous; await rm(root, { recursive: true, force: true }); }
});
