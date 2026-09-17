import { getPipeline } from './models.js';

/**
 * MMS-TTS is a VITS model: it needs no speaker embeddings, unlike SpeechT5, so a
 * single model id is enough. The family covers many languages — `Xenova/mms-tts-fra`,
 * `-deu`, `-spa` and so on — which is what TTS_MODEL is for.
 */
export const TTS_MODEL = process.env.TTS_MODEL || 'Xenova/mms-tts-eng';

/** Longest text synthesised in one pass; longer input is split on sentences. */
export const CHUNK_CHARS = Number(process.env.TTS_CHUNK_CHARS || 300);

/** Silence inserted between chunks, so sentences do not run together. */
const GAP_SECONDS = Number(process.env.TTS_GAP_SECONDS || 0.25);

export const getSpeaker = () => getPipeline('text-to-speech', TTS_MODEL);

/**
 * Split text into chunks the model can handle, preferring sentence boundaries and
 * falling back to words so a single long sentence still fits.
 */
export function chunkText(text, limit = CHUNK_CHARS) {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  if (clean.length <= limit) return [clean];

  const sentences = clean.match(/[^.!?]+[.!?]*\s*/g) ?? [clean];
  const chunks = [];
  let current = '';

  for (const sentence of sentences) {
    if (sentence.length > limit) {
      if (current.trim()) { chunks.push(current.trim()); current = ''; }
      let words = '';
      for (const word of sentence.split(' ')) {
        if ((words + ' ' + word).trim().length > limit) {
          if (words.trim()) chunks.push(words.trim());
          words = word;
        } else {
          words = (words + ' ' + word).trim();
        }
      }
      if (words.trim()) current = words;
      continue;
    }

    if ((current + sentence).length > limit) {
      if (current.trim()) chunks.push(current.trim());
      current = sentence;
    } else {
      current += sentence;
    }
  }

  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

/**
 * Synthesise text to raw mono float32 PCM.
 * @returns {Promise<{pcm: Float32Array, samplingRate: number, chunks: number}>}
 */
export async function synthesize(text) {
  const chunks = chunkText(text);
  if (chunks.length === 0) throw new Error('speech: nothing to say');

  const speaker = await getSpeaker();
  const parts = [];
  let samplingRate = 16000;

  for (const [i, chunk] of chunks.entries()) {
    const out = await speaker(chunk);
    samplingRate = out.sampling_rate ?? samplingRate;
    parts.push(out.audio);
    if (i < chunks.length - 1) {
      parts.push(new Float32Array(Math.round(samplingRate * GAP_SECONDS)));
    }
  }

  const total = parts.reduce((n, p) => n + p.length, 0);
  const pcm = new Float32Array(total);
  let offset = 0;
  for (const part of parts) { pcm.set(part, offset); offset += part.length; }

  return { pcm, samplingRate, chunks: chunks.length };
}
