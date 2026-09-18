/**
 * Synthesise speech with Kokoro, in a process of its own.
 *
 * kokoro-js pins @huggingface/transformers ^3.5.1, which brings onnxruntime-node
 * 1.21 (napi-v3), while the rest of the project is on 4.3 with onnxruntime 1.30
 * (napi-v6). Two native runtimes at different ABIs cannot share a process — loading
 * both fails with "version VERS_1.21.0 not found". A process boundary is what keeps
 * them apart, the same way inference is kept off the event loop.
 *
 *   node scripts/tts-kokoro.mjs <chunks.json> <out.pcm>
 *
 * Reads a JSON array of text chunks, writes raw mono float32 PCM, and prints the
 * sampling rate as JSON on stdout.
 */
import fs from 'node:fs';

const [chunksPath, outPath] = process.argv.slice(2);

if (!chunksPath || !outPath) {
  console.error('tts-kokoro: usage: <chunks.json> <out.pcm>');
  process.exit(2);
}

const MODEL = process.env.TTS_MODEL || 'onnx-community/Kokoro-82M-v1.0-ONNX';
const VOICE = process.env.TTS_VOICE || 'af_heart';
const DTYPE = process.env.TTS_DTYPE || 'fp32';
const GAP_SECONDS = Number(process.env.TTS_GAP_SECONDS || 0.25);

try {
  const chunks = JSON.parse(fs.readFileSync(chunksPath, 'utf8'));
  if (!Array.isArray(chunks) || chunks.length === 0) throw new Error('no chunks to speak');

  const { KokoroTTS } = await import('kokoro-js');
  const tts = await KokoroTTS.from_pretrained(MODEL, { dtype: DTYPE });

  const parts = [];
  let samplingRate = 24000;

  for (const [i, chunk] of chunks.entries()) {
    const out = await tts.generate(chunk, { voice: VOICE });
    samplingRate = out.sampling_rate ?? samplingRate;
    parts.push(out.audio);
    if (i < chunks.length - 1) parts.push(new Float32Array(Math.round(samplingRate * GAP_SECONDS)));
  }

  const total = parts.reduce((n, p) => n + p.length, 0);
  const pcm = new Float32Array(total);
  let offset = 0;
  for (const part of parts) { pcm.set(part, offset); offset += part.length; }

  fs.writeFileSync(outPath, Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength));
  // stderr carries the phonemizer's noise; stdout carries only this.
  process.stdout.write(JSON.stringify({ samplingRate, samples: pcm.length, chunks: chunks.length }));
  process.exit(0);
} catch (err) {
  console.error('tts-kokoro:', err.message);
  process.exit(1);
}
