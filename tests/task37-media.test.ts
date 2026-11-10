import assert from "node:assert/strict";
import { watch } from "node:fs";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { DefaultWorkspaceStore } from "../src/core/index.ts";
import { createGuideWorkspaceTools } from "../src/plugins/guide-acp/tools.ts";
import { buildMediaCorpusSlices, NodeMediaCorpusPort, publicHost } from "../src/shells/web/nodeMediaCorpus.ts";
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
else if (args.includes('asr.%(ext)s')) { fs.writeFileSync('asr.webm', Buffer.from([9,8,7])); }
else if (args.includes('--skip-download') && (url.includes('asr') || url.includes('video'))) { }
else if (args.includes('--skip-download')) { fs.writeFileSync('clip.en.vtt','WEBVTT\\n\\n00:00.000 --> 00:01.000\\nHello\\n'); }
else if (url.includes('video')) { fs.writeFileSync('clip.mp4', Buffer.from([5,6,7])); console.log('Video title\\nh264\\n60'); }
else if (url.includes('asr')) { fs.writeFileSync('clip.webm', Buffer.from([1,2,3,4])); console.log('Audio title\\nnone\\n60'); }
else { fs.writeFileSync('clip.webm', Buffer.from([1,2,3,4])); console.log('Fixture title'); }
`;

test("proxy DNS validation rejects private and loopback destinations", async () => {
  for (const host of ["127.0.0.1", "10.1.2.3", "169.254.169.254", "::1", "localhost"]) await assert.rejects(publicHost(host), /non-public/);
  assert.equal((await publicHost("8.8.8.8")).address, "8.8.8.8");
});

test("media slices follow cue timing and ASR generates persisted VTT for audio and video", async () => {
  const root = await testSandbox("task39-media-"); const binary = join(root, "yt-dlp.cjs"); const previous = process.env.PITH_YTDLP_PATH;
  await writeFile(binary, fixture); await chmod(binary, 0o755); process.env.PITH_YTDLP_PATH = binary;
  try {
    const vtt = "WEBVTT\n\n00:00:00.000 --> 00:00:15.000\nFirst phrase\n\n00:00:15.000 --> 00:00:30.000\nends here.\n\n00:00:30.000 --> 00:00:55.000\nAnother sentence.\n\n00:00:55.000 --> 00:01:20.000\nFinal sentence.\n";
    const slices = buildMediaCorpusSlices(vtt); assert.deepEqual(slices.map(item => [item.startSec, item.endSec, item.cueCount]), [[0, 30, 2], [30, 55, 1], [55, 80, 1]]); assert.match(slices[0]!.title, /00:00 - 00:30/);
    const calls: { bytes: number[]; mime: string }[] = []; const corpus = new NodeMediaCorpusPort({ async transcribeAudio(bytes, mime) { calls.push({ bytes: [...bytes], mime }); return { text: "First sentence. Second sentence. Third sentence.", durationSec: 60 }; } });
    const audio = await corpus.fetchMediaCorpus("https://8.8.8.8/asr"); assert.deepEqual(calls[0], { bytes: [1, 2, 3, 4], mime: "audio/webm" }); assert.ok(audio.slices?.length); const subtitle = audio.files.find(file => file.name === "clip.auto.vtt"); assert.ok(subtitle); const raw = new TextDecoder().decode(subtitle.bytes); assert.match(raw, /^WEBVTT\n\n00:00:00\.000 -->/); assert.match(raw, /00:01:00\.000/);
    const video = await corpus.fetchMediaCorpus("https://8.8.8.8/video"); assert.deepEqual(calls[1], { bytes: [9, 8, 7], mime: "audio/webm" }); assert.ok(video.files.some(file => file.mimeType === "video/mp4")); assert.ok(video.slices?.length);
    const short = await new NodeMediaCorpusPort({ async transcribeAudio() { return { text: `${"Long".repeat(100)}. A. B.`, durationSec: 0.003 }; } }).fetchMediaCorpus("https://8.8.8.8/asr"); const shortVtt = new TextDecoder().decode(short.files.find(file => file.name.endsWith(".vtt"))!.bytes); assert.match(shortVtt, /00:00:00\.000 --> 00:00:00\.001/); assert.match(shortVtt, /00:00:00\.001 --> 00:00:00\.002/); assert.match(shortVtt, /00:00:00\.002 --> 00:00:00\.003/);
    await mkdir(join(root, "workspace")); const storage = new NodeWorkspaceStorage(join(root, "workspace")), store = new DefaultWorkspaceStore(storage); await store.ensureScaffold(); const topic = await store.createTopic({ title: "New" }); const tool = createGuideWorkspaceTools(store, undefined, storage, undefined, undefined, corpus, topic.id).find(item => item.name === "pith_fetch_media_corpus")!;
    const result: any = await tool.execute({ topicId: topic.id, url: "https://8.8.8.8/asr" }); const updated = await store.getTopic(topic.id); assert.ok(updated?.materialId); assert.ok(updated.toolkits.includes("shadowing")); assert.ok(result.slices.length); for (const file of audio.files) assert.deepEqual(new Uint8Array(await storage.readBinary(`materials/${updated.materialId}/files/${file.name}`)), file.bytes); assert.match(await storage.readText(`materials/${updated.materialId}/files/00-跟读切片导读.md`), /First sentence/);
    const failed = await new NodeMediaCorpusPort({ async transcribeAudio() { throw new Error("ASR offline"); } }).fetchMediaCorpus("https://8.8.8.8/asr"); assert.ok(failed.warnings?.some(warning => warning.includes("ASR offline"))); assert.equal(failed.files.some(file => file.name.endsWith(".vtt")), false);
  } finally { if (previous === undefined) delete process.env.PITH_YTDLP_PATH; else process.env.PITH_YTDLP_PATH = previous; await rm(root, { recursive: true, force: true }); }
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
    const updated = await store.getTopic(topic.id), material = await store.getMaterial(existing.id); assert.equal(updated?.materialId, existing.id); assert.ok(updated?.toolkits.includes("shadowing")); assert.ok(updated?.toolkits.includes("feynman")); assert.deepEqual(material?.files.map(file => file.name).sort(), ["00-跟读切片导读.md", "clip.en.vtt", "clip.webm", "lesson.md"]); assert.match(await storage.readText(`materials/${existing.id}/files/00-跟读切片导读.md`), /片段 1.*00:00.*00:01/);
    for (const file of bundle.files) assert.deepEqual(new Uint8Array(await storage.readBinary(`materials/${existing.id}/files/${file.name}`)), file.bytes);
    assert.deepEqual(new Uint8Array(await storage.readBinary(`materials/${existing.id}/files/lesson.md`)), new TextEncoder().encode("original"));
    await assert.rejects(fetchTool.execute({ topicId: topic.id, url: "https://8.8.8.8/watch" }), /exist/i);
    for (const file of bundle.files) assert.deepEqual(new Uint8Array(await storage.readBinary(`materials/${existing.id}/files/${file.name}`)), file.bytes);
    assert.deepEqual(new Uint8Array(await storage.readBinary(`materials/${existing.id}/files/lesson.md`)), new TextEncoder().encode("original"));
    const newTools = createGuideWorkspaceTools(store, undefined, storage, undefined, undefined, corpus, other.id); await newTools.find(tool => tool.name === "pith_fetch_media_corpus")!.execute({ topicId: other.id, url: "https://8.8.8.8/watch" });
    const created = await store.getTopic(other.id); assert.ok(created?.materialId); assert.ok(created.toolkits.includes("shadowing")); assert.equal((await store.getMaterial(created.materialId))?.files.length, 3); assert.match(await storage.readText(`materials/${created.materialId}/files/00-跟读切片导读.md`), /Hello/);
    for (const file of bundle.files) assert.deepEqual(new Uint8Array(await storage.readBinary(`materials/${created.materialId}/files/${file.name}`)), file.bytes);
  } finally { if (previous === undefined) delete process.env.PITH_YTDLP_PATH; else process.env.PITH_YTDLP_PATH = previous; await rm(root, { recursive: true, force: true }); }
});
