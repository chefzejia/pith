export const SPEECH_GATEWAY = String.raw`import array, io, json, os, shutil, subprocess, sys, tempfile, time, wave
from email.parser import BytesParser
from email.policy import default
from http.server import BaseHTTPRequestHandler, HTTPServer
import numpy as np
import sherpa_onnx as sherpa

home = os.path.dirname(os.path.abspath(__file__))
tts_dir = os.path.join(home, 'vits-piper-en_US-lessac-medium')
asr_dir = os.path.join(home, 'sherpa-onnx-whisper-tiny.en')
tts = None
asr = None
last_request = time.monotonic()
idle_seconds = int(os.environ.get('PITH_SPEECH_IDLE_SECONDS', '180'))

def synthesis(text, speed):
    global tts
    if tts is None:
        model = sherpa.OfflineTtsVitsModelConfig(model=os.path.join(tts_dir, 'en_US-lessac-medium.onnx'), tokens=os.path.join(tts_dir, 'tokens.txt'), data_dir=os.path.join(tts_dir, 'espeak-ng-data'))
        tts = sherpa.OfflineTts(sherpa.OfflineTtsConfig(model=sherpa.OfflineTtsModelConfig(vits=model, num_threads=2)))
    audio = tts.generate(text, speed=speed)
    if not audio.samples:
        raise ValueError('Empty generated audio')
    samples = array.array('h', (max(-32768, min(32767, int(sample * 32767))) for sample in audio.samples))
    if sys.byteorder != 'little': samples.byteswap()
    output = io.BytesIO()
    with wave.open(output, 'wb') as out:
        out.setnchannels(1); out.setsampwidth(2); out.setframerate(audio.sample_rate); out.writeframes(samples.tobytes())
    return output.getvalue()

def transcription(data):
    global asr
    ffmpeg = shutil.which('ffmpeg')
    if not ffmpeg: raise ValueError('ffmpeg is required for local transcription')
    with tempfile.TemporaryDirectory(dir=home) as directory:
        source = os.path.join(directory, 'input'); target = os.path.join(directory, 'audio.wav')
        with open(source, 'wb') as f: f.write(data)
        subprocess.run([ffmpeg, '-nostdin', '-v', 'error', '-i', source, '-ac', '1', '-ar', '16000', '-f', 'wav', target], check=True, timeout=120, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        with wave.open(target, 'rb') as audio:
            if audio.getsampwidth() != 2: raise ValueError('Invalid audio')
            samples = np.frombuffer(audio.readframes(audio.getnframes()), dtype='<i2').astype(np.float32) / 32768.0
    if asr is None:
        asr = sherpa.OfflineRecognizer.from_whisper(encoder=os.path.join(asr_dir, 'tiny.en-encoder.int8.onnx'), decoder=os.path.join(asr_dir, 'tiny.en-decoder.int8.onnx'), tokens=os.path.join(asr_dir, 'tiny.en-tokens.txt'), language='en', task='transcribe', num_threads=2)
    stream = asr.create_stream(); stream.accept_waveform(16000, samples); asr.decode_stream(stream)
    return stream.result.text

class Handler(BaseHTTPRequestHandler):
    def log_message(self, format, *args): pass
    def respond(self, status, content_type, data):
        self.send_response(status); self.send_header('Content-Type', content_type); self.send_header('Content-Length', str(len(data))); self.end_headers(); self.wfile.write(data)
    def authorized(self):
        return self.headers.get('Host') == '127.0.0.1:%s' % self.server.server_port and not self.headers.get('Origin')
    def read_body(self):
        limit = 30000000
        if self.headers.get('Transfer-Encoding', '').lower() == 'chunked':
            chunks = []; total = 0
            while True:
                header = self.rfile.readline(128)
                size = int(header.split(b';', 1)[0].strip(), 16)
                if size == 0:
                    while self.rfile.readline(8192).strip(): pass
                    break
                total += size
                if total > limit: raise ValueError('Invalid request size')
                chunk = self.rfile.read(size)
                if len(chunk) != size or self.rfile.read(2) != b'\r\n': raise ValueError('Invalid chunk')
                chunks.append(chunk)
            if total == 0: raise ValueError('Invalid request size')
            return b''.join(chunks)
        size = int(self.headers.get('Content-Length', '0'))
        if size <= 0 or size > limit: raise ValueError('Invalid request size')
        data = self.rfile.read(size)
        if len(data) != size: raise ValueError('Incomplete request')
        return data
    def do_GET(self):
        global last_request
        if not self.authorized() or self.path != '/health': self.respond(404, 'application/json', b'{}'); return
        last_request = time.monotonic(); self.respond(200, 'application/json', b'{"ok":true}')
    def do_POST(self):
        global last_request
        if not self.authorized(): self.respond(403, 'application/json', b'{}'); return
        last_request = time.monotonic()
        try:
            data = self.read_body(); content_type = self.headers.get('Content-Type', '')
            if self.path == '/v1/audio/speech':
                if not content_type.startswith('application/json'): raise ValueError('Expected JSON')
                request = json.loads(data); text = request.get('input', ''); speed = float(request.get('speed', 1))
                if not isinstance(text, str) or not text.strip() or len(text) > 10000 or not 0.5 <= speed <= 2: raise ValueError('Invalid speech request')
                self.respond(200, 'audio/wav', synthesis(text, speed))
            elif self.path in ('/v1/audio/transcriptions', '/transcribe'):
                if self.path == '/v1/audio/transcriptions':
                    if not content_type.startswith('multipart/form-data;'): raise ValueError('Expected multipart audio')
                    message = BytesParser(policy=default).parsebytes(('Content-Type: ' + content_type + '\r\nMIME-Version: 1.0\r\n\r\n').encode() + data)
                    parts = [p for p in message.iter_parts() if p.get_param('name', header='content-disposition') == 'file']
                    if len(parts) != 1: raise ValueError('Expected one audio file')
                    data = parts[0].get_payload(decode=True)
                self.respond(200, 'application/json', json.dumps({'text': transcription(data)}).encode())
            else: self.respond(404, 'application/json', b'{}')
        except Exception as error:
            self.respond(503, 'application/json', json.dumps({'error': str(error)}).encode())
        finally: last_request = time.monotonic()

server = HTTPServer(('127.0.0.1', 0), Handler)
server.timeout = 1
print(server.server_port, flush=True)
while time.monotonic() - last_request < idle_seconds:
    server.handle_request()
server.server_close()
`;
