import { ZIPVOICE_DIRECTORY, ZIPVOICE_PRESETS } from "./speechVoices.ts";

export const SPEECH_GATEWAY = String.raw`'use strict';
const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');
const sherpa = require('sherpa-onnx-node');
const root = __dirname;
const ttsDir = path.join(root, '${ZIPVOICE_DIRECTORY}');
const asrDir = path.join(root, 'sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17');
const presets = ${JSON.stringify(ZIPVOICE_PRESETS)};
function getVoices() { return { voices: presets.map(({id, sid, group}) => ({id, sid, group})), defaultVoice: presets[0].id }; }
function voicePreset(value) { const name = typeof value === 'string' ? value : ''; return presets.find(item => item.id === name || (/^\d+$/.test(name) && item.sid === Number(name))) || presets[0]; }
const references = new Map();
let tts, asr, timer, active = 0;
const converters = new Set();
const idle = Number(process.env.PITH_SPEECH_IDLE_SECONDS || '180') * 1000;
function resetIdle() { clearTimeout(timer); if (!active) timer = setTimeout(() => server.close(), idle); }
function synthesize(text, speed, voice) {
  if (!tts) tts = new sherpa.OfflineTts({ model: { zipvoice: { encoder: path.join(ttsDir, 'encoder.int8.onnx'), decoder: path.join(ttsDir, 'decoder.int8.onnx'), tokens: path.join(ttsDir, 'tokens.txt'), dataDir: path.join(ttsDir, 'espeak-ng-data'), lexicon: path.join(ttsDir, 'lexicon.txt'), vocoder: path.join(ttsDir, 'vocos_24khz.onnx') }, numThreads: 4, provider: 'cpu' }, maxNumSentences: 1 });
  const preset = voicePreset(voice);
  let reference = references.get(preset.id);
  if (!reference) { reference = sherpa.readWave(path.join(ttsDir, 'test_wavs', preset.file)); references.set(preset.id, reference); }
  const generationConfig = new sherpa.GenerationConfig({ speed, numSteps: 8, referenceAudio: reference.samples, referenceSampleRate: reference.sampleRate, referenceText: preset.text, extra: { min_char_in_sentence: 10 } });
  const audio = tts.generate({ text, generationConfig });
  if (!audio.samples.length) throw Error('Empty generated audio');
  let peak = 0;
  for (const sample of audio.samples) { if (!Number.isFinite(sample)) throw Error('Invalid generated audio'); peak = Math.max(peak, Math.abs(sample)); }
  const gain = peak > 0.95 ? 0.95 / peak : 1;
  const output = Buffer.alloc(44 + audio.samples.length * 2);
  output.write('RIFF', 0); output.writeUInt32LE(output.length - 8, 4); output.write('WAVEfmt ', 8); output.writeUInt32LE(16, 16); output.writeUInt16LE(1, 20); output.writeUInt16LE(1, 22); output.writeUInt32LE(audio.sampleRate, 24); output.writeUInt32LE(audio.sampleRate * 2, 28); output.writeUInt16LE(2, 32); output.writeUInt16LE(16, 34); output.write('data', 36); output.writeUInt32LE(output.length - 44, 40);
  for (let i = 0; i < audio.samples.length; i++) output.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(audio.samples[i] * gain * 32767))), 44 + i * 2);
  return output;
}
async function transcribe(bytes) {
  const pcm = await new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', ['-nostdin', '-v', 'error', '-i', 'pipe:0', '-ac', '1', '-ar', '16000', '-f', 's16le', 'pipe:1'], { stdio: ['pipe', 'pipe', 'ignore'] });
    converters.add(child); let size = 0, failed = false; const chunks = [];
    const timeout = setTimeout(() => { failed = true; child.kill('SIGKILL'); }, 120000);
    child.stdout.on('data', chunk => { size += chunk.length; if (size > 100000000) { failed = true; child.kill('SIGKILL'); } else chunks.push(chunk); });
    child.stdin.on('error', () => {}); child.stdin.end(bytes);
    child.on('error', () => { failed = true; });
    child.on('close', code => { clearTimeout(timeout); converters.delete(child); if (failed || code !== 0) reject(Error('Audio conversion failed; ffmpeg is required')); else resolve(Buffer.concat(chunks)); });
  });
  if (!asr) asr = new sherpa.OfflineRecognizer({ featConfig: { sampleRate: 16000, featureDim: 80 }, modelConfig: { senseVoice: { model: path.join(asrDir, 'model.int8.onnx'), useInverseTextNormalization: 1 }, tokens: path.join(asrDir, 'tokens.txt'), numThreads: 2, provider: 'cpu' } });
  const samples = new Float32Array(Math.floor(pcm.length / 2));
  for (let i = 0; i < samples.length; i++) samples[i] = pcm.readInt16LE(i * 2) / 32768;
  const stream = asr.createStream(); stream.acceptWaveform({ sampleRate: 16000, samples }); asr.decode(stream);
  return asr.getResult(stream).text;
}
function respond(res, status, type, body) { res.writeHead(status, { 'Content-Type': type, 'Content-Length': body.length }); res.end(body); }
async function readBody(req) { let size = 0; const chunks = []; for await (const chunk of req) { size += chunk.length; if (size > 30000000) throw Error('Request too large'); chunks.push(chunk); } if (!size) throw Error('Empty request'); return Buffer.concat(chunks); }
const server = http.createServer(async (req, res) => {
  if (req.headers.host !== '127.0.0.1:' + server.address().port || req.headers.origin) { respond(res, 403, 'application/json', Buffer.from('{}')); return; }
  active++; resetIdle();
  try {
    if (req.method === 'GET' && (req.url === '/health' || req.url === '/v1/audio/voices')) { respond(res, 200, 'application/json', Buffer.from(JSON.stringify({ ok: true, ...await getVoices() }))); return; }
    if (req.method !== 'POST') { respond(res, 404, 'application/json', Buffer.from('{}')); return; }
    const data = await readBody(req), type = req.headers['content-type'] || '';
    if (req.url === '/v1/audio/speech') {
      if (!type.startsWith('application/json')) throw Error('Expected JSON');
      const input = JSON.parse(data.toString('utf8')), speed = Number(input.speed || 1);
      if (typeof input.input !== 'string' || !input.input.trim() || input.input.length > 10000 || speed < 0.5 || speed > 2 || !Number.isFinite(speed)) throw Error('Invalid speech request');
      respond(res, 200, 'audio/wav', synthesize(input.input, speed, input.voice));
    } else if (req.url === '/v1/audio/transcriptions' || req.url === '/transcribe') {
      let audio = data;
      if (req.url === '/v1/audio/transcriptions') { if (!type.startsWith('multipart/form-data;')) throw Error('Expected multipart audio'); const form = await new Request('http://127.0.0.1/', { method: 'POST', headers: { 'content-type': type }, body: data }).formData(); const files = form.getAll('file'); if (files.length !== 1 || typeof files[0] === 'string') throw Error('Expected one audio file'); audio = Buffer.from(await files[0].arrayBuffer()); }
      respond(res, 200, 'application/json', Buffer.from(JSON.stringify({ text: await transcribe(audio) })));
    } else respond(res, 404, 'application/json', Buffer.from('{}'));
  } catch (error) { if (!res.headersSent) respond(res, 503, 'application/json', Buffer.from(JSON.stringify({ error: error.message }))); }
  finally { active--; resetIdle(); }
});
server.requestTimeout = 30000; server.headersTimeout = 10000;
process.on('SIGTERM', () => { for (const child of converters) child.kill('SIGKILL'); server.close(); process.exit(0); });
server.listen(0, '127.0.0.1', () => { console.log(server.address().port); resetIdle(); });
`;
